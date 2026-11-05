// App 带的运行包（docs/desktop/macos-desktop-design.md 第 4.2 节第 2 步）。
// App 里放的是 Resources/runtime/bytezard-lead-runtime-<版本>-arm64.tar.gz，就是 P0-2 打出的发布附件，不改名。
// 解包总是先到 versions/<版本>.partial/，release.json 和文件哈希都对得上以后才 rename 成 versions/<版本>/。
// 所以中途退出不会留下半个版本：下次打开时删掉 .partial，从头再解。
// 壳不 import 后端的包，这里把 packages/supervisor/src/deploy/release.ts 里用得上的检查写一份：product、version、arch、
// 路径不走出根目录、files 里每个文件的 SHA-256。
//
// 没变的部分不重写（设计第 7.5.4 节）。先只读出压缩包里的 release.json（打包时放在第一项），按它的 components：
//   node_modules   放在 <安装根>/shared/node_modules/<哈希>/node_modules，版本目录里是指向它的相对软链接。已经有这一份时
//                  只建软链接；别的版本目录里有同样哈希的真目录时用 APFS 克隆复制进去；都没有时从压缩包只解出 node_modules。
//   bin/lead-agent 别的版本的 node 哈希一样时用 APFS 克隆复制（不是 APFS 时退回普通复制）。
// 其余的照旧从压缩包解出。复用的部分对不上 release.json 时，从头整个解一次。旧格式的压缩包（没有 components）整个解。
//
// 最后把 App 的图标设成 bin/lead-agent 的访达图标（setAgentIcon）：「登录项与扩展」里后台项目的图标跟着这个文件走，
// 不设时是通用的 exec 图标（用户 2026-11-05 实测）。设不上不算解包失败。
import { createHash } from "node:crypto";
import { constants, createReadStream, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm, symlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import type { ShellPaths } from "./paths.js";
import type { ExecFile } from "./process.js";

export const RELEASE_PRODUCT = "bytezard-lead";
export const RUNTIME_ARCH = "arm64";
// 和 scripts/desktop/lib/release.ts 同一条规则：版本号会成为目录名，所以只收 semver。
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const ARCHIVE = /^bytezard-lead-runtime-(.+)-arm64\.tar\.gz$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface BundledRuntime {
  version: string;
  tarball: string;
}

export function isRuntimeVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value);
}

