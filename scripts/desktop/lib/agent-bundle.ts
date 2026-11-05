// 后台服务的程序（docs/desktop/macos-desktop-design.md 第 8.7 节，P0-7 返工，做法 1b）。实现在 supervisor 包里，这里转出。
//
//   <运行包>/bin/lead-agent                    Node，ad-hoc 重签，签名标识 com.bytezard.plc.agent，没有 Team ID
//   <运行包>/bin/Bytezard Lead -> lead-agent   软链接；launchd 的 plist 写它（packages/supervisor 的 desktopPlistOptions）
//   <运行包>/bin/node -> lead-agent
//
// 为什么这样做（2026-11-04 实测，docs/desktop/p0-7-measurements.md）：
// - 直接用 Node 官方的签名，后台项目归到 Node 的开发者名下，「允许在后台」显示「Node.js Foundation」（实测 2）。
//   所以要重签，去掉 Node 的签名。
// - 重签以后，「允许在后台」和「App Background Activity」通知显示的是 plist 里 ProgramArguments[0] 那个路径的文件名；
//   是软链接时显示软链接自己的名字（实测 4 的 p7、p8 截图）。程序包的目录名、CFBundleName 不起作用（实测 3）。
// - 活动监视器的进程名跟着真实文件名走（实测 4 的 p7、p8），所以进程名还是 lead-agent（第 9 节决定 6）。
//   supervisor 用 process.execPath 拉起 daemon，Node 会解开软链接，daemon 也叫 lead-agent。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adhocSign, type SignFn } from "@pi-lead-child/supervisor";

// 后台服务程序的放法在 packages/supervisor/src/deploy/agent-binary.ts：开发机的 plc daemon install 也用它（P0-8）。
export {
  adhocSign, AGENT_BINARY, AGENT_EXECUTABLE, AGENT_LAUNCH_NAME, AGENT_LAUNCHER, AGENT_SIGN_ID, AGENT_STAGING, installAgentBinary as installAgent,
  type SignFn,
} from "@pi-lead-child/supervisor";

// ── 下面是实测 3 用过的程序包做法，只给探测脚本（scripts/desktop/probe-btm.ts 的 p1、p2、p5）用 ──
// 实测 3 证明：重签以后程序包的目录名、CFBundleName、CFBundleDisplayName 都不改变「允许在后台」里显示的名字。

export interface AgentBundleSpec {
  /** 程序包的目录名，带 .app。 */
  dirName: string;
  name: string;
  displayName: string;
  bundleId: string;
  executable: string;
  version: string;
}

const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 程序包的 Info.plist。LSBackgroundOnly：它只在后台运行，不出现在程序坞里。 */
export function agentInfoPlist(spec: AgentBundleSpec): string {
  const entries: Array<[string, string]> = [
    ["CFBundleName", spec.name],
    ["CFBundleDisplayName", spec.displayName],
    ["CFBundleIdentifier", spec.bundleId],
    ["CFBundleExecutable", spec.executable],
    ["CFBundlePackageType", "APPL"],
    ["CFBundleShortVersionString", spec.version],
    ["CFBundleVersion", spec.version],
  ];
  const lines = entries.map(([key, value]) => `  <key>${key}</key><string>${xmlEscape(value)}</string>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${lines.join("\n")}
  <key>LSBackgroundOnly</key><true/>
</dict>
</plist>
`;
}

/**
 * 在 parentDir 下建程序包：写 Info.plist，把 placeBinary 交给调用方把 Node 放到 Contents/MacOS/<executable>，再签名。
 * 返回可执行文件的路径。
 */
export async function makeAgentBundle(o: {
  parentDir: string;
  spec: AgentBundleSpec;
  placeBinary: (dest: string) => Promise<void> | void;
  sign?: SignFn;
}): Promise<string> {
  const bundle = join(o.parentDir, o.spec.dirName);
  const binary = join(bundle, "Contents", "MacOS", o.spec.executable);
  mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(bundle, "Contents", "Info.plist"), agentInfoPlist(o.spec));
  await o.placeBinary(binary);
  await (o.sign ?? adhocSign)(bundle, o.spec.bundleId);
  return binary;
}
