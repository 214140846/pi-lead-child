// 会话里的失败给人看的样子：一句白话，说清发生了什么、系统在做什么、你能做什么。
// 原始错误（provider 的 JSON、CLI 的报错、检查点的键值表、写给 Lead 的英文下一步）只放在失败卡展开以后的详情里。
// 以前这些原文直接画在会话里：每次心跳巡检一个 503 红框，「Run crashed」是一张键值表。
import {
  classifyLeadModelError, isLeadRestartInterruption, isSystemTurnOrigin, leadModelFailureReason, leadTurnFailureSentence,
  leadTurnWaitingSentence,
  type ConversationToolCall, type KernelCheckpoint, type LeadStatus,
} from '@pi-lead-child/protocol';

import type { Locale } from '@/i18n';

import { leadNameNow } from '../../state/leadName';
import type { MessageFailure } from '../../state/types';
import { failureMessages } from './failure.messages';
import { itemOperationDoneWords } from './itemOperationWords';

export type FailureAction = 'resend' | 'retry' | 'remove' | 'refresh' | 'open-ticket';

/** 失败卡片上动作按钮的文字，按界面语言。会话和工单对话共用。 */
export function failureActionLabels(locale: Locale): Record<FailureAction, string> {
  return failureMessages(locale).actions;
}


// 点开以后的几行事实的种类：卡片按种类找「原因」「接下来」，不按标签文字找。
export type FailureFactKey = 'done' | 'reason' | 'next';

export type FailurePresentation = {
  headline: string;
  actions: FailureAction[];
  // 失败卡展开以后的原文。没有原文时为 null，这一行不能展开。
  details: string | null;
  // 连着出现、可以合成一张卡片的同一种失败（只有 Lead 自己发起的回合才合并）。
  groupKey: string | null;
  tone: 'danger' | 'warning';
  // 画成哪个模式（2026-10-27 画布「没有回答」，主题 11.7、11.9）：
  //   absence：缺席占位，一行虚线框，「没有回答 · 你问的「…」」，点开看几行事实和原文；
  //   tail：回复说到一半被打断，接在已说出的文字后面的琥珀虚线胶囊；
  //   system：系统自己发起的那一轮没完成，居中的系统信息行，不给按钮。
  form: 'absence' | 'tail' | 'system';
  // 一行里的短话。absence 是 600 的短词（「没有回答」）；tail 和 system 是那一整句（「重启打断，会接着回复」）。
  label: string;
  // 你那句话（缺席占位引用它）。没有时为 null。
  quote: string | null;
  // 一行里跟在短词后面、要你先知道的话。有它时不引用你那句话：认证失败时直接「重发」也一样失败，要先说检查什么；
  // 在等自动重试时要说会自动再试。缺省为 null。
  summary?: string | null;
  // 点开以后的几行：做过、原因、接下来。原文另放在 details。
  facts: Array<{ key: FailureFactKey; label: string; value: string }>;
};

// 点开以后的几行事实。空的不写。
function factsOf(locale: Locale, entries: Array<[FailureFactKey, string | null | undefined]>): Array<{ key: FailureFactKey; label: string; value: string }> {
  const labels = failureMessages(locale).facts;
  return entries.flatMap(([key, value]) => value ? [{ key, label: labels[key], value }] : []);
}

// daemon 自己写的两句（packages/store 的 EMPTY_ASSISTANT_REPLY_ERROR，以及中断时的说明）。它们是用来认的标记，不随名字变。
// 给人看的文字称呼 Lead 用它的名字（设置 → 身份与风格）：这里的函数离组件远，用 leadNameNow()。
const EMPTY_REPLY = 'Lead 未生成回复，请重试。';
const ABORTED = 'Lead 回复被中断，请重试。';
const DAEMON_AUTH = 'Lead 模型连接认证失败，请重试。';

