// desktop-install 测试共用的假环境：一份装好的运行包，假的 launchd、socket 和登录 shell。
// 文件、目录和库用真的（临时目录下面），不碰这台机器上真的 launchd 任务。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@pi-lead-child/core/testing";
import type { LoginShellPathResult } from "@pi-lead-child/core";
import { LATEST_SCHEMA_VERSION } from "@pi-lead-child/store";
import type { DesktopInstallDeps, DesktopInstallEvent } from "../src/deploy/desktop-install.js";
import { LAUNCHD_LABEL } from "../src/deploy/launchd.js";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * 往 <安装根>/versions/<version>/ 放一份运行包。components 是 release.json 的组成哈希（第 7.5.1 节）；不给时没有这一项，
 * 和 2026-11-05 以前打的包一样。
 */
export function addRuntimeVersion(
  installRoot: string, version: string,
  o: { components?: Record<string, string>; schemaVersion?: number } = {},
): string {
  const dir = join(installRoot, "versions", version);
  const files: Record<string, string> = {
    "bin/lead-agent": "node binary",
    "apps/daemon/dist/supervisor.mjs": "supervisor",
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  writeFileSync(join(dir, "release.json"), JSON.stringify({
    schema: 1, product: "bytezard-lead", version, arch: process.arch, schemaVersion: o.schemaVersion ?? LATEST_SCHEMA_VERSION,
    files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, sha256(content)])),
    ...(o.components ? { components: o.components } : {}),
  }));
  return dir;
}

/** 一套组成哈希，overrides 换掉其中几个。 */
export function runtimeComponents(overrides: Record<string, string> = {}): Record<string, string> {
  return { node: "1".repeat(64), node_modules: "2".repeat(64), service: "3".repeat(64), web: "4".repeat(64), cli: "5".repeat(64), ...overrides };
}

// 一份装好的运行包：<数据目录>/runtime/versions/1.3.0/，current 指向它（和壳一样是相对的软链接）。
export function installedRuntime(parent = tempDir("plc-desktop-"), o: Parameters<typeof addRuntimeVersion>[2] = {}) {
  const dataDir = join(parent, "Bytezard Lead");
  const installRoot = join(dataDir, "runtime");
  const version = addRuntimeVersion(installRoot, "1.3.0", o);
  symlinkSync(join("versions", "1.3.0"), join(installRoot, "current"));
  return { dataDir, installRoot, root: join(installRoot, "current"), version };
}

export type Runtime = ReturnType<typeof installedRuntime>;

// 假的 launchd：记下调用顺序，按 bootstrap/bootout 数正在跑的 supervisor。desktop-install 自己的 launchd 和接管时
// 迁移模块的 launchctl 共用同一份状态。
export function fakeHost(runtime: Runtime, overrides: Partial<DesktopInstallDeps> = {}) {
  const calls: string[] = [];
  const events: DesktopInstallEvent[] = [];
  const labels = new Set<string>();
  const host = {
    calls, events, labels,
    get supervisors() { return labels.has(LAUNCHD_LABEL) ? 1 : 0; },
    set supervisors(n: number) { if (n > 0) labels.add(LAUNCHD_LABEL); else labels.delete(LAUNCHD_LABEL); },
    get loaded() { return labels.has(LAUNCHD_LABEL); },
    set loaded(value: boolean) { if (value) labels.add(LAUNCHD_LABEL); else labels.delete(LAUNCHD_LABEL); },
  };
  const agentsDir = join(runtime.dataDir, "..", "LaunchAgents");
  const plistPath = join(agentsDir, `${LAUNCHD_LABEL}.plist`);
  const deps: DesktopInstallDeps = {
    root: runtime.root,
    installRoot: runtime.installRoot,
    dataDir: runtime.dataDir,
    dbPath: join(runtime.dataDir, "plc.db"),
    plistPath,
    preRenamePlistPaths: [],
    preRenameDataDir: null,
    takeover: {
      launchAgentsDir: agentsDir,
      uid: 501,
      launchctl: async (args) => {
        const label = args[0] === "bootstrap"
          ? /<key>Label<\/key><string>([^<]+)<\/string>/.exec(readFileSync(args[2]!, "utf8"))![1]!
          : args[1]!.split("/").at(-1)!;
        calls.push(`launchctl ${args[0]} ${label}`);
        if (args[0] === "bootout") {
          const was = labels.delete(label);
          return { ok: was, out: was ? "" : "Could not find service" };
        }
        if (args[0] === "bootstrap") {
          labels.add(label);
          return { ok: true, out: "" };
        }
        return { ok: labels.has(label), out: "" };
      },
      freeBytes: () => 1e12,
      drain: async () => { calls.push("drain"); },
      waitStopped: async () => {},
      health: async () => { calls.push("health"); },
    },
    locale: "en",
    emit: (event) => events.push(event),
    captureLoginShellPath: async (): Promise<LoginShellPathResult> => {
      calls.push("capture");
      return { state: "ok", shell: "/bin/zsh", path: ["/Users/alice/.nvm/versions/node/v24.1.0/bin", "/usr/bin"] };
    },
    launchd: {
      loaded: async () => host.loaded,
      stopRunning: async () => { calls.push("stop"); host.loaded = false; },
      bootstrap: async (plist) => {
        calls.push(`bootstrap ${plist}`);
        host.loaded = true;
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
  return { deps, host, plistPath, agentsDir };
}

export const installState = (installRoot: string) => JSON.parse(readFileSync(join(installRoot, "install-state.json"), "utf8"));
