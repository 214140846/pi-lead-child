// 安装流程（设计第 4.2、4.3 节）：再次打开时直接打开网关；首次安装时解包、运行 desktop-install、按它的 JSON 进度更新；
// 失败时说清楚；壳自己的步骤失败时写进 install-state.json。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { collectDiagnostics, desktopInstallArgs, plistUsesRuntime, runInstall, type InstallProgress } from "../src/install.js";
import { shellPaths } from "../src/paths.js";
import { execFile as realExecFile, type ExecFile, type SpawnLines } from "../src/process.js";
import { findBundledRuntime, unpackRuntime } from "../src/runtime-bundle.js";
import { runtimeTarball } from "./fixtures.js";

function setup() {
  const home = tempDir("plc-desktop-install-");
  const paths = shellPaths({ PLC_DATA_DIR: join(home, "Application Support", "Bytezard Lead") });
  const resources = join(home, "Resources", "runtime");
  return { paths, resources };
}

function exec() {
  const calls: Array<{ file: string; args: string[] }> = [];
  const execFile: ExecFile = async (file, args, options) => {
    calls.push({ file, args });
    if (file === "/usr/bin/tar") return realExecFile(file, args, options);
    return { stdout: "", stderr: "" };
  };
  return { calls, execFile };
}

/** 假的 desktop-install：按顺序吐出这些行，再以 exitCode 退出。 */
function fakeOps(lines: unknown[], o: { exitCode?: number; stderr?: string } = {}) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const spawnLines: SpawnLines = (file, args, onLine, onStderr) => {
    calls.push({ file, args });
    return {
      exitCode: (async () => {
        for (const line of lines) onLine(typeof line === "string" ? line : JSON.stringify(line));
        if (o.stderr) onStderr(o.stderr);
        return o.exitCode ?? 0;
      })(),
    };
  };
  return { calls, spawnLines };
}

const HAPPY = [
  { step: "preflight", state: "running", message: "Checking the program files." },
  "not json: a stray line from a child process",
  { step: "preflight", state: "done", message: "The program files are complete." },
  { step: "launchd", state: "running", message: "Setting up the background service." },
  { step: "launchd", state: "done", message: "The background service is set up." },
  { step: "supervisor", state: "running", message: "Starting the background service." },
  { step: "daemon", state: "done", message: "Bytezard Lead is ready." },
  { step: "done", state: "done", message: "Bytezard Lead is installed.", gatewayUrl: "http://127.0.0.1:47130" },
];

async function installed(paths: ReturnType<typeof setup>["paths"], resources: string, version: string) {
  runtimeTarball(resources, version);
  await unpackRuntime({ bundled: findBundledRuntime(resources)!, paths, execFile: exec().execFile });
}

