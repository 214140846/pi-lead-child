// P0-8：数据目录的新名字（docs/desktop/macos-desktop-design.md 第 9 节决定 6、第 10 节）。
// 新机器直接用新名字；合并以后、迁移以前的开发机照旧用旧目录，不新建一个空的数据目录。
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDir } from "../src/config.js";
import { defaultDataDir, installedDataDir, isPreRenameDataDir, preRenameDataDir, preRenameLayoutActive } from "../src/pre-rename.js";
import { sandboxPolicy } from "../src/sandbox-policy.js";
import { tempDir } from "../testing/temp-dirs.js";

const saved = { PLC_DATA_DIR: process.env.PLC_DATA_DIR, HOME: process.env.HOME };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("the data folder name", () => {
  it("is ~/Library/Application Support/Bytezard Lead", () => {
    expect(defaultDataDir("/Users/alice")).toBe("/Users/alice/Library/Application Support/Bytezard Lead");
    expect(preRenameDataDir("/Users/alice")).toBe("/Users/alice/.pi-lead-child");
    expect(isPreRenameDataDir("/Users/alice/.pi-lead-child/", "/Users/alice")).toBe(true);
    expect(isPreRenameDataDir("/Users/alice/Library/Application Support/Bytezard Lead", "/Users/alice")).toBe(false);
  });

  it("uses the new folder on a new Mac, and creates it", () => {
    const home = tempDir("plc-home-new-");
    delete process.env.PLC_DATA_DIR;
    process.env.HOME = home;
    expect(installedDataDir(home)).toBe(defaultDataDir(home));
    expect(dataDir()).toBe(defaultDataDir(home));
    expect(existsSync(defaultDataDir(home))).toBe(true);
    expect(existsSync(preRenameDataDir(home))).toBe(false);
  });

  it("keeps the old folder on a Mac that is not migrated yet, and does not create the new one", () => {
    const home = tempDir("plc-home-old-");
    mkdirSync(preRenameDataDir(home));
    delete process.env.PLC_DATA_DIR;
    process.env.HOME = home;
    expect(preRenameLayoutActive({}, home)).toBe(true);
    expect(dataDir()).toBe(preRenameDataDir(home));
    expect(existsSync(defaultDataDir(home))).toBe(false);
    // 新目录是空的（例如别的进程先建了它）也一样。
    mkdirSync(defaultDataDir(home), { recursive: true });
    expect(dataDir()).toBe(preRenameDataDir(home));
  });

  // #234：桌面版 App 第一次打开就在新目录里建 shell/ 和 runtime/。那时数据还在旧目录，开发机的进程不能改用新目录。
  it("keeps the old folder while the new one holds only the desktop App's own files", () => {
    const home = tempDir("plc-home-app-");
    mkdirSync(preRenameDataDir(home));
    for (const name of ["runtime", "shell"]) mkdirSync(join(defaultDataDir(home), name), { recursive: true });
    writeFileSync(join(defaultDataDir(home), ".DS_Store"), "");
    delete process.env.PLC_DATA_DIR;
    process.env.HOME = home;
    expect(preRenameLayoutActive({}, home)).toBe(true);
    expect(dataDir()).toBe(preRenameDataDir(home));
    writeFileSync(join(defaultDataDir(home), "config.json"), "{}");
    expect(dataDir()).toBe(defaultDataDir(home));
  });

  it("uses the new folder once it holds data, and PLC_DATA_DIR always wins", () => {
    const home = tempDir("plc-home-both-");
    mkdirSync(preRenameDataDir(home));
    mkdirSync(defaultDataDir(home), { recursive: true });
    writeFileSync(join(defaultDataDir(home), "plc.db"), "");
    delete process.env.PLC_DATA_DIR;
    process.env.HOME = home;
    expect(dataDir()).toBe(defaultDataDir(home));
    expect(preRenameLayoutActive({ PLC_DATA_DIR: "/x" }, tempDir("plc-home-env-"))).toBe(false);
    process.env.PLC_DATA_DIR = join(home, "custom");
    expect(dataDir()).toBe(join(home, "custom"));
  });

  // 迁移以后执行器在沙箱里读不到新目录下的配置和凭证。
  it("keeps the config and the credentials in the new folder out of the sandbox", () => {
    const home = tempDir("plc-home-sandbox-");
    const policy = sandboxPolicy({ role: "executor", writable: [], home, env: {} });
    for (const name of ["config.json", "cli-credential.json", "connections.key", "shell-pairing.key"]) {
      expect(policy.denyRead).toContain(join(defaultDataDir(home), name));
    }
    expect(policy.denyRead.some((path) => path.includes(".pi-lead-child"))).toBe(false);
  });
});
