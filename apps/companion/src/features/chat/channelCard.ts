import {
  channelPolicyLabels, channelRuleChangeNotice, type ChannelAuthorityActionKind, type ChannelCardAction, type ChannelCardDto, type ChannelLeadDecision,
  type ChannelLookupCheckStatus, type ChannelLookupDto,
} from '@pi-lead-child/protocol';

import type { Locale } from '@/i18n';

import { channelCardMessages } from './channelCard.messages';

// 外部来源的会话卡怎样显示（工单 11，spec D10）。纯函数：卡的状态 → 卡上的字、徽章和按钮。
// 一个对话一张卡，状态原地更新；06 的「一个对象一张卡、Lead 后补充」合并时接管它。
//
// 卡上最多三条轨道（落地计划 D3，2026-10-22）：
//   处理  代码 review · 要干活 · Lead 派了工单                  （授权表的结论，交给 Lead 以后的决定）
//   干活  ✓ 工单 #482 · 完成于 14:32 · 2 处出处已核实          （Lead 派的子 agent 工单，做了的动作带链接）
//   代回  问你 · 抽查 · 信心 0.71（自动门槛 0.85）              （信心模型给卡上这份草稿打的分）
//         依据核实 ✓  做到了所求 ✓  有依据 △  理解了请求 ✓ 0.80  这一段历史 15/20
// Lead 推送或者告诉你时写的话单独一行（「Lead：……」）：这是 Lead 交来的「问你」。
// 另外有过时提示、谁能看到回复、答案和出处、review 的评论、读过的文件。外部的原文（答案、出处摘录）只用来显示。
// 2026-10-22 以前的代查记录照样显示：没有分数面板时，代回轨按代查记录里的结论和检查。

export type ChannelCardTone = 'accent' | 'neutral' | 'success' | 'warning' | 'muted';

export type ChannelCardButton = {
  action: ChannelCardAction;
  label: string;
  primary: boolean;
};

/** 一项检查的标记：✓ 过了，△ 过了但不够强，✗ 没过。 */
export type ChannelCheckMark = '✓' | '△' | '✗';

/** 代查轨：一行字。工单号单独给出，界面上可以点开。 */
export type ChannelLookupTrackView = {
  // ✓ △ ✗ 是结果；… 是还没结束；– 是停了。
  mark: string;
  tone: ChannelCardTone;
  // 「部分查到」「没查到」「查询中」……查到时是 null（✓ 已经说明了）。
  status: string | null;
  ticketId: number | null;
  // 工单号后面的几段：「查到于 14:32」「2 处出处已核实」。
  details: string[];
  // 整行的字（测试和无障碍名称用）。
  text: string;
  // 没有查、没查成的原因。
  reasons: string[];
};

export type ChannelReplyCheckView = {
  label: string;
  mark: ChannelCheckMark;
  status: ChannelLookupCheckStatus;
  // 这一项的数值（两位小数），没有数值时是 null。
  value: string | null;
  detail: string;
};

/** 代回轨：决定、信心和门槛、每项检查、否决项、原因。 */
export type ChannelReplyTrackView = {
  status: string;
  tone: ChannelCardTone;
  // 「问你 · 信心 0.71（自动门槛 0.85）」。
  text: string;
  // 本该代你发，抽中了抽查，照样问你（落地计划 D2）。
  audit: boolean;
  checks: ChannelReplyCheckView[];
  // 「这一段历史 15/20」：同一个分数段里带标签的样本（不分任务，按标签的权重加起来，落地计划 D2）。
  history: string | null;
  vetoes: string[];
  reasons: string[];
};

/** 处理轨（落地计划 D3）：授权表的结论，交给 Lead 以后 Lead（或者系统兜底）的决定。 */
export type ChannelHandlingView = {
  // 「代码 review · 要干活 · Lead 派了工单」。
  text: string;
  tone: ChannelCardTone;
  // Lead 推送或者告诉你时写的话：「Lead：王小明的 PR 看完了，有两处要改」。这是 Lead 交来的「问你」。
  note: string | null;
  // 系统兜底的原因（小字）。
  reason: string | null;
  // 对方要求改规则（spec D10 的 Jev 标记，工单 08）：「对方要求修改助手的权限，没有照做」。没有时是 null。
  ruleChange: string | null;
};

