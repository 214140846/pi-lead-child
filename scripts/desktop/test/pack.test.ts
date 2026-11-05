// 打包脚本的完整流程：假的仓库（构建产物、node_modules、锁文件）加一个假的 Node 下载站。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { DAEMON_EXTERNALS } from "../../../apps/daemon/scripts/externals.js";
import { AGENT_BINARY, AGENT_LAUNCHER, AGENT_SIGN_ID, AGENT_STAGING } from "../lib/agent-bundle.js";
import { packRuntime, PLC_WRAPPER, REQUIRED_BUILD_FILES } from "../lib/pack.js";
import { hashFiles, type ReleaseManifest, type UpdateManifest } from "../lib/release.js";
import type { FetchLike } from "../lib/node-dist.js";
import { CPU, thinMachO } from "./fixtures.js";

const NODE = "24.22.2";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

function write(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

function fakeRepo(o: { sqliteCpu?: number } = {}): string {
  const repo = tempDir("plc-desktop-pack-");
  write(join(repo, "package.json"), JSON.stringify({ name: "fake", workspaces: ["apps/*"] }));
  write(join(repo, "apps/daemon/package.json"), JSON.stringify({ name: "@pi-lead-child/daemon", version: "0.1.0", dependencies: { x: "*" } }));
  write(join(repo, "apps/cli/package.json"), JSON.stringify({ name: "@pi-lead-child/cli", version: "0.1.0" }));
  for (const file of REQUIRED_BUILD_FILES) write(join(repo, file), `// ${file}\n`);
  write(join(repo, "apps/daemon/dist/supervisor.mjs.map"), "{}");
  write(join(repo, "apps/daemon/dist/web/web-build.json"), "{}");
  write(join(repo, "apps/daemon/dist/build-info.json"), "{}");
  write(join(repo, "apps/daemon/dist/.web-staging-123/index.html"), "half-built");
  const packages: Record<string, unknown> = {
    "": { name: "fake", workspaces: ["apps/*"], devDependencies: { vitest: "^4" } },
    "node_modules/vitest": { version: "4.1.10", dev: true },
    "node_modules/better-sqlite3": { version: "12.11.1", dependencies: { bindings: "^1.5.0" } },
    "node_modules/bindings": { version: "1.5.0" },
    "node_modules/@earendil-works/pi-coding-agent": { version: "1.1.0", dependencies: { chalk: "6.0.0" }, bin: { pi: "dist/cli.js" } },
    "node_modules/chalk": { version: "6.0.0" },
    "node_modules/@anthropic-ai/sandbox-runtime": { version: "0.0.81" },
  };
  write(join(repo, "package-lock.json"), JSON.stringify({ name: "fake", lockfileVersion: 3, packages }));
  for (const [path, entry] of Object.entries(packages)) {
    if (!path) continue;
    write(join(repo, path, "package.json"), JSON.stringify({ name: path.slice("node_modules/".length), version: (entry as { version: string }).version }));
  }
  write(join(repo, "node_modules/better-sqlite3/build/Release/better_sqlite3.node"), thinMachO(o.sqliteCpu ?? CPU.arm64));
  write(join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "#!/usr/bin/env node\nconsole.log('1.1.0')\n");
  return repo;
}

// 假的 nodejs.org：v<版本>/SHASUMS256.txt 和 node-v<版本>-darwin-arm64.tar.gz。
function fakeNodeDist(o: { tamper?: boolean } = {}): { fetchImpl: FetchLike; binary: Buffer } {
  const dir = tempDir("plc-desktop-nodedist-");
  const binary = Buffer.concat([thinMachO(CPU.arm64), Buffer.from("fake node")]);
  write(join(dir, `node-v${NODE}-darwin-arm64/bin/node`), binary);
  write(join(dir, `node-v${NODE}-darwin-arm64/README.md`), "not copied");
  const tarball = join(dir, `node-v${NODE}-darwin-arm64.tar.gz`);
  execFileSync("tar", ["-czf", tarball, "-C", dir, `node-v${NODE}-darwin-arm64`]);
  const body = readFileSync(tarball);
  const shasums = `${o.tamper ? sha("other") : sha(body)}  node-v${NODE}-darwin-arm64.tar.gz\n`;
  const fetchImpl: FetchLike = async (url) => {
    if (url === `https://nodejs.org/dist/v${NODE}/SHASUMS256.txt`) return new Response(shasums);
    if (url === `https://nodejs.org/dist/v${NODE}/node-v${NODE}-darwin-arm64.tar.gz`) return new Response(body);
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, binary };
}

// 测试里的假 Node 不是真的 Mach-O，codesign 签不了：只记下要签什么。真的 codesign 在 agent-bundle.test.ts 里测。
const signed: Array<{ path: string; identifier: string }> = [];
const fakeSign = async (path: string, identifier: string) => {
  signed.push({ path, identifier });
};

const pack = (repo: string, out: string, fetchImpl: FetchLike) => packRuntime({
  repoRoot: repo, outDir: out, version: "1.3.0", repository: "acme/x", nodeVersion: NODE, schemaVersion: 63,
  sourceTree: "a".repeat(40), externals: DAEMON_EXTERNALS, fetchImpl, now: new Date("2026-11-03T08:00:00Z"), sign: fakeSign,
});

function listTree(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = path.slice(root.length + 1);
    return lstatSync(path).isDirectory() ? [`${rel}/`, ...listTree(root, path)] : [rel];
  });
}

