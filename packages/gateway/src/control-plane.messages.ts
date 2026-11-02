// 控制面投影里给人看的文字（2026-11-01 多语言）：工单的执行状态、收件箱的原因、「Lead 已处理」的说明。
// 读的时候现算，按读的时候用户选的语言（store 的 getLocale）。Lead 的 get_ticket 读同一份摘要，用户的语言它也读得懂。
import { defineMessages } from "@pi-lead-child/protocol";

type ExecutionStep = "waiting_dispatch" | "starting" | "running" | "blocked" | "failed";
type MilestoneChange = "moved" | "cancelled" | "completed" | "missed" | "relabeled" | "restored";

export const controlPlaneMessages = defineMessages({
  en: {
    execution: {
      suspended: "Dispatch is suspended",
      backoff: "Temporary failure · waiting for an automatic retry",
      outcomeRepair: {
        waiting_dispatch: "Outcome repair · waiting for an agent",
        starting: "Outcome repair · starting",
        running: "Submitting the outcome again",
        blocked: "Outcome repair is blocked",
        failed: "Outcome repair failed",
        other: "Outcome repair",
      } satisfies Record<ExecutionStep | "other", string>,
      recovery: {
        waiting_dispatch: "Recovering · waiting for an agent",
        starting: "Recovering · starting",
        running: "Running",
        blocked: "Recovery is blocked",
        failed: "Recovery failed",
        other: "Recovering",
      } satisfies Record<ExecutionStep | "other", string>,
      rework: {
        waiting_dispatch: "Rework requested, waiting for an agent",
        starting: "The rework run is starting",
        running: "The rework run started",
        blocked: "Rework dispatch is blocked",
        failed: "The rework did not start",
        other: "Rework requested",
      } satisfies Record<ExecutionStep | "other", string>,
      execution: {
        waiting_dispatch: "Waiting for agent dispatch",
        starting: "The run is starting",
        running: "The run started",
        blocked: "Dispatch is blocked",
        failed: "The run did not start",
        other: "The run did not start",
      } satisfies Record<ExecutionStep | "other", string>,
      dependsOn: "Waiting for depends_on dependencies to finish",
      retryAt: (at: string) => `Temporary failure. The system retries automatically at ${at}.`,
    },
    defaultModel: "Default model",
    inbox: {
      approval: (action: string) => `Waiting for your approval: ${action}`,
      stalled: "The run has had no activity for a long time",
      capability: "The continuation waits for a capability that is not deployed yet",
      draft: (lead: string) => `${lead} created this draft. It starts after you confirm it`,
    },
    leadHandled: {
      milestoneVerb: (change: string) => {
        switch (change as MilestoneChange) {
          case "moved": return "changed the date";
          case "cancelled": return "cancelled it";
          case "completed": return "marked it done";
          case "missed": return "marked it missed";
          case "relabeled": return "renamed it";
          default: return "restored it";
        }
      },
      milestone: (itemId: number, label: string, lead: string, verb: string) => `You set "${label}" of #${itemId}. ${lead} ${verb}`,
      reminder: (title: string, lead: string, to: string) => `You set the time of reminder "${title}". ${lead} moved it to ${to}`,
      stop: (lead: string, itemId: number, title: string) => `${lead} stopped ticket #${itemId} "${title}". It went back to ready`,
    },
  },
  zh: {
    execution: {
      suspended: "派发已挂起",
      backoff: "瞬时失败 · 等待自动重试",
      outcomeRepair: {
        waiting_dispatch: "成果修复 · 等待 agent",
        starting: "成果修复 · 启动中",
        running: "正在补交成果",
        blocked: "成果修复受阻",
        failed: "成果修复失败",
        other: "成果修复",
      },
      recovery: {
        waiting_dispatch: "正在恢复 · 等待 agent",
        starting: "正在恢复 · 启动中",
        running: "执行中",
        blocked: "恢复受阻",
        failed: "恢复失败",
        other: "正在恢复",
      },
      rework: {
        waiting_dispatch: "返工已请求，等待 agent",
        starting: "返工 Run 正在启动",
        running: "返工 Run 已启动",
        blocked: "返工派发受阻",
        failed: "返工启动失败",
        other: "返工已请求",
      },
      execution: {
        waiting_dispatch: "等待 agent 派发",
        starting: "Run 正在启动",
        running: "Run 已启动",
        blocked: "派发受阻",
        failed: "启动失败",
        other: "启动失败",
      },
      dependsOn: "等待 depends_on 依赖完成",
      retryAt: (at) => `瞬时失败，系统会在 ${at} 自动重试。`,
    },
    defaultModel: "默认模型",
    inbox: {
      approval: (action) => `等你批准：${action}`,
      stalled: "Run 很久没有动静",
      capability: "续作在等一个还没部署的能力",
      draft: (lead) => `${lead} 建的草稿，等你确认才会开始`,
    },
    leadHandled: {
      milestoneVerb: (change) => {
        switch (change as MilestoneChange) {
          case "moved": return "改了日期";
          case "cancelled": return "取消了它";
          case "completed": return "标为完成";
          case "missed": return "标为没赶上";
          case "relabeled": return "改了名字";
          default: return "恢复了它";
        }
      },
      milestone: (itemId, label, lead, verb) => `#${itemId} 的「${label}」是你定的，${lead} ${verb}`,
      reminder: (title, lead, to) => `提醒「${title}」的时间是你定的，${lead} 改到了 ${to}`,
      stop: (lead, itemId, title) => `${lead} 停下了工单 #${itemId}「${title}」，它回到了待开始`,
    },
  },
});
