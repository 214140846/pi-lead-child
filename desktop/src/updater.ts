// App 的一键更新（用户 2026-11-04：每天查一次 GitHub release，有新版时弹一个小卡片，点「更新」直接换成新版并重开，
// 不能破坏以前的数据）。设计第 7 节原来把 App 壳的自动替换放到 P2；用户要求现在就做，所以更新的单位是整个 dmg：
//   1. 检查：打开 App 时距上次检查满 24 小时就查，开着时每小时看一次到没到。请求
//      <仓库>/releases/latest/download/manifest.json（不走 REST API，不受未认证请求的次数限制）。仓库来自已装运行包的
//      release.json 的 updateSource（CI 填的，代码里不写死）。manifest 的版本比这份 App 新、并且列了 dmg 时才算有新版。
//   2. 提示：网页里的更新提示（preload 的 window.bytezardLead.update）。点「以后」：这个版本 24 小时内不再提示。
//   3. 更新：下载 dmg 到 <shell>/updates/，按 manifest 的大小和 SHA-256 校验；hdiutil 只读挂载；把里面的 App 复制到
//      App 所在目录下的隐藏暂存目录；核对版本号、bundle id 和签名；卸载 dmg；两次 rename 换掉 App
//      （旧的先挪进暂存目录，第二次失败时挪回去）；然后重开 App。
//      换掉 App 以前，先把新 App 带的运行包解到 versions/<新版本>/，不换 current（prepareRuntime，设计第 7.5.6 节）：
//      新 App 打开时只要换 current。这一步失败不挡更新，新 App 自己再解。
//   4. 新 App 打开时照常跑安装流程：它带的运行包比装着的新，就解包，desktop-install 按「换了版本」（设计第 12.5 节）
//      和更新的种类（第 7.5.2 节）决定要不要备份、重启，失败自动回滚。数据目录不动。
// 用 Node 写的文件不带 com.apple.quarantine，换上的 App 不会被 Gatekeeper 当成刚下载的（设计第 7.4 节）；保险起见仍去掉一次。
// macOS 按 bundle id 找 App 的图标（通知、Dock）。所以换好 App 以后让 LaunchServices 重新登记它，删暂存目录以前先去掉旧 App
// 的登记（2026-11-05：换了图标以后通知还是 Electron 的图标，LaunchServices 里记着 17 份同一个 bundle id 的 App）。
// 所有子进程都用参数数组，不经 shell（App 的路径里有空格）。
import { createHash } from "node:crypto";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { access, constants, mkdir, mkdtemp, readdir, rename, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ShellPaths } from "./paths.js";
import type { ExecFile } from "./process.js";
import { compareVersions, isRuntimeVersion, RELEASE_PRODUCT, RUNTIME_ARCH } from "./runtime-bundle.js";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 3_600_000;
/** 开着的 App 多久看一次到没到检查的时间。 */
export const UPDATE_TICK_MS = 3_600_000;
/** App 所在目录下的暂存目录名前缀（隐藏，不出现在启动台里）。新 App 打开时删掉。 */
export const UPDATE_STAGING_PREFIX = ".bytezard-lead-update-";
/** 本机验证用：把 manifest 和 dmg 的地址换成这个目录（只收 https，或者本机的 http）。 */
export const UPDATE_URL_ENV = "BYTEZARD_UPDATE_URL";
/** LaunchServices 的登记工具（系统自带）。 */
export const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const DMG_MAX_BYTES = 2 * 1024 ** 3;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MANIFEST_TIMEOUT_MS = 30_000;
// 下载进度最多这么久推一次给网页。
const PROGRESS_INTERVAL_MS = 250;

export interface UpdateAsset {
  file: string;
  size: number;
  sha256: string;
}

export interface AvailableUpdate {
  version: string;
  dmg: UpdateAsset;
}

export type UpdateFailureCode = "download_failed" | "checksum_mismatch" | "mount_failed" | "app_invalid" | "not_writable" | "replace_failed";

// 网页看到的状态（apps/companion 的 data/shellUpdate.ts 照这里写了一份，改一处要改另一处）。
export type ShellUpdateStatus =
  | { state: "none" }
  | { state: "available"; version: string; size: number }
  | { state: "downloading"; version: string; received: number; total: number }
  | { state: "installing"; version: string }
  | { state: "failed"; version: string; code: UpdateFailureCode; detail: string };

