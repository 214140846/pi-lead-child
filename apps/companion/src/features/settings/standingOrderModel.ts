// 设置页「常设指令」和会话里 StandingOrderChangeConfirm 卡的纯规则：级别、作者、提议的状态怎样说，时间怎样写。
// 契约在 packages/protocol/src/standing-orders-wire.ts（工单 10）。
import type {
  Locale, StandingOrderDto, StandingOrderExecutionDto, StandingOrderProposalDto,
} from '@pi-lead-child/protocol';

import { standingOrdersMessages } from './standingOrders.messages';

// 下面的 leadName 都是 Lead 的名字（useLeadName）。locale 是界面语言（useLocale）。
export function standingOrdersDescription(leadName: string, locale: Locale = 'en'): string {
  return standingOrdersMessages(locale).description(leadName);
}

export function standingOrdersRollbackNote(leadName: string, locale: Locale): string {
  return standingOrdersMessages(locale).rollbackNote(leadName);
}

// 系统写的文字（种子指令的标题和说明、档位判断的 findings）称呼 Lead 时写「Lead」。Lead 自己也读这些文字，后端不改。
// 显示时把独立的单词 Lead 换成 Lead 的名字。前后是英文字母、数字或下划线时不换：wakeLead、LeadX、Lead_x 都是标识符。
// 用户或 Lead 写的原因原样显示，不经过它。
const LEAD_WORD = /(^|[^A-Za-z0-9_])Lead(?![A-Za-z0-9_])/gu;

export function withLeadName(text: string, leadName: string): string {
  return text.replace(LEAD_WORD, (_match, before: string) => `${before}${leadName}`);
}

// 指令和版本的说明：作者是系统时是系统写的文字，换名字；Lead 或用户写的原样显示。
export function orderReasonText(order: Pick<StandingOrderDto, 'author' | 'reason'>, leadName: string): string {
  return order.author === 'system' ? withLeadName(order.reason, leadName) : order.reason;
}

export function levelLabel(level: string | null, locale: Locale): string | null {
  const labels: Record<string, string> = standingOrdersMessages(locale).levels;
  return level && level in labels ? labels[level]! : null;
}

// 清单里一行的小字：编号、版本、谁写的、定什么级别或者是哪条规则。
export function orderSubtitle(order: StandingOrderDto, leadName: string, locale: Locale): string {
  const m = standingOrdersMessages(locale);
  const what = order.level ? m.subtitleLevel(m.levels[order.level]) : order.rule ? m.subtitleRule(order.rule) : null;
  return [`${order.id} · v${order.version}`, m.writtenBy(order.author, leadName), what].filter(Boolean).join(' · ');
}

export function proposalTitle(proposal: StandingOrderProposalDto, leadName: string, locale: Locale): string {
  const m = standingOrdersMessages(locale);
  const title = withLeadName(proposal.title, leadName);
  return proposal.op === 'rollback' && proposal.rollbackTo !== null
    ? m.proposalRollback(leadName, title, proposal.rollbackTo)
    : m.proposalTitle(leadName, proposal.op, title);
}

// 已经处理过的提议怎样说。还在等你时返回 null。
export function proposalOutcome(proposal: StandingOrderProposalDto, locale: Locale): { label: string; tone: 'success-dark' | 'secondary' } | null {
  const m = standingOrdersMessages(locale);
  switch (proposal.state) {
    case 'approved':
      return { label: m.approved(String(proposal.appliedVersion ?? '?')), tone: 'success-dark' };
    case 'rejected':
      return { label: m.rejected, tone: 'secondary' };
    case 'expired':
      return {
        label: proposal.voidedReason === 'superseded' ? m.superseded
          : proposal.voidedReason === 'hard_rule' ? m.hardRule
          : m.expired,
        tone: 'secondary',
      };
    default:
      return null;
  }
}

// 只列更放开或者碰到规则的几项：这是要你看的理由。没有时列全部。findings 是系统写的，换名字。
export function proposalConcerns(proposal: StandingOrderProposalDto, leadName: string): string[] {
  const concerns = proposal.findings.filter((finding) => finding.tier !== 'conservative');
  return (concerns.length ? concerns : proposal.findings).map((finding) => withLeadName(finding.detail, leadName));
}

// 本地时间，月-日 时:分。读不出来时原样返回。
export function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 一条执行记录的小字：时间、事件类型、对象、作用（不是定级别时）。
export function executionSubtitle(execution: StandingOrderExecutionDto): string {
  const subject = execution.ticketId !== null ? `#${execution.ticketId}` : execution.subject;
  const effect = execution.effect === 'level' ? null : execution.effect;
  return [shortTime(execution.receivedAt), execution.kind, subject, `v${execution.version}`, effect].filter(Boolean).join(' · ');
}

// 指令内容的简短 JSON（条件、动作、上限），设置页上给想看细节的人。
export function compactJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

// 请求失败时给人看的一句话：网关回的 message，或者一句通用的话（按 locale）。
export function standingOrderErrorText(reason: unknown, locale: Locale = 'en'): string {
  const message = reason instanceof Error ? reason.message : '';
  return message || standingOrdersMessages(locale).requestFailed;
}

export function pendingProposalCount(proposals: readonly StandingOrderProposalDto[] | null | undefined): number {
  return (proposals ?? []).filter((proposal) => proposal.state === 'pending').length;
}
