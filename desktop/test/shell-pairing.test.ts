// 壳和 daemon、网关对口令的约定（P0-4 返工）：文件名和请求头名三处一致，壳只读合法的口令，只发给网关。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { SHELL_PAIRING_HEADER as GATEWAY_HEADER } from "@pi-lead-child/gateway";
import { SHELL_PAIRING_KEY_FILE as DAEMON_FILE } from "../../apps/daemon/src/shell-pairing.js";
import { shellPaths } from "../src/paths.js";
import { pairingHeaders, readShellPairingKey, SHELL_PAIRING_HEADER, SHELL_PAIRING_KEY_FILE } from "../src/shell-pairing.js";

describe("shell pairing token", () => {
  it("uses the same file name as the daemon and the same header as the gateway", () => {
    expect(SHELL_PAIRING_KEY_FILE).toBe(DAEMON_FILE);
    expect(SHELL_PAIRING_HEADER).toBe(GATEWAY_HEADER);
    expect(shellPaths({ PLC_DATA_DIR: "/Users/alice/data" }).shellPairingKeyFile).toBe(`/Users/alice/data/${DAEMON_FILE}`);
  });

  it("reads only a well-formed token", () => {
    const dir = tempDir("plc-desktop-token-");
    const file = join(dir, SHELL_PAIRING_KEY_FILE);
    expect(readShellPairingKey(file)).toBeNull();
    writeFileSync(file, "not a token\n");
    expect(readShellPairingKey(file)).toBeNull();
    writeFileSync(file, `${"d".repeat(64)}\n`);
    expect(readShellPairingKey(file)).toBe("d".repeat(64));
  });

  it("adds the header only to same-origin requests", () => {
    const key = "e".repeat(64);
    const gateway = "http://127.0.0.1:47130";
    expect(pairingHeaders({ a: "1" }, `${gateway}/v1/paired/loopback`, gateway, key)).toEqual({ a: "1", [SHELL_PAIRING_HEADER]: key });
    expect(pairingHeaders({ a: "1" }, "http://localhost:47130/", gateway, key)).toEqual({ a: "1" });
    expect(pairingHeaders({ a: "1" }, "https://example.com/", gateway, key)).toEqual({ a: "1" });
    expect(pairingHeaders({ a: "1" }, `${gateway}/`, null, key)).toEqual({ a: "1" });
    expect(pairingHeaders({ a: "1" }, `${gateway}/`, gateway, null)).toEqual({ a: "1" });
  });
});
