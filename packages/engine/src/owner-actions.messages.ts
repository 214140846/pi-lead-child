// engine 的操作层构造的主人操作摘要（2026-11-01 多语言）：Lead 代你做的前缀、放宽权限、常驻偏好。
// 写进事件 payload，按写入时用户选的语言（store 的 getLocale）写；以后换语言，旧记录不重写。
import { defineMessages } from "@pi-lead-child/protocol";

export type CoreMemoryOwnerVerb = "updated" | "deleted" | "undone";

export const engineOwnerActionMessages = defineMessages({
  en: {
    byLead: (lead: string, summary: string) => `${lead} on your behalf: ${summary}`,
    runGrantTarget: (runId: number, reminder: boolean, itemId: number) => `Run #${runId} (${reminder ? "reminder" : "ticket"} #${itemId})`,
    runGrantWidened: (runId: number, added: string[]) => `Widened the permissions of run #${runId}: ${added.join("; ")}`,
    coreMemoryTarget: (title: string) => `Core preference "${title}"`,
    coreMemory: (verb: CoreMemoryOwnerVerb, title: string) => {
      switch (verb) {
        case "updated": return `Changed core preference "${title}"`;
        case "deleted": return `Deleted core preference "${title}"`;
        case "undone": return `Undid a change: core preference "${title}"`;
      }
    },
  },
  zh: {
    byLead: (lead, summary) => `${lead} 代你${summary}`,
    runGrantTarget: (runId, reminder, itemId) => `Run #${runId}（${reminder ? "提醒" : "工单"} #${itemId}）`,
    runGrantWidened: (runId, added) => `放宽了 Run #${runId} 的权限：${added.join("；")}`,
    coreMemoryTarget: (title) => `常驻偏好「${title}」`,
    coreMemory: (verb, title) => {
      switch (verb) {
        case "updated": return `改了常驻偏好「${title}」`;
        case "deleted": return `删了常驻偏好「${title}」`;
        case "undone": return `撤销了一次改动：常驻偏好「${title}」`;
      }
    },
  },
});
