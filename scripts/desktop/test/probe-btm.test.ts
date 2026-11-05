// P0-7 返工的实测工具（scripts/desktop/probe-btm.ts）：探测项的名字各不相同，label 不和正在运行的服务冲突，
// p9 和运行包的做法完全一样（做法 1b），用来做端到端实测。
import { describe, expect, it } from "vitest";
import { LAUNCHD_LABEL } from "../../../packages/supervisor/src/deploy/launchd.js";
import { DESKTOP_AGENT_LAUNCHER } from "../../../packages/supervisor/src/deploy/launchd.js";
import { AGENT_BINARY, AGENT_LAUNCHER } from "../lib/agent-bundle.js";
import {
  COMMAND_TIMEOUT_MS, launchdPid, probeExecutable, probeLaunchPath, probePlist, probeRecords, probeVariants, runCommand, selectVariants,
} from "../lib/probe-btm.js";

const ROOT = "/Users/alice/Library/Application Support/Bytezard Lead Probe/btm";

describe("login item probe", () => {
  const variants = probeVariants();

  it("uses separate labels that never touch the running service", () => {
    const labels = variants.map((v) => v.label);
    expect(labels).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"].map((id) => `com.bytezard.plc.probe-${id}`));
    expect(labels).not.toContain(LAUNCHD_LABEL);
    expect(new Set(labels).size).toBe(9);
  });

  // 实测 4：可执行文件直接叫 Bytezard Lead，以及用软链接保住 lead-agent 这个进程名的两个方向。
  it("names p6 to p8 so the screenshot tells which file name macOS used", () => {
    const [p6, p7, p8] = ["p6", "p7", "p8"].map((id) => variants.find((v) => v.id === id)!);
    expect(probeLaunchPath(ROOT, p6!)).toBe(`${ROOT}/p6/Bytezard Lead P6`);
    expect(probeExecutable(ROOT, p7!)).toBe(`${ROOT}/p7/Bytezard Lead P7`);
    expect(probeLaunchPath(ROOT, p7!)).toBe(`${ROOT}/p7/lead-agent-p7`);
    expect(probeExecutable(ROOT, p8!)).toBe(`${ROOT}/p8/lead-agent-p8`);
    expect(probeLaunchPath(ROOT, p8!)).toBe(`${ROOT}/p8/Bytezard Lead P8`);
    // plist 写的是软链接的路径，带空格也照原样写进去。
    expect(probePlist(ROOT, p8!, `${ROOT}/idle.cjs`)).toContain(`<string>${ROOT}/p8/Bytezard Lead P8</string>`);
    for (const v of [p6!, p7!, p8!]) {
      expect(v.signIdentifier).toBe(`com.bytezard.plc.probe-${v.id}`);
      expect(v.associatedBundleId).toBeNull();
    }
  });

  it("installs only the probes named on the command line", () => {
    expect(selectVariants(["p5", "p6", "p7", "p8"]).map((v) => v.id)).toEqual(["p5", "p6", "p7", "p8"]);
    expect(selectVariants([])).toHaveLength(9);
    expect(() => selectVariants(["p10"])).toThrow(/没有这些探测项：p10/);
  });

  it("reads the pid from launchctl print", () => {
    expect(launchdPid("gui/501/com.bytezard.plc.probe-p6 = {\n\tstate = running\n\tpid = 4242\n}")).toBe(4242);
    expect(launchdPid("\tstate = not running\n")).toBeNull();
  });

  it("gives every name in p1 and p2 its own text, so the list shows which field macOS used", () => {
    for (const id of ["p1", "p2"]) {
      const b = variants.find((v) => v.id === id)!.bundle!;
      expect(new Set([b.dirName.replace(/\.app$/, ""), b.name, b.displayName, b.executable]).size).toBe(4);
    }
  });

  it("keeps p5 as the measurement 3 bundle, for comparison", () => {
    const p5 = variants.find((v) => v.id === "p5")!;
    expect(probeExecutable(ROOT, p5)).toBe(`${ROOT}/p5/Bytezard Lead.app/Contents/MacOS/lead-agent`);
    expect(p5.associatedBundleId).toBe("com.bytezard.plc");
  });

  // 端到端实测用 p9：和打包脚本同一个函数（installAgent），plist 写的路径和交付的 plist 一样（bin/Bytezard Lead）。
  it("builds p9 exactly like the runtime package and its plist", () => {
    const p9 = variants.find((v) => v.id === "p9")!;
    expect(p9.shipped).toBe(true);
    expect(probeExecutable(ROOT, p9)).toBe(`${ROOT}/p9/${AGENT_BINARY}`);
    expect(probeLaunchPath(ROOT, p9)).toBe(`${ROOT}/p9/${AGENT_LAUNCHER}`);
    expect(AGENT_LAUNCHER).toBe(DESKTOP_AGENT_LAUNCHER.join("/"));
    expect(p9.signIdentifier).toBe("com.bytezard.plc.agent");
    expect(p9.associatedBundleId).toBe("com.bytezard.plc");
    expect(probePlist(ROOT, p9, `${ROOT}/idle.cjs`)).toContain(`<string>${ROOT}/p9/bin/Bytezard Lead</string>`);
  });

  it("keeps Node's own signature only in p4", () => {
    expect(variants.filter((v) => v.signIdentifier === null).map((v) => v.id)).toEqual(["p4"]);
  });

  it("writes a plist that runs the probe executable and associates the app only where asked", () => {
    const [p1, p2] = variants;
    const xml = probePlist(ROOT, p2!, `${ROOT}/idle.cjs`);
    expect(xml).toContain("<key>Label</key><string>com.bytezard.plc.probe-p2</string>");
    expect(xml).toContain(`<string>${ROOT}/p2/P2 Folder.app/Contents/MacOS/p2-exec</string>`);
    expect(xml).toContain("<key>AssociatedBundleIdentifiers</key><string>com.bytezard.plc</string>");
    expect(probePlist(ROOT, p1!, `${ROOT}/idle.cjs`)).not.toContain("AssociatedBundleIdentifiers");
    expect(probePlist("/a & <b>", p1!, "/i")).toContain("/a &amp; &lt;b&gt;/p1/");
  });

  it("prints only the probe records from sfltool dumpbtm", () => {
    const dump = [
      "========================",
      " Records for UID 501 : 00000000-0000-0000-0000-000000000000",
      "========================",
      "",
      " #1:",
      "                 UUID: 1",
      "                 Name: Zoom",
      "           Identifier: us.zoom.updater",
      "",
      " #2:",
      "                 Name: P1 BundleName",
      "           Identifier: 16.com.bytezard.plc.probe-p1",
      "",
      " #3:",
      "                 Name: Bytezard Lead",
      "           Identifier: 16.com.bytezard.plc.probe-p5",
    ].join("\n");
    const records = probeRecords(dump);
    expect(records).toHaveLength(2);
    expect(records.join("\n")).not.toContain("Zoom");
    expect(records[1]).toContain("Name: Bytezard Lead");
  });

  // 代跑时一条命令卡住，整次实测就等到 run_on_host 的上限（180 秒）。
  it("stops a subcommand that hangs, and reports it as failed", async () => {
    expect(COMMAND_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    const started = Date.now();
    const result = await runCommand("sleep", ["10"], 200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result).toEqual({ ok: false, out: "sleep 超过 0.2 秒没有结束，已停止" });
    expect(await runCommand("echo", ["ok"])).toEqual({ ok: true, out: "ok" });
  });
});
