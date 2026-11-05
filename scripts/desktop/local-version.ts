// 本机打包用的版本号和构建号（lib/release.ts 的 localVersion、buildNumber）。--after 是最近发布的版本：
//   node --import tsx scripts/desktop/local-version.ts --after 1.1.0
// 输出 {"version":"1.1.1-local.202611050930","build":"202611050930"}。打包步骤见 docs/desktop/runtime-bundle.md。
import { buildNumber, localVersion, UsageError } from "./lib/release.js";

try {
  const index = process.argv.indexOf("--after");
  const after = index >= 0 ? process.argv[index + 1] : undefined;
  if (!after) throw new UsageError("缺少 --after <最近发布的版本>，例如 --after 1.1.0");
  const now = new Date();
  console.log(JSON.stringify({ version: localVersion(after, now), build: buildNumber(now) }));
} catch (error) {
  console.error(`[local-version] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
