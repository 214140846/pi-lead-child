// 工单详情里所有时间的写法。以前同一页上有 4 种格式（复核 P1-10）：本地化的日期时间、12 小时制的时分、
// 「08-19 17:42」和「2026/8/21 18:48:04」。现在只有这一种：
//   - 今天的只写时分：17:57
//   - 今年更早的带月日：8月21日 18:48
//   - 更早的再带年：2025年12月31日 23:59
// 跨天的记录带日期，不会看起来时间倒流（F17）。
import type { Locale } from '@pi-lead-child/protocol';

import { ticketTimeMessages } from './ticketDetail.messages';

// 按界面语言写（2026-11-01）。设置页和工作区还没迁到多语言，那边的调用不传 locale，按原来的中文写；
// 那边迁完以后去掉缺省值。英文写「Aug 21 18:48」「Dec 31, 2025 23:59」，也是 24 小时制。

/** 一个时间点。 */
export function timeLabel(value: string, now: Date = new Date(), locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = clockTimeLabel(value);
  if (sameLocalDay(date, now)) return time;
  const m = ticketTimeMessages(locale);
  const day = m.monthDay(date.getMonth() + 1, date.getDate());
  return date.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${m.withYear(date.getFullYear(), day)} ${time}`;
}

/** 一段时间：开始 → 结束。同一天结束的只写结束的时分。 */
export function timeRangeLabel(startedAt: string, endedAt: string | null, now: Date = new Date(), locale: Locale): string {
  const start = timeLabel(startedAt, now, locale);
  if (!endedAt) return ticketTimeMessages(locale).inProgress(start);
  const startDate = new Date(startedAt);
  const endDate = new Date(endedAt);
  const end = validDate(startDate) && validDate(endDate) && sameLocalDay(startDate, endDate)
    ? clockTimeLabel(endedAt)
    : timeLabel(endedAt, now, locale);
  return `${start} → ${end}`;
}

/** 几件事跨了几天时只写日期：8月19日–21日、8月30日–9月2日。都在同一天时写那一个时间点。 */
export function dayRangeLabel(startedAt: string, endedAt: string, now: Date = new Date(), locale: Locale): string {
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (!validDate(start) || !validDate(end) || sameLocalDay(start, end)) return timeLabel(endedAt, now, locale);
  const m = ticketTimeMessages(locale);
  const thisYear = start.getFullYear() === now.getFullYear() && end.getFullYear() === now.getFullYear();
  const crossYear = start.getFullYear() !== end.getFullYear();
  const startDay = m.monthDay(start.getMonth() + 1, start.getDate());
  const endDay = crossYear
    ? m.withYear(end.getFullYear(), m.monthDay(end.getMonth() + 1, end.getDate()))
    : start.getMonth() === end.getMonth() ? m.dayOnly(end.getDate()) : m.monthDay(end.getMonth() + 1, end.getDate());
  return m.dayRange(startDay, endDay, thisYear ? null : start.getFullYear(), crossYear);
}

/** 只有时分（24 小时制）。用在日期已经写在分组标题里的行，例如一次 Run 的日志。 */
export function clockTimeLabel(value: string): string {
  const date = new Date(value);
  if (!validDate(date)) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function validDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
