// 状态栏上「Lead 忙时排着的外部消息」那一句（lead-queue.ts 的 leadQueueSummary）。
import { defineMessages } from "./i18n.ts";

export const leadQueueMessages = defineMessages({
  en: {
    summary: (count: number, senders: readonly string[]) =>
      `${count === 1 ? "1 message" : `${count} messages`} in the queue: ${senders.join(", ")}`,
  },
  zh: {
    summary: (count, senders) => `排队 ${count} 条：${senders.join("、")}`,
  },
});