// Lead 自己发起的一轮没完成时说的那件事（failure.messages.ts 的 systemWork，按来源）。
function systemWorkOf(originKind: string, name: string, locale: Locale): { work: string; label: string } {
  const m = failureMessages(locale);
  const known = (m.systemWork as Record<string, { work: string; label: string } | undefined>)[originKind];
  if (known) return known;
  const work = m.systemWorkFallback(name);
  return { work, label: work };
}

type ModelFailure = 'network' | 'unavailable' | 'busy' | 'auth' | 'config' | 'context' | 'empty' | 'aborted' | 'restart' | 'unknown';

function modelFailure(raw: string): ModelFailure {
  const text = raw.trim();
  if (isLeadRestartInterruption(text)) return 'restart';
  if (text === EMPTY_REPLY) return 'empty';
  if (text === ABORTED) return 'aborted';
  if (text === DAEMON_AUTH) return 'auth';
  return classifyLeadModelError(text);
}

function reasonOf(kind: ModelFailure, name: string, locale: Locale): string {
  const m = failureMessages(locale).reason;
  if (kind === 'empty') return m.empty(name);
  if (kind === 'aborted') return m.aborted(name);
  if (kind === 'restart') return m.restart(name);
  return leadModelFailureReason(kind, name, locale);
}

function systemRecovery(lead: LeadStatus | undefined, clock: (value: string) => string, locale: Locale): string {
  const m = failureMessages(locale).recovery;
  if (!lead || lead.state === 'online') return m.recovered;
  if (lead.nextAttemptAt) return m.at(clock(lead.nextAttemptAt));
  return m.later;
}

// 这一轮的工具调用里改变了什么，用白话说（「提醒 #83 已创建」）。认得的是改日程和工单的那几个 Lead 工具；
// 别的完成了的调用只计数。render_ui 画的是给用户看的卡片，不算做了事。
type TurnTool = Pick<ConversationToolCall, 'name' | 'state' | 'args' | 'result'>;

function parsedPreview(preview: string | undefined): unknown {
  if (!preview) return null;
  try { return JSON.parse(preview); } catch { return preview; }
}

// 工具结果里给人看的文字。pi 的结果包在 { content: [{ type: 'text', text }] } 里；别的结构（details 等）不算。
function resultText(preview: string | undefined): string {
  const value = parsedPreview(preview);
  const content = value && typeof value === 'object' ? (value as { content?: unknown }).content : undefined;
  if (Array.isArray(content)) {
    return content.flatMap((part) => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : [])).join('\n');
  }
  return typeof value === 'string' ? value : '';
}

// 这次调用的那一项。针对已有事项的工具（取消、改期……）看参数里的编号；新建的工具看结果文字里的第一个编号
// （「created reminder #83」）。不在原始 JSON 里随便找第一个 #：结果里可能还提到别的工单。
function toolItemId(tool: TurnTool): string | null {
  const args = parsedPreview(tool.args?.preview);
  if (args && typeof args === 'object') {
    for (const key of ['ticket_id', 'item_id', 'ticketId', 'itemId']) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
      if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
    }
  }
  return /#(\d+)/.exec(resultText(tool.result?.preview))?.[1] ?? null;
}

function completedWork(tools: readonly TurnTool[], locale: Locale): string | null {
  const m = failureMessages(locale).work;
  const done = tools.filter((tool) => tool.state === 'completed' && tool.name !== 'render_ui');
  const named = done.flatMap((tool) => {
    const words = itemOperationDoneWords(tool.name, toolItemId(tool), locale);
    return words ? [words] : [];
  });
  const others = done.length - named.length;
  if (!named.length) return others ? m.others(others) : null;
  const list = [...new Set(named)].join(m.separator);
  return others ? m.namedAndOthers(list, others) : list;
}

