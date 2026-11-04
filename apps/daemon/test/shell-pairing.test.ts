// 回环自动配对怎样开（P0-4 返工）：开发机照旧；桌面版的发布模式缺省打开，但要带数据目录里 0600 口令文件的口令。
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { loadOrCreateShellPairingKey, loopbackAutoPairMode, SHELL_PAIRING_KEY_FILE } from "../src/shell-pairing.js";

describe("loopbackAutoPairMode", () => {
  it("opens with the shell token by default in release mode", () => {
    expect(loopbackAutoPairMode({}, true)).toBe("shell_only");
  });

  it("stays off by default outside release mode", () => {
    expect(loopbackAutoPairMode({}, false)).toBe("off");
    expect(loopbackAutoPairMode({ PLC_DEV: "0" }, false)).toBe("off");
  });

  it("keeps the developer rules: PLC_DEV opens it without a token, and the explicit flag wins in both modes", () => {
    expect(loopbackAutoPairMode({ PLC_DEV: "1" }, false)).toBe("loopback_page");
    expect(loopbackAutoPairMode({ PLC_ALLOW_LOOPBACK_AUTO_PAIR: "true" }, false)).toBe("loopback_page");
    expect(loopbackAutoPairMode({ PLC_ALLOW_LOOPBACK_AUTO_PAIR: "1" }, true)).toBe("loopback_page");
    expect(loopbackAutoPairMode({ PLC_ALLOW_LOOPBACK_AUTO_PAIR: "0" }, true)).toBe("off");
    expect(loopbackAutoPairMode({ PLC_DEV: "1", PLC_ALLOW_LOOPBACK_AUTO_PAIR: "off" }, false)).toBe("off");
  });
});

describe("loadOrCreateShellPairingKey", () => {
  it("creates a random token that only this user can read, and returns the same token next time", () => {
    const dir = tempDir("plc-shell-pairing-");
    const key = loadOrCreateShellPairingKey(dir);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, SHELL_PAIRING_KEY_FILE)).mode & 0o777).toBe(0o600);
    expect(loadOrCreateShellPairingKey(dir)).toBe(key);
    expect(loadOrCreateShellPairingKey(tempDir("plc-shell-pairing-"))).not.toBe(key);
  });

  it("replaces a file whose content is not a token", () => {
    const dir = tempDir("plc-shell-pairing-");
    writeFileSync(join(dir, SHELL_PAIRING_KEY_FILE), "short\n", { mode: 0o644 });
    const key = loadOrCreateShellPairingKey(dir);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, SHELL_PAIRING_KEY_FILE), "utf8").trim()).toBe(key);
    expect(statSync(join(dir, SHELL_PAIRING_KEY_FILE)).mode & 0o777).toBe(0o600);
  });
});
