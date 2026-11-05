// src/deploy/launchd.ts — 本机 launchd 集成（spec §B3）。plist 不含密钥（凭证走 config.json）。
// launchd 常驻的是 Supervisor；plc daemon stop 只停止它托管的 coordinatord，Supervisor 本身保持在线。
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import {
  dataDir, isPreRenameDataDir, PRE_RENAME_COORDINATORD_LABEL, PRE_RENAME_SUPERVISOR_LABEL,
} from "@pi-lead-child/core";

export const LAUNCHD_LABEL = "com.bytezard.plc.supervisor";
export const LEGACY_LAUNCHD_LABEL = PRE_RENAME_COORDINATORD_LABEL;

export interface PlistOpts {
  nodeBin: string;
  entry: string;
  cwd: string;
  logDir: string;
  /** 「登录项与扩展」里把这个后台项目归到哪个 App 名下（launchd.plist 的 AssociatedBundleIdentifiers）。 */
  associatedBundleId?: string;
}

// 桌面版运行包里 launchd 运行的路径（scripts/desktop/lib/agent-bundle.ts 的 AGENT_LAUNCHER，scripts/desktop/test 核对两处一致）。
// 它是指向 bin/lead-agent 的软链接，名叫「Bytezard Lead」：「允许在后台」显示的是 plist 里这个路径的文件名，
// 进程名跟着真实文件 lead-agent 走（docs/desktop/macos-desktop-design.md 第 8.7 节，做法 1b，2026-11-04 实测 4）。
export const DESKTOP_AGENT_LAUNCHER = ["bin", "Bytezard Lead"] as const;
// Bytezard Lead App 的 bundle id（desktop/desktop-builder.yml 的 appId）。plist 的 AssociatedBundleIdentifiers 用它。
// 实测 3：ad-hoc 签名下这个键不改变登录项的显示，留着给以后有 Developer ID 签名时用（P2-4）。
export const DESKTOP_APP_BUNDLE_ID = "com.bytezard.plc";

// 改名以前的 supervisor 任务（docs/desktop/macos-desktop-design.md 第 12.2 节）。机器上还有它就说明是没迁移的开发机：
// desktop-install 自动迁移并接管（第 12.3 节）；plc daemon install 不装，先运行 ops.mjs migrate-data-dir。
export const PRE_RENAME_LAUNCHD_LABEL = PRE_RENAME_SUPERVISOR_LABEL;

export function launchAgentsDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

export function plistPath(): string {
  return join(launchAgentsDir(), `${LAUNCHD_LABEL}.plist`);
}

/** 没迁移的旧安装可能留下的 plist。 */
export function preRenamePlistPaths(): string[] {
  return [join(launchAgentsDir(), `${PRE_RENAME_LAUNCHD_LABEL}.plist`)];
}

/**
 * 用这个数据目录的 supervisor 任务。还没迁移的开发机用改名以前的目录（core 的 installedDataDir），也用改名以前的任务：
 * plc daemon status、uninstall 和 doctor 看的是它，迁移以前不另装一个新任务。
 */
export function activeLaunchdLabel(dir: string = dataDir(), home: string = homedir()): string {
  return isPreRenameDataDir(dir, home) ? PRE_RENAME_LAUNCHD_LABEL : LAUNCHD_LABEL;
}

/**
 * 桌面版运行包的 plist 参数（设计第 1.1 节）。root 是 <安装根>/current：plist 写软链接的路径，不写具体版本，
 * 换版本时只换 current，不用重写 plist。Node 在运行包里叫 bin/lead-agent，plist 写指向它的软链接 bin/Bytezard Lead（第 8.7 节）。
 */
export function desktopPlistOptions(root: string, logDir: string): PlistOpts {
  return {
    nodeBin: join(root, ...DESKTOP_AGENT_LAUNCHER),
    entry: join(root, "apps", "daemon", "dist", "supervisor.mjs"),
    cwd: root,
    logDir,
    associatedBundleId: DESKTOP_APP_BUNDLE_ID,
  };
}

// 路径里理论上可能含 &/</>（虽然实践中罕见），plist 是 XML，插值前必须转义，否则生成非法/被截断的 plist。
const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const xmlUnescape = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** plistContent 写出的 WorkingDirectory。读不到时为 null。 */
export function plistWorkingDirectory(xml: string): string | null {
  const match = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(xml);
  return match ? xmlUnescape(match[1]!) : null;
}

export function plistContent(o: PlistOpts): string {
  const nodeBin = xmlEscape(o.nodeBin);
  const entry = xmlEscape(o.entry);
  const cwd = xmlEscape(o.cwd);
  const outLog = xmlEscape(join(o.logDir, "supervisor.out.log"));
  const errLog = xmlEscape(join(o.logDir, "supervisor.err.log"));
  const associated = o.associatedBundleId
    ? `\n  <key>AssociatedBundleIdentifiers</key><string>${xmlEscape(o.associatedBundleId)}</string>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${entry}</string>
  </array>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${outLog}</string>
  <key>StandardErrorPath</key><string>${errLog}</string>${associated}
</dict>
</plist>
`;
}

export function launchctl(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("launchctl", args, (err, stdout, stderr) =>
      resolve({ ok: !err, out: (stdout + stderr).trim() }));
  });
}

export async function installAgent(plist: string, content: string): Promise<string> {
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, content);
  return bootstrapAgent(plist);
}

/** 让 launchd 按 plist 重新加载 supervisor：已加载的先 bootout（幂等），再 bootstrap。失败时抛错，message 带 launchctl 的原文。 */
export async function bootstrapAgent(plist: string): Promise<string> {
  await launchctl(["bootout", `gui/${process.getuid!()}/${LEGACY_LAUNCHD_LABEL}`]);
  await launchctl(["bootout", `gui/${process.getuid!()}/${LAUNCHD_LABEL}`]); // 已装则先卸（幂等）
  const r = await launchctl(["bootstrap", `gui/${process.getuid!()}`, plist]);
  if (!r.ok) throw new Error(`launchctl bootstrap 失败: ${r.out}`);
  return plist;
}

export async function uninstallAgent(plist: string, label: string = LAUNCHD_LABEL): Promise<void> {
  const r = await launchctl(["bootout", `gui/${process.getuid!()}/${label}`]);
  await launchctl(["bootout", `gui/${process.getuid!()}/${LEGACY_LAUNCHD_LABEL}`]);
  // bootout 对"本来就没装"也会返回非零（"Could not find service"之类），这是正常路径，不应报错。
  // 但真实失败（权限、launchd 本身异常等）不该被静默吞掉——不 throw（卸载失败不该是 fatal，
  // 用户仍要能清理 plist 文件），但必须打到 stderr 让人看见。
  if (!r.ok && !/No such process|not find|could not be found/i.test(r.out)) {
    console.error(`[launchd] bootout 警告: ${r.out}`);
  }
  rmSync(plist, { force: true });
}

export async function agentStatus(label: string = activeLaunchdLabel()): Promise<string | null> {
  const r = await launchctl(["print", `gui/${process.getuid!()}/${label}`]);
  return r.ok ? r.out : null; // null = 未加载
}
