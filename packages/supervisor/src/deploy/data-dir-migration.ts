// 开发机从改名以前的名字迁到新名字（docs/desktop/macos-desktop-design.md 第 10 节 P0-8）：ops.mjs migrate-data-dir。
//
//   ~/.pi-lead-child                      ->  ~/Library/Application Support/Bytezard Lead
//   com.pi-lead-child.supervisor          ->  com.bytezard.plc.supervisor
//   com.pi-lead-child.hindsight           ->  com.bytezard.plc.hindsight
//
// 步骤（每一步按行输出 JSON：{step, state, message}）：
//   precheck   旧目录和旧 plist 在；新目录不存在或为空；同一个卷（rename 是原子的）；剩余空间够放一份库的备份；
//              新的 socket 路径不超过 103 字节；库的 schema 是这份代码的最新版本。不过就退出，什么都不改。
//   backup     daemon 还在运行时在线备份 plc.db 到 <旧目录>/backups/pre-rename-<时间>.db，输出备份路径
//   scan       列出库和 config.json 里写着旧目录的表、列、行数和设置项
//   drain      复用 supervisor 维护的排空判断：Lead 这一轮结束、没有接管不了的执行
//   stop_old   bootout 两个旧任务，确认进程都退出了；旧 plist 改名为 .plist.pre-rename 留着
//   move       rename 旧目录到新位置。不留指向旧路径的软链接：执行器沙箱的禁读清单按新路径生成，软链接会绕过它
//   rewrite    一个事务里把库里的旧目录改成新目录；config.json 原子地重写
//   start_new  把开发机的 Node 复制成 <新目录>/bin/lead-agent 并重签，建软链接 <新目录>/bin/Bytezard Lead；
//              写新的两个 plist，bootstrap
//   health     plc.sock 回答 status，库的 schema 版本和迁移前一样。通过后删掉 .plist.pre-rename
//
// 回滚：stop_old 开始以后任何一步失败，就 bootout 新任务、删新 plist、把目录移回去、把库和 config.json 改回去、
// 把旧 plist 改回原名并 bootstrap。回滚的每一步都输出一行。
//
// 库里改哪些列：只改代码当作路径或命令来用的列（LIVE_PATH_COLUMNS）。事件、消息、核查结论这类历史记录里写着旧目录，
// 那是当时的事实，不改（有的表本来就只许追加）；scan 照样列出它们的行数。
// 库的回滚：把同样几列里的新目录改回旧目录。迁移前这几列和 config.json 里没有新目录（precheck 时新目录还不存在），
// 所以改回去和迁移前完全一样，也不会丢掉 backup 之后、停服务之前 daemon 写下的东西。迁移前就有新目录时，用 backup 的备份恢复。
//
// 桌面版 App 的接管（第 12 节，#234）也用这个模块，desktop-install 调用它，新服务跑安装包的运行目录（service.kind = "desktop"）：
//   情况 A  改名以前的安装：同上，只是新目录里可以已经有 App 自己的 runtime/、shell/（逐项移过去）；旧 plist 可以不在；
//           库的 schema 可以比安装包旧（新版本启动时升级它，停服务后另存一份 -stopped.db 给回滚用）。
//   情况 B  已经迁移、跑开发 checkout：oldDir 和 newDir 相同（「原地」），数据不动，只换 com.bytezard.plc.supervisor。
//           不做 scan、move、rewrite，不碰 Hindsight 的任务。
//   情况 C  已经是安装包、换了版本：同 B；回滚时还把 current 指回上一个版本。
//
// 有副作用的部分（launchctl、排空、等进程退出、放 Node、健康检查）由调用方注入，集成测试换成假的；文件和库用真的。
import Database from "better-sqlite3";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DESKTOP_APP_ENTRIES, PRE_RENAME_HINDSIGHT_LABEL, PRE_RENAME_SUPERVISOR_LABEL } from "@pi-lead-child/core";
import type { Locale } from "@pi-lead-child/protocol";
import { LATEST_SCHEMA_VERSION, ledgerGuardedTables, openExistingDb } from "@pi-lead-child/store";
import { backupSqlite } from "./backup.js";
import { dataDirMigrationMessages } from "./data-dir-migration.messages.js";
import { socketPathTooLong } from "./desktop-install.js";
import { HINDSIGHT_LABEL } from "./hindsight.js";
import { desktopPlistOptions, LAUNCHD_LABEL, plistContent } from "./launchd.js";
import { databaseSchemaVersion } from "./release.js";

