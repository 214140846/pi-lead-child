// 冒烟脚本的完整流程：假的运行包。bin/lead-agent 是测试用的 Node 的硬链接（或副本），
// supervisor.mjs 和 daemon.mjs 是假的：daemon 按同样的 socket 协议回答 status，supervisor 收到 SIGTERM 时先停 daemon 再退出。
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { PLC_WRAPPER } from "../lib/pack.js";
import { commandName, smokeEnv, smokeRuntime, stubScript } from "../lib/smoke.js";

const FAKE_SUPERVISOR = `
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const runtime = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const mode = readFileSync(join(runtime, "mode"), "utf8").trim();
const data = process.env.PLC_DATA_DIR;
writeFileSync(join(runtime, "seen-env.json"), JSON.stringify({
  HOME: process.env.HOME, PLC_DATA_DIR: data, PLC_DEV: process.env.PLC_DEV ?? null, PLC_MEMORY_BACKEND: process.env.PLC_MEMORY_BACKEND,
}));
// 和真的 daemon 一样按名字调用 launchctl：冒烟环境里拿到的应该是假命令。
try { execFileSync("launchctl", ["bootout", "gui/0/com.example.hindsight"], { stdio: "ignore" }); } catch {}
const bin = mode === "wrong-name" ? join(runtime, "bin", "other-node") : process.execPath;
const daemon = spawn(bin, [join(runtime, "apps", "daemon", "dist", "daemon.mjs")], { stdio: "inherit" });
writeFileSync(join(runtime, "pids.json"), JSON.stringify({ supervisor: process.pid, daemon: daemon.pid }));
writeFileSync(join(data, "supervisor-state.json"), JSON.stringify({ daemonPid: daemon.pid }));
// 和真的 supervisor 一样：SIGTERM 时先停 daemon，再退出。
process.on("SIGTERM", () => {
  daemon.once("exit", () => process.exit(0));
  daemon.kill("SIGTERM");
});
setInterval(() => {}, 1_000);
`;

const FAKE_DAEMON = `
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const runtime = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const mode = readFileSync(join(runtime, "mode"), "utf8").trim();
const server = createServer((socket) => {
  socket.setEncoding("utf8");
  socket.on("data", (line) => {
    const command = JSON.parse(line.trim());
    if (command.type === "status" && mode !== "silent") {
      socket.end(JSON.stringify({ type: "response", id: command.id, success: true, data: { pid: process.pid } }) + "\\n");
    }
  });
});
server.listen(join(process.env.PLC_DATA_DIR, "plc.sock"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

function write(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function linkNode(target: string): void {
  try { linkSync(process.execPath, target); } catch { copyFileSync(process.execPath, target); chmodSync(target, 0o755); }
}

// 有的沙箱不允许监听 Unix socket（listen EPERM，例如 PLC 的执行器）。那里跳过要起 socket 的用例。
async function canListenOnUnixSocket(): Promise<boolean> {
  const path = join(tempDir("plc-dsm-probe-"), "p.sock");
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(path, () => server.close(() => resolve(true)));
  });
}
const sockets = await canListenOnUnixSocket();

let runtime: string;

beforeAll(() => {
  runtime = tempDir("plc-dsm-rt-");
  mkdirSync(join(runtime, "bin"), { recursive: true });
  linkNode(join(runtime, "bin", "lead-agent"));
  linkNode(join(runtime, "bin", "other-node"));
  write(join(runtime, "bin", "plc"), PLC_WRAPPER);
  chmodSync(join(runtime, "bin", "plc"), 0o755);
  write(join(runtime, "release.json"), JSON.stringify({ product: "bytezard-lead", version: "1.3.0" }));
  write(join(runtime, "apps/cli/dist/cli.mjs"), "if (!process.argv.includes('--help')) process.exit(3); console.log('Usage: plc');\n");
  write(join(runtime, "apps/daemon/dist/supervisor.mjs"), FAKE_SUPERVISOR);
  write(join(runtime, "apps/daemon/dist/daemon.mjs"), FAKE_DAEMON);
  write(join(runtime, "node_modules/fake-pi/cli.js"), "#!/usr/bin/env node\nconsole.log('1.1.0');\n");
  mkdirSync(join(runtime, "node_modules/.bin"), { recursive: true });
  symlinkSync("../fake-pi/cli.js", join(runtime, "node_modules/.bin/pi"));
});

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const savedDev = process.env.PLC_DEV;
afterEach(() => {
  if (savedDev === undefined) delete process.env.PLC_DEV;
  else process.env.PLC_DEV = savedDev;
  // 失败的用例也不能留下假的 supervisor 和 daemon。
  if (existsSync(join(runtime, "pids.json"))) {
    for (const pid of Object.values(JSON.parse(readFileSync(join(runtime, "pids.json"), "utf8")) as number[])) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }
});

describe("smokeEnv", () => {
  it("drops the caller's PLC_* variables, isolates HOME and the data dir, and puts the stubs first on PATH", () => {
    const env = smokeEnv(
      { PATH: `/usr/bin${delimiter}/bin`, HOME: "/Users/alice", PLC_DEV: "1", PLC_GATEWAY_PORT: "47130", NODE_OPTIONS: "--import tsx", LANG: "en_US.UTF-8" },
      { home: "/tmp/s/home", dataDir: "/tmp/s/data", stubBin: "/tmp/s/stub-bin", stubLog: "/tmp/s/stub.log" },
    );
    expect(env).toMatchObject({
      HOME: "/tmp/s/home", PLC_DATA_DIR: "/tmp/s/data", PLC_GATEWAY_PORT: "0", PLC_DESKTOP_NOTIFY: "off", PLC_OPEN_FILES: "off",
      PLC_MEMORY_BACKEND: "sqlite", LANG: "en_US.UTF-8", PATH: `/tmp/s/stub-bin${delimiter}/usr/bin${delimiter}/bin`,
    });
    expect(env.PLC_DEV).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("reads process names from ps and writes stubs that only record their arguments", () => {
    expect(commandName("/Users/alice/Library/Application Support/Bytezard Lead/runtime/current/bin/lead-agent\n")).toBe("lead-agent");
    expect(commandName("lead-agent\n")).toBe("lead-agent");
    expect(stubScript("launchctl", 1)).toBe(`#!/bin/sh\nprintf '%s %s\\n' launchctl "$*" >> "$PLC_SMOKE_STUB_LOG"\nexit 1\n`);
  });
});

