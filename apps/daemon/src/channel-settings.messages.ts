// 设置 → 消息通道（channel-settings.ts）给用户看的文字：检查结果、连接状态里的错误、设置页收到的错误。按用户现在选的语言写。
import { defineMessages } from "@pi-lead-child/protocol";

export const channelSettingsMessages = defineMessages({
  en: {
    cannotConnect: "Cannot connect",
    noChannel: "There is no such channel.",
    undeclaredSecret: "The request has a secret name that this channel does not declare.",
    checkLabel: "Check",
    timedOut: (label: string, seconds: number) => `${label} did not answer in ${seconds} seconds. The check is not complete.`,
    checkFailed: (error: string) => `The check failed: ${error}`,
    notStarted: "The message channels have not started yet.",
  },
  zh: {
    cannotConnect: "连不上",
    noChannel: "没有这个通道",
    undeclaredSecret: "请求里有这个通道没有声明的密钥名",
    checkLabel: "检查",
    timedOut: (label, seconds) => `${label} 没有在 ${seconds} 秒内回答，没有检查完。`,
    checkFailed: (error) => `检查出错：${error}`,
    notStarted: "消息通道还没有启动",
  },
});