export const DATA_DIR_MIGRATION_STEPS = [
  "precheck", "backup", "scan", "drain", "stop_old", "move", "rewrite", "start_new", "health", "done",
] as const;
export type DataDirMigrationStep = typeof DATA_DIR_MIGRATION_STEPS[number];
export type DataDirMigrationState = "running" | "done" | "failed" | "rollback" | "rolled_back";
export type DataDirMigrationCode =
  | "already_migrated" | "nothing_to_migrate"
  | "legacy_service_missing" | "target_not_empty" | "not_same_volume" | "disk_space" | "socket_path_too_long" | "schema_behind"
  | "schema_ahead"
  | "step_failed" | "rolled_back" | "rollback_failed";

export interface DataDirMigrationEvent {
  step: DataDirMigrationStep;
  state: DataDirMigrationState;
  message: string;
  code?: DataDirMigrationCode;
  backupPath?: string;
  scan?: PathScan;
}

/** 代码当作路径或命令来用的列：迁移时改写它们。表或列不存在时跳过（库可能比这份代码旧或新）。 */
export const LIVE_PATH_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ["runs", "session_path"],
  ["runs", "launcher"],
  ["workspaces", "path"],
  ["items", "workdir"],
  ["watches", "command"],
  ["widget_sources", "command"],
];

export interface ColumnHits { table: string; column: string; rows: number }
export interface PathScan {
  /** 要改写的列。 */
  rewrite: ColumnHits[];
  /** 历史记录：列出来，不改。 */
  history: ColumnHits[];
  /** config.json 里写着旧目录的设置项（键的路径，例如 env.FOO）。只列键，不列值。 */
  config: string[];
}

type Launchctl = (args: string[]) => Promise<{ ok: boolean; out: string }>;

/** 新的 supervisor 任务跑什么。 */
export type MigrationService =
  | {
    /** 开发 checkout（ops.mjs migrate-data-dir）。 */
    kind: "dev";
    /** 新 plist 的 WorkingDirectory。 */
    checkout: string;
    /** supervisor 的入口：<checkout>/apps/daemon/dist/supervisor.mjs。 */
    entry: string;
    /** 把开发机的 Node 复制到 <dataDir>/bin/lead-agent 并重签，建软链接。返回 plist 要写的软链接路径。 */
    placeAgent(dataDir: string): Promise<{ binary: string; launcher: string }>;
  }
  | {
    /** 安装包的运行目录（desktop-install 的接管，第 12 节）。 */
    kind: "desktop";
    /** <安装根>/current。plist 写它（desktopPlistOptions）。 */
    root: string;
    /** 情况 C：换版本以前的版本号（<安装根>/versions/<版本>）。回滚时把 current 指回它。 */
    previousVersion?: string;
  };

export interface DataDirMigrationDeps {
  /** 旧数据目录。和 newDir 相同时是「原地」接管：数据不动，只换服务（第 12 节情况 B、C，只用于 desktop）。 */
  oldDir: string;
  newDir: string;
  launchAgentsDir: string;
  service: MigrationService;
  uid: number;
  locale: Locale;
  launchctl: Launchctl;
  /** dir 所在磁盘的剩余字节数。 */
  freeBytes(dir: string): number;
  /** 等到能停服务：Lead 这一轮结束、没有接管不了的执行。等不到时抛错。 */
  drain(oldDir: string): Promise<void>;
  /** bootout 以后，等旧的 supervisor 和 daemon 都退出（两个 socket 都连不上）。等不到时抛错。 */
  waitStopped(oldDir: string): Promise<void>;
  /** 等新服务的 plc.sock 回答 status。等不到时抛错。 */
  health(newDir: string): Promise<void>;
  emit(event: DataDirMigrationEvent): void;
  now?: () => Date;
  /** 测试注入：每一步做完以后调用，抛错就是这一步之后出了故障。 */
  afterStep?(step: DataDirMigrationStep): void | Promise<void>;
}

