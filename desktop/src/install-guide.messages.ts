// 安装说明的文字（docs/desktop/macos-desktop-design.md 第 8.3 节）。README、release 说明模板和 dmg 背景图都从这里来，
// 所以三处的步骤和按钮名一致。系统设置的路径和按钮名照 Apple 支持文章 102445（https://support.apple.com/en-us/102445）：
// 先试着打开 App，再到「系统设置 → 隐私与安全性」点「仍要打开」，警告再出现时点「打开」。
// 这些文字写进 Markdown，所以带 ** 和反引号。对外只用产品名 Bytezard Lead。
import { defineMessages } from "./locale.js";

const en = {
  systemSettings: "System Settings",
  privacySecurity: "Privacy & Security",
  openAnyway: "Open Anyway",
  open: "Open",
  done: "Done",
  applications: "Applications",
};

const zh: typeof en = {
  systemSettings: "系统设置",
  privacySecurity: "隐私与安全性",
  openAnyway: "仍要打开",
  open: "打开",
  done: "完成",
  applications: "应用程序",
};

export const installGuideMessages = defineMessages({
  en: {
    terms: en,
    versionPlaceholder: "<version>",
    heading: "Install Bytezard Lead",
    requirement: "Bytezard Lead needs a Mac with Apple silicon.",
    steps: {
      download: (file: string) => `Download \`${file}\`.`,
      drag: `Open the dmg and drag **Bytezard Lead** to **${en.applications}**.`,
      open: `Open Bytezard Lead. macOS says it cannot verify the developer. Click **${en.done}**.`,
      allow: `Open **${en.systemSettings} → ${en.privacySecurity}**. Scroll down and click **${en.openAnyway}**.`,
      confirm: `When the warning shows again, click **${en.open}**.`,
    },
    onlyOnce: "Bytezard Lead is not signed with an Apple certificate yet. You do these steps only once.",
    damaged: {
      heading: "If Bytezard Lead does not open",
      body: "If macOS says that Bytezard Lead is damaged, run this command in Terminal. Then open Bytezard Lead again.",
    },
    dmgBackground: `First open: ${en.systemSettings} → ${en.privacySecurity} → ${en.openAnyway}`,
  },
  zh: {
    terms: zh,
    versionPlaceholder: "<版本>",
    heading: "安装 Bytezard Lead",
    requirement: "Bytezard Lead 需要 Apple 芯片的 Mac。",
    steps: {
      download: (file) => `下载 \`${file}\`。`,
      drag: `打开 dmg，把 **Bytezard Lead** 拖到「${zh.applications}」。`,
      open: `打开 Bytezard Lead。macOS 提示无法验证开发者，点「${zh.done}」。`,
      allow: `打开「${zh.systemSettings} → ${zh.privacySecurity}」，向下滚动，点「${zh.openAnyway}」。`,
      confirm: `警告再次出现时，点「${zh.open}」。`,
    },
    onlyOnce: "Bytezard Lead 还没有 Apple 证书签名。这几步只需要做一次。",
    damaged: {
      heading: "打不开怎么办",
      body: "如果 macOS 提示 Bytezard Lead「已损坏」，在终端运行下面的命令，然后重新打开 Bytezard Lead。",
    },
    dmgBackground: `首次打开：${zh.systemSettings} → ${zh.privacySecurity} → ${zh.openAnyway}`,
  },
});