describe("runInstall", () => {
  it("opens the gateway at once when the service already runs and the bundled runtime is not newer", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const ops = fakeOps([]);
    const e = exec();
    const progress = await runInstall(
      {
        paths, bundled: findBundledRuntime(resources), locale: "en", execFile: e.execFile, spawnLines: ops.spawnLines,
        daemonStatus: async () => ({ gatewayUrl: "http://127.0.0.1:47131" }), serviceUsesThisRuntime: () => true,
      },
      () => {},
    );
    expect(progress.stage).toBe("ready");
    expect(progress.gatewayUrl).toBe("http://127.0.0.1:47131");
    expect(ops.calls).toEqual([]);
    // 每次打开 App 时重新读一次登录 shell 的 PATH（设计第 5.1 节），在后台，不挡窗口。
    expect(e.calls).toContainEqual({ file: join(paths.current, "bin", "lead-agent"), args: [join(paths.current, "apps", "daemon", "dist", "ops.mjs"), "login-shell-path"] });
  });

  // 设计第 12.7 节：服务在跑，但 plist 指向开发 checkout（或者接管回滚了）时不直接打开，走 desktop-install 去接管。
  it("runs desktop-install when the running service is not this App's, and shows the takeover row while it takes over", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const ops = fakeOps([
      { step: "detect", state: "done", message: "Found a developer installation." },
      { step: "takeover", state: "running", phase: "drain", message: "Waiting until Bytezard Lead finishes its current work." },
      { step: "takeover", state: "done", message: "Bytezard Lead took over your data and settings." },
      { step: "launchd", state: "done", code: "launchd_unchanged", message: "The background service is already set up." },
      { step: "daemon", state: "done", message: "Bytezard Lead is ready." },
      { step: "done", state: "done", message: "Bytezard Lead is installed.", gatewayUrl: "http://127.0.0.1:47130" },
    ]);
    const asked: number[] = [];
    const seen: InstallProgress[] = [];
    const progress = await runInstall(
      {
        paths, bundled: findBundledRuntime(resources), locale: "en", execFile: exec().execFile, spawnLines: ops.spawnLines,
        daemonStatus: async (timeoutMs) => { asked.push(timeoutMs); return { gatewayUrl: "http://127.0.0.1:47130" }; },
        serviceUsesThisRuntime: () => false,
      },
      (next) => seen.push(next),
    );
    expect(asked).toEqual([]);
    expect(ops.calls).toHaveLength(1);
    const draining = seen.find((p) => p.steps.takeover === "running");
    expect(draining).toMatchObject({ detail: "Waiting until Bytezard Lead finishes its current work.", steps: { service: "pending" } });
    expect(progress).toMatchObject({ stage: "ready", steps: { takeover: "done", service: "done", start: "done" } });
  });

  // #261：接管失败、回滚以后，新的 supervisor plist 没了，旧名字的服务照常在跑。下次打开 App 时不等用户点「重试」，
  // 再次打开的检查看到 plist 不指向这份 App，就再跑一遍 desktop-install，它会重新接管。
  it("takes over again on the next start after a takeover rolled back, without a click", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    writeFileSync(paths.installStateFile, `${JSON.stringify({
      version: 1, outcome: "failed", steps: {},
      lastError: { step: "takeover", code: "takeover_rolled_back", message: "Bytezard Lead put everything back as it was." },
    })}\n`);
    // 回滚删掉了新的 supervisor plist。
    const rolledBack = { ...paths, supervisorPlist: join(tempDir("plc-desktop-agents-"), "com.bytezard.plc.supervisor.plist") };
    const ops = fakeOps([
      { step: "detect", state: "done", message: "Found an installation with the old name.", takeover: "pre_rename" },
      { step: "takeover", state: "running", phase: "stop_old", message: "Stopping the old service." },
      { step: "takeover", state: "done", message: "Bytezard Lead took over your data and settings." },
      { step: "done", state: "done", message: "Bytezard Lead is installed.", gatewayUrl: "http://127.0.0.1:47130" },
    ]);
    const progress = await runInstall(
      {
        paths, bundled: findBundledRuntime(resources), locale: "en", execFile: exec().execFile, spawnLines: ops.spawnLines,
        daemonStatus: async () => null, serviceUsesThisRuntime: () => plistUsesRuntime(rolledBack),
      },
      () => {},
    );
    expect(ops.calls).toEqual([desktopInstallArgs(paths, "en")]);
    expect(progress).toMatchObject({ stage: "ready", takeoverKind: "takeover", steps: { unpack: "done", takeover: "done" } });
  });

  it("remembers from the detect step whether the row is a takeover or an upgrade", async () => {
    const run = async (takeover: string) => {
      const { paths, resources } = setup();
      await installed(paths, resources, "1.3.0");
      const ops = fakeOps([
        { step: "detect", state: "done", message: "Next, Bytezard Lead changes from version 1.2.0 to 1.3.0.", takeover, update: "service" },
        { step: "takeover", state: "running", phase: "backup", message: "Making a backup of the database." },
        { step: "takeover", state: "done", message: "Bytezard Lead now runs version 1.3.0." },
        { step: "done", state: "done", message: "Bytezard Lead is installed.", gatewayUrl: "http://127.0.0.1:47130" },
      ]);
      return runInstall(
        {
          paths, bundled: findBundledRuntime(resources), locale: "en", execFile: exec().execFile, spawnLines: ops.spawnLines,
          daemonStatus: async () => null, serviceUsesThisRuntime: () => false,
        },
        () => {},
      );
    };
    expect(await run("upgrade")).toMatchObject({ stage: "ready", takeoverKind: "upgrade" });
    expect(await run("dev")).toMatchObject({ stage: "ready", takeoverKind: "takeover" });
  });

  it("puts a failed takeover on its own row with the plain reason", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const ops = fakeOps([
      { step: "takeover", state: "running", phase: "health", message: "Checking that the service runs." },
      { step: "takeover", state: "failed", code: "takeover_rolled_back", message: "Bytezard Lead put everything back as it was. Try again." },
    ], { exitCode: 1 });
    const progress = await runInstall(
      { paths, bundled: null, locale: "en", execFile: exec().execFile, spawnLines: ops.spawnLines, daemonStatus: async () => null, serviceUsesThisRuntime: () => false },
      () => {},
    );
    expect(progress).toMatchObject({
      stage: "failed",
      steps: { takeover: "failed" },
      error: { code: "takeover_rolled_back", message: "Bytezard Lead put everything back as it was. Try again." },
    });
  });

  it("reads from the plist whether the service runs this App's runtime", () => {
    const { paths } = setup();
    const at = { ...paths, supervisorPlist: join(tempDir("plc-desktop-agents-"), "com.bytezard.plc.supervisor.plist") };
    expect(plistUsesRuntime(at)).toBe(false);
    writeFileSync(at.supervisorPlist, `<plist><dict><key>WorkingDirectory</key><string>${paths.current.replace(/&/g, "&amp;")}</string></dict></plist>`);
    expect(plistUsesRuntime(at)).toBe(true);
    writeFileSync(at.supervisorPlist, "<plist><dict><key>WorkingDirectory</key><string>/Users/alice/src/plc</string></dict></plist>");
    expect(plistUsesRuntime(at)).toBe(false);
  });

  it("on the first start unpacks, runs desktop-install with an argument array, and follows its JSON progress", async () => {
    const { paths, resources } = setup();
    runtimeTarball(resources, "1.3.0");
    const ops = fakeOps(HAPPY);
    const seen: InstallProgress[] = [];
    const progress = await runInstall(
      { paths, bundled: findBundledRuntime(resources), locale: "zh", execFile: exec().execFile, spawnLines: ops.spawnLines, daemonStatus: async () => null },
      (next) => seen.push(next),
    );

    expect(ops.calls).toEqual([{
      file: join(paths.current, "bin", "lead-agent"),
      args: [join(paths.current, "apps", "daemon", "dist", "ops.mjs"), "desktop-install", "--root", paths.current, "--locale", "zh", "--progress-json"],
    }]);
    expect(progress).toMatchObject({ stage: "ready", gatewayUrl: "http://127.0.0.1:47130", steps: { unpack: "done", service: "done", start: "done" } });
    expect(seen[0]!.steps.unpack).toBe("running");
    const setup_ = seen.find((p) => p.steps.service === "running" && p.detail === "Setting up the background service.");
    expect(setup_?.backgroundNotice).toBe(true);
    const starting = seen.find((p) => p.steps.start === "running");
    expect(starting).toMatchObject({ backgroundNotice: false, steps: { service: "done" } });
  });

  it("shows the failure that desktop-install reports", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const ops = fakeOps([
      { step: "launchd", state: "running", message: "Setting up the background service." },
      { step: "launchd", state: "failed", code: "launchd_bootstrap_failed", message: "The background service could not start. Open System Settings." },
    ], { exitCode: 1 });
    const progress = await runInstall(
      { paths, bundled: findBundledRuntime(resources), locale: "en", execFile: exec().execFile, spawnLines: ops.spawnLines, daemonStatus: async () => null },
      () => {},
    );
    expect(progress).toMatchObject({
      stage: "failed",
      steps: { unpack: "done", service: "failed", start: "pending" },
      error: { code: "launchd_bootstrap_failed", message: "The background service could not start. Open System Settings." },
      backgroundNotice: false,
    });
  });

  it("opens a developer install that runs, and says so when it does not run", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const dev = { step: "detect", state: "done", code: "dev_install_detected", message: "A developer copy already runs." };
    const running = await runInstall(
      { paths, bundled: null, locale: "en", execFile: exec().execFile, daemonStatus: async () => null,
        spawnLines: fakeOps([dev, { ...dev, step: "done", gatewayUrl: "http://127.0.0.1:47140" }]).spawnLines },
      () => {},
    );
    expect(running).toMatchObject({ stage: "ready", gatewayUrl: "http://127.0.0.1:47140" });
    const stopped = await runInstall(
      { paths, bundled: null, locale: "en", execFile: exec().execFile, daemonStatus: async () => null,
        spawnLines: fakeOps([dev, { ...dev, step: "done" }]).spawnLines },
      () => {},
    );
    expect(stopped).toMatchObject({ stage: "failed", error: { code: "dev_not_running" } });
  });

  it("fails with the end of stderr when desktop-install stops without a failed step", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const progress = await runInstall(
      { paths, bundled: null, locale: "en", execFile: exec().execFile, daemonStatus: async () => null,
        spawnLines: fakeOps([], { exitCode: 1, stderr: "Error: Cannot find module better-sqlite3\n" }).spawnLines },
      () => {},
    );
    expect(progress.stage).toBe("failed");
    expect(progress.error?.message).toBe("The installation stopped: Error: Cannot find module better-sqlite3");
  });

  it("does not open a gateway address that is not on this Mac", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const progress = await runInstall(
      { paths, bundled: null, locale: "en", execFile: exec().execFile, daemonStatus: async () => null,
        spawnLines: fakeOps([{ step: "done", state: "done", message: "ok", gatewayUrl: "http://evil.example.com:47130" }]).spawnLines },
      () => {},
    );
    expect(progress.stage).toBe("failed");
    expect(progress.gatewayUrl).toBeNull();
  });

  it("records its own failures in install-state.json", async () => {
    const { paths } = setup();
    const progress = await runInstall(
      { paths, bundled: null, locale: "en", execFile: exec().execFile, daemonStatus: async () => null, spawnLines: fakeOps([]).spawnLines, now: () => new Date("2026-11-03T08:00:00Z") },
      () => {},
    );
    expect(progress).toMatchObject({ stage: "failed", steps: { unpack: "failed" }, error: { code: "runtime_missing" } });
    const state = JSON.parse(readFileSync(paths.installStateFile, "utf8"));
    expect(state).toMatchObject({ outcome: "failed", lastError: { step: "unpack", code: "runtime_missing", at: "2026-11-03T08:00:00.000Z" } });
  });

  it("unpacks the same version again when asked to after desktop-install found the runtime damaged", async () => {
    const { paths, resources } = setup();
    await installed(paths, resources, "1.3.0");
    const e = exec();
    // 运行包被改坏了：同一个版本的 versions/1.3.0 校验不过，要从 App 带的包重新解。
    writeFileSync(join(paths.current, "bin", "lead-agent"), "damaged");
    const progress = await runInstall(
      { paths, bundled: findBundledRuntime(resources), locale: "en", execFile: e.execFile, daemonStatus: async () => null, spawnLines: fakeOps(HAPPY).spawnLines },
      () => {},
      { forceUnpack: true },
    );
    expect(progress.stage).toBe("ready");
    expect(e.calls.some((call) => call.file === "/usr/bin/tar")).toBe(true);
    expect(readFileSync(join(paths.current, "bin", "lead-agent"), "utf8")).toContain("lead-agent 1.3.0");
  });
});

describe("desktopInstallArgs", () => {
  it("passes the current link, not the version folder, as --root", () => {
    const { paths } = setup();
    expect(desktopInstallArgs(paths, "en").args).toContain(paths.current);
    expect(paths.current.endsWith("/runtime/current")).toBe(true);
  });
});

describe("collectDiagnostics", () => {
  it("copies the doctor output even when a check fails, and adds install-state.json", async () => {
    const { paths } = setup();
    const execFile: ExecFile = async () => {
      throw Object.assign(new Error("exit 1"), { stdout: "✗ daemon: not running\n", stderr: "" });
    };
    const text = await collectDiagnostics(paths, (path) => (path === paths.installStateFile ? "{\"outcome\":\"failed\"}" : null), execFile);
    expect(text).toContain("✗ daemon: not running");
    expect(text).toContain("{\"outcome\":\"failed\"}");
  });
});
