import type { Locale } from '@/i18n';

import { itemOperationMessages } from './itemOperation.messages';

// 审批和决定请求的「谁处理的」（resolvedBy）是后端写的内部字符串，卡片上换成给人看的说法（2026-10-26）。
// 后端会写这几种（engine 的 ui-actions/catalog.ts、daemon 的 Slack 审批、store 的系统作废）：
//   · lead                                   → Lead 的名字
//   · lead for user via turn:<id>            → 「<名字> 代你」
//   · user via page / paired binding:<n> / slack:<id> / 不是我（…）… → 「你」
//   · system: <原因>                          → 「系统」
// 认不出的值原样显示：它可能是旧数据里的人名。
// 文案按界面语言（itemOperation.messages.ts）。
export function resolvedByLabel(resolvedBy: string | null | undefined, leadName: string, locale: Locale): string | null {
  const m = itemOperationMessages(locale);
  const value = resolvedBy?.trim();
  if (!value) return null;
  if (value === 'lead') return leadName;
  if (value.startsWith('lead for user')) return m.resolvedForYou(leadName);
  if (value === 'user' || value.startsWith('user via')) return m.resolvedByYou;
  if (value === 'system' || value.startsWith('system:')) return m.resolvedBySystem;
  return value;
}