describe("smokeRuntime", () => {
  it.skipIf(!sockets)("starts the supervisor, waits for status on plc.sock, checks both process names and stops both", async () => {
    write(join(runtime, "mode"), "ok");
    process.env.PLC_DEV = "1";
    const result = await smokeRuntime({ runtimeDir: runtime, workDir: tempDir("plc-dsm-") });
    expect(result).toMatchObject({ ok: true, version: "1.3.0", piVersion: "1.1.0", processNames: { supervisor: "lead-agent", daemon: "lead-agent" } });
    const pids = JSON.parse(readFileSync(join(runtime, "pids.json"), "utf8")) as { supervisor: number; daemon: number };
    expect(result.supervisorPid).toBe(pids.supervisor);
    expect(result.daemonPid).toBe(pids.daemon);
    expect(alive(pids.supervisor)).toBe(false);
    expect(alive(pids.daemon)).toBe(false);
    // launchctl 被假命令接住了；HOME 和数据目录是临时的；调用者的 PLC_DEV 没有传进去。
    expect(result.stubCalls).toEqual(["launchctl bootout gui/0/com.example.hindsight"]);
    const seen = JSON.parse(readFileSync(join(runtime, "seen-env.json"), "utf8"));
    expect(seen.HOME).not.toBe(homedir());
    expect(seen.HOME).toMatch(/bl-smoke-.*\/home$/);
    expect(seen.PLC_DATA_DIR).toMatch(/bl-smoke-.*\/data$/);
    expect(seen.PLC_DEV).toBeNull();
    expect(seen.PLC_MEMORY_BACKEND).toBe("sqlite");
    expect(existsSync(dirname(seen.HOME))).toBe(false);
  });

  it.skipIf(!sockets)("fails when the daemon process is not called lead-agent, and stops it anyway", async () => {
    write(join(runtime, "mode"), "wrong-name");
    await expect(smokeRuntime({ runtimeDir: runtime, workDir: tempDir("plc-dsm-") })).rejects.toThrow(/daemon 的进程名是 other-node，不是 lead-agent/);
    const pids = JSON.parse(readFileSync(join(runtime, "pids.json"), "utf8")) as { supervisor: number; daemon: number };
    await expect.poll(() => alive(pids.supervisor) || alive(pids.daemon), { timeout: 5_000 }).toBe(false);
  });

  it.skipIf(!sockets)("fails with the supervisor output when plc.sock never answers status in time", async () => {
    write(join(runtime, "mode"), "silent");
    await expect(smokeRuntime({ runtimeDir: runtime, workDir: tempDir("plc-dsm-"), timeoutMs: 1_500 }))
      .rejects.toThrow(/2 秒内没有等到 plc\.sock 回答 status[\s\S]*supervisor 输出/);
    const pids = JSON.parse(readFileSync(join(runtime, "pids.json"), "utf8")) as { supervisor: number; daemon: number };
    await expect.poll(() => alive(pids.supervisor) || alive(pids.daemon), { timeout: 5_000 }).toBe(false);
  });

  it("refuses a directory that is not a runtime bundle", async () => {
    await expect(smokeRuntime({ runtimeDir: tempDir("plc-dsm-") })).rejects.toThrow(/不是运行包：没有 release\.json/);
  });
});
