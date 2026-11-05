// dmg 的打包配置（设计第 8.2、8.3、8.5 节，P0-5 的验收）：ad-hoc 签名、不开 Hardened Runtime、不重编原生模块；
// 附件名是 bytezard-lead-<版本>-arm64.dmg；窗口和图标位置和背景图的布局一致；背景图有 1x 和 @2x，并且是按现在的文字画的。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DMG_LAYOUT, dmgBackgroundSpec } from "../src/dmg-background.js";
import { dmgFileName } from "../src/install-guide.js";

const DESKTOP = join(import.meta.dirname, "..");
const builder = parse(readFileSync(join(DESKTOP, "desktop-builder.yml"), "utf8")) as {
  npmRebuild: boolean;
  mac: { identity: string; hardenedRuntime: boolean; notarize: boolean; target: Array<{ target: string; arch: string[] }> };
  dmg: {
    artifactName: string; title: string; background: string; iconSize: number;
    window: { width: number; height: number };
    contents: Array<{ x: number; y: number; type: string; path?: string }>;
  };
};

// PNG 的 IHDR 在文件头 8 字节之后：宽和高各 4 字节，大端。
function pngSize(file: string): { width: number; height: number } {
  const data = readFileSync(file);
  expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(data.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("dmg packaging", () => {
  it("signs ad-hoc without Hardened Runtime or notarization, and does not rebuild native modules", () => {
    expect(builder.mac.identity).toBe("-");
    expect(builder.mac.hardenedRuntime).toBe(false);
    expect(builder.mac.notarize).toBe(false);
    expect(builder.npmRebuild).toBe(false);
    expect(builder.mac.target).toEqual([{ target: "dmg", arch: ["arm64"] }]);
  });

  it("names the dmg bytezard-lead-<version>-arm64.dmg", () => {
    // electron-builder 把 ${version} 换成 package.json 的版本，${ext} 换成 dmg。
    const name = builder.dmg.artifactName.replace("${version}", "1.3.0").replace("${ext}", "dmg");
    expect(name).toBe(dmgFileName("1.3.0"));
    expect(builder.dmg.title).toBe("Bytezard Lead");
  });

  it("places the window and the icons where the background expects them", () => {
    expect(builder.dmg.window).toEqual({ width: DMG_LAYOUT.width, height: DMG_LAYOUT.height });
    expect(builder.dmg.iconSize).toBe(DMG_LAYOUT.iconSize);
    expect(builder.dmg.contents).toEqual([
      { x: DMG_LAYOUT.app.x, y: DMG_LAYOUT.app.y, type: "file" },
      { x: DMG_LAYOUT.applications.x, y: DMG_LAYOUT.applications.y, type: "link", path: "/Applications" },
    ]);
  });

  it("ships a 1x and a @2x background that fit the window", () => {
    expect(builder.dmg.background).toBe("assets/dmg-background.png");
    expect(pngSize(join(DESKTOP, "assets", "dmg-background.png"))).toEqual({ width: DMG_LAYOUT.width, height: DMG_LAYOUT.height });
    expect(pngSize(join(DESKTOP, "assets", "dmg-background@2x.png"))).toEqual({ width: DMG_LAYOUT.width * 2, height: DMG_LAYOUT.height * 2 });
  });

  it("has a background drawn from the current text and layout", () => {
    // 不一致时，在仓库根运行 node --import tsx desktop/scripts/dmg-background.ts 重画。
    const drawn = JSON.parse(readFileSync(join(DESKTOP, "assets", "dmg-background.json"), "utf8"));
    expect(drawn).toEqual(dmgBackgroundSpec());
  });

  it("keeps the arrow between the two icons and the text below their labels", () => {
    const spec = dmgBackgroundSpec();
    const half = DMG_LAYOUT.iconSize / 2;
    expect(spec.arrow.fromX).toBeGreaterThan(DMG_LAYOUT.app.x + half);
    expect(spec.arrow.toX).toBeLessThan(DMG_LAYOUT.applications.x - half);
    // Finder 把图标名画在图标下面，大约占 20。
    for (const line of spec.lines) expect(line.y).toBeGreaterThan(DMG_LAYOUT.app.y + half + 40);
    for (const line of spec.lines) expect(line.y).toBeLessThan(DMG_LAYOUT.height);
  });
});
