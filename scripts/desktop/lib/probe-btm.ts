// P0-7 返工的实测工具（docs/desktop/p0-7-measurements.md「实测 3」「实测 4」）：「登录项与扩展」按什么显示后台项目的名字。
// 每个探测项是一个单独的 LaunchAgent（label com.bytezard.plc.probe-pN），用不同的做法，名字各不相同，
// 看列表里出现哪个名字，就知道系统用的是哪一项：
//
//   p1  Node 放进程序包，ad-hoc 重签；目录名、CFBundleName、CFBundleDisplayName、程序名各不相同
//   p2  同 p1，plist 另加 AssociatedBundleIdentifiers=com.bytezard.plc（Bytezard Lead App）
//   p3  不放进程序包，只用自己的标识 ad-hoc 重签
//   p4  保留 Node 官方签名，只在 plist 加 AssociatedBundleIdentifiers
//   p5  实测 3 当时交付的做法（Bytezard Lead.app + AssociatedBundleIdentifiers），现在是对照组
//
// 实测 3 的设置页截图（2026-11-04 15:57）：「允许在后台」显示的是可执行文件名（p1–p3 显示 pN-exec，p5 显示 lead-agent）。
// 实测 4 看可执行文件直接叫 Bytezard Lead 行不行，以及能不能用软链接同时保住进程名 lead-agent：
//
//   p6  不放进程序包，ad-hoc 重签，可执行文件叫「Bytezard Lead P6」（带空格）
//   p7  真实文件叫「Bytezard Lead P7」，plist 写指向它的软链接 lead-agent-p7
//   p8  真实文件叫 lead-agent-p8，plist 写指向它的软链接「Bytezard Lead P8」
//
// 名字带 P6/P7/P8，截图里才分得清是哪一项。status 还打印每个探测项的进程名（活动监视器里看到的名字）。
// 实测 4 的结果：设置页显示 plist 里路径的文件名（软链接自己的名字），进程名跟着真实文件名走。所以选做法 1b：
//
//   p9  现在交付的做法，和打包脚本用同一个函数（agent-bundle.ts 的 installAgent）：bin/lead-agent 重签，
//       plist 写软链接 bin/Bytezard Lead。用来做端到端实测：预期显示 Bytezard Lead，进程名 lead-agent。
//
// 它们只空等，不发通知，不碰正在运行的 supervisor 和 hindsight。看完运行 remove。
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_BINARY, AGENT_LAUNCHER, AGENT_SIGN_ID, type AgentBundleSpec } from "./agent-bundle.js";

export const PROBE_LABEL_PREFIX = "com.bytezard.plc.probe-";
// 每个子命令（launchctl、codesign、sfltool、mdfind、open）最多等这么久。2026-11-04 代跑时 install 在最后一步等了
// 180 秒才结束：超时就记成失败，接着做下一步。
export const COMMAND_TIMEOUT_MS = 30_000;
export const APP_BUNDLE_ID = "com.bytezard.plc";

export interface ProbeVariant {
  id: string;
  label: string;
  /** 放进程序包时的程序包；为 null 时是不放进程序包的单个程序。 */
  bundle: AgentBundleSpec | null;
  /** 不放进程序包时的程序名。 */
  executable: string;
  /** plist 写的是指向程序的软链接（和程序在同一个目录）时，软链接的名字。 */
  launchName: string | null;
  /** 用打包脚本的 installAgent 生成（交付的做法）。 */
  shipped?: boolean;
  /** 重签用的标识；为 null 时保留 Node 官方签名。 */
  signIdentifier: string | null;
  associatedBundleId: string | null;
  /** 在「登录项与扩展」里看到这些名字中的哪一个，就说明系统用的是哪一项。 */
  expect: string;
}

const bundle = (n: string): AgentBundleSpec => ({
  dirName: `${n.toUpperCase()} Folder.app`,
  name: `${n.toUpperCase()} BundleName`,
  displayName: `${n.toUpperCase()} DisplayName`,
  bundleId: `com.bytezard.plc.probe-${n}`,
  executable: `${n}-exec`,
  version: "0.0.0",
});

