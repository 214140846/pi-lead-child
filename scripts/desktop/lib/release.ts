// 桌面版运行包的名字、参数和两份清单（docs/desktop/macos-desktop-design.md 第 2.3 节、第 7.3 节）。
// 这里只有纯函数：打包脚本（pack.ts）和测试都用它。
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";

export const PRODUCT = "bytezard-lead";
// 只出 Apple 芯片版（设计文档第 9 节决定 1）。
export const SUPPORTED_ARCH = "arm64";
export const RELEASE_SCHEMA = 1;
export const MANIFEST_SCHEMA = 1;
export const RELEASE_FILE = "release.json";
export const MANIFEST_FILE = "manifest.json";

// release.json.files 里算哈希的关键文件。部署闸门的发布模式（P0-1）逐个核对它们。
// 只算关键文件，不扫整个 node_modules：status 会被频繁调用（设计文档第 3.1 节）。
export const HASHED_FILES = [
  "bin/lead-agent",
  "apps/daemon/dist/supervisor.mjs",
  "apps/daemon/dist/coordinatord.mjs",
  "apps/daemon/dist/ops.mjs",
  "apps/daemon/dist/mcp-server.mjs",
  "apps/daemon/dist/hindsight.mjs",
  "apps/daemon/dist/launcher-shim.mjs",
  "apps/daemon/dist/web/index.html",
  "apps/cli/dist/cli.mjs",
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
] as const;

// 版本号会成为目录名（versions/<版本>/）和附件名的一部分，所以只收 semver，不收斜杠和 ..。
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// GitHub 的 owner/repo。
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const NODE_VERSION = /^\d+\.\d+\.\d+$/;

export interface PackArgs {
  arch: typeof SUPPORTED_ARCH;
  version: string;
  repository: string;
  out: string | null;
  nodeDistUrl: string | null;
}

export class UsageError extends Error {}

export const PACK_USAGE =
  "用法：node --import tsx scripts/desktop/pack-runtime.ts --arch arm64 --version <x.y.z> --repository <owner/repo> [--out <目录>] [--node-dist-url <https 地址>]";

/** 解析 pack-runtime.ts 的命令行参数。参数不对时抛 UsageError，消息写明哪一个不对。 */
export function parsePackArgs(argv: readonly string[]): PackArgs {
  const values = new Map<string, string>();
  const known = new Set(["--arch", "--version", "--repository", "--out", "--node-dist-url"]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (!known.has(flag)) throw new UsageError(`不认识的参数 ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} 后面缺少值`);
    if (values.has(flag)) throw new UsageError(`${flag} 写了两次`);
    values.set(flag, value);
    i += 1;
  }
  const arch = values.get("--arch");
  if (arch === undefined) throw new UsageError("缺少 --arch");
  if (arch !== SUPPORTED_ARCH) throw new UsageError(`--arch 只接受 ${SUPPORTED_ARCH}，收到 ${arch}`);
  const version = values.get("--version");
  if (version === undefined) throw new UsageError("缺少 --version");
  assertVersion(version);
  const repository = values.get("--repository");
  if (repository === undefined) throw new UsageError("缺少 --repository");
  if (!REPOSITORY.test(repository) || repository.split("/")[1] === "." || repository.split("/")[1] === "..") {
    throw new UsageError(`--repository 要写成 owner/repo，收到 ${repository}`);
  }
  const nodeDistUrl = values.get("--node-dist-url") ?? null;
  if (nodeDistUrl !== null) assertHttpUrl(nodeDistUrl, "--node-dist-url");
  return { arch, version, repository, out: values.get("--out") ?? null, nodeDistUrl };
}

export function assertVersion(version: string): void {
  if (!VERSION.test(version)) throw new UsageError(`--version 要是 x.y.z 形式的版本号，收到 ${version}`);
}

