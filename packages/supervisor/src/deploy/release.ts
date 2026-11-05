// 部署闸门的发布模式（docs/desktop/macos-desktop-design.md 第 3 节，P0-1）。
// 桌面版的运行包根目录有 release.json：用户的机器上没有 git，也没有 checkout，闸门不能按 commit 判断。
// 这时闸门检查的是：release.json 能解析、schema 认识；files 里每个文件的 SHA-256 都对得上；架构和本机一致；
// 根目录（和安装根的 current）在 <安装根>/versions/ 下面；库的 schema 版本不比这次构建新（不降级）。
// 它防的是半装好的目录和损坏的文件（解压中断、磁盘满了），不防同一个用户下的恶意进程。
// 按文件判断模式，不按环境变量：launchd 的环境里没有用户的环境变量。
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export const RELEASE_MANIFEST_FILE = "release.json";
export const RELEASE_PRODUCT = "bytezard-lead";
const RELEASE_SCHEMA = 1;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * 运行包的五个组成（设计第 7.5.1 节）。打包脚本（scripts/desktop/lib/release.ts 的 componentOf）把每个文件归到一个组成，
 * 给每个组成算一个内容哈希，写进 release.json 和 manifest.json 的 components。
 */
export const RUNTIME_COMPONENTS = ["node", "node_modules", "service", "web", "cli"] as const;
export type RuntimeComponent = typeof RUNTIME_COMPONENTS[number];
/** 这几个组成变了要重启服务（第 7.5.2 节）。web、cli 变了不重启。 */
export const SERVICE_COMPONENTS: ReadonlyArray<RuntimeComponent> = ["node", "node_modules", "service"];

export interface ReleaseManifest {
  schema: 1;
  product: string;
  version: string;
  arch: string;
  node?: string;
  // 这次构建的 LATEST_SCHEMA_VERSION。库比它新时，这份代码打不开库。
  schemaVersion: number;
  sourceTree?: string;
  builtAt?: string;
  updateSource?: { type: string; repository: string };
  // 相对运行包根目录的路径 → SHA-256（小写十六进制）。
  files: Record<string, string>;
  // 组成 → 内容哈希（第 7.5.1 节）。2026-11-05 以前打的包没有。
  components?: Partial<Record<RuntimeComponent, string>>;
}

// status 里给人看的发布信息。
export interface ReleaseSummary {
  version: string;
  arch: string;
  schemaVersion: number;
  builtAt: string | null;
  sourceTree: string | null;
  installRoot: string | null;
}

export interface ReleaseReadiness {
  ready: boolean;
  reasons: string[];
  release: ReleaseSummary | null;
}

/** 安装根：<数据目录>/runtime/（设计第 1.1 节）。数据目录改名时只改 dataDir()。 */
export function releaseInstallRoot(dataDir: string): string {
  return join(dataDir, "runtime");
}

export function hasReleaseManifest(root: string): boolean {
  return existsSync(join(root, RELEASE_MANIFEST_FILE));
}

// 只接受相对路径，并且不能走出根目录。
function unsafeFilePath(path: string): boolean {
  return !path || isAbsolute(path) || path.split(/[\\/]/).some((segment) => segment === ".." || segment === "");
}