export interface DataDirMigrationResult {
  ok: boolean;
  code?: DataDirMigrationCode;
  backupPath?: string;
  /** 失败以后回滚了（旧名字照常在用）。 */
  rolledBack?: boolean;
  /** 失败的原因原文（不带「失败：」这类前缀）。 */
  error?: string;
}

const CONFIG_FILE = "config.json";
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (name: string) => `"${name}"`;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 把 text 里的目录 from 换成 to。只换整段目录名：from 后面紧跟着字母、数字、点或连字符时（<from>-backup 这类）不算。 */
export function replaceDirPath(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`${escapeRegExp(from)}(?![\\w.-])`, "g"), () => to);
}

const containsDir = (text: string, dir: string) => replaceDirPath(text, dir, "\0") !== text;

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const missingOrEmpty = (dir: string) => entriesOf(dir).length === 0;

/** 用 from 覆盖库 db：先删掉 db 的 -wal、-shm，不然 SQLite 会把旧的 WAL 重放到恢复的库上。 */
function restoreDatabase(db: string, from: string): void {
  for (const suffix of ["-wal", "-shm"]) rmSync(`${db}${suffix}`, { force: true });
  copyFileSync(from, db);
}

/** 把 <安装根>/current 指到 versions/<version>：先建临时软链接，再 rename 覆盖，current 任何时候都在（和壳的 switchCurrent 一样）。 */
function pointCurrentAt(root: string, version: string): void {
  const temp = join(dirname(root), `.current-rollback-${process.pid}`);
  rmSync(temp, { force: true });
  symlinkSync(join("versions", version), temp);
  renameSync(temp, root);
}

/** 从 path 往上第一个存在的目录。 */
function existingAncestor(path: string): string {
  let dir = path;
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => IDENTIFIER.test(name));
}

function liveColumns(db: Database.Database): Array<readonly [string, string]> {
  const tables = new Set(ledgerGuardedTables(db));
  return LIVE_PATH_COLUMNS.filter(([table, column]) => tables.has(table) && columnsOf(db, table).includes(column));
}

/** 库里写着 dir 的列和行数。每张表扫一遍。表名和列名来自 sqlite_master，只接受普通标识符，再加双引号。 */
export function scanDatabase(dbPath: string, dir: string): { rewrite: ColumnHits[]; history: ColumnHits[] } {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const live = new Set(liveColumns(db).map(([table, column]) => `${table}.${column}`));
    const rewrite: ColumnHits[] = [];
    const history: ColumnHits[] = [];
    for (const table of ledgerGuardedTables(db)) {
      const columns = columnsOf(db, table);
      if (!columns.length) continue;
      const sums = columns
        .map((column, i) => `SUM(typeof(${quote(column)}) = 'text' AND instr(${quote(column)}, @dir) > 0) AS c${i}`)
        .join(", ");
      const row = db.prepare(`SELECT ${sums} FROM ${quote(table)}`).get({ dir }) as Record<string, number | null>;
      columns.forEach((column, i) => {
        const rows = row[`c${i}`] ?? 0;
        if (!rows) return;
        (live.has(`${table}.${column}`) ? rewrite : history).push({ table, column, rows });
      });
    }
    return { rewrite, history };
  } finally {
    db.close();
  }
}

/** 在一个事务里把要改写的列里的目录 from 换成 to。返回改了几行。 */
export function rewriteDatabase(dbPath: string, from: string, to: string): number {
  const db = openExistingDb(dbPath);
  try {
    let changed = 0;
    db.transaction(() => {
      for (const [table, column] of liveColumns(db)) {
        const rows = db.prepare(
          `SELECT rowid AS id, ${quote(column)} AS value FROM ${quote(table)} WHERE typeof(${quote(column)}) = 'text' AND instr(${quote(column)}, ?) > 0`,
        ).all(from) as Array<{ id: number; value: string }>;
        const update = db.prepare(`UPDATE ${quote(table)} SET ${quote(column)} = ? WHERE rowid = ?`);
        for (const row of rows) {
          const next = replaceDirPath(row.value, from, to);
          if (next === row.value) continue;
          update.run(next, row.id);
          changed += 1;
        }
      }
    })();
    return changed;
  } finally {
    db.close();
  }
}

