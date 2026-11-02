// 设置 → 消息通道 → 自动代你处理（交接说明，方案 B，2026-10-30，.scratch/auto-handling-handbook issue 07）的视图模型。
// 契约在 protocol 的 channel-handbook.ts。这里只做纯函数：分段、改一句、改上限、加一句、删一句、预演结果的文字、整理结果的文字、
// 页边批注的文字。
// 改动都返回改完以后的一整份交接说明，页面把它交给 PUT /v1/channels/handbook（操作层的 channel_handbook.update）。
import {
  HANDBOOK_CAP_SENDERS, HANDBOOK_CUSTOMER_CAP_MAX, HANDBOOK_FALLBACK_ID, HANDBOOK_FLOORS, HANDBOOK_MODES, HANDBOOK_SECTIONS,
  handbookLabels, handbookModeCovers, handbookModePhrase, handbookModeWorks,
  type ChannelHandbook, type ChannelHandbookDto, type HandbookAbility, type HandbookCapSender, type HandbookMode, type HandbookProposal,
  type HandbookRehearsal, type HandbookSuggestion, type HandbookSuggestions,
  type HandbookRehearsalSender, type HandbookSection, type HandbookSituation, type Locale,
} from '@pi-lead-child/protocol';

import { handbookMessages } from './handbook.messages';

export { HANDBOOK_CAP_SENDERS, HANDBOOK_FLOORS };

// 下面的 locale 都是界面语言（useLocale）。做法、段落、能力、上限、底线的名字取 protocol 的 handbookLabels。

/** 一句里能选的做法：放手、做好给你看、交给你、只告诉你、婉拒。detail 写这样选以后助手做什么。 */
export function modeOptions(leadName: string, locale: Locale): Array<{ mode: HandbookMode; detail: string }> {
  const m = handbookMessages(locale);
  return HANDBOOK_MODES.map((mode) => ({ mode, detail: m.modeDetail[mode](leadName) }));
}

/** 对方的上限能选的做法（婉拒不是上限）。客户最宽到「交给你」：外部客户永不代回（硬性规则）。 */
export function capOptions(sender: HandbookCapSender, leadName: string, locale: Locale): Array<{ mode: HandbookMode; detail: string; disabled: string | null }> {
  const m = handbookMessages(locale);
  return modeOptions(leadName, locale).filter((option) => option.mode !== 'refuse').map((option) => ({
    ...option,
    disabled: sender === 'customer' && !handbookModeCovers(HANDBOOK_CUSTOMER_CAP_MAX, option.mode) ? m.customerLocked : null,
  }));
}

/** 段落按显示顺序，只列有句子的段。「你加的」排在「其他」前面。 */
export function handbookSections(handbook: ChannelHandbook, locale: Locale): Array<{ section: HandbookSection; title: string; situations: HandbookSituation[] }> {
  const labels = handbookLabels(locale);
  return HANDBOOK_SECTIONS
    .map((section) => ({ section, title: labels.section[section], situations: handbook.situations.filter((item) => item.section === section) }))
    .filter((group) => group.situations.length > 0);
}

/** 句子的前半截（下划线短语前面的话）：「有人请我排查或修复问题，比如「帮我处理一下 PROJ-6651」，你」。 */
export function sentenceLead(situation: Pick<HandbookSituation, 'text' | 'example'>, locale: Locale): string {
  return handbookLabels(locale).sentenceLead(situation.text, situation.example);
}

export const modePhrase = (situation: Pick<HandbookSituation, 'autoPhrase'>, mode: HandbookMode, locale: Locale): string =>
  handbookModePhrase(situation, mode, locale);
export const modeLabel = (mode: HandbookMode, locale: Locale): string => handbookLabels(locale).mode[mode];
export const capLead = (sender: HandbookCapSender, locale: Locale): string => handbookMessages(locale).capLead(handbookLabels(locale).cap[sender]);
/** 底线的一句，按界面语言。 */
export const floorText = (id: typeof HANDBOOK_FLOORS[number]['id'], locale: Locale): string => handbookLabels(locale).floor[id];

export function withMode(handbook: ChannelHandbook, id: string, mode: HandbookMode): ChannelHandbook {
  return { ...handbook, situations: handbook.situations.map((item) => (item.id === id ? { ...item, mode } : item)) };
}

