// 运行包的旧版本（runtime-versions.ts）：只留这次的和上一个；还有进程在用的、名字不是版本号的不删；看不出谁在用时一个都不删。
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { pruneRuntimeVersions, pruneSharedNodeModules, sharedNodeModulesDir } from "../src/deploy/runtime-versions.js";

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

// 共用的 node_modules（docs/desktop/macos-desktop-design.md 第 7.5.4 节）：版本目录里的 node_modules 指向
// shared/node_modules/<哈希>/node_modules。删完旧版本以后，没有版本再指向的那一份删掉。
describe("pruneSharedNodeModules", () => {
  it("removes the copies that no version folder points at, and keeps the rest", () => {
    const installRoot = join(tempDir("plc-shared-modules-"), "Bytezard Lead", "runtime");
    const shared = sharedNodeModulesDir(installRoot);
    const [a, b, c] = ["a", "b", "c"].map((char) => char.repeat(64));
    for (const name of [a!, b!, c!, `${c}.partial`]) mkdirSync(join(shared, name, "node_modules"), { recursive: true });
    const version = (name: string, target: string | null) => {
      const dir = join(installRoot, "versions", name);
      mkdirSync(dir, { recursive: true });
      if (target) symlinkSync(join("..", "..", "shared", "node_modules", target, "node_modules"), join(dir, "node_modules"));
    };
    version("1.3.0", a!);
    // 解了一半的版本也算：壳正在用它。
    version("1.4.0.partial", b!);
    // 旧版 App 整个解出的版本：node_modules 是真目录，不指向任何一份。
    version("1.2.0", null);
    mkdirSync(join(installRoot, "versions", "1.2.0", "node_modules"));

    expect(pruneSharedNodeModules(installRoot)).toEqual([c]);
    expect(readdirSync(shared).sort()).toEqual([a, b, `${c}.partial`].sort());
    expect(existsSync(join(installRoot, "versions", "1.2.0", "node_modules"))).toBe(true);
  });

  it("does nothing when there is no shared folder", () => {
    expect(pruneSharedNodeModules(join(tempDir("plc-shared-modules-"), "runtime"))).toEqual([]);
  });
});
