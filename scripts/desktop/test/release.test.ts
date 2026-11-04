import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  hashFiles, parseNodeVersionFile, parsePackArgs, releaseManifest, runtimeArchiveName, sha256File, updateManifest, UsageError,
} from "../lib/release.js";

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
      builtAt: new Date("2026-11-03T08:00:00Z"), repository: "acme/x", files: { "bin/lead-agent": "b".repeat(64) },
    });
    expect(release).toEqual({
      schema: 1, product: "bytezard-lead", version: "1.3.0", arch: "arm64", node: "24.22.2", schemaVersion: 63,
      sourceTree: "a".repeat(40), builtAt: "2026-11-03T08:00:00.000Z",
      updateSource: { type: "github", repository: "acme/x" }, files: { "bin/lead-agent": "b".repeat(64) },
    });
    expect(updateManifest(release, { file: "f.tar.gz", size: 3, sha256: "c".repeat(64) })).toMatchObject({
      product: "bytezard-lead", version: "1.3.0", arch: "arm64", schemaVersion: 63, runtime: { file: "f.tar.gz", size: 3 },
    });
  });

  it("hashes files and names the one that is missing", async () => {
    const dir = tempDir("plc-desktop-release-");
    writeFileSync(join(dir, "a"), "hello");
    expect(await hashFiles(dir, ["a"])).toEqual({ a: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
    expect(await sha256File(join(dir, "a"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    await expect(hashFiles(dir, ["a", "b/missing"])).rejects.toThrow(/缺少 b\/missing/);
  });
});
