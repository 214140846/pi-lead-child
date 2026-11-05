// 把 dmg 记进 manifest.json：大小和 SHA-256。App 的一键更新按它下载和校验 dmg（desktop/src/updater.ts）。
// electron-builder 打出 dmg 以后、上传以前运行（.github/workflows/release-macos.yml）：
//   node --import tsx scripts/desktop/add-dmg.ts --manifest out/manifest.json --dmg out/desktop/bytezard-lead-<版本>-arm64.dmg
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { sha256File, withDmg, type UpdateManifest } from "./lib/release.js";

const USAGE = "用法：node --import tsx scripts/desktop/add-dmg.ts --manifest <manifest.json> --dmg <dmg 文件>";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    console.error(`[add-dmg] 缺少 ${name}\n${USAGE}`);
    process.exit(2);
  }
  return value;
}

try {
  const manifestPath = argument("--manifest");
  const dmgPath = argument("--dmg");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as UpdateManifest;
  const next = withDmg(manifest, { file: basename(dmgPath), size: statSync(dmgPath).size, sha256: await sha256File(dmgPath) });
  const temp = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temp, manifestPath);
  console.log(JSON.stringify({ ok: true, manifest: manifestPath, dmg: next.dmg }));
} catch (error) {
  console.error(`[add-dmg] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
