// 装桌面版时自动接管存量安装（docs/desktop/macos-desktop-design.md 第 12 节，#234）。
// 走 runDesktopInstall 的完整流程：文件、目录、库和 plist 都是真的（临时 home 下面），launchctl、排空和健康检查换成假的。
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { createItem, createRun, LATEST_SCHEMA_VERSION, openDb, openExistingDb } from "@pi-lead-child/store";
import { databaseSchemaVersion } from "../src/deploy/release.js";
import {
  INSTALL_LOCK_FILE, runDesktopInstall, type DesktopInstallDeps,
} from "../src/deploy/desktop-install.js";
import { desktopPlistOptions, LAUNCHD_LABEL, plistContent, plistWorkingDirectory } from "../src/deploy/launchd.js";
import { addRuntimeVersion, fakeHost, installedRuntime, installState } from "./desktop-fixtures.js";

const OLD_SUPERVISOR = "com.pi-lead-child.supervisor";
const OLD_HINDSIGHT = "com.pi-lead-child.hindsight";
const NEW_HINDSIGHT = "com.bytezard.plc.hindsight";

const devPlist = (label: string, dataDir: string, cwd: string) => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>${cwd}/apps/daemon/dist/supervisor.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PLC_DATA_DIR</key><string>${dataDir}</string>
  </dict>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <key>StandardOutPath</key><string>${dataDir}/logs/supervisor.out.log</string>
</dict>
</plist>
`;

/** 一个账本：一张工单（workdir 在数据目录里）、一次执行、一条笔记样的正文。返回造好的库。 */
function seedLedger(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const db = openDb(join(dir, "plc.db"));
  const itemId = createItem(db, { title: "Reply to Nina", brief: "b", createdBy: "user" });
  db.prepare("UPDATE items SET workdir=?, body=? WHERE id=?")
    .run(join(dir, "light-tasks", "1-a"), `The log is in ${dir}/logs/daemon.log`, itemId);
  const runId = createRun(db, { itemId });
  db.prepare("UPDATE runs SET session_path=? WHERE id=?").run(join(dir, "runtime-events", `run-${runId}.jsonl`), runId);
  db.close();
  // 值是假的，测试只看路径和内容是否保留。
  writeFileSync(join(dir, "config.json"), `${JSON.stringify({ env: { EXAMPLE_FLAG: "on" }, skills: { dir: join(dir, "skills") } }, null, 2)}\n`, { mode: 0o600 });
  mkdirSync(join(dir, "hindsight"), { recursive: true });
  writeFileSync(join(dir, "hindsight", "service.json"), "{\"bank\":\"alice\"}\n");
}

function ledger(dir: string) {
  const db = openExistingDb(join(dir, "plc.db"), { readonly: true });
  try {
    return {
      items: db.prepare("SELECT id, title, workdir, body FROM items ORDER BY id").all() as Array<{ workdir: string; body: string }>,
      runs: db.prepare("SELECT id, session_path FROM runs ORDER BY id").all(),
      schema: databaseSchemaVersion(join(dir, "plc.db")),
    };
  } finally {
    db.close();
  }
}

/** 把库的 schema 版本退回一格，模拟库比安装包旧；返回撤掉的那一行，健康检查时放回去，模拟新版本启动时升级。 */
function setSchemaBehind(dir: string): () => void {
  const db = openExistingDb(join(dir, "plc.db"));
  const row = db.prepare("SELECT * FROM schema_migrations WHERE version = ?").get(LATEST_SCHEMA_VERSION) as Record<string, unknown>;
  db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(LATEST_SCHEMA_VERSION);
  db.close();
  return () => {
    const live = openExistingDb(join(dir, "plc.db"));
    const columns = Object.keys(row);
    live.prepare(`INSERT INTO schema_migrations (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...columns.map((column) => row[column]));
    live.close();
  };
}

