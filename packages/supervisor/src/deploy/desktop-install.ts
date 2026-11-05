// 桌面版的一条命令安装（docs/desktop/macos-desktop-design.md 第 4.2 节第 3–7 步，P0-3）。App 解出运行包、切好 current 以后运行
// `current/bin/lead-agent current/apps/daemon/dist/ops.mjs desktop-install --root <安装根>/current`，这里做剩下的事：
//   preflight         运行包在安装根的 current 下面，release.json 和文件哈希对得上，socket 路径不超过 macOS 的上限
//   detect            看已有的是哪种安装（第 12.2 节）；库比运行包新时不装
//   takeover          自动接管存量安装（第 12 节）：改名以前的安装、跑开发 checkout 的安装、换了版本的安装。
//                     复用 data-dir-migration.ts，失败自动回滚。设了 PLC_KEEP_DEV_INSTALL=1 时保留开发安装、直接打开它。
//                     换了版本时按更新的种类（update-kind.ts，第 7.5.2 节）：服务没变（none、web）不重启、不备份
//   login_shell_path  读登录 shell 的 PATH，写进 <数据目录>/login-shell-path.json
//   launchd           写 plist，launchctl bootstrap gui/<uid>
//   supervisor        等 supervisor.sock 能回答（60 秒）
//   daemon            发 ensure_running，等 plc.sock 回答 status（120 秒），拿到 gatewayUrl
// 每一步按行输出 JSON（{step, state, message}，失败时带 code），同时写进 <安装根>/install-state.json。
// 每一步都可以重做：重复运行时 plist 没变、服务在跑，就不再 bootout，所以只有一个 supervisor。
// 同时只跑一个：<安装根>/install.lock 里写着正在安装的进程（第 12.6 节）。
// 发布模式不检查 AM_API_KEY：那是开发环境的要求（ops 的 install）。
// 有副作用的部分（launchctl、两个 socket、登录 shell）由调用方注入，单元测试换成假的。路径只用参数数组传给子进程。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { holdsOnlyAppEntries, saveLoginShellPath, type LoginShellPathResult } from "@pi-lead-child/core";
import type { Locale } from "@pi-lead-child/protocol";
import { daemonReadyTimeoutMs, SUPERVISOR_REQUEST_TIMEOUT } from "../client.js";
import {
  runDataDirMigration, type DataDirMigrationCode, type DataDirMigrationDeps, type DataDirMigrationEvent, type DataDirMigrationResult,
} from "./data-dir-migration.js";
import { desktopInstallMessages } from "./desktop-install.messages.js";
import { desktopPlistOptions, plistContent, plistWorkingDirectory } from "./launchd.js";
import { databaseSchemaVersion, readReleaseManifest, RELEASE_MANIFEST_FILE, releaseReadiness } from "./release.js";
import { pruneRuntimeVersions, pruneSharedNodeModules } from "./runtime-versions.js";
import { restartsService, updateKind, type UpdateKind } from "./update-kind.js";

export const DESKTOP_INSTALL_STEPS = [
  "preflight", "detect", "takeover", "login_shell_path", "launchd", "supervisor", "daemon", "done",
] as const;
export type DesktopInstallStep = typeof DESKTOP_INSTALL_STEPS[number];
export type DesktopInstallState = "running" | "done" | "skipped" | "failed";
export type DesktopInstallCode =
  | "root_invalid" | "release_invalid" | "socket_path_too_long"
  | "install_running" | "schema_ahead" | "dev_install_detected"
  | "takeover_refused" | "takeover_failed" | "takeover_rolled_back" | "takeover_rollback_failed"
  | "login_shell_path_unavailable" | "launchd_unchanged"
  | "launchd_bootstrap_failed" | "supervisor_timeout" | "daemon_refused" | "daemon_timeout"
  | "disk_full" | "unexpected";

