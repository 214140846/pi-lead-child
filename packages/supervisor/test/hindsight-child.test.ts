// Hindsight 由 supervisor 拉起（src/hindsight-child.ts，docs/desktop/macos-desktop-design.md 第 8.7 节，用户 2026-11-05）：
// 以前是独立的 launchd 任务，「登录项与扩展」里多一行。子进程是真的 node 脚本，不碰 launchd。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { hindsightRunPath, type HindsightRun } from "../src/deploy/hindsight.js";
import { startHindsightChild, type HindsightChild } from "../src/hindsight-child.js";
import { loadSupervisorState, saveSupervisorState } from "../src/state.js";
import { startSupervisor, type SupervisorHandle } from "../src/server.js";

// 假的 hindsight-main：记下自己的 pid、期望状态的指纹和看得到的一个密钥变量，打一行日志，然后一直跑（exitAfterMs 时自己退出）。
const SCRIPT = `
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.PROBE_FILE, [process.pid, process.env.PLC_HINDSIGHT_SPEC, process.env.AM_API_KEY ?? "-", process.cwd()].join(" ") + "\\n");
console.log("hindsight probe " + process.pid);
const exitAfter = Number(process.env.EXIT_AFTER_MS || 0);
if (exitAfter) setTimeout(() => process.exit(3), exitAfter); else setInterval(() => {}, 1000);
`;

function setup() {
  const dataDir = tempDir("plc-hindsight-child-");
  const probe = join(dataDir, "probe.log");
  writeFileSync(probe, "");
  const script = join(dataDir, "fake-hindsight.cjs");
  writeFileSync(script, SCRIPT);
  const writeRun = (spec: string, extra: Record<string, string> = {}) => {
    const run: HindsightRun = {
      programArguments: [process.execPath, script], cwd: join(dataDir, "hindsight"), spec,
      env: { PLC_HINDSIGHT_SPEC: spec, PROBE_FILE: probe, ...extra },
    };
    mkdirSync(join(dataDir, "hindsight"), { recursive: true });
    writeFileSync(hindsightRunPath(dataDir), JSON.stringify(run));
  };
  const starts = () => readFileSync(probe, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    const [pid, spec, secret, cwd] = line.split(" ");
    return { pid: Number(pid), spec, secret, cwd };
  });
  return { dataDir, probe, writeRun, starts, logs: join(dataDir, "logs") };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let child: HindsightChild | null = null;
let supervisor: SupervisorHandle | null = null;
afterEach(async () => {
  await child?.close();
  child = null;
  await supervisor?.close();
  supervisor = null;
});

describe("startHindsightChild", () => {
  it("starts Hindsight from run.json with only the allowed variables, and writes its output to the Hindsight logs", async () => {
    const f = setup();
    f.writeRun("spec-1");
    const lines: string[] = [];
    child = startHindsightChild({
      dataDir: f.dataDir, logsDir: f.logs, log: (line) => lines.push(line), pollMs: 20,
      env: { HOME: "/Users/alice", PATH: "/usr/bin", AM_API_KEY: "secret-from-the-daemon-env" },
    });
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1), { timeout: 5_000 });
    expect(f.starts()[0]).toMatchObject({ spec: "spec-1", secret: "-", cwd: join(f.dataDir, "hindsight") });
    await vi.waitFor(() => expect(readFileSync(join(f.logs, "hindsight.out.log"), "utf8")).toContain("hindsight probe"), { timeout: 5_000 });
    expect(child.pid()).toBe(f.starts()[0]!.pid);
  });

  it("restarts at once when the daemon changes the desired state, and stops it when run.json goes away", async () => {
    const f = setup();
    f.writeRun("spec-1");
    child = startHindsightChild({ dataDir: f.dataDir, logsDir: f.logs, log: () => {}, pollMs: 20, throttleMs: 60_000 });
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1), { timeout: 5_000 });
    const first = f.starts()[0]!.pid;

    // 设置变了：先停旧的，马上起新的，不等 throttleMs。
    f.writeRun("spec-2");
    await vi.waitFor(() => expect(f.starts()).toHaveLength(2), { timeout: 5_000 });
    expect(f.starts()[1]!.spec).toBe("spec-2");
    expect(alive(first)).toBe(false);

    rmSync(hindsightRunPath(f.dataDir));
    const second = f.starts()[1]!.pid;
    await vi.waitFor(() => expect(alive(second)).toBe(false), { timeout: 5_000 });
    expect(child.pid()).toBeNull();
  });

  it("waits the throttle time before it starts a crashed Hindsight again", async () => {
    const f = setup();
    f.writeRun("spec-1", { EXIT_AFTER_MS: "50" });
    let clock = 0;
    child = startHindsightChild({ dataDir: f.dataDir, logsDir: f.logs, log: () => {}, pollMs: 60_000, throttleMs: 30_000, now: () => clock });
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1), { timeout: 5_000 });
    await vi.waitFor(() => expect(child!.pid()).toBeNull(), { timeout: 5_000 });
    clock = 10_000;
    await child.reconcile();
    expect(f.starts()).toHaveLength(1);
    clock = 30_000;
    await child.reconcile();
    await vi.waitFor(() => expect(f.starts()).toHaveLength(2), { timeout: 5_000 });
  });

  it("stops Hindsight when it closes", async () => {
    const f = setup();
    f.writeRun("spec-1");
    const manager = startHindsightChild({ dataDir: f.dataDir, logsDir: f.logs, log: () => {}, pollMs: 20 });
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1), { timeout: 5_000 });
    await manager.close();
    expect(alive(f.starts()[0]!.pid)).toBe(false);
  });
});

// supervisor 自己拉起 Hindsight，停机时一起停掉它。daemon 不在跑也一样（用户 plc daemon stop 以后，记忆服务照常）。
describe("the supervisor runs Hindsight", () => {
  it("starts Hindsight from run.json and stops it when the supervisor closes", async () => {
    const f = setup();
    f.writeRun("spec-1");
    const statePath = join(f.dataDir, "supervisor-state.json");
    const state = loadSupervisorState(statePath);
    state.desiredState = "stopped";
    saveSupervisorState(statePath, state);
    supervisor = await startSupervisor({
      dataDir: f.dataDir, dbPath: join(f.dataDir, "plc.db"), daemonCommand: { bin: process.execPath, args: ["-e", ""] },
      cwd: process.cwd(), env: { PLC_DATA_DIR: f.dataDir }, log: () => {}, hindsight: { pollMs: 20 },
    });
    await vi.waitFor(() => expect(f.starts()).toHaveLength(1), { timeout: 5_000 });
    const pid = f.starts()[0]!.pid;
    expect(alive(pid)).toBe(true);
    await supervisor.close();
    supervisor = null;
    expect(alive(pid)).toBe(false);
    expect(existsSync(join(f.dataDir, "logs", "hindsight.out.log"))).toBe(true);
  });
});