export function probeVariants(): ProbeVariant[] {
  const p1 = bundle("p1");
  const p2 = bundle("p2");
  // 实测 3 当时交付的程序包做法（7335ec54），现在只当对照组。
  const measurement3: AgentBundleSpec = {
    dirName: "Bytezard Lead.app", name: "Bytezard Lead", displayName: "Bytezard Lead",
    bundleId: "com.bytezard.plc.agent", executable: "lead-agent", version: "0.0.0",
  };
  const bare = (id: string, executable: string, launchName: string | null, expect: string): ProbeVariant => ({
    id, label: `${PROBE_LABEL_PREFIX}${id}`, bundle: null, executable, launchName,
    signIdentifier: `com.bytezard.plc.probe-${id}`, associatedBundleId: null, expect,
  });
  return [
    {
      id: "p1", label: `${PROBE_LABEL_PREFIX}p1`, bundle: p1, executable: p1.executable, launchName: null, signIdentifier: p1.bundleId, associatedBundleId: null,
      expect: `${p1.dirName} / ${p1.name} / ${p1.displayName} / ${p1.executable}，或者开发者名`,
    },
    {
      id: "p2", label: `${PROBE_LABEL_PREFIX}p2`, bundle: p2, executable: p2.executable, launchName: null, signIdentifier: p2.bundleId, associatedBundleId: APP_BUNDLE_ID,
      expect: `Bytezard Lead（App 的名字），或者 ${p2.name} / ${p2.displayName} / ${p2.dirName} / ${p2.executable}`,
    },
    {
      id: "p3", label: `${PROBE_LABEL_PREFIX}p3`, bundle: null, executable: "p3-exec", launchName: null, signIdentifier: "com.bytezard.plc.probe-p3", associatedBundleId: null,
      expect: "p3-exec，或者 com.bytezard.plc.probe-p3",
    },
    {
      id: "p4", label: `${PROBE_LABEL_PREFIX}p4`, bundle: null, executable: "p4-exec", launchName: null, signIdentifier: null, associatedBundleId: APP_BUNDLE_ID,
      expect: "Bytezard Lead（App 的名字），或者 Node.js Foundation",
    },
    {
      id: "p5", label: `${PROBE_LABEL_PREFIX}p5`, bundle: measurement3, executable: measurement3.executable, launchName: null, signIdentifier: measurement3.bundleId, associatedBundleId: APP_BUNDLE_ID,
      expect: "lead-agent（实测 3 截图），对照组",
    },
    bare("p6", "Bytezard Lead P6", null, "Bytezard Lead P6"),
    bare("p7", "Bytezard Lead P7", "lead-agent-p7", "Bytezard Lead P7（按真实文件名）或 lead-agent-p7（按 plist 里的路径）"),
    bare("p8", "lead-agent-p8", "Bytezard Lead P8", "Bytezard Lead P8（按 plist 里的路径）或 lead-agent-p8（按真实文件名）"),
    {
      id: "p9", label: `${PROBE_LABEL_PREFIX}p9`, bundle: null, executable: AGENT_BINARY, launchName: AGENT_LAUNCHER, shipped: true,
      signIdentifier: AGENT_SIGN_ID, associatedBundleId: APP_BUNDLE_ID,
      expect: "Bytezard Lead（交付的做法），进程名 lead-agent",
    },
  ];
}

/** 这个做法的程序放在哪里。 */
export function probeExecutable(root: string, variant: ProbeVariant): string {
  const dir = join(root, variant.id);
  return variant.bundle ? join(dir, variant.bundle.dirName, "Contents", "MacOS", variant.bundle.executable) : join(dir, variant.executable);
}

/** plist 里写的程序路径：有软链接时写软链接。 */
export function probeLaunchPath(root: string, variant: ProbeVariant): string {
  return variant.launchName ? join(root, variant.id, variant.launchName) : probeExecutable(root, variant);
}

/** 只要命令行里点名的探测项；没点名时全部。点了不存在的名字时报错。 */
export function selectVariants(ids: readonly string[]): ProbeVariant[] {
  const all = probeVariants();
  if (!ids.length) return all;
  const unknown = ids.filter((id) => !all.some((v) => v.id === id));
  if (unknown.length) throw new Error(`没有这些探测项：${unknown.join("、")}。可选：${all.map((v) => v.id).join("、")}`);
  return all.filter((v) => ids.includes(v.id));
}

/** launchctl print 输出里的 pid；没在运行时为 null。 */
export function launchdPid(printed: string): number | null {
  const match = /^\s*pid = (\d+)\s*$/m.exec(printed);
  return match ? Number(match[1]) : null;
}

const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function probePlist(root: string, variant: ProbeVariant, idleScript: string): string {
  const associated = variant.associatedBundleId
    ? `\n  <key>AssociatedBundleIdentifiers</key><string>${xmlEscape(variant.associatedBundleId)}</string>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(variant.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(probeLaunchPath(root, variant))}</string>
    <string>${xmlEscape(idleScript)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(join(root, variant.id))}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>${associated}
</dict>
</plist>
`;
}

/**
 * sfltool dumpbtm 的输出里只留和探测有关的记录（含 bytezard 或 probe 的那几段），别的登录项不打印。
 * 记录之间用空行或「#数字:」开头的行分开。
 */
export function probeRecords(dump: string): string[] {
  const records: string[][] = [];
  let current: string[] = [];
  for (const line of dump.split("\n")) {
    if (!line.trim() || /^\s*#\d+:/.test(line)) {
      if (current.length) records.push(current);
      current = line.trim() ? [line] : [];
      continue;
    }
    current.push(line);
  }
  if (current.length) records.push(current);
  return records.map((lines) => lines.join("\n")).filter((text) => /bytezard|probe-p\d/i.test(text));
}

const execFileAsync = promisify(execFile);

/** 运行一个子命令，参数用数组传，不经 shell。超过 timeoutMs 就停掉它，记成失败。 */
export async function runCommand(file: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string; killed?: boolean };
    if (e.killed) return { ok: false, out: `${file} 超过 ${timeoutMs / 1000} 秒没有结束，已停止` };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message };
  }
}
