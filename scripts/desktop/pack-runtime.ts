// 打包桌面版的 arm64 运行包（设计文档 docs/desktop/macos-desktop-design.md 第 2 节、P0-2）。
// 先在仓库根运行 npm run build && npm run build:web，再运行：
//   node --import tsx scripts/desktop/pack-runtime.ts --arch arm64 --version 1.3.0 --repository <owner>/<repo>
// 产出 out/runtime/、out/bytezard-lead-runtime-<版本>-arm64.tar.gz 和 out/manifest.json。用法见 docs/desktop/runtime-bundle.md。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { distDir, projectRoot } from "@pi-lead-child/core";
import { LATEST_SCHEMA_VERSION } from "@pi-lead-child/store";
import { readBuildProvenance } from "@pi-lead-child/supervisor";
import { DAEMON_EXTERNALS } from "../../apps/daemon/scripts/externals.js";
import { packRuntime } from "./lib/pack.js";
import { PACK_USAGE, parseNodeVersionFile, parsePackArgs, UsageError } from "./lib/release.js";
import { sourceTreeOf } from "./lib/source.js";

try {
  const args = parsePackArgs(process.argv.slice(2));
  const root = projectRoot();
  const result = await packRuntime({
    repoRoot: root,
    outDir: args.out ? resolve(args.out) : join(root, "out"),
    version: args.version,
    repository: args.repository,
    nodeVersion: parseNodeVersionFile(readFileSync(join(root, "desktop", "node-version"), "utf8")),
    schemaVersion: LATEST_SCHEMA_VERSION,
    sourceTree: sourceTreeOf(readBuildProvenance(distDir()), (gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" })),
    externals: DAEMON_EXTERNALS,
    nodeDistUrl: args.nodeDistUrl ?? undefined,
    log: (line) => console.log(`[pack-runtime] ${line}`),
  });
  console.log(JSON.stringify({
    ok: true, runtime: result.runtimeDir, archive: result.archive, manifest: result.manifestPath,
    version: result.release.version, node: result.release.node, schemaVersion: result.release.schemaVersion,
  }));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`[pack-runtime] ${error.message}\n${PACK_USAGE}`);
    process.exit(2);
  }
  console.error(`[pack-runtime] 打包失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