export type ChannelLookupView = {
  // 还在排队或者进行中。
  active: boolean;
  track: ChannelLookupTrackView;
  // 子 agent 经连接中心做了的、别人看得到的动作（例如在 PR 上提交的 review），有链接的可以点开。
  actions: Array<{ text: string; url: string | null }>;
  // 「之后又来了 2 条消息，结果是 45 分钟前的」。卡结束以后不显示。
  stale: string | null;
  audience: { text: string; external: boolean };
  // review 的摘要（PR review 剧本）。
  reviewSummary: string | null;
  answer: string | null;
  sources: Array<{ verified: boolean; where: string; quote: string }>;
  checked: string[];
  // 没查到时「查过哪些地方」直接显示；查到时收在「答案和出处」里。
  checkedVisible: boolean;
  caveats: string[];
  comments: { count: number; items: Array<{ where: string; body: string }> } | null;
  reads: { count: number; items: string[]; partial: boolean } | null;
};

export type ChannelCardView = {
  // 「Slack · 张三的私信」。
  context: string;
  // 发信人，带信任级别（同事、外部的人……）。
  sender: string;
  excerpt: string;
  // 同一个对话里不止一条时：「共 3 条消息」。
  more: string | null;
  // 起草的回复（不带披露前缀）。卡结束以后不显示。
  draft: string | null;
  // 草稿旁边的小字：点「直接回复」时 hub 在开头加什么（spec D8）。
  disclosure: string | null;
  // 为什么没有代你回复（影子模式、闸门拒绝的原因），或者这张卡结束的原因。
  note: string | null;
  badge: { label: string; tone: ChannelCardTone };
  buttons: ChannelCardButton[];
  // 处理轨。通道没有判断过的旧卡是 null。
  handling: ChannelHandlingView | null;
  // 带工单（以前叫代查）的卡上的干活轨和可以展开的部分。没有工单的卡是 null。
  lookup: ChannelLookupView | null;
  // 代回轨：信心模型给卡上这份草稿打的分；旧的代查记录按记录里的结论。还没有、也不会有判断时是 null。
  reply: ChannelReplyTrackView | null;
  // 摘要投递的卡显示成一行：不推送、不打扰，点开才有按钮。
  compact: boolean;
  closed: boolean;
  // 结束、也没有按钮的卡收成一行（照 ReminderFireCard）：「张三：……」和「14:40 已回复」。没收起时是 null。
  folded: { who: string; outcome: string } | null;
};

// 卡上的字按界面语言（channelCard.messages.ts）。
type Messages = ReturnType<typeof channelCardMessages>;

// 按钮的顺序固定，不随服务端给的顺序变：主操作在前，停止和撤回在后。
const BUTTON_ORDER: readonly ChannelCardAction[] = [
  'send_draft', 'send_edited', 'reply_myself', 'snooze', 'dismiss', 'cancel_lookup', 'undo_auto_reply',
];

const CHECK_MARKS: Record<ChannelLookupCheckStatus, ChannelCheckMark> = { pass: '✓', weak: '△', fail: '✗' };

// 结果超过多久算旧（和 channel.reply 的 maxResultAgeMs 缺省值一样，spec D2）。
export const CHANNEL_LOOKUP_STALE_MS = 30 * 60_000;

/**
 * 草稿旁边的小字：直接回复时 hub 加的署名（spec D8，engine 的 disclosure.ts：「<助手名> (Assistant) · confirmed by <主人名>」）。
 * 助手名在 daemon 的配置里，卡的 DTO 没有它，这里不写出来。主人名来自代查的 DTO；没有代查的卡取不到，就不写名字。
 */
export function channelDraftDisclosure(ownerName: string | null, locale: Locale = 'en'): string {
  const m = channelCardMessages(locale);
  const name = ownerName?.trim();
  return name ? m.disclosure(name) : m.disclosureNoName;
}
// 发出时会加「confirmed by」署名的草稿：代查写的、子 agent 工单写的、Lead 写的，旧卡上按对话起草的（spec D8，hub 的 ASSISTANT_DRAFTERS）。
const DISCLOSED_DRAFTERS: ReadonlySet<string> = new Set(['lookup', 'agent', 'lead', 'model']);
// 「改一下再发」的输入框下面的小字（spec D8：用户改过的文字是用户自己的话）在 channelCard.messages.ts 的 editedDisclosure。

// 本地时间的「HH:MM」。
export function clockWords(at: string | null): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const fixed = (value: number) => value.toFixed(2);
// 样本数按标签的权重加起来，可能有一位小数（0.5）。
const count = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

// 「45 分钟前」「3 小时前」「2 天前」。
function agoWords(ms: number, m: Messages): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return m.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return m.hoursAgo(hours);
  return m.daysAgo(Math.floor(hours / 24));
}

