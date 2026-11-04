// 运行包的冒烟测试（设计文档 P0-2、第 8.1 节）：从运行包启动 supervisor，等 daemon 在 plc.sock 上回答 status，
// 检查两个进程的名字都是 lead-agent，再停掉。另外检查 pi 和 plc 能用运行包自带的 Node 运行。
//
// 隔离：这台机器上可能有用户正在用的服务，冒烟不能碰它们。
// - 数据目录（PLC_DATA_DIR）和 HOME 都是新建的临时目录。daemon 用全新的数据目录启动时，记忆模块会卸载 Hindsight 的
//   launchd 任务并删掉 ~/Library/LaunchAgents 里它的 plist（memory-controller.ts 的 reconcile → stopService）。
//   临时 HOME 让删除落在临时目录里；
// - PATH 最前面放一个假的 launchctl（还有 security、osascript、open），它只记下调用、返回失败。launchctl 的 label 不分数据目录，
//   真的 bootout 会停掉用户的服务。supervisor 和 daemon 都按名字调用这些命令，PATH 里排在系统目录前面的先被找到；
// - 不继承调用者的 PLC_* 变量（例如 PLC_DEV 会让 supervisor 改跑源码）。
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { promisify } from "node:util";
import { PRODUCT, RELEASE_FILE } from "./release.js";

const execFileAsync = promisify(execFile);

export const SMOKE_TIMEOUT_MS = 60_000;
export const PROCESS_NAME = "lead-agent";
// macOS 的 sockaddr_un.sun_path 是 104 字节，含结尾的 0。
export const MAX_SOCKET_PATH_BYTES = 103;
// 假命令：记下参数，返回失败。security 的 44 是「钥匙串里没有这一项」。
export const STUB_COMMANDS: Record<string, number> = { launchctl: 1, security: 44, osascript: 1, open: 1 };

export interface SmokeDirs {
  home: string;
  dataDir: string;
  stubBin: string;
  stubLog: string;
}

/** 冒烟进程的环境：去掉调用者的 PLC_* 和 NODE_OPTIONS，HOME 和数据目录换成临时目录，假命令排在 PATH 最前面。 */
export function smokeEnv(base: NodeJS.ProcessEnv, dirs: SmokeDirs): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith("PLC_") || key === "NODE_OPTIONS") continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: dirs.home,
    PATH: [dirs.stubBin, ...(base.PATH ?? "").split(delimiter).filter(Boolean)].join(delimiter),
    PLC_DATA_DIR: dirs.dataDir,
    PLC_SMOKE_STUB_LOG: dirs.stubLog,
    PLC_GATEWAY_PORT: "0",
    PLC_GATEWAY_HOST: "127.0.0.1",
    PLC_DESKTOP_NOTIFY: "off",
    PLC_OPEN_FILES: "off",
    PLC_MEMORY_BACKEND: "sqlite",
  };
}

export function stubScript(name: string, exitCode: number): string {
  return `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> "$PLC_SMOKE_STUB_LOG"\nexit ${exitCode}\n`;
}

function writeStubs(dirs: SmokeDirs): void {
  mkdirSync(dirs.stubBin, { recursive: true });
  for (const [name, code] of Object.entries(STUB_COMMANDS)) {
    const path = join(dirs.stubBin, name);
    writeFileSync(path, stubScript(name, code));
    chmodSync(path, 0o755);
  }
  writeFileSync(dirs.stubLog, "");
}

/** ps -o comm= 的输出是可执行文件的路径（macOS）或名字（Linux），取最后一段。 */
export function commandName(psOutput: string): string {
  return basename(psOutput.trim());
}

export async function processName(pid: number): Promise<string> {
  const { stdout } = await execFileAsync("ps", ["-o", "comm=", "-p", String(pid)]);
  return commandName(stdout);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(timeoutMs: number, probe: () => Promise<T | null>, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() >= deadline) throw new Error(`${Math.round(timeoutMs / 1000)} 秒内没有等到${what}`);
    await delay(200);
  }
}

