// 部署闸门的发布模式（docs/desktop/macos-desktop-design.md 第 3 节，P0-1）。桌面版的运行包根目录有 release.json，
// 用户的机器上没有 git：闸门按版本、架构、文件哈希、安装位置和库的 schema 版本判断，不调用 git。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "@pi-lead-child/core/testing";
import { LATEST_SCHEMA_VERSION, openDb } from "@pi-lead-child/store";
import { deployReadiness } from "../src/deploy/readiness.js";
import { readReleaseManifest, releaseInstallRoot } from "../src/deploy/release.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const FILES: Record<string, string> = {
  "bin/lead-agent": "#!/bin/sh\n",
  "apps/daemon/dist/coordinatord.mjs": "export {};\n",
  "apps/daemon/dist/web/index.html": "<html></html>\n",
};

let dataDir: string;
let installRoot: string;
let versionDir: string;
let root: string;
let dbPath: string;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function writeManifest(overrides: Record<string, unknown> = {}): void {
  const manifest = {
    schema: 1,
    product: "bytezard-lead",
    version: "1.3.0",
    arch: process.arch,
    node: "24.0.0",
    schemaVersion: LATEST_SCHEMA_VERSION,
    sourceTree: "0".repeat(40),
    builtAt: "2026-11-03T08:00:00Z",
    updateSource: { type: "github", repository: "acme/x" },
    files: Object.fromEntries(Object.entries(FILES).map(([file, text]) => [file, sha256(text)])),
    ...overrides,
  };
  writeFileSync(join(versionDir, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const readiness = () => deployReadiness(root, join(root, "apps", "daemon", "dist"), { installRoot, dbPath });
const reasons = () => readiness().reasons.join("\n");

beforeEach(() => {
  vi.mocked(execFileSync).mockClear();
  dataDir = tempDir("plc-deploy-release-");
  installRoot = releaseInstallRoot(dataDir);
  versionDir = join(installRoot, "versions", "1.3.0");
  for (const [file, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(versionDir, file)), { recursive: true });
    writeFileSync(join(versionDir, file), text);
  }
  writeManifest();
  symlinkSync(join("versions", "1.3.0"), join(installRoot, "current"));
  // plist 写的是 current 的路径，不写具体版本。
  root = join(installRoot, "current");
  dbPath = join(dataDir, "plc.db");
  openDb(dbPath).close();
});

describe("deploy readiness in release mode", () => {
  it("passes an intact install of this architecture, and does not call git", () => {
    expect(readiness()).toMatchObject({
      ready: true, reasons: [], mode: "release", head: null, build: null,
      release: { version: "1.3.0", arch: process.arch, schemaVersion: LATEST_SCHEMA_VERSION, installRoot },
    });
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  // 证明上面「不调用 git」的断言是有效的：同一个 mock 能看到开发模式的 git 调用。
  it("falls back to the git checks when the root has no release.json", () => {
    const checkout = tempDir("plc-deploy-release-dev-");
    expect(deployReadiness(checkout, join(checkout, "apps", "daemon", "dist"), { installRoot, dbPath }))
      .toMatchObject({ ready: false, mode: "dev", release: null });
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith("git", expect.arrayContaining(["-C", checkout]), expect.anything());
  });

  it("passes on a first install, before the database exists", () => {
    rmSync(dbPath);
    expect(readiness()).toMatchObject({ ready: true, mode: "release" });
  });

  it("refuses a file that does not match its hash, and names the file", () => {
    writeFileSync(join(versionDir, "apps/daemon/dist/coordinatord.mjs"), "export const half = 1;\n");
    expect(readiness()).toMatchObject({ ready: false, mode: "release" });
    expect(reasons()).toContain("apps/daemon/dist/coordinatord.mjs（哈希不对）");
    expect(reasons()).not.toContain("bin/lead-agent");
  });

  it("refuses a file that is missing, and names the file", () => {
    rmSync(join(versionDir, "apps/daemon/dist/web/index.html"));
    expect(reasons()).toContain("apps/daemon/dist/web/index.html（缺失或读不了）");
  });

  it("refuses a package built for another architecture", () => {
    const other = process.arch === "arm64" ? "x64" : "arm64";
    writeManifest({ arch: other });
    expect(readiness().ready).toBe(false);
    expect(reasons()).toContain(`运行包是 ${other} 架构，这台机器是 ${process.arch}`);
  });

  it("refuses a downgrade: the database schema is newer than the package supports", () => {
    writeManifest({ version: "1.2.0", schemaVersion: LATEST_SCHEMA_VERSION - 1 });
    expect(readiness().ready).toBe(false);
    expect(reasons()).toContain("这是一次降级");
    expect(reasons()).toContain(`库的 schema 版本是 ${LATEST_SCHEMA_VERSION}`);
  });

  it("refuses current pointing outside the install root", () => {
    const elsewhere = join(dataDir, "elsewhere");
    mkdirSync(dataDir, { recursive: true });
    rmSync(join(installRoot, "current"));
    // 一份完整、哈希都对的运行包，只是不在安装根的 versions 目录里。
    for (const [file, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(elsewhere, file)), { recursive: true });
      writeFileSync(join(elsewhere, file), text);
    }
    versionDir = elsewhere;
    writeManifest();
    symlinkSync(elsewhere, join(installRoot, "current"));
    expect(readiness().ready).toBe(false);
    expect(reasons()).toContain("不在安装根的 versions 目录里");
  });

  it("refuses when current points at the versions directory itself, or is missing", () => {
    rmSync(join(installRoot, "current"));
    symlinkSync("versions", join(installRoot, "current"));
    expect(deployReadiness(versionDir, join(versionDir, "apps", "daemon", "dist"), { installRoot, dbPath }).reasons.join("\n"))
      .toContain("不在安装根的 versions 目录里");
    rmSync(join(installRoot, "current"));
    expect(deployReadiness(versionDir, join(versionDir, "apps", "daemon", "dist"), { installRoot, dbPath }).reasons.join("\n"))
      .toContain("没有 current");
  });

  it("refuses without an install root", () => {
    expect(deployReadiness(root, join(root, "apps", "daemon", "dist"), { dbPath }).reasons.join("\n")).toContain("不知道安装根");
  });

  it("refuses a manifest it cannot read or does not know, and still does not call git", () => {
    writeFileSync(join(versionDir, "release.json"), "{ half");
    expect(readiness()).toMatchObject({ ready: false, mode: "release", release: null });
    expect(reasons()).toContain("不是合法的 JSON");
    writeManifest({ schema: 2 });
    expect(reasons()).toContain("schema 是 2");
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });
});

describe("readReleaseManifest", () => {
  it("rejects paths that leave the package, bad hashes, and an empty file list", () => {
    writeManifest({ files: { "../plc.db": sha256("x"), "/etc/hosts": sha256("x"), "bin/lead-agent": "not-a-hash" } });
    const message = (() => { try { readReleaseManifest(versionDir); return ""; } catch (error) { return (error as Error).message; } })();
    expect(message).toContain("\"../plc.db\" 不是运行包里的相对路径");
    expect(message).toContain("\"/etc/hosts\" 不是运行包里的相对路径");
    expect(message).toContain("bin/lead-agent 的哈希不是 SHA-256");
    writeManifest({ files: {} });
    expect(() => readReleaseManifest(versionDir)).toThrow("files 为空");
    writeManifest({ product: "other" });
    expect(() => readReleaseManifest(versionDir)).toThrow("product 不是 bytezard-lead");
  });
});
