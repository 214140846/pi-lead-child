// 设置 → 消息通道 → 代回复风格（2026-10-28）的纯函数：字数、追加以后的整段、依据的一句话、错误的说法。
// 追加以后的整段和长度检查用 protocol 的同一套函数（nextReplyStyleText、replyStyleProblem），和 daemon 算的一样。
import {
  REPLY_STYLE_EXTRACT_DAY_CHOICES, REPLY_STYLE_TEXT_MAX_LENGTH, nextReplyStyleText, normalizeReplyStyleText, replyStyleLength, replyStyleProblem,
  type Locale, type ReplyStyleDto, type ReplyStyleExtractResult,
} from '@pi-lead-child/protocol';

import { replyStyleMessages } from './replyStyle.messages';

/** 提炼天数的选项，按界面语言。 */
export function replyStyleDayOptions(locale: Locale) {
  const m = replyStyleMessages(locale);
  return REPLY_STYLE_EXTRACT_DAY_CHOICES.map((days) => ({ value: String(days), label: m.days(days) }));
}

/** 框里的字数一行：「120 / 2000 字」。 */
export function replyStyleCountLine(text: string, locale: Locale): string {
  return replyStyleMessages(locale).count(replyStyleLength(normalizeReplyStyleText(text)), REPLY_STYLE_TEXT_MAX_LENGTH);
}

/** 框里的字有没有改过（按整理以后的文字比）。 */
export function replyStyleChanged(draft: string, saved: ReplyStyleDto): boolean {
  return normalizeReplyStyleText(draft) !== saved.text;
}

/** 追加以后的整段有什么问题（例如超了上限）。没有问题时返回 null。 */
export function replyStyleAppendProblem(saved: ReplyStyleDto, addition: string, label: string, now: Date, locale: Locale): string | null {
  const request = { mode: 'append' as const, text: addition, label };
  return replyStyleProblem(request, nextReplyStyleText(saved.text, request, now), locale);
}

/** 追加以后的总字数。 */
export function replyStyleAppendedLength(saved: ReplyStyleDto, addition: string, label: string, now: Date): number {
  return replyStyleLength(nextReplyStyleText(saved.text, { mode: 'append', text: addition, label }, now));
}

const day = (iso: string | null): string | null => {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};

/** 依据的一句话：「依据：你本人的 87 条消息，30 个对话，10-21 到 10-28。去掉了 2 行（抄了原文或者带着人名）。」 */
export function replyStyleBasisLine(result: ReplyStyleExtractResult, locale: Locale): string {
  const m = replyStyleMessages(locale);
  const { basis } = result;
  const from = day(basis.from);
  const to = day(basis.to);
  const span = from && to ? (from === to ? m.spanOne(from) : m.spanRange(from, to)) : '';
  const line = m.basis(basis.days, basis.messages, basis.conversations, span);
  return result.dropped ? `${line}${m.sentenceGap}${m.dropped(result.dropped)}` : line;
}

/** 保存和提炼失败时给人看的一句话。 */
export function replyStyleErrorText(reason: unknown, locale: Locale): string {
  const m = replyStyleMessages(locale);
  const status = typeof reason === 'object' && reason !== null && 'status' in reason ? (reason as { status?: unknown }).status : undefined;
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (status === 403) return m.errorForbidden;
  if (status === 400) return message || m.errorInvalid;
  if (status === 409) return m.errorConflict(message || m.tryAgain);
  if (message === 'this client cannot manage channel settings') return m.errorOldClient;
  return message || m.errorUnknown;
}
