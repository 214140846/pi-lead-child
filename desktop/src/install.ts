// 首次安装和再次打开（docs/desktop/macos-desktop-design.md 第 4.2 节）。壳只做第 1、2 步（移到「应用程序」、解出运行包），
// 其余交给运行包里的 `ops.mjs desktop-install`，按它每行一个 JSON 的进度更新安装页。
//
//   再次打开：运行包不比已装的新，并且 plc.sock 回答 status → 直接打开网关，不重新安装。
//            顺手在后台重新读一次登录 shell 的 PATH（设计第 5.1 节：安装时和每次打开 App 时）。
//   首次安装：解包（运行包比已装的新时才解）→ desktop-install → 拿到 gatewayUrl。
//
// 每一步都可以重做：解包从 .partial 从头来，desktop-install 本身是幂等的。所以「重试」就是整个流程再跑一遍。
// 壳自己的步骤失败时也写进 <安装根>/install-state.json（第 4.3 节）；desktop-install 的步骤由它自己写。
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { daemonStatusOver, loopbackGatewayUrl, type DaemonStatus } from "./daemon-status.js";
import type { Locale } from "./locale.js";
import { runtimeCommand, type ShellPaths } from "./paths.js";
import { execFile as realExecFile, spawnLines as realSpawnLines, type ExecFile, type SpawnLines } from "./process.js";
import {
  installedVersion, needsUnpack, unpackRuntime, UnpackError, type BundledRuntime,
} from "./runtime-bundle.js";
import { shellMessages } from "./shell.messages.js";

export const INSTALL_STEPS = ["unpack", "service", "start"] as const;
export type InstallStepId = typeof INSTALL_STEPS[number];
export type InstallStepState = "pending" | "running" | "done" | "skipped" | "failed";

export interface InstallProgress {
  stage: "working" | "failed" | "ready";
  steps: Record<InstallStepId, InstallStepState>;
  /** desktop-install 最近一步的说明（它按 --locale 写好了）。 */
  detail: string | null;
  /** 显示「接下来 macOS 会提示添加了后台项目」：服务还没设置好时。 */
  backgroundNotice: boolean;
  error: { code: string; message: string } | null;
  gatewayUrl: string | null;
}

// desktop-install 的步骤归到安装页的三行里（设计第 4.1 节的样子）。
const OPS_STEP_GROUP: Record<string, InstallStepId> = {
  preflight: "service",
  detect: "service",
  login_shell_path: "service",
  launchd: "service",
  supervisor: "start",
  daemon: "start",
  done: "start",
};

export interface InstallDeps {
  paths: ShellPaths;
  /** App 带的运行包；开发时没有打包产物为 null。 */
  bundled: BundledRuntime | null;
  locale: Locale;
  execFile?: ExecFile;
  spawnLines?: SpawnLines;
  daemonStatus?: DaemonStatus;
  now?(): Date;
}

export interface InstallOptions {
  /** 上一次 desktop-install 说运行包坏了（release_invalid）：这次重新解包，不管版本。 */
  forceUnpack?: boolean;
}

function initialProgress(): InstallProgress {
  return {
    stage: "working",
    steps: { unpack: "pending", service: "pending", start: "pending" },
    detail: null,
    backgroundNotice: false,
    error: null,
    gatewayUrl: null,
  };
}