function gateNote(card: ChannelCardDto, m: Messages): string | null {
  const gate = card.gate;
  if (!gate) return null;
  const category = gate.category ? m.category[gate.category] ?? gate.category : null;
  if (gate.decision === 'pending') return m.gatePending;
  if (gate.decision === 'shadow') return m.gateShadow(String(category));
  if (gate.decision === 'denied') return gate.reasons.length ? m.gateDenied(gate.reasons[0]!) : m.gateDeniedPlain;
  return null;
}

// 带代查的卡用 spec 的说法（用户故事 2）：直接回复 / 改一下再发 / 我自己回 / 不用回。
// PR review 剧本（spec D13）：发到 PR 并回复 / 我自己处理 / 不用。
function buttonsFor(card: ChannelCardDto, m: Messages): ChannelCardButton[] {
  const lookup = card.lookup;
  const words: Partial<Record<ChannelCardAction, string>> = lookup?.playbook === 'review' ? m.reviewButton : lookup ? m.lookupButton : {};
  return BUTTON_ORDER.filter((action) => card.actions.includes(action))
    .map((action) => ({ action, label: words[action] ?? m.button[action], primary: action === 'send_draft' }));
}

// 「2 处出处已核实」「1/2 处出处已核实」「没有出处」。
function sourcesWords(sources: ReadonlyArray<{ verified?: boolean }>, m: Messages): string {
  if (!sources.length) return m.noSources;
  const verified = sources.filter((source) => source.verified === true).length;
  return verified === sources.length ? m.sourcesVerified(verified) : m.sourcesPartlyVerified(verified, sources.length);
}

function lookupTrack(lookup: ChannelLookupDto, m: Messages): ChannelLookupTrackView {
  const t = m.track;
  const finished = clockWords(lookup.finishedAt);
  let mark: string;
  let tone: ChannelCardTone;
  let status: string | null;
  let details: string[] = [];
  let reasons: string[] = [];
  switch (lookup.state) {
    case 'queued':
      [mark, tone, status] = ['…', 'accent', t.queued];
      details = [t.queuedDetail];
      break;
    case 'running':
      [mark, tone, status] = ['…', 'accent', t.running];
      details = clockWords(lookup.startedAt) ? [t.startedAt(clockWords(lookup.startedAt)!)] : [];
      break;
    case 'finished': {
      const result = lookup.result;
      if (!result) {
        [mark, tone, status] = ['✓', 'neutral', t.ended];
        details = finished ? [t.endedAt(finished)] : [];
      } else if (result.found === 'no') {
        [mark, tone, status] = ['✗', 'warning', t.notFound];
        details = [...(finished ? [t.checkedAt(finished)] : []), t.checkedCount(result.checked.length)];
      } else {
        [mark, tone, status] = result.found === 'yes' ? ['✓', 'success', null] : ['△', 'warning', t.partlyFound];
        details = [...(finished ? [t.doneAt(finished)] : []), sourcesWords([...result.sources, ...result.connectionSources], m)];
      }
      break;
    }
    case 'failed':
      [mark, tone, status] = ['✗', 'warning', t.failed];
      details = finished ? [finished] : [];
      reasons = lookup.error ? [lookup.error] : [];
      break;
    case 'cancelled':
      [mark, tone, status] = ['–', 'muted', t.cancelled];
      details = finished ? [finished] : [];
      break;
    case 'denied':
      [mark, tone, status] = ['✗', 'muted', t.denied];
      reasons = lookup.deniedReasons;
      break;
  }
  // 「✓ 工单 #482 · 查到于 14:32 · 2 处出处已核实」「△ 部分查到 · 工单 #482 · ……」。
  const rest = [...(lookup.ticketId ? [m.ticket(lookup.ticketId)] : []), ...details];
  const text = status ? [`${mark} ${status}`, ...rest].join(' · ') : `${mark} ${rest.join(' · ')}`.trim();
  return { mark, tone, status, ticketId: lookup.ticketId, details, text, reasons };
}

type ScorePanel = {
  decision: 'auto_send' | 'ask_user' | 'hand_over';
  audit: boolean;
  raw: number | null;
  confidence: number | null;
  threshold: number | null;
  calibration: { samples: number; agreed: number; minSamples: number } | null;
  checks: ReadonlyArray<{ label: string; status: ChannelLookupCheckStatus; value: number | null; detail: string }>;
  vetoes: string[];
  reasons: string[];
};

