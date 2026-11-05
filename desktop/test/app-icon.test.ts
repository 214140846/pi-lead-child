// App 图标「π 水母」（用户 2026-11-05 选定，docs/design/app-icon/）。桌面 App 和 Companion 用到的文件是素材包 png/ 的副本：
// 重新生成素材以后忘了复制，这里会失败。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const KIT = join(ROOT, "docs", "design", "app-icon", "png");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the App icon", () => {
  it("is the icon kit's .icns in the desktop App", () => {
    const builder = parse(readFileSync(join(ROOT, "desktop", "desktop-builder.yml"), "utf8")) as { mac: { icon?: string } };
    expect(builder.mac.icon).toBe("assets/AppIcon.icns");
    expect(sha(join(ROOT, "desktop", builder.mac.icon!))).toBe(sha(join(KIT, "AppIcon.icns")));
  });

  it("is the icon kit's set in Companion, with the deep-sea background on Android, no Expo icon on iOS and the desktop bundle id", () => {
    for (const file of ["icon.png", "favicon.png", "android-icon-foreground.png", "android-icon-background.png", "android-icon-monochrome.png", "splash-icon.png"]) {
      expect(sha(join(ROOT, "apps", "companion", "assets", "images", file)), file).toBe(sha(join(KIT, file)));
    }
    const app = JSON.parse(readFileSync(join(ROOT, "apps", "companion", "app.json"), "utf8")) as {
      expo: { icon: string; ios: { icon?: string }; android: { package: string; adaptiveIcon: { backgroundColor: string } } };
    };
    // 安卓的包名和桌面 App 的 bundle id 一样（用户 2026-11-05）。
    const builder = parse(readFileSync(join(ROOT, "desktop", "desktop-builder.yml"), "utf8")) as { appId: string };
    expect(app.expo.android.package).toBe(builder.appId);
    expect(app.expo.icon).toBe("./assets/images/icon.png");
    expect(app.expo.ios.icon).toBeUndefined();
    expect(app.expo.android.adaptiveIcon.backgroundColor).toBe("#0E1630");
  });
});
