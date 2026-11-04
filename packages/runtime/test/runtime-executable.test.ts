import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  findRuntimeExecutable,
  knownUserBinDirectories,
  runtimeBinDirectories,
  runtimeSearchPath,
} from "../src/executable.js";

describe("runtime executable discovery", () => {
  it("resolves executables from an explicit PATH even when launchd supplies a minimal environment", () => {
    const dir = tempDir("plc-runtime-bin-");
    const executable = join(dir, "codex");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);

    expect(findRuntimeExecutable("codex", dir)).toBe(executable);
  });

  it("adds package, user-local, Homebrew and Node directories to the daemon PATH", () => {
    const dirs = runtimeBinDirectories("/usr/bin:/bin");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/usr/local/bin");
    expect(dirs).toContain(join(process.env.HOME!, ".local", "bin"));
    expect(runtimeSearchPath("/usr/bin:/bin").split(delimiter)).toEqual(dirs);
  });

  // 桌面版（docs/desktop/macos-desktop-design.md 第 5.1 节）：从 Dock 打开的 App 和 launchd 拿不到用户 shell 的 PATH。
  it("adds the folders where npm, Volta, Bun, Claude Code and nvm put commands, newest nvm Node first", () => {
    const home = tempDir("plc-runtime-home-");
    for (const version of ["v9.11.2", "v22.19.0", "v24.1.0", "v10.0.0"]) {
      mkdirSync(join(home, ".nvm", "versions", "node", version, "bin"), { recursive: true });
    }
    expect(knownUserBinDirectories(home)).toEqual([
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".volta", "bin"),
      join(home, ".bun", "bin"),
      join(home, ".claude", "local"),
      join(home, ".nvm", "versions", "node", "v24.1.0", "bin"),
      join(home, ".nvm", "versions", "node", "v22.19.0", "bin"),
      join(home, ".nvm", "versions", "node", "v10.0.0", "bin"),
      join(home, ".nvm", "versions", "node", "v9.11.2", "bin"),
    ]);
    expect(knownUserBinDirectories(tempDir("plc-runtime-home-"))).toHaveLength(5);
  });

  it("puts the login shell's PATH before the launchd PATH, so commands match the user's terminal", () => {
    const home = tempDir("plc-runtime-home-");
    const dirs = runtimeBinDirectories("/usr/bin:/bin", { loginShellPath: ["/Users/alice/.volta/bin", "/usr/bin"], home });
    expect(dirs.indexOf("/Users/alice/.volta/bin")).toBeLessThan(dirs.indexOf("/usr/bin"));
    expect(dirs.indexOf("/Users/alice/.volta/bin")).toBeGreaterThan(dirs.indexOf(join(process.execPath, "..")));
    expect(dirs).toContain(join(home, ".volta", "bin"));
    expect(new Set(dirs).size).toBe(dirs.length);

    const bin = join(tempDir("plc-runtime-bin-"), "only in login shell");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "claude"), 0o755);
    const path = runtimeSearchPath("/usr/bin:/bin", { loginShellPath: [bin], home });
    expect(findRuntimeExecutable("claude", path)).toBe(join(bin, "claude"));
  });
});
