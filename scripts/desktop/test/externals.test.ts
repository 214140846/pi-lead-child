import { existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { copyExternals, externalClosure, resolveInLock, type Lockfile } from "../lib/externals.js";

const lock: Lockfile = {
  lockfileVersion: 3,
  packages: {
    "": { dependencies: {} },
    "node_modules/app-only": { version: "1.0.0" },
    "node_modules/root-a": { version: "1.0.0", dependencies: { shared: "^1", nested: "^2" }, bin: { "root-a": "cli.js" } },
    "node_modules/shared": { version: "1.0.0" },
    "node_modules/nested": { version: "1.0.0" },
    "node_modules/root-a/node_modules/nested": { version: "2.0.0", dependencies: { shared: "^1" } },
    "node_modules/@scope/root-b": {
      version: "3.0.0",
      optionalDependencies: { "only-on-intel": "^1" },
      peerDependencies: { "peer-required": "^1", "peer-optional": "^1" },
      peerDependenciesMeta: { "peer-optional": { optional: true } },
      bin: "bin.js",
    },
    "node_modules/only-on-intel": { version: "1.0.0", optional: true, dependencies: { "intel-helper": "^1" } },
    "node_modules/intel-helper": { version: "1.0.0", optional: true },
    "node_modules/peer-required": { version: "1.0.0" },
  },
};

describe("resolveInLock", () => {
  it("follows Node's lookup: the nearest node_modules first, then the parents", () => {
    expect(resolveInLock(lock, "node_modules/root-a", "nested")).toBe("node_modules/root-a/node_modules/nested");
    expect(resolveInLock(lock, "node_modules/root-a/node_modules/nested", "shared")).toBe("node_modules/shared");
    expect(resolveInLock(lock, "", "nested")).toBe("node_modules/nested");
    expect(resolveInLock(lock, "node_modules/@scope/root-b", "peer-optional")).toBeNull();
  });
});

describe("externalClosure", () => {
  it("returns the roots and their runtime dependencies, and nothing else", () => {
    const closure = externalClosure(lock, ["root-a", "@scope/root-b"]);
    expect(closure.map((entry) => [entry.path, entry.version, entry.optional])).toEqual([
      ["node_modules/@scope/root-b", "3.0.0", false],
      ["node_modules/intel-helper", "1.0.0", true],
      ["node_modules/only-on-intel", "1.0.0", true],
      ["node_modules/peer-required", "1.0.0", false],
      ["node_modules/root-a", "1.0.0", false],
      ["node_modules/root-a/node_modules/nested", "2.0.0", false],
      ["node_modules/shared", "1.0.0", false],
    ]);
    expect(closure.map((entry) => entry.name)).not.toContain("app-only");
  });

  it("fails on a missing required dependency, a missing root and a workspace link", () => {
    const broken: Lockfile = { lockfileVersion: 3, packages: { "node_modules/x": { version: "1.0.0", dependencies: { gone: "^1" } } } };
    expect(() => externalClosure(broken, ["x"])).toThrow(/找不到 gone（node_modules\/x 需要它）/);
    expect(() => externalClosure(broken, ["y"])).toThrow(/没有 y/);
    const linked: Lockfile = { lockfileVersion: 3, packages: { "node_modules/x": { version: "1.0.0", link: true } } };
    expect(() => externalClosure(linked, ["x"])).toThrow(/工作区链接/);
    expect(() => externalClosure({ lockfileVersion: 1, packages: {} }, ["x"])).toThrow(/lockfileVersion/);
  });
});

function installPackage(root: string, path: string, version: string, files: Record<string, string> = {}): void {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, "package.json"), JSON.stringify({ name: path.split("node_modules/").pop(), version }));
  for (const [file, content] of Object.entries(files)) writeFileSync(join(root, path, file), content);
}

describe("copyExternals", () => {
  it("copies each package into the same place, skips optional packages that are not installed, and links bins", () => {
    const repo = tempDir("plc-desktop-ext-");
    const dest = tempDir("plc-desktop-ext-");
    installPackage(repo, "node_modules/root-a", "1.0.0", { "cli.js": "#!/usr/bin/env node\n" });
    installPackage(repo, "node_modules/root-a/node_modules/nested", "2.0.0");
    // 不在闭包里，又嵌套在闭包里的包下面：不复制。
    installPackage(repo, "node_modules/root-a/node_modules/stray", "1.0.0");
    installPackage(repo, "node_modules/shared", "1.0.0");
    installPackage(repo, "node_modules/@scope/root-b", "3.0.0", { "bin.js": "" });
    installPackage(repo, "node_modules/peer-required", "1.0.0");
    installPackage(repo, "node_modules/app-only", "1.0.0");
    const entries = externalClosure(lock, ["root-a", "@scope/root-b"]);
    const copied = copyExternals({ repoRoot: repo, lock, entries, dest });
    expect(copied.map((entry) => entry.path)).not.toContain("node_modules/only-on-intel");
    expect(JSON.parse(readFileSync(join(dest, "node_modules/root-a/node_modules/nested/package.json"), "utf8")).version).toBe("2.0.0");
    expect(existsSync(join(dest, "node_modules/root-a/node_modules/stray"))).toBe(false);
    expect(existsSync(join(dest, "node_modules/app-only"))).toBe(false);
    expect(readlinkSync(join(dest, "node_modules/.bin/root-a"))).toBe("../root-a/cli.js");
    expect(readlinkSync(join(dest, "node_modules/.bin/root-b"))).toBe("../@scope/root-b/bin.js");
  });

  it("fails when node_modules does not match package-lock.json", () => {
    const repo = tempDir("plc-desktop-ext-");
    const dest = tempDir("plc-desktop-ext-");
    const small: Lockfile = { lockfileVersion: 3, packages: { "node_modules/x": { version: "1.0.0" } } };
    expect(() => copyExternals({ repoRoot: repo, lock: small, entries: externalClosure(small, ["x"]), dest })).toThrow(/缺少 node_modules\/x/);
    installPackage(repo, "node_modules/x", "1.0.1");
    expect(() => copyExternals({ repoRoot: repo, lock: small, entries: externalClosure(small, ["x"]), dest }))
      .toThrow(/装的是 1\.0\.1，package-lock\.json 写的是 1\.0\.0/);
  });
});
