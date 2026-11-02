// 顶栏的状态点读的原因（lead-health.ts）。读的时候按用户现在选的语言算。
import { defineMessages } from "@pi-lead-child/protocol";

export const leadHealthMessages = defineMessages({
  en: {
    compactionFailed: (name: string) => `The context compaction of ${name} failed`,
  },
  zh: {
    compactionFailed: (name) => `${name} 的上下文压缩失败`,
  },
});
