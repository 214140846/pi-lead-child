// src/deploy/launchd.ts — 本机 launchd 集成（spec §B3）。plist 不含密钥（凭证走 config.json）。
// launchd 常驻的是 Supervisor；plc daemon stop 只停止它托管的 coordinatord，Supervisor 本身保持在线。
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

export const LAUNCHD_LABEL = "com.pi-lead-child.supervisor";
export const LEGACY_LAUNCHD_LABEL = "com.pi-lead-child.coordinatord";

export interface PlistOpts { nodeBin: string; entry: string; cwd: string; logDir: string }

// 改名以前的 supervisor 任务（docs/desktop/macos-desktop-design.md 第 4.2 节第 3 步）。P0-8 把 LAUNCHD_LABEL 改成
// com.bytezard.plc.supervisor 以后，机器上还有它就说明是没迁移的开发机。改名以前它和 LAUNCHD_LABEL 是同一个任务，不算旧安装。
export const PRE_RENAME_LAUNCHD_LABEL = "com.pi-lead-child.supervisor";

export function launchAgentsDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

export function plistPath(): string {
  return join(launchAgentsDir(), `${LAUNCHD_LABEL}.plist`);
}

/** 没迁移的旧安装可能留下的 plist。改名以前为空。 */
export function preRenamePlistPaths(): string[] {
  return PRE_RENAME_LAUNCHD_LABEL === LAUNCHD_LABEL ? [] : [join(launchAgentsDir(), `${PRE_RENAME_LAUNCHD_LABEL}.plist`)];
}

/**
 * 桌面版运行包的 plist 参数（设计第 1.1 节）。root 是 <安装根>/current：plist 写软链接的路径，不写具体版本，
 * 换版本时只换 current，不用重写 plist。Node 在运行包里改名为 lead-agent。
 */
export function desktopPlistOptions(root: string, logDir: string): PlistOpts {
  return {
    nodeBin: join(root, "bin", "lead-agent"),
    entry: join(root, "apps", "daemon", "dist", "supervisor.mjs"),
    cwd: root,
    logDir,
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
  <key>StandardErrorPath</key><string>${errLog}</string>
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

export async function uninstallAgent(plist: string): Promise<void> {
  const r = await launchctl(["bootout", `gui/${process.getuid!()}/${LAUNCHD_LABEL}`]);
  await launchctl(["bootout", `gui/${process.getuid!()}/${LEGACY_LAUNCHD_LABEL}`]);
  // bootout 对"本来就没装"也会返回非零（"Could not find service"之类），这是正常路径，不应报错。
  // 但真实失败（权限、launchd 本身异常等）不该被静默吞掉——不 throw（卸载失败不该是 fatal，
  // 用户仍要能清理 plist 文件），但必须打到 stderr 让人看见。
  if (!r.ok && !/No such process|not find|could not be found/i.test(r.out)) {
    console.error(`[launchd] bootout 警告: ${r.out}`);
  }
  rmSync(plist, { force: true });
}

export async function agentStatus(): Promise<string | null> {
  const r = await launchctl(["print", `gui/${process.getuid!()}/${LAUNCHD_LABEL}`]);
  return r.ok ? r.out : null; // null = 未加载
}