/** 一次检查的结果（App 菜单的「检查更新」按它弹对话框）。 */
export type UpdateCheckResult =
  | { kind: "available"; version: string }
  | { kind: "current" }
  // 更新源上没有能用的 manifest（404，或者认不出来）：可能新版还在构建，也可能更新源写错了。不能说成已是最新。
  | { kind: "no_info"; source: string }
  | { kind: "failed"; reason: string }
  | { kind: "no_source" };

interface UpdateState {
  checkedAt: string | null;
  available: AvailableUpdate | null;
  dismissed: { version: string; at: string } | null;
}

const EMPTY_STATE: UpdateState = { checkedAt: null, available: null, dismissed: null };

class UpdateFailure extends Error {
  constructor(readonly code: UpdateFailureCode, message: string) {
    super(message);
  }
}

/** dmg 的文件名：和 release-macos.yml 上传的附件名一样。 */
export function dmgFileName(version: string): string {
  return `${RELEASE_PRODUCT}-${version}-${RUNTIME_ARCH}.dmg`;
}

/**
 * manifest 和 dmg 从哪里取。正常是已装运行包的 release.json 里的仓库的最新 release；没有仓库时不检查。
 * BYTEZARD_UPDATE_URL 只给本机验证：https 地址，或者 127.0.0.1、localhost 上的 http 地址。
 */
export function updateBaseUrl(current: string, env: NodeJS.ProcessEnv): string | null {
  const override = env[UPDATE_URL_ENV];
  if (override) {
    try {
      const url = new URL(override);
      const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
      if (url.protocol !== "https:" && !local) return null;
      return url.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }
  try {
    const release = JSON.parse(readFileSync(join(current, "release.json"), "utf8")) as { updateSource?: { type?: unknown; repository?: unknown } };
    const source = release.updateSource;
    if (source?.type !== "github" || typeof source.repository !== "string" || !REPOSITORY.test(source.repository)) return null;
    return `https://github.com/${source.repository}/releases/latest/download`;
  } catch {
    return null;
  }
}

/** 解析 manifest.json。产品、架构不对，版本号不是 semver，或者没有列 dmg 时为 null。 */
export function parseUpdateManifest(value: unknown): AvailableUpdate | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  if (manifest.product !== RELEASE_PRODUCT || manifest.arch !== RUNTIME_ARCH || !isRuntimeVersion(manifest.version)) return null;
  const dmg = manifest.dmg as Record<string, unknown> | undefined;
  if (!dmg || typeof dmg !== "object") return null;
  if (dmg.file !== dmgFileName(manifest.version)) return null;
  if (typeof dmg.size !== "number" || !Number.isSafeInteger(dmg.size) || dmg.size <= 0 || dmg.size > DMG_MAX_BYTES) return null;
  if (typeof dmg.sha256 !== "string" || !SHA256.test(dmg.sha256)) return null;
  return { version: manifest.version, dmg: { file: dmg.file, size: dmg.size, sha256: dmg.sha256 } };
}

/** 进程的可执行文件所在的 .app（<App>.app/Contents/MacOS/<名字>）。不是 .app 里的程序时为 null。 */
export function appBundleOf(execPath: string): string | null {
  const bundle = dirname(dirname(dirname(execPath)));
  return bundle.endsWith(".app") && dirname(execPath).endsWith(join("Contents", "MacOS")) ? bundle : null;
}

