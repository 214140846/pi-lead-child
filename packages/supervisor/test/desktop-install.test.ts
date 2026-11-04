// 桌面版的一条命令安装（docs/desktop/macos-desktop-design.md 第 4.2 节、第 10 节 P0-3）。
// launchctl 和两个 socket 换成假的：测试不碰这台机器上真的 launchd 任务。数据目录和安装根带空格，和真实的
// ~/Library/Application Support/Bytezard Lead/ 一样。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { loginShellPathFile, type LoginShellPathResult } from "@pi-lead-child/core";
import {
  INSTALL_STATE_FILE, MAX_SOCKET_PATH_BYTES, runDesktopInstall, socketPathTooLong,
  type DesktopInstallDeps, type DesktopInstallEvent,
} from "../src/deploy/desktop-install.js";
import { LAUNCHD_LABEL, plistContent } from "../src/deploy/launchd.js";
import { daemonReadyTimeoutMs, DEFAULT_DAEMON_READY_TIMEOUT_MS, SUPERVISOR_REQUEST_TIMEOUT } from "../src/client.js";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// 一份装好的运行包：<数据目录>/runtime/versions/1.3.0/，current 指向它。
function installedRuntime(parent = tempDir("plc-desktop-")) {
  const dataDir = join(parent, "Bytezard Lead");
  const installRoot = join(dataDir, "runtime");
  const version = join(installRoot, "versions", "1.3.0");
  const files: Record<string, string> = {
    "bin/lead-agent": "node binary",
    "apps/daemon/dist/supervisor.mjs": "supervisor",
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(version, file, ".."), { recursive: true });
    writeFileSync(join(version, file), content);
  }
  writeFileSync(join(version, "release.json"), JSON.stringify({
    schema: 1, product: "bytezard-lead", version: "1.3.0", arch: process.arch, schemaVersion: 63,
    files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, sha256(content)])),
  }));
  symlinkSync(join(installRoot, "versions", "1.3.0"), join(installRoot, "current"));
  return { dataDir, installRoot, root: join(installRoot, "current"), version };
}

