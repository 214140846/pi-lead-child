// App 的一键更新（updater.ts）。网络和系统命令换成假的：fetch 回 manifest 和 dmg 的字节，hdiutil 把一个假的 App
// 放进挂载点，ditto 照原样复制，plutil 从假 App 的 Info.plist（这里写成 JSON）里读值。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import type { ExecFile } from "../src/process.js";
import {
  appBundleOf, createUpdater, dmgFileName, LSREGISTER, parseUpdateManifest, updateBaseUrl, UPDATE_CHECK_INTERVAL_MS, UPDATE_STAGING_PREFIX,
  type ShellUpdateStatus, type UpdaterDeps,
} from "../src/updater.js";
import { sha256 } from "./fixtures.js";

const REPO = "acme/lead";

function writeApp(dir: string, version: string, id = "com.bytezard.plc") {
  mkdirSync(join(dir, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(dir, "Contents", "Info.plist"), JSON.stringify({ CFBundleShortVersionString: version, CFBundleIdentifier: id }));
  writeFileSync(join(dir, "Contents", "MacOS", "Bytezard Lead"), `app ${version}\n`);
}

function manifest(version: string, dmg: string, o: { size?: number; sha?: string } = {}) {
  return {
    schema: 1, product: "bytezard-lead", version, arch: "arm64",
    runtime: { file: `bytezard-lead-runtime-${version}-arm64.tar.gz`, size: 1, sha256: "0".repeat(64) },
    dmg: { file: dmgFileName(version), size: o.size ?? Buffer.byteLength(dmg), sha256: o.sha ?? sha256(dmg) },
  };
}

interface Setup {
  updater: ReturnType<typeof createUpdater>;
  app: string;
  applications: string;
  shellUserData: string;
  statuses: ShellUpdateStatus[];
  urls: string[];
  /** 每次请求的 cache 选项。 */
  caches: Array<string | undefined>;
  commands: string[][];
  relaunches: number;
  clock: { now: Date };
}

function setup(o: {
  current?: string;
  latest?: string | null;
  dmgVersion?: string;
  dmgBody?: string;
  manifestOverrides?: { size?: number; sha?: string };
  manifestStatus?: number;
  failRename?: boolean;
  appBundle?: string | null;
  shellUserData?: string;
  prepareRuntime?: UpdaterDeps["prepareRuntime"];
} = {}): Setup {
  const root = tempDir("plc-desktop-update-");
  const applications = join(root, "Applications");
  const app = join(applications, "Bytezard Lead.app");
  const current = o.current ?? "1.0.0";
  writeApp(app, current);
  const runtime = join(root, "data", "runtime", "current");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "release.json"), JSON.stringify({ version: current, updateSource: { type: "github", repository: REPO } }));
  const shellUserData = o.shellUserData ?? join(root, "data", "shell");
  const latest = o.latest === undefined ? "1.1.0" : o.latest;
  const dmgBody = o.dmgBody ?? "dmg bytes";
  const dmgSource = join(root, "dmg-contents");
  writeApp(join(dmgSource, "Bytezard Lead.app"), o.dmgVersion ?? latest ?? current);
  const result: Setup = {
    updater: null as never, app, applications, shellUserData, statuses: [], urls: [], caches: [], commands: [], relaunches: 0,
    clock: { now: new Date("2026-11-05T01:00:00.000Z") },
  };
  const fetch: UpdaterDeps["fetch"] = async (url, init) => {
    result.urls.push(url);
    result.caches.push(init?.cache);
    if (url.endsWith("/manifest.json")) {
      if (latest === null) return new Response("Not Found", { status: 404 });
      if (o.manifestStatus) return new Response("", { status: o.manifestStatus });
      return Response.json(manifest(latest, dmgBody, o.manifestOverrides));
    }
    return new Response(dmgBody);
  };
  const execFile: ExecFile = async (file, args) => {
    result.commands.push([file, ...args]);
    if (file.endsWith("hdiutil") && args[0] === "attach") cpSync(dmgSource, args[args.indexOf("-mountpoint") + 1]!, { recursive: true });
    if (file.endsWith("ditto")) cpSync(args[0]!, args[1]!, { recursive: true });
    if (file.endsWith("plutil")) {
      const plist = JSON.parse(readFileSync(args.at(-1)!, "utf8")) as Record<string, string>;
      return { stdout: `${plist[args[1]!]}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
  result.updater = createUpdater({
    paths: { current: runtime, shellUserData },
    env: {},
    currentVersion: current,
    appBundle: o.appBundle === undefined ? app : o.appBundle,
    fetch,
    execFile,
    relaunch: () => { result.relaunches += 1; },
    onStatus: (status) => result.statuses.push(status),
    now: () => result.clock.now,
    rename: async (from, to) => {
      if (o.failRename && from.endsWith("new.app")) throw new Error("EPERM");
      await rename(from, to);
    },
    ...(o.prepareRuntime ? { prepareRuntime: o.prepareRuntime } : {}),
  });
  return result;
}

function appVersion(app: string): string {
  return (JSON.parse(readFileSync(join(app, "Contents", "Info.plist"), "utf8")) as { CFBundleShortVersionString: string }).CFBundleShortVersionString;
}

describe("update source and manifest", () => {
  it("reads the repository from the installed runtime and lets a local or https override replace it", () => {
    const current = tempDir("plc-desktop-update-source-");
    expect(updateBaseUrl(current, {})).toBeNull();
    writeFileSync(join(current, "release.json"), JSON.stringify({ updateSource: { type: "github", repository: REPO } }));
    expect(updateBaseUrl(current, {})).toBe(`https://github.com/${REPO}/releases/latest/download`);
    expect(updateBaseUrl(current, { BYTEZARD_UPDATE_URL: "http://127.0.0.1:8765/updates/" })).toBe("http://127.0.0.1:8765/updates");
    expect(updateBaseUrl(current, { BYTEZARD_UPDATE_URL: "https://downloads.example.com/lead" })).toBe("https://downloads.example.com/lead");
    expect(updateBaseUrl(current, { BYTEZARD_UPDATE_URL: "http://downloads.example.com/lead" })).toBeNull();
    writeFileSync(join(current, "release.json"), JSON.stringify({ updateSource: { type: "github", repository: "acme/lead/../x" } }));
    expect(updateBaseUrl(current, {})).toBeNull();
  });

  it("accepts a manifest only with this product, arch, a semver version and the dmg of that version", () => {
    const good = manifest("1.2.0", "x");
    expect(parseUpdateManifest(good)).toEqual({ version: "1.2.0", dmg: good.dmg });
    expect(parseUpdateManifest({ ...good, product: "other" })).toBeNull();
    expect(parseUpdateManifest({ ...good, arch: "x64" })).toBeNull();
    expect(parseUpdateManifest({ ...good, version: "1.2" })).toBeNull();
    expect(parseUpdateManifest({ ...good, dmg: undefined })).toBeNull();
    expect(parseUpdateManifest({ ...good, dmg: { ...good.dmg, file: "../evil.dmg" } })).toBeNull();
    expect(parseUpdateManifest({ ...good, dmg: { ...good.dmg, sha256: "abc" } })).toBeNull();
    expect(parseUpdateManifest({ ...good, dmg: { ...good.dmg, size: -1 } })).toBeNull();
  });

  it("finds the .app of the running program", () => {
    expect(appBundleOf("/Applications/Bytezard Lead.app/Contents/MacOS/Bytezard Lead")).toBe("/Applications/Bytezard Lead.app");
    expect(appBundleOf("/usr/local/bin/electron")).toBeNull();
  });
});