export function presentTurnFailure(input: {
  failure: MessageFailure;
  originKind: string | null | undefined;
  ticketId: number | null;
  // 这一轮用户说的话。没有时（旧入口的轮次）不给「重发」。
  userText: string | null;
  lead: LeadStatus | undefined;
  clock: (value: string) => string;
  // 这一轮的工具调用。调过工具的一轮可能已经建了提醒、工单：不给「重发」，免得做第二遍（2026-10-16 提醒 #83）。
  tools?: readonly TurnTool[];
  // 这一轮被重启打断以后，会话里已经有 Lead 接着回复的一轮。
  continued?: boolean;
  // 界面语言。
  locale: Locale;
}): FailurePresentation {
  const { failure, originKind, ticketId, userText, lead, clock } = input;
  const { locale } = input;
  const m = failureMessages(locale);
  const facts = (entries: Array<[FailureFactKey, string | null | undefined]>) => factsOf(locale, entries);
  const name = leadNameNow();
  const details = failure.message.trim() || null;
  const tools = (input.tools ?? []).filter((tool) => tool.name !== 'render_ui');
  const work = completedWork(tools, locale);
  const canResend = Boolean(userText?.trim()) && tools.length === 0;
  const quote = userText?.trim() || null;
  if (failure.kind === 'timeout-unknown') {
    return {
      headline: m.timeoutUnknown.headline, actions: ['refresh'], details: null, groupKey: null, tone: 'danger',
      form: 'absence', label: m.timeoutUnknown.label, quote, facts: facts([['next', m.timeoutUnknown.next]]),
    };
  }
  // 在等那一次自动重试：不是失败，不给「重发」（再发一次会多出一轮）。
  if (failure.kind === 'retry-pending') {
    const headline = leadTurnWaitingSentence(failure.message, failure.code === 'network' ? 'network' : 'model', name, locale);
    return { headline, actions: [], details, groupKey: null, tone: 'warning', form: 'absence', label: m.retrying, quote, summary: headline, facts: [] };
  }
  if (failure.kind === 'rejected') {
    return {
      headline: m.rejected.headline, actions: ['retry', 'remove'], details, groupKey: null, tone: 'danger',
      form: 'absence', label: m.rejected.label, quote, facts: facts([['next', m.rejected.next]]),
    };
  }
  const kind = modelFailure(failure.message);
  // 被重启打断不是失败：下一个 daemon 接着做（Lead 接着回复，或者再答一次）。不用红色，不给「重发」。
  // 排在工单对话的说法前面：在工单里发给 Lead 的话被打断，也是这一句。
  if (kind === 'restart') {
    const headline = isSystemTurnOrigin(originKind)
      ? leadTurnFailureSentence(failure.message, { system: true, name, locale })!
      : m.restart.headline(work ?? '', name, Boolean(input.continued));
    const system = isSystemTurnOrigin(originKind);
    return {
      headline, actions: [], details, groupKey: null, tone: 'warning',
      form: system ? 'system' : 'tail',
      label: system ? headline : m.restart.label(Boolean(input.continued)),
      quote, facts: facts([['done', work]]),
    };
  }
  if (ticketId !== null) {
    return {
      form: 'absence',
      label: tools.length ? m.answerNotComplete : m.noAnswer,
      quote,
      facts: facts([
        ['done', work],
        ['reason', m.ticket.reason(ticketId, tools.length > 0)],
        ['next', tools.length ? m.ticket.nextPartial : canResend ? null : m.ticket.nextAskAgain],
      ]),
      headline: tools.length ? m.ticket.headlinePartial(ticketId) : m.ticket.headlineNone(ticketId, canResend),
      actions: canResend ? ['resend'] : [],
      details,
      groupKey: null,
      tone: 'danger',
    };
  }
  const reason = reasonOf(kind, name, locale);
  const what = kind === 'auth' ? m.account : m.configuration;
  if (isSystemTurnOrigin(originKind)) {
    const { work, label } = systemWorkOf(originKind!, name, locale);
    const headline = kind === 'auth' || kind === 'config'
      ? m.system.needsUser(reason, work, name, what)
      : kind === 'network'
        ? m.system.network(reason, work)
        : m.system.other(reason, work, systemRecovery(lead, clock, locale));
    return {
      headline, actions: [], details, groupKey: turnFailureGroupKey(failure, originKind), tone: 'warning',
      form: 'system', label, quote: null,
      // 接下来写系统自己会怎样，不写「你不需要操作」：系统信息行本来就不给按钮。
      facts: facts([['reason', reason], ['next', kind === 'auth' || kind === 'config'
        ? m.system.nextNeedsUser(name, what)
        : kind === 'network' ? m.system.nextNetwork : systemRecovery(lead, clock, locale)]]),
    };
  }
  // 这一轮已经做了事：先说做了什么，再说回复没完成。不给「重发」，让用户直接告诉 Lead 接着做。
  if (tools.length) {
    const cause = kind === 'unknown' || kind === 'empty' || kind === 'aborted' ? '' : reason;
    // 认证、配置的失败再试也一样：先说要检查什么（发布评审 3688968）。
    const next = kind === 'auth' || kind === 'config' ? m.partial.nextNeedsUser(name, what) : m.partial.next(name);
    return {
      headline: m.partial.headline(work ?? '', cause, next),
      actions: [],
      details,
      groupKey: null,
      tone: 'danger',
      form: 'absence',
      label: m.answerNotComplete,
      quote,
      facts: facts([['done', work], ['reason', cause ? reason : null], ['next', next]]),
    };
  }
  const resend = canResend ? m.plain.tapResend : m.plain.sendAgain;
  const headline = kind === 'network' || kind === 'unavailable' || kind === 'busy'
    ? m.plain.unreachable(reason, resend)
    : kind === 'auth' || kind === 'config'
      ? m.plain.needsUser(reason, name, what, resend)
      : kind === 'unknown'
        ? m.plain.unknown(name, resend)
        : m.plain.other(reason, resend);
  const next = kind === 'auth' || kind === 'config'
    ? m.plain.nextNeedsUser(name, what, resend)
    : kind === 'network' || kind === 'unavailable' || kind === 'busy' ? m.plain.nextUnreachable(resend) : canResend ? null : m.plain.nextOther(resend);
  return {
    headline, actions: canResend ? ['resend'] : [], details, groupKey: null, tone: 'danger',
    form: 'absence', label: m.noAnswer, quote,
    summary: kind === 'auth' || kind === 'config' ? m.plain.summaryNeedsUser(name, what, canResend ? m.plain.resendShort : m.plain.sendOnce) : null,
    facts: facts([['reason', kind === 'unknown' ? m.reason.unknown(name) : reason], ['next', next]]),
  };
}

