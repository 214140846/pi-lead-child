// 工单 #243：daemon 只在保险库还没有任何密文时才在 Keychain 里新建密钥；hindsight 只读。
// 已有密文时 Keychain 回答 44（沙箱里、HOME 被换掉时已有的条目也会这样），新建的密钥会盖掉真密钥。
// PATH 上放一个假的 security，记下每次调用：这些测试不碰真钥匙串。
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { defaultKeySource } from "@pi-lead-child/connections";
import { insertConnection, openDb, saveConnectionSecret, type Db } from "@pi-lead-child/store";
import { hindsightSecretsPath } from "../src/memory-controller.js";
import { daemonKeySource, vaultHasSealedData } from "../src/vault-key.js";

let dir: string;
let db: Db;
let path: string | undefined;
let log: string;

beforeEach(() => {
  dir = tempDir("plc-vault-key-");
  db = openDb(join(dir, "plc.db"));
  path = process.env.PATH;
  log = join(dir, "calls.log");
  // find 总是 44；default-keychain 成功；-i 成功。
  writeFileSync(join(dir, "security"), [
    "#!/bin/sh",
    `echo "$1" >> '${log}'`,
    "if [ \"$1\" = find-generic-password ]; then exit 44; fi",
    "if [ \"$1\" = -i ]; then cat > /dev/null; exit 0; fi",
    "exit 0",
  ].join("\n"));
  chmodSync(join(dir, "security"), 0o755);
  process.env.PATH = `${dir}:${path}`;
});
afterEach(() => {
  process.env.PATH = path;
  db.close();
});

const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
const realEnv = (): NodeJS.ProcessEnv => ({ HOME: userInfo().homedir });

describe("vaultHasSealedData", () => {
  it("is false for a fresh data directory", () => {
    expect(vaultHasSealedData(db, dir)).toBe(false);
  });

  it("sees a connection token", () => {
    const row = insertConnection(db, { provider: "github", label: "GitHub", serverUrl: "https://mcp.example.com", tokenSource: "pat" });
    expect(vaultHasSealedData(db, dir)).toBe(false);
    expect(saveConnectionSecret(db, row.id, Buffer.from([1, 2, 3]), row.secret_version)).toBe(true);
    expect(vaultHasSealedData(db, dir)).toBe(true);
  });

  it("sees a sealed settings secret and the connection settings manifest", () => {
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('secret.memory.llm', 'AAAA', datetime('now'))").run();
    expect(vaultHasSealedData(db, dir)).toBe(true);
    db.prepare("DELETE FROM kv").run();
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('connection.settings_manifest', 'AAAA', datetime('now'))").run();
    expect(vaultHasSealedData(db, dir)).toBe(true);
  });

  it("sees the memory service's sealed secrets", () => {
    mkdirSync(join(hindsightSecretsPath(dir), ".."), { recursive: true });
    writeFileSync(hindsightSecretsPath(dir), "sealed");
    expect(vaultHasSealedData(db, dir)).toBe(true);
  });
});

describe.skipIf(process.platform !== "darwin")("the daemon's Keychain key", () => {
  it("does not create a key when the vault has encrypted data and the Keychain answers 44", () => {
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES ('secret.memory.llm', 'AAAA', datetime('now'))").run();
    expect(() => daemonKeySource(db, dir, realEnv()).load()).toThrow(/already has encrypted data/);
    expect(calls()).toEqual(["find-generic-password"]);
  });

  it("creates a key on first use in a fresh install", () => {
    expect(daemonKeySource(db, dir, realEnv()).load()).toHaveLength(32);
    expect(calls()).toEqual(["find-generic-password", "default-keychain", "-i"]);
  });

  it("uses the key file and never runs security when PLC_VAULT_KEY_SOURCE=file", () => {
    const key = daemonKeySource(db, dir, { ...realEnv(), PLC_VAULT_KEY_SOURCE: "file" }).load();
    expect(readFileSync(join(dir, "connections.key"), "utf8")).toBe(key.toString("hex"));
    expect(calls()).toEqual([]);
  });

  it("gives hindsight a key source that only reads", () => {
    // hindsight-main 用 defaultKeySource(<数据目录>/connections.key)，不给新建的许可。
    expect(() => defaultKeySource(join(dir, "connections.key"), { env: realEnv() }).load()).toThrow(/only reads/);
    expect(calls()).toEqual(["find-generic-password"]);
  });
});
