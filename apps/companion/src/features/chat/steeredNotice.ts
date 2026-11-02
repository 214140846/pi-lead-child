// 插话（steered）轮次的渲染判定。抽成纯函数才测得到。
//
// 用户在 lead 还在跑的时候发消息，系统不会新开一轮，而是把这句"插"进正在进行的那一轮。
// daemon 现在会把 assistant 的出水口改接到插话这一轮上（src/daemon/server.ts 的
// routeAssistantText）——所以插话之后 lead 说的话就长在用户那句话下面，是一个正常气泡。
// 只剩一种情况还是空的：插话送达之后 lead 一句话没说就把当前回合收尾了。那条记录停在
// state='steered' 且没有任何内容，渲染成气泡就是一个永远空的框，用户由此以为 lead 死了
// （实测那次：assistant_text 长度 0，created→updated 相差 3ms）。
// CLI 早就处理对了（src/cli.ts:157 打印"（已插话，lead 将在当前步骤后看到）"），这里给同一句。
//
// 工单 04（spec D10）：daemon 说明了这条消息怎么放的（placement）时按它写：
//   · answered_together：它没有自己的回答，Lead 把它和后面那一条一起答了（结局是 done，不是失败）；
//   · next_turn：插话赶不上这一轮，Lead 答完这一轮以后接着答它。
import type { TurnPlacement } from '@pi-lead-child/protocol';

import type { Locale } from '@/i18n';

import { conversationMessages } from './conversation.messages';

// 提示里的 leadName 是 Lead 的名字（useLeadName）。文字按界面语言（conversation.messages.ts）。
export function steeredNotice(leadName: string, locale: Locale): string {
  return conversationMessages(locale).steered.steered(leadName);
}
export function answeredTogetherNotice(locale: Locale): string {
  return conversationMessages(locale).steered.answeredTogether;
}
export function nextTurnNotice(leadName: string, locale: Locale): string {
  return conversationMessages(locale).steered.nextTurn(leadName);
}

export function steeredNoticeFor(
  message: { role: string; state: string; },
  hasContent: boolean,
  placement: TurnPlacement | null,
  leadName: string,
  locale: Locale,
): string | null {
  if (message.role === 'user') return null;
  if (hasContent) return null; // 插话自己拿到了回答，就按普通助手消息渲染
  if (message.state !== 'steered') return null;
  // 取消了的追问也停在 steered，但它没有发给 Lead，不是插话（主题 11.13）。
  if (placement === 'cancelled') return null;
  if (placement === 'answered_together') return answeredTogetherNotice(locale);
  if (placement === 'next_turn') return nextTurnNotice(leadName, locale);
  return steeredNotice(leadName, locale);
}

// 用户的消息下面写它现在怎么放的（spec D10）：排队中、已插入、下一轮回答。这一轮开始答它或者已经有结局时不写。
export function placementCopyFor(
  turn: { state: string; placement?: TurnPlacement | null } | null | undefined,
  leadName: string,
  locale: Locale,
): string | null {
  const m = conversationMessages(locale).steered;
  if (!turn?.placement) return null;
  // 你在状态栏上点了「×」（主题 11.13）：这句话留在会话里，但不会再发给 Lead，也没有回答。
  if (turn.placement === 'cancelled') return m.cancelled(leadName);
  if (turn.state === 'completed' || turn.state === 'failed') return null;
  if (turn.placement === 'queued' && turn.state === 'queued') return m.queued(leadName);
  if (turn.placement === 'steered' && turn.state === 'steered') return m.steeredIn;
  if (turn.placement === 'next_turn') return m.nextTurnShort;
  return null;
}
