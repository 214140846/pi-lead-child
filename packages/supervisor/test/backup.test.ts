// 维护前的在线备份（审查 2026-10-20 A）：以前按缺省每步 100 页复制，没有时限；另一个连接每写一次，备份就从头开始，
// 约 60 MB 的库在频繁写入时一分钟也完不成。现在一步复制全部页面，并且到时限就放弃、删掉半成品。
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@pi-lead-child/core/testing";
import { backupSqlite, removeLegacyUpgradeBackups, replaceBackup, sqliteIntegrityProblem } from "../src/deploy/backup.js";

function busyDatabase(dir: string): string {
  const path = join(dir, "plc.db");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE rows (id INTEGER PRIMARY KEY, body TEXT)");
  const insert = db.prepare("INSERT INTO rows (body) VALUES (?)");
  db.transaction(() => { for (let i = 0; i < 4_000; i += 1) insert.run("x".repeat(1_000)); })();
  db.close();
  return path;
}

describe("backupSqlite", () => {
  it("finishes while another connection keeps writing", async () => {
    const dir = tempDir("plc-backup-");
    const source = busyDatabase(dir);
    const writer = new Database(source);
    const insert = writer.prepare("INSERT INTO rows (body) VALUES ('w')");
    const timer = setInterval(() => insert.run(), 5);
    try {
      const destination = join(dir, "copy.db");
      const started = Date.now();
      await backupSqlite(source, destination, { timeoutMs: 10_000 });
      expect(Date.now() - started).toBeLessThan(10_000);
      const copy = new Database(destination, { readonly: true });
      expect((copy.prepare("SELECT COUNT(*) AS n FROM rows").get() as { n: number }).n).toBeGreaterThanOrEqual(4_000);
      copy.close();
    } finally {
      clearInterval(timer);
      writer.close();
    }
  });

  it("gives up at the time limit and leaves no half-written copy", async () => {
    const dir = tempDir("plc-backup-timeout-");
    const source = busyDatabase(dir);
    const destination = join(dir, "copy.db");
    await expect(backupSqlite(source, destination, { timeoutMs: 0, pagesPerStep: 1 })).rejects.toThrow(/did not finish within 0 ms/);
    expect(existsSync(destination)).toBe(false);
  });
});

// 升级前的备份只留一份（docs/desktop/macos-desktop-design.md 第 7.5.5 节）：2026-11-05 以前每次升级多一份约 230 MB。
describe("replaceBackup", () => {
  const rows = (path: string) => {
    // 只读打开：备份是 DELETE 模式，读它不会在旁边留下 -wal、-shm。
    const db = new Database(path, { readonly: true });
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM rows").get() as { n: number }).n;
    } finally {
      db.close();
    }
  };

  it("replaces the one backup with a checked copy, and leaves no temporary file", async () => {
    const dir = tempDir("plc-backup-replace-");
    const source = busyDatabase(dir);
    const destination = join(dir, "pre-upgrade.db");
    await replaceBackup(source, destination);
    expect(rows(destination)).toBe(4_000);

    const writer = new Database(source);
    writer.prepare("INSERT INTO rows (body) VALUES ('later')").run();
    writer.close();
    await replaceBackup(source, destination);
    expect(rows(destination)).toBe(4_001);
    expect(readdirSync(dir).filter((name) => name.startsWith("pre-upgrade"))).toEqual(["pre-upgrade.db"]);
    expect(sqliteIntegrityProblem(destination)).toBeNull();
  });

  it("keeps the old backup when the new copy is damaged, and removes the damaged copy", async () => {
    const dir = tempDir("plc-backup-damaged-");
    const source = busyDatabase(dir);
    const destination = join(dir, "pre-upgrade.db");
    await replaceBackup(source, destination);
    const before = readFileSync(destination);
    const damaged = async (_from: string, to: string) => { writeFileSync(to, "this is not a database"); };
    await expect(replaceBackup(source, destination, { backup: damaged })).rejects.toThrow(/not intact/);
    expect(readFileSync(destination).equals(before)).toBe(true);
    expect(existsSync(`${destination}.partial`)).toBe(false);
  });

  it("starts from a clean temporary file when an earlier run stopped half way", async () => {
    const dir = tempDir("plc-backup-stale-");
    const source = busyDatabase(dir);
    const destination = join(dir, "pre-upgrade.db");
    writeFileSync(`${destination}.partial`, "left over");
    writeFileSync(`${destination}.partial-wal`, "left over");
    await replaceBackup(source, destination);
    expect(rows(destination)).toBe(4_000);
    expect(readdirSync(dir).filter((name) => name.includes(".partial"))).toEqual([]);
  });
});

describe("removeLegacyUpgradeBackups", () => {
  it("removes only the upgrade backups named by time, and leaves every other backup", () => {
    const dir = tempDir("plc-backup-legacy-");
    const legacy = [
      "pre-upgrade-2026-11-04T17-18-57-250Z.db",
      "pre-upgrade-2026-11-04T17-18-57-250Z.supervisor.plist",
      "pre-upgrade-2026-11-05T02-28-58-884Z-stopped.db",
      "pre-upgrade-2026-11-05T02-28-58-884Z-stopped.db-wal",
    ];
    const kept = [
      "pre-upgrade.db",
      "pre-takeover-2026-11-04T15-39-05-311Z.db",
      "pre-takeover-2026-11-04T15-39-05-311Z.supervisor.plist",
      "pre-rename-2026-11-04T12-03-03-066Z.db",
      "plc-pre-upgrade-2026-11-04T11-19-12-604Z.db",
      "plc-pre-restart-2026-11-04T07-43-41-753Z.db",
      "plc.db.pre-a0659e6f-20261104-1352",
      "pre-upgrade-before-the-trip.db",
    ];
    for (const name of [...legacy, ...kept]) writeFileSync(join(dir, name), "x");
    expect(removeLegacyUpgradeBackups(dir)).toEqual([...legacy].sort());
    expect(readdirSync(dir).sort()).toEqual([...kept].sort());
    expect(removeLegacyUpgradeBackups(join(dir, "missing"))).toEqual([]);
  });
});
