// 运行包的 node_modules：只放 daemon 构建的 external（apps/daemon/scripts/externals.ts）和它们的依赖。
//
// 依赖闭包按根 package-lock.json 算，文件从仓库已经装好的 node_modules 复制。没有在暂存目录里再跑一次 npm install：
// - 锁文件说了装哪个版本、装在哪个位置，复制出来的树和锁文件一模一样，版本不会漂；
// - 不用第二次联网，better-sqlite3 也不会再下载一次预编译文件；
// - CI 的 npm ci 和运行包用同一个 Node 版本（setup-node 读 desktop/node-version），原生模块的 ABI 一致。
// 复制前逐个核对磁盘上 package.json 的版本和锁文件一致；不一致说明 node_modules 不是按这个锁文件装的，打包失败。
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export interface LockPackage {
  version?: string;
  link?: boolean;
  optional?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
}

export interface Lockfile {
  lockfileVersion: number;
  packages: Record<string, LockPackage>;
}

export interface ClosureEntry {
  // 锁文件里的位置，例如 node_modules/a/node_modules/b。
  path: string;
  name: string;
  version: string;
  // 只经由可选依赖才到得了它：磁盘上没有时跳过（例如别的平台的原生包）。
  optional: boolean;
}

const NODE_MODULES = "node_modules/";

export function lockPathName(path: string): string {
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) throw new Error(`不是 node_modules 下的路径：${path}`);
  return path.slice(at + NODE_MODULES.length);
}

// path 的上一层：node_modules/a/node_modules/b → node_modules/a；node_modules/a → ""（根）。
function lockParent(path: string): string {
  const at = path.lastIndexOf(`/${NODE_MODULES}`);
  return at < 0 ? "" : path.slice(0, at);
}

/** 按 Node 的查找规则，在锁文件里找 from 位置的包 require(name) 会拿到哪一个。找不到返回 null。 */
export function resolveInLock(lock: Lockfile, from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = dir ? `${dir}/${NODE_MODULES}${name}` : `${NODE_MODULES}${name}`;
    if (lock.packages[candidate]) return candidate;
    if (!dir) return null;
    dir = lockParent(dir);
  }
}

function edges(pkg: LockPackage): Array<{ name: string; optional: boolean }> {
  const out: Array<{ name: string; optional: boolean }> = [];
  for (const name of Object.keys(pkg.dependencies ?? {})) out.push({ name, optional: false });
  for (const name of Object.keys(pkg.optionalDependencies ?? {})) out.push({ name, optional: true });
  // npm 7 起会装 peer 依赖；可选的 peer 不在锁文件里时跳过。
  for (const name of Object.keys(pkg.peerDependencies ?? {})) {
    out.push({ name, optional: pkg.peerDependenciesMeta?.[name]?.optional === true });
  }
  return out;
}

/** roots 和它们的全部运行时依赖在锁文件里的位置。缺必需的依赖、碰到工作区链接时抛错。 */
export function externalClosure(lock: Lockfile, roots: readonly string[]): ClosureEntry[] {
  if (lock.lockfileVersion < 2) throw new Error(`package-lock.json 的 lockfileVersion 是 ${lock.lockfileVersion}，要 2 或更新`);
  const found = new Map<string, ClosureEntry>();
  const queue: Array<{ path: string; optional: boolean }> = [];
  const visit = (path: string, optional: boolean) => {
    const existing = found.get(path);
    // 已经是必需的，或者这次也只是可选的：不用再走一遍。
    if (existing && (!existing.optional || optional)) return;
    const pkg = lock.packages[path]!;
    if (pkg.link) throw new Error(`${path} 是工作区链接，不能放进运行包`);
    if (!pkg.version) throw new Error(`package-lock.json 里 ${path} 没有版本`);
    found.set(path, { path, name: lockPathName(path), version: pkg.version, optional });
    queue.push({ path, optional });
  };
  for (const root of roots) {
    const path = `${NODE_MODULES}${root}`;
    if (!lock.packages[path]) throw new Error(`package-lock.json 的根 node_modules 里没有 ${root}`);
    visit(path, false);
  }
  while (queue.length) {
    const { path, optional } = queue.shift()!;
    for (const edge of edges(lock.packages[path]!)) {
      const target = resolveInLock(lock, path, edge.name);
      if (target) visit(target, optional || edge.optional);
      else if (!edge.optional) throw new Error(`package-lock.json 里找不到 ${edge.name}（${path} 需要它）`);
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function binEntries(name: string, bin: LockPackage["bin"]): Array<[string, string]> {
  if (!bin) return [];
  if (typeof bin === "string") return [[name.split("/").pop()!, bin]];
  return Object.entries(bin);
}

/**
 * 把闭包里的包从 repoRoot 复制到 dest（运行包根）下的同一个位置，并像 npm 一样建 node_modules/.bin 的链接。
 * 每个包只复制它自己的文件；它下面嵌套的 node_modules 只复制闭包里有的那些。返回实际复制的包。
 */
export function copyExternals(o: { repoRoot: string; lock: Lockfile; entries: readonly ClosureEntry[]; dest: string }): ClosureEntry[] {
  const copied: ClosureEntry[] = [];
  for (const entry of o.entries) {
    const source = join(o.repoRoot, entry.path);
    const manifest = join(source, "package.json");
    if (!existsSync(manifest)) {
      if (entry.optional) continue;
      throw new Error(`node_modules 里缺少 ${entry.path}。先在仓库根运行 npm ci`);
    }
    const onDisk = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: string }).version;
    if (onDisk !== entry.version) {
      throw new Error(`${entry.path} 装的是 ${onDisk ?? "未知版本"}，package-lock.json 写的是 ${entry.version}。先在仓库根运行 npm ci`);
    }
    const target = join(o.dest, entry.path);
    const nested = join(source, "node_modules");
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, verbatimSymlinks: true, filter: (path) => path !== nested });
    copied.push(entry);
  }
  for (const entry of copied) {
    for (const [bin, file] of binEntries(entry.name, o.lock.packages[entry.path]!.bin)) {
      // 包所在的 node_modules 目录下的 .bin，和 npm 一样。
      const binDir = join(o.dest, entry.path.slice(0, entry.path.length - entry.name.length), ".bin");
      const link = join(binDir, bin);
      if (lstatSync(link, { throwIfNoEntry: false })) continue;
      mkdirSync(binDir, { recursive: true });
      symlinkSync(relative(binDir, join(o.dest, entry.path, file)), link);
    }
  }
  return copied;
}
