// App 带的运行包（docs/desktop/macos-desktop-design.md 第 4.2 节第 2 步）。
// App 里放的是 Resources/runtime/bytezard-lead-runtime-<版本>-arm64.tar.gz，就是 P0-2 打出的发布附件，不改名。
// 解包总是先到 versions/<版本>.partial/，release.json 和文件哈希都对得上以后才 rename 成 versions/<版本>/。
// 所以中途退出不会留下半个版本：下次打开时删掉 .partial，从头再解。
// 壳不 import 后端的包，这里把 packages/supervisor/src/deploy/release.ts 里用得上的检查写一份：product、version、arch、
// 路径不走出根目录、files 里每个文件的 SHA-256。
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, symlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
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

export type RuntimeCheck = { ok: true } | { ok: false; reason: string };

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
  for (const [file, hash] of Object.entries(files as Record<string, unknown>)) {
    if (unsafeFilePath(file) || typeof hash !== "string" || !SHA256.test(hash)) {
      broken.push(`${file} (bad entry)`);
      continue;
    }
    try {
      if (await sha256File(join(dir, file)) !== hash) broken.push(`${file} (hash does not match)`);
    } catch {
      broken.push(`${file} (missing)`);
    }
  }
  return broken.length ? { ok: false, reason: `files do not match release.json: ${broken.join(", ")}` } : { ok: true };
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
}

/** 把 App 带的运行包解到 versions/<版本>/，再把 current 切过去。 */
export async function unpackRuntime(o: UnpackOptions): Promise<void> {
  const arch = o.arch ?? RUNTIME_ARCH;
  const expected = { version: o.bundled.version, arch };
  const target = join(o.paths.versionsDir, o.bundled.version);
  const partial = `${target}.partial`;
  try {
    // .partial 是上一次打开时中途退出留下的。从压缩包从头再解。
    await rm(partial, { recursive: true, force: true });
    if (existsSync(target)) {
      // 同一个版本已经解过（例如 current 被切回过旧版本）。文件完整就直接用。
      if ((await verifyRuntime(target, expected)).ok) {
        await switchCurrent(o.paths, o.bundled.version);
        return;
      }
      await rm(target, { recursive: true, force: true });
    }
    await mkdir(partial, { recursive: true });
    try {
      await o.execFile("/usr/bin/tar", ["-xzf", o.bundled.tarball, "-C", partial]);
    } catch (error) {
      throw errorCode(error) === "ENOSPC" || /No space left/i.test(String((error as { stderr?: unknown })?.stderr ?? ""))
        ? new UnpackError("disk_full", "no space left on the disk")
        : new UnpackError("unpack_failed", `tar: ${error instanceof Error ? error.message : String(error)}`);
    }
    const check = await verifyRuntime(partial, expected);
    if (!check.ok) throw new UnpackError("runtime_invalid", check.reason);
    // 参数固定，不经 shell：目录名带着空格原样作为一个参数交给 xattr。
    try {
      await o.execFile("xattr", ["-dr", "com.apple.quarantine", partial]);
    } catch (error) {
      throw new UnpackError("unpack_failed", `xattr: ${error instanceof Error ? error.message : String(error)}`);
    }
    await rename(partial, target);
    await switchCurrent(o.paths, o.bundled.version);
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => {});
    if (error instanceof UnpackError) throw error;
    if (errorCode(error) === "ENOSPC") throw new UnpackError("disk_full", "no space left on the disk");
    throw new UnpackError("unpack_failed", error instanceof Error ? error.message : String(error));
  }
}