/** 库的要改写的列里有没有 dir。 */
function databaseMentions(dbPath: string, dir: string): boolean {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return liveColumns(db).some(([table, column]) => db.prepare(
      `SELECT 1 FROM ${quote(table)} WHERE typeof(${quote(column)}) = 'text' AND instr(${quote(column)}, ?) > 0 LIMIT 1`,
    ).get(dir) !== undefined);
  } finally {
    db.close();
  }
}

/** config.json 里写着 dir 的设置项：键的路径。 */
export function configPaths(value: unknown, dir: string, prefix = ""): string[] {
  if (typeof value === "string") return containsDir(value, dir) ? [prefix || "(root)"] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => configPaths(item, dir, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => configPaths(item, dir, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

function replaceInJson(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return replaceDirPath(value, from, to);
  if (Array.isArray(value)) return value.map((item) => replaceInJson(item, from, to));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceInJson(item, from, to)]));
  }
  return value;
}

/** 原子地写文件：先写同目录的临时文件，再 rename。权限和原文件一样。 */
function writeAtomic(path: string, text: string, mode: number): void {
  const temp = `${path}.migrating`;
  writeFileSync(temp, text, { mode });
  renameSync(temp, path);
}

/** 旧的 Hindsight plist 换成新任务：Label 换成新的，旧目录（数据目录、日志、工作目录）换成新目录。 */
export function renameHindsightPlist(xml: string, oldDir: string, newDir: string): string {
  const labelled = xml.replace(
    `<key>Label</key><string>${PRE_RENAME_HINDSIGHT_LABEL}</string>`,
    `<key>Label</key><string>${HINDSIGHT_LABEL}</string>`,
  );
  return replaceDirPath(labelled, oldDir, newDir);
}

