// 时间线里给人看的文字（2026-11-01 多语言）：风险提示和例行任务的执行结果。读的时候现算，按用户现在选的语言。
import { defineMessages } from "@pi-lead-child/protocol";

export const timelineMessages = defineMessages({
  en: {
    ticketBlocked: "The ticket is still blocked",
    ticketNeedsUser: "The ticket waits for you",
    notStarted: "Not started yet",
    fireFailed: (error: string | null) => `Failed${error ? `: ${error}` : ""}`,
    fireDone: (itemId: number | null) => (itemId ? `Done · created #${itemId}` : "Done"),
    fireRunning: "Running",
  },
  zh: {
    ticketBlocked: "工单还阻塞",
    ticketNeedsUser: "工单在等你",
    notStarted: "还没开始",
    fireFailed: (error) => `失败${error ? `：${error}` : ""}`,
    fireDone: (itemId) => (itemId ? `已执行 · 生成 #${itemId}` : "已执行"),
    fireRunning: "正在执行",
  },
});