/** 壳自己的一步失败：记进 install-state.json，和 desktop-install 写的形状一样，App 下次打开和诊断信息都能看到。 */
export function recordShellFailure(paths: Pick<ShellPaths, "installRoot" | "installStateFile">, step: string, code: string, message: string, at: Date): void {
  const time = at.toISOString();
  const state = {
    version: 1,
    root: null,
    startedAt: time,
    updatedAt: time,
    outcome: "failed",
    steps: { [step]: { state: "failed", at: time, message, code } },
    lastError: { step, at: time, code, message },
  };
  try {
    mkdirSync(paths.installRoot, { recursive: true });
    const temp = `${paths.installStateFile}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temp, paths.installStateFile);
  } catch {
    // 写不下（例如磁盘满了）不影响安装页显示错误。
  }
}

interface OpsEvent {
  step: string;
  state: string;
  message: string;
  code?: string;
  gatewayUrl?: string;
}

function parseOpsEvent(line: string): OpsEvent | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (typeof value.step !== "string" || typeof value.state !== "string" || typeof value.message !== "string") return null;
    return {
      step: value.step,
      state: value.state,
      message: value.message,
      ...(typeof value.code === "string" ? { code: value.code } : {}),
      ...(typeof value.gatewayUrl === "string" ? { gatewayUrl: value.gatewayUrl } : {}),
    };
  } catch {
    return null;
  }
}

/** desktop-install 的参数（docs/desktop/runtime-bundle.md「desktop-install 的进度输出」）。--root 正好是 <安装根>/current。 */
export function desktopInstallArgs(paths: Pick<ShellPaths, "current">, locale: Locale): { file: string; args: string[] } {
  const command = runtimeCommand(paths.current);
  return { file: command.node, args: [command.ops, "desktop-install", "--root", paths.current, "--locale", locale, "--progress-json"] };
}

export async function runInstall(deps: InstallDeps, onProgress: (progress: InstallProgress) => void, options: InstallOptions = {}): Promise<InstallProgress> {
  const m = shellMessages(deps.locale);
  const execFile = deps.execFile ?? realExecFile;
  const spawnLines = deps.spawnLines ?? realSpawnLines;
  const daemonStatus = deps.daemonStatus ?? daemonStatusOver(deps.paths.daemonSocket);
  const now = () => deps.now?.() ?? new Date();
  const progress = initialProgress();
  const emit = () => onProgress(structuredClone(progress));
  const fail = (step: InstallStepId, code: string, message: string): InstallProgress => {
    progress.steps[step] = "failed";
    progress.stage = "failed";
    progress.backgroundNotice = false;
    progress.error = { code, message };
    emit();
    return progress;
  };

  const installed = installedVersion(deps.paths);
  const unpack = options.forceUnpack ? deps.bundled !== null : needsUnpack(deps.bundled, installed);

  // ── 再次打开 ──
  if (!unpack) {
    const status = await daemonStatus(3_000);
    if (status) {
      if (installed !== null) {
        const command = runtimeCommand(deps.paths.current);
        void execFile(command.node, [command.ops, "login-shell-path"], { timeoutMs: 30_000 }).catch(() => {});
      }
      for (const step of INSTALL_STEPS) progress.steps[step] = "done";
      progress.stage = "ready";
      progress.gatewayUrl = status.gatewayUrl;
      emit();
      return progress;
    }
    if (installed === null) {
      recordShellFailure(deps.paths, "unpack", "runtime_missing", m.errors.runtimeMissing, now());
      return fail("unpack", "runtime_missing", m.errors.runtimeMissing);
    }
  }

  // ── 解包 ──
  if (unpack && deps.bundled) {
    progress.steps.unpack = "running";
    emit();
    try {
      await unpackRuntime({ bundled: deps.bundled, paths: deps.paths, execFile });
    } catch (error) {
      const code = error instanceof UnpackError ? error.code : "unpack_failed";
      const reason = error instanceof Error ? error.message : String(error);
      const message = code === "disk_full" ? m.errors.diskFull
        : code === "runtime_invalid" ? m.errors.runtimeInvalid(reason)
        : m.errors.unpackFailed(reason);
      recordShellFailure(deps.paths, "unpack", code, message, now());
      return fail("unpack", code, message);
    }
  }
  progress.steps.unpack = "done";

  // ── desktop-install ──
  progress.steps.service = "running";
  progress.backgroundNotice = true;
  emit();
  let failed: OpsEvent | null = null;
  let gatewayUrl: string | null = null;
  let devInstall = false;
  let stderr = "";
  const { file, args } = desktopInstallArgs(deps.paths, deps.locale);
  const child = spawnLines(file, args, (line) => {
    const event = parseOpsEvent(line);
    if (!event) return;
    const group = OPS_STEP_GROUP[event.step];
    if (!group) return;
    progress.detail = event.message;
    if (event.code === "dev_install_detected") devInstall = true;
    if (event.state === "failed") {
      failed = event;
      return;
    }
    if (group === "start") {
      progress.steps.service = "done";
      progress.backgroundNotice = false;
      if (progress.steps.start === "pending") progress.steps.start = "running";
    }
    if (event.step === "launchd" && event.state === "done") progress.backgroundNotice = false;
    if (event.step === "done") gatewayUrl = loopbackGatewayUrl(event.gatewayUrl);
    emit();
  }, (text) => {
    stderr = `${stderr}${text}`.slice(-4_000);
  });
  const exitCode = await child.exitCode;

  const failure = failed as OpsEvent | null;
  if (failure) return fail(OPS_STEP_GROUP[failure.step] ?? "service", failure.code ?? "unexpected", failure.message);
  if (exitCode === 0 && gatewayUrl) {
    progress.steps.service = "done";
    progress.steps.start = "done";
    progress.stage = "ready";
    progress.backgroundNotice = false;
    progress.gatewayUrl = gatewayUrl;
    emit();
    return progress;
  }
  if (exitCode === 0 && devInstall) return fail("start", "dev_not_running", m.errors.devNotRunning);
  const reason = stderr.trim().split("\n").slice(-3).join(" ").trim() || (exitCode === null ? "" : `exit code ${exitCode}`);
  return fail(progress.steps.start === "pending" ? "service" : "start", "unexpected", m.errors.installStopped(reason || m.errors.noReason));
}

/** 「复制诊断信息」：运行包里的 ops.mjs doctor（不输出密钥），再附上 install-state.json。 */
export async function collectDiagnostics(paths: ShellPaths, read: (path: string) => string | null, execFile: ExecFile = realExecFile): Promise<string> {
  const parts: string[] = [];
  const command = runtimeCommand(paths.current);
  try {
    const result = await execFile(command.node, [command.ops, "doctor"], { timeoutMs: 30_000 });
    parts.push(`$ ops.mjs doctor\n${result.stdout}${result.stderr}`.trim());
  } catch (error) {
    const out = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    // doctor 有检查不通过时退出码是 1，输出照样有用。
    parts.push(`$ ops.mjs doctor\n${String(out.stdout ?? "")}${String(out.stderr ?? "")}${out.stdout || out.stderr ? "" : String(out.message ?? "")}`.trim());
  }
  parts.push(`$ cat install-state.json\n${read(paths.installStateFile) ?? "(none)"}`);
  return `${parts.join("\n\n")}\n`;
}
