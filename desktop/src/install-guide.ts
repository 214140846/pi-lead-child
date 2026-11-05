// 把安装说明（install-guide.messages.ts）写成 Markdown，放进 README 和 release 说明模板（设计第 8.3 节）。
// 每个文件里用一对注释标出生成的那一段：<!-- install-guide:<名字>:start --> 和 <!-- install-guide:<名字>:end -->。
// 改了文字以后在仓库根运行 node --import tsx desktop/scripts/install-guide.ts，测试检查文件和这里生成的一致。
import { installGuideMessages } from "./install-guide.messages.js";
import type { Locale } from "./locale.js";

/** dmg 附件的名字，和 desktop-builder.yml 的 dmg.artifactName 一致。只出 arm64（设计第 9 节决定 1）。 */
export function dmgFileName(version: string): string {
  return `bytezard-lead-${version}-arm64.dmg`;
}

/** 「已损坏」时去掉 quarantine 的命令。给高级用户，只放在 README，不放在下载页正文里（设计第 8.3 节）。 */
export const QUARANTINE_COMMAND = `xattr -dr com.apple.quarantine "/Applications/Bytezard Lead.app"`;

export interface GuideOptions {
  locale: Locale;
  /** 标题的级别：2 是 ##。 */
  headingLevel: number;
  /** 带不带「打不开怎么办」一节。下载页（release 说明）不带。 */
  troubleshooting: boolean;
}

export function installGuideMarkdown({ locale, headingLevel, troubleshooting }: GuideOptions): string {
  const text = installGuideMessages(locale);
  const hashes = "#".repeat(headingLevel);
  const steps = [
    text.steps.download(dmgFileName(text.versionPlaceholder)),
    text.steps.drag,
    text.steps.open,
    text.steps.allow,
    text.steps.confirm,
  ];
  const lines = [
    `${hashes} ${text.heading}`,
    "",
    text.requirement,
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    text.onlyOnce,
  ];
  if (troubleshooting) {
    lines.push("", `${hashes}# ${text.damaged.heading}`, "", text.damaged.body, "", "```sh", QUARANTINE_COMMAND, "```");
  }
  return lines.join("\n");
}

export interface GuideBlock extends GuideOptions {
  name: string;
}

/** 每个文件里生成的段落。路径相对仓库根。 */
export const GUIDE_TARGETS: ReadonlyArray<{ file: string; blocks: readonly GuideBlock[] }> = [
  { file: "README.md", blocks: [{ name: "en", locale: "en", headingLevel: 2, troubleshooting: true }] },
  { file: "README.zh-CN.md", blocks: [{ name: "zh", locale: "zh", headingLevel: 2, troubleshooting: true }] },
  {
    file: "docs/desktop/release-notes-template.md",
    blocks: [
      { name: "en", locale: "en", headingLevel: 2, troubleshooting: false },
      { name: "zh", locale: "zh", headingLevel: 2, troubleshooting: false },
    ],
  },
];

/** 把 text 里每个标出的段落换成生成的内容。缺少标记时抛错，不悄悄跳过。 */
export function syncInstallGuide(text: string, blocks: readonly GuideBlock[]): string {
  let out = text;
  for (const block of blocks) {
    const start = `<!-- install-guide:${block.name}:start -->`;
    const end = `<!-- install-guide:${block.name}:end -->`;
    const from = out.indexOf(start);
    const to = out.indexOf(end);
    if (from < 0 || to < from) throw new Error(`没有找到 ${start} 和 ${end} 这一对标记`);
    out = `${out.slice(0, from + start.length)}\n${installGuideMarkdown(block)}\n${out.slice(to)}`;
  }
  return out;
}
