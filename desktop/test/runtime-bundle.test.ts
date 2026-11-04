// 解出 App 带的运行包（设计第 4.2 节第 2 步）：先到 .partial，校验通过才 rename；中途退出不留半个版本；
// 去 quarantine 用 execFile("xattr", ["-dr", "com.apple.quarantine", dir])；current 原子地切换。
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { shellPaths } from "../src/paths.js";
import { execFile as realExecFile, type ExecFile } from "../src/process.js";
import {
  compareVersions, findBundledRuntime, installedVersion, needsUnpack, unpackRuntime, UnpackError,
} from "../src/runtime-bundle.js";
import { runtimeTarball } from "./fixtures.js";

// 路径里有空格，和真的数据目录一样（~/Library/Application Support/Bytezard Lead）。
function setup() {
  const home = tempDir("plc-desktop-unpack-");
  const paths = shellPaths({ PLC_DATA_DIR: join(home, "Application Support", "Bytezard Lead") });
  const resources = join(home, "Bytezard Lead.app", "Contents", "Resources", "runtime");
  return { paths, resources };
}

// tar 真的跑；xattr 只记下参数（测试机上的文件没有 quarantine，也不该改测试以外的东西）。
function recordingExec(o: { failXattr?: boolean } = {}) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const execFile: ExecFile = async (file, args, options) => {
    calls.push({ file, args });
    if (file === "xattr") {
      if (o.failXattr) throw new Error("xattr failed");
      return { stdout: "", stderr: "" };
    }
    return realExecFile(file, args, options);
  };
  return { calls, execFile };
}

describe("compareVersions", () => {
  it("orders releases and pre-releases like semver", () => {
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.3.0-rc.1", "1.3.0")).toBe(-1);
    expect(compareVersions("1.3.0-rc.2", "1.3.0-rc.10")).toBe(-1);
    expect(compareVersions("1.3.0-alpha", "1.3.0-beta")).toBe(-1);
    expect(compareVersions("1.3.0-rc.1", "1.3.0-rc")).toBe(1);
  });
});

describe("findBundledRuntime", () => {
  it("picks the newest runtime archive and ignores other files", () => {
    const { resources } = setup();
    runtimeTarball(resources, "1.2.0");
    runtimeTarball(resources, "1.3.0");
    writeFileSync(join(resources, "notes.txt"), "x");
    writeFileSync(join(resources, "bytezard-lead-runtime-latest-arm64.tar.gz"), "x");
    expect(findBundledRuntime(resources)).toEqual({ version: "1.3.0", tarball: join(resources, "bytezard-lead-runtime-1.3.0-arm64.tar.gz") });
  });

  it("is null without a runtime folder", () => {
    expect(findBundledRuntime(join(tempDir("plc-desktop-none-"), "missing"))).toBeNull();
  });
});

describe("needsUnpack", () => {
  it("unpacks only when nothing is installed or the bundled runtime is newer", () => {
    const bundled = { version: "1.3.0", tarball: "/x" };
    expect(needsUnpack(bundled, null)).toBe(true);
    expect(needsUnpack(bundled, "1.2.0")).toBe(true);
    expect(needsUnpack(bundled, "1.3.0")).toBe(false);
    expect(needsUnpack(bundled, "1.4.0")).toBe(false);
    expect(needsUnpack(null, null)).toBe(false);
  });
});

describe("unpackRuntime", () => {
  it("unpacks through a .partial folder, removes quarantine without a shell, and points current at the new version", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.3.0");
    const exec = recordingExec();
    await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: exec.execFile });

    const target = join(paths.versionsDir, "1.3.0");
    expect(existsSync(join(target, "bin", "lead-agent"))).toBe(true);
    expect(existsSync(`${target}.partial`)).toBe(false);
    expect(lstatSync(paths.current).isSymbolicLink()).toBe(true);
    expect(readlinkSync(paths.current)).toBe(join("versions", "1.3.0"));
    expect(installedVersion(paths)).toBe("1.3.0");
    expect(exec.calls).toContainEqual({ file: "xattr", args: ["-dr", "com.apple.quarantine", `${target}.partial`] });
    // tar 也只收参数数组：带空格的路径原样是一个参数。
    expect(exec.calls[0]).toEqual({ file: "/usr/bin/tar", args: ["-xzf", join(resources, "bytezard-lead-runtime-1.3.0-arm64.tar.gz"), "-C", `${target}.partial`] });
    // 安装根里只有 versions 和 current，没有留下临时的软链接。
    expect(readdirSync(paths.installRoot).sort()).toEqual(["current", "versions"]);
  });

  it("refuses a runtime whose files do not match release.json and leaves no half version", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.2.0");
    await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: recordingExec().execFile });
    const corrupt = join(tempDir("plc-desktop-corrupt-"), "runtime");
    runtimeTarball(corrupt, "1.3.0", { corrupt: true });

    const error = await unpackRuntime({ bundled: findBundledRuntime(corrupt)!, paths, execFile: recordingExec().execFile }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnpackError);
    expect((error as UnpackError).code).toBe("runtime_invalid");
    expect((error as UnpackError).message).toContain("bin/lead-agent (hash does not match)");
    expect(readdirSync(paths.versionsDir)).toEqual(["1.2.0"]);
    expect(installedVersion(paths)).toBe("1.2.0");
  });

  it("refuses a runtime for another architecture", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.3.0", { arch: "x64" });
    const error = await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: recordingExec().execFile }).catch((e: unknown) => e);
    expect((error as UnpackError).code).toBe("runtime_invalid");
    expect(existsSync(paths.versionsDir) ? readdirSync(paths.versionsDir) : []).toEqual([]);
  });

  it("starts again from the archive when an earlier start quit in the middle", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.3.0");
    // 上一次在解包中途退出：留下了半个 .partial。
    const partial = join(paths.versionsDir, "1.3.0.partial");
    mkdirSync(join(partial, "bin"), { recursive: true });
    writeFileSync(join(partial, "half-written"), "x");

    await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: recordingExec().execFile });
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(join(paths.versionsDir, "1.3.0", "half-written"))).toBe(false);
    expect(installedVersion(paths)).toBe("1.3.0");
  });

  it("removes the .partial folder when a step after the unpack fails", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.3.0");
    const error = await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: recordingExec({ failXattr: true }).execFile }).catch((e: unknown) => e);
    expect((error as UnpackError).code).toBe("unpack_failed");
    expect(readdirSync(paths.versionsDir)).toEqual([]);
    expect(installedVersion(paths)).toBeNull();
  });

  it("switches current from the old version to the new one and keeps the old version", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.2.0");
    await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: recordingExec().execFile });
    const newer = join(tempDir("plc-desktop-newer-"), "runtime");
    runtimeTarball(newer, "1.3.0");
    await unpackRuntime({ bundled: findBundledRuntime(newer)!, paths, execFile: recordingExec().execFile });
    expect(readdirSync(paths.versionsDir).sort()).toEqual(["1.2.0", "1.3.0"]);
    expect(installedVersion(paths)).toBe("1.3.0");
  });

  it("re-uses an unpacked version that is whole instead of unpacking it again", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.3.0");
    await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: recordingExec().execFile });
    const again = recordingExec();
    await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: again.execFile });
    expect(again.calls).toEqual([]);
    expect(installedVersion(paths)).toBe("1.3.0");
  });
});
