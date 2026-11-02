// 「Lead 动态」里给人看的文字（2026-11-01 多语言）：事件的一句话、建议卡的按钮。
// 读的时候现算，按读的时候用户选的语言（store 的 getLocale）。
import { defineMessages } from "@pi-lead-child/protocol";

export const leadActivityMessages = defineMessages({
  en: {
    op: (change: string) =>
      ({ create: "added", update: "changed", disable: "turned off", enable: "turned on", rollback: "rolled back" } as Record<string, string>)[change] ?? "changed",
    // 不认识的档位是空字符串。
    tier: (tier: string, lead: string) => ({
      conservative: `${lead} made it safer, so it took effect directly`,
      permissive: `you approved the change of ${lead}`,
      user: "you changed it",
    } as Record<string, string>)[tier] ?? "",
    // tier 是空字符串时不写。
    standingOrder: (title: string, op: string, versions: string, tier: string, reason: string | null, details: string) =>
      `Standing order "${title}" ${op}${versions ? ` ${versions}` : ""}${tier ? ` (${tier})` : ""}`
      + `${reason ? `. Reason: ${reason}` : ""}${details ? `. ${details}` : ""}`,
    reminderFired: (title: string) => `Reminder "${title}" is due`,
    followUpFired: (note: string | null) => `Follow-up is due${note ? `: ${note}` : ""}`,
    unknownKind: "unknown kind",
    eventRejected: (kind: string, error: string) => `An event was not written (${kind}): ${error}`,
    snooze: "Later",
    dismiss: "Do not show again",
  },
  zh: {
    op: (change) => ({ create: "新增", update: "修改", disable: "停用", enable: "启用", rollback: "回滚" } as Record<string, string>)[change] ?? "修改",
    tier: (tier, lead) => ({
      conservative: `${lead} 改得更保守，直接生效`,
      permissive: `你批准了 ${lead} 的修改`,
      user: "你改的",
    } as Record<string, string>)[tier] ?? "",
    standingOrder: (title, op, versions, tier, reason, details) =>
      `常设指令「${title}」${op}${versions ? ` ${versions}` : ""}${tier ? `（${tier}）` : ""}`
      + `${reason ? `。原因：${reason}` : ""}${details ? `。${details}` : ""}`,
    reminderFired: (title) => `提醒「${title}」到点`,
    followUpFired: (note) => `跟进到点${note ? `：${note}` : ""}`,
    unknownKind: "未知类型",
    eventRejected: (kind, error) => `一条事件没有写成（${kind}）：${error}`,
    snooze: "以后再说",
    dismiss: "不用再提",
  },
});