// 情况 A 的机器：旧目录和两个旧任务；App 已经在新目录里放了 runtime/ 和 shell/。
function preRenameMachine(overrides: Partial<DesktopInstallDeps> = {}) {
  const home = tempDir("plc-takeover-a-");
  const runtime = installedRuntime(join(home, "Library", "Application Support"));
  mkdirSync(join(runtime.dataDir, "shell"), { recursive: true });
  writeFileSync(join(runtime.dataDir, "shell", "lead-name.json"), "{\"name\":\"Paimon\"}\n");
  const oldDir = join(home, ".pi-lead-child");
  seedLedger(oldDir);
  const checkout = join(home, "src", "plc");
  const env = fakeHost(runtime, overrides);
  mkdirSync(env.agentsDir, { recursive: true });
  const oldSupervisorPlist = join(env.agentsDir, `${OLD_SUPERVISOR}.plist`);
  const oldHindsightPlist = join(env.agentsDir, `${OLD_HINDSIGHT}.plist`);
  writeFileSync(oldSupervisorPlist, devPlist(OLD_SUPERVISOR, oldDir, checkout));
  writeFileSync(oldHindsightPlist, devPlist(OLD_HINDSIGHT, oldDir, join(oldDir, "hindsight")));
  env.host.labels.add(OLD_SUPERVISOR);
  env.host.labels.add(OLD_HINDSIGHT);
  env.deps.preRenamePlistPaths = [oldSupervisorPlist];
  env.deps.preRenameDataDir = oldDir;
  return { ...env, home, runtime, oldDir, oldSupervisorPlist, oldHindsightPlist };
}

// 情况 B 的机器：数据已经在新目录里，plist 指向一个 git checkout。
function devMachine(overrides: Partial<DesktopInstallDeps> = {}) {
  const runtime = installedRuntime();
  seedLedger(runtime.dataDir);
  const checkout = join(tempDir("plc-checkout-"), "my repo");
  mkdirSync(join(checkout, ".git"), { recursive: true });
  writeFileSync(join(checkout, "package.json"), "{\"workspaces\":[\"apps/*\"]}\n");
  const env = fakeHost(runtime, overrides);
  mkdirSync(env.agentsDir, { recursive: true });
  const dev = devPlist(LAUNCHD_LABEL, runtime.dataDir, checkout);
  writeFileSync(env.plistPath, dev);
  env.host.loaded = true;
  return { ...env, runtime, checkout, dev };
}

const listing = (dir: string) => readdirSync(dir).sort();
const takeoverMessages = (events: Array<{ step: string; message: string }>) =>
  events.filter((event) => event.step === "takeover").map((event) => event.message);

