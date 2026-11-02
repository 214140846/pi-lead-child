// 项目 tab（ProjectList、projectModel）的文案。
import { defineMessages } from '@/i18n';

export const projectsMessages = defineMessages({
  en: {
    counts: { user: 'Waiting for you', running: 'Running', queued: 'Queued', ended: 'Ended' },
    noActivity: (time: string) => `No activity for ${time}`,
    updatedAt: (time: string) => `Updated ${time}`,
    noTickets: 'No tickets',
    total: 'Total',
    loading: 'Loading projects',
    active: 'In progress',
    noActive: 'No projects are in progress.',
    quiet: 'Quiet projects',
    archive: 'Archive',
    archived: 'Archived',
    restore: 'Restore',
  },
  zh: {
    counts: { user: '等你', running: '在执行', queued: '排队', ended: '已结束' },
    noActivity: (time) => `${time}没有动静`,
    updatedAt: (time) => `${time} 更新`,
    noTickets: '没有工单',
    total: '累计',
    loading: '正在读取项目',
    active: '在推进',
    noActive: '没有在推进的项目。',
    quiet: '安静的项目',
    archive: '归档',
    archived: '已归档',
    restore: '恢复',
  },
});
