// 设置 → 常设指令和会话里的审批卡（StandingOrderProposalView）的文案。
// 系统的判断（findings）是 daemon 写的句子，按写入时的语言显示，不在这里。
import type { StandingOrderDto, StandingOrderProposalDto } from '@pi-lead-child/protocol';

import { defineMessages } from '@/i18n';

type Level = NonNullable<StandingOrderDto['level']>;
type Author = StandingOrderDto['author'];

export const standingOrdersMessages = defineMessages({
  en: {
    description: (leadName: string) => `${leadName} follows these orders to handle events in the system: which events are only recorded, `
      + `which go to the digest, and which go to ${leadName} separately. The orders also control automatic retries, merges and escalation at the deadline. `
      + `When ${leadName} makes an order more conservative, the change takes effect at once. When ${leadName} makes an order more permissive, you must approve it.`,
    rollbackNote: (leadName: string) => 'A rollback writes a new version with the same content as that version. '
      + `Your rollback takes effect at once. ${leadName} learns about it in the next turn.`,
    levels: {
      record: 'Record only', digest: 'Digest', auto: 'Handle automatically', tell: 'Tell separately', interrupt: 'Interrupt',
    } satisfies Record<Level, string>,
    author: (author: Author, leadName: string) => (author === 'system' ? 'System' : author === 'lead' ? leadName : 'You'),
    writtenBy: (author: Author, leadName: string) =>
      (author === 'system' ? 'Written by the system' : author === 'lead' ? `Written by ${leadName}` : 'Written by you'),
    authorBadge: (author: Author, leadName: string, created: boolean) =>
      `${created ? 'Added' : 'Changed'} by ${author === 'lead' ? leadName : 'you'}`,
    subtitleLevel: (level: string) => `Level: ${level}`,
    subtitleRule: (rule: string) => `Rule ${rule}`,
    proposalTitle: (leadName: string, op: StandingOrderProposalDto['op'], title: string) => {
      const verb = { create: 'add', update: 'change', disable: 'disable', enable: 'enable', rollback: 'roll back' }[op];
      return `${leadName} wants to ${verb} "${title}"`;
    },
    proposalRollback: (leadName: string, title: string, version: number) => `${leadName} wants to roll back "${title}" to v${version}`,
    approved: (version: string) => `Approved. The order is now v${version}.`,
    rejected: 'You did not approve. The order stays the same.',
    superseded: 'The order changed again later, so this proposal is void.',
    hardRule: 'The change breaks a hard safety rule, so it cannot take effect.',
    expired: 'The proposal expired and did not take effect.',
    requestFailed: 'The request did not complete. Try again.',
    loadFailed: (reason: string) => `Could not load the standing orders: ${reason}`,
    loading: 'Loading the standing orders…',
    allOrders: (count: number) => `All orders (${count})`,
    disabled: 'Disabled',
    detailLoading: 'Loading…',
    condition: 'Condition',
    action: 'Action',
    limits: 'Limits',
    escalateTo: 'Escalates to',
    escalateValue: (level: string, label: string) => `${level} (${label})`,
    versions: 'Version history',
    approvedBy: (who: string) => `Approved by ${who}`,
    current: 'Current',
    rollbackTo: 'Roll back to this version',
    rollbackConfirm: (next: number, version: number) => `Write a new version v${next} with the same content as v${version}?`,
    rollback: 'Roll back',
    cancel: 'Cancel',
    executions: 'Recent executions',
    executionsHint: 'Events in the event log that this order handled. The newest events come first.',
    noExecutions: 'No events used this order recently.',
    proposals: (leadName: string) => `Proposals from ${leadName}`,
    needsApproval: 'Needs your approval',
    reason: (leadName: string, reason: string) => `Reason from ${leadName}: ${reason}`,
    assessment: 'System assessment',
    pendingNote: (deadline: string) => `If you do not approve, the order stays the same. If you do not decide before ${deadline}, `
      + 'the proposal becomes void. You can also roll back later in Settings → Standing orders.',
    approve: 'Approve',
    reject: 'Do not approve',
  },
  zh: {
    description: (leadName) => `${leadName} 按这些指令处理系统里的事：哪些只记下、哪些进摘要、哪些单独告诉它，`
      + '以及自动重试、合并和到时限升级。它改得更保守时直接生效，改得更放开时要你批准。',
    rollbackNote: (leadName) => `回滚会写一个新版本，内容和那一版一样。你回滚直接生效，${leadName} 会在下一轮知道。`,
    levels: {
      record: '只记录', digest: '进摘要', auto: '自动处理', tell: '单独告诉', interrupt: '打断',
    },
    author: (author, leadName) => (author === 'system' ? '系统' : author === 'lead' ? leadName : '你'),
    writtenBy: (author, leadName) => `${author === 'system' ? '系统' : author === 'lead' ? leadName : '你'}写的`,
    authorBadge: (author, leadName, created) => `${author === 'lead' ? leadName : '你'}${created ? '新增' : '改过'}`,
    subtitleLevel: (level) => `定为「${level}」`,
    subtitleRule: (rule) => `规则 ${rule}`,
    proposalTitle: (leadName, op, title) => {
      const verb = { create: '新增', update: '修改', disable: '停用', enable: '启用', rollback: '回滚' }[op];
      return `${leadName} 想${verb}「${title}」`;
    },
    proposalRollback: (leadName, title, version) => `${leadName} 想把「${title}」回滚到 v${version}`,
    approved: (version) => `已批准，生效为 v${version}`,
    rejected: '你没有批准，指令照旧',
    superseded: '指令后来又改过，这个提议作废了',
    hardRule: '碰到硬性安全规则，不能生效',
    expired: '过期了，没有生效',
    requestFailed: '请求没有完成，请再试一次。',
    loadFailed: (reason) => `读不到常设指令：${reason}`,
    loading: '正在读取常设指令…',
    allOrders: (count) => `全部指令（${count}）`,
    disabled: '停用',
    detailLoading: '正在读取…',
    condition: '条件',
    action: '动作',
    limits: '上限',
    escalateTo: '到时限升到',
    escalateValue: (level, label) => `${level}（${label}）`,
    versions: '版本历史',
    approvedBy: (who) => `批准：${who}`,
    current: '现在',
    rollbackTo: '回滚到这一版',
    rollbackConfirm: (next, version) => `写一个新版本 v${next}，内容和 v${version} 一样？`,
    rollback: '回滚',
    cancel: '取消',
    executions: '最近的执行记录',
    executionsHint: '事件日志里按这条指令处理的事件，新的在前。',
    noExecutions: '最近还没有事件按它处理。',
    proposals: (leadName) => `${leadName} 的提议`,
    needsApproval: '要你批准',
    reason: (leadName, reason) => `${leadName} 的原因：${reason}`,
    assessment: '系统的判断',
    pendingNote: (deadline) => `不批准时指令照旧。${deadline} 前没有决定就作废。以后也可以在设置 → 常设指令里回滚。`,
    approve: '批准',
    reject: '不批准',
  },
});