describe("checking for updates", () => {
  it("offers a newer version, and nothing when the latest release is not newer or has no manifest", async () => {
    const newer = setup({ latest: "1.1.0" });
    await newer.updater.check();
    expect(newer.urls).toEqual([`https://github.com/${REPO}/releases/latest/download/manifest.json`]);
    expect(newer.updater.status()).toEqual({ state: "available", version: "1.1.0", size: Buffer.byteLength("dmg bytes") });
    expect(newer.statuses.at(-1)).toEqual(newer.updater.status());

    const same = setup({ latest: "1.0.0" });
    await same.updater.check();
    expect(same.updater.status()).toEqual({ state: "none" });

    const missing = setup({ latest: null });
    await missing.updater.check();
    expect(missing.updater.status()).toEqual({ state: "none" });
  });

  // 2026-11-05 在真的 App 里发现：Electron 的 net.fetch 走 Chromium 的 HTTP 缓存，发了新版以后还拿到旧的 manifest。
  it("asks for the manifest and the dmg past the HTTP cache", async () => {
    const run = setup();
    await run.updater.check();
    await run.updater.apply();
    expect(run.urls).toHaveLength(2);
    expect(run.caches).toEqual(["no-store", "no-store"]);
  });

  it("checks at most once a day, and retries in the next hour after a failed check", async () => {
    const run = setup({ manifestStatus: 502 });
    await run.updater.checkIfDue();
    await run.updater.checkIfDue();
    expect(run.urls).toHaveLength(2);

    const ok = setup();
    await ok.updater.checkIfDue();
    ok.clock.now = new Date(ok.clock.now.getTime() + UPDATE_CHECK_INTERVAL_MS - 1);
    await ok.updater.checkIfDue();
    expect(ok.urls).toHaveLength(1);
    ok.clock.now = new Date(ok.clock.now.getTime() + 1);
    await ok.updater.checkIfDue();
    expect(ok.urls).toHaveLength(2);
  });

  it("tells the menu what it found: a newer version, the latest one, a failure, or no update source", async () => {
    expect(await setup({ latest: "1.1.0" }).updater.check()).toEqual({ kind: "available", version: "1.1.0" });
    expect(await setup({ latest: "1.0.0" }).updater.check()).toEqual({ kind: "current" });
    expect(await setup({ latest: null }).updater.check()).toEqual({ kind: "current" });
    expect(await setup({ manifestStatus: 502 }).updater.check()).toEqual({ kind: "failed", reason: "HTTP 502" });
    const noSource = setup();
    writeFileSync(join(noSource.shellUserData, "..", "runtime", "current", "release.json"), JSON.stringify({ version: "1.0.0" }));
    expect(await noSource.updater.check()).toEqual({ kind: "no_source" });
  });

  it("offers a dismissed version again when the user checks from the menu", async () => {
    const run = setup();
    await run.updater.check();
    run.updater.dismiss();
    expect(run.updater.status()).toEqual({ state: "none" });
    await run.updater.check({ manual: true });
    expect(run.updater.status()).toMatchObject({ state: "available", version: "1.1.0" });
  });

  it("hides a dismissed version for a day, then offers it again", async () => {
    const run = setup();
    await run.updater.check();
    run.updater.dismiss();
    expect(run.updater.status()).toEqual({ state: "none" });
    run.clock.now = new Date(run.clock.now.getTime() + UPDATE_CHECK_INTERVAL_MS);
    expect(run.updater.status()).toMatchObject({ state: "available", version: "1.1.0" });
  });
});

