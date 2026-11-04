// release.json 的 sourceTree：构建 dist 用的 git tree 哈希（设计文档第 2.3 节）。
// 按 dist 里的构建记录（build-info.json）找 commit：有没提交改动的构建不能发版。
import type { BuildProvenance } from "@pi-lead-child/supervisor";

export function sourceTreeOf(provenance: BuildProvenance | null, git: (args: string[]) => string): string {
  if (!provenance) throw new Error("apps/daemon/dist 里没有 build-info.json：无法确认 dist 来自哪个 commit。先运行 npm run build");
  if (provenance.dirty) {
    throw new Error(`dist 是在有未提交改动的源码上构建的（${provenance.dirtyFiles.join("、") || "未列出文件"}），不能打包发版。提交以后重新运行 npm run build`);
  }
  const tree = git(["rev-parse", `${provenance.commit}^{tree}`]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`git rev-parse ${provenance.commit}^{tree} 的输出不是 tree 哈希：${tree}`);
  return tree;
}
