// 开发机迁到新名字（docs/desktop/macos-desktop-design.md 第 10 节 P0-8）。文件、目录和库都是真的（临时 home 下面），
// launchctl、排空、等进程退出和健康检查换成假的。故障用 afterStep 注入：某一步做完以后抛错。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createItem, createRun, openDb } from "@pi-lead-child/store";
import { installAgentBinary } from "../src/deploy/agent-binary.js";
import {
  configPaths, replaceDirPath, runDataDirMigration,
  type DataDirMigrationDeps, type DataDirMigrationEvent, type DataDirMigrationStep,
} from "../src/deploy/data-dir-migration.js";
import { plistWorkingDirectory } from "../src/deploy/launchd.js";
import { fakeHome } from "./desktop-fixtures.js";

const OLD_SUPERVISOR = "com.pi-lead-child.supervisor";
const OLD_HINDSIGHT = "com.pi-lead-child.hindsight";
const NEW_SUPERVISOR = "com.bytezard.plc.supervisor";
const NEW_HINDSIGHT = "com.bytezard.plc.hindsight";

const plist = (label: string, dataDir: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/alice/src/plc/apps/daemon/dist/hindsight.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PLC_DATA_DIR</key><string>${dataDir}</string>
  </dict>
  <key>WorkingDirectory</key><string>${dataDir}/hindsight</string>
  <key>StandardOutPath</key><string>${dataDir}/logs/hindsight.out.log</string>
</dict>
</plist>
`;

interface Snapshot {
  items: unknown[];
  runs: unknown[];
  counts: Record<string, number>;
  config: string;
}

function fixture() {
  const { home, dataDir: newDir } = fakeHome("plc-migrate-");
  const oldDir = join(home, ".pi-lead-child");
  const agents = join(home, "Library", "LaunchAgents");
  const checkout = join(home, "src", "plc");
  mkdirSync(oldDir, { recursive: true });
  mkdirSync(agents, { recursive: true });

  const db = openDb(join(oldDir, "plc.db"));
  const itemId = createItem(db, { title: "t", brief: "b", createdBy: "user" });
  db.prepare("UPDATE items SET workdir=?, body=? WHERE id=?")
    .run(join(oldDir, "light-tasks", "1-a"), `The log is in ${oldDir}/logs/daemon.log`, itemId);
  const runId = createRun(db, { itemId });
  db.prepare("UPDATE runs SET session_path=?, launcher=? WHERE id=?")
    .run(join(oldDir, "runtime-events", `run-${runId}.jsonl`), JSON.stringify({ dir: join(oldDir, "launches", "r1") }), runId);
  db.close();

  // 值是假的，测试只看路径。
  writeFileSync(join(oldDir, "config.json"), `${JSON.stringify({
    env: { EXAMPLE_FLAG: "on" },
    skills: { dir: join(oldDir, "skills") },
    sibling: `${oldDir}-backup/x`,
  }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(agents, `${OLD_SUPERVISOR}.plist`), plist(OLD_SUPERVISOR, oldDir));
  writeFileSync(join(agents, `${OLD_HINDSIGHT}.plist`), plist(OLD_HINDSIGHT, oldDir));

  // 假的 launchd：bootstrap 读 plist 的 Label 记成已加载，bootout 去掉。和真的 launchd 一样：bootout 以后任务还要卸载一会儿
  // （unloadPolls：print 还能看到它几次），同一个 label 已加载或者还在卸载时，bootstrap 返回 error 5。
  const loaded = new Set([OLD_SUPERVISOR, OLD_HINDSIGHT]);
  const unloading = new Map<string, number>();
  const calls: string[] = [];
  let failBootstrapOf: string | null = null;
  let unloadPolls = 0;
  const launchctl = async (args: string[]) => {
    if (args[0] !== "print") calls.push(args.join(" "));
    const target = args[0] === "bootstrap"
      ? /<key>Label<\/key><string>([^<]+)<\/string>/.exec(readFileSync(args[2]!, "utf8"))![1]!
      : args[1]!.split("/").at(-1)!;
    if (args[0] === "bootout") {
      const was = loaded.delete(target);
      if (was && unloadPolls > 0) unloading.set(target, unloadPolls);
      return { ok: was, out: was ? "" : "Could not find service" };
    }
    if (args[0] === "bootstrap") {
      if (target === failBootstrapOf || loaded.has(target) || unloading.has(target)) {
        return { ok: false, out: "Bootstrap failed: 5: Input/output error" };
      }
      loaded.add(target);
      return { ok: true, out: "" };
    }
    const left = unloading.get(target);
    if (left !== undefined) {
      if (left <= 1) unloading.delete(target);
      else unloading.set(target, left - 1);
      return { ok: true, out: "" };
    }
    return { ok: loaded.has(target), out: "" };
  };

  const events: DataDirMigrationEvent[] = [];
  const deps = (over: Partial<DataDirMigrationDeps> = {}): DataDirMigrationDeps => ({
    oldDir, newDir, launchAgentsDir: agents,
    service: {
      kind: "dev", checkout, entry: join(checkout, "apps", "daemon", "dist", "supervisor.mjs"),
      placeAgent: (dir) => installAgentBinary({ root: dir, placeBinary: (dest) => writeFileSync(dest, "node"), sign: async () => {} }),
    },
    uid: 501, locale: "en", launchctl,
    freeBytes: () => 1e12,
    drain: async () => {},
    waitStopped: async () => {},
    health: async () => {},
    emit: (event) => events.push(event),
    now: () => new Date("2026-11-04T10:00:00Z"),
    sleep: async () => {},
    ...over,
  });

  const snapshot = (dir: string): Snapshot => {
    const ledger = openDb(join(dir, "plc.db"));
    try {
      const counts = Object.fromEntries(["items", "runs", "events", "workspaces"].map((table) =>
        [table, (ledger.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]));
      return {
        items: ledger.prepare("SELECT id, workdir, body FROM items ORDER BY id").all(),
        runs: ledger.prepare("SELECT id, session_path, launcher FROM runs ORDER BY id").all(),
        counts,
        config: readFileSync(join(dir, "config.json"), "utf8"),
      };
    } finally {
      ledger.close();
    }
  };

  return {
    home, oldDir, newDir, agents, checkout, loaded, unloading, calls, events, deps, snapshot,
    failBootstrap: (label: string | null) => { failBootstrapOf = label; },
    /** bootout 以后，print 还能看到这个任务几次（还在卸载）。 */
    unloadSlowly: (polls: number) => { unloadPolls = polls; },
  };
}

describe("replaceDirPath", () => {
  it("replaces the folder only as a whole path segment", () => {
    const from = "/Users/alice/.pi-lead-child";
    const to = "/Users/alice/Library/Application Support/Bytezard Lead";
    expect(replaceDirPath(`${from}/plc.db`, from, to)).toBe(`${to}/plc.db`);
    expect(replaceDirPath(from, from, to)).toBe(to);
    expect(replaceDirPath(`{"dir":"${from}"}`, from, to)).toBe(`{"dir":"${to}"}`);
    expect(replaceDirPath(`${from}-backup/x`, from, to)).toBe(`${from}-backup/x`);
    expect(replaceDirPath(`${from}.old`, from, to)).toBe(`${from}.old`);
  });

  it("lists the config keys that hold the folder, without the values", () => {
    expect(configPaths({ a: { b: "/x/.pi-lead-child/s" }, c: ["/x/.pi-lead-child"], d: "/x/.pi-lead-child-2" }, "/x/.pi-lead-child"))
      .toEqual(["a.b", "c[0]"]);
  });
});

describe("runDataDirMigration", () => {
  it("does nothing on a new Mac with no old folder", async () => {
    const f = fixture();
    const result = await runDataDirMigration(f.deps({ oldDir: join(f.home, "none") }));
    expect(result).toEqual({ ok: true, code: "nothing_to_migrate" });
    expect(existsSync(f.newDir)).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it("moves the folder, updates the live paths, and switches to the new launchd tasks", async () => {
    const f = fixture();
    const before = f.snapshot(f.oldDir);
    const result = await runDataDirMigration(f.deps());

    expect(result.ok).toBe(true);
    // 迁移前有在线备份，路径写在输出里；移动以后备份跟着到了新目录。
    expect(result.backupPath).toBe(join(f.newDir, "backups", "pre-rename-2026-11-04T10-00-00-000Z.db"));
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(f.events.find((event) => event.step === "backup" && event.state === "done")?.backupPath)
      .toBe(join(f.oldDir, "backups", "pre-rename-2026-11-04T10-00-00-000Z.db"));

    expect(existsSync(f.oldDir)).toBe(false);
    const after = f.snapshot(f.newDir);
    expect(after.counts).toEqual(before.counts);
    // 代码当路径用的列改了；历史记录（items.body）照旧。
    expect(after.items).toEqual([{
      id: 1, workdir: join(f.newDir, "light-tasks", "1-a"), body: `The log is in ${f.oldDir}/logs/daemon.log`,
    }]);
    expect(after.runs).toEqual([{
      id: 1, session_path: join(f.newDir, "runtime-events", "run-1.jsonl"), launcher: JSON.stringify({ dir: join(f.newDir, "launches", "r1") }),
    }]);
    const config = JSON.parse(after.config);
    expect(config).toEqual({ env: { EXAMPLE_FLAG: "on" }, skills: { dir: join(f.newDir, "skills") }, sibling: `${f.oldDir}-backup/x` });
    expect(statSync(join(f.newDir, "config.json")).mode & 0o777).toBe(0o600);

    const scan = f.events.find((event) => event.step === "scan" && event.state === "done")!.scan!;
    expect(scan.rewrite).toEqual(expect.arrayContaining([
      { table: "items", column: "workdir", rows: 1 }, { table: "runs", column: "session_path", rows: 1 }, { table: "runs", column: "launcher", rows: 1 },
    ]));
    expect(scan.history).toContainEqual({ table: "items", column: "body", rows: 1 });
    expect(scan.config).toEqual(["skills.dir"]);

    // 新的 supervisor 装好、旧任务停了；旧 plist 在健康检查通过后删掉。Hindsight 由 supervisor 运行，没有独立的任务。
    expect([...f.loaded]).toEqual([NEW_SUPERVISOR]);
    expect(existsSync(join(f.agents, `${OLD_SUPERVISOR}.plist`))).toBe(false);
    expect(existsSync(join(f.agents, `${OLD_SUPERVISOR}.plist.pre-rename`))).toBe(false);
    expect(existsSync(join(f.agents, `${OLD_HINDSIGHT}.plist.pre-rename`))).toBe(false);
    const supervisor = readFileSync(join(f.agents, `${NEW_SUPERVISOR}.plist`), "utf8");
    expect(supervisor).toContain(`<key>Label</key><string>${NEW_SUPERVISOR}</string>`);
    expect(supervisor).toContain(`<string>${join(f.newDir, "bin", "Bytezard Lead")}</string>`);
    expect(supervisor).toContain(`<string>${join(f.checkout, "apps", "daemon", "dist", "supervisor.mjs")}</string>`);
    expect(plistWorkingDirectory(supervisor)).toBe(f.checkout);
    expect(supervisor).toContain(join(f.newDir, "logs", "supervisor.out.log"));
    expect(existsSync(join(f.agents, `${NEW_HINDSIGHT}.plist`))).toBe(false);
    // 开发机的 Node 副本和登录项显示的软链接。
    expect(readFileSync(join(f.newDir, "bin", "lead-agent"), "utf8")).toBe("node");
    expect(f.calls).toEqual([
      `bootout gui/501/${OLD_SUPERVISOR}`, `bootout gui/501/${OLD_HINDSIGHT}`,
      `bootstrap gui/501 ${join(f.agents, `${NEW_SUPERVISOR}.plist`)}`,
    ]);
  });

  it("reports that the Mac is already migrated when it runs again, and changes nothing", async () => {
    const f = fixture();
    expect((await runDataDirMigration(f.deps())).ok).toBe(true);
    const calls = f.calls.length;
    const again = await runDataDirMigration(f.deps());
    expect(again).toEqual({ ok: true, code: "already_migrated" });
    expect(f.calls.length).toBe(calls);
    expect(f.events.at(-1)).toMatchObject({ step: "precheck", state: "done", code: "already_migrated" });
  });

  it.each([
    ["target_not_empty", (f: ReturnType<typeof fixture>) => {
      mkdirSync(f.newDir, { recursive: true });
      writeFileSync(join(f.newDir, "stray"), "x");
      return {};
    }],
    ["legacy_service_missing", (f: ReturnType<typeof fixture>) => {
      return { launchAgentsDir: join(f.home, "elsewhere") };
    }],
    ["disk_space", () => ({ freeBytes: () => 0 })],
    ["socket_path_too_long", (f: ReturnType<typeof fixture>) => ({ newDir: join(f.home, "x".repeat(120)) })],
  ] as const)("refuses before changing anything: %s", async (code, setup) => {
    const f = fixture();
    const before = f.snapshot(f.oldDir);
    const result = await runDataDirMigration(f.deps(setup(f)));
    expect(result).toEqual({ ok: false, code });
    expect(f.calls).toEqual([]);
    expect(f.snapshot(f.oldDir)).toEqual(before);
    expect(existsSync(join(f.oldDir, "backups"))).toBe(false);
  });

  it("stops before the stop when the database version is not the one this code expects", async () => {
    const f = fixture();
    const db = openDb(join(f.oldDir, "plc.db"));
    db.prepare("DELETE FROM schema_migrations WHERE version = (SELECT MAX(version) FROM schema_migrations)").run();
    db.close();
    const result = await runDataDirMigration(f.deps());
    expect(result).toEqual({ ok: false, code: "schema_behind" });
    expect(f.calls).toEqual([]);
  });

  // 注入的故障：备份后、bootout 后、移动目录后、改写路径后、新服务起不来、新服务健康检查失败。
  // 每种情况都回到旧名字：旧目录、旧 plist、旧任务都在，数据和迁移前一样；然后能重新迁移。
  const faults: Array<[string, (f: ReturnType<typeof fixture>) => Partial<DataDirMigrationDeps>]> = [
    ["after the backup", () => ({ afterStep: failAfter("backup") })],
    ["after the bootout", () => ({ afterStep: failAfter("stop_old") })],
    ["after the move", () => ({ afterStep: failAfter("move") })],
    ["after the path rewrite", () => ({ afterStep: failAfter("rewrite") })],
    ["when the new service does not start", (f) => { f.failBootstrap(NEW_SUPERVISOR); return {}; }],
    ["when the new service fails the health check", () => ({ health: async () => { throw new Error("plc.sock did not answer"); } })],
  ];

  it.each(faults)("rolls back to the old names %s, and can migrate again", async (_name, inject) => {
    const f = fixture();
    const before = f.snapshot(f.oldDir);
    const result = await runDataDirMigration(f.deps(inject(f)));

    expect(result.ok).toBe(false);
    expect(existsSync(f.newDir)).toBe(false);
    expect(f.snapshot(f.oldDir)).toEqual(before);
    expect(statSync(join(f.oldDir, "config.json")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(f.oldDir, "bin", "lead-agent"))).toBe(false);
    expect(existsSync(join(f.agents, `${OLD_SUPERVISOR}.plist`))).toBe(true);
    expect(existsSync(join(f.agents, `${OLD_HINDSIGHT}.plist`))).toBe(true);
    expect(existsSync(join(f.agents, `${NEW_SUPERVISOR}.plist`))).toBe(false);
    expect(existsSync(join(f.agents, `${NEW_HINDSIGHT}.plist`))).toBe(false);
    // 旧服务照常在跑（备份后失败时根本没停过它）。
    expect([...f.loaded].sort()).toEqual([OLD_HINDSIGHT, OLD_SUPERVISOR]);
    if (result.code === "rolled_back") {
      expect(f.events.filter((event) => event.state === "rollback").length).toBeGreaterThan(0);
    } else {
      expect(result.code).toBe("step_failed");
    }
    // 备份照样在，路径写在输出里。
    expect(result.backupPath).toBe(join(f.oldDir, "backups", "pre-rename-2026-11-04T10-00-00-000Z.db"));
    expect(existsSync(result.backupPath!)).toBe(true);

    f.failBootstrap(null);
    const again = await runDataDirMigration(f.deps());
    expect(again.ok).toBe(true);
    expect(existsSync(f.oldDir)).toBe(false);
    expect([...f.loaded]).toEqual([NEW_SUPERVISOR]);
  });

  // #261：App 1.1.3 接管时 bootstrap com.bytezard.plc.hindsight 返回 5，整次接管回滚。同名的独立 Hindsight 任务是以前的版本
  // 留下的：还加载着，或者刚被 bootout、还在卸载。现在迁移不再起这个任务，只把它停掉、删掉 plist。
  it.each([
    ["is still loaded", (f: ReturnType<typeof fixture>) => { f.loaded.add(NEW_HINDSIGHT); }],
    ["is still unloading", (f: ReturnType<typeof fixture>) => { f.unloading.set(NEW_HINDSIGHT, 3); }],
  ] as const)("migrates when a com.bytezard.plc.hindsight job from an earlier attempt %s", async (_name, leftover) => {
    const f = fixture();
    writeFileSync(join(f.agents, `${NEW_HINDSIGHT}.plist`), plist(NEW_HINDSIGHT, f.newDir));
    leftover(f);
    f.unloadSlowly(3);

    const result = await runDataDirMigration(f.deps());
    expect(result).toMatchObject({ ok: true });
    expect([...f.loaded]).toEqual([NEW_SUPERVISOR]);
    expect(f.unloading.size).toBe(0);
    expect(existsSync(join(f.agents, `${NEW_HINDSIGHT}.plist`))).toBe(false);
    expect(f.calls.some((call) => call.startsWith("bootstrap") && call.includes(NEW_HINDSIGHT))).toBe(false);
  });

  it("waits for a com.bytezard.plc.supervisor job from an earlier attempt to unload before it starts the new one", async () => {
    const f = fixture();
    f.loaded.add(NEW_SUPERVISOR);
    f.unloadSlowly(3);
    const result = await runDataDirMigration(f.deps());
    expect(result).toMatchObject({ ok: true });
    expect(f.calls.slice(-2)).toEqual([`bootout gui/501/${NEW_SUPERVISOR}`, `bootstrap gui/501 ${join(f.agents, `${NEW_SUPERVISOR}.plist`)}`]);
    expect([...f.loaded]).toEqual([NEW_SUPERVISOR]);
  });

  it("starts the old Hindsight again on rollback even when its job is still unloading", async () => {
    const f = fixture();
    // 旧任务卸载得很慢：stop_old 等它卸载完；回滚时也要等，不然 bootstrap 返回 5，旧的 Hindsight 就没起来。
    f.unloadSlowly(3);
    const result = await runDataDirMigration(f.deps({ health: async () => { throw new Error("plc.sock did not answer"); } }));
    expect(result.code).toBe("rolled_back");
    expect([...f.loaded].sort()).toEqual([OLD_HINDSIGHT, OLD_SUPERVISOR]);
  });

  it("does not start the old service when the folder cannot move back", async () => {
    const f = fixture();
    const result = await runDataDirMigration(f.deps({
      afterStep: (step) => {
        if (step !== "move") return;
        // 旧位置又出现了一个非空的目录：目录移不回去。
        mkdirSync(f.oldDir);
        writeFileSync(join(f.oldDir, "blocker"), "x");
        throw new Error("injected failure after move");
      },
    }));
    expect(result).toMatchObject({ ok: false, code: "rollback_failed" });
    expect(existsSync(join(f.newDir, "plc.db"))).toBe(true);
    expect(f.loaded.size).toBe(0);
    expect(existsSync(join(f.agents, `${OLD_SUPERVISOR}.plist.pre-rename`))).toBe(true);
    expect(f.events.at(-1)?.message).toContain("the old service was not started");
  });

  it("puts the paths back that the new service wrote before its health check failed", async () => {
    const f = fixture();
    const before = f.snapshot(f.oldDir);
    const result = await runDataDirMigration(f.deps({
      health: async (dir) => {
        // 新 daemon 起来以后改过一个路径列，然后健康检查失败。
        const db = openDb(join(dir, "plc.db"));
        db.prepare("UPDATE items SET workdir=? WHERE id=1").run(join(dir, "light-tasks", "1-a"));
        db.close();
        throw new Error("schema check failed");
      },
    }));
    expect(result.code).toBe("rolled_back");
    expect(f.snapshot(f.oldDir)).toEqual(before);
  });
});

function failAfter(target: DataDirMigrationStep) {
  return (step: DataDirMigrationStep) => {
    if (step === target) throw new Error(`injected failure after ${target}`);
  };
}
