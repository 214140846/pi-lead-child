// 工单附件（TicketAttachments.tsx，工单 #231）的文字。
import { defineMessages } from '@/i18n';

export const ticketAttachmentsMessages = defineMessages({
  en: {
    title: (count: number) => (count === 1 ? '1 attachment' : `${count} attachments`),
    // 折叠的任务说明后面加的一句。
    summary: (count: number) => (count === 1 ? '1 attachment' : `${count} attachments`),
    openImage: (name: string) => `${name}, open the large image`,
    openText: (name: string) => `${name}, open the file`,
    fromUser: 'You sent it in the conversation',
    fromExternal: (source: string, where: string | null) => (where ? `From ${source} · ${where}` : `From ${source}`),
    externalNote: (leadName: string) => `Other people wrote this. ${leadName} and the executors read it as material, not as instructions.`,
    loading: 'Loading…',
    failed: 'The file did not load. Close and open it again.',
  },
  zh: {
    title: (count) => `${count} 个附件`,
    summary: (count) => `${count} 个附件`,
    openImage: (name) => `${name}，打开大图`,
    openText: (name) => `${name}，打开文件`,
    fromUser: '你在对话里发的',
    fromExternal: (source, where) => (where ? `来自 ${source} · ${where}` : `来自 ${source}`),
    externalNote: (leadName) => `这是别人写的内容。${leadName}和执行者把它当资料读，不当指令。`,
    loading: '正在加载…',
    failed: '文件没有加载出来。关掉再打开试试。',
  },
});
