// 判定工作区、认项目要的 git 事实：仓库根目录、公共目录、origin 地址、HEAD 里有没有某个路径、没建成的 worktree 能不能作废。
// 后台异步查，按键缓存一小段时间。派发、建工单、Lead 的预检只读缓存：没查好时派发跳过这一拍，异步的入口先 await 预热。
// 以前每次判定都在主线程上同步跑 git，派发还在 SQLite 事务里跑：负载高时一个 git 要几秒，daemon 停住，网页断线（2026-11-03）。
// 缓存里没有、调用方又没预热时，仍然同步查一次（结果和以前一样），并记一行日志，好找出还没预热的路径。
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Workspace } from "@pi-lead-child/core";

const execFileAsync = promisify(execFile);

export type DiscardableWorktree = Pick<Workspace, "id" | "path" | "repo_root" | "branch" | "base_ref">;

export type GitFact =
  // git -C dir rev-parse --show-toplevel 的原文。dir 不存在或不在仓库里时为 null。
  | { kind: "top"; dir: string }
  // git -C dir rev-parse --path-format=absolute --git-common-dir 的原文。
  | { kind: "commonDir"; dir: string }
  // git -C root remote get-url origin 的原文。
  | { kind: "origin"; root: string }
  // git -C repository cat-file -e HEAD:path 成功没有。
  | { kind: "headHas"; repository: string; path: string }
  // 没建成的隔离 worktree 能不能作废（workspace-policy.ts 的 discardableFailedWorktree）。worktreeRoot 是 <repo>.plc-workspaces。
  | { kind: "discardable"; workspace: DiscardableWorktree; worktreeRoot: string };

type FactValue = string | boolean | null;

export interface GitFactSource {
  get(fact: GitFact & { kind: "top" | "commonDir" | "origin" }): string | null;
  get(fact: GitFact & { kind: "headHas" | "discardable" }): boolean;
  get(fact: GitFact): FactValue;
}

const GIT_TIMEOUT_MS = 3_000;
const DISCARDABLE_TIMEOUT_MS = 5_000;
// 仓库在哪、origin 是谁很少变：查到了留 10 分钟。查不到的（还没 clone、不是仓库）只留 10 秒，clone 好以后很快能认出来。
// HEAD 里有什么、worktree 的状态会随提交变：一律 10 秒。
const STABLE_TTL_MS = 10 * 60_000;
const SHORT_TTL_MS = 10_000;

function keyOf(fact: GitFact): string {
  switch (fact.kind) {
    case "top": return `top\0${fact.dir}`;
    case "commonDir": return `commonDir\0${fact.dir}`;
    case "origin": return `origin\0${fact.root}`;
    case "headHas": return `headHas\0${fact.repository}\0${fact.path}`;
    case "discardable": {
      const w = fact.workspace;
      return `discardable\0${w.id}\0${w.path}\0${w.repo_root ?? ""}\0${w.branch ?? ""}\0${w.base_ref ?? ""}`;
    }
  }
}

function ttlOf(fact: GitFact, value: FactValue): number {
  if (fact.kind === "headHas" || fact.kind === "discardable") return SHORT_TTL_MS;
  return value === null ? SHORT_TTL_MS : STABLE_TTL_MS;
}

const cache = new Map<string, { value: FactValue; expiresAt: number }>();
const inFlight = new Map<string, Promise<void>>();
const loggedAt = new Map<string, number>();
let log: ((line: string) => void) | null = null;

/** daemon 的日志：缓存里没有、只好同步查的时候记一行（每个键一分钟最多一行）。 */
export function setGitFactsLog(sink: ((line: string) => void) | null): void {
  log = sink;
}

/** 忘掉查过的事实：clone、建或删 worktree 以后，测试换部署仓库时。 */
export function forgetGitFacts(): void {
  cache.clear();
}

function cached(key: string): { value: FactValue } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function store(fact: GitFact, value: FactValue): void {
  cache.set(keyOf(fact), { value, expiresAt: Date.now() + ttlOf(fact, value) });
}

function gitArgs(fact: Exclude<GitFact, { kind: "discardable" }>): string[] {
  switch (fact.kind) {
    case "top": return ["-C", fact.dir, "rev-parse", "--show-toplevel"];
    case "commonDir": return ["-C", fact.dir, "rev-parse", "--path-format=absolute", "--git-common-dir"];
    case "origin": return ["-C", fact.root, "remote", "get-url", "origin"];
    case "headHas": return ["-C", fact.repository, "cat-file", "-e", `HEAD:${fact.path}`];
  }
}

