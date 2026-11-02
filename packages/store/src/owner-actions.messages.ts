// 主人操作的构造函数给人看的文字（2026-11-01 多语言）：对象的名字和一句话的摘要。
// 写进事件 payload，按写入时用户选的语言（getLocale）写；以后换语言，旧记录不重写。
import { defineMessages } from "@pi-lead-child/protocol";

export const ownerActionTextMessages = defineMessages({
  en: {
    item: (reminder: boolean, id: number, title: string) => `${reminder ? "Reminder" : "Ticket"} #${id} "${title}"`,
    ticketFallback: (id: number) => `Ticket #${id}`,
    itemAction: (action: string, label: string) => {
      switch (action) {
        case "ticket.confirm": return `Confirmed ${label}`;
        case "ticket.complete": return `Accepted ${label}`;
        case "ticket.stop": return `Stopped ${label}`;
        case "ticket.cancel": return `Cancelled ${label}`;
        default: return `${action} ${label}`;
      }
    },
    delegationRevoked: (label: string) => `Withdrew the delegated acceptance of ${label}`,
    delegationGranted: (label: string, lead: string, reworkStarted: boolean) =>
      `Delegated the acceptance of ${label} to ${lead}${reworkStarted ? ", and started rework" : ""}`,
    workspaceTarget: (id: number, of: string) => `Workspace #${id} (${of})`,
    workspaceSummary: (action: "release" | "cleanup", id: number, of: string) =>
      `${action === "release" ? "Released" : "Cleaned up"} workspace #${id} (${of})`,
    runTarget: (id: number, of: string) => `Run #${id} (${of})`,
    runSummary: (action: "pause" | "stop", id: number, of: string) => `${action === "pause" ? "Paused" : "Stopped"} run #${id} (${of})`,
    approvalTarget: (id: number, tool: string) => `Approval #${id} (${tool})`,
    approvalSummary: (decision: string, id: number, action: string, of: string | null) => {
      const verb = decision === "reject" ? "Rejected" : "Approved";
      const scope = decision === "approve_session" ? " (no new approval for this action in this ticket)" : "";
      return `${verb} approval #${id}${scope}: ${action}${of ? ` (${of})` : ""}`;
    },
    decisionTarget: (id: number) => `Decision request #${id}`,
    decisionSummary: (dismissed: boolean, id: number, prompt: string, of: string | null) =>
      `${dismissed ? "Dismissed" : "Answered"} decision request #${id}: ${prompt}${of ? ` (${of})` : ""}`,
  },
  zh: {
    item: (reminder, id, title) => `${reminder ? "提醒" : "工单"} #${id}「${title}」`,
    ticketFallback: (id) => `工单 #${id}`,
    itemAction: (action, label) => {
      switch (action) {
        case "ticket.confirm": return `确认了${label}`;
        case "ticket.complete": return `验收了${label}`;
        case "ticket.stop": return `停止了${label}`;
        case "ticket.cancel": return `取消了${label}`;
        default: return `${action} ${label}`;
      }
    },
    delegationRevoked: (label) => `撤回了${label}的委托验收`,
    delegationGranted: (label, lead, reworkStarted) => `把${label}委托给 ${lead} 验收${reworkStarted ? "，并开始返工" : ""}`,
    workspaceTarget: (id, of) => `工作区 #${id}（${of}）`,
    workspaceSummary: (action, id, of) => `${action === "release" ? "释放" : "清理"}了工作区 #${id}（${of}）`,
    runTarget: (id, of) => `Run #${id}（${of}）`,
    runSummary: (action, id, of) => `${action === "pause" ? "暂停" : "停止"}了 Run #${id}（${of}）`,
    approvalTarget: (id, tool) => `审批 #${id}（${tool}）`,
    approvalSummary: (decision, id, action, of) => {
      const verb = decision === "reject" ? "拒绝了" : decision === "approve_session" ? "批准了（本工单内免批）" : "批准了";
      return `${verb}审批 #${id}：${action}${of ? `（${of}）` : ""}`;
    },
    decisionTarget: (id) => `决定请求 #${id}`,
    decisionSummary: (dismissed, id, prompt, of) => `${dismissed ? "驳回了" : "回答了"}决定请求 #${id}：${prompt}${of ? `（${of}）` : ""}`,
  },
});