describe("taking over an installation with the pre-rename names (case A)", () => {
  it("moves the data next to the App's own files, rewrites the paths, points launchd at the runtime, without a click", async () => {
    const f = preRenameMachine();
    const before = ledger(f.oldDir);
    const configBefore = JSON.parse(readFileSync(join(f.oldDir, "config.json"), "utf8"));

    const result = await runDesktopInstall(f.deps);
    expect(result).toEqual({ ok: true, outcome: "installed", gatewayUrl: "http://127.0.0.1:47131" });

    // 数据：旧目录没了，新目录里是旧目录的全部内容加上 App 的 runtime/、shell/。
    expect(existsSync(f.oldDir)).toBe(false);
    expect(listing(f.runtime.dataDir)).toEqual(expect.arrayContaining(["backups", "config.json", "hindsight", "plc.db", "runtime", "shell"]));
    expect(readFileSync(join(f.runtime.dataDir, "shell", "lead-name.json"), "utf8")).toContain("Paimon");
    expect(readdirSync(join(f.runtime.dataDir, "backups"))).toEqual([expect.stringMatching(/^pre-rename-.*\.db$/)]);
    const after = ledger(f.runtime.dataDir);
    expect(after.items.map((item) => item.workdir)).toEqual(before.items.map((item) => item.workdir.replace(f.oldDir, f.runtime.dataDir)));
    // 正文是历史记录，不改。
    expect(after.items.map((item) => item.body)).toEqual(before.items.map((item) => item.body));
    expect(after.schema).toBe(before.schema);
    expect(JSON.parse(readFileSync(join(f.runtime.dataDir, "config.json"), "utf8"))).toEqual({
      ...configBefore, skills: { dir: join(f.runtime.dataDir, "skills") },
    });
    expect(statSync(join(f.runtime.dataDir, "config.json")).mode & 0o777).toBe(0o600);

    // 服务：plist 指向运行包，旧任务和旧 plist 都没了，Hindsight 换了新 label。
    expect(readFileSync(f.plistPath, "utf8")).toBe(plistContent(desktopPlistOptions(f.runtime.root, join(f.runtime.dataDir, "logs"))));
    expect(existsSync(f.oldSupervisorPlist)).toBe(false);
    expect(existsSync(`${f.oldSupervisorPlist}.pre-rename`)).toBe(false);
    expect(readFileSync(join(f.agentsDir, `${NEW_HINDSIGHT}.plist`), "utf8")).toContain(`<string>${NEW_HINDSIGHT}</string>`);
    expect([...f.host.labels].sort()).toEqual([LAUNCHD_LABEL, NEW_HINDSIGHT].sort());
    expect(f.host.calls).toEqual(expect.arrayContaining(["drain", "health"]));

    // 安装页：识别的话、每一步的话，接管完成；launchd 一步看到 plist 已经是对的，不再重启。
    expect(f.host.events.find((event) => event.step === "detect" && event.state === "done")!.message).toContain("old name");
    expect(takeoverMessages(f.host.events)).toEqual(expect.arrayContaining([
      "Making a backup of the database.",
      "Waiting until Bytezard Lead finishes its current work. This can take up to 30 minutes.",
      "Moving your data to the new place.",
      "Bytezard Lead took over your data and settings.",
    ]));
    expect(f.host.events.find((event) => event.step === "launchd" && event.state === "done")).toMatchObject({ code: "launchd_unchanged" });
    expect(installState(f.runtime.installRoot)).toMatchObject({ outcome: "installed", installedVersion: "1.3.0", lastError: null });
    expect(existsSync(join(f.runtime.installRoot, INSTALL_LOCK_FILE))).toBe(false);
  });

  it("does not migrate again when the App installs a second time, and leaves the data as it is", async () => {
    const f = preRenameMachine();
    expect((await runDesktopInstall(f.deps)).ok).toBe(true);
    const after = ledger(f.runtime.dataDir);
    const config = readFileSync(join(f.runtime.dataDir, "config.json"), "utf8");
    f.host.calls.length = 0;
    f.host.events.length = 0;

    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: true, outcome: "installed" });
    expect(f.host.events.find((event) => event.step === "takeover")).toMatchObject({ state: "skipped" });
    expect(f.host.calls).toEqual(["capture", "ensure_running"]);
    expect(ledger(f.runtime.dataDir)).toEqual(after);
    expect(readFileSync(join(f.runtime.dataDir, "config.json"), "utf8")).toBe(config);
    expect(readdirSync(join(f.runtime.dataDir, "backups"))).toHaveLength(1);
  });

  it("rolls back to the old names when a step after the move fails, says why, and a retry then succeeds", async () => {
    let fault = true;
    const f = preRenameMachine();
    f.deps.takeover.afterStep = (step) => { if (fault && step === "start_new") throw new Error("injected fault after start_new"); };
    const before = ledger(f.oldDir);
    const config = readFileSync(join(f.oldDir, "config.json"), "utf8");

    const result = await runDesktopInstall(f.deps);
    expect(result).toEqual({ ok: false, outcome: "failed", code: "takeover_rolled_back" });
    // 原样：旧目录、旧库、旧 config.json、旧 plist、旧任务；新目录里只剩 App 自己的文件。
    expect(ledger(f.oldDir)).toEqual(before);
    expect(readFileSync(join(f.oldDir, "config.json"), "utf8")).toBe(config);
    expect(listing(f.runtime.dataDir)).toEqual(["runtime", "shell"]);
    expect(existsSync(f.oldSupervisorPlist)).toBe(true);
    expect(existsSync(f.plistPath)).toBe(false);
    expect([...f.host.labels].sort()).toEqual([OLD_HINDSIGHT, OLD_SUPERVISOR].sort());
    const last = f.host.events.at(-1)!;
    expect(last).toMatchObject({ step: "takeover", state: "failed", code: "takeover_rolled_back" });
    expect(last.message).toContain("put everything back as it was");
    expect(last.message).toContain("injected fault after start_new");
    expect(takeoverMessages(f.host.events)).toContain("A problem occurred. Bytezard Lead puts everything back as it was.");
    expect(installState(f.runtime.installRoot).lastError).toMatchObject({ step: "takeover", code: "takeover_rolled_back" });

    // 「重试」就是整个流程再跑一遍。
    fault = false;
    f.host.events.length = 0;
    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: true, outcome: "installed" });
    expect(existsSync(f.oldDir)).toBe(false);
    expect(ledger(f.runtime.dataDir).items.map((item) => item.body)).toEqual(before.items.map((item) => item.body));
  });

  it("restores the database it copied after the stop when the new version upgraded it and then failed", async () => {
    const f = preRenameMachine();
    const upgrade = setSchemaBehind(f.oldDir);
    f.deps.takeover.health = async (dir) => {
      expect(dir).toBe(f.runtime.dataDir);
      upgrade(); // 新版本启动时升级了库
      throw new Error("the new daemon did not answer status");
    };
    const before = ledger(f.oldDir);
    expect(before.schema).toBe(LATEST_SCHEMA_VERSION - 1);

    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: false, code: "takeover_rolled_back" });
    expect(ledger(f.oldDir)).toEqual(before);
    expect(readdirSync(join(f.oldDir, "backups")).sort()).toEqual([
      expect.stringMatching(/^pre-rename-.*-stopped\.db$/), expect.stringMatching(/^pre-rename-.*Z\.db$/),
    ].sort());
  });

  it("changes nothing and says so when the data comes from a newer version", async () => {
    const f = preRenameMachine();
    const db = openExistingDb(join(f.oldDir, "plc.db"));
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(LATEST_SCHEMA_VERSION + 1, "from-the-future");
    db.close();
    const result = await runDesktopInstall(f.deps);
    expect(result).toMatchObject({ ok: false, code: "schema_ahead" });
    expect(f.host.events.at(-1)!.message).toContain("newer version");
    expect(existsSync(join(f.oldDir, "plc.db"))).toBe(true);
    expect(listing(f.runtime.dataDir)).toEqual(["runtime", "shell"]);
    expect(f.host.calls).toEqual([]);
  });

  it("keeps the installation when the developer sets PLC_KEEP_DEV_INSTALL, and opens the running copy", async () => {
    const asked: Array<string | undefined> = [];
    const f = preRenameMachine({
      keepDevInstall: true,
      daemon: { waitForStatus: async (_timeoutMs, dir) => { asked.push(dir); return { gatewayUrl: "http://127.0.0.1:47130" }; } },
    });
    expect(await runDesktopInstall(f.deps)).toEqual({
      ok: true, outcome: "dev_install", code: "dev_install_detected", gatewayUrl: "http://127.0.0.1:47130",
    });
    expect(asked).toEqual([f.oldDir]);
    expect(existsSync(join(f.oldDir, "plc.db"))).toBe(true);
    expect(f.host.calls).toEqual([]);
  });
});