describe("packRuntime", () => {
  it("builds the arm64 runtime directory, the tar.gz and manifest.json", async () => {
    const repo = fakeRepo();
    const out = join(tempDir("plc-desktop-out-"), "out");
    const dist = fakeNodeDist();
    const result = await pack(repo, out, dist.fetchImpl);
    const runtime = join(out, "runtime");
    expect(result.runtimeDir).toBe(runtime);

    // Node 叫 bin/lead-agent，用自己的标识重签；软链接 bin/Bytezard Lead 指向它，launchd 的 plist 写这个软链接：
    // 登录项显示 Bytezard Lead，进程名还是 lead-agent（设计第 8.7 节，做法 1b）。bin/node 指向它，bin/plc 用它运行。
    expect(AGENT_BINARY).toBe("bin/lead-agent");
    expect(AGENT_LAUNCHER).toBe("bin/Bytezard Lead");
    expect(lstatSync(join(runtime, AGENT_BINARY)).isFile()).toBe(true);
    expect(readFileSync(join(runtime, AGENT_BINARY))).toEqual(dist.binary);
    expect(statSync(join(runtime, AGENT_BINARY)).mode & 0o111).toBe(0o111);
    expect(readlinkSync(join(runtime, AGENT_LAUNCHER))).toBe("lead-agent");
    expect(readFileSync(join(runtime, AGENT_LAUNCHER))).toEqual(dist.binary);
    // 签的是放到 bin/lead-agent 以前的临时文件，签好以后 rename 过去（agent-binary.ts）。
    expect(signed.at(-1)).toEqual({ path: join(runtime, AGENT_STAGING), identifier: AGENT_SIGN_ID });
    expect(existsSync(join(runtime, "Bytezard Lead.app"))).toBe(false);
    expect(readlinkSync(join(runtime, "bin/node"))).toBe("lead-agent");
    expect(readFileSync(join(runtime, "bin/plc"), "utf8")).toBe(PLC_WRAPPER);
    expect(PLC_WRAPPER).toContain('exec "$ROOT/bin/lead-agent" "$ROOT/apps/cli/dist/cli.mjs" "$@"');
    expect(statSync(join(runtime, "bin/plc")).mode & 0o111).toBe(0o111);

    // 仓库的目录形状：projectRoot() 和 workspaceDir() 照旧能找到。
    expect(JSON.parse(readFileSync(join(runtime, "package.json"), "utf8")).workspaces).toEqual([]);
    expect(JSON.parse(readFileSync(join(runtime, "apps/daemon/package.json"), "utf8"))).toEqual({ name: "@pi-lead-child/daemon", private: true, type: "module" });
    for (const file of REQUIRED_BUILD_FILES) expect(existsSync(join(runtime, file)), file).toBe(true);
    expect(existsSync(join(runtime, "apps/daemon/dist/supervisor.mjs.map"))).toBe(true);
    expect(existsSync(join(runtime, "apps/daemon/dist/build-info.json"))).toBe(false);
    expect(existsSync(join(runtime, "apps/daemon/dist/.web-staging-123"))).toBe(false);

    // node_modules 只有三个 external 和它们的依赖，版本和锁文件一致。
    const packages = listTree(join(runtime, "node_modules")).filter((path) => path.endsWith("package.json"));
    expect(packages.sort()).toEqual([
      "@anthropic-ai/sandbox-runtime/package.json",
      "@earendil-works/pi-coding-agent/package.json",
      "better-sqlite3/package.json",
      "bindings/package.json",
      "chalk/package.json",
    ]);
    expect(result.externals.map((entry) => `${entry.name}@${entry.version}`)).toContain("better-sqlite3@12.11.1");
    expect(readlinkSync(join(runtime, "node_modules/.bin/pi"))).toBe("../@earendil-works/pi-coding-agent/dist/cli.js");

    // release.json：产品名、来自参数的仓库、和磁盘一致的哈希。
    const release = JSON.parse(readFileSync(join(runtime, "release.json"), "utf8")) as ReleaseManifest;
    expect(release).toMatchObject({
      schema: 1, product: "bytezard-lead", version: "1.3.0", arch: "arm64", node: NODE, schemaVersion: 63,
      sourceTree: "a".repeat(40), builtAt: "2026-11-03T08:00:00.000Z", updateSource: { type: "github", repository: "acme/x" },
    });
    expect(release.files).toEqual(await hashFiles(runtime, Object.keys(release.files)));
    expect(Object.keys(release.files)).toEqual(expect.arrayContaining(["bin/lead-agent", "node_modules/better-sqlite3/build/Release/better_sqlite3.node"]));

    // 附件：bytezard-lead-runtime-<版本>-arm64.tar.gz 和 manifest.json。
    expect(readdirSync(out).sort()).toEqual(["bytezard-lead-runtime-1.3.0-arm64.tar.gz", "cache", "manifest.json", "runtime"]);
    const archive = join(out, "bytezard-lead-runtime-1.3.0-arm64.tar.gz");
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as UpdateManifest;
    expect(manifest).toMatchObject({ schema: 1, product: "bytezard-lead", version: "1.3.0", arch: "arm64", schemaVersion: 63 });
    expect(manifest.runtime).toEqual({ file: "bytezard-lead-runtime-1.3.0-arm64.tar.gz", size: statSync(archive).size, sha256: sha(readFileSync(archive)) });

    // tar.gz 解开就是运行包目录：软链接还在，哈希对得上，没有 ._ 文件。
    const unpacked = tempDir("plc-desktop-unpack-");
    execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
    expect(listTree(unpacked).sort()).toEqual(listTree(runtime).sort());
    expect(listTree(unpacked).some((path) => path.split("/").pop()!.startsWith("._"))).toBe(false);
    expect(readlinkSync(join(unpacked, "bin/node"))).toBe("lead-agent");
    expect(readlinkSync(join(unpacked, "bin/Bytezard Lead"))).toBe("lead-agent");
    expect(await hashFiles(unpacked, Object.keys(release.files))).toEqual(release.files);
  });

  it("fails when the Node download does not match SHASUMS256.txt", async () => {
    const out = join(tempDir("plc-desktop-out-"), "out");
    await expect(pack(fakeRepo(), out, fakeNodeDist({ tamper: true }).fetchImpl)).rejects.toThrow(/SHA-256 是 .* 不一致/);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
    expect(existsSync(join(out, "runtime/release.json"))).toBe(false);
  });

  it("fails when better-sqlite3 was built for another architecture", async () => {
    const out = join(tempDir("plc-desktop-out-"), "out");
    await expect(pack(fakeRepo({ sqliteCpu: CPU.x86_64 }), out, fakeNodeDist().fetchImpl))
      .rejects.toThrow(/better-sqlite3 的 \.node 文件 的架构是 x86_64，不是 arm64/);
    expect(existsSync(join(out, "manifest.json"))).toBe(false);
  });

  it("fails before downloading anything when the build is missing", async () => {
    const repo = fakeRepo();
    execFileSync("rm", [join(repo, "apps/daemon/dist/web/index.html")]);
    let fetched = false;
    await expect(pack(repo, join(tempDir("plc-desktop-out-"), "out"), async () => { fetched = true; return new Response(""); }))
      .rejects.toThrow(/缺少构建产物：apps\/daemon\/dist\/web\/index\.html/);
    expect(fetched).toBe(false);
  });
});
