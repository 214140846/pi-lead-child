import { describe, it, expect } from "vitest";
import {
  desktopPlistOptions, LAUNCHD_LABEL, plistContent, plistWorkingDirectory, PRE_RENAME_LAUNCHD_LABEL, preRenamePlistPaths,
} from "../src/deploy/launchd.js";

describe("plistContent", () => {
  const xml = plistContent({
    nodeBin: "/usr/local/bin/node",
    entry: "/repo/dist/supervisor.mjs",
    cwd: "/repo",
    logDir: "/home/.pi-lead-child/logs",
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
      logDir: "/home/.pi-lead-child/logs",
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
    expect(xml).toContain(`<string>${root}/bin/lead-agent</string>`);
    expect(xml).toContain(`<string>${root}/apps/daemon/dist/supervisor.mjs</string>`);
    expect(plistWorkingDirectory(xml)).toBe(root);
    expect(xml).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
  });

  it("reads back a working directory that needed XML escaping", () => {
    const escaped = plistContent({ nodeBin: "/n", entry: "/e", cwd: "/a & <b>", logDir: "/l" });
    expect(plistWorkingDirectory(escaped)).toBe("/a & <b>");
    expect(plistWorkingDirectory("<plist/>")).toBeNull();
  });

  it("has no pre-rename plist to look for while the label still has the old name", () => {
    expect(preRenamePlistPaths()).toEqual(PRE_RENAME_LAUNCHD_LABEL === LAUNCHD_LABEL ? [] : [expect.stringContaining(PRE_RENAME_LAUNCHD_LABEL)]);
  });
});