/** 比较两个 semver 版本。负数是 a 更旧。预发布版比同号的正式版旧。 */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitVersion(a);
  const [coreB, preB] = splitVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = coreA[i]! - coreB[i]!;
    if (diff) return Math.sign(diff);
  }
  if (!preA.length || !preB.length) return preA.length === preB.length ? 0 : preA.length ? -1 : 1;
  for (let i = 0; i < Math.max(preA.length, preB.length); i += 1) {
    const x = preA[i];
    const y = preB[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return Math.sign(nx - ny);
    } else if (nx !== null) {
      return -1;
    } else if (ny !== null) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function splitVersion(version: string): [number[], string[]] {
  const [core, ...rest] = version.split("-");
  const pre = rest.join("-");
  return [core!.split(".").map(Number), pre ? pre.split(".") : []];
}

/** 目录里最新的运行包。没有目录、没有对得上的文件时为 null。 */
export function findBundledRuntime(dir: string): BundledRuntime | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  const found = names.flatMap((name) => {
    const version = ARCHIVE.exec(name)?.[1];
    return version && isRuntimeVersion(version) ? [{ version, tarball: join(dir, name) }] : [];
  });
  return found.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

/** current 指向的版本。没有 current，或者 release.json 读不了时为 null。 */
export function installedVersion(paths: Pick<ShellPaths, "current">): string | null {
  try {
    const value = JSON.parse(readFileSync(join(paths.current, "release.json"), "utf8")) as { version?: unknown };
    return isRuntimeVersion(value?.version) ? value.version : null;
  } catch {
    return null;
  }
}

/** 还没装过，或者 App 带的运行包比已装的新时才解包。 */
export function needsUnpack(bundled: BundledRuntime | null, installed: string | null): boolean {
  if (!bundled) return false;
  return installed === null || compareVersions(bundled.version, installed) > 0;
}

function unsafeFilePath(path: string): boolean {
  return !path || isAbsolute(path) || path.split(/[\\/]/).some((segment) => segment === ".." || segment === "" || segment === ".");
}

function sha256File(path: string): Promise<string> {
  // 用流，不用 readFileSync：lead-agent 约 100 MB，主进程还要接着画窗口。
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

/** broken：哈希对不上或者缺的文件（files 里的路径）。 */
export type RuntimeCheck = { ok: true } | { ok: false; reason: string; broken?: string[] };

/** 按期望的版本和磁盘上的文件检查解开的运行包的 release.json。 */
export async function verifyRuntime(dir: string, expected: { version: string; arch: string }): Promise<RuntimeCheck> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "release.json"), "utf8")) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: `release.json: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, reason: "release.json is not an object" };
  if (manifest.schema !== 1) return { ok: false, reason: `release.json schema ${JSON.stringify(manifest.schema)} is unknown` };
  if (manifest.product !== RELEASE_PRODUCT) return { ok: false, reason: `release.json product is not ${RELEASE_PRODUCT}` };
  if (manifest.version !== expected.version) {
    return { ok: false, reason: `release.json version ${JSON.stringify(manifest.version)} is not ${expected.version}` };
  }
  if (manifest.arch !== expected.arch) return { ok: false, reason: `release.json arch ${JSON.stringify(manifest.arch)} is not ${expected.arch}` };
  const files = manifest.files;
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.keys(files).length) {
    return { ok: false, reason: "release.json has no files to check" };
  }
  const broken: string[] = [];
  const brokenFiles: string[] = [];
  for (const [file, hash] of Object.entries(files as Record<string, unknown>)) {
    if (unsafeFilePath(file) || typeof hash !== "string" || !SHA256.test(hash)) {
      broken.push(`${file} (bad entry)`);
      continue;
    }
    try {
      if (await sha256File(join(dir, file)) !== hash) {
        broken.push(`${file} (hash does not match)`);
        brokenFiles.push(file);
      }
    } catch {
      broken.push(`${file} (missing)`);
      brokenFiles.push(file);
    }
  }
  return broken.length ? { ok: false, reason: `files do not match release.json: ${broken.join(", ")}`, broken: brokenFiles } : { ok: true };
}

export class UnpackError extends Error {
  constructor(readonly code: "runtime_invalid" | "disk_full" | "unpack_failed", message: string) {
    super(message);
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

/**
 * 把 <安装根>/current 指到 versions/<版本>。先建一个临时名字的软链接，再 rename 覆盖 current：
 * rename 一步换掉旧链接，current 任何时候都在。
 */
export async function switchCurrent(paths: Pick<ShellPaths, "installRoot" | "current">, version: string): Promise<void> {
  const temp = join(paths.installRoot, `.current-${process.pid}-${Date.now()}`);
  await rm(temp, { force: true });
  await symlink(join("versions", version), temp);
  try {
    await rename(temp, paths.current);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export interface UnpackOptions {
  bundled: BundledRuntime;
  paths: Pick<ShellPaths, "installRoot" | "versionsDir" | "current">;
  execFile: ExecFile;
  arch?: string;
  /** false：只解到 versions/<版本>/，不换 current。更新时在换掉 App 以前先解好（设计第 7.5.6 节）。缺省 true。 */
  switchCurrent?: boolean;
  /** App 的图标文件（.icns）。给了时设成 bin/lead-agent 的访达图标；没打包的 App 没有，为 null。 */
  icon?: string | null;
}

/** 这次解包复用了什么（设计第 7.5.4 节）。诊断和测试看它。 */
export interface UnpackResult {
  /** version：这个版本已经解好了，直接用。 */
  version: "reused" | "unpacked";
  /** shared：共用已有的一份；cloned：从别的版本克隆进共用的目录；unpacked：解进共用的目录；in_version：解在版本目录里。 */
  nodeModules: "shared" | "cloned" | "unpacked" | "in_version" | null;
  /** cloned：从别的版本克隆；unpacked：从压缩包解出。 */
  leadAgent: "cloned" | "unpacked" | null;
  /** bin/lead-agent 的图标：set 设上了；failed 没设上（原因在 iconError）；null 没给图标。 */
  icon: "set" | "failed" | null;
  iconError?: string;
}

// 设访达图标：JavaScript for Automation 调 NSWorkspace。脚本是固定的，图标和文件的路径从 argv 传，不拼进脚本。
const SET_ICON_SCRIPT = [
  "function run(argv) {",
  "  ObjC.import(\"AppKit\");",
  "  const image = $.NSImage.alloc.initWithContentsOfFile(argv[0]);",
  "  if (image.isNil()) return \"no image\";",
  "  return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[1], 0) ? \"ok\" : \"refused\";",
  "}",
].join("\n");

/**
 * 把 icon 设成 file 的访达图标（写进 file 的扩展属性，不改文件内容，签名照样对得上）。
 * 「登录项与扩展」里 plist 写的程序（或者它指向的文件）有自定义图标时显示这个图标（用户 2026-11-05 实测）。
 */
export async function setAgentIcon(execFile: ExecFile, icon: string, file: string): Promise<void> {
  const { stdout } = await execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", SET_ICON_SCRIPT, icon, file], { timeoutMs: 30_000 });
  if (stdout.trim() !== "ok") throw new Error(`osascript: ${stdout.trim() || "no answer"}`);
}

/** 共用的 node_modules 的一份（设计第 7.5.4 节）。supervisor 的 runtime-versions.ts 删掉没有版本再指向的项。 */
export function sharedNodeModulesEntry(installRoot: string, hash: string): string {
  return join(installRoot, "shared", "node_modules", hash);
}

type ReusedComponent = "node" | "node_modules";

/** 目录里 release.json 的组成哈希：只留 node、node_modules 两项里形状对的。 */
function componentsOf(dir: string): Partial<Record<ReusedComponent, string>> {
  try {
    const value = (JSON.parse(readFileSync(join(dir, "release.json"), "utf8")) as { components?: Record<string, unknown> }).components;
    const result: Partial<Record<ReusedComponent, string>> = {};
    for (const name of ["node", "node_modules"] as const) {
      const hash = value?.[name];
      if (typeof hash === "string" && SHA256.test(hash)) result[name] = hash;
    }
    return result;
  } catch {
    return {};
  }
}

/** 已经解好的版本里，这个组成的哈希是 hash 的版本目录。current 指的那个排在最前面。 */
function versionsWith(paths: UnpackOptions["paths"], name: ReusedComponent, hash: string, except: string): string[] {
  let names: string[];
  try {
    names = readdirSync(paths.versionsDir).filter((entry) => isRuntimeVersion(entry) && entry !== except);
  } catch {
    return [];
  }
  let current: string | null = null;
  try {
    current = basename(realpathSync(paths.current));
  } catch {
    current = null;
  }
  return names
    .sort((a, b) => Number(b === current) - Number(a === current) || compareVersions(b, a))
    .map((entry) => join(paths.versionsDir, entry))
    .filter((dir) => componentsOf(dir)[name] === hash);
}

function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function tarFailure(error: unknown): UnpackError {
  return errorCode(error) === "ENOSPC" || /No space left/i.test(String((error as { stderr?: unknown })?.stderr ?? ""))
    ? new UnpackError("disk_full", "no space left on the disk")
    : new UnpackError("unpack_failed", `tar: ${error instanceof Error ? error.message : String(error)}`);
}

/** 把 App 带的运行包解到 versions/<版本>/，再把 current 切过去（switchCurrent 为 false 时不切）。 */
export async function unpackRuntime(o: UnpackOptions): Promise<UnpackResult> {
  const arch = o.arch ?? RUNTIME_ARCH;
  const expected = { version: o.bundled.version, arch };
  const target = join(o.paths.versionsDir, o.bundled.version);
  const partial = `${target}.partial`;
  const finish = async (result: UnpackResult): Promise<UnpackResult> => {
    if (o.icon) {
      try {
        await setAgentIcon(o.execFile, o.icon, join(target, "bin", "lead-agent"));
        result.icon = "set";
      } catch (error) {
        result.icon = "failed";
        result.iconError = error instanceof Error ? error.message : String(error);
      }
    }
    if (o.switchCurrent !== false) await switchCurrent(o.paths, o.bundled.version);
    return result;
  };
  const tar = async (args: string[]) => {
    try {
      await o.execFile("/usr/bin/tar", args);
    } catch (error) {
      throw tarFailure(error);
    }
  };
  // 参数固定，不经 shell：目录名带着空格原样作为一个参数交给 xattr。
  const removeQuarantine = async (dir: string) => {
    try {
      await o.execFile("xattr", ["-dr", "com.apple.quarantine", dir]);
    } catch (error) {
      throw new UnpackError("unpack_failed", `xattr: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 共用的一份 node_modules：已经有了直接用；没有时克隆或者解出来，先到 <哈希>.partial，再 rename。
  const sharedModules = async (hash: string): Promise<{ path: string; how: "shared" | "cloned" | "unpacked" }> => {
    const entry = sharedNodeModulesEntry(o.paths.installRoot, hash);
    const modules = join(entry, "node_modules");
    if (isRealDirectory(modules)) return { path: modules, how: "shared" };
    const temp = `${entry}.partial`;
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    try {
      const source = versionsWith(o.paths, "node_modules", hash, o.bundled.version)
        .map((dir) => join(dir, "node_modules"))
        .find(isRealDirectory);
      let how: "cloned" | "unpacked";
      if (source) {
        // cp -c 用 clonefile(2)：APFS 上不复制数据块。
        try {
          await o.execFile("/bin/cp", ["-cR", source, join(temp, "node_modules")]);
        } catch (error) {
          throw tarFailure(error);
        }
        how = "cloned";
      } else {
        await tar(["-xzf", o.bundled.tarball, "-C", temp, "./node_modules"]);
        await removeQuarantine(temp);
        how = "unpacked";
      }
      await rename(temp, entry);
      return { path: modules, how };
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  };

  // 解一次。reuse 为 false 时整个解，不看 components。
  const attempt = async (reuse: boolean): Promise<{ result: UnpackResult; check: RuntimeCheck; reusedPaths: string[] }> => {
    await rm(partial, { recursive: true, force: true });
    await mkdir(partial, { recursive: true });
    const result: UnpackResult = { version: "unpacked", nodeModules: null, leadAgent: null, icon: null };
    const excludes: string[] = [];
    const reusedPaths: string[] = [];
    let link: string | null = null;
    if (reuse) {
      // 先只读 release.json：-q 读到第一项就停（打包时它在第一项）。旧格式的包里没有 components，整个解。
      let components: Partial<Record<ReusedComponent, string>> = {};
      try {
        await o.execFile("/usr/bin/tar", ["-xzqf", o.bundled.tarball, "-C", partial, "./release.json"]);
        components = componentsOf(partial);
      } catch {
        components = {};
      }
      if (components.node_modules) {
        const shared = await sharedModules(components.node_modules);
        link = shared.path;
        result.nodeModules = shared.how;
        excludes.push("./node_modules");
        reusedPaths.push("node_modules/");
      }
      const agentSource = components.node
        ? versionsWith(o.paths, "node", components.node, o.bundled.version).map((dir) => join(dir, "bin", "lead-agent")).find(isRegularFile)
        : undefined;
      if (agentSource) {
        const agent = join(partial, "bin", "lead-agent");
        await mkdir(join(partial, "bin"), { recursive: true });
        // COPYFILE_FICLONE：APFS 上克隆，不是 APFS 时退回普通复制。
        await copyFile(agentSource, agent, constants.COPYFILE_FICLONE);
        await chmod(agent, statSync(agentSource).mode & 0o7777);
        result.leadAgent = "cloned";
        excludes.push("./bin/lead-agent");
        reusedPaths.push("bin/lead-agent");
      }
    }
    await tar(["-xzf", o.bundled.tarball, "-C", partial, ...excludes.flatMap((pattern) => ["--exclude", pattern])]);
    if (result.leadAgent === null) result.leadAgent = "unpacked";
    if (result.nodeModules === null && existsSync(join(partial, "node_modules"))) result.nodeModules = "in_version";
    // 去掉 quarantine 在建软链接以前：xattr -r 不用走进共用的 node_modules。
    await removeQuarantine(partial);
    if (link) await symlink(relative(partial, link), join(partial, "node_modules"));
    return { result, check: await verifyRuntime(partial, expected), reusedPaths };
  };

  try {
    // .partial 是上一次打开时中途退出留下的。从压缩包从头再解。
    await rm(partial, { recursive: true, force: true });
    if (existsSync(target)) {
      // 同一个版本已经解过（例如 current 被切回过旧版本，或者更新时在后台先解好了）。文件完整就直接用。
      if ((await verifyRuntime(target, expected)).ok) {
        return await finish({ version: "reused", nodeModules: null, leadAgent: null, icon: null });
      }
      await rm(target, { recursive: true, force: true });
    }
    let { result, check, reusedPaths } = await attempt(true);
    // 复用的部分对不上 release.json（例如共用的那一份坏了）：从头整个解一次。
    const broken = check.ok ? [] : check.broken ?? [];
    if (broken.some((file) => reusedPaths.some((path) => file === path || file.startsWith(path)))) {
      ({ result, check } = await attempt(false));
    }
    if (!check.ok) throw new UnpackError("runtime_invalid", check.reason);
    await rename(partial, target);
    return await finish(result);
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => {});
    if (error instanceof UnpackError) throw error;
    if (errorCode(error) === "ENOSPC") throw new UnpackError("disk_full", "no space left on the disk");
    throw new UnpackError("unpack_failed", error instanceof Error ? error.message : String(error));
  }
}
