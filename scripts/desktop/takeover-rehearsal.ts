// 自动接管的演练（docs/desktop/macos-desktop-design.md 第 12 节，#234）：在一份复制出来的数据上走 desktop-install 的完整流程，
// 核对接管前后的数据。只用传进来的临时 HOME，不碰这台机器上真的数据目录和 launchd 任务：launchctl、排空和等进程退出换成假的，
// 健康检查只读地查库（schema 版本和 quick_check），不启动 daemon。
//
//   node --import tsx scripts/desktop/takeover-rehearsal.ts --home <临时 HOME> [--fault start_new]
//
// <临时 HOME> 里先放好：.pi-lead-child/（数据的副本）和 Library/LaunchAgents/com.pi-lead-child.*.plist（plist 的副本，
// 里面的路径已经换成临时 HOME）。脚本自己在新数据目录里放一个假的运行包和 App 的 shell/，然后依次演练：
//   A  改名以前的安装 → 接管；B  再装一次同一个版本；C  plist 换成开发 checkout → 接管；D  运行包换了版本 → 重启。
// 带 --fault <步骤> 时只演练 A，并在这一步之后注入故障，核对回滚以后和原样一致。
// 输出一行 JSON：每一项核对的结果。不输出任何数据内容，只输出条数、哈希是否一致和文件个数。
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, statSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import {
  databaseSchemaVersion, HINDSIGHT_LABEL, LAUNCHD_LABEL, LIVE_PATH_COLUMNS, replaceDirPath, runDesktopInstall,
  type DataDirMigrationStep, type DesktopInstallDeps, type DesktopInstallEvent,
} from "@pi-lead-child/supervisor";
import { LATEST_SCHEMA_VERSION } from "@pi-lead-child/store";

const OLD_SUPERVISOR = "com.pi-lead-child.supervisor";
const OLD_HINDSIGHT = "com.pi-lead-child.hindsight";
// 大文件（旧的库备份）只比大小和修改时间，其余比内容。
const HASH_LIMIT = 64 * 1024 * 1024;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

type TableSnapshot = Record<string, { rows: number; hash: string }>;

/** 库里每张表的行数和内容哈希。from→to 给出时，先把要改写的列（LIVE_PATH_COLUMNS）里的目录换掉，和迁移做的一样。 */
function snapshotDb(path: string, rename?: { from: string; to: string }): TableSnapshot {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
      .map((row) => row.name).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
    const live = new Set(LIVE_PATH_COLUMNS.map(([table, column]) => `${table}.${column}`));
    const out: TableSnapshot = {};
    for (const table of tables) {
      let rows: Array<Record<string, unknown>>;
      try {
        rows = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Array<Record<string, unknown>>;
      } catch {
        rows = db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
      }
      const hash = createHash("sha256");
      for (const row of rows) {
        const values = Object.entries(row).map(([column, value]) => {
          if (rename && typeof value === "string" && live.has(`${table}.${column}`)) return replaceDirPath(value, rename.from, rename.to);
          return Buffer.isBuffer(value) ? value.toString("base64") : value;
        });
        hash.update(JSON.stringify(values));
        hash.update("\n");
      }
      out[table] = { rows: rows.length, hash: hash.digest("hex") };
    }
    return out;
  } finally {
    db.close();
  }
}

/** 数据目录里的文件：相对路径 → 内容哈希（大文件是大小和修改时间）。不看库本身、socket、App 自己的项和 logs/。 */
function snapshotFiles(dir: string): Record<string, string> {
  const skip = new Set(["runtime", "shell", "logs", "plc.db", "plc.db-wal", "plc.db-shm"]);
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const rel = relative(dir, path);
      if (at === dir && skip.has(name)) continue;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isSymbolicLink()) out[rel] = `link:${readlinkSync(path)}`;
      else if (stat.isFile()) out[rel] = stat.size > HASH_LIMIT ? `size:${stat.size}:${stat.mtimeMs}` : sha(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

/** 备份的库：先复制一份再读，不在备份旁边留下 -wal、-shm。 */
function snapshotCopy(path: string): TableSnapshot {
  const copy = join(mkdtempSync(join(tmpdir(), "plc-rehearsal-")), "copy.db");
  copyFileSync(path, copy);
  return snapshotDb(copy);
}

function slackConnections(path: string): number {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("SELECT COUNT(*) AS n FROM connections WHERE provider LIKE '%slack%'").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

function diff<T>(before: Record<string, T>, after: Record<string, T>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

const fakeRelease = (installRoot: string, version: string) => {
  const dir = join(installRoot, "versions", version);
  const files: Record<string, string> = { "bin/lead-agent": "node", "apps/daemon/dist/supervisor.mjs": "supervisor" };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  writeFileSync(join(dir, "release.json"), JSON.stringify({
    schema: 1, product: "bytezard-lead", version, arch: process.arch, schemaVersion: LATEST_SCHEMA_VERSION,
    files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, sha(content)])),
  }));
};

