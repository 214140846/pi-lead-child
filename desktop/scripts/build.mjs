// 构建壳：主进程和 preload 打成 CommonJS（Electron 的 sandbox preload 只能 require electron），安装页打成一个浏览器脚本。
// 输出到 desktop/dist/，electron-builder 只打包 dist/ 和 package.json。
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "renderer"), { recursive: true });

const node = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" };
await build({ ...node, entryPoints: [join(root, "src", "index.ts")], outfile: join(dist, "main.cjs") });
await build({ ...node, entryPoints: [join(root, "src", "preload.ts")], outfile: join(dist, "preload.cjs") });
await build({
  bundle: true, platform: "browser", format: "iife", target: "chrome130", logLevel: "warning",
  entryPoints: [join(root, "src", "renderer", "install.ts")], outfile: join(dist, "renderer", "install.js"),
});
for (const file of ["install.html", "install.css"]) {
  await copyFile(join(root, "src", "renderer", file), join(dist, "renderer", file));
}
