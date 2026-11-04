// 壳不 import core，数据目录的规则在 desktop/src/paths.ts 里写了一份。这里和 core 的 dataDir()、installRoot() 比：
// P0-8 改数据目录时只改了一处，这里就会失败。
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDir, installRoot } from "@pi-lead-child/core";
import { tempDir } from "@pi-lead-child/core/testing";
import { shellPaths } from "../src/paths.js";

const saved = { PLC_DATA_DIR: process.env.PLC_DATA_DIR, HOME: process.env.HOME };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("shellPaths", () => {
  it("uses the same data folder and install root as core when PLC_DATA_DIR is set", () => {
    process.env.PLC_DATA_DIR = join(tempDir("plc-desktop-paths-"), "Application Support", "Bytezard Lead");
    const paths = shellPaths(process.env);
    expect(paths.dataDir).toBe(dataDir());
    expect(paths.installRoot).toBe(installRoot());
    expect(paths.current).toBe(join(installRoot(), "current"));
  });

  it("uses the same default data folder as core", () => {
    delete process.env.PLC_DATA_DIR;
    process.env.HOME = tempDir("plc-desktop-home-");
    expect(shellPaths(process.env, process.env.HOME).dataDir).toBe(dataDir());
  });

  it("puts the Electron user data in a shell folder below the data folder, not in its root", () => {
    const paths = shellPaths({ PLC_DATA_DIR: "/Users/alice/Library/Application Support/Bytezard Lead" });
    expect(paths.shellUserData).toBe("/Users/alice/Library/Application Support/Bytezard Lead/shell");
    expect(paths.leadNameFile.startsWith(`${paths.shellUserData}/`)).toBe(true);
    expect(paths.daemonSocket).toBe("/Users/alice/Library/Application Support/Bytezard Lead/plc.sock");
    expect(paths.installStateFile).toBe("/Users/alice/Library/Application Support/Bytezard Lead/runtime/install-state.json");
  });
});