async function main(): Promise<void> {
  const homeArg = arg("--home");
  if (!homeArg) {
    console.error("用法：node --import tsx scripts/desktop/takeover-rehearsal.ts --home <临时 HOME> [--fault <步骤>]");
    process.exit(2);
  }
  const fault = arg("--fault") as DataDirMigrationStep | undefined;
  const home = resolve(homeArg);
  const oldDir = join(home, ".pi-lead-child");
  const newDir = join(home, "Library", "Application Support", "Bytezard Lead");
  const agents = join(home, "Library", "LaunchAgents");
  const installRoot = join(newDir, "runtime");
  const root = join(installRoot, "current");
  if (!existsSync(join(oldDir, "plc.db")) || !existsSync(join(agents, `${OLD_SUPERVISOR}.plist`))) {
    throw new Error(`${home} 里没有数据的副本或者旧 plist 的副本`);
  }
  // App 第一次打开时放进新目录的东西：shell/ 和解好的运行包。
  mkdirSync(join(newDir, "shell"), { recursive: true });
  writeFileSync(join(newDir, "shell", "lead-name.json"), "{\"name\":\"Paimon\"}\n");
  fakeRelease(installRoot, "1.3.0");
  if (!existsSync(root)) symlinkSync(join("versions", "1.3.0"), root);

  const labels = new Set([OLD_SUPERVISOR, OLD_HINDSIGHT]);
  const calls: string[] = [];
  const events: DesktopInstallEvent[] = [];
  const health = async (dir: string) => {
    const db = new Database(join(dir, "plc.db"), { readonly: true, fileMustExist: true });
    try {
      const check = db.pragma("quick_check", { simple: true });
      if (check !== "ok") throw new Error(`quick_check: ${String(check)}`);
    } finally {
      db.close();
    }
  };
  const deps: DesktopInstallDeps = {
    root, installRoot, dataDir: newDir, dbPath: join(newDir, "plc.db"),
    plistPath: join(agents, `${LAUNCHD_LABEL}.plist`),
    preRenamePlistPaths: [join(agents, `${OLD_SUPERVISOR}.plist`)],
    preRenameDataDir: oldDir,
    takeover: {
      launchAgentsDir: agents,
      uid: process.getuid!(),
      launchctl: async (args) => {
        const label = args[0] === "bootstrap"
          ? /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(args[2]!, "utf8"))![1]!
          : args[1]!.split("/").at(-1)!;
        calls.push(`launchctl ${args[0]} ${label}`);
        if (args[0] === "bootout") return { ok: labels.delete(label), out: "" };
        if (args[0] === "bootstrap") { labels.add(label); return { ok: true, out: "" }; }
        return { ok: labels.has(label), out: "" };
      },
      freeBytes: () => Number.MAX_SAFE_INTEGER,
      drain: async () => { calls.push("drain"); },
      waitStopped: async () => {},
      health,
      ...(fault ? { afterStep: (step: DataDirMigrationStep) => { if (step === fault) throw new Error(`rehearsal fault after ${step}`); } } : {}),
    },
    locale: "zh",
    emit: (event) => events.push(event),
    captureLoginShellPath: async () => ({ state: "timed_out", shell: "/bin/zsh" }),
    launchd: {
      loaded: async () => labels.has(LAUNCHD_LABEL),
      stopRunning: async () => { calls.push("stop"); labels.delete(LAUNCHD_LABEL); },
      bootstrap: async () => { calls.push("bootstrap"); labels.add(LAUNCHD_LABEL); },
    },
    supervisor: { waitUntilAvailable: async () => labels.has(LAUNCHD_LABEL), ensureRunning: async () => {} },
    daemon: { waitForStatus: async () => (labels.has(LAUNCHD_LABEL) ? { gatewayUrl: "http://127.0.0.1:47131" } : null) },
  };

  const report: Record<string, unknown> = {};
  const dbBefore = snapshotDb(join(oldDir, "plc.db"));
  const dbBeforeRenamed = snapshotDb(join(oldDir, "plc.db"), { from: oldDir, to: newDir });
  const filesBefore = snapshotFiles(oldDir);
  const configBefore = readFileSync(join(oldDir, "config.json"), "utf8");
  const hindsightPlistBefore = readFileSync(join(agents, `${OLD_HINDSIGHT}.plist`), "utf8");
  const schemaBefore = databaseSchemaVersion(join(oldDir, "plc.db"));
  const counted = (snapshot: TableSnapshot) => Object.fromEntries(
    ["items", "notes", "connections", "channel_lanes", "channel_cards", "memory_sync", "kv", "triggers", "watches", "standing_orders"]
      .filter((table) => snapshot[table]).map((table) => [table, snapshot[table]!.rows]),
  );
  report.schemaBefore = schemaBefore;
  report.slackConnectionsBefore = slackConnections(join(oldDir, "plc.db"));
  report.rowsBefore = counted(dbBefore);
  report.tables = Object.keys(dbBefore).length;
  report.files = Object.keys(filesBefore).length;

  // ── A：改名以前的安装 ──
  const a = await runDesktopInstall(deps);
  report.a = { result: a, phases: events.filter((event) => event.step === "takeover").map((event) => event.phase ?? event.state) };
  if (fault) {
    // 回滚以后：旧目录、库、文件、config.json 和旧任务都和原样一致，新目录里只剩 App 的项。
    report.rollback = {
      dbDiff: diff(dbBefore, snapshotDb(join(oldDir, "plc.db"))),
      fileDiff: diff(filesBefore, snapshotFiles(oldDir)),
      configSame: readFileSync(join(oldDir, "config.json"), "utf8") === configBefore,
      newDirEntries: readdirSync(newDir).sort(),
      oldPlists: [OLD_SUPERVISOR, OLD_HINDSIGHT].map((label) => existsSync(join(agents, `${label}.plist`))),
      labels: [...labels].sort(),
      lastError: events.at(-1)?.message,
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const afterA = snapshotDb(join(newDir, "plc.db"));
  const configAfter = JSON.parse(readFileSync(join(newDir, "config.json"), "utf8")) as unknown;
  const replaceAll = (value: unknown): unknown => typeof value === "string" ? replaceDirPath(value, oldDir, newDir)
    : Array.isArray(value) ? value.map(replaceAll)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceAll(item)]))
    : value;
  const filesAfterA = snapshotFiles(newDir);
  // 这次接管新建的备份（副本里可能已经有以前迁移留下的 pre-rename 备份）。
  const backups = readdirSync(join(newDir, "backups")).filter((name) => !(join("backups", name) in filesBefore));
  report.afterA = {
    oldDirGone: !existsSync(oldDir),
    schemaAfter: databaseSchemaVersion(join(newDir, "plc.db")),
    rowsAfter: counted(afterA),
    dbDiff: diff(dbBeforeRenamed, afterA),
    fileDiff: diff(filesBefore, filesAfterA).filter((path) => !backups.some((name) => path === join("backups", name))),
    configSameAfterRename: JSON.stringify(configAfter) === JSON.stringify(replaceAll(JSON.parse(configBefore))),
    configKeysSame: JSON.stringify(Object.keys(configAfter as object)) === JSON.stringify(Object.keys(JSON.parse(configBefore) as object)),
    newBackups: backups.length,
    backupMatchesDbBefore: diff(dbBefore, snapshotCopy(join(newDir, "backups", backups.find((name) => name.endsWith(".db"))!))).length === 0,
    slackConnectionsAfter: slackConnections(join(newDir, "plc.db")),
    hindsightPlist: readFileSync(join(agents, `${HINDSIGHT_LABEL}.plist`), "utf8")
      === replaceDirPath(hindsightPlistBefore.replace(`<string>${OLD_HINDSIGHT}</string>`, `<string>${HINDSIGHT_LABEL}</string>`), oldDir, newDir),
    supervisorPlistAtRuntime: readFileSync(join(agents, `${LAUNCHD_LABEL}.plist`), "utf8").includes(`<key>WorkingDirectory</key><string>${root}</string>`),
    oldPlistsGone: [OLD_SUPERVISOR, OLD_HINDSIGHT].every((label) => !existsSync(join(agents, `${label}.plist`)) && !existsSync(join(agents, `${label}.plist.pre-rename`))),
    labels: [...labels].sort(),
    installedVersion: (JSON.parse(readFileSync(join(installRoot, "install-state.json"), "utf8")) as { installedVersion?: string }).installedVersion,
  };

  // ── B：再装一次同一个版本：不迁移，数据不变 ──
  events.length = 0;
  calls.length = 0;
  const b = await runDesktopInstall(deps);
  report.secondInstall = {
    result: b,
    takeover: events.find((event) => event.step === "takeover")?.state,
    launchctlCalls: calls.filter((call) => call.startsWith("launchctl")).length,
    dbDiff: diff(afterA, snapshotDb(join(newDir, "plc.db"))),
    fileDiff: diff(filesAfterA, snapshotFiles(newDir)),
  };

  // ── C：plist 换成开发 checkout（开发者在 checkout 里运行过 ops.mjs install）──
  const checkout = join(home, "src", "plc");
  mkdirSync(join(checkout, ".git"), { recursive: true });
  writeFileSync(join(checkout, "README.md"), "checkout\n");
  const checkoutBefore = snapshotFiles(checkout);
  writeFileSync(join(agents, `${LAUNCHD_LABEL}.plist`), readFileSync(join(agents, `${LAUNCHD_LABEL}.plist`), "utf8").split(root).join(checkout));
  events.length = 0;
  calls.length = 0;
  const c = await runDesktopInstall(deps);
  report.devTakeover = {
    result: c,
    phases: events.filter((event) => event.step === "takeover").map((event) => event.phase ?? event.state),
    launchctl: calls.filter((call) => call.startsWith("launchctl")),
    plistAtRuntime: readFileSync(join(agents, `${LAUNCHD_LABEL}.plist`), "utf8").includes(`<key>WorkingDirectory</key><string>${root}</string>`),
    checkoutUnchanged: diff(checkoutBefore, snapshotFiles(checkout)).length === 0,
    dbDiff: diff(afterA, snapshotDb(join(newDir, "plc.db"))),
    fileDiff: diff(filesAfterA, snapshotFiles(newDir)).filter((path) => !path.startsWith("backups/pre-takeover-")),
    backups: readdirSync(join(newDir, "backups")).filter((name) => name.startsWith("pre-takeover-")).map((name) => name.replace(/^pre-takeover-[^.]*/, "pre-takeover-<时间>")),
  };

  // ── D：运行包换了版本 ──
  fakeRelease(installRoot, "1.4.0");
  const temp = join(installRoot, ".current-rehearsal");
  symlinkSync(join("versions", "1.4.0"), temp);
  renameSync(temp, root);
  events.length = 0;
  calls.length = 0;
  const d = await runDesktopInstall(deps);
  report.upgrade = {
    result: d,
    detect: events.find((event) => event.step === "detect" && event.state === "done")?.message,
    restarted: calls.includes(`launchctl bootstrap ${LAUNCHD_LABEL}`),
    installedVersion: (JSON.parse(readFileSync(join(installRoot, "install-state.json"), "utf8")) as { installedVersion?: string }).installedVersion,
    dbDiff: diff(afterA, snapshotDb(join(newDir, "plc.db"))),
  };
  report.dataDirMode = (statSync(newDir).mode & 0o777).toString(8);
  console.log(JSON.stringify(report, null, 2));
}

await main();
