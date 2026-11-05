// 改名以前的名字（docs/desktop/macos-desktop-design.md 第 8.5 节、第 10 节 P0-8）。旧名字只写在这里和迁移模块
// （packages/supervisor/src/deploy/data-dir-migration.ts）里，别的代码从这里取。
//
// 新名字：数据目录 ~/Library/Application Support/Bytezard Lead/，launchd 任务 com.bytezard.plc.supervisor、
// com.bytezard.plc.hindsight。开发机用 ops.mjs migrate-data-dir 一次迁过去；装桌面版 App 时 desktop-install 自动迁过去（第 12 节）。
//
// 合并以后、迁移以前，开发机上还是旧目录和旧任务，而主 checkout 的构建在任何一次重启时就会生效。这段时间里
// 代码照旧用旧目录和旧任务（preRenameLayoutActive），不新建一个空的数据目录，也不再装一个 Hindsight 抢同一个端口。
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** 改名以前的数据目录，相对 home。 */
export const PRE_RENAME_DATA_DIR = ".pi-lead-child";
export const PRE_RENAME_SUPERVISOR_LABEL = "com.pi-lead-child.supervisor";
export const PRE_RENAME_HINDSIGHT_LABEL = "com.pi-lead-child.hindsight";
/** 更早的 daemon 任务（supervisor 出现以前），装和卸的时候顺手 bootout。 */
export const PRE_RENAME_COORDINATORD_LABEL = "com.pi-lead-child.coordinatord";

/** 新的数据目录，相对 home（第 9 节决定 6）。 */
export const DATA_DIR_SEGMENTS = ["Library", "Application Support", "Bytezard Lead"] as const;

export function defaultDataDir(home: string): string {
  return join(home, ...DATA_DIR_SEGMENTS);
}

export function preRenameDataDir(home: string): string {
  return join(home, PRE_RENAME_DATA_DIR);
}

/**
 * 桌面版 App 自己放进新数据目录的项（docs/desktop/macos-desktop-design.md 第 12.2 节）：Electron 的 userData（shell/）、
 * 运行包（runtime/）和访达的 .DS_Store。App 第一次打开就建了它们，那时用户的数据可能还在旧目录里。
 */
export const DESKTOP_APP_ENTRIES: readonly string[] = ["runtime", "shell", ".DS_Store"];

/** dir 不存在、是空的，或者只有 App 自己的项：里面还没有用户的数据。 */
export function holdsOnlyAppEntries(dir: string): boolean {
  try {
    return readdirSync(dir).every((name) => DESKTOP_APP_ENTRIES.includes(name));
  } catch {
    return true;
  }
}

/**
 * 这台机器还没迁移：没设 PLC_DATA_DIR，旧目录在，新目录里还没有用户的数据。新机器没有旧目录，直接用新名字。
 * 迁移把旧目录整个移走，回滚把它移回来，所以这个判断跟着迁移的结果走，不用另记状态。
 * 新目录里只有 App 自己的项也算没有数据：不然 App 一装上，开发机的 CLI 和重启后的 daemon 就改用新目录，在里面开一个空库。
 */
export function preRenameLayoutActive(env: Record<string, string | undefined>, home: string): boolean {
  if (env.PLC_DATA_DIR) return false;
  return existsSync(preRenameDataDir(home)) && holdsOnlyAppEntries(defaultDataDir(home));
}

/** 没设 PLC_DATA_DIR 时用的数据目录：还没迁移的开发机是旧目录，其余是新目录。 */
export function installedDataDir(home: string): string {
  return preRenameLayoutActive({}, home) ? preRenameDataDir(home) : defaultDataDir(home);
}

/** 这个数据目录是改名以前的目录：用它的进程也用改名以前的 launchd 任务。 */
export function isPreRenameDataDir(dir: string, home: string): boolean {
  return resolve(dir) === resolve(preRenameDataDir(home));
}
