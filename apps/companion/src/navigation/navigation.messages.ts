// 原生底栏的标签和各个列表页（app/(tabs)）的标题、说明。app/ 里的文件都会被当成路由，目录放在这里。
import { defineMessages } from '@/i18n';

export const navigationMessages = defineMessages({
  en: {
    conversation: 'Conversation',
    tickets: 'Tickets',
    projects: 'Projects',
    agenda: 'Agenda',
    agendaSubtitle: 'Overdue items are at the top. Today and later items are below.',
    projectsSubtitle: 'Active projects come first. Quiet and archived projects are below.',
    ticketsSubtitle: (leadName: string) => `Work tickets that ${leadName} creates and supervises`,
  },
  zh: {
    conversation: '对话',
    tickets: '工单',
    projects: '项目',
    agenda: '日程',
    agendaSubtitle: '过期的在上面，今天和接下来的在下面',
    projectsSubtitle: '在推进的在前，安静的和归档的收在下面',
    ticketsSubtitle: (leadName) => `${leadName} 创建和监督的任务工作单`,
  },
});
