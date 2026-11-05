// dmg 窗口的布局和背景图的内容（设计第 8.3 节第 2 条）。desktop-builder.yml 的 dmg.window 和 dmg.contents 用同样的数字，
// 测试核对两边一致。背景图是一张图，所以中英文两行都画上；文字来自 install-guide.messages.ts，和 README 的步骤同一份。
// 颜色和字体按 docs/design/themes/default.md：白底（surface）、次要文字（text-strong）、弱化的箭头（text-muted）、
// 分隔线（border-soft），英文用 Plus Jakarta Sans，中文用系统的苹方。
// 改了这里以后在仓库根运行 node --import tsx desktop/scripts/dmg-background.ts，重画 desktop/assets/ 里的 PNG。
import { installGuideMessages } from "./install-guide.messages.js";

/** 坐标都以 1x 计，原点在左上角。图标的 x、y 是图标中心（electron-builder 的 dmg.contents 也这样算）。 */
export const DMG_LAYOUT = {
  width: 540,
  height: 380,
  iconSize: 96,
  app: { x: 140, y: 150 },
  applications: { x: 400, y: 150 },
} as const;

export interface DmgBackgroundSpec {
  width: number;
  height: number;
  background: string;
  arrow: { fromX: number; toX: number; y: number; color: string; lineWidth: number; head: number };
  divider: { y: number; inset: number; color: string };
  lines: Array<{ text: string; font: "Plus Jakarta Sans" | "PingFang SC"; weight: "medium" | "regular"; size: number; y: number; color: string }>;
}

/** 背景图要画的东西。渲染脚本把它写进 desktop/assets/dmg-background.json，测试按它判断 PNG 是不是最新的。 */
export function dmgBackgroundSpec(): DmgBackgroundSpec {
  const { app, applications, iconSize, width, height } = DMG_LAYOUT;
  // 箭头在两个图标之间，两头各留 24 的空。
  const gap = iconSize / 2 + 24;
  return {
    width,
    height,
    background: "#FFFFFF",
    arrow: { fromX: app.x + gap, toX: applications.x - gap, y: app.y, color: "#98A2B3", lineWidth: 2, head: 8 },
    // Finder 把图标的名字画在图标下面约 20 的位置，分隔线在名字下面。
    divider: { y: 268, inset: 40, color: "#EEF0F4" },
    lines: [
      { text: installGuideMessages("en").dmgBackground, font: "Plus Jakarta Sans", weight: "medium", size: 13, y: 300, color: "#475467" },
      { text: installGuideMessages("zh").dmgBackground, font: "PingFang SC", weight: "regular", size: 13, y: 326, color: "#475467" },
    ],
  };
}
