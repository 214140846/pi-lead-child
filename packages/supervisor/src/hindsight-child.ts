// Hindsight 记忆服务由 supervisor 拉起（docs/desktop/macos-desktop-design.md 第 8.7 节，用户 2026-11-05：「登录项与扩展」
// 里不要单独一行）。以前它是独立的 launchd 任务 com.bytezard.plc.hindsight，macOS 给每个 LaunchAgent 列一行。
//
// daemon 决定期望状态，写 <数据目录>/hindsight/run.json（deploy/hindsight.ts 的 ensureHindsightService）：程序、环境变量
// （没有密钥）、工作目录和期望状态的指纹。这里每 pollMs 看一次：
//   - 有 run.json、没在跑：拉起。距上次拉起不满 throttleMs 时等到满了再拉（和原来 plist 的 ThrottleInterval 一样），
//     免得起不来的服务每秒重启一次；
//   - 指纹变了：先停旧的（SIGTERM，hindsight-main 转给 hindsight-api，它停掉 pg0 再退出；等不到就 SIGKILL），再起新的；
//   - run.json 没了：停掉。
// 它是 supervisor 的子进程，不是 daemon 的：daemon 重启时它照常跑。supervisor 停机时（close）一起停掉它。
// 不另开进程组：supervisor 意外退出时，launchd 收拾这个任务的整个进程组，不留下没人管的 Hindsight 和 pg0。
// 输出写进 logs/hindsight.out.log、hindsight.err.log，和原来 launchd 写的一样。
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { HINDSIGHT_INHERITED_ENV, hindsightRunPath, readHindsightRun, type HindsightRun } from "./deploy/hindsight.js";

export const HINDSIGHT_POLL_MS = 2_000;
export const HINDSIGHT_THROTTLE_MS = 30_000;
export const HINDSIGHT_STOP_TIMEOUT_MS = 20_000;

/** 子进程的环境：supervisor 的环境里只拿白名单（和 hindsight-main 给 hindsight-api 的一样），再加上 run.json 的。 */
export function hindsightChildEnv(base: Record<string, string | undefined>, run: HindsightRun): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of HINDSIGHT_INHERITED_ENV) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...run.env };
}

export interface HindsightChildOptions {
  dataDir: string;
  logsDir: string;
  log: (line: string) => void;
  /** supervisor 的环境（缺省 process.env）。 */
  env?: Record<string, string | undefined>;
  pollMs?: number;
  throttleMs?: number;
  stopTimeoutMs?: number;
  /** 测试注入。 */
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  now?: () => number;
}

export interface HindsightChild {
  /** 按 run.json 做一次（测试用；平时由定时器调用）。 */
  reconcile(): Promise<void>;
  pid(): number | null;
  close(): Promise<void>;
}

interface Running {
  process: ChildProcess;
  spec: string;
  exited: Promise<void>;
}

export function startHindsightChild(o: HindsightChildOptions): HindsightChild {
  const spawn = o.spawn ?? nodeSpawn;
  const now = o.now ?? Date.now;
  const throttleMs = o.throttleMs ?? HINDSIGHT_THROTTLE_MS;
  const stopTimeoutMs = o.stopTimeoutMs ?? HINDSIGHT_STOP_TIMEOUT_MS;
  let running: Running | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;
  let busy: Promise<void> | null = null;
  let closed = false;

  const stop = async (current: Running, why: string): Promise<void> => {
    o.log(`[hindsight] stopping pid ${current.process.pid} (${why})`);
    current.process.kill("SIGTERM");
    const timedOut = await Promise.race([
      current.exited.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), stopTimeoutMs).unref()),
    ]);
    if (timedOut) {
      o.log(`[hindsight] pid ${current.process.pid} did not stop in ${stopTimeoutMs} ms; killing it`);
      current.process.kill("SIGKILL");
      await current.exited;
    }
    // 我们自己停的（设置变了）：马上起新的，不等 throttleMs。等待只给自己退出的进程。
    lastStart = Number.NEGATIVE_INFINITY;
  };

  const start = (run: HindsightRun): void => {
    mkdirSync(o.logsDir, { recursive: true });
    mkdirSync(run.cwd, { recursive: true });
    const out = openSync(join(o.logsDir, "hindsight.out.log"), "a");
    const err = openSync(join(o.logsDir, "hindsight.err.log"), "a");
    lastStart = now();
    let child: ChildProcess;
    try {
      child = spawn(run.programArguments[0]!, run.programArguments.slice(1), {
        cwd: run.cwd, env: hindsightChildEnv(o.env ?? process.env, run), stdio: ["ignore", out, err],
      });
    } finally {
      // 子进程拿到了自己的一份文件描述符。
      closeSync(out);
      closeSync(err);
    }
    const exited = new Promise<void>((resolve) => {
      child.once("exit", (code, signal) => {
        o.log(`[hindsight] pid ${child.pid ?? "?"} exited (${signal ?? code})`);
        if (running?.process === child) running = null;
        resolve();
      });
      child.once("error", (error) => {
        o.log(`[hindsight] cannot start ${run.programArguments[0]}: ${error.message}`);
        if (running?.process === child) running = null;
        resolve();
      });
    });
    running = { process: child, spec: run.spec, exited };
    o.log(`[hindsight] started pid ${child.pid ?? "?"}`);
  };

  const step = async (): Promise<void> => {
    if (closed) return;
    const run = existsSync(hindsightRunPath(o.dataDir)) ? readHindsightRun(o.dataDir) : null;
    if (!run) {
      if (running) await stop(running, "the daemon turned it off");
      return;
    }
    if (running && running.spec !== run.spec) await stop(running, "its settings changed");
    if (running || closed) return;
    if (now() - lastStart < throttleMs) return;
    start(run);
  };

  const reconcile = async (): Promise<void> => {
    // 一次只做一件事：停旧的要等它退出，期间的定时器不再插进来。
    if (busy) return busy;
    busy = step().catch((error: Error) => o.log(`[hindsight] ${error.message}`)).finally(() => { busy = null; });
    return busy;
  };

  const timer = setInterval(() => void reconcile(), o.pollMs ?? HINDSIGHT_POLL_MS);
  timer.unref();
  void reconcile();

  return {
    reconcile,
    pid: () => running?.process.pid ?? null,
    close: async () => {
      closed = true;
      clearInterval(timer);
      await busy;
      if (running) await stop(running, "the supervisor is closing");
    },
  };
}
