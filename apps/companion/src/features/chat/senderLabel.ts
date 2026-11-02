// 会话里 Lead 一侧消息的发送者标签。Lead 的回合写 Lead 的名字（设置 → 身份与风格），lead 自己发起的回合
// （blocker、即时通知、心跳、整理笔记）也一样。daemon 自己写的系统通知不是 Lead 在说话，标签和 plc chat 用的是
// 同一个函数（protocol 的 systemTurnLabel）。
// 「是不是系统通知」看来源（isDaemonNoticeOrigin），不看标签文字：Lead 的名字可以是任何字。
import { isDaemonNoticeOrigin, systemTurnLabel } from '@pi-lead-child/protocol';

import type { Locale } from '@/i18n';

import { leadNameNow } from '../../state/leadName';

/** daemon 自己写的系统通知的标签，例如「系统通知 · blocker」。Lead 的回合（用户发起的、Lead 自己发起的）返回 null。 */
// locale 是界面语言。state 里还有不传它的调用（测试），缺省英文。
export function systemNoticeLabel(originKind: string | null | undefined, locale: Locale = 'en'): string | null {
  return isDaemonNoticeOrigin(originKind) ? systemTurnLabel(originKind, locale) : null;
}

/** 发送者标签：系统通知写「系统通知 …」，Lead 的回合写 Lead 的名字。组件传 useLeadName() 的结果。 */
export function leadSenderLabel(originKind: string | null | undefined, name: string = leadNameNow(), locale: Locale = 'en'): string {
  return systemNoticeLabel(originKind, locale) ?? name;
}