// 假的 launchd：记下调用顺序，按 bootstrap/bootout 数正在跑的 supervisor。
function fakeHost(runtime: ReturnType<typeof installedRuntime>, overrides: Partial<DesktopInstallDeps> = {}) {
  const calls: string[] = [];
  const events: DesktopInstallEvent[] = [];
  const host = { supervisors: 0, loaded: false, calls, events };
  const plistPath = join(runtime.dataDir, "..", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  const deps: DesktopInstallDeps = {
    root: runtime.root,
    installRoot: runtime.installRoot,
    dataDir: runtime.dataDir,
    dbPath: join(runtime.dataDir, "plc.db"),
    plistPath,
    preRenamePlistPaths: [],
    locale: "en",
    emit: (event) => events.push(event),
    captureLoginShellPath: async (): Promise<LoginShellPathResult> => {
      calls.push("capture");
      return { state: "ok", shell: "/bin/zsh", path: ["/Users/alice/.nvm/versions/node/v24.1.0/bin", "/usr/bin"] };
    },
    launchd: {
      loaded: async () => host.loaded,
      stopRunning: async () => { calls.push("stop"); if (host.loaded) { host.loaded = false; host.supervisors = 0; } },
      bootstrap: async (plist) => {
        calls.push(`bootstrap ${plist}`);
        if (host.loaded) host.supervisors -= 1; // bootstrapAgent 先 bootout
        host.loaded = true;
        host.supervisors += 1;
      },
    },
    supervisor: {
      waitUntilAvailable: async () => host.supervisors > 0,
      ensureRunning: async () => { calls.push("ensure_running"); },
    },
    daemon: { waitForStatus: async () => (host.supervisors > 0 ? { gatewayUrl: "http://127.0.0.1:47131" } : null) },
    now: () => new Date("2026-11-03T09:00:00.000Z"),
    ...overrides,
  };
  return { deps, host, plistPath };
}

const installState = (installRoot: string) => JSON.parse(readFileSync(join(installRoot, INSTALL_STATE_FILE), "utf8"));

describe("runDesktopInstall", () => {
  it("installs from an install root with spaces, points the plist at current, and reports each step as JSON", async () => {
    const runtime = installedRuntime();
    expect(runtime.root).toContain("Bytezard Lead");
    const { deps, host, plistPath } = fakeHost(runtime);
    // 没有 AM_API_KEY：发布模式不查它。
    const result = await runDesktopInstall({ ...deps });
    expect(result).toEqual({ ok: true, outcome: "installed", gatewayUrl: "http://127.0.0.1:47131" });
    expect(host.calls).toEqual(["capture", "stop", `bootstrap ${plistPath}`, "ensure_running"]);

    const xml = readFileSync(plistPath, "utf8");
    expect(xml).toBe(plistContent({
      nodeBin: join(runtime.root, "bin", "lead-agent"),
      entry: join(runtime.root, "apps", "daemon", "dist", "supervisor.mjs"),
      cwd: runtime.root,
      logDir: join(runtime.dataDir, "logs"),
    }));
    expect(xml).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
    expect(xml).toContain(`<string>${runtime.installRoot}/current/bin/lead-agent</string>`);
    expect(xml).toContain(`<string>${runtime.installRoot}/current/apps/daemon/dist/supervisor.mjs</string>`);
    expect(xml).toContain(`<key>WorkingDirectory</key><string>${runtime.installRoot}/current</string>`);
    expect(xml).not.toContain("versions/1.3.0");

    for (const event of host.events) {
      expect(Object.keys(event)).toEqual(expect.arrayContaining(["step", "state", "message"]));
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
    expect(host.events.filter((event) => event.state === "done").map((event) => event.step))
      .toEqual(["preflight", "detect", "login_shell_path", "launchd", "supervisor", "daemon", "done"]);
    expect(host.events.at(-1)).toMatchObject({ step: "done", state: "done", gatewayUrl: "http://127.0.0.1:47131" });
    expect(host.events.map((event) => event.message).join(" ")).not.toMatch(/fairy/i);

    expect(JSON.parse(readFileSync(loginShellPathFile(runtime.dataDir), "utf8")).path)
      .toEqual(["/Users/alice/.nvm/versions/node/v24.1.0/bin", "/usr/bin"]);
    expect(installState(runtime.installRoot)).toMatchObject({
      version: 1, root: runtime.root, outcome: "installed", lastError: null,
      steps: { daemon: { state: "done", at: "2026-11-03T09:00:00.000Z" } },
    });
  });

  it("is idempotent: a second run leaves one supervisor and does not restart it", async () => {
    const runtime = installedRuntime();
    const { deps, host } = fakeHost(runtime);
    expect((await runDesktopInstall(deps)).ok).toBe(true);
    host.calls.length = 0;
    const second = await runDesktopInstall(deps);
    expect(second).toMatchObject({ ok: true, outcome: "installed" });
    expect(host.supervisors).toBe(1);
    expect(host.calls).toEqual(["capture", "ensure_running"]);
    expect(host.events.find((event) => event.step === "launchd" && event.state === "done" && event.code === "launchd_unchanged"))
      .toBeDefined();
  });

  it("replaces a plist that points elsewhere, stopping the old supervisor first, and still leaves one", async () => {
    const runtime = installedRuntime();
    const { deps, host, plistPath } = fakeHost(runtime);
    mkdirSync(join(plistPath, ".."), { recursive: true });
    writeFileSync(plistPath, plistContent({ nodeBin: "/old/node", entry: "/old/supervisor.mjs", cwd: "/old", logDir: "/old/logs" }));
    host.loaded = true;
    host.supervisors = 1;
    expect((await runDesktopInstall(deps)).ok).toBe(true);
    expect(host.calls.indexOf("stop")).toBeLessThan(host.calls.findIndex((call) => call.startsWith("bootstrap")));
    expect(host.supervisors).toBe(1);
    expect(readFileSync(plistPath, "utf8")).toContain(runtime.root);
  });

  it("does not overwrite a developer install whose plist points at a git checkout", async () => {
    const runtime = installedRuntime();
    const { deps, host, plistPath } = fakeHost(runtime, {
      daemon: { waitForStatus: async () => ({ gatewayUrl: "http://127.0.0.1:47130" }) },
    });
    const checkout = join(tempDir("plc-checkout-"), "my repo");
    mkdirSync(join(checkout, ".git"), { recursive: true });
    mkdirSync(join(plistPath, ".."), { recursive: true });
    const devPlist = plistContent({ nodeBin: "/usr/local/bin/node", entry: join(checkout, "apps/daemon/dist/supervisor.mjs"), cwd: checkout, logDir: "/x" });
    writeFileSync(plistPath, devPlist);

    const result = await runDesktopInstall(deps);
    expect(result).toEqual({ ok: true, outcome: "dev_install", code: "dev_install_detected", gatewayUrl: "http://127.0.0.1:47130" });
    expect(readFileSync(plistPath, "utf8")).toBe(devPlist);
    expect(host.calls).toEqual([]);
    expect(host.events.find((event) => event.code === "dev_install_detected")).toMatchObject({ step: "detect", state: "done" });
    expect(host.events.at(-1)).toMatchObject({ step: "done", code: "dev_install_detected", gatewayUrl: "http://127.0.0.1:47130" });
  });

  it("does not install while a plist with the pre-rename label is still on the machine", async () => {
    const runtime = installedRuntime();
    const legacy = join(tempDir("plc-agents-"), "com.pi-lead-child.supervisor.plist");
    writeFileSync(legacy, "<plist/>");
    const { deps, host, plistPath } = fakeHost(runtime, { preRenamePlistPaths: [legacy] });
    const result = await runDesktopInstall(deps);
    expect(result).toEqual({ ok: false, outcome: "failed", code: "legacy_install_detected" });
    expect(host.calls).toEqual([]);
    expect(existsSync(plistPath)).toBe(false);
    expect(host.events.at(-1)).toMatchObject({ step: "detect", state: "failed", code: "legacy_install_detected" });
    expect(installState(runtime.installRoot).lastError).toMatchObject({ step: "detect", code: "legacy_install_detected" });
  });

  it("stops before installing when a socket path in the data folder is longer than macOS allows", async () => {
    const runtime = installedRuntime(join(tempDir("plc-desktop-"), "u".repeat(80)));
    expect(Buffer.byteLength(join(runtime.dataDir, "plc.sock"))).toBeGreaterThan(104);
    const { deps, host, plistPath } = fakeHost(runtime);
    const result = await runDesktopInstall(deps);
    expect(result.code).toBe("socket_path_too_long");
    expect(host.calls).toEqual([]);
    expect(existsSync(plistPath)).toBe(false);
    expect(host.events.at(-1)).toMatchObject({ step: "preflight", state: "failed", code: "socket_path_too_long" });
  });

  it("refuses a root that is not <install root>/current, and a runtime whose files do not match release.json", async () => {
    const runtime = installedRuntime();
    const notCurrent = fakeHost(runtime, { root: runtime.version });
    expect((await runDesktopInstall(notCurrent.deps)).code).toBe("root_invalid");
    expect(notCurrent.host.calls).toEqual([]);

    writeFileSync(join(runtime.version, "apps/daemon/dist/supervisor.mjs"), "tampered");
    const tampered = fakeHost(runtime);
    expect((await runDesktopInstall(tampered.deps)).code).toBe("release_invalid");
    expect(tampered.host.events.at(-1)!.message).toContain("apps/daemon/dist/supervisor.mjs");
    expect(tampered.host.calls).toEqual([]);
  });

  it("goes on with the known folders when the login shell PATH cannot be read", async () => {
    const runtime = installedRuntime();
    const { deps, host } = fakeHost(runtime, { captureLoginShellPath: async () => ({ state: "timed_out", shell: "/bin/zsh" }) });
    expect((await runDesktopInstall(deps)).ok).toBe(true);
    expect(host.events.find((event) => event.step === "login_shell_path" && event.state !== "running"))
      .toMatchObject({ state: "skipped", code: "login_shell_path_unavailable" });
    expect(existsSync(loginShellPathFile(runtime.dataDir))).toBe(false);
  });

  it("records a bootstrap failure with its launchctl text in install-state.json and points the user at Login Items", async () => {
    const runtime = installedRuntime();
    const { deps, host } = fakeHost(runtime);
    deps.launchd.bootstrap = async () => { throw new Error("Bootstrap failed: 5: Input/output error"); };
    const result = await runDesktopInstall(deps);
    expect(result).toEqual({ ok: false, outcome: "failed", code: "launchd_bootstrap_failed" });
    expect(host.events.at(-1)).toMatchObject({ step: "launchd", state: "failed", code: "launchd_bootstrap_failed" });
    expect(host.events.at(-1)!.message).toContain("Login Items & Extensions");
    expect(host.events.at(-1)!.message).not.toContain("Input/output");
    expect(installState(runtime.installRoot)).toMatchObject({
      outcome: "failed",
      lastError: { step: "launchd", code: "launchd_bootstrap_failed", detail: "Bootstrap failed: 5: Input/output error" },
    });
  });

  it("reports a daemon that does not answer in time", async () => {
    const slow = fakeHost(installedRuntime(), { daemon: { waitForStatus: async () => null } });
    expect((await runDesktopInstall(slow.deps)).code).toBe("daemon_timeout");
  });

  // P0-4 返工：机器忙时 daemon 启动要几分钟（2026-11-03 负载 35–90）。desktop-install 等得和 supervisor 一样久，
  // 等过了也报「还在启动」（daemon_timeout），不报被拒绝。
  it("waits for the daemon as long as the supervisor does", async () => {
    const waits: number[] = [];
    const { deps } = fakeHost(installedRuntime(), {
      daemon: { waitForStatus: async (timeoutMs) => { waits.push(timeoutMs); return { gatewayUrl: "http://127.0.0.1:47131" }; } },
    });
    expect((await runDesktopInstall(deps)).ok).toBe(true);
    expect(waits).toEqual([daemonReadyTimeoutMs()]);
    expect(daemonReadyTimeoutMs()).toBe(DEFAULT_DAEMON_READY_TIMEOUT_MS);
  });

  it("reports a start that outlasts the supervisor's wait as still starting, not as refused", async () => {
    const slow = fakeHost(installedRuntime());
    slow.deps.supervisor.ensureRunning = async () => {
      throw Object.assign(new Error("supervisor request timed out"), { code: SUPERVISOR_REQUEST_TIMEOUT });
    };
    expect((await runDesktopInstall(slow.deps)).code).toBe("daemon_timeout");
    expect(slow.host.events.at(-1)!.message).toContain("still starting");
  });

  it("reports a refused start with the supervisor's reason", async () => {
    const refused = fakeHost(installedRuntime());
    refused.deps.supervisor.ensureRunning = async () => { throw new Error("deploy gate refused"); };
    expect((await runDesktopInstall(refused.deps)).code).toBe("daemon_refused");
    expect(refused.host.events.at(-1)!.message).toContain("deploy gate refused");
  });

  it("maps a full disk to its own code", async () => {
    const runtime = installedRuntime();
    const { deps } = fakeHost(runtime);
    deps.launchd.stopRunning = async () => { throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" }); };
    expect((await runDesktopInstall(deps)).code).toBe("disk_full");
  });

  it("writes the progress in Chinese when the App asks for it", async () => {
    const { deps, host } = fakeHost(installedRuntime(), { locale: "zh" });
    await runDesktopInstall(deps);
    expect(host.events.at(-1)!.message).toBe("Bytezard Lead 装好了。");
  });
});

describe("socketPathTooLong", () => {
  it("checks the longest socket in the data folder against the 103-byte limit of sun_path", () => {
    // supervisor.sock 比 plc.sock 长 7 字节，它决定上限。
    const fits = `/${"d".repeat(MAX_SOCKET_PATH_BYTES - "/supervisor.sock".length - 1)}`;
    expect(Buffer.byteLength(join(fits, "supervisor.sock"))).toBe(MAX_SOCKET_PATH_BYTES);
    expect(socketPathTooLong(fits)).toBeNull();
    expect(socketPathTooLong(`${fits}x`)).toMatchObject({ path: join(`${fits}x`, "supervisor.sock"), bytes: MAX_SOCKET_PATH_BYTES + 1 });
  });
});