describe("applying an update", () => {
  it("downloads and checks the dmg, replaces the App and relaunches", async () => {
    const run = setup();
    await run.updater.check();
    await run.updater.apply();
    expect(run.relaunches).toBe(1);
    expect(appVersion(run.app)).toBe("1.1.0");
    expect(run.urls.at(-1)).toBe(`https://github.com/${REPO}/releases/latest/download/${dmgFileName("1.1.0")}`);
    expect([...new Set(run.statuses.map((status) => status.state))]).toEqual(["available", "downloading", "installing"]);
    const files = run.commands.map((command) => command[0]);
    expect(files).toEqual([
      "/usr/bin/hdiutil", "/usr/bin/ditto", "/usr/bin/hdiutil", "/usr/bin/plutil", "/usr/bin/plutil", "/usr/bin/plutil", "/usr/bin/codesign", "/usr/bin/xattr",
      LSREGISTER,
    ]);
    // 旧 App 留在隐藏的暂存目录里，新 App 打开时 cleanup 删掉它和下载目录。
    const staging = readdirSync(run.applications).filter((name) => name.startsWith(UPDATE_STAGING_PREFIX));
    expect(staging).toHaveLength(1);
    expect(appVersion(join(run.applications, staging[0]!, "old.app"))).toBe("1.0.0");
    await run.updater.cleanup();
    expect(readdirSync(run.applications)).toEqual(["Bytezard Lead.app"]);
    expect(existsSync(join(run.shellUserData, "updates"))).toBe(false);
  });

  // 设计第 7.5.6 节：换掉 App 以前先解好新版本的运行包，新 App 打开时只要换 current。
  it("prepares the runtime of the new App before it replaces the App, and still updates when that fails", async () => {
    const prepared: Array<{ staged: string; appVersionThen: string; stagedVersion: string }> = [];
    const run = setup({
      prepareRuntime: async (staged) => {
        prepared.push({ staged, appVersionThen: appVersion(run.app), stagedVersion: appVersion(staged) });
        return "{\"version\":\"unpacked\"}";
      },
    });
    await run.updater.check();
    await run.updater.apply();
    expect(prepared).toEqual([{ staged: expect.stringMatching(/new\.app$/), appVersionThen: "1.0.0", stagedVersion: "1.1.0" }]);
    expect(run.relaunches).toBe(1);
    expect(readFileSync(join(run.shellUserData, "update.log"), "utf8")).toMatch(/prepared the runtime of 1\.1\.0 in \d+ ms: \{"version":"unpacked"\}/);

    const failing = setup({ prepareRuntime: async () => { throw new Error("no space left on the disk"); } });
    await failing.updater.check();
    await failing.updater.apply();
    expect(failing.relaunches).toBe(1);
    expect(appVersion(failing.app)).toBe("1.1.0");
    expect(readFileSync(join(failing.shellUserData, "update.log"), "utf8")).toContain("the new App unpacks it itself: no space left on the disk");
  });

  // 2026-11-05：换了 App 图标以后，通知还是 Electron 的图标。macOS 按 bundle id 找图标，LaunchServices 里记着 17 份同一个
  // bundle id 的 App，其中有更新时挪进暂存目录的旧 App（目录早就删了，登记还在），换上的 App 的修改时间又是打包时的。
  it("registers the new App again after the swap, with a fresh modification time", async () => {
    const run = setup();
    await run.updater.check();
    await run.updater.apply();
    expect(run.commands.at(-1)).toEqual([LSREGISTER, "-f", run.app]);
    expect(statSync(run.app).mtimeMs).toBe(run.clock.now.getTime());
  });

  it("removes the registration of the old App before it deletes the staging folder", async () => {
    const run = setup();
    await run.updater.check();
    await run.updater.apply();
    const staging = readdirSync(run.applications).find((name) => name.startsWith(UPDATE_STAGING_PREFIX))!;
    run.commands.length = 0;
    await run.updater.cleanup();
    expect(run.commands).toEqual([[LSREGISTER, "-u", join(run.applications, staging, "old.app")]]);
    expect(readdirSync(run.applications)).toEqual(["Bytezard Lead.app"]);
  });

  it("keeps the old App when the download does not match the manifest", async () => {
    const run = setup({ manifestOverrides: { sha: "f".repeat(64) } });
    await run.updater.check();
    await run.updater.apply();
    expect(run.relaunches).toBe(0);
    expect(appVersion(run.app)).toBe("1.0.0");
    expect(run.updater.status()).toMatchObject({ state: "failed", version: "1.1.0", code: "checksum_mismatch" });
    expect(run.commands).toEqual([]);
  });

  it("keeps the old App when the App in the dmg is not the advertised version", async () => {
    const run = setup({ dmgVersion: "1.0.5" });
    await run.updater.check();
    await run.updater.apply();
    expect(run.relaunches).toBe(0);
    expect(appVersion(run.app)).toBe("1.0.0");
    expect(run.updater.status()).toMatchObject({ state: "failed", code: "app_invalid" });
    const staging = readdirSync(run.applications).filter((name) => name.startsWith(UPDATE_STAGING_PREFIX));
    expect(readdirSync(join(run.applications, staging[0]!))).toEqual([]);
  });

  it("puts the old App back when the new one cannot take its place", async () => {
    const run = setup({ failRename: true });
    await run.updater.check();
    await run.updater.apply();
    expect(run.relaunches).toBe(0);
    expect(appVersion(run.app)).toBe("1.0.0");
    expect(run.updater.status()).toMatchObject({ state: "failed", code: "replace_failed" });
  });

  it("lets the user put a failed update away until tomorrow", async () => {
    const run = setup({ manifestOverrides: { sha: "f".repeat(64) } });
    await run.updater.check();
    await run.updater.apply();
    expect(run.updater.status()).toMatchObject({ state: "failed" });
    run.updater.dismiss();
    expect(run.updater.status()).toEqual({ state: "none" });
  });

  it("does not update a copy that is not an installed App", async () => {
    const run = setup({ appBundle: null });
    await run.updater.check();
    await run.updater.apply();
    expect(run.relaunches).toBe(0);
    expect(run.updater.status()).toMatchObject({ state: "failed", code: "not_writable" });
  });

  it("forgets the offer once this App is that version", async () => {
    const before = setup({ latest: "1.1.0" });
    await before.updater.check();
    const readAvailable = () => (JSON.parse(readFileSync(join(before.shellUserData, "update-state.json"), "utf8")) as { available: unknown }).available;
    expect(readAvailable()).toMatchObject({ version: "1.1.0" });
    const after = setup({ current: "1.1.0", shellUserData: before.shellUserData });
    expect(after.updater.status()).toEqual({ state: "none" });
    await after.updater.cleanup();
    expect(readAvailable()).toBeNull();
  });
});
