// Lead 改日程和工单的工具做完以后，用白话说它做了什么（「提醒 #83 已创建」）。
// 失败行（failurePresentation）和会话里的事项卡片用同一套说法。认不得的工具返回 null，由调用方计数或略过。
// 文案按界面语言（itemOperation.messages.ts）。
import type { Locale } from '@/i18n';

import { itemOperationMessages } from './itemOperation.messages';

export function itemOperationDoneWords(name: string, itemId: number | string | null, locale: Locale = 'en'): string | null {
  const done = itemOperationMessages(locale).done;
  if (!Object.prototype.hasOwnProperty.call(done, name)) return null;
  return done[name as keyof typeof done](itemId === null ? null : String(itemId));
}

// 只对提醒做的操作。卡片据此在还没取到事项时就按提醒来画。
export const REMINDER_OPERATIONS: ReadonlySet<string> = new Set(['create_reminder', 'reschedule_reminder', 'ack_reminder']);

// 一张提醒卡上，后来的操作是什么事件。新建不另说：卡片本身就是新建的那条提醒。leadName 是 Lead 的名字。
export function reminderEventWords(name: string, leadName: string, locale: Locale = 'en'): string | null {
  const m = itemOperationMessages(locale);
  if (name === 'reschedule_reminder') return m.reminderRescheduled(leadName);
  if (name === 'cancel_item') return m.reminderCancelled(leadName);
  if (name === 'ack_reminder') return m.reminderAcknowledged(leadName);
  return null;
}
