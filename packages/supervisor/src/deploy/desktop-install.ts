// 桌面版的一条命令安装（docs/desktop/macos-desktop-design.md 第 4.2 节第 3–7 步，P0-3）。App 解出运行包、切好 current 以后运行
// `current/bin/lead-agent current/apps/daemon/dist/ops.mjs desktop-install --root <安装根>/current`，这里做剩下的事：
//   preflight         运行包在安装根的 current 下面，release.json 和文件哈希对得上，socket 路径不超过 macOS 的上限
//   detect            已有开发安装（plist 指向 git checkout）就不覆盖；还有改名以前的 plist 就不装
//   login_shell_path  读登录 shell 的 PATH，写进 <数据目录>/login-shell-path.json
//   launchd           写 plist，launchctl bootstrap gui/<uid>
//   supervisor        等 supervisor.sock 能回答（60 秒）
//   daemon            发 ensure_running，等 plc.sock 回答 status（120 秒），拿到 gatewayUrl
// 每一步按行输出 JSON（{step, state, message}，失败时带 code），同时写进 <安装根>/install-state.json。
// 每一步都可以重做：重复运行时 plist 没变、服务在跑，就不再 bootout，所以只有一个 supervisor。
// 发布模式不检查 AM_API_KEY：那是开发环境的要求（ops 的 install）。
// 有副作用的部分（launchctl、两个 socket、登录 shell）由调用方注入，单元测试换成假的。路径只用参数数组传给子进程。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { saveLoginShellPath, type LoginShellPathResult } from "@pi-lead-child/core";
import type { Locale } from "@pi-lead-child/protocol";
import { daemonReadyTimeoutMs, SUPERVISOR_REQUEST_TIMEOUT } from "../client.js";
import { desktopInstallMessages } from "./desktop-install.messages.js";
import { desktopPlistOptions, plistContent, plistWorkingDirectory } from "./launchd.js";
import { RELEASE_MANIFEST_FILE, releaseReadiness } from "./release.js";

export const DESKTOP_INSTALL_STEPS = ["preflight", "detect", "login_shell_path", "launchd", "supervisor", "daemon", "done"] as const;
export type DesktopInstallStep = typeof DESKTOP_INSTALL_STEPS[number];
export type DesktopInstallState = "running" | "done" | "skipped" | "failed";
export type DesktopInstallCode =
  | "root_invalid" | "release_invalid" | "socket_path_too_long"
  | "dev_install_detected" | "legacy_install_detected"
  | "login_shell_path_unavailable" | "launchd_unchanged"
  | "launchd_bootstrap_failed" | "supervisor_timeout" | "daemon_refused" | "daemon_timeout"
  | "disk_full" | "unexpected";

export interface DesktopInstallEvent {
  step: DesktopInstallStep;
  state: DesktopInstallState;
  message: string;
  code?: DesktopInstallCode;
  gatewayUrl?: string;
}

export const INSTALL_STATE_FILE = "install-state.json";
// macOS 的 sun_path 是 104 字节，含结尾的 NUL，所以路径本身最多 103 字节。
export const MAX_SOCKET_PATH_BYTES = 103;
// 数据目录里 listen 的 socket。supervisor.sock 最长，它决定上限。
const DATA_DIR_SOCKETS = ["plc.sock", "supervisor.sock"];
export const SUPERVISOR_WAIT_MS = 60_000;

export interface DesktopInstallDeps {
  /** <安装根>/current，App 传进来的原样路径（plist 写它，不写解开软链接以后的版本目录）。 */
  root: string;
  installRoot: string;
  dataDir: string;
  dbPath: string;
  plistPath: string;
  /** 改名以前的 supervisor plist（launchd.ts 的 preRenamePlistPaths）。 */
  preRenamePlistPaths: string[];
  locale: Locale;
  emit(event: DesktopInstallEvent): void;
  captureLoginShellPath(): Promise<LoginShellPathResult>;
  launchd: {
    /** supervisor 的 launchd 任务已加载。 */
    loaded(): Promise<boolean>;
    /** 停掉正在跑的 supervisor 和 daemon（launchd 管的、自己起的都算），等它们退出。 */
    stopRunning(): Promise<void>;
    /** bootout 再 bootstrap plistPath。失败时抛错。 */
    bootstrap(plistPath: string): Promise<void>;
  };
  supervisor: {
    /**
     * supervisor.sock 上有进程在监听时为 true；超过 timeoutMs 为 false。只看连接能不能建立，不等 status 的回答：
     * 机器忙时 supervisor 回答 status 要几秒，按回答判断会把在跑的服务当成没在跑，再把它停掉重装（client.ts 的 socketListening）。
     */
    waitUntilAvailable(timeoutMs: number): Promise<boolean>;
    /**
     * ensure_running。被拒绝或失败时抛错，message 是给人看的原因。等得比 supervisor 等 daemon 的期限还久时，
     * 抛 code 为 SUPERVISOR_REQUEST_TIMEOUT 的错（ops 用 ensureRunningTimeoutMs）。
     */
    ensureRunning(): Promise<void>;
  };
  daemon: {
    /** plc.sock 回答 status 时返回它的 gatewayUrl；超过 timeoutMs 为 null。 */
    waitForStatus(timeoutMs: number): Promise<{ gatewayUrl: string } | null>;
  };
  /** daemon 步骤等 plc.sock 回答的期限。缺省和 supervisor 等 daemon 就绪的期限一样（daemonReadyTimeoutMs，10 分钟）。 */
  daemonWaitMs?: number;
  now?(): Date;
}

