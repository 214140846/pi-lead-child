// 运行包的旧版本（runtime-versions.ts）：只留这次的和上一个；还有进程在用的、名字不是版本号的不删；看不出谁在用时一个都不删。
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { pruneRuntimeVersions } from "../src/deploy/runtime-versions.js";

function versionsDir(names: string[]) {
  const dir = join(tempDir("plc-runtime-versions-"), "Bytezard Lead", "runtime", "versions");
  for (const name of names) mkdirSync(join(dir, name, "bin"), { recursive: true });
  return dir;
}

describe("pruneRuntimeVersions", () => {
  it("keeps the installed and the previous version, and removes the older ones", () => {
    const dir = versionsDir(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]);
    const result = pruneRuntimeVersions({ versionsDir: dir, keep: ["1.3.0", "1.2.0"], runningCommands: () => [] });
    expect(result).toEqual({ removed: ["1.0.0", "1.1.0"], inUse: [], failed: [] });
    expect(readdirSync(dir).sort()).toEqual(["1.2.0", "1.3.0"]);
  });

  it("keeps a version that a running process still uses, and folders that are not versions", () => {
    const dir = versionsDir(["0.9.0", "1.0.0-local.202611042319", "1.1.0", "1.3.0", "1.4.0.partial"]);
    const executor = `${join(dir, "1.0.0-local.202611042319")}/bin/lead-agent --run 7`;
    const result = pruneRuntimeVersions({ versionsDir: dir, keep: ["1.3.0", "1.1.0"], runningCommands: () => ["/sbin/launchd", executor] });
    expect(result).toEqual({ removed: ["0.9.0"], inUse: ["1.0.0-local.202611042319"], failed: [] });
    expect(readdirSync(dir).sort()).toEqual(["1.0.0-local.202611042319", "1.1.0", "1.3.0", "1.4.0.partial"]);
  });

  it("removes nothing when it cannot tell which versions are in use", () => {
    const dir = versionsDir(["1.0.0", "1.3.0"]);
    const result = pruneRuntimeVersions({ versionsDir: dir, keep: ["1.3.0"], runningCommands: () => { throw new Error("ps failed"); } });
    expect(result).toEqual({ removed: [], inUse: ["1.0.0"], failed: [] });
    expect(existsSync(join(dir, "1.0.0"))).toBe(true);
  });

  it("does nothing when there is no versions folder", () => {
    expect(pruneRuntimeVersions({ versionsDir: join(tempDir("plc-runtime-versions-"), "missing"), keep: [] }))
      .toEqual({ removed: [], inUse: [], failed: [] });
  });
});
