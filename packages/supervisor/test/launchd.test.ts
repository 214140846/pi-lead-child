import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { HINDSIGHT_LABEL, hindsightLabel, hindsightPlist } from "../src/deploy/hindsight.js";
import {
  activeLaunchdLabel, launchAgentsDir, DESKTOP_AGENT_LAUNCHER, DESKTOP_APP_BUNDLE_ID, desktopPlistOptions, LAUNCHD_LABEL, plistContent, plistWorkingDirectory, PRE_RENAME_LAUNCHD_LABEL, preRenamePlistPaths,
} from "../src/deploy/launchd.js";

describe("plistContent", () => {
  const xml = plistContent({
    nodeBin: "/usr/local/bin/node",
    entry: "/repo/dist/supervisor.mjs",
    cwd: "/repo",
    logDir: "/Users/alice/Library/Application Support/Bytezard Lead/logs",
  });
  it("包含 label、入口、工作目录与日志路径", () => {
    expect(xml).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(xml).toContain("<string>/usr/local/bin/node</string>");
    expect(xml).toContain("<string>/repo/dist/supervisor.mjs</string>");
    expect(xml).toContain("<string>/repo</string>");
    expect(xml).toContain("supervisor.out.log");
    expect(xml).toContain("supervisor.err.log");
  });
  it("Supervisor 始终由 launchd 保活，daemon stop 不影响 Supervisor，带 Throttle", () => {
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>30<\/integer>/);
    expect(xml).toContain("<key>RunAtLoad</key>");
  });
  it("路径含 & 时做 XML 转义，不产生裸 &", () => {
    const escaped = plistContent({
      nodeBin: "/usr/local/bin/node",
      entry: "/repo/dist/coordinatord.mjs",
      cwd: "/repo & co",
      logDir: "/Users/alice/Library/Application Support/Bytezard Lead/logs",
    });
    expect(escaped).toContain("<string>/repo &amp; co</string>");
    expect(escaped).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });
});

// 桌面版（docs/desktop/macos-desktop-design.md 第 1.1 节、第 10 节 P0-3）。
describe("desktop plist", () => {
  const root = "/Users/alice/Library/Application Support/Bytezard Lead/runtime/current";
  const xml = plistContent(desktopPlistOptions(root, "/Users/alice/Library/Application Support/Bytezard Lead/logs"));

  it("runs lead-agent and supervisor.mjs from current, not from a version folder", () => {
    // plist 写软链接 bin/Bytezard Lead（指向 bin/lead-agent）：「允许在后台」显示 plist 里路径的文件名，
    // 进程名跟着真实文件 lead-agent 走（第 8.7 节，做法 1b，2026-11-04 实测 4）。
    expect(xml).toContain(`<string>${root}/bin/Bytezard Lead</string>`);
    expect(xml).not.toContain("/bin/lead-agent");
    expect(xml).not.toContain(".app/");
    expect(xml).toContain(`<string>${root}/apps/daemon/dist/supervisor.mjs</string>`);
    expect(plistWorkingDirectory(xml)).toBe(root);
    expect(xml).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
  });

  it("names the launcher Bytezard Lead, the name Login Items shows", () => {
    expect(DESKTOP_AGENT_LAUNCHER).toEqual(["bin", "Bytezard Lead"]);
  });

  it("associates the background item with the Bytezard Lead app", () => {
    expect(xml).toContain("<key>AssociatedBundleIdentifiers</key><string>com.bytezard.plc</string>");
    expect(DESKTOP_APP_BUNDLE_ID).toBe("com.bytezard.plc");
    // 开发机的 plist 不带它。
    expect(plistContent({ nodeBin: "/n", entry: "/e", cwd: "/c", logDir: "/l" })).not.toContain("AssociatedBundleIdentifiers");
  });

  it("reads back a working directory that needed XML escaping", () => {
    const escaped = plistContent({ nodeBin: "/n", entry: "/e", cwd: "/a & <b>", logDir: "/l" });
    expect(plistWorkingDirectory(escaped)).toBe("/a & <b>");
    expect(plistWorkingDirectory("<plist/>")).toBeNull();
  });

  it("looks for the plist with the old name", () => {
    expect(preRenamePlistPaths()).toEqual([join(launchAgentsDir(), "com.pi-lead-child.supervisor.plist")]);
  });
});

// P0-8：新名字（docs/desktop/macos-desktop-design.md 第 8.5 节）。
describe("launchd labels", () => {
  it("uses the new names, and keeps the old ones only for the migration", () => {
    expect(LAUNCHD_LABEL).toBe("com.bytezard.plc.supervisor");
    expect(HINDSIGHT_LABEL).toBe("com.bytezard.plc.hindsight");
    expect(PRE_RENAME_LAUNCHD_LABEL).toBe("com.pi-lead-child.supervisor");
  });

  // 合并以后、迁移以前，开发机上还是旧目录和旧任务：用旧目录的进程也看旧任务，不另装一个新任务。
  it("follows the data folder: the old folder goes with the old tasks", () => {
    const home = "/Users/alice";
    expect(activeLaunchdLabel("/Users/alice/.pi-lead-child", home)).toBe("com.pi-lead-child.supervisor");
    expect(activeLaunchdLabel("/Users/alice/Library/Application Support/Bytezard Lead", home)).toBe(LAUNCHD_LABEL);
    expect(activeLaunchdLabel("/tmp/plc-test", home)).toBe(LAUNCHD_LABEL);
  });

  it("names the Hindsight task after the data folder in the same way", () => {
    const old = join(homedir(), ".pi-lead-child");
    expect(hindsightLabel(old)).toBe("com.pi-lead-child.hindsight");
    expect(hindsightLabel(join(homedir(), "Library", "Application Support", "Bytezard Lead"))).toBe(HINDSIGHT_LABEL);
    expect(hindsightPlist({
      programArguments: ["/n", "/e"], dataDir: old, logDir: "/l",
      service: { uvx: "/opt/homebrew/bin/uvx" } as never,
    })).toContain("<key>Label</key><string>com.pi-lead-child.hindsight</string>");
  });
});
