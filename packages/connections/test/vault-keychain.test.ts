import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { defaultKeySource, keychainKeySource, lazyVault, type KeychainKeyOptions } from "../src/vault.js";

// 2026-11-03：保险库第一次用到时同步读 Keychain，没有超时；加了超时以后，超时又不能被当成「还没有密钥」：
// 那会新建一个密钥，用 -U 覆盖已有的，保险库里加密过的令牌就再也打不开了。
// 2026-11-05（工单 #243）：在沙箱里或者 HOME 被换掉时，已有的条目也会返回 44。读不到不等于没有：
// 已有密文、不在真实的 home、在沙箱里、找不到默认钥匙串时都不能新建；写入不带 -U，条目已存在时读已有的。
// PATH 上放一个假的 security，它把条目存在一个文件里，每次调用记一行。这些测试不碰真钥匙串。
const KEY = "ab".repeat(32);
let dir: string;
let path: string | undefined;

interface FakeSecurity {
  // find 的结果：stored 按条目文件回答（有就给，没有就 44）；error 总是 51；hidden 第一次 44（读不到），以后按条目文件回答。
  find?: "stored" | "error" | "hidden";
  // 一开始钥匙串里就有的密钥。
  stored?: string;
  defaultKeychain?: boolean;
}

function fakeSecurity({ find = "stored", stored, defaultKeychain = true }: FakeSecurity = {}): { log: string; item: string; input: string } {
  const log = join(dir, "calls.log");
  const item = join(dir, "item");
  const input = join(dir, "input.log");
  const seen = join(dir, "find-seen");
  if (stored) writeFileSync(item, stored);
  writeFileSync(join(dir, "security"), [
    "#!/bin/sh",
    `echo "$1" >> '${log}'`,
    'if [ "$1" = find-generic-password ]; then',
    find === "error" ? "  exit 51" : "",
    find === "hidden" ? `  if [ ! -f '${seen}' ]; then touch '${seen}'; exit 44; fi` : "",
    `  if [ -f '${item}' ]; then cat '${item}'; exit 0; fi`,
    "  exit 44",
    "fi",
    `if [ "$1" = default-keychain ]; then exit ${defaultKeychain ? 0 : 1}; fi`,
    'if [ "$1" = -i ]; then',
    `  read -r line; echo "$line" >> '${input}'`,
    `  if [ -f '${item}' ]; then exit 45; fi`,
    `  echo "$line" | sed 's/.* -w //' > '${item}'; exit 0`,
    "fi",
    "exit 1",
  ].join("\n"));
  chmodSync(join(dir, "security"), 0o755);
  process.env.PATH = `${dir}:${path}`;
  return { log, item, input };
}

const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
// 前置检查读的环境：真实的 home，不在沙箱里。测试进程自己可能在沙箱里跑，所以显式给。
const realEnv = (): NodeJS.ProcessEnv => ({ HOME: userInfo().homedir });
const fresh = (more: Partial<KeychainKeyOptions> = {}): KeychainKeyOptions => ({ hasSealedData: () => false, env: realEnv(), ...more });

beforeEach(() => {
  dir = tempDir("plc-vault-keychain-");
  path = process.env.PATH;
});
afterEach(() => {
  process.env.PATH = path;
});

describe("the Keychain key source", () => {
  it("does not create a new key when reading the Keychain fails for another reason than a missing item", () => {
    const { log } = fakeSecurity({ find: "error" });
    expect(() => keychainKeySource("alice", "plc:test", fresh()).load()).toThrow(/could not read the key/);
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("creates a key only when the Keychain has none and the vault has no encrypted data, without -U", () => {
    const { log, item, input } = fakeSecurity();
    const key = keychainKeySource("alice", "plc:test", fresh()).load();
    expect(key).toHaveLength(32);
    expect(calls(log)).toEqual(["find-generic-password", "default-keychain", "-i"]);
    const command = readFileSync(input, "utf8");
    expect(command).toMatch(/^add-generic-password -a "alice" -s "plc:test" -w [0-9a-f]{64}$/m);
    expect(command).not.toMatch(/(^|\s)-U(\s|$)/);
    expect(readFileSync(item, "utf8").trim()).toBe(key.toString("hex"));
  });

  it("refuses to create a key when the vault already has encrypted data and the Keychain answers 44", () => {
    const { log } = fakeSecurity();
    expect(() => keychainKeySource("alice", "plc:test", fresh({ hasSealedData: () => true })).load())
      .toThrow(/already has encrypted data/);
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("only reads when the caller does not allow creating a key", () => {
    const { log } = fakeSecurity();
    expect(() => keychainKeySource("alice", "plc:test", { env: realEnv() }).load()).toThrow(/only reads/);
    expect(() => keychainKeySource("alice", "plc:test").load()).toThrow(/only reads/);
    expect(calls(log)).toEqual(["find-generic-password", "find-generic-password"]);
  });

  it("refuses to create a key when HOME is not the user's real home", () => {
    const { log } = fakeSecurity();
    expect(() => keychainKeySource("alice", "plc:test", fresh({ env: { HOME: join(dir, "home") } })).load())
      .toThrow(/HOME .* is not the user's home/);
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("refuses to create a key inside a sandbox", () => {
    const { log } = fakeSecurity();
    expect(() => keychainKeySource("alice", "plc:test", fresh({ env: { ...realEnv(), SANDBOX_RUNTIME: "1" } })).load())
      .toThrow(/inside a sandbox/);
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("refuses to create a key when there is no default keychain, so the system does not offer to make one", () => {
    const { log } = fakeSecurity({ defaultKeychain: false });
    expect(() => keychainKeySource("alice", "plc:test", fresh()).load()).toThrow(/no default keychain/);
    expect(calls(log)).toEqual(["find-generic-password", "default-keychain"]);
  });

  it("keeps the existing key when the item turns out to exist (45), and reads it again", () => {
    const { log, item } = fakeSecurity({ find: "hidden", stored: KEY });
    const key = keychainKeySource("alice", "plc:test", fresh()).load();
    expect(key.toString("hex")).toBe(KEY);
    expect(readFileSync(item, "utf8")).toBe(KEY);
    expect(calls(log)).toEqual(["find-generic-password", "default-keychain", "-i", "find-generic-password"]);
  });

  it("reads the key in the background, so sealing does not run security on the main thread", async () => {
    const { log } = fakeSecurity({ stored: KEY });
    const vault = lazyVault(keychainKeySource("alice", "plc:test"));
    await vault.preload();
    expect(calls(log)).toEqual(["find-generic-password"]);
    const sealed = vault.seal({ token: "t" }, "aad");
    expect(vault.open(sealed, "aad")).toEqual({ token: "t" });
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("leaves creating a missing key to the synchronous load", async () => {
    const { log } = fakeSecurity();
    const vault = lazyVault(keychainKeySource("alice", "plc:test", fresh()));
    await vault.preload();
    expect(calls(log)).toEqual(["find-generic-password"]);
  });
});

describe("defaultKeySource", () => {
  it("uses the key file and never runs security when PLC_VAULT_KEY_SOURCE=file", () => {
    const { log } = fakeSecurity();
    const keyFile = join(dir, "data", "connections.key");
    const source = defaultKeySource(keyFile, { env: { PLC_VAULT_KEY_SOURCE: "file" }, hasSealedData: () => false });
    const key = source.load();
    expect(readFileSync(keyFile, "utf8")).toBe(key.toString("hex"));
    expect(calls(log)).toEqual([]);
  });
});