export async function runDataDirMigration(deps: DataDirMigrationDeps): Promise<DataDirMigrationResult> {
  const m = dataDirMigrationMessages(deps.locale);
  const { oldDir, newDir, service } = deps;
  const desktop = service.kind === "desktop";
  // 原地：数据已经在新目录里，只换 supervisor 任务（第 12.4、12.5 节）。
  const inPlace = oldDir === newDir;
  const oldDb = join(oldDir, "plc.db");
  const newDb = join(newDir, "plc.db");
  const oldSupervisorPlist = join(deps.launchAgentsDir, `${PRE_RENAME_SUPERVISOR_LABEL}.plist`);
  const oldHindsightPlist = join(deps.launchAgentsDir, `${PRE_RENAME_HINDSIGHT_LABEL}.plist`);
  const newSupervisorPlist = join(deps.launchAgentsDir, `${LAUNCHD_LABEL}.plist`);
  const newHindsightPlist = join(deps.launchAgentsDir, `${HINDSIGHT_LABEL}.plist`);
  // 要停的旧任务（Hindsight 在前，回滚时先起 Hindsight、再起 supervisor）。原地时只换 supervisor，Hindsight 的任务不动：
  // 新的 daemon 启动后按自己的命令重写它的 plist。
  const oldServices: ReadonlyArray<readonly [label: string, plist: string]> = inPlace
    ? [[LAUNCHD_LABEL, newSupervisorPlist]]
    : [[PRE_RENAME_HINDSIGHT_LABEL, oldHindsightPlist], [PRE_RENAME_SUPERVISOR_LABEL, oldSupervisorPlist]];
  const newLabels = inPlace ? [LAUNCHD_LABEL] : [LAUNCHD_LABEL, HINDSIGHT_LABEL];
  const suffix = inPlace ? ".pre-takeover" : ".pre-rename";
  const backupPrefix = !inPlace ? "pre-rename" : service.kind === "desktop" && service.previousVersion ? "pre-upgrade" : "pre-takeover";
  const gui = `gui/${deps.uid}`;
  const emit = (event: DataDirMigrationEvent) => deps.emit(event);
  const after = async (step: DataDirMigrationStep) => { await deps.afterStep?.(step); };

  // ── precheck：不过就退出，什么都不改 ──
  emit({ step: "precheck", state: "running", message: m.precheck.running });
  const stop = (code: DataDirMigrationCode, message: string, ok = false): DataDirMigrationResult => {
    emit({ step: "precheck", state: ok ? "done" : "failed", code, message });
    return { ok, code };
  };
  if (inPlace) {
    if (!desktop) throw new Error("an in-place migration only takes over for the desktop App");
    if (!existsSync(newSupervisorPlist)) return stop("legacy_service_missing", m.errors.legacyServiceMissing(newSupervisorPlist));
  } else {
    if (!existsSync(oldDir)) {
      return missingOrEmpty(newDir)
        ? stop("nothing_to_migrate", m.precheck.nothingToMigrate(newDir), true)
        : stop("already_migrated", m.precheck.alreadyMigrated(newDir), true);
    }
    // 接管时旧服务可以已经卸掉了：只搬数据。
    if (!desktop && !existsSync(oldSupervisorPlist)) return stop("legacy_service_missing", m.errors.legacyServiceMissing(oldSupervisorPlist));
    // 新目录里只能有 App 自己的项（接管时），旧目录里不能有同名的项。
    const inTarget = entriesOf(newDir);
    const allowed = desktop ? DESKTOP_APP_ENTRIES : [];
    if (inTarget.some((name) => !allowed.includes(name) || (name !== ".DS_Store" && existsSync(join(oldDir, name))))) {
      return stop("target_not_empty", m.errors.targetNotEmpty(newDir));
    }
    if (statSync(existingAncestor(newDir)).dev !== statSync(oldDir).dev) return stop("not_same_volume", m.errors.notSameVolume(oldDir, newDir));
  }
  const schemaBefore = databaseSchemaVersion(oldDb);
  // 安装包的新版本启动时会升级比它旧的库；开发 checkout 的迁移要求库已经是这份代码的版本。
  if (!desktop && schemaBefore !== LATEST_SCHEMA_VERSION) return stop("schema_behind", m.errors.schemaBehind(schemaBefore, LATEST_SCHEMA_VERSION));
  if (schemaBefore !== null && schemaBefore > LATEST_SCHEMA_VERSION) {
    return stop("schema_ahead", m.errors.schemaAhead(schemaBefore, LATEST_SCHEMA_VERSION));
  }
  // schema 要升级时，停服务后再存一份库给回滚用：空间按两份算。
  const upgradesSchema = desktop && schemaBefore !== null && schemaBefore < LATEST_SCHEMA_VERSION;
  const needed = (existsSync(oldDb) ? statSync(oldDb).size : 0) * (upgradesSchema ? 2 : 1);
  const free = deps.freeBytes(existingAncestor(newDir));
  if (free < needed) return stop("disk_space", m.errors.diskSpace(needed, free));
  const tooLong = socketPathTooLong(newDir);
  if (tooLong) return stop("socket_path_too_long", m.errors.socketPathTooLong(tooLong.path, tooLong.bytes));
  emit({ step: "precheck", state: "done", message: m.precheck.done(oldDir, newDir) });

  // ── 回滚要用的状态 ──
  // 备份的路径相对数据目录记：移动以后跟着到新目录下面。
  let backupRel: string | undefined;
  let stoppedRel: string | undefined;
  let stopStarted = false;
  let oldPlistsMoved: string[] = [];
  let moved = false;
  // 逐项移动时移过去的项（新目录里已经有 App 的文件）；整个目录 rename 时为 null。
  let movedEntries: string[] | null = null;
  let oldDirMode = 0o700;
  let databaseRewritten = false;
  let configBefore: { text: string; mode: number } | null = null;
  let configRewritten = false;
  let agentPlaced: string[] = [];
  let newPlistsWritten: string[] = [];
  const restoreFromBackup = !inPlace && existsSync(oldDb) && databaseMentions(oldDb, newDir);
  const dirNow = () => (moved ? newDir : oldDir);
  const backupPath = () => (backupRel ? join(dirNow(), backupRel) : undefined);
  const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");

  const fail = async (step: DataDirMigrationStep, error: unknown): Promise<DataDirMigrationResult> => {
    const message = error instanceof Error ? error.message : String(error);
    emit({ step, state: "failed", code: "step_failed", message: m.errors.step(message) });
    if (!stopStarted) return { ok: false, code: "step_failed", backupPath: backupPath(), error: message };
    try {
      await rollback(step);
      emit({ step, state: "rolled_back", code: "rolled_back", message: m.rollback.done });
      return { ok: false, code: "rolled_back", backupPath: backupPath(), rolledBack: true, error: message };
    } catch (rollbackError) {
      const detail = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      emit({ step, state: "failed", code: "rollback_failed", message: m.rollback.failed(detail) });
      return { ok: false, code: "rollback_failed", backupPath: backupPath(), rolledBack: false, error: `${message}; ${detail}` };
    }
  };

  // 回滚的每一步都记一行。一步失败时记下来接着做别的，最后再报：能恢复的尽量恢复。
  const rollback = async (failedStep: DataDirMigrationStep): Promise<void> => {
    const problems: string[] = [];
    const attempt = async (what: string, action: () => Promise<void> | void) => {
      emit({ step: failedStep, state: "rollback", message: m.rollback.step(what) });
      try {
        await action();
      } catch (error) {
        problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    for (const label of newLabels) {
      await attempt(`bootout ${label}`, async () => { await deps.launchctl(["bootout", `${gui}/${label}`]); });
    }
    for (const plist of newPlistsWritten) await attempt(`rm ${plist}`, () => rmSync(plist, { force: true }));
    if (newPlistsWritten.length) await attempt(`wait for ${newDir}`, () => deps.waitStopped(newDir));
    for (const path of agentPlaced) await attempt(`rm ${join(dirNow(), path)}`, () => rmSync(join(dirNow(), path), { force: true }));
    const db = join(dirNow(), "plc.db");
    // 新版本启动时升级过库：旧代码打不开它，用停服务时存的那份覆盖（那份里还是旧目录，和迁移前一样）。
    const schemaChanged = stoppedRel !== undefined && existsSync(db) && databaseSchemaVersion(db) !== schemaBefore;
    if (schemaChanged) {
      const snapshot = join(dirNow(), stoppedRel!);
      await attempt(`restore ${db} from ${snapshot}`, () => restoreDatabase(db, snapshot));
    } else if (databaseRewritten) {
      const backup = backupPath();
      if (restoreFromBackup && backup) {
        await attempt(`restore ${db} from ${backup}`, () => restoreDatabase(db, backup));
      } else {
        await attempt(`rewrite ${db} back to ${oldDir}`, () => { rewriteDatabase(db, newDir, oldDir); });
      }
    }
    if (configRewritten && configBefore) {
      const config = join(dirNow(), CONFIG_FILE);
      const before = configBefore;
      await attempt(`restore ${config}`, () => writeAtomic(config, before.text, before.mode));
    }
    if (movedEntries) {
      // 移回新目录里除了 App 自己的项以外的全部：移过去以后才有的也算（start_new 建的 logs/），移过去的有的也没了
      // （SQLite 最后一个连接关闭时删掉 plc.db-wal、-shm）。新目录里留下别的项，开发机的代码就会改用新目录。
      const ours = (name: string) => DESKTOP_APP_ENTRIES.includes(name);
      await attempt(`mv the data in ${newDir} back to ${oldDir}`, () => {
        if (!existsSync(oldDir)) mkdirSync(oldDir, { mode: oldDirMode });
        for (const name of entriesOf(newDir)) {
          if (!ours(name)) renameSync(join(newDir, name), join(oldDir, name));
        }
      });
      moved = entriesOf(newDir).some((name) => !ours(name));
    } else if (moved) {
      await attempt(`mv ${newDir} ${oldDir}`, () => {
        renameSync(newDir, oldDir);
        moved = false;
      });
    }
    // 目录没能移回去时不拉起旧服务：它会在旧位置新建一个空的数据目录。plist 留着 .pre-rename，等人处理。
    if (moved) throw new Error([...problems, `${newDir} is still in the new place; the old service was not started`].join("; "));
    // 情况 C：旧服务跑的是上一个版本。
    if (service.kind === "desktop" && service.previousVersion) {
      const previous = service.previousVersion;
      await attempt(`point ${service.root} at versions/${previous}`, () => pointCurrentAt(service.root, previous));
    }
    for (const plist of oldPlistsMoved) {
      await attempt(`mv ${plist}${suffix} ${plist}`, () => renameSync(`${plist}${suffix}`, plist));
    }
    for (const [label, plist] of oldServices) {
      if (!existsSync(plist)) continue;
      await attempt(`bootstrap ${plist}`, async () => {
        const result = await deps.launchctl(["bootstrap", gui, plist]);
        // 已经加载着（例如 bootout 本身失败了）也算好。
        if (!result.ok && !(await deps.launchctl(["print", `${gui}/${label}`])).ok) throw new Error(result.out);
      });
    }
    if (problems.length) throw new Error(problems.join("; "));
  };

  let step: DataDirMigrationStep = "backup";
  let scan: PathScan = { rewrite: [], history: [], config: [] };
  let configJson: unknown = null;
  try {
    // ── backup：daemon 还在运行时在线备份 ──
    emit({ step, state: "running", message: m.backup.running });
    if (existsSync(oldDb)) {
      mkdirSync(join(oldDir, "backups"), { recursive: true });
      backupRel = join("backups", `${backupPrefix}-${stamp}.db`);
      await backupSqlite(oldDb, join(oldDir, backupRel));
    }
    // 原地接管：开发安装的 plist 也留一份，开发者要回到开发安装时参考（第 12.4 节）。
    if (inPlace) {
      mkdirSync(join(oldDir, "backups"), { recursive: true });
      copyFileSync(newSupervisorPlist, join(oldDir, "backups", `${backupPrefix}-${stamp}.supervisor.plist`));
    }
    emit({ step, state: "done", message: m.backup.done(backupPath() ?? "-"), ...(backupRel ? { backupPath: backupPath() } : {}) });
    await after(step);

    // ── scan ──（原地时没有要改的目录）
    if (!inPlace) {
      step = "scan";
      emit({ step, state: "running", message: m.scan.running });
      const db = existsSync(oldDb) ? scanDatabase(oldDb, oldDir) : { rewrite: [], history: [] };
      const configFile = join(oldDir, CONFIG_FILE);
      if (existsSync(configFile)) {
        const text = readFileSync(configFile, "utf8");
        configBefore = { text, mode: statSync(configFile).mode & 0o777 };
        configJson = JSON.parse(text);
      }
      scan = { ...db, config: configJson === null ? [] : configPaths(configJson, oldDir) };
      const rows = (hits: ColumnHits[]) => hits.reduce((sum, hit) => sum + hit.rows, 0);
      emit({ step, state: "done", message: m.scan.done(rows(scan.rewrite), rows(scan.history), scan.config.length), scan });
      await after(step);
    }

    // ── drain ──
    step = "drain";
    emit({ step, state: "running", message: m.drain.running });
    await deps.drain(oldDir);
    emit({ step, state: "done", message: m.drain.done });
    await after(step);

    // ── stop_old：从这里开始，失败就回滚 ──
    step = "stop_old";
    stopStarted = true;
    emit({ step, state: "running", message: m.stopOld.running });
    for (const [label] of [...oldServices].reverse()) {
      await deps.launchctl(["bootout", `${gui}/${label}`]);
    }
    await deps.waitStopped(oldDir);
    for (const [, plist] of oldServices) {
      if (!existsSync(plist)) continue;
      renameSync(plist, `${plist}${suffix}`);
      oldPlistsMoved = [...oldPlistsMoved, plist];
    }
    // 没有进程在写库了：这一份就是停服务时的原样。新版本会升级库，回滚时用它。
    if (upgradesSchema) {
      stoppedRel = join("backups", `${backupPrefix}-${stamp}-stopped.db`);
      await backupSqlite(oldDb, join(oldDir, stoppedRel));
    }
    emit({ step, state: "done", message: m.stopOld.done });
    await after(step);

    if (!inPlace) {
      // ── move ──
      step = "move";
      emit({ step, state: "running", message: m.move.running });
      if (missingOrEmpty(newDir)) {
        if (existsSync(newDir)) rmSync(newDir, { recursive: false, force: true }); // 空目录（precheck 查过）
        mkdirSync(dirname(newDir), { recursive: true });
        renameSync(oldDir, newDir);
        moved = true;
      } else {
        // 新目录里有 App 自己的 runtime/、shell/（precheck 查过，旧目录里没有同名的项）：逐项移过去，每一项都是原子的。
        oldDirMode = statSync(oldDir).mode & 0o7777;
        const entries: string[] = [];
        movedEntries = entries;
        moved = true;
        for (const name of readdirSync(oldDir)) {
          if (name === ".DS_Store" && existsSync(join(newDir, name))) {
            rmSync(join(oldDir, name), { force: true });
            continue;
          }
          renameSync(join(oldDir, name), join(newDir, name));
          entries.push(name);
        }
        rmdirSync(oldDir);
      }
      emit({ step, state: "done", message: m.move.done(newDir), ...(backupRel ? { backupPath: backupPath() } : {}) });
      await after(step);

      // ── rewrite ──
      step = "rewrite";
      emit({ step, state: "running", message: m.rewrite.running });
      let changed = 0;
      if (existsSync(newDb)) {
        databaseRewritten = true; // 事务失败时什么都没改，回滚照样改一遍也没有影响
        changed = rewriteDatabase(newDb, oldDir, newDir);
      }
      if (configBefore && configJson !== null && scan.config.length) {
        configRewritten = true;
        writeAtomic(join(newDir, CONFIG_FILE), `${JSON.stringify(replaceInJson(configJson, oldDir, newDir), null, 2)}\n`, configBefore.mode);
      }
      emit({ step, state: "done", message: m.rewrite.done(changed, scan.config.length) });
      await after(step);
    }

    // ── start_new ──
    step = "start_new";
    emit({ step, state: "running", message: m.startNew.running });
    const logDir = join(newDir, "logs");
    mkdirSync(logDir, { recursive: true });
    mkdirSync(deps.launchAgentsDir, { recursive: true });
    let supervisorPlist: string;
    if (service.kind === "dev") {
      const hadBin = new Set(existsSync(join(newDir, "bin")) ? readdirSync(join(newDir, "bin")) : []);
      const { launcher, binary } = await service.placeAgent(newDir);
      agentPlaced = [binary, launcher]
        .filter((path) => !hadBin.has(path.slice(join(newDir, "bin").length + 1)))
        .map((path) => path.slice(newDir.length + 1));
      supervisorPlist = plistContent({ nodeBin: launcher, entry: service.entry, cwd: service.checkout, logDir });
    } else {
      // 安装包里已经有改名重签的 Node（<安装根>/current/bin/Bytezard Lead），不复制开发机的 Node。
      supervisorPlist = plistContent(desktopPlistOptions(service.root, logDir));
    }
    const hindsightSource = `${oldHindsightPlist}${suffix}`;
    if (!inPlace && existsSync(hindsightSource)) {
      writeFileSync(newHindsightPlist, renameHindsightPlist(readFileSync(hindsightSource, "utf8"), oldDir, newDir));
      newPlistsWritten = [...newPlistsWritten, newHindsightPlist];
    }
    writeFileSync(newSupervisorPlist, supervisorPlist);
    newPlistsWritten = [...newPlistsWritten, newSupervisorPlist];
    for (const plist of newPlistsWritten) {
      const result = await deps.launchctl(["bootstrap", gui, plist]);
      if (!result.ok) throw new Error(`launchctl bootstrap ${plist}: ${result.out}`);
    }
    emit({ step, state: "done", message: m.startNew.done });
    await after(step);

    // ── health ──
    step = "health";
    emit({ step, state: "running", message: m.health.running });
    await deps.health(newDir);
    // 安装包的 daemon 启动时把库升级到它的版本；开发 checkout 的迁移不改版本。
    const schemaExpected = desktop ? LATEST_SCHEMA_VERSION : schemaBefore;
    const schemaAfter = databaseSchemaVersion(newDb);
    if (schemaAfter !== schemaExpected) {
      throw new Error(`schema version: before=${schemaBefore ?? "unknown"}, expected=${schemaExpected ?? "unknown"}, after=${schemaAfter ?? "unknown"}`);
    }
    for (const plist of oldPlistsMoved) rmSync(`${plist}${suffix}`, { force: true });
    emit({ step, state: "done", message: m.health.done });
    await after(step);
  } catch (error) {
    return fail(step, error);
  }
  const backup = backupPath();
  emit({ step: "done", state: "done", message: m.done(newDir), ...(backup ? { backupPath: backup } : {}) });
  return { ok: true, backupPath: backup };
}
