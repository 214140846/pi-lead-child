import { chmodSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  buildNumber, componentOf, dmgName, hashComponents, hashFiles, localVersion, parseNodeVersionFile, parsePackArgs, releaseManifest,
  runtimeArchiveName, sha256File, updateManifest, UsageError, withDmg,
} from "../lib/release.js";

const components = { node: "1".repeat(64), node_modules: "2".repeat(64), service: "3".repeat(64), web: "4".repeat(64), cli: "5".repeat(64) };

const valid = ["--arch", "arm64", "--version", "1.3.0", "--repository", "acme/x"];

describe("parsePackArgs", () => {
  it("accepts arm64 with a version and a repository", () => {
    expect(parsePackArgs(valid)).toEqual({ arch: "arm64", version: "1.3.0", repository: "acme/x", out: null, nodeDistUrl: null });
    expect(parsePackArgs([...valid, "--out", "/tmp/o", "--node-dist-url", "https://mirror.example.com/node"]))
      .toMatchObject({ out: "/tmp/o", nodeDistUrl: "https://mirror.example.com/node" });
    expect(parsePackArgs(["--arch", "arm64", "--version", "1.3.0-rc.1", "--repository", "acme/x"]).version).toBe("1.3.0-rc.1");
  });

  it("only accepts arm64", () => {
    expect(() => parsePackArgs(["--arch", "x64", "--version", "1.3.0", "--repository", "acme/x"])).toThrow(/只接受 arm64/);
    expect(() => parsePackArgs(["--version", "1.3.0", "--repository", "acme/x"])).toThrow(/缺少 --arch/);
  });

  it("rejects versions that are not semver, so they cannot escape versions/<版本>/", () => {
    for (const version of ["../1.3.0", "1.3", "v1.3.0", "1.3.0/x", "1.3.0-"]) {
      expect(() => parsePackArgs(["--arch", "arm64", "--version", version, "--repository", "acme/x"])).toThrow(UsageError);
    }
  });

  it("takes the repository from the arguments and checks its shape", () => {
    for (const repository of ["acme", "acme/x/y", "acme/..", "https://github.com/acme/x", "acme/x;rm"]) {
      expect(() => parsePackArgs(["--arch", "arm64", "--version", "1.3.0", "--repository", repository])).toThrow(UsageError);
    }
    expect(() => parsePackArgs(["--arch", "arm64", "--version", "1.3.0"])).toThrow(/缺少 --repository/);
  });

  it("rejects unknown flags, repeated flags, missing values and non-http mirrors", () => {
    expect(() => parsePackArgs([...valid, "--x64"])).toThrow(/不认识的参数/);
    expect(() => parsePackArgs([...valid, "--arch", "arm64"])).toThrow(/写了两次/);
    expect(() => parsePackArgs(["--arch"])).toThrow(/缺少值/);
    expect(() => parsePackArgs([...valid, "--node-dist-url", "file:///etc"])).toThrow(/http/);
  });
});