export interface DesktopInstallEvent {
  step: DesktopInstallStep;
  state: DesktopInstallState;
  message: string;
  code?: DesktopInstallCode;
  gatewayUrl?: string;
  /** takeover 这一步里迁移模块正在做的那一步（安装页不用它，给诊断看）。 */
  phase?: DataDirMigrationEvent["step"];
  /** detect：已有的是哪种安装。安装页按它选「接手」一行的文字（第 7.5.2 节）。 */
  takeover?: TakeoverCase["kind"];
  /** detect：换了版本时是哪种更新。 */
  update?: UpdateKind;
}

/** 已有的是哪种安装（第 12.2 节）。 */
export type TakeoverCase =
  | { kind: "pre_rename"; oldDir: string }
  | { kind: "dev" }
  | { kind: "upgrade"; from: string; to: string };

export const INSTALL_STATE_FILE = "install-state.json";
export const INSTALL_LOCK_FILE = "install.lock";
/** 开发者保持开发安装的开关（第 12.8 节）。缺省没有。 */
export const KEEP_DEV_INSTALL_ENV = "PLC_KEEP_DEV_INSTALL";
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
  /** 改名以前的数据目录（~/.pi-lead-child）。数据目录不是缺省位置时为 null：不接管改名以前的安装。 */
  preRenameDataDir: string | null;
  /** PLC_KEEP_DEV_INSTALL=1：不接管改名以前的安装和开发安装，直接打开在跑的那份（第 12.8 节）。 */
  keepDevInstall?: boolean;
  /** 接管用的迁移模块（data-dir-migration.ts）要的 launchctl、排空、等进程退出和健康检查。 */
  takeover: Pick<
    DataDirMigrationDeps,
    "launchAgentsDir" | "uid" | "launchctl" | "freeBytes" | "drain" | "waitStopped" | "health" | "afterStep" | "backupDatabase"
  >;
  /** 进程还活着（install.lock 用）。缺省用 process.kill(pid, 0)。 */
  processAlive?(pid: number): boolean;
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
    /** dataDir（缺省是安装的数据目录）的 plc.sock 回答 status 时返回它的 gatewayUrl；超过 timeoutMs 为 null。 */
    waitForStatus(timeoutMs: number, dataDir?: string): Promise<{ gatewayUrl: string } | null>;
  };
  /** daemon 步骤等 plc.sock 回答的期限。缺省和 supervisor 等 daemon 就绪的期限一样（daemonReadyTimeoutMs，10 分钟）。 */
  daemonWaitMs?: number;
  /** 删旧版本前看哪些版本还有进程在用（runtime-versions.ts）。缺省读 ps。 */
  runningCommands?(): string[];
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
  /** 上次装好的运行包版本（release.json 的 version）。和这次不同就是换了版本（第 12.5 节）。 */
  installedVersion?: string;
  /** installedVersion 之前装的版本：回滚要用，删旧版本时留着它（runtime-versions.ts）。 */
  previousVersion?: string;
  /**
   * 后台服务跑在哪个版本上：服务没变的更新不重启（第 7.5.2 节），服务就还在更早的版本目录里。删旧版本时留着它。
   * 没有这一项时（更早的 install-state.json）就是 installedVersion：那时每次换版本都重启。
   */
  serviceVersion?: string;
  /** 上一次换版本是哪种更新（诊断用）。 */
  lastUpdate?: UpdateKind;
  /** 这次装好以后删掉的旧版本（诊断用）。 */
  prunedVersions?: string[];
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
 * 已有的 plist 指向什么。dev：WorkingDirectory 里有 .git、没有 release.json，是开发安装（第 12.4 节接管它）。
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