// 代回轨的一份分数：卡上的分数面板（handling.reply），或者旧的代查记录里的结论和检查。
// why：交给你时说明为什么（工单没做成、被停掉、没查到）。
function scoreTrack(card: ChannelCardDto, score: ScorePanel, now: Date, why: string, m: Messages): ChannelReplyTrackView {
  const w = m.score;
  const checks: ChannelReplyCheckView[] = score.checks.map((check) => ({
    label: check.label, mark: CHECK_MARKS[check.status], status: check.status,
    value: check.value === null ? null : fixed(check.value), detail: check.detail,
  }));
  const calibration = score.calibration;
  const history = calibration
    ? calibration.samples < calibration.minSamples
      ? w.historyFew(count(calibration.samples), calibration.minSamples)
      : w.historyAgreed(count(calibration.agreed), count(calibration.samples))
    : null;
  // 校准把信心拉开了时写出校准以前的分（落地计划 D2）。
  const before = score.raw !== null && score.confidence !== null && Math.abs(score.raw - score.confidence) >= 0.005
    ? w.beforeCalibration(fixed(score.raw)) : null;
  const bounds = [before, score.threshold === null ? null : w.threshold(fixed(score.threshold))].filter(Boolean).join(w.boundsSeparator);
  const value = score.confidence === null ? w.noConfidence : w.confidence(fixed(score.confidence));
  const line = (status: string) => [status, ...(score.audit ? [w.audit] : []), `${value}${bounds ? w.bounds(bounds) : ''}`].join(' · ');
  const base = {
    checks, history, vetoes: score.vetoes, audit: score.audit, reasons: score.reasons.filter((reason) => !score.vetoes.includes(reason)),
  };
  switch (score.decision) {
    case 'auto_send': {
      if (card.state !== 'auto_replied') {
        // 自动回复撤回了，或者还没发出去（出站在重试）：卡回到等你处理。
        return { ...base, status: w.autoNotEffective, tone: 'warning', text: line(w.autoNotEffective) };
      }
      const until = card.revokeUntil && Date.parse(card.revokeUntil) > now.getTime() ? clockWords(card.revokeUntil) : null;
      return {
        ...base, status: w.autoReplied, tone: 'success',
        text: [line(w.autoReplied), ...(until ? [w.undoBefore(until)] : [])].join(' · '),
      };
    }
    case 'ask_user':
      return { ...base, status: w.askYou, tone: 'accent', text: line(w.askYou) };
    case 'hand_over':
      // 没查到、失败或被停：没有信心可算，检查明细也没有意义；原因写一次。
      return { ...base, checks: [], history: null, status: w.handOver, tone: 'neutral', text: w.handOverText(why) };
  }
}

/** 代回轨：卡上这份草稿的分数面板优先；没有时按工单（旧的代查）记录里的结论。 */
function replyTrack(card: ChannelCardDto, now: Date, m: Messages): ChannelReplyTrackView | null {
  const lookup = card.lookup;
  const why = lookup?.state === 'failed' ? m.why.failed : lookup?.state === 'cancelled' ? m.why.cancelled : m.why.notFound;
  const scored = card.handling?.reply;
  if (scored) return scoreTrack(card, scored, now, why, m);
  if (!lookup) return null;
  const reply = lookup.reply;
  const confidence = lookup.confidence;
  if (!reply) {
    const waiting = { audit: false, checks: [], history: null, vetoes: [], reasons: [] };
    if (lookup.state === 'queued' || lookup.state === 'running') return { ...waiting, status: m.waitTicket, tone: 'muted', text: m.waitTicket };
    if (lookup.state === 'finished' || lookup.state === 'failed') return { ...waiting, status: m.checking, tone: 'muted', text: m.checking };
    // 被拒、停了：不会有代回的判断，卡上由你决定。
    return null;
  }
  return scoreTrack(card, {
    decision: reply.decision, audit: false, raw: null, confidence: confidence?.value ?? null, threshold: confidence?.threshold ?? null,
    calibration: confidence?.calibration ?? null, checks: confidence?.checks ?? [], vetoes: confidence?.vetoes ?? [], reasons: reply.reasons,
  }, now, why, m);
}

/**
 * 处理轨：授权表的结论，交给 Lead 以后的决定，Lead 推送或者告诉你时写的话。通道没有判断过的旧卡是 null。
 * Lead 还没处理时写「排队中」：没有期限，系统不替 Lead 定（统一消息事件工单 06）。
 */
