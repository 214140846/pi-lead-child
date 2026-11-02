// 设置 → 连接的纯函数：分组、状态的写法、时间的写法、角色、错误原因。界面组件只调这里，不自己拼文字。
import {
  intlLocale,
  type ConnectionDto, type ConnectionProblem, type ConnectionProvider, type ConnectionRole, type Locale,
} from '@pi-lead-child/protocol';

import { clockTimeLabel, timeLabel } from '@/features/tickets/timeLabels';

import { connectionsMessages } from './connections.messages';

// leadName 是 Lead 的名字（useLeadName）。
export function connectionsDescription(leadName: string, locale: Locale): string {
  return connectionsMessages(locale).description(leadName);
}

// 一个时间点。中文沿用工单详情的写法（timeLabels）；英文用 Intl，24 小时制：今天只写时分，今年更早的带月日，更早的再带年。
export function connectionTimeLabel(value: string, now: Date, locale: Locale): string {
  if (locale === 'zh') return timeLabel(value, now, locale);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = clockTimeLabel(value);
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return time;
  const day = new Intl.DateTimeFormat(intlLocale(locale), {
    month: 'short', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
  return `${day}, ${time}`;
}

export type ConnectionGroupId = 'connected' | 'available' | 'setup';

export type ConnectionGroup = { id: ConnectionGroupId; label: string; items: ConnectionDto[] };

export function connectionGroupOf(connection: ConnectionDto): ConnectionGroupId {
  if (connection.state === 'connected' || connection.state === 'degraded' || connection.state === 'needs_reauth') return 'connected';
  if (connection.state === 'not_connected') return 'available';
  return 'setup';
}

// 三组：已连接、可以连接、需要额外设置。空的组不返回。「即将支持」排在需要设置的后面。
// pinned：正在走连接流程的那一个留在原来的组里。不然它连上的那一刻换到「已连接」组，
// 行下面的连接流程会重新开始，看不到「已连接」那一步。
export function groupConnections(
  items: readonly ConnectionDto[],
  pinned: { key: string; group: ConnectionGroupId } | null,
  locale: Locale,
): ConnectionGroup[] {
  const labels = connectionsMessages(locale).groups;
  const groupOf = (item: ConnectionDto) => (pinned && item.key === pinned.key ? pinned.group : connectionGroupOf(item));
  const groups: ConnectionGroup[] = (['connected', 'available', 'setup'] as const).map((id) => ({
    id, label: labels[id], items: items.filter((item) => groupOf(item) === id),
  }));
  const setup = groups[2]!;
  setup.items = [...setup.items.filter((item) => item.state !== 'unavailable'), ...setup.items.filter((item) => item.state === 'unavailable')];
  return groups.filter((group) => group.items.length > 0);
}

// 要你处理：授权失效了，或者授权快到期。和 daemon 的 attention 同一条规则。
export function connectionNeedsUser(connection: ConnectionDto): boolean {
  return connection.state === 'needs_reauth' || connection.problem?.kind === 'expiring';
}

export function attentionConnections(items: readonly ConnectionDto[]): ConnectionDto[] {
  return items.filter(connectionNeedsUser);
}

export function attentionMessage(connection: ConnectionDto, locale: Locale): string {
  return connection.problem?.message ?? connectionsMessages(locale).needsReauth(connection.label);
}

export type ConnectionStatus = { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' };

// 行右边的状态。可以连接的服务没有状态，右边是「连接」按钮。
export function connectionStatus(connection: ConnectionDto, locale: Locale): ConnectionStatus | null {
  const m = connectionsMessages(locale).status;
  switch (connection.state) {
    case 'connected': return { label: m.connected, tone: 'success' };
    case 'degraded': return { label: m.degraded, tone: 'warning' };
    case 'needs_reauth': return { label: m.needsReauth, tone: 'danger' };
    case 'unavailable': return { label: m.unavailable, tone: 'muted' };
    default: return null;
  }
}

// 行的第二行字和它的颜色。
export function connectionSecondLine(
  connection: ConnectionDto, locale: Locale, now: Date = new Date(),
): { text: string; tone: 'secondary' | 'warning-dark' | 'danger-dark' } {
  if (connection.state === 'needs_reauth') return { text: attentionMessage(connection, locale), tone: 'danger-dark' };
  if (connection.state === 'degraded') return { text: connection.problem?.message ?? connectionsMessages(locale).degradedLine, tone: 'warning-dark' };
  if (connection.problem?.kind === 'expiring') return { text: connection.problem.message, tone: 'warning-dark' };
  if (connection.state === 'connected') {
    const used = lastUsedLabel(connection.lastUsedAt, locale, now);
    return { text: connection.account ? `${connection.account} · ${used}` : used, tone: 'secondary' };
  }
  if (connection.state === 'not_connected') return { text: connection.capability, tone: 'secondary' };
  return { text: connection.setupHint ?? connection.capability, tone: 'secondary' };
}

// 上次用的时间：一小时以内写几分钟前，更早的写时间点（timeLabels 的写法）。
export function lastUsedLabel(lastUsedAt: string | null, locale: Locale, now: Date = new Date()): string {
  const m = connectionsMessages(locale).lastUsed;
  if (!lastUsedAt) return m.never;
  const at = Date.parse(lastUsedAt);
  if (Number.isNaN(at)) return m.never;
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 1) return m.justNow;
  if (minutes < 60) return m.minutesAgo(minutes);
  return m.at(connectionTimeLabel(lastUsedAt, now, locale));
}

// 授权一节的「续期」。
export function renewalLabel(connection: ConnectionDto, locale: Locale, now: Date = new Date()): string | null {
  const m = connectionsMessages(locale).renewal;
  switch (connection.tokenSource) {
    case 'oauth': {
      const last = connection.lastRefreshAt ?? connection.connectedAt;
      return last ? m.autoLast(connectionTimeLabel(last, now, locale)) : m.auto;
    }
    case 'gh_cli': return m.ghCli;
    case 'device': return m.device;
    case 'pat': return m.pat;
    default: return null;
  }
}

// 访问令牌还有多久到期。两小时以内写分钟，更久的写小时。
export function accessExpiryLabel(accessExpiresAt: string, locale: Locale, now: Date = new Date()): string {
  const m = connectionsMessages(locale).accessExpiry;
  const minutes = Math.ceil((Date.parse(accessExpiresAt) - now.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes <= 0) return m.expired;
  if (minutes < 120) return m.minutes(minutes);
  return m.hours(Math.floor(minutes / 60));
}

// 暂时连不上时的一句话。
export function retryLabel(problem: ConnectionProblem | null, locale: Locale): string {
  const m = connectionsMessages(locale);
  const at = problem?.nextAttemptAt ? clockTimeLabel(problem.nextAttemptAt) : '';
  return at ? m.retryAt(at) : m.degradedLine;
}

export function toolCountLabel(tools: NonNullable<ConnectionDto['tools']>, locale: Locale): string {
  return connectionsMessages(locale).toolCount(tools.total, tools.readOnly, tools.write);
}

const CONNECTION_ROLE_ORDER: readonly ConnectionRole[] = ['lead', 'executor', 'reviewer'];

// 谁可以用这个连接：每个角色和它的说法。lead 那一行写 Lead 的名字（leadName）。
export function connectionRoles(leadName: string, locale: Locale): readonly { role: ConnectionRole; label: string }[] {
  const m = connectionsMessages(locale).roles;
  const labels: Record<ConnectionRole, string> = {
    lead: leadName,
    executor: m.executor,
    reviewer: m.reviewer,
  };
  return CONNECTION_ROLE_ORDER.map((role) => ({ role, label: labels[role] }));
}

// 打开或关掉一个角色。顺序固定，和 connectionRoles 一致。
export function toggleRole(roles: readonly ConnectionRole[], role: ConnectionRole, on: boolean): ConnectionRole[] {
  const next = new Set(roles);
  if (on) next.add(role);
  else next.delete(role);
  return CONNECTION_ROLE_ORDER.filter((item) => next.has(item));
}

// 连上以后「试一下」的一句话。
export function tryPrompt(provider: ConnectionProvider, label: string, locale: Locale): string {
  const m = connectionsMessages(locale).tryPrompt;
  switch (provider) {
    case 'atlassian': return m.atlassian;
    case 'notion': return m.notion;
    case 'github': return m.github;
    case 'slack': return m.slack;
    default: return m.other(label);
  }
}

// GitHub 不用浏览器授权（用 gh 的登录、设备码或令牌），别的服务都会打开授权页。
export function opensBrowser(provider: ConnectionProvider): boolean {
  return provider !== 'github';
}

// 写入确认只带 key。预设服务的 key 就是服务名，自定义服务器是 custom-<id>。
export function providerForKey(key: string, items: readonly ConnectionDto[] = []): ConnectionProvider {
  const known = items.find((item) => item.key === key);
  if (known) return known.provider;
  const preset: readonly ConnectionProvider[] = ['atlassian', 'notion', 'github', 'slack', 'google'];
  return preset.includes(key as ConnectionProvider) ? key as ConnectionProvider : 'custom';
}

// 网关错误里的原因（body.error.details.reason），例如 needs_setup、temporarily_unavailable。
export function connectionErrorReason(reason: unknown): string | null {
  const body = typeof reason === 'object' && reason !== null ? (reason as { body?: unknown }).body : null;
  const details = (body as { error?: { details?: { reason?: unknown } } } | null)?.error?.details;
  return typeof details?.reason === 'string' ? details.reason : null;
}

// 给你看的错误。网关的 message 原样显示。
// locale 可选：会话里的连接卡（features/genui）还没迁到多语言，不传时按原来的中文写；迁完以后去掉缺省值。
export function connectionErrorText(reason: unknown, locale: Locale): string {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  return message || connectionsMessages(locale).requestFailed;
}

// 自定义 MCP 服务器的地址：先在这里挡住明显不对的，别的由 daemon 检查。
export function serverUrlProblem(input: string, locale: Locale): string | null {
  const m = connectionsMessages(locale).urlProblem;
  const value = input.trim();
  if (!value) return m.empty;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return m.notUrl;
  }
  if (url.protocol !== 'https:') return m.notHttps;
  return null;
}

// 授权页地址里给人看的部分，例如 github.com/login/device。
export function displayUrl(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// 一个时间点之前还有几分钟（至少 1）。
export function minutesUntil(value: string, now: Date = new Date()): number | null {
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(1, Math.ceil((at - now.getTime()) / 60_000));
}
