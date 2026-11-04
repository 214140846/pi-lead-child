// 运行包的冒烟测试（设计文档 P0-2）。发版流程在上传附件之前跑它，失败时不上传：
//   node --import tsx scripts/desktop/smoke-runtime.ts out/runtime
// 它在临时的数据目录和 HOME 里启动运行包的 supervisor，不碰这台机器上已有的服务。细节见 lib/smoke.ts。
import { resolve } from "node:path";
import { smokeRuntime } from "./lib/smoke.js";

const [runtimeDir, ...rest] = process.argv.slice(2);
if (!runtimeDir || rest.length) {
  console.error("用法：node --import tsx scripts/desktop/smoke-runtime.ts <运行包目录，例如 out/runtime>");
  process.exit(2);
}
try {
  const result = await smokeRuntime({ runtimeDir: resolve(runtimeDir), log: (line) => console.log(`[smoke-runtime] ${line}`) });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`[smoke-runtime] 冒烟失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