function assertHttpUrl(value: string, flag: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new UsageError(`${flag} 不是合法的地址：${value}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UsageError(`${flag} 只接受 http 或 https 地址：${value}`);
}

/** desktop/node-version 的内容：一行 x.y.z。CI 的 setup-node 读同一个文件。 */
export function parseNodeVersionFile(text: string): string {
  const version = text.trim().replace(/^v/, "");
  if (!NODE_VERSION.test(version)) throw new Error(`desktop/node-version 要写一行 x.y.z，现在是 ${JSON.stringify(text.trim())}`);
  return version;
}

export function runtimeArchiveName(version: string): string {
  assertVersion(version);
  return `${PRODUCT}-runtime-${version}-${SUPPORTED_ARCH}.tar.gz`;
}

export interface ReleaseManifest {
  schema: typeof RELEASE_SCHEMA;
  product: typeof PRODUCT;
  version: string;
  arch: typeof SUPPORTED_ARCH;
  node: string;
  schemaVersion: number;
  sourceTree: string;
  builtAt: string;
  updateSource: { type: "github"; repository: string };
  files: Record<string, string>;
}

export function releaseManifest(o: {
  version: string; node: string; schemaVersion: number; sourceTree: string; builtAt: Date;
  repository: string; files: Record<string, string>;
}): ReleaseManifest {
  return {
    schema: RELEASE_SCHEMA,
    product: PRODUCT,
    version: o.version,
    arch: SUPPORTED_ARCH,
    node: o.node,
    schemaVersion: o.schemaVersion,
    sourceTree: o.sourceTree,
    builtAt: o.builtAt.toISOString(),
    updateSource: { type: "github", repository: o.repository },
    files: o.files,
  };
}

// 挂在 release 上的 manifest.json。更新检查（P1-3）读 /releases/latest/download/manifest.json，
// 按 runtime.sha256 校验下载的运行包。只有一个架构，所以文件名不带架构后缀（设计文档第 8.1 节）。
// dmg 一项在 electron-builder 打出 dmg 以后由 add-dmg.ts 加上：App 的一键更新按它下载和校验（desktop/src/updater.ts）。
export interface UpdateManifest {
  schema: typeof MANIFEST_SCHEMA;
  product: typeof PRODUCT;
  version: string;
  arch: typeof SUPPORTED_ARCH;
  node: string;
  schemaVersion: number;
  sourceTree: string;
  builtAt: string;
  runtime: { file: string; size: number; sha256: string };
  dmg?: { file: string; size: number; sha256: string };
}

/** dmg 的附件名：electron-builder.yml 的 artifactName，App 的更新也按这个名字找（desktop/src/updater.ts 的 dmgFileName）。 */
export function dmgName(version: string): string {
  assertVersion(version);
  return `${PRODUCT}-${version}-${SUPPORTED_ARCH}.dmg`;
}

/** 把 dmg 记进 manifest。文件名必须是这个版本的 dmg：App 按 manifest 的版本拼出名字去下载。 */
export function withDmg(manifest: UpdateManifest, dmg: { file: string; size: number; sha256: string }): UpdateManifest {
  const expected = dmgName(manifest.version);
  if (dmg.file !== expected) throw new Error(`dmg 的文件名要是 ${expected}，收到 ${dmg.file}`);
  if (!Number.isSafeInteger(dmg.size) || dmg.size <= 0) throw new Error(`dmg 的大小不对：${dmg.size}`);
  if (!/^[0-9a-f]{64}$/.test(dmg.sha256)) throw new Error("dmg 的 SHA-256 不对");
  return { ...manifest, dmg };
}

export function updateManifest(release: ReleaseManifest, archive: { file: string; size: number; sha256: string }): UpdateManifest {
  return {
    schema: MANIFEST_SCHEMA,
    product: PRODUCT,
    version: release.version,
    arch: release.arch,
    node: release.node,
    schemaVersion: release.schemaVersion,
    sourceTree: release.sourceTree,
    builtAt: release.builtAt,
    runtime: archive,
  };
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

/** 给运行包里的关键文件算 SHA-256。缺一个就抛错：缺文件的运行包不能发。 */
export async function hashFiles(root: string, files: readonly string[] = HASHED_FILES): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of files) {
    try {
      result[file] = await sha256File(join(root, file));
    } catch (error) {
      throw new Error(`运行包里缺少 ${file}：${(error as Error).message}`);
    }
  }
  return result;
}