describe("taking over an installation that runs a developer checkout (case B)", () => {
  it("keeps the data in place, points launchd at the runtime, and does not touch the checkout", async () => {
    const f = devMachine();
    const before = ledger(f.runtime.dataDir);
    const checkoutBefore = listing(f.checkout);

    const result = await runDesktopInstall(f.deps);
    expect(result).toMatchObject({ ok: true, outcome: "installed" });
    expect(plistWorkingDirectory(readFileSync(f.plistPath, "utf8"))).toBe(f.runtime.root);
    expect(existsSync(`${f.plistPath}.pre-takeover`)).toBe(false);
    expect(ledger(f.runtime.dataDir)).toEqual(before);
    expect(listing(f.checkout)).toEqual(checkoutBefore);
    // 备份：库和开发安装的 plist 各一份。
    const backups = readdirSync(join(f.runtime.dataDir, "backups")).sort();
    expect(backups).toEqual([expect.stringMatching(/^pre-takeover-.*\.db$/), expect.stringMatching(/^pre-takeover-.*\.supervisor\.plist$/)]);
    expect(readFileSync(join(f.runtime.dataDir, "backups", backups[1]!), "utf8")).toBe(f.dev);
    // 只换 supervisor，不动 Hindsight 的任务。
    expect(f.host.calls.filter((call) => call.startsWith("launchctl"))).toEqual([
      `launchctl bootout ${LAUNCHD_LABEL}`, `launchctl bootstrap ${LAUNCHD_LABEL}`,
    ]);
    expect(f.host.events.find((event) => event.step === "detect" && event.state === "done")!.message).toContain("developer installation");
  });

  it("puts the developer install back when the new service fails its health check", async () => {
    const f = devMachine();
    f.deps.takeover.health = async () => { throw new Error("the new supervisor did not listen within 60 seconds"); };
    const before = ledger(f.runtime.dataDir);
    const result = await runDesktopInstall(f.deps);
    expect(result).toMatchObject({ ok: false, code: "takeover_rolled_back" });
    expect(readFileSync(f.plistPath, "utf8")).toBe(f.dev);
    expect(existsSync(`${f.plistPath}.pre-takeover`)).toBe(false);
    expect(f.host.loaded).toBe(true);
    expect(ledger(f.runtime.dataDir)).toEqual(before);
    expect(f.host.events.at(-1)!.message).toContain("did not listen within 60 seconds");
  });

  it("does not stop the service when the drain does not finish, and says nothing changed", async () => {
    const f = devMachine();
    f.deps.takeover.drain = async () => { throw new Error("Lead did not become idle within 30 minutes"); };
    const result = await runDesktopInstall(f.deps);
    expect(result).toMatchObject({ ok: false, code: "takeover_failed" });
    expect(readFileSync(f.plistPath, "utf8")).toBe(f.dev);
    expect(f.host.calls.filter((call) => call.startsWith("launchctl"))).toEqual([]);
    expect(f.host.events.at(-1)!.message).toContain("Nothing changed");
  });
});

