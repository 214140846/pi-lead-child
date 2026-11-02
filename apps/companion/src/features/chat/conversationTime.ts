// 会话里的日期和时间文字。纯函数：不引 React Native，设置页的模型和它们的 node 环境测试也能用（2026-10-22）。
// 按界面语言写（2026-11-01）。
import { intlLocale, type Locale } from '@pi-lead-child/protocol';

import { dateMessages } from './conversationTime.messages';

// 日期分隔线上的字：今天、昨天；更早的写月日和星期，不是今年的再加上年。按本地日历算。
export function formatConversationDate(value: string, now: Date, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (moment: Date) => new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  const m = dateMessages(locale);
  if (days === 0) return m.today;
  if (days === 1) return m.yesterday;
  const sameYear = date.getFullYear() === now.getFullYear();
  if (locale === 'en') {
    // 例如「Thu, Oct 29」，不是今年的「Thu, Oct 29, 2025」。
    return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
  }
  const monthDay = m.monthDay(date.getMonth() + 1, date.getDate(), m.weekdays(date.getDay()));
  return sameYear ? monthDay : m.withYear(date.getFullYear(), monthDay);
}

// 两种语言都写 24 小时制的「14:00」（设计规范 P14.2）。
export function formatConversationTime(value: string, timeZone: string | undefined, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