/** 在本机 socket 上发一条 JSONL 请求，等对应的回答。连不上或超时返回 null。 */
export function localRequest(sockPath: string, payload: Record<string, unknown>, timeoutMs = 2_000): Promise<{ success: boolean; data?: any; error?: string } | null> {
  return new Promise((resolve) => {
    const id = `smoke-${process.pid}-${Date.now()}`;
    const socket = connect(sockPath);
    let buffer = "";
    const finish = (value: { success: boolean; data?: any; error?: string } | null) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("error", () => finish(null));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message?.type === "response" && (message.id === id || message.id === undefined)) return finish(message);
        } catch { /* 不是 JSON 的行：接着等 */ }
      }
    });
    socket.once("connect", () => socket.write(`${JSON.stringify({ ...payload, id })}\n`));
  });
}

function tail(path: string, lines = 40): string {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function recordedDaemonPid(dataDir: string): number | null {
  try {
    const pid = Number((JSON.parse(readFileSync(join(dataDir, "supervisor-state.json"), "utf8")) as { daemonPid?: unknown }).daemonPid);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export interface SmokeOptions {
  runtimeDir: string;
  // 临时目录建在这里，缺省是系统的临时目录。
  workDir?: string;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface SmokeResult {
  ok: true;
  version: string;
  supervisorPid: number;
  daemonPid: number;
  processNames: { supervisor: string; daemon: string };
  piVersion: string;
  statusAfterMs: number;
  stubCalls: string[];
}

export async function smokeRuntime(o: SmokeOptions): Promise<SmokeResult> {
  const log = o.log ?? (() => {});
  const timeoutMs = o.timeoutMs ?? SMOKE_TIMEOUT_MS;
  const runtime = o.runtimeDir;
  const releasePath = join(runtime, RELEASE_FILE);
  if (!existsSync(releasePath)) throw new Error(`${runtime} 不是运行包：没有 ${RELEASE_FILE}`);
  const release = JSON.parse(readFileSync(releasePath, "utf8")) as { product?: string; version?: string };
  if (release.product !== PRODUCT) throw new Error(`${releasePath} 的 product 是 ${release.product}，不是 ${PRODUCT}`);
  const leadAgent = join(runtime, "bin", PROCESS_NAME);
  const supervisorEntry = join(runtime, "apps", "daemon", "dist", "supervisor.mjs");
  for (const path of [leadAgent, supervisorEntry, join(runtime, "bin", "plc")]) {
    if (!existsSync(path)) throw new Error(`运行包里缺少 ${path}`);
  }

  const work = mkdtempSync(join(o.workDir ?? tmpdir(), "bl-smoke-"));
  const dirs: SmokeDirs = {
    home: join(work, "home"), dataDir: join(work, "data"), stubBin: join(work, "stub-bin"), stubLog: join(work, "stub-calls.log"),
  };
  let supervisor: ChildProcess | null = null;
  let daemonPid: number | null = null;
  let succeeded = false;
  const supervisorLog = join(work, "supervisor.log");
  try {
    mkdirSync(dirs.home, { recursive: true });
    mkdirSync(dirs.dataDir, { recursive: true, mode: 0o700 });
    writeStubs(dirs);
    const supervisorSock = join(dirs.dataDir, "supervisor.sock");
    if (Buffer.byteLength(supervisorSock) > MAX_SOCKET_PATH_BYTES) {
      throw new Error(`临时数据目录的 socket 路径有 ${Buffer.byteLength(supervisorSock)} 字节，超过 ${MAX_SOCKET_PATH_BYTES}：${supervisorSock}。换一个短一点的临时目录`);
    }
    const env = smokeEnv(process.env, dirs);

    // pi 由 daemon 按 node_modules/.bin/pi 找到；它是 #!/usr/bin/env node 的脚本，这里显式用 lead-agent 运行。
    const pi = await execFileAsync(leadAgent, [join(runtime, "node_modules", ".bin", "pi"), "--version"], { cwd: work, env, timeout: 30_000 });
    const piVersion = `${pi.stdout}${pi.stderr}`.match(/\d+\.\d+\.\d+\S*/)?.[0];
    if (!piVersion) throw new Error(`pi --version 没有输出版本号：${pi.stdout}${pi.stderr}`);
    log(`pi --version：${piVersion}`);
    await execFileAsync(join(runtime, "bin", "plc"), ["--help"], { cwd: work, env, timeout: 30_000 });
    log("bin/plc --help 正常退出");

    const started = Date.now();
    const out = openSync(supervisorLog, "a");
    try {
      supervisor = spawn(leadAgent, [supervisorEntry], { cwd: runtime, env, stdio: ["ignore", out, out], detached: true });
    } finally {
      closeSync(out);
    }
    const spawned = supervisor;
    const supervisorPid = spawned.pid;
    if (!supervisorPid) throw new Error("supervisor 没有启动");
    const status = await until(timeoutMs, async () => {
      if (spawned.exitCode !== null || spawned.signalCode !== null) {
        throw new Error(`supervisor 退出了（${spawned.exitCode ?? spawned.signalCode}）`);
      }
      const answer = await localRequest(join(dirs.dataDir, "plc.sock"), { type: "status" });
      return answer?.success ? answer.data as { pid?: number } : null;
    }, " plc.sock 回答 status");
    const statusAfterMs = Date.now() - started;
    daemonPid = Number(status.pid) || null;
    if (!daemonPid) throw new Error(`plc.sock 的 status 没有 pid：${JSON.stringify(status)}`);
    log(`plc.sock 在 ${statusAfterMs} 毫秒后回答了 status（daemon pid ${daemonPid}）`);

    const processNames = { supervisor: await processName(supervisorPid), daemon: await processName(daemonPid) };
    for (const [role, name] of Object.entries(processNames)) {
      if (name !== PROCESS_NAME) throw new Error(`${role} 的进程名是 ${name}，不是 ${PROCESS_NAME}`);
    }
    log(`进程名：supervisor=${processNames.supervisor}，daemon=${processNames.daemon}`);

    // 和 launchd 停服务一样发 SIGTERM：supervisor 先停 daemon，再退出（supervisor/src/main.ts 的 stop）。
    spawned.kill("SIGTERM");
    await until(30_000, async () => (spawned.exitCode !== null || spawned.signalCode !== null ? true : null), " supervisor 退出");
    const stoppedDaemon = daemonPid;
    await until(15_000, async () => (alive(stoppedDaemon) ? null : true), " daemon 退出");
    log("supervisor 和 daemon 都已停止");

    succeeded = true;
    const stubCalls = readFileSync(dirs.stubLog, "utf8").split("\n").filter(Boolean);
    return {
      ok: true, version: release.version ?? "", supervisorPid, daemonPid, processNames, piVersion, statusAfterMs, stubCalls,
    };
  } catch (error) {
    const logs = [`--- supervisor 输出（${supervisorLog}）---`, tail(supervisorLog)];
    const logDir = join(dirs.dataDir, "logs");
    if (existsSync(logDir)) {
      for (const file of readdirSync(logDir)) {
        if (statSync(join(logDir, file)).isFile()) logs.push(`--- ${file} ---`, tail(join(logDir, file)));
      }
    }
    throw new Error(`${(error as Error).message}\n${logs.join("\n")}`);
  } finally {
    // 没有正常停下来的进程：整组杀掉，不留在机器上。
    if (supervisor?.pid && supervisor.exitCode === null && supervisor.signalCode === null) {
      try { process.kill(-supervisor.pid, "SIGKILL"); } catch { /* 已经退出 */ }
    }
    // daemon 没回答 status 时，它的 pid 只记在 supervisor 的状态文件里。
    const leftover = daemonPid ?? recordedDaemonPid(dirs.dataDir);
    if (!succeeded && leftover && alive(leftover)) {
      try { process.kill(leftover, "SIGKILL"); } catch { /* 已经退出 */ }
    }
    rmSync(work, { recursive: true, force: true });
  }
}