/** 读并校验 release.json。读不了或形状不对时抛错，错误信息就是给人看的原因。 */
export function readReleaseManifest(root: string): ReleaseManifest {
  const path = join(root, RELEASE_MANIFEST_FILE);
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${path} 读不了或不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 不是一个 JSON 对象。`);
  if (value.schema !== RELEASE_SCHEMA) throw new Error(`${path} 的 schema 是 ${JSON.stringify(value.schema)}，这个版本只认识 ${RELEASE_SCHEMA}。`);
  const problems: string[] = [];
  if (value.product !== RELEASE_PRODUCT) problems.push(`product 不是 ${RELEASE_PRODUCT}`);
  if (typeof value.version !== "string" || !value.version) problems.push("缺 version");
  if (typeof value.arch !== "string" || !value.arch) problems.push("缺 arch");
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 0) problems.push("schemaVersion 不是非负整数");
  const files = value.files;
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.keys(files).length) {
    problems.push("files 为空，没有可校验的文件");
  } else {
    for (const [file, hash] of Object.entries(files as Record<string, unknown>)) {
      if (unsafeFilePath(file)) problems.push(`files 里的路径 ${JSON.stringify(file)} 不是运行包里的相对路径`);
      else if (typeof hash !== "string" || !SHA256.test(hash)) problems.push(`files 里 ${file} 的哈希不是 SHA-256`);
    }
  }
  if (problems.length) throw new Error(`${path} 的内容不对：${problems.join("；")}。`);
  const manifest = value as unknown as ReleaseManifest;
  // components 只用来判断要不要重启、能不能复用，不用来核对文件：认识的组成、形状对的哈希才留下，其余的当作没有。
  const components = releaseComponents(value.components);
  if (components) manifest.components = components;
  else delete manifest.components;
  return manifest;
}

/** release.json 的 components：只留认识的组成和形状对的哈希。一个都没有时为 undefined。 */
export function releaseComponents(value: unknown): Partial<Record<RuntimeComponent, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = RUNTIME_COMPONENTS.flatMap((name) => {
    const hash = (value as Record<string, unknown>)[name];
    return typeof hash === "string" && SHA256.test(hash) ? [[name, hash] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// child 在 parent 里面（不等于 parent）。两边都是解开软链接以后的路径。
function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** 库的 schema 版本。库不存在（第一次安装）或读不了时为 null。 */
export function databaseSchemaVersion(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
        { version: number | null } | undefined;
      return row?.version ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** 发布模式下现在能不能部署 root 这个运行包。只读，不调用 git。 */
export function releaseReadiness(
  root: string,
  installRoot: string | null | undefined,
  dbPath: string | null | undefined,
): ReleaseReadiness {
  let manifest: ReleaseManifest;
  try {
    manifest = readReleaseManifest(root);
  } catch (error) {
    return { ready: false, reasons: [error instanceof Error ? error.message : String(error)], release: null };
  }
  const reasons: string[] = [];

  const broken: string[] = [];
  for (const [file, expected] of Object.entries(manifest.files)) {
    const path = join(root, file);
    try {
      if (sha256File(path) !== expected) broken.push(`${file}（哈希不对）`);
    } catch {
      broken.push(`${file}（缺失或读不了）`);
    }
  }
  if (broken.length) {
    reasons.push(`运行包 ${root} 的文件和 ${RELEASE_MANIFEST_FILE} 对不上：${broken.join("、")}。运行包可能没装完或者损坏了，重新安装这个版本。`);
  }

  if (manifest.arch !== process.arch) {
    reasons.push(`运行包是 ${manifest.arch} 架构，这台机器是 ${process.arch}。安装 ${process.arch} 的运行包。`);
  }

  if (!installRoot) {
    reasons.push(`不知道安装根在哪里，无法确认运行包 ${root} 是装好的版本。`);
  } else {
    const versions = realpathOrNull(join(installRoot, "versions"));
    const current = realpathOrNull(join(installRoot, "current"));
    const actual = realpathOrNull(root);
    if (!versions) {
      reasons.push(`安装根 ${installRoot} 下面没有 versions 目录。`);
    } else {
      if (!current) {
        reasons.push(`安装根 ${installRoot} 下面没有 current，或者它指向的目录不存在。`);
      } else if (!inside(versions, current)) {
        reasons.push(`${join(installRoot, "current")} 指向 ${current}，不在安装根的 versions 目录里。`);
      }
      if (!actual || !inside(versions, actual)) {
        reasons.push(`运行包 ${actual ?? root} 不在安装根的 versions 目录（${versions}）里。`);
      }
    }
  }

  const dbVersion = dbPath ? databaseSchemaVersion(dbPath) : null;
  if (dbVersion !== null && dbVersion > manifest.schemaVersion) {
    reasons.push(`这是一次降级：库的 schema 版本是 ${dbVersion}，运行包 ${manifest.version} 只支持到 ${manifest.schemaVersion}，旧代码打不开新库。安装不低于当前的版本。`);
  }

  return {
    ready: reasons.length === 0,
    reasons,
    release: {
      version: manifest.version,
      arch: manifest.arch,
      schemaVersion: manifest.schemaVersion,
      builtAt: manifest.builtAt ?? null,
      sourceTree: manifest.sourceTree ?? null,
      installRoot: installRoot ?? null,
    },
  };
}
