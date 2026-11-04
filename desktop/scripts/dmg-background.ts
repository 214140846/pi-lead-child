// 重画 dmg 的背景图（设计第 8.3 节第 2 条）。在仓库根运行：node --import tsx desktop/scripts/dmg-background.ts
// 它把 dmgBackgroundSpec() 写进 desktop/assets/dmg-background.json，再用 swift 画 1x 和 @2x 两张 PNG。
// 只在改了文字或布局时运行；发版的 workflow 不运行它，用的是提交进仓库的 PNG。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dmgBackgroundSpec } from "../src/dmg-background.js";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(desktop, "assets");
const require = createRequire(join(desktop, "..", "package.json"));
const jakarta = join(dirname(require.resolve("@expo-google-fonts/plus-jakarta-sans/package.json")), "500Medium", "PlusJakartaSans_500Medium.ttf");

mkdirSync(assets, { recursive: true });
const specPath = join(assets, "dmg-background.json");
writeFileSync(specPath, `${JSON.stringify(dmgBackgroundSpec(), null, 2)}\n`);
// swift 的模块缓存放在临时目录，不写进用户的 ~/Library/Caches。
const cache = mkdtempSync(join(tmpdir(), "dmg-background-"));
try {
  for (const [scale, file] of [[1, "dmg-background.png"], [2, "dmg-background@2x.png"]] as const) {
    execFileSync("swift", ["-module-cache-path", cache, join(desktop, "scripts", "dmg-background.swift"), specPath, String(scale), join(assets, file), jakarta], {
      stdio: "inherit",
      env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache },
    });
    console.log(`wrote desktop/assets/${file}`);
  }
} finally {
  rmSync(cache, { recursive: true, force: true });
}
