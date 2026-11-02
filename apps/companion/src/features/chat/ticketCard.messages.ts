// 会话里嵌入的工单卡（EmbeddedTicketCard.tsx、TicketExecutionCard.tsx）。
import { defineMessages } from '@/i18n';

export const ticketCardMessages = defineMessages({
  en: {
    ticketNumber: (ticketId: number | string) => `Ticket #${ticketId}`,
    openTicket: (ticketId: number | string, title: string) => `Open ticket #${ticketId} ${title}`,
    heartbeatOk: 'The task heartbeat is normal',
    openToSee: 'Open this ticket to see it.',
  },
  zh: {
    ticketNumber: (ticketId) => `工单 #${ticketId}`,
    openTicket: (ticketId, title) => `打开工单 #${ticketId} ${title}`,
    heartbeatOk: '任务心跳正常',
    openToSee: '点开查看这张工单。',
  },
});
