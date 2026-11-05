// 设置 → 免沙箱（工单 #246）和输入框上方标记的纯函数：现在开没开、还剩几分钟、状态的一句话、时长的选项、错误的说法。
// 「开没开」按本机的时间再算一次：到点以后 daemon 的推送还没到，界面也不再显示开着。
import {
  HOST_BYPASS_MINUTE_CHOICES, hostBypassMinutesLeft,
  type HostBypassDto, type Locale,
} from '@pi-lead-child/protocol';

import { intlLocale } from '@/i18n';

import { hostBypassMessages } from './hostBypass.messages';

/** 现在还开着时返回还剩几分钟（至少 1），关着或已经到点时返回 0。 */
export function hostBypassLeft(state: HostBypassDto | null, now: number): number {
  return state ? hostBypassMinutesLeft(state, new Date(now)) : 0;
}

/** 到点的时刻：24 小时制的「15:42」（设计规范 P14.2）。 */
export function hostBypassUntilClock(until: string, locale: Locale): string {
  const at = new Date(until);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** 设置页上状态的一句话：「开着 · 还剩 27 分钟 · 15:42 自动关」或「关着」。 */
export function hostBypassStatusLine(state: HostBypassDto | null, now: number, locale: Locale): string {
  const m = hostBypassMessages(locale);
  const left = hostBypassLeft(state, now);
  return left > 0 && state?.until ? m.on(left, hostBypassUntilClock(state.until, locale)) : m.off;
}

/** 时长的五档。 */
export function hostBypassDurationOptions(locale: Locale) {
  const m = hostBypassMessages(locale);
  return HOST_BYPASS_MINUTE_CHOICES.map((minutes) => ({ value: String(minutes), label: m.minutes(minutes) }));
}

/** 开、关失败时给人看的一句话。 */
export function hostBypassErrorText(reason: unknown, locale: Locale): string {
  const m = hostBypassMessages(locale);
  const status = typeof reason === 'object' && reason !== null && 'status' in reason ? (reason as { status?: unknown }).status : undefined;
  if (status === 403) return m.errorForbidden;
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  return message || m.errorUnknown;
}