// ── Run 失败的检查点 ──────────────────────────────────────────────────────────

// 失败类别的说法在 failure.messages.ts 的 run.category。

export type RunFailureCheckpointPresentation = {
  label: string;
  tone: 'danger' | 'warning';
  headline: string;
  needsUser: boolean;
  // 展开以后的详情：原来的标题、摘要、键值表和写给 Lead 的下一步。
  details: string;
};

function fact(checkpoint: KernelCheckpoint, label: string): string | null {
  return checkpoint.keyFacts.find((item) => item.label === label)?.value ?? null;
}

/**
 * 系统记下的一次 Run 失败（检查点带 Failure category 这一项）。别的检查点返回 null，照常显示。
 * - lead：现在的 Lead 健康状态。失败还没过去、Lead 的模型又连不上时，不能说"Lead 会判断"。
 * - settled：这次失败已经过去了（工单后来结束了，或者不再阻塞）。这时只说当时发生了什么，
 *   不拿现在的 Lead 健康状态来说话；工单现在的状态由卡片上的「现在：…」标签说。
 * - leadHandling：工单的 TicketSummary 说 Lead 正在处理（attention.leadHandling，没有升级给用户）。
 *   2026-10-15 用户决定：异常先交给 Lead，除非需要用户介入，UI 只给弱反馈。这时不说「需要你处理」。
 * - escalated：工单有要用户行动的 blocker（attention.blockerCount）。Lead 没能处理，这时不说「Lead 处理中」。
 */
