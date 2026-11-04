// 回环自动配对怎样开（docs/desktop/macos-desktop-design.md 第 1.2 节，P0-4 返工）。
// 网关自己提供的 Companion 网页靠回环自动配对拿凭证。它只看远端地址和 Origin，而回环端口不分系统用户、Origin 能伪造，
// 所以同一台 Mac 上别的系统用户也能配上（docs/ARCHITECTURE.md）。以前只在开发机上打开（PLC_DEV=1 或显式的环境变量）。
//
// 桌面版的发布模式（运行包根目录有 release.json）缺省打开，但多一道口令：daemon 在数据目录写一个 0600 的口令文件，
// Bytezard Lead 的窗口（desktop/src/main.ts）读它，给发往网关的请求加上 SHELL_PAIRING_HEADER。别的系统用户读不到这个文件。
// 口令文件按 *.key 命名：执行器的沙箱禁读（core 的 sandbox-policy.ts），Lead 的凭证守卫也按扩展名拦住它。
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SHELL_PAIRING_KEY_FILE = "shell-pairing.key";
const KEY = /^[0-9a-f]{64}$/;

export type LoopbackAutoPairMode =
  /** 关着：回环配对的路由都不存在。 */
  | "off"
  /** 开发机：网关自己的网页和允许列表里的 origin 都能配对。 */
  | "loopback_page"
  /** 桌面版的发布模式：还要带口令。 */
  | "shell_only";

export function loopbackAutoPairMode(env: Record<string, string | undefined>, releaseMode: boolean): LoopbackAutoPairMode {
  const explicit = env.PLC_ALLOW_LOOPBACK_AUTO_PAIR?.trim().toLowerCase();
  if (explicit !== undefined) return ["1", "true", "yes", "on"].includes(explicit) ? "loopback_page" : "off";
  if (env.PLC_DEV === "1") return "loopback_page";
  return releaseMode ? "shell_only" : "off";
}

/** 读数据目录里的口令；没有或者内容不对时新建一个（0600）。 */
export function loadOrCreateShellPairingKey(dataDir: string): string {
  const path = join(dataDir, SHELL_PAIRING_KEY_FILE);
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (KEY.test(existing)) {
      chmodSync(path, 0o600);
      return existing;
    }
  } catch {
    // 没有：下面新建。
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}
