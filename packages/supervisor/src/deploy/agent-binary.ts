// 后台服务的程序（docs/desktop/macos-desktop-design.md 第 8.7 节，做法 1b）。运行包和开发机用同一个函数放：
//
//   <根>/bin/lead-agent                    Node，ad-hoc 重签，签名标识 com.bytezard.plc.agent，没有 Team ID
//   <根>/bin/Bytezard Lead -> lead-agent   软链接；launchd 的 supervisor plist 写它
//   <根>/bin/Bytezard Lead Memory -> lead-agent
//                                          软链接；supervisor 用它拉起 Hindsight 记忆服务（daemon 的 hindsightProgram），
//                                          ps 里看得出是记忆服务
//
// 运行包的根是运行包目录（scripts/desktop/lib/pack.ts）；开发机的根是数据目录，plc daemon install 每次重新复制
// 开发机的 Node（P0-8）。
//
// 为什么这样做（2026-11-04 实测，docs/desktop/p0-7-measurements.md）：
// - 直接用 Node 官方的签名，后台项目归到 Node 的开发者名下，「允许在后台」显示「Node.js Foundation」（实测 2）。
//   所以要重签，去掉 Node 的签名。
// - 重签以后，「允许在后台」和「App Background Activity」通知显示的是 plist 里 ProgramArguments[0] 那个路径的文件名；
//   是软链接时显示软链接自己的名字（实测 4 的 p7、p8 截图）。
// - 活动监视器的进程名跟着真实文件名走（实测 4 的 p7、p8），所以进程名还是 lead-agent（第 9 节决定 6）。
//   supervisor 用 process.execPath 拉起 daemon，Node 会解开软链接，daemon 也叫 lead-agent。
import { execFile } from "node:child_process";
import { lstatSync, mkdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 活动监视器里的进程名（第 9 节决定 6）。 */
export const AGENT_EXECUTABLE = "lead-agent";
/** 「允许在后台」里显示的名字：plist 写的软链接叫这个。 */
export const AGENT_LAUNCH_NAME = "Bytezard Lead";
export const AGENT_SIGN_ID = "com.bytezard.plc.agent";
/** Node 的真实位置（相对根）。 */
export const AGENT_BINARY = `bin/${AGENT_EXECUTABLE}`;
/** launchd 的 plist 写的路径（相对根）。 */
export const AGENT_LAUNCHER = `bin/${AGENT_LAUNCH_NAME}`;
/** Hindsight 记忆服务的程序名：supervisor 用这个软链接拉起它。 */
export const AGENT_MEMORY_LAUNCH_NAME = "Bytezard Lead Memory";
/** 拉起 Hindsight 用的路径（相对根）。 */
export const AGENT_MEMORY_LAUNCHER = `bin/${AGENT_MEMORY_LAUNCH_NAME}`;

/** 用 ad-hoc 签名重签，换掉 Node 原来的签名标识和 Team ID。参数用数组传，不经 shell。 */
export async function adhocSign(path: string, identifier: string): Promise<void> {
  await execFileAsync("codesign", ["--force", "--sign", "-", "--identifier", identifier, path]);
}

export type SignFn = (path: string, identifier: string) => Promise<void>;

/** 放到 bin/lead-agent 以前的临时位置（相对根）。签好名以后 rename 过去。 */
export const AGENT_STAGING = `bin/.${AGENT_EXECUTABLE}.partial`;

/**
 * 在 root 下放好后台服务的程序：placeBinary 把 Node 放到临时位置，重签，再 rename 成 bin/lead-agent，
 * 最后建软链接 bin/Bytezard Lead 和 bin/Bytezard Lead Memory。返回这三个路径。
 *
 * 可以重复运行：开发机的 plc daemon install 每次都重新放。rename 换的是目录项，正在用旧副本运行的进程不受影响
 * （直接覆盖正在运行的可执行文件，macOS 会因为签名对不上杀掉它）。
 */
export async function installAgentBinary(o: {
  root: string;
  placeBinary: (dest: string) => Promise<void> | void;
  sign?: SignFn;
}): Promise<{ binary: string; launcher: string; memoryLauncher: string }> {
  mkdirSync(join(o.root, "bin"), { recursive: true });
  const binary = join(o.root, AGENT_BINARY);
  const launcher = join(o.root, AGENT_LAUNCHER);
  const memoryLauncher = join(o.root, AGENT_MEMORY_LAUNCHER);
  const staged = join(o.root, AGENT_STAGING);
  rmSync(staged, { force: true });
  try {
    await o.placeBinary(staged);
    await (o.sign ?? adhocSign)(staged, AGENT_SIGN_ID);
    renameSync(staged, binary);
  } finally {
    rmSync(staged, { force: true });
  }
  // 相对路径：运行包整体搬到 versions/<版本>/ 以后、数据目录整体移走以后，链接照样有效。
  for (const link of [launcher, memoryLauncher]) {
    if (linksTo(link, AGENT_EXECUTABLE)) continue;
    rmSync(link, { force: true });
    symlinkSync(AGENT_EXECUTABLE, link);
  }
  return { binary, launcher, memoryLauncher };
}

function linksTo(path: string, target: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && readlinkSync(path) === target;
  } catch {
    return false;
  }
}
