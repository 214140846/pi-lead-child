// 维护前的数据库备份（部署闸门，2026-10-19）：daemon 还在跑时做在线备份。
// SQLite 的在线备份按步复制页面。better-sqlite3 缺省每步 100 页，另一个连接每写一次，备份就从头开始：
// 约 60 MB 的库在每 200 ms 写一次时要 17–32 秒，写得更勤时一分钟也完不成（审查 2026-10-20 A）。
// 能接管的 child 在跑时不挡维护，而它们正好在写库。所以一步复制全部页面（实测约 0.3 秒），并且有时限：
// 到时限还没完成就放弃，删掉半成品，这次维护被拒绝。
//
// 升级前的备份只留一份（docs/desktop/macos-desktop-design.md 第 7.5.5 节，replaceBackup）：新的一份先写到临时文件，
// PRAGMA integrity_check 的结果是 ok 才 rename 覆盖旧的一份。没核对过以前不删旧的。
import Database from "better-sqlite3";
import { readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

export const BACKUP_TIMEOUT_MS_DEFAULT = 60_000;

export async function backupSqlite(
  source: string,
  destination: string,
  options: { timeoutMs?: number; pagesPerStep?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? BACKUP_TIMEOUT_MS_DEFAULT;
  // 0x7fffffff 是 better-sqlite3 允许的最大步长：剩下的页面一步复制完。
  const pagesPerStep = options.pagesPerStep ?? 0x7fffffff;
  const deadline = Date.now() + timeoutMs;
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination, {
      progress: () => {
        if (Date.now() > deadline) throw new Error(`database backup did not finish within ${timeoutMs} ms`);
        return pagesPerStep;
      },
    });
  } catch (error) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`${destination}${suffix}`, { force: true });
    throw error;
  } finally {
    db.close();
  }
}

const SQLITE_SIDE_FILES = ["", "-journal", "-wal", "-shm"];

/**
 * 核对一份备份：PRAGMA integrity_check 的结果是 ok 时为 null，否则是前几条问题。打不开也算问题。
 * 在线备份照搬了源库的 WAL 模式，一打开就会在旁边建 -wal、-shm。所以先换成 DELETE 模式：关掉以后只剩一个文件，
 * rename 的就是完整的一份。恢复时 daemon 打开库会再换回 WAL。
 */
export function sqliteIntegrityProblem(path: string): string | null {
  let db: Database.Database;
  try {
    db = new Database(path, { fileMustExist: true });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  try {
    db.pragma("journal_mode = DELETE");
    const rows = db.pragma("integrity_check(5)") as Array<{ integrity_check: string }>;
    const lines = rows.map((row) => row.integrity_check);
    return lines.length === 1 && lines[0] === "ok" ? null : lines.join("; ");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    db.close();
  }
}

/**
 * 把 source 备份成 destination，原子地换掉旧的一份：先写 <destination>.partial，核对完整再 rename。
 * 备份或核对失败时删掉临时文件、抛错，旧的一份原样留着。
 */
export async function replaceBackup(
  source: string,
  destination: string,
  options: { timeoutMs?: number; backup?: (source: string, destination: string) => Promise<void> } = {},
): Promise<void> {
  const partial = `${destination}.partial`;
  const removePartial = () => { for (const suffix of SQLITE_SIDE_FILES) rmSync(`${partial}${suffix}`, { force: true }); };
  // 上一次中途退出留下的临时文件：SQLite 的备份会写进已有的库，先删掉。
  removePartial();
  try {
    await (options.backup ?? ((from, to) => backupSqlite(from, to, { timeoutMs: options.timeoutMs })))(source, partial);
    const problem = sqliteIntegrityProblem(partial);
    if (problem) throw new Error(`the backup ${partial} is not intact: ${problem}`);
    // 临时文件是一个完整的库，没有 -wal（上面换成了 DELETE 模式）：rename 以后旧的一份才没了。
    for (const suffix of ["-wal", "-shm"]) rmSync(`${destination}${suffix}`, { force: true });
    renameSync(partial, destination);
  } catch (error) {
    removePartial();
    throw error;
  }
}

// 2026-11-05 以前情况 C 每次升级按时间多存一份（第 7.5.5 节）：pre-upgrade-<时间>.db、-stopped.db、.supervisor.plist。
// 时间是 toISOString() 把 : 和 . 换成 - 以后的样子。
const LEGACY_UPGRADE_BACKUP = /^pre-upgrade-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-stopped)?(?:\.db(?:-wal|-shm|-journal)?|\.supervisor\.plist)$/;

/** 删掉以前按时间存的升级备份。别的文件都不动。返回删掉的文件名。 */
export function removeLegacyUpgradeBackups(backupDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(backupDir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names.filter((entry) => LEGACY_UPGRADE_BACKUP.test(entry)).sort()) {
    try {
      rmSync(join(backupDir, name), { force: true });
      removed.push(name);
    } catch {
      // 删不掉的下次升级再删。
    }
  }
  return removed;
}
