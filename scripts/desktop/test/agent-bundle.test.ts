// 后台服务的程序（设计第 8.7 节，P0-7 返工，做法 1b）：Node 叫 bin/lead-agent，用自己的标识重新做 ad-hoc 签名；
// 软链接 bin/Bytezard Lead 指向它，launchd 的 plist 写这个软链接。
// 2026-11-04 实测 4：「允许在后台」显示 plist 里路径的文件名（软链接自己的名字），进程名跟着真实文件名走。
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { DESKTOP_AGENT_LAUNCHER, DESKTOP_APP_BUNDLE_ID } from "../../../packages/supervisor/src/deploy/launchd.js";
import {
  AGENT_BINARY, AGENT_EXECUTABLE, AGENT_LAUNCH_NAME, AGENT_LAUNCHER, AGENT_SIGN_ID, AGENT_STAGING, agentInfoPlist, installAgent, makeAgentBundle,
} from "../lib/agent-bundle.js";

describe("agent launcher", () => {
  it("is what the launchd plist runs", () => {
    expect(AGENT_LAUNCHER).toBe(DESKTOP_AGENT_LAUNCHER.join("/"));
    // 签名标识和 App 的不一样：两个都注册到系统里时不会被当成同一个 App。
    expect(AGENT_SIGN_ID).not.toBe(DESKTOP_APP_BUNDLE_ID);
  });

  // 「允许在后台」显示软链接的名字，活动监视器显示真实文件名（第 9 节决定 6 定的进程名是 lead-agent）。
  // 改这两个名字，用户在登录项和活动监视器里看到的名字就会跟着变。
  it("shows Bytezard Lead in Login Items and keeps the process name lead-agent", () => {
    expect(AGENT_LAUNCH_NAME).toBe("Bytezard Lead");
    expect(AGENT_EXECUTABLE).toBe("lead-agent");
    expect(AGENT_BINARY).toBe("bin/lead-agent");
    expect(AGENT_LAUNCHER).toBe("bin/Bytezard Lead");
  });

  it("places the binary, signs it, then links Bytezard Lead to it with a relative path", async () => {
    const root = tempDir("plc-agent-");
    const calls: string[] = [];
    const staged = join(root, AGENT_STAGING);
    const result = await installAgent({
      root,
      placeBinary: (dest) => { calls.push(`place ${dest}`); copyFileSync("/usr/bin/true", dest); },
      sign: async (path, identifier) => { calls.push(`sign ${path} ${identifier}`); },
    });
    expect(result).toEqual({
      binary: join(root, "bin", "lead-agent"), launcher: join(root, "bin", "Bytezard Lead"), memoryLauncher: join(root, "bin", "Bytezard Lead Memory"),
    });
    // Hindsight 记忆服务的 plist 写这个软链接：「允许在后台」显示 Bytezard Lead Memory，不再显示 lead-agent（用户 2026-11-05）。
    expect(readlinkSync(result.memoryLauncher)).toBe("lead-agent");
    // 先在临时位置放好、签好，再 rename 过去：正在用旧副本运行的进程不受影响。
    expect(calls).toEqual([`place ${staged}`, `sign ${staged} com.bytezard.plc.agent`]);
    expect(existsSync(staged)).toBe(false);
    expect(existsSync(result.binary)).toBe(true);
    expect(lstatSync(result.launcher).isSymbolicLink()).toBe(true);
    expect(readlinkSync(result.launcher)).toBe("lead-agent");
  });

  // 开发机的 plc daemon install 每次都重新复制 Node（P0-8）。
  it("can run again over an earlier copy, and replaces the binary with a new file", async () => {
    const root = tempDir("plc-agent-again-");
    const sign = async () => {};
    const first = await installAgent({ root, placeBinary: (dest) => writeFileSync(dest, "old"), sign });
    const before = statSync(first.binary).ino;
    const second = await installAgent({ root, placeBinary: (dest) => writeFileSync(dest, "new"), sign });
    expect(second).toEqual(first);
    expect(readFileSync(second.binary, "utf8")).toBe("new");
    expect(statSync(second.binary).ino).not.toBe(before);
    expect(readlinkSync(second.launcher)).toBe("lead-agent");
  });

  it("leaves the earlier copy in place when signing fails", async () => {
    const root = tempDir("plc-agent-fail-");
    const first = await installAgent({ root, placeBinary: (dest) => writeFileSync(dest, "old"), sign: async () => {} });
    await expect(installAgent({
      root, placeBinary: (dest) => writeFileSync(dest, "new"), sign: async () => { throw new Error("codesign failed"); },
    })).rejects.toThrow("codesign failed");
    expect(readFileSync(first.binary, "utf8")).toBe("old");
    expect(existsSync(join(root, AGENT_STAGING))).toBe(false);
  });

  // 真的 codesign：拿系统自带的一个小程序当 Node，签完以后签名标识是自己的，没有 Team ID；经软链接也能运行。
  it.skipIf(process.platform !== "darwin")("re-signs the binary ad-hoc with its own identifier", async () => {
    const root = tempDir("plc-agent-sign-");
    const { binary, launcher } = await installAgent({ root, placeBinary: (dest) => copyFileSync("/usr/bin/true", dest) });
    // codesign -dv 把结果写到 stderr。
    const details = execFileSync("sh", ["-c", 'codesign -dv "$1" 2>&1', "sh", binary], { encoding: "utf8" });
    expect(details).toContain("Identifier=com.bytezard.plc.agent");
    expect(details).toContain("Signature=adhoc");
    expect(details).toContain("TeamIdentifier=not set");
    execFileSync("codesign", ["--verify", "--strict", binary]);
    execFileSync(launcher);
  });
});

// 实测 3 用过的程序包做法，现在只给探测脚本的 p1、p2、p5 用。
describe("probe bundle (measurement 3 only)", () => {
  const spec = {
    dirName: "Probe Agent.app", name: "Probe Name", displayName: "Probe Display",
    bundleId: "com.bytezard.plc.test-agent", executable: "probe-exec", version: "1.3.0",
  };

  it("writes the names into Info.plist and keeps the bundle out of the Dock", () => {
    const plist = agentInfoPlist(spec);
    expect(plist).toContain("<key>CFBundleName</key><string>Probe Name</string>");
    expect(plist).toContain("<key>CFBundleExecutable</key><string>probe-exec</string>");
    expect(plist).toContain("<key>LSBackgroundOnly</key><true/>");
    expect(agentInfoPlist({ ...spec, name: "A & <B>" })).toContain("<string>A &amp; &lt;B&gt;</string>");
  });

  it.skipIf(process.platform !== "darwin")("signs the whole bundle ad-hoc", async () => {
    const parent = tempDir("plc-agent-bundle-");
    const binary = await makeAgentBundle({ parentDir: parent, spec, placeBinary: (dest) => copyFileSync("/usr/bin/true", dest) });
    expect(binary).toBe(join(parent, "Probe Agent.app", "Contents", "MacOS", "probe-exec"));
    execFileSync("codesign", ["--verify", "--strict", join(parent, "Probe Agent.app")]);
  });
});