function handlingView(card: ChannelCardDto, m: Messages, locale: Locale): ChannelHandlingView | null {
  const handling = card.handling;
  if (!handling || (!handling.authority && !handling.lead && !handling.ruleChange)) return null;
  const authority = handling.authority;
  const parts = authority
    ? [...(authority.intent ? [channelPolicyLabels(locale).intent[authority.intent]] : []), m.authority[authority.action]]
    : [];
  const lead = handling.lead;
  let tone: ChannelCardTone = 'neutral';
  let note: string | null = null;
  let reason: string | null = null;
  if (lead && lead.decision === null) {
    // 还在排队等 Lead：要干活、要打扰你的先交给 Lead（intake）；信心模型说问你、交给你的交回 Lead（reply）。
    parts.push(lead.stage === 'reply' ? m.handlingReplyQueue : m.handlingIntakeQueue);
    tone = 'accent';
  } else if (lead?.decision) {
    parts.push(m.lead[lead.decision]);
    if (lead.note && lead.by === 'lead' && (lead.decision === 'push' || lead.decision === 'told')) note = m.leadNote(lead.note);
    else if (lead.note && lead.by === 'system') reason = lead.note;
  }
  const ruleChange = handling.ruleChange ? channelRuleChangeNotice(handling.ruleChange.kinds, locale) : null;
  return { text: parts.join(' · '), tone, note, reason, ruleChange };
}

function staleWords(lookup: ChannelLookupDto, now: Date, m: Messages): string | null {
  const parts: string[] = [];
  if (lookup.newerMessages > 0) parts.push(m.newerMessages(lookup.newerMessages));
  const finishedAt = lookup.finishedAt ? Date.parse(lookup.finishedAt) : Number.NaN;
  if (lookup.result && Number.isFinite(finishedAt) && now.getTime() - finishedAt >= CHANNEL_LOOKUP_STALE_MS) {
    parts.push(m.resultAge(agoWords(now.getTime() - finishedAt, m)));
  }
  return parts.length ? parts.join(m.staleSeparator) : null;
}

function readWords(record: ChannelLookupDto['reads']['items'][number], m: Messages): string {
  const lines = record.lines ? `:${record.lines[0]}-${record.lines[1]}` : '';
  const where = record.path ? `${record.repo} ${record.path}${lines}` : record.repo;
  return `${record.tool} ${where}${record.refused ? m.readRefused(record.refused) : ''}`;
}

/** 卡上的代查（两条轨道和可以展开的部分）。卡结束以后过时提示不再显示。 */
export function channelLookupView(card: ChannelCardDto, lookup: ChannelLookupDto, now: Date, closed: boolean, locale: Locale = 'en'): ChannelLookupView {
  const m = channelCardMessages(locale);
  const result = lookup.result;
  return {
    active: lookup.state === 'queued' || lookup.state === 'running',
    track: lookupTrack(lookup, m),
    actions: (result?.actions ?? []).filter((action) => action.visible).map((action) => ({ text: action.summary, url: action.url })),
    stale: closed ? null : staleWords(lookup, now, m),
    audience: {
      text: `${m.audience(lookup.audience.label)}${lookup.audience.externalShared ? m.audienceExternal : ''}`,
      external: lookup.audience.externalShared,
    },
    reviewSummary: lookup.review?.summary.trim() || null,
    answer: result?.answer.trim() || null,
    sources: [
      ...(result?.sources ?? []).map((source) => ({
        verified: source.verified === true,
        where: `${source.repo} · ${source.path}:${source.startLine}-${source.endLine}`,
        quote: source.quote,
      })),
      // 引用连接查询结果的出处（例如 CDP）：哪个连接、哪个工具。
      ...(result?.connectionSources ?? []).map((source) => ({
        verified: source.verified === true, where: `${source.connection} · ${source.tool}`, quote: source.quote,
      })),
    ],
    checked: result?.checked ?? [],
    checkedVisible: result?.found === 'no',
    caveats: result?.caveats ?? [],
    comments: lookup.review
      ? {
        count: lookup.review.commentCount,
        items: lookup.review.comments.map((comment) => ({ where: `${comment.path}:${comment.line}`, body: comment.body })),
      }
      : null,
    reads: lookup.reads.count > 0
      ? { count: lookup.reads.count, items: lookup.reads.items.map((item) => readWords(item, m)), partial: lookup.reads.items.length < lookup.reads.count }
      : null,
  };
}