describe("restarting on a new version of the runtime (case C)", () => {
  function upgradedMachine() {
    const runtime = installedRuntime();
    seedLedger(runtime.dataDir);
    const env = fakeHost(runtime);
    mkdirSync(env.agentsDir, { recursive: true });
    writeFileSync(env.plistPath, plistContent(desktopPlistOptions(runtime.root, join(runtime.dataDir, "logs"))));
    env.host.loaded = true;
    // 上一次装的是 1.2.0；壳刚把 current 换到 1.3.0。
    addRuntimeVersion(runtime.installRoot, "1.2.0");
    writeFileSync(join(runtime.installRoot, "install-state.json"), JSON.stringify({ version: 1, outcome: "installed", installedVersion: "1.2.0" }));
    return { ...env, runtime };
  }

  it("restarts the service once on the new version and records it, so the next run does not restart again", async () => {
    const f = upgradedMachine();
    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: true, outcome: "installed" });
    expect(f.host.calls).toEqual(expect.arrayContaining(["drain", `launchctl bootout ${LAUNCHD_LABEL}`, `launchctl bootstrap ${LAUNCHD_LABEL}`, "health"]));
    expect(readdirSync(join(f.runtime.dataDir, "backups")).some((name) => /^pre-upgrade-.*Z\.db$/.test(name))).toBe(true);
    expect(f.host.events.find((event) => event.step === "detect" && event.state === "done")!.message).toBe("Next, Bytezard Lead changes from version 1.2.0 to 1.3.0.");
    expect(installState(f.runtime.installRoot).installedVersion).toBe("1.3.0");

    f.host.calls.length = 0;
    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: true });
    expect(f.host.calls).toEqual(["capture", "ensure_running"]);
  });

  it("points current back at the previous version when the new one does not start", async () => {
    const f = upgradedMachine();
    f.deps.takeover.health = async () => { throw new Error("the new daemon did not answer status"); };
    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: false, code: "takeover_rolled_back" });
    expect(readlinkSync(f.runtime.root)).toBe(join("versions", "1.2.0"));
    expect(f.host.loaded).toBe(true);
    // 没装成：记着的还是上一个版本，下次打开 App 再试。
    expect(installState(f.runtime.installRoot).installedVersion).toBe("1.2.0");
  });
});

describe("one installation at a time", () => {
  it("reports an earlier installation that still runs, and goes on when that process is gone", async () => {
    const f = devMachine();
    mkdirSync(f.runtime.installRoot, { recursive: true });
    writeFileSync(join(f.runtime.installRoot, INSTALL_LOCK_FILE), "4242\n");
    f.deps.processAlive = (pid) => pid === 4242;
    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: false, code: "install_running" });
    expect(readFileSync(f.plistPath, "utf8")).toBe(f.dev);
    expect(f.host.calls).toEqual([]);

    f.deps.processAlive = () => false;
    expect(await runDesktopInstall(f.deps)).toMatchObject({ ok: true, outcome: "installed" });
    expect(existsSync(join(f.runtime.installRoot, INSTALL_LOCK_FILE))).toBe(false);
  });
});
