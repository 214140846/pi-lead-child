import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { keychainKeySource, lazyVault } from "../src/vault.js";

// 2026-11-03：保险库第一次用到时同步读 Keychain，没有超时；加了超时以后，超时又不能被当成「还没有密钥」：
// 那会新建一个密钥，用 -U 覆盖已有的，保险库里加密过的令牌就再也打不开了。
// PATH 上放一个假的 security：find 的结果由 FAKE_SECURITY_FIND 决定，每次调用记一行。
const KEY = "ab".repeat(32);
let dir: string;
let path: string | undefined;

function fakeSecurity(find: "found" | "missing" | "error"): string {
  const log = join(dir, "calls.log");
  writeFileSync(join(dir, "security"), [
    "#!/bin/sh",
    `echo "$1" >> '${log}'`,
    'if [ "$1" = find-generic-password ]; then',
    find === "found" ? `  echo '${KEY}'; exit 0` : find === "missing" ? "  exit 44" : "  exit 51",
    "fi",
    'if [ "$1" = -i ]; then cat > /dev/null; exit 0; fi',
    "exit 1",
  ].join("\n"));
  chmodSync(join(dir, "security"), 0o755);
  process.env.PATH = `${dir}:${path}`;
  return log;
}

const calls = (log: string) => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);

beforeEach(() => {
  dir = tempDir("plc-vault-keychain-");
  path = process.env.PATH;
});
afterEach(() => {
  process.env.PATH = path;
});

describe("the Keychain key source", () => {
  it("does not create a new key when reading the Keychain fails for another reason than a missing item", () => {
    const log = fakeSecurity("error");
    expect(() => keychainKeySource("alice", "plc:test").load()).toThrow(/could not read the key/);
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("creates a key only when the Keychain has none", () => {
    const log = fakeSecurity("missing");
    expect(keychainKeySource("alice", "plc:test").load()).toHaveLength(32);
    expect(calls(log)).toEqual(["find-generic-password", "-i"]);
  });

  it("reads the key in the background, so sealing does not run security on the main thread", async () => {
    const log = fakeSecurity("found");
    const vault = lazyVault(keychainKeySource("alice", "plc:test"));
    await vault.preload();
    expect(calls(log)).toEqual(["find-generic-password"]);
    const sealed = vault.seal({ token: "t" }, "aad");
    expect(vault.open(sealed, "aad")).toEqual({ token: "t" });
    expect(calls(log)).toEqual(["find-generic-password"]);
  });

  it("leaves creating a missing key to the synchronous load", async () => {
    const log = fakeSecurity("missing");
    const vault = lazyVault(keychainKeySource("alice", "plc:test"));
    await vault.preload();
    expect(calls(log)).toEqual(["find-generic-password"]);
  });
});