export interface DesktopInstallResult {
  ok: boolean;
  outcome: "installed" | "dev_install" | "failed";
  gatewayUrl?: string;
  code?: DesktopInstallCode;
}

interface InstallState {
  version: 1;
  root: string;
  startedAt: string;
  updatedAt: string;
  outcome: DesktopInstallResult["outcome"] | "running";
  steps: Partial<Record<DesktopInstallStep, { state: DesktopInstallState; at: string; message: string; code?: DesktopInstallCode }>>;
  lastError: { step: DesktopInstallStep; at: string; code: DesktopInstallCode; message: string; detail?: string } | null;
}

class StepFailure extends Error {
  // detail：给诊断看的原文（例如 launchctl 的输出），只进 install-state.json，不进进度行。
  constructor(readonly code: DesktopInstallCode, message: string, readonly detail?: string) {
    super(message);
  }
}

/** 数据目录里超过上限的 socket 路径（最长的那个）。都不超过时为 null。 */
export function socketPathTooLong(dataDir: string): { path: string; bytes: number } | null {
  const longest = DATA_DIR_SOCKETS.map((name) => join(dataDir, name))
    .map((path) => ({ path, bytes: Buffer.byteLength(path) }))
    .sort((a, b) => b.bytes - a.bytes)[0]!;
  return longest.bytes > MAX_SOCKET_PATH_BYTES ? longest : null;
}

/**
 * 已有的 plist 指向什么。dev：WorkingDirectory 里有 .git、没有 release.json，是开发安装，不覆盖。
 * 不是 plistContent 写的、或者指向别的运行包时为 other：照常覆盖。
 */
