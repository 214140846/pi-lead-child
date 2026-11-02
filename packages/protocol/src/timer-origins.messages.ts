// 外部来源的定时器「谁要求的」（timer-origins.ts）。界面按用户的语言取；engine 写进数据库的文字暂时取 zh。
import { defineMessages } from "./i18n.ts";

export const timerOriginMessages = defineMessages({
  en: {
    requester: (sender: string, where: string) => `${sender} (${where})`,
    externalContent: (where: string) => `external content from ${where}`,
    // 后面接名词：「… timer」。
    askedBy: (requester: string) => `requested by ${requester}`,
    messageIn: (label: string) => `the message in "${label}"`,
    setAfterReading: (where: string) => `set after reading ${where}`,
  },
  zh: {
    requester: (sender, where) => `${sender}（${where}）`,
    externalContent: (where) => `${where} 的外部内容`,
    askedBy: (requester) => `${requester}要求的`,
    messageIn: (label) => `「${label}」里的消息`,
    setAfterReading: (where) => `读了${where}以后设的`,
  },
});