export function presentRunFailureCheckpoint(
  checkpoint: KernelCheckpoint,
  context: { lead?: LeadStatus; settled?: boolean; leadHandling?: boolean; escalated?: boolean } = {},
  locale: Locale = 'en',
): RunFailureCheckpointPresentation | null {
  const { lead, settled = false, leadHandling = false, escalated = false } = context;
  const m = failureMessages(locale).run;
  const name = leadNameNow();
  const category = fact(checkpoint, 'Failure category');
  if (category === null || checkpoint.source !== 'system_derived') return null;
  const agent = fact(checkpoint, 'Agent') ?? 'agent';
  const scope = fact(checkpoint, 'Failure scope');
  const needs = fact(checkpoint, 'Needs');
  const next = checkpoint.nextStep ?? '';
  const phrase = m.category[category] ?? m.categoryFallback;
  const subject = m.subject(checkpoint.ticketId, agent, phrase);
  // 认的是 nextStep 原文里的字样（英文和旧版 daemon 写的中文），不是界面文字。
  const exhausted = /exhausted|已经自动重试|停止自动重试|重试已耗尽|已用尽/i.test(next);
  const details = [
    checkpoint.title,
    checkpoint.summary,
    ...checkpoint.keyFacts.map((item) => `${item.label}: ${item.value}`),
    checkpoint.nextStep ? `Next: ${checkpoint.nextStep}` : null,
  ].filter(Boolean).join('\n');
  if (settled) return { label: m.runFailed, tone: 'warning', headline: m.settled(subject), needsUser: false, details };
  if (leadHandling) {
    return { label: m.handlingLabel(name), tone: 'warning', headline: m.handlingHeadline(subject, name), needsUser: false, details };
  }
  let label = m.needsYou;
  let tone: RunFailureCheckpointPresentation['tone'] = 'danger';
  let needsUser = true;
  let rest: string;
  if (checkpoint.kind === 'progress') {
    label = m.autoRetrying;
    tone = 'warning';
    needsUser = false;
    rest = m.progress;
  } else if (needs === 'login') {
    rest = m.login(agent);
  } else if (needs === 'refill') {
    rest = m.refill(agent);
  } else if (needs === 'config') {
    rest = m.config(agent);
  } else if (needs === 'code_fix') {
    rest = m.codeFix;
  } else if (exhausted) {
    rest = m.exhausted;
  } else if ((scope === 'task' || scope === 'unknown' || scope === null) && escalated) {
    rest = m.escalated(name);
  } else if ((scope === 'task' || scope === 'unknown' || scope === null) && lead?.state === 'degraded') {
    label = m.waitLabel(name);
    tone = 'warning';
    rest = m.waitRest(name);
  } else if (scope === 'task' || scope === 'unknown' || scope === null) {
    label = m.handlingLabel(name);
    tone = 'warning';
    needsUser = false;
    rest = m.judge(name);
  } else {
    rest = m.noRetry;
  }
  return { label, tone, headline: m.headline(subject, rest), needsUser, details };
}

/** 连着出现时能合成一张卡片的失败：Lead 自己发起的回合，同一个来源、同一种原因。其他失败返回 null。 */
// 被重启打断的不合并：它不是一次失败，不进失败汇总。
export function turnFailureGroupKey(failure: MessageFailure | null, originKind: string | null | undefined): string | null {
  if (failure?.kind !== 'turn-error' || !isSystemTurnOrigin(originKind)) return null;
  const kind = modelFailure(failure.message);
  return kind === 'restart' ? null : `${originKind}|${kind}`;
}