describe("names and manifests", () => {
  it("reads desktop/node-version", () => {
    expect(parseNodeVersionFile("24.22.2\n")).toBe("24.22.2");
    expect(parseNodeVersionFile("v24.22.2")).toBe("24.22.2");
    expect(() => parseNodeVersionFile("lts/krypton")).toThrow(/x\.y\.z/);
  });

  it("names the runtime archive bytezard-lead-runtime-<版本>-arm64.tar.gz", () => {
    expect(runtimeArchiveName("1.3.0")).toBe("bytezard-lead-runtime-1.3.0-arm64.tar.gz");
  });

  it("writes release.json with the product name and the repository it was given", () => {
    const release = releaseManifest({
      version: "1.3.0", node: "24.22.2", schemaVersion: 63, sourceTree: "a".repeat(40),
      builtAt: new Date("2026-11-03T08:00:00Z"), repository: "acme/x", files: { "bin/lead-agent": "b".repeat(64) }, components,
    });
    expect(release).toEqual({
      schema: 1, product: "bytezard-lead", version: "1.3.0", arch: "arm64", node: "24.22.2", schemaVersion: 63,
      sourceTree: "a".repeat(40), builtAt: "2026-11-03T08:00:00.000Z",
      updateSource: { type: "github", repository: "acme/x" }, files: { "bin/lead-agent": "b".repeat(64) }, components,
    });
    expect(updateManifest(release, { file: "f.tar.gz", size: 3, sha256: "c".repeat(64) })).toMatchObject({
      product: "bytezard-lead", version: "1.3.0", arch: "arm64", schemaVersion: 63, runtime: { file: "f.tar.gz", size: 3 }, components,
    });
  });

  // 组成（设计第 7.5.1 节）：每个文件归到一个组成；不认识的文件让打包失败。
  it("puts every file of the runtime into one component", () => {
    expect(componentOf("bin/lead-agent")).toBe("node");
    expect(componentOf("bin/Bytezard Lead")).toBe("node");
    expect(componentOf("bin/Bytezard Lead Memory")).toBe("node");
    expect(componentOf("bin/plc")).toBe("cli");
    expect(componentOf("apps/cli/dist/cli.mjs")).toBe("cli");
    expect(componentOf("node_modules/better-sqlite3/package.json")).toBe("node_modules");
    expect(componentOf("apps/daemon/dist/web/index.html")).toBe("web");
    expect(componentOf("apps/daemon/dist/coordinatord.mjs")).toBe("service");
    expect(componentOf("apps/daemon/package.json")).toBe("service");
    expect(componentOf("package.json")).toBe("service");
    expect(componentOf("bin/uv")).toBeNull();
  });

  it("hashes each component by path, mode, link target and content, not by time", () => {
    const dir = tempDir("plc-desktop-components-");
    const write = (file: string, text: string) => {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), text);
    };
    write("bin/lead-agent", "node");
    symlinkSync("lead-agent", join(dir, "bin", "node"));
    write("apps/daemon/dist/web/index.html", "<html>");
    write("apps/daemon/dist/ops.mjs", "ops");
    write("release.json", "{}");
    const first = hashComponents(dir);
    utimesSync(join(dir, "apps/daemon/dist/ops.mjs"), new Date(0), new Date(0));
    expect(hashComponents(dir)).toEqual(first);
    chmodSync(join(dir, "bin/lead-agent"), 0o755);
    const executable = hashComponents(dir);
    expect(executable.node).not.toBe(first.node);
    expect({ ...executable, node: first.node }).toEqual(first);
    write("node_modules/x/index.js", "x");
    expect(hashComponents(dir).node_modules).not.toBe(first.node_modules);
    write("extra.txt", "?");
    expect(() => hashComponents(dir)).toThrow(/extra\.txt/);
  });

  it("hashes files and names the one that is missing", async () => {
    const dir = tempDir("plc-desktop-release-");
    writeFileSync(join(dir, "a"), "hello");
    expect(await hashFiles(dir, ["a"])).toEqual({ a: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
    expect(await sha256File(join(dir, "a"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    await expect(hashFiles(dir, ["a", "b/missing"])).rejects.toThrow(/缺少 b\/missing/);
  });
});

// App 的一键更新按 manifest 里的 dmg 下载和校验（desktop/src/updater.ts）。
describe("the dmg in manifest.json", () => {
  const manifest = {
    schema: 1, product: "bytezard-lead", version: "1.3.0", arch: "arm64", node: "24.22.2", schemaVersion: 63,
    sourceTree: "a".repeat(40), builtAt: "2026-11-05T00:00:00.000Z",
    runtime: { file: "bytezard-lead-runtime-1.3.0-arm64.tar.gz", size: 3, sha256: "b".repeat(64) },
    components,
  } as const;

  it("adds the dmg of the same version", () => {
    expect(dmgName("1.3.0")).toBe("bytezard-lead-1.3.0-arm64.dmg");
    expect(withDmg(manifest, { file: "bytezard-lead-1.3.0-arm64.dmg", size: 9, sha256: "c".repeat(64) }).dmg)
      .toEqual({ file: "bytezard-lead-1.3.0-arm64.dmg", size: 9, sha256: "c".repeat(64) });
  });

  it("refuses the dmg of another version, an empty file and a bad hash", () => {
    expect(() => withDmg(manifest, { file: "bytezard-lead-1.2.0-arm64.dmg", size: 9, sha256: "c".repeat(64) })).toThrow(/1\.3\.0/);
    expect(() => withDmg(manifest, { file: "bytezard-lead-1.3.0-arm64.dmg", size: 0, sha256: "c".repeat(64) })).toThrow();
    expect(() => withDmg(manifest, { file: "bytezard-lead-1.3.0-arm64.dmg", size: 9, sha256: "xyz" })).toThrow();
  });
});

// 版本号和构建号（用户 2026-11-05：关于窗口显示「版本 1.1.0 (202611050930)」；本机构建要排在最近的发布之后）。
describe("version and build number", () => {
  const now = new Date("2026-11-05T09:30:59.000Z");

  it("writes the build number as the UTC year, month, day, hour and minute", () => {
    expect(buildNumber(now)).toBe("202611050930");
    expect(buildNumber(new Date("2026-11-05T01:05:00.000+08:00"))).toBe("202611041705");
  });

  it("puts a local build after the last release and before the next patch release", async () => {
    const { compareVersions } = await import("../../../desktop/src/runtime-bundle.js");
    const local = localVersion("1.1.0", now);
    expect(local).toBe("1.1.1-local.202611050930");
    expect(compareVersions(local, "1.1.0")).toBe(1);
    expect(compareVersions(local, "1.1.1")).toBe(-1);
    expect(compareVersions(localVersion("1.1.0", new Date("2026-11-05T09:31:00.000Z")), local)).toBe(1);
    // 在本机构建上再打一次包：还在 1.1.1 之前。
    expect(localVersion("1.1.1-local.202611050800", now)).toBe("1.1.1-local.202611050930");
    expect(() => localVersion("1.1.0.202611050930", now)).toThrow();
  });
});

