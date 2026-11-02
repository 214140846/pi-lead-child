// 回复里的消息片段：agent 状态、事项、审批（MessagePartView.tsx）。
import { defineMessages } from '@/i18n';

export const messagePartMessages = defineMessages({
  en: {
    ticketNumber: (ticketId: number) => `Ticket #${ticketId}`,
    stateUpdated: 'State updated',
    itemUnreadable: 'Cannot read the details of this item',
    loading: 'Loading',
    approvalNumber: (approvalId: number) => `Approval #${approvalId}`,
    approvalSyncing: 'Syncing the approval details',
    approvalTool: (tool: string) => `Approval · ${tool}`,
    needsApproval: (tool: string) => `Needs approval · ${tool}`,
    reject: 'Reject',
    approve: 'Approve',
  },
  zh: {
    ticketNumber: (ticketId) => `工单 #${ticketId}`,
    stateUpdated: '状态已更新',
    itemUnreadable: '读不到这条事项的详情',
    loading: '正在读取',
    approvalNumber: (approvalId) => `审批 #${approvalId}`,
    approvalSyncing: '正在同步审批详情',
    approvalTool: (tool) => `审批 · ${tool}`,
    needsApproval: (tool) => `需要审批 · ${tool}`,
    reject: '拒绝',
    approve: '批准',
  },
});