export function withExceptionMode(handbook: ChannelHandbook, id: string, mode: HandbookMode): ChannelHandbook {
  return {
    ...handbook,
    situations: handbook.situations.map((item) => (item.id === id && item.exception ? { ...item, exception: { ...item.exception, mode } } : item)),
  };
}

export function withCap(handbook: ChannelHandbook, sender: HandbookCapSender, mode: HandbookMode): ChannelHandbook {
  return { ...handbook, caps: { ...handbook.caps, [sender]: mode } };
}

export function withSwitch(handbook: ChannelHandbook, on: boolean): ChannelHandbook {
  return { ...handbook, autoReply: on };
}

/** 加一句的输入。does 和 abilities 来自「帮我整理」，自己写的一句没有：助手按做法自己判断。 */
export interface AddInput {
  text: string;
  example: string;
  mode: HandbookMode;
  does?: string;
  abilities?: HandbookAbility[];
}

/** 加一句（「你加的」一段，排在兜底的一句前面）。编号 mine_1、mine_2……，不和已有的重复。做法不去做事时不带「会做什么」和能力。 */
export function withAdded(handbook: ChannelHandbook, input: AddInput): ChannelHandbook {
  const ids = new Set(handbook.situations.map((item) => item.id));
  let n = 1;
  while (ids.has(`mine_${n}`)) n += 1;
  const works = handbookModeWorks(input.mode);
  const does = works ? input.does?.trim() ?? '' : '';
  const added: HandbookSituation = {
    id: `mine_${n}`, section: 'mine', text: input.text.trim(), mode: input.mode, abilities: works ? [...(input.abilities ?? [])] : [],
    ...(input.example.trim() ? { example: input.example.trim() } : {}),
    ...(does ? { does } : {}),
  };
  const at = handbook.situations.findIndex((item) => item.id === HANDBOOK_FALLBACK_ID);
  const situations = [...handbook.situations];
  situations.splice(at < 0 ? situations.length : at, 0, added);
  return { ...handbook, situations };
}

export function withoutSituation(handbook: ChannelHandbook, id: string): ChannelHandbook {
  return { ...handbook, situations: handbook.situations.filter((item) => item.id !== id || item.id === HANDBOOK_FALLBACK_ID) };
}

/** 加一句下面的一行：会做什么、能用哪些能力。做法不去做事、或者两样都没有时是 null。 */
export function addedMeta(input: Pick<AddInput, 'mode' | 'does' | 'abilities'>, leadName: string, locale: Locale): string | null {
  if (!handbookModeWorks(input.mode)) return null;
  const does = input.does?.trim() ?? '';
  const labels = handbookLabels(locale);
  const abilities = (input.abilities ?? []).map((ability) => labels.ability[ability]);
  if (!does && !abilities.length) return null;
  return handbookMessages(locale).addedMeta(leadName, does, abilities);
}

/** 「帮我整理」的结果：填进表单的一句（整理不出来时是 null），和一句说明。 */
export function proposalView(result: HandbookProposal, locale: Locale): { fill: Omit<AddInput, 'example'> & { example: string } | null; note: string | null } {
  if (result.status !== 'ok' || !result.situation) return { fill: null, note: result.note ?? handbookMessages(locale).proposalUnclear };
  const { text, example, mode, does, abilities } = result.situation;
  return { fill: { text, example: example ?? '', mode, does: does ?? '', abilities: [...abilities] }, note: result.note };
}

/** 页边批注（issue 08）的一句话和按钮上的字。放宽：哪一句，放宽到什么；加一句：依据和要加的那一句。 */
export function suggestionView(suggestion: HandbookSuggestion, locale: Locale): { text: string; accept: string } {
  const m = handbookMessages(locale);
  if (suggestion.kind === 'loosen' && suggestion.to) {
    return { text: m.loosen(suggestion.basis, modePhrase({}, suggestion.to, locale)), accept: m.loosenAccept };
  }
  const proposed = suggestion.proposed;
  const sentence = proposed ? m.proposedSentence(proposed.text, proposed.example, modePhrase({}, proposed.mode, locale)) : '';
  return { text: m.addSentence(suggestion.count, suggestion.basis, sentence), accept: m.addAccept };
}