// 目录和它的上级都没有 .git：不在任何仓库里，不用起 git 进程（轻子 agent 的目录、数据目录下的目录都是这样）。
function insideGitCheckout(dir: string): boolean {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function realpathOr(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

// 判断里要做的一步：跑一个 git（回 stdout），或者列一个目录。判断写成生成器，同步、异步两种查法各自执行这些步骤。
type Step = { git: string[] } | { list: string };

// 建 worktree 失败时留下的行，作废它不会丢任何东西的情况：分支不在或者还停在起点（git 先建分支、再建目录），并且
//   · 目录不在；或者
//   · 目录是 git 登记过的 worktree，干净，HEAD 还在起点；或者
//   · 目录在 <repo>.plc-workspaces 里、git 没有登记，里面最多只有一个 .git 文件（git 建到一半）。
function* discardableSteps(fact: Extract<GitFact, { kind: "discardable" }>): Generator<Step, boolean, any> {
  const workspace = fact.workspace;
  if (!workspace.repo_root) return false;
  const repo = workspace.repo_root;
  if (workspace.branch) {
    try {
      const head = String(yield { git: ["-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${workspace.branch}`] }).trim();
      if (head !== workspace.base_ref) return false;
    } catch { /* 分支不在 */ }
  }
  if (!existsSync(workspace.path)) return true;
  const path = realpathOr(workspace.path);
  let registered = false;
  try {
    registered = String(yield { git: ["-C", repo, "worktree", "list", "--porcelain"] }).split("\n")
      .some((line) => line.startsWith("worktree ") && realpathOr(line.slice("worktree ".length)) === path);
  } catch { return false; }
  if (registered) {
    try {
      const dirty = String(yield { git: ["-C", path, "status", "--porcelain", "--untracked-files=normal"] }).trim();
      const head = String(yield { git: ["-C", path, "rev-parse", "HEAD"] }).trim();
      return dirty === "" && head === workspace.base_ref;
    } catch { return false; }
  }
  if (dirname(path) !== realpathOr(fact.worktreeRoot)) return false;
  try {
    const names: string[] = yield { list: path };
    return names.every((name) => name === ".git");
  } catch { return false; }
}

function runStepsSync<T>(steps: Generator<Step, T, any>): T {
  let next = steps.next();
  while (!next.done) {
    const step = next.value;
    let output: unknown;
    try {
      output = "git" in step
        ? execFileSync("git", step.git, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: DISCARDABLE_TIMEOUT_MS })
        : readdirSync(step.list);
    } catch (error) {
      next = steps.throw(error);
      continue;
    }
    next = steps.next(output);
  }
  return next.value;
}

async function runStepsAsync<T>(steps: Generator<Step, T, any>): Promise<T> {
  let next = steps.next();
  while (!next.done) {
    const step = next.value;
    let output: unknown;
    try {
      output = "git" in step
        ? (await execFileAsync("git", step.git, { encoding: "utf8", timeout: DISCARDABLE_TIMEOUT_MS })).stdout
        : await readdir(step.list);
    } catch (error) {
      next = steps.throw(error);
      continue;
    }
    next = steps.next(output);
  }
  return next.value;
}

function computeSync(fact: GitFact): FactValue {
  if (fact.kind === "discardable") return runStepsSync(discardableSteps(fact));
  if (fact.kind === "top" && !insideGitCheckout(fact.dir)) return null;
  try {
    const out = execFileSync("git", gitArgs(fact), { encoding: "utf8", timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
    return fact.kind === "headHas" ? true : out.trim() || null;
  } catch {
    return fact.kind === "headHas" ? false : null;
  }
}

async function computeAsync(fact: GitFact): Promise<FactValue> {
  if (fact.kind === "discardable") return runStepsAsync(discardableSteps(fact));
  if (fact.kind === "top" && !insideGitCheckout(fact.dir)) return null;
  try {
    const { stdout } = await execFileAsync("git", gitArgs(fact), { encoding: "utf8", timeout: GIT_TIMEOUT_MS });
    return fact.kind === "headHas" ? true : stdout.trim() || null;
  } catch {
    return fact.kind === "headHas" ? false : null;
  }
}

/** 在后台查一个事实，查好写进缓存。同一个键同时只查一次。不抛错：查不到记成 null / false。 */
export function resolveGitFact(fact: GitFact): Promise<void> {
  const key = keyOf(fact);
  const running = inFlight.get(key);
  if (running) return running;
  const promise = computeAsync(fact)
    .then((value) => { store(fact, value); })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, promise);
  return promise;
}

/** 缓存优先。缓存里没有时同步查一次（会卡主线程，记一行日志），查到的也写进缓存。 */
export const gitFacts: GitFactSource = {
  get(fact: GitFact): any {
    const key = keyOf(fact);
    const hit = cached(key);
    if (hit) return hit.value;
    if (log) {
      const now = Date.now();
      const last = loggedAt.get(key);
      if (last === undefined || now - last >= 60_000) {
        loggedAt.set(key, now);
        log(`[git-facts] not warmed, running git synchronously: ${key.replaceAll("\0", " ")}`);
      }
    }
    const value = computeSync(fact);
    store(fact, value);
    return value;
  },
};

// 只读缓存的来源：缺的记下来，回一个让判定能走完的缺省值（不是仓库、HEAD 里有、不能作废）。
function probe(): GitFactSource & { misses: GitFact[] } {
  const misses: GitFact[] = [];
  return {
    misses,
    get(fact: GitFact): any {
      const hit = cached(keyOf(fact));
      if (hit) return hit.value;
      misses.push(fact);
      return fact.kind === "headHas" ? true : fact.kind === "discardable" ? false : null;
    },
  };
}

/**
 * 同步：decide 要的事实都在缓存里时为 true。缺的在后台开始查（不等）。
 * decide 用拿到的来源做一遍判定（例如 planRunWorkspace）；它抛错时算备好了，让真正的判定去报错。
 */
export function gitFactsReady(decide: (facts: GitFactSource) => unknown): boolean {
  const source = probe();
  try {
    decide(source);
  } catch {
    return true;
  }
  for (const fact of source.misses) void resolveGitFact(fact);
  return source.misses.length === 0;
}

/**
 * 异步备好 decide 要的事实。一轮查完再判定一次：上一轮的结果决定下一轮要查什么（先知道仓库根目录，才知道要查它的公共目录）。
 */
export async function warmGitFacts(decide: (facts: GitFactSource) => unknown, rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    const source = probe();
    try {
      decide(source);
    } catch {
      return;
    }
    if (!source.misses.length) return;
    await Promise.all(source.misses.map(resolveGitFact));
  }
}