/** 上一次 desktop-install 写的状态。没有或读不了时为 null。 */
function readInstallState(path: string): Partial<InstallState> | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value && typeof value === "object" ? value as Partial<InstallState> : null;
  } catch {
    return null;
  }
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/** 拿 install.lock：拿到时返回释放它的函数；别的 desktop-install 还活着时返回 null。前一个进程已经退出时接着做。 */
function acquireInstallLock(installRoot: string, alive: (pid: number) => boolean): (() => void) | null {
  const lock = join(installRoot, INSTALL_LOCK_FILE);
  mkdirSync(installRoot, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
      return () => rmSync(lock, { force: true });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const holder = Number.parseInt(readFileSync(lock, "utf8"), 10);
      if (Number.isSafeInteger(holder) && holder > 0 && holder !== process.pid && alive(holder)) return null;
      rmSync(lock, { force: true });
    }
  }
  return null;
}

/**
 * 已有的是哪种安装，要不要接管（第 12.2 节）。按顺序：改名以前的安装、跑开发 checkout 的安装、换了版本的安装。
 * 都不是时为 null：新机器，或者再装一次同一个版本。
 */
export function detectTakeover(o: {
  root: string; dataDir: string; plistPath: string; preRenamePlistPaths: string[]; preRenameDataDir: string | null;
  installedVersion: string | undefined; version: string;
}): TakeoverCase | null {
  const old = o.preRenameDataDir;
  if (old && (o.preRenamePlistPaths.some((path) => existsSync(path)) || (existsSync(old) && holdsOnlyAppEntries(o.dataDir)))) {
    return { kind: "pre_rename", oldDir: old };
  }
  const kind = existingInstallKind(o.plistPath);
  if (kind === "dev") return { kind: "dev" };
  if (kind === "other" && o.installedVersion && o.installedVersion !== o.version
    && plistPointsAt(o.plistPath, o.root) && existsSync(join(dirname(o.root), "versions", o.installedVersion))) {
    return { kind: "upgrade", from: o.installedVersion, to: o.version };
  }
  return null;
}

function plistPointsAt(plistPath: string, root: string): boolean {
  try {
    const cwd = plistWorkingDirectory(readFileSync(plistPath, "utf8"));
    return cwd !== null && resolve(cwd) === resolve(root);
  } catch {
    return false;
  }
}

// 迁移模块的预检没过：安装页的话。什么都没改。
const REFUSED: Partial<Record<DataDirMigrationCode, keyof ReturnType<typeof desktopInstallMessages>["takeover"]["refused"]>> = {
  target_not_empty: "targetNotEmpty",
  not_same_volume: "notSameVolume",
  disk_space: "diskSpace",
  socket_path_too_long: "socketPathTooLong",
  schema_ahead: "schemaAhead",
  schema_behind: "other",
  legacy_service_missing: "other",
};

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

