// 2026-11-03 07:26Z 和 10:19Z：daemon 停机前几秒，编排器开始了一个执行 Run（#249、#273）。停机时它还在准备：
// 检出隔离 worktree、fetch origin、克隆依赖，负载 35–90 时要几分钟。它还没有垫片，分离不了，旧代码的 close
// 却等它结束：第一次 daemon 5 分钟后才退出，第二次 4 分钟后被 SIGKILL。
// 决策边界：daemon 开始停机（detachRunningChildren）时，还在准备的 Run 不再等它这一步。Run 留在 starting，
// 下一个 daemon 按孤儿回收（和被强杀时一样）。这里用一个连不上的 origin 让准备卡在 git fetch 上。
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { ClaudeRuntime } from "@pi-lead-child/runtime";
import type { AgentRuntime, RuntimeHandle } from "@pi-lead-child/runtime";
import { openDb, type Db } from "@pi-lead-child/store";
import { createItem, getRun, transition } from "@pi-lead-child/store";
import { acceptRunningChildren, detachRunningChildren, runItem } from "../src/children/manager.js";
import { resetFetchThrottleForTests } from "../src/coordinator/workspace-remote.js";

let dir: string;
let db: Db;
let gate: string;

beforeEach(() => {
  dir = tempDir("plc-start-shutdown-");
  db = openDb(join(dir, "plc.db"));
  gate = join(dir, "fetch-gate");
  resetFetchThrottleForTests();
});

afterEach(() => {
  acceptRunningChildren();
  // 放开卡住的 fetch：假的 ssh 退出，git 也跟着退出。
  writeFileSync(gate, "");
  vi.unstubAllEnvs();
  db.close();
});

// 一个 git 仓库，origin 走 ssh。假的 ssh 先留下一个标记，再一直等 gate 文件出现：fetch 卡在这里，像负载很高时一样。
function repositoryWithHangingOrigin(): { repo: string; fetching: string } {
  const repo = join(dir, "repo");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "x\n");
  git("add", ".");
  git("-c", "user.name=Ethan", "-c", "user.email=ethan@example.com", "commit", "-qm", "base");
  git("remote", "add", "origin", "ssh://git.example.invalid/acme/x.git");
  const fetching = join(dir, "fetching");
  const ssh = join(dir, "fake-ssh.sh");
  writeFileSync(ssh, `touch "${fetching}"\nwhile [ ! -f "${gate}" ]; do sleep 0.05; done\nexit 1\n`);
  vi.stubEnv("GIT_SSH_COMMAND", `sh ${ssh}`);
  return { repo, fetching };
}

// 记下 start 被调用了几次的 runtime。这个测试里它不应该被调用。
function countingRuntime(): AgentRuntime & { starts: number } {
  const runtime = {
    id: "claude" as const,
    capabilities: { ...new ClaudeRuntime().capabilities },
    starts: 0,
    async start(): Promise<RuntimeHandle> {
      runtime.starts += 1;
      throw new Error("the runtime must not start while the daemon stops");
    },
  };
  return runtime;
}

describe("a run that is still preparing when the daemon stops", () => {
  it("is not waited for: runItem returns at once, and the run stays starting for the next daemon", async () => {
    const { repo, fetching } = repositoryWithHangingOrigin();
    const itemId = createItem(db, { title: "build it", brief: "change the code", createdBy: "user", workdir: repo });
    transition(db, { itemId, to: "active", actor: "system", reason: "started" });
    const runtime = countingRuntime();

    const started = runItem(db, itemId, {
      dbPath: join(dir, "plc.db"), dataDir: dir, sessionDir: join(dir, "sessions", `item-${itemId}`),
      prompt: "change the code", role: "executor", purpose: "execution", runtime, lingerMs: 0,
    });
    await vi.waitFor(() => expect(existsSync(fetching)).toBe(true), { timeout: 20_000, interval: 50 });
    const runId = (db.prepare("SELECT id FROM runs WHERE item_id=?").get(itemId) as { id: number }).id;
    expect(getRun(db, runId)?.state).toBe("starting");

    const stopped = detachRunningChildren();
    // 旧代码：runItem 一直等 fetch，close 也就一直等它。
    const result = await Promise.race([started, delay(5_000).then(() => "still waiting for the preparation")]);

    expect(result).toEqual({ runId, detached: true });
    expect(stopped).toEqual({ detached: 0, starting: 1 });
    expect(runtime.starts).toBe(0);
    // 不记成失败：下一个 daemon 按孤儿回收这个 Run（被重启打断，交回派发队列）。
    expect(getRun(db, runId)).toMatchObject({ state: "starting", launcher: null, failure_code: null });
    expect(db.prepare("SELECT kind FROM activities WHERE run_id=? AND kind IN ('crash','attempt_end')").all(runId))
      .toEqual([]);
  }, 40_000);
});