function readState(file: string): UpdateState {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<UpdateState>;
    return {
      checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : null,
      available: parseUpdateManifest(value.available ? { product: RELEASE_PRODUCT, arch: RUNTIME_ARCH, ...value.available } : null),
      dismissed: value.dismissed && typeof value.dismissed.version === "string" && typeof value.dismissed.at === "string"
        ? { version: value.dismissed.version, at: value.dismissed.at }
        : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export interface UpdaterDeps {
  paths: Pick<ShellPaths, "current" | "shellUserData">;
  env: NodeJS.ProcessEnv;
  /** 这份 App 的版本（app.getVersion()）。 */
  currentVersion: string;
  /** 这份 App 的 .app；开发时（没有打包）为 null，这时只检查，不更新。 */
  appBundle: string | null;
  /** 下载用 Electron 的 net.fetch：走系统代理。它也走 Chromium 的 HTTP 缓存，所以每次都带 cache: "no-store"。 */
  fetch: (url: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<Response>;
  execFile: ExecFile;
  /** 换好 App 以后重开（app.relaunch 加 app.exit）。 */
  relaunch(): void;
  onStatus(status: ShellUpdateStatus): void;
  now?(): Date;
  /** 测试换成假的：模拟换 App 的第二次 rename 失败。 */
  rename?(from: string, to: string): Promise<void>;
  /**
   * 换掉 App 以前，把暂存的新 App（.app 的路径）带的运行包解好，不换 current（设计第 7.5.6 节）。返回给日志看的一句话。
   * 没有时不做：新 App 打开时自己解。
   */
  prepareRuntime?(stagedApp: string): Promise<string | null>;
}

export interface Updater {
  status(): ShellUpdateStatus;
  /** 距上次检查满 24 小时才查。 */
  checkIfDue(): Promise<void>;
  /** manual：用户从菜单点的。找到的版本即使点过「以后」也再提示。 */
  check(options?: { manual?: boolean }): Promise<UpdateCheckResult>;
  /** 「以后」：这个版本 24 小时内不再提示。 */
  dismiss(): void;
  /** 「更新」：下载、校验、换掉 App、重开。失败时状态是 failed，可以再点一次。 */
  apply(): Promise<void>;
  /** 新 App 打开时删掉上次更新留下的暂存目录（先去掉旧 App 在 LaunchServices 里的登记）和 dmg。 */
  cleanup(): Promise<void>;
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const now = () => deps.now?.() ?? new Date();
  const move = deps.rename ?? rename;
  const stateFile = join(deps.paths.shellUserData, "update-state.json");
  const updatesDir = join(deps.paths.shellUserData, "updates");
  const logFile = join(deps.paths.shellUserData, "update.log");
  let state = readState(stateFile);
  // 正在下载、安装，或者上一次失败了：盖过 available。
  let working: ShellUpdateStatus | null = null;
  let checking: Promise<UpdateCheckResult> | null = null;

  const log = (line: string) => {
    try {
      mkdirSync(deps.paths.shellUserData, { recursive: true });
      appendFileSync(logFile, `[${now().toISOString()}] ${line}\n`);
    } catch {
      // 写不下日志不影响更新。
    }
  };
  const save = () => {
    try {
      mkdirSync(deps.paths.shellUserData, { recursive: true });
      const temp = `${stateFile}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
      renameSync(temp, stateFile);
    } catch (error) {
      log(`could not save the update state: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const newer = (update: AvailableUpdate | null): update is AvailableUpdate =>
    update !== null && isRuntimeVersion(deps.currentVersion) && compareVersions(update.version, deps.currentVersion) > 0;

  const status = (): ShellUpdateStatus => {
    if (working) return working;
    const update = state.available;
    if (!newer(update)) return { state: "none" };
    const dismissed = state.dismissed;
    if (dismissed?.version === update.version && now().getTime() - Date.parse(dismissed.at) < UPDATE_CHECK_INTERVAL_MS) return { state: "none" };
    return { state: "available", version: update.version, size: update.dmg.size };
  };
  const publish = () => deps.onStatus(status());

  const check = async (options: { manual?: boolean } = {}): Promise<UpdateCheckResult> => {
    checking ??= (async (): Promise<UpdateCheckResult> => {
      const base = updateBaseUrl(deps.paths.current, deps.env);
      if (!base) return { kind: "no_source" };
      try {
        // 不用缓存：2026-11-05 在真的 App 里，发了新版以后 net.fetch 还从缓存里拿到旧的 manifest。
        const response = await deps.fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS), cache: "no-store" });
        // 还没有带附件的 release：不算失败，明天再查。
        const update = response.ok ? parseUpdateManifest(await response.json()) : null;
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
        state = { ...state, checkedAt: now().toISOString(), available: update };
        save();
        log(`checked ${base}: ${update ? `latest ${update.version}` : "no update information"}, this App ${deps.currentVersion}`);
        if (!working) publish();
        if (!update) return { kind: "no_info", source: base };
        return newer(update) ? { kind: "available", version: update.version } : { kind: "current" };
      } catch (error) {
        // 没网、超时：不记检查时间，下一个小时再试。
        const reason = error instanceof Error ? error.message : String(error);
        log(`check failed: ${reason}`);
        return { kind: "failed", reason };
      }
    })().finally(() => {
      checking = null;
    });
    const result = await checking;
    if (options.manual && result.kind === "available" && state.dismissed?.version === result.version) {
      state = { ...state, dismissed: null };
      save();
      if (!working) publish();
    }
    return result;
  };

  const checkIfDue = async () => {
    const last = state.checkedAt ? Date.parse(state.checkedAt) : Number.NaN;
    if (Number.isNaN(last) || now().getTime() - last >= UPDATE_CHECK_INTERVAL_MS) await check();
  };

  // 下载、安装中不能收起；失败了可以（收起以后明天再提示）。
  const dismiss = () => {
    const update = state.available;
    if (!update || (working && working.state !== "failed")) return;
    working = null;
    state = { ...state, dismissed: { version: update.version, at: now().toISOString() } };
    save();
    publish();
  };

  const download = async (url: string, target: string, asset: UpdateAsset, version: string) => {
    let response: Response;
    try {
      response = await deps.fetch(url, { cache: "no-store" });
    } catch (error) {
      throw new UpdateFailure("download_failed", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok || !response.body) throw new UpdateFailure("download_failed", `HTTP ${response.status}`);
    const hash = createHash("sha256");
    const out = createWriteStream(target);
    let received = 0;
    let lastProgress = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > asset.size) throw new UpdateFailure("checksum_mismatch", `more than ${asset.size} bytes`);
        hash.update(value);
        if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", resolve));
        const at = Date.now();
        if (at - lastProgress >= PROGRESS_INTERVAL_MS) {
          lastProgress = at;
          working = { state: "downloading", version, received, total: asset.size };
          publish();
        }
      }
    } catch (error) {
      out.destroy();
      if (error instanceof UpdateFailure) throw error;
      throw new UpdateFailure("download_failed", error instanceof Error ? error.message : String(error));
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    const digest = hash.digest("hex");
    if (received !== asset.size || digest !== asset.sha256) {
      throw new UpdateFailure("checksum_mismatch", `got ${received} bytes, SHA-256 ${digest}`);
    }
  };

  const plistValue = async (app: string, key: string): Promise<string> => {
    const { stdout } = await deps.execFile("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", join(app, "Contents", "Info.plist")], { timeoutMs: 10_000 });
    return stdout.trim();
  };

  // 挂载 dmg，把里面的 App 复制到暂存目录的 new.app，核对以后卸载。返回 new.app 的路径。
  const stageApp = async (dmg: string, staging: string): Promise<string> => {
    const mount = await mkdtemp(join(tmpdir(), "bytezard-lead-dmg-"));
    try {
      try {
        await deps.execFile("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noverify", "-noautoopen", "-mountpoint", mount, dmg], { timeoutMs: 180_000 });
      } catch (error) {
        throw new UpdateFailure("mount_failed", error instanceof Error ? error.message : String(error));
      }
      try {
        const found = (await readdir(mount)).filter((name) => name.endsWith(".app"));
        if (found.length !== 1) throw new UpdateFailure("app_invalid", `the dmg holds ${found.length} apps`);
        const staged = join(staging, "new.app");
        await deps.execFile("/usr/bin/ditto", [join(mount, found[0]!), staged], { timeoutMs: 600_000 });
        return staged;
      } finally {
        await deps.execFile("/usr/bin/hdiutil", ["detach", mount, "-force"], { timeoutMs: 60_000 }).catch((error: unknown) => {
          log(`could not detach ${mount}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    } finally {
      await rm(mount, { recursive: true, force: true }).catch(() => {});
    }
  };

  const verifyApp = async (staged: string, version: string, app: string) => {
    try {
      const [stagedVersion, stagedId, currentId] = await Promise.all([
        plistValue(staged, "CFBundleShortVersionString"),
        plistValue(staged, "CFBundleIdentifier"),
        plistValue(app, "CFBundleIdentifier"),
      ]);
      if (stagedVersion !== version) throw new UpdateFailure("app_invalid", `the App in the dmg is ${stagedVersion}, the release is ${version}`);
      if (stagedId !== currentId) throw new UpdateFailure("app_invalid", `the App in the dmg is ${stagedId}, this App is ${currentId}`);
      await deps.execFile("/usr/bin/codesign", ["--verify", "--deep", staged], { timeoutMs: 120_000 });
    } catch (error) {
      if (error instanceof UpdateFailure) throw error;
      throw new UpdateFailure("app_invalid", error instanceof Error ? error.message : String(error));
    }
    // 去掉隔离属性：没有时 xattr 报错，不算失败。
    await deps.execFile("/usr/bin/xattr", ["-dr", "com.apple.quarantine", staged], { timeoutMs: 60_000 }).catch(() => {});
  };

  // 两次 rename 换掉 App：旧的挪进暂存目录，新的挪到原位。第二次失败时把旧的挪回去。暂存目录和 App 在同一个目录下，rename 是原子的。
  const replaceApp = async (app: string, staged: string, staging: string) => {
    const old = join(staging, "old.app");
    try {
      await move(app, old);
    } catch (error) {
      throw new UpdateFailure("replace_failed", error instanceof Error ? error.message : String(error));
    }
    try {
      await move(staged, app);
    } catch (error) {
      await move(old, app);
      throw new UpdateFailure("replace_failed", error instanceof Error ? error.message : String(error));
    }
  };

  // 换上的 App 的修改时间是打包时的（ditto 保留时间），IconServices 会当它没变、接着用缓存里的旧图标。所以改成现在，
  // 再让 LaunchServices 重新登记它。做不成不算更新失败。
  const registerAgain = async (app: string) => {
    try {
      const at = now();
      await utimes(app, at, at);
      await deps.execFile(LSREGISTER, ["-f", app], { timeoutMs: 30_000 });
    } catch (error) {
      log(`could not register ${app} again: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const apply = async () => {
    const update = state.available;
    if (!newer(update) || (working && working.state !== "failed")) return;
    const app = deps.appBundle;
    const base = updateBaseUrl(deps.paths.current, deps.env);
    const version = update.version;
    let staging: string | null = null;
    try {
      if (!app || !base) throw new UpdateFailure("not_writable", app ? "no update source" : "this App is not an installed copy");
      try {
        await access(dirname(app), constants.W_OK);
      } catch {
        throw new UpdateFailure("not_writable", dirname(app));
      }
      working = { state: "downloading", version, received: 0, total: update.dmg.size };
      publish();
      log(`updating from ${deps.currentVersion} to ${version}`);
      await mkdir(updatesDir, { recursive: true });
      const dmg = join(updatesDir, update.dmg.file);
      await download(`${base}/${update.dmg.file}`, dmg, update.dmg, version);
      working = { state: "installing", version };
      publish();
      staging = join(dirname(app), `${UPDATE_STAGING_PREFIX}${process.pid}`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging);
      const staged = await stageApp(dmg, staging);
      await verifyApp(staged, version, app);
      if (deps.prepareRuntime) {
        const started = Date.now();
        try {
          const note = await deps.prepareRuntime(staged);
          log(`prepared the runtime of ${version} in ${Date.now() - started} ms${note ? `: ${note}` : ""}`);
        } catch (error) {
          log(`could not prepare the runtime of ${version}; the new App unpacks it itself: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await replaceApp(app, staged, staging);
      await registerAgain(app);
      await rm(dmg, { force: true }).catch(() => {});
      log(`replaced the App with ${version}; relaunching`);
      deps.relaunch();
    } catch (error) {
      const failure = error instanceof UpdateFailure ? error : new UpdateFailure("replace_failed", error instanceof Error ? error.message : String(error));
      log(`update to ${version} failed (${failure.code}): ${failure.message}`);
      if (staging) await rm(join(staging, "new.app"), { recursive: true, force: true }).catch(() => {});
      working = { state: "failed", version, code: failure.code, detail: failure.message };
      publish();
    }
  };

  const cleanup = async () => {
    const app = deps.appBundle;
    if (app) {
      try {
        for (const name of readdirSync(dirname(app))) {
          if (!name.startsWith(UPDATE_STAGING_PREFIX)) continue;
          const staging = join(dirname(app), name);
          // 先去掉登记：目录删了以后，LaunchServices 里还记着这份同一个 bundle id、可能是旧图标的 App。
          for (const copy of ["old.app", "new.app"].map((entry) => join(staging, entry)).filter((path) => existsSync(path))) {
            await deps.execFile(LSREGISTER, ["-u", copy], { timeoutMs: 30_000 }).catch((error: unknown) => {
              log(`could not unregister ${copy}: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
          rmSync(staging, { recursive: true, force: true });
        }
      } catch (error) {
        log(`could not remove the old staging folders: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    rmSync(updatesDir, { recursive: true, force: true });
    // 已经是 manifest 里的版本（或者更新）了：不再提示它。
    if (state.available && !newer(state.available)) {
      state = { ...state, available: null };
      save();
    }
  };

  return { status, checkIfDue, check, dismiss, apply, cleanup };
}