export async function runDesktopInstall(deps: DesktopInstallDeps): Promise<DesktopInstallResult> {
  const m = desktopInstallMessages(deps.locale);
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const statePath = join(deps.installRoot, INSTALL_STATE_FILE);
  const previousState = readInstallState(statePath);
  const state: InstallState = {
    version: 1, root: deps.root, startedAt: now(), updatedAt: now(), outcome: "running", steps: {}, lastError: null,
    ...(typeof previousState?.installedVersion === "string" ? { installedVersion: previousState.installedVersion } : {}),
    ...(typeof previousState?.previousVersion === "string" ? { previousVersion: previousState.previousVersion } : {}),
    ...(typeof previousState?.serviceVersion === "string" ? { serviceVersion: previousState.serviceVersion } : {}),
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
  let releaseLock: (() => void) | null = null;
  try {
    // ── preflight ──
    emit({ step, state: "running", message: m.preflight.running });
    releaseLock = acquireInstallLock(deps.installRoot, deps.processAlive ?? defaultProcessAlive);
    if (!releaseLock) throw new StepFailure("install_running", m.errors.installRunning);
    const root = resolve(deps.root);
    if (!isAbsolute(deps.root) || basename(root) !== "current" || dirname(root) !== resolve(deps.installRoot)) {
      throw new StepFailure("root_invalid", m.errors.rootInvalid(deps.root));
    }
    // 库的版本在 detect 里看：库在哪个目录要先认出是哪种安装。这里只看运行包本身。
    const readiness = releaseReadiness(root, deps.installRoot, null);
    if (!readiness.ready) throw new StepFailure("release_invalid", m.errors.releaseInvalid(readiness.reasons.join(" ")));
    const manifest = readReleaseManifest(root);
    const tooLong = socketPathTooLong(deps.dataDir);
    if (tooLong) {
      throw new StepFailure("socket_path_too_long", m.errors.socketPathTooLong(tooLong.path, tooLong.bytes, MAX_SOCKET_PATH_BYTES));
    }
    emit({ step, state: "done", message: m.preflight.done });

    // ── detect ──
    step = "detect";
    emit({ step, state: "running", message: m.detect.running });
    const found = detectTakeover({
      root, dataDir: deps.dataDir, plistPath: deps.plistPath, preRenamePlistPaths: deps.preRenamePlistPaths,
      preRenameDataDir: deps.preRenameDataDir, installedVersion: state.installedVersion, version: manifest.version,
    });
    // 数据所在的目录：改名以前的安装还在旧目录里。
    const liveDataDir = found?.kind === "pre_rename" ? found.oldDir : deps.dataDir;
    if (found && found.kind !== "upgrade" && deps.keepDevInstall) {
      emit({ step, state: "done", code: "dev_install_detected", message: m.detect.devInstall });
      // 开发者要保持开发安装：不写 plist，不重启。在跑的话把它的地址交给 App 打开。
      step = "done";
      const status = await deps.daemon.waitForStatus(3_000, liveDataDir);
      emit({ step, state: "done", code: "dev_install_detected", message: m.detect.devInstall, ...(status ? { gatewayUrl: status.gatewayUrl } : {}) });
      return finish({ ok: true, outcome: "dev_install", code: "dev_install_detected", ...(status ? { gatewayUrl: status.gatewayUrl } : {}) });
    }
    // 库比运行包新：新代码打不开旧版本，什么都不改（第 12.3 节）。
    const dbVersion = databaseSchemaVersion(join(liveDataDir, "plc.db"));
    if (dbVersion !== null && dbVersion > manifest.schemaVersion) {
      throw new StepFailure("schema_ahead", m.errors.schemaAhead(dbVersion, manifest.schemaVersion));
    }
    // 换了版本：按两个版本的 release.json 定是哪种更新。库还没升级到这个版本时一定要重启，让新代码升级它。
    let update: UpdateKind | undefined;
    if (found?.kind === "upgrade") {
      update = updateKind(previousManifest(deps.installRoot, found.from), manifest);
      if (!restartsService(update) && dbVersion !== null && dbVersion !== manifest.schemaVersion) update = "schema";
      state.lastUpdate = update;
    }
    const restart = found !== null && (update === undefined || restartsService(update));
    emit({
      step, state: "done",
      message: !found ? m.detect.done
        : found.kind === "pre_rename" ? m.detect.preRename
        : found.kind === "dev" ? m.detect.dev
        : restart ? m.detect.upgrade(found.from, found.to)
        : m.detect.upgradeKeepsService(found.from, found.to),
      ...(found ? { takeover: found.kind } : {}),
      ...(update ? { update } : {}),
    });

    // ── takeover ──
    step = "takeover";
    // 这一次（重新）启动了后台服务：接管或者换版本重启过，或者 launchd 一步重新加载了任务。
    let restarted = false;
    if (!found) {
      emit({ step, state: "skipped", message: m.takeover.notNeeded });
    } else if (!restart) {
      emit({ step, state: "skipped", message: m.takeover.keepsRunning });
    } else {
      const upgrading = found.kind === "upgrade";
      emit({ step, state: "running", message: upgrading ? m.upgrade.starting : m.takeover.starting });
      const result = await takeOver(deps, found, root, (event) => emit(event));
      if (!result.ok) throw takeoverFailure(m, result, upgrading);
      restarted = true;
      emit({ step, state: "done", message: upgrading ? m.upgrade.done(manifest.version) : m.takeover.done });
    }

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
      restarted = true;
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

    // 服务跑在哪个版本上：这次重启过就是这个版本；没重启时沿用记着的（更早的记录里没有时，就是上次装好的版本）。
    const serviceVersion = restarted ? manifest.version : state.serviceVersion ?? state.installedVersion ?? manifest.version;
    state.serviceVersion = serviceVersion;
    // 只留这次的、上一个和服务正在用的运行包版本（runtime-versions.ts）。换了版本时，上一个就是上次装好的；再装一次同一个
    // 版本时沿用记着的。不知道上一个是哪个（第一次安装、更早的 install-state.json）时不删：分不清哪个是回滚要用的。
    const previousVersion = state.installedVersion && state.installedVersion !== manifest.version ? state.installedVersion : state.previousVersion;
    if (previousVersion) {
      state.previousVersion = previousVersion;
      const pruned = pruneRuntimeVersions({
        versionsDir: join(deps.installRoot, "versions"),
        keep: [manifest.version, previousVersion, serviceVersion],
        ...(deps.runningCommands ? { runningCommands: deps.runningCommands } : {}),
      });
      if (pruned.removed.length) state.prunedVersions = pruned.removed;
    }
    // 共用的 node_modules（第 7.5.4 节）：没有版本再指向的删掉。
    pruneSharedNodeModules(deps.installRoot);

    step = "done";
    state.installedVersion = manifest.version;
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
  } finally {
    releaseLock?.();
  }
}

/** 用迁移模块接管（第 12.3–12.5 节）。迁移模块每一步的进度换成安装页的话，作为 takeover 这一步的进度发出去。 */
async function takeOver(
  deps: DesktopInstallDeps, found: TakeoverCase, root: string, emit: (event: DesktopInstallEvent) => void,
): Promise<DataDirMigrationResult> {
  const m = desktopInstallMessages(deps.locale);
  return runDataDirMigration({
    ...deps.takeover,
    oldDir: found.kind === "pre_rename" ? found.oldDir : deps.dataDir,
    newDir: deps.dataDir,
    service: { kind: "desktop", root, ...(found.kind === "upgrade" ? { previousVersion: found.from } : {}) },
    locale: deps.locale,
    now: deps.now,
    emit: (event) => {
      if (event.state === "running") emit({ step: "takeover", state: "running", phase: event.step, message: m.takeover.phases[event.step] });
      else if (event.state === "rollback") emit({ step: "takeover", state: "running", phase: event.step, message: m.takeover.rollingBack });
    },
  });
}

function takeoverFailure(m: ReturnType<typeof desktopInstallMessages>, result: DataDirMigrationResult, upgrading: boolean): StepFailure {
  const reason = result.error ?? result.code ?? "";
  // 换版本不是接管：失败时说「没能换到新版本」（第 7.5.2 节）。
  const t = upgrading ? m.upgrade : m.takeover;
  if (result.code === "rolled_back") return new StepFailure("takeover_rolled_back", t.rolledBack(reason), reason);
  if (result.code === "rollback_failed") {
    return new StepFailure("takeover_rollback_failed", t.rollbackFailed(reason, result.backupPath ?? "-"), reason);
  }
  const refused = result.code ? REFUSED[result.code] : undefined;
  if (refused && !(upgrading && refused === "other")) return new StepFailure("takeover_refused", m.takeover.refused[refused], reason);
  return new StepFailure(refused ? "takeover_refused" : "takeover_failed", t.failed(reason), reason);
}

/** 上次装好的版本的 release.json。读不了时为 null：按服务变了处理（update-kind.ts）。 */
function previousManifest(installRoot: string, version: string) {
  try {
    return readReleaseManifest(join(installRoot, "versions", version));
  } catch {
    return null;
  }
}
