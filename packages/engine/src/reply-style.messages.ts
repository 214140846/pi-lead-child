// 改代回复风格时给用户看的文字（reply-style.ts）：设置页的错误、主人操作的摘要。按写入时用户选的语言写。
import { defineMessages } from "@pi-lead-child/protocol";

export const replyStyleMessages = defineMessages({
  en: {
    invalidInput: "The input must be { mode: replace or append, text, label? }.",
    target: "Reply style",
    cleared: "Cleared the reply style",
    appended: "Added a section to the end of the reply style",
    changed: "Changed the reply style",
    written: "Wrote the reply style",
  },
  zh: {
    invalidInput: "input 是 { mode: replace 或 append, text, label? }",
    target: "代回复风格",
    cleared: "清空了代回复风格",
    appended: "在代回复风格后面追加了一段",
    changed: "改了代回复风格",
    written: "写了代回复风格",
  },
});