// ── 系统写的检查点 ────────────────────────────────────────────────────────────
//
// 2026-10-27 用户：「系统更新」那张大卡（整块灰底、英文标题、写给 Lead 的下一步）按模式「系统信息行」重画：
// 居中一行中文；要你处理时带一个按钮；原文点开再看。
// 引擎和 daemon 写的这几种检查点标题是代码里的常量（写给 Lead 看的英文），按原文对照成给人看的话，不按意思猜。
const SYSTEM_CHECKPOINT_WORDS: Record<string, 'reclaimed' | 'recovered' | 'dispatchFailed' | 'stopped'> = {
  'Run reclaimed after daemon restart': 'reclaimed',
  'Run recovered after daemon restart': 'recovered',
  'Run recovered after dispatch interruption': 'recovered',
  'Run dispatch failed': 'dispatchFailed',
  'Run stopped after repeated daemon restarts': 'stopped',
};

export type SystemCheckpointPresentation = {
  // 一行里的话。
  text: string;
  // 要你处理：图标红色，行尾「打开工单」。
  needsUser: boolean;
  // 这件事已经好了（系统接着派发了）：图标用进度，不用警告。
  ok: boolean;
  // 点开以后的原文：标题、摘要、键值、写给 Lead 的下一步。
  details: string;
};

/**
 * 系统写的检查点（source 是 system_derived，没有挂着审批或决策请求）在会话里的一行。别的检查点返回 null，照常显示。
 * context 和 presentRunFailureCheckpoint 一样：settled 是这件事已经过去了，leadHandling 是 Lead 正在处理，
 * escalated 是工单有要你行动的 blocker。nowLabel 是卡片旁边的「现在：…」。
 */
export function presentSystemCheckpoint(
  checkpoint: KernelCheckpoint,
  context: { lead?: LeadStatus; settled?: boolean; leadHandling?: boolean; escalated?: boolean; nowLabel?: string | null } = {},
  locale: Locale = 'en',
): SystemCheckpointPresentation | null {
  if (checkpoint.source !== 'system_derived' || checkpoint.actionRef) return null;
  const m = failureMessages(locale).checkpoint;
  const name = leadNameNow();
  const details = [
    checkpoint.title,
    checkpoint.summary,
    ...checkpoint.keyFacts.map((item) => `${item.label}: ${item.value}`),
    checkpoint.nextStep ? `Next: ${checkpoint.nextStep}` : null,
  ].filter(Boolean).join('\n');
  // 带失败类别的 Run 失败：说法已经在 presentRunFailureCheckpoint 里（哪个 agent、为什么、系统在做什么）。
  const failure = presentRunFailureCheckpoint(checkpoint, context, locale);
  if (failure) {
    const text = failure.headline.replace(/[。；.]$/u, '');
    return { text: context.settled && context.nowLabel ? `${text} · ${context.nowLabel}` : text, needsUser: failure.needsUser, ok: false, details };
  }
  const known = SYSTEM_CHECKPOINT_WORDS[checkpoint.title];
  const words = known ? m[known](checkpoint.ticketId) : m.generic(checkpoint.ticketId, checkpoint.title);
  if (checkpoint.kind !== 'blocked') return { text: words, needsUser: false, ok: true, details };
  // 卡住了：工单后来变了就说现在怎样；有要你行动的 blocker 就要你处理；Lead 在处理就说它在处理；
  // 都不是时，这件事先交给 Lead（2026-10-15 用户决定：异常先交给 Lead，除非需要用户介入）。
  if (context.settled) return { text: context.nowLabel ? `${words} · ${context.nowLabel}` : words, needsUser: false, ok: false, details };
  if (context.escalated) return { text: m.escalated(words, name), needsUser: true, ok: false, details };
  if (context.leadHandling) return { text: m.handling(words, name), needsUser: false, ok: false, details };
  return { text: m.judge(words, name), needsUser: false, ok: false, details };
}
