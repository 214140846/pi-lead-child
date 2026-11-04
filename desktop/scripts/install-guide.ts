// 按 desktop/src/install-guide.messages.ts 重写 README、README.zh-CN 和 release 说明模板里的安装说明（设计第 8.3 节）。
// 在仓库根运行：node --import tsx desktop/scripts/install-guide.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_TARGETS, syncInstallGuide } from "../src/install-guide.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const target of GUIDE_TARGETS) {
  const path = join(repoRoot, target.file);
  const before = readFileSync(path, "utf8");
  const after = syncInstallGuide(before, target.blocks);
  if (after !== before) writeFileSync(path, after);
  console.log(`${after === before ? "unchanged" : "updated"} ${target.file}`);
}
