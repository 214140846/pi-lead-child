// 运行包的旧版本（docs/desktop/macos-desktop-design.md 第 2.2 节：保留 current 和上一个，更早的在升级成功后删掉）。
// 每个版本约 400 MB，App 能一键更新以后（desktop/src/updater.ts）每次更新多一个，所以 desktop-install 装好、
// daemon 回答 status 以后删掉更早的。下面这些不删：
//   - 这次装的版本，和上一个装好的版本：回滚要用它（第 12.5 节）；
//   - 还有进程在用的版本：daemon、Hindsight 和执行器从 versions/<版本>/ 下运行，不经 current。升级以后接管的执行器
//     可能还在更早的版本上跑；
//   - 名字不是版本号的项：解了一半的 <版本>.partial 由 App 下次解包时删。
// 看不出哪些版本在用（ps 失败）时一个都不删。删不掉不算安装失败，下次装好时再删。
//
// node_modules 按内容哈希放在 <安装根>/shared/node_modules/<哈希>/node_modules，版本目录里是指向它的软链接
// （第 7.5.4 节，壳的 runtime-bundle.ts）。删完版本以后，没有版本目录再指向的项也删掉（pruneSharedNodeModules）。
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// 和 scripts/desktop/lib/release.ts 同一条规则：版本号就是目录名。
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHARED_ENTRY = /^[0-9a-f]{64}$/;

/** <安装根>/shared/node_modules：按内容哈希存的 node_modules（壳的 runtime-bundle.ts 写同一个位置）。 */
export function sharedNodeModulesDir(installRoot: string): string {
  return join(installRoot, "shared", "node_modules");
}

export interface PruneRuntimeVersionsOptions {
  /** <安装根>/versions。 */
  versionsDir: string;
  /** 一定留着的版本：这次装的和上一个。 */
  keep: ReadonlyArray<string>;
  /** 正在跑的进程的完整命令行。缺省读 ps。 */
  runningCommands?(): string[];
}

export interface PruneRuntimeVersionsResult {
  removed: string[];
  /** 还有进程在用，留着。 */
  inUse: string[];
  failed: string[];
}

export function pruneRuntimeVersions(o: PruneRuntimeVersionsOptions): PruneRuntimeVersionsResult {
  const result: PruneRuntimeVersionsResult = { removed: [], inUse: [], failed: [] };
  let names: string[];
  try {
    names = readdirSync(o.versionsDir);
  } catch {
    return result;
  }
  const keep = new Set(o.keep);
  const candidates = names.filter((name) => VERSION.test(name) && !keep.has(name)).sort();
  if (!candidates.length) return result;
  let commands: string[];
  try {
    commands = (o.runningCommands ?? psCommands)();
  } catch {
    result.inUse.push(...candidates);
    return result;
  }
  for (const name of candidates) {
    const dir = join(o.versionsDir, name);
    if (commands.some((command) => command.includes(`${dir}/`))) {
      result.inUse.push(name);
      continue;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
      result.removed.push(name);
    } catch {
      result.failed.push(name);
    }
  }
  return result;
}

// 只在这里比对路径，不输出命令行（里面可能有别的程序的参数）。
function psCommands(): string[] {
  return execFileSync("/bin/ps", ["-axww", "-o", "command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
}

/**
 * 删掉 shared/node_modules 里没有版本目录再指向的项。versions/ 下面的每一项都算（包括解了一半的 .partial）：
 * 它们的 node_modules 软链接指向的那一份留着。名字不是哈希的项（解了一半的 <哈希>.partial）不动，由壳下次解包时删。
 */
export function pruneSharedNodeModules(installRoot: string): string[] {
  const shared = sharedNodeModulesDir(installRoot);
  let entries: string[];
  try {
    entries = readdirSync(shared);
  } catch {
    return [];
  }
  const versionsDir = join(installRoot, "versions");
  const used = new Set<string>();
  let versions: string[] = [];
  try {
    versions = readdirSync(versionsDir);
  } catch {
    versions = [];
  }
  for (const name of versions) {
    const link = join(versionsDir, name, "node_modules");
    try {
      if (!lstatSync(link).isSymbolicLink()) continue;
      const rel = relative(shared, resolve(join(versionsDir, name), readlinkSync(link)));
      const first = rel.split(sep)[0]!;
      if (!rel.startsWith("..") && SHARED_ENTRY.test(first)) used.add(first);
    } catch {
      // 没有 node_modules 或者读不了：不指向任何一份。
    }
  }
  const removed: string[] = [];
  for (const name of entries.filter((entry) => SHARED_ENTRY.test(entry) && !used.has(entry)).sort()) {
    try {
      rmSync(join(shared, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      // 删不掉的下次装好时再删。
    }
  }
  return removed;
}
