// 桌面通知的授权检查（docs/desktop/macos-desktop-design.md 第 8.6 节，#232）。
//
// Electron 45 在 macOS 上用 UNUserNotificationCenter 发通知。第一次创建通知对象（Notification.isSupported() 也算）时，
// 它调 requestAuthorization 申请授权，但不读授权状态，也不把结果告诉 JS。授权还没定时，addNotificationRequest 照样成功，
// Electron 报 show，系统却不显示（P0-7 实测 1 第一轮、实测 5）。所以壳不能从 show 判断通知有没有显示。
//
// 壳的做法：用户亲眼确认测试通知显示了（点「看到了」或者点了那条通知），才算这台 Mac 上的 App 能发通知，记在 notification-check.json。
// 确认以前壳不订阅，daemon 照旧用 osascript 发，通知不丢。确认只按 App 记，不按构建：实测 6（2026-11-04）换了构建、
// 签名摘要变了以后，系统的授权还在，通知照常显示。所以更新 App 以后不再问（用户 2026-11-05）。
// Electron 放弃一条通知（onGiveUp）时忘掉确认，下次打开再问。记录里仍写着确认时的构建，诊断用。
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** electron-builder.yml 的 appId。系统设置的通知页按它找到 App。 */
export const APP_BUNDLE_ID = "com.bytezard.plc";
const SETTINGS_URL = "x-apple.systempreferences:com.apple.Notifications-Settings.extension";

/** 「系统设置 → 通知」的地址。开发时（electron .）App 是 Electron.app，不带 id，只打开通知页。 */
export function notificationSettingsUrl(packaged: boolean): string {
  return packaged ? `${SETTINGS_URL}?id=${APP_BUNDLE_ID}` : SETTINGS_URL;
}

/**
 * 这一份 App 的标识。打包后是 Contents/_CodeSignature/CodeResources 的 sha256：签名封住的资源一变，它就变。
 * 开发时、或者读不到签名文件时，用版本号。
 */
export function appBuildIdentity(o: { packaged: boolean; execPath: string; version: string; read?: (path: string) => Buffer }): string {
  if (o.packaged) {
    // execPath 是 <App>.app/Contents/MacOS/<可执行文件>。
    const contents = dirname(dirname(o.execPath));
    try {
      const sealed = (o.read ?? readFileSync)(join(contents, "_CodeSignature", "CodeResources"));
      return `sig:${createHash("sha256").update(sealed).digest("hex")}`;
    } catch {
      // 落到版本号。
    }
  }
  return `version:${o.version}`;
}

/** 用户确认过通知能显示。文件不在、坏了时为 false。确认时是哪个构建不影响（见文件头）。 */
export function isNotificationConfirmed(file: string): boolean {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { confirmedBuild?: unknown };
    return typeof value.confirmedBuild === "string";
  } catch {
    return false;
  }
}

export function rememberNotificationConfirmed(file: string, build: string, now: Date = new Date()): void {
  writeFileSync(file, `${JSON.stringify({ confirmedBuild: build, confirmedAt: now.toISOString() })}\n`, { mode: 0o600 });
}

/** Electron 发失败了：下次打开 App 时重新检查。 */
export function forgetNotificationConfirmed(file: string): void {
  rmSync(file, { force: true });
}
