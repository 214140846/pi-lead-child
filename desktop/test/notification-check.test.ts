// 桌面通知的授权检查（设计第 8.6 节，#232）：记下用户确认过能显示通知的那一份 App。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  APP_BUNDLE_ID, appBuildIdentity, forgetNotificationConfirmed, isNotificationConfirmed, notificationSettingsUrl,
  rememberNotificationConfirmed,
} from "../src/notification-check.js";

const DESKTOP = join(import.meta.dirname, "..");

function fakeApp(codeResources: string | null) {
  const contents = join(tempDir("plc-desktop-app-"), "Bytezard Lead.app", "Contents");
  mkdirSync(join(contents, "MacOS"), { recursive: true });
  if (codeResources !== null) {
    mkdirSync(join(contents, "_CodeSignature"), { recursive: true });
    writeFileSync(join(contents, "_CodeSignature", "CodeResources"), codeResources);
  }
  return join(contents, "MacOS", "Bytezard Lead");
}

describe("the notification check", () => {
  it("tells builds apart by the sealed resources of the signature", () => {
    const a = appBuildIdentity({ packaged: true, execPath: fakeApp("<plist>a</plist>"), version: "1.3.0" });
    const again = appBuildIdentity({ packaged: true, execPath: fakeApp("<plist>a</plist>"), version: "1.3.0" });
    const b = appBuildIdentity({ packaged: true, execPath: fakeApp("<plist>b</plist>"), version: "1.3.0" });
    expect(a).toMatch(/^sig:[0-9a-f]{64}$/);
    expect(again).toBe(a);
    expect(b).not.toBe(a);
  });

  it("uses the version when the App is not packaged or has no signature file", () => {
    expect(appBuildIdentity({ packaged: false, execPath: fakeApp("<plist>a</plist>"), version: "1.3.0" })).toBe("version:1.3.0");
    expect(appBuildIdentity({ packaged: true, execPath: fakeApp(null), version: "1.3.0" })).toBe("version:1.3.0");
  });

  // 实测 6：换了构建授权还在，所以确认对以后的构建也算（用户 2026-11-05）。记录里写着确认时的构建，诊断用。
  it("remembers the confirmation for every later build, and forgets it", () => {
    const file = join(tempDir("plc-desktop-check-"), "notification-check.json");
    expect(isNotificationConfirmed(file)).toBe(false);
    rememberNotificationConfirmed(file, "sig:a", new Date("2026-11-04T08:00:00.000Z"));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ confirmedBuild: "sig:a", confirmedAt: "2026-11-04T08:00:00.000Z" });
    expect(isNotificationConfirmed(file)).toBe(true);
    forgetNotificationConfirmed(file);
    expect(isNotificationConfirmed(file)).toBe(false);
    forgetNotificationConfirmed(file);
    writeFileSync(file, "not json");
    expect(isNotificationConfirmed(file)).toBe(false);
  });

  it("opens the notification settings of this App, with the bundle id from the packaging config", () => {
    const builder = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
    expect(builder).toMatch(new RegExp(`^appId: ${APP_BUNDLE_ID.replaceAll(".", "\\.")}$`, "m"));
    expect(notificationSettingsUrl(true)).toBe("x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.bytezard.plc");
    expect(notificationSettingsUrl(false)).toBe("x-apple.systempreferences:com.apple.Notifications-Settings.extension");
  });
});