/** 一句下面的页边批注（放宽的建议）。 */
export const loosenFor = (suggestions: HandbookSuggestions | null, id: string): HandbookSuggestion | null =>
  suggestions?.suggestions.find((item) => item.kind === 'loosen' && item.situation?.id === id) ?? null;

/** 底线下面一行：最近 7 天拦下几次。这里数不到的（null）不写。 */
export function floorCountText(suggestions: HandbookSuggestions | null, id: keyof HandbookSuggestions['floors'], locale: Locale): string | null {
  const count = suggestions?.floors[id];
  if (count === null || count === undefined) return null;
  const m = handbookMessages(locale);
  return count ? m.floorCount(count) : m.floorNone;
}

/** 加一句的输入有没有问题。没有问题时是 null。 */
export function addProblem(text: string, example: string, locale: Locale): string | null {
  const m = handbookMessages(locale);
  if (!text.trim()) return m.addNoText;
  if (text.trim().length > 120) return m.addTextTooLong;
  if (example.trim().length > 120) return m.addExampleTooLong;
  return null;
}

/** 依据：存在哪一版，谁写的。 */
export function orderLine(dto: ChannelHandbookDto, leadName: string, locale: Locale): string {
  const m = handbookMessages(locale);
  if (!dto.order) return m.orderDefault;
  const who = dto.order.author === 'user' ? m.orderByUser : dto.order.author === 'lead' ? m.orderByLead(leadName) : m.orderBySystem;
  return m.orderLine(dto.order.version, who);
}

/** 最新版本里写的、但没有生效的句子（例如 Lead 写的放宽，要你本人改才生效）。 */
export function notInEffect(dto: ChannelHandbookDto, locale: Locale): string[] {
  const m = handbookMessages(locale);
  return dto.requested.situations.flatMap((wanted) => {
    const effective = dto.handbook.situations.find((item) => item.id === wanted.id);
    return effective && effective.mode !== wanted.mode ? [m.notInEffect(wanted.text, modeLabel(wanted.mode, locale))] : [];
  });
}

const REHEARSAL_SENDER_ORDER: readonly HandbookRehearsalSender[] = ['colleague', 'external', 'customer', 'unknown'];

/** 预演时假设的对方，按显示顺序。 */
export function rehearsalSenders(locale: Locale): Array<{ value: HandbookRehearsalSender; label: string }> {
  const m = handbookMessages(locale);
  return REHEARSAL_SENDER_ORDER.map((value) => ({ value, label: m.senders[value] }));
}

/** 预演卡上的样例消息。 */
export function rehearsalExamples(locale: Locale): string[] {
  return Object.values(handbookMessages(locale).rehearsalExamples);
}

/** 预演结果的几行字：按哪一句、被什么压过、最后助手做什么，和收件判断的情况。 */
export function rehearsalView(result: HandbookRehearsal, leadName: string, locale: Locale): {
  sentence: string; override: string | null; ruleChange: string | null; outcome: string; detail: string; tone: 'warning-dark' | 'secondary';
} {
  const m = handbookMessages(locale);
  const recorded = result.action === 'skip';
  // 这一句没有派活的能力、做法是放手（例如兜底的「自己判断，拿不准再问我」）：Lead 自己判断，不是「去做」。
  const ownJudgement = result.final === 'auto' && result.action === 'ask';
  return {
    sentence: m.rehearsalSentence(result.situation.text, result.phrase ?? modeLabel(result.mode, locale)),
    override: result.by !== 'sentence' && result.limit ? m.rehearsalOverride(result.limit, modeLabel(result.final, locale)) : null,
    // 底线 4：上限不变，多一行说明。
    ruleChange: result.ruleChange ? m.rehearsalRuleChange(leadName) : null,
    outcome: recorded ? m.rehearsalRecorded(result.reason)
      : ownJudgement ? m.rehearsalOwnJudgement(leadName) : m.outcome[result.final](leadName),
    detail: result.status === 'answered'
      ? m.rehearsalDetail(result.backend ?? m.fastModel, result.ms)
      : m.rehearsalFailed(result.error ?? m.fastModelUnavailable),
    tone: result.status === 'answered' ? 'secondary' : 'warning-dark',
  };
}

/** 读、改、预演失败时的一句话。 */
export function handbookErrorText(reason: unknown, locale: Locale): string {
  const m = handbookMessages(locale);
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/404|not found/i.test(message)) return m.daemonOld;
  return message || m.unknownError;
}