export function existingInstallKind(plistPath: string): "none" | "dev" | "other" {
  if (!existsSync(plistPath)) return "none";
  let cwd: string | null;
  try {
    cwd = plistWorkingDirectory(readFileSync(plistPath, "utf8"));
  } catch {
    return "other";
  }
  if (cwd && existsSync(join(cwd, ".git")) && !existsSync(join(cwd, RELEASE_MANIFEST_FILE))) return "dev";
  return "other";
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

export async function runDesktopInstall(deps: DesktopInstallDeps): Promise<DesktopInstallResult> {
  const m = desktopInstallMessages(deps.locale);
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const statePath = join(deps.installRoot, INSTALL_STATE_FILE);
  const state: InstallState = {
    version: 1, root: deps.root, startedAt: now(), updatedAt: now(), outcome: "running", steps: {}, lastError: null,
  };
  // 安装状态写不下（例如磁盘满了）不挡住安装：进度行照样输出，App 靠它显示。
  const saveState = () => {
    try {
      mkdirSync(deps.installRoot, { recursive: true });
      const temp = `${statePath}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
      renameSync(temp, statePath);
    } catch {
      // 见上。
    }
  };
  const emit = (event: DesktopInstallEvent) => {
    const at = now();
    state.updatedAt = at;
    state.steps[event.step] = { state: event.state, at, message: event.message, ...(event.code ? { code: event.code } : {}) };
    if (event.state === "failed" && event.code) state.lastError = { step: event.step, at, code: event.code, message: event.message };
    saveState();
    deps.emit(event);
  };
  const finish = (result: DesktopInstallResult): DesktopInstallResult => {
    state.outcome = result.outcome;
    if (result.ok) state.lastError = null;
    saveState();
    return result;
  };

  let step: DesktopInstallStep = "preflight";
  try {
    // ── preflight ──
    emit({ step, state: "running", message: m.preflight.running });
    const root = resolve(deps.root);
    if (!isAbsolute(deps.root) || basename(root) !== "current" || dirname(root) !== resolve(deps.installRoot)) {
      throw new StepFailure("root_invalid", m.errors.rootInvalid(deps.root));
    }
    const readiness = releaseReadiness(root, deps.installRoot, deps.dbPath);
    if (!readiness.ready) throw new StepFailure("release_invalid", m.errors.releaseInvalid(readiness.reasons.join(" ")));
    const tooLong = socketPathTooLong(deps.dataDir);
    if (tooLong) {
      throw new StepFailure("socket_path_too_long", m.errors.socketPathTooLong(tooLong.path, tooLong.bytes, MAX_SOCKET_PATH_BYTES));
    }
    emit({ step, state: "done", message: m.preflight.done });

    // ── detect ──
    step = "detect";
    emit({ step, state: "running", message: m.detect.running });
    if (existingInstallKind(deps.plistPath) === "dev") {
      emit({ step, state: "done", code: "dev_install_detected", message: m.detect.devInstall });
      // 开发安装由它自己的 checkout 管：不写 plist，不重启。在跑的话把它的地址交给 App 打开。
      step = "done";
      const status = await deps.daemon.waitForStatus(3_000);
      emit({ step, state: "done", code: "dev_install_detected", message: m.detect.devInstall, ...(status ? { gatewayUrl: status.gatewayUrl } : {}) });
      return finish({ ok: true, outcome: "dev_install", code: "dev_install_detected", ...(status ? { gatewayUrl: status.gatewayUrl } : {}) });
    }
    if (deps.preRenamePlistPaths.some((path) => existsSync(path))) {
      throw new StepFailure("legacy_install_detected", m.detect.legacyInstall);
    }
    emit({ step, state: "done", message: m.detect.done });

    // ── login_shell_path ──：读不到不算失败，supervisor 和 daemon 还有已知目录兜底。
    step = "login_shell_path";
    emit({ step, state: "running", message: m.loginShellPath.running });
    const login = await deps.captureLoginShellPath();
    if (login.state === "ok" && saveLoginShellPath(deps.dataDir, login)) {
      emit({ step, state: "done", message: m.loginShellPath.done(login.path.length) });
    } else {
      emit({ step, state: "skipped", code: "login_shell_path_unavailable", message: m.loginShellPath.skipped });
    }

    // ── launchd ──
    step = "launchd";
    emit({ step, state: "running", message: m.launchd.running });
    const logDir = join(deps.dataDir, "logs");
    mkdirSync(logDir, { recursive: true });
    const content = plistContent(desktopPlistOptions(deps.root, logDir));
    const previous = existsSync(deps.plistPath) ? readFileSync(deps.plistPath, "utf8") : null;
    if (previous === content && await deps.launchd.loaded() && await deps.supervisor.waitUntilAvailable(1_000)) {
      emit({ step, state: "done", code: "launchd_unchanged", message: m.launchd.unchanged });
    } else {
      await deps.launchd.stopRunning();
      mkdirSync(dirname(deps.plistPath), { recursive: true });
      writeFileSync(deps.plistPath, content);
      try {
        await deps.launchd.bootstrap(deps.plistPath);
      } catch (error) {
        throw new StepFailure("launchd_bootstrap_failed", m.errors.bootstrapFailed, error instanceof Error ? error.message : String(error));
      }
      emit({ step, state: "done", message: m.launchd.done });
    }

    // ── supervisor ──
    step = "supervisor";
    emit({ step, state: "running", message: m.supervisor.running });
    if (!(await deps.supervisor.waitUntilAvailable(SUPERVISOR_WAIT_MS))) {
      throw new StepFailure("supervisor_timeout", m.errors.supervisorTimeout(SUPERVISOR_WAIT_MS / 1000));
    }
    emit({ step, state: "done", message: m.supervisor.done });

    // ── daemon ──
    step = "daemon";
    emit({ step, state: "running", message: m.daemon.running });
    try {
      await deps.supervisor.ensureRunning();
    } catch (error) {
      // 等过了 supervisor 自己的期限：服务还在启动，不是被拒绝。
      if (errorCode(error) === SUPERVISOR_REQUEST_TIMEOUT) throw new StepFailure("daemon_timeout", m.errors.daemonTimeout);
      throw new StepFailure("daemon_refused", m.errors.daemonRefused(error instanceof Error ? error.message : String(error)));
    }
    const status = await deps.daemon.waitForStatus(deps.daemonWaitMs ?? daemonReadyTimeoutMs());
    if (!status) throw new StepFailure("daemon_timeout", m.errors.daemonTimeout);
    emit({ step, state: "done", message: m.daemon.done });

    step = "done";
    emit({ step, state: "done", message: m.done, gatewayUrl: status.gatewayUrl });
    return finish({ ok: true, outcome: "installed", gatewayUrl: status.gatewayUrl });
  } catch (error) {
    const failure = error instanceof StepFailure ? error
      : errorCode(error) === "ENOSPC" ? new StepFailure("disk_full", m.errors.diskFull)
      : new StepFailure("unexpected", m.errors.unexpected(error instanceof Error ? error.message : String(error)));
    emit({ step, state: "failed", code: failure.code, message: failure.message });
    if (failure.detail && state.lastError) {
      state.lastError.detail = failure.detail;
      saveState();
    }
    return finish({ ok: false, outcome: "failed", code: failure.code });
  }
}