export function channelCardView(card: ChannelCardDto, now: Date = new Date(), locale: Locale = 'en'): ChannelCardView {
  const m = channelCardMessages(locale);
  const b = m.badge;
  const trust = m.trust[card.sender.trust];
  const lookup = card.lookup;
  const buttons = buttonsFor(card, m);
  const base = {
    context: `${card.sourceLabel} · ${card.laneLabel}`,
    sender: trust ? m.sender(card.sender.name, trust) : card.sender.name,
    excerpt: card.excerpt,
    more: card.messageCount > 1 ? m.moreMessages(card.messageCount) : null,
    compact: card.delivery === 'digest',
  };
  const open = (badge: ChannelCardView['badge'], note: string | null) => {
    const draft = card.draft?.text ?? null;
    return {
      ...base, draft, // 助手写的草稿（代查、Lead、子 agent）发出时加「confirmed by」署名（hub 的 send_draft）；旧卡上的模板草稿原样发。
      disclosure: draft && card.actions.includes('send_draft') && DISCLOSED_DRAFTERS.has(card.draft?.drafter ?? '')
        ? channelDraftDisclosure(card.lookup?.ownerName ?? null, locale) : null,
      note, badge, buttons, closed: false,
    };
  };
  const ended = (badge: ChannelCardView['badge'], note: string, endButtons: ChannelCardButton[] = []) => ({
    ...base, draft: null, disclosure: null, note, badge, buttons: endButtons, closed: true,
  });
  let view: Omit<ChannelCardView, 'handling' | 'lookup' | 'reply' | 'folded'>;
  switch (card.state) {
    case 'open': {
      // 工单还没结束时，卡上写「进行中」；代回的判断在代回轨上。通道判断过的卡不再写模板闸门的话。
      // Lead 还没处理时写「排队中」，卡上没有草稿（统一消息事件工单 06：草稿只由 Lead 写，不放占位句）。
      const active = lookup?.state === 'queued' || lookup?.state === 'running';
      const queued = card.handling?.lead?.decision === null;
      view = open(active ? { label: b.running, tone: 'accent' } : queued ? { label: b.queued, tone: 'accent' } : { label: b.waiting, tone: 'accent' },
        lookup || card.handling ? null : gateNote(card, m));
      break;
    }
    case 'snoozed':
      view = open({ label: b.snoozed, tone: 'neutral' }, m.snoozeNote(clockWords(card.snoozedUntil)));
      break;
    case 'replying_self':
      // 你在来源里回过一句，但没回答对方（例如只说了收到）：卡还开着，不再推送。
      view = open({ label: b.repliedOnce, tone: 'neutral' }, m.replyingSelfNote(card.sourceLabel));
      break;
    case 'replied': {
      // Lead 照你的话在这个对话里发的消息（2026-10-26）：卡跟着结束，写明是代你发的。
      const how = card.outcome?.by === 'lead' ? m.repliedByLead : m.repliedWithDraft;
      view = ended({ label: b.replied, tone: 'success' }, card.sentText ? m.sentNote(how, card.sentText) : how);
      break;
    }
    case 'auto_replied': {
      const until = card.revokeUntil && Date.parse(card.revokeUntil) > now.getTime() ? clockWords(card.revokeUntil) : null;
      const how = lookup ? m.autoHowLookup : m.autoHowStanding;
      view = ended({ label: b.autoReplied, tone: 'success' }, m.autoNote(how, card.sentText ?? '', until), buttons);
      break;
    }
    case 'resolved_elsewhere':
      view = ended({ label: b.resolvedElsewhere, tone: 'muted' }, m.resolvedElsewhereNote(card.sourceLabel));
      break;
    case 'dismissed':
      view = ended({ label: b.dismissed, tone: 'muted' }, m.dismissedNote);
      break;
    case 'handled':
      view = ended({ label: b.handled, tone: 'success' }, card.outcome?.note ? m.handledNote(card.outcome.note) : m.handledPlain);
      break;
    case 'left_to_user':
      view = ended({ label: b.leftToUser, tone: 'muted' }, m.leftToUserNote);
      break;
  }
  const folded = view.closed && !view.buttons.length
    ? {
      who: m.folded(card.sender.name, oneLine(card.excerpt)),
      outcome: [clockWords(card.resolvedAt ?? card.updatedAt), view.badge.label].filter(Boolean).join(' '),
    }
    : null;
  return {
    ...view, handling: handlingView(card, m, locale), lookup: lookup ? channelLookupView(card, lookup, now, view.closed, locale) : null,
    reply: replyTrack(card, now, m), folded,
  };
}
