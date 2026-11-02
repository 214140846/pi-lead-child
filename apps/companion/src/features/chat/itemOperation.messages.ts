// Lead 改日程和工单以后的白话（itemOperationWords.ts），以及审批和决定的「谁处理的」（resolvedByLabel.ts）。
import { defineMessages } from '@/i18n';

const suffix = (id: string | null) => (id ? ` #${id}` : '');

export const itemOperationMessages = defineMessages({
  en: {
    done: {
      create_reminder: (id: string | null) => `Reminder${suffix(id)} created`,
      reschedule_reminder: (id: string | null) => `Reminder${suffix(id)} rescheduled`,
      ack_reminder: (id: string | null) => `Reminder${suffix(id)} acknowledged`,
      create_task: (id: string | null) => `Ticket${suffix(id)} created`,
      update_item: (id: string | null) => `${id ? `#${id}` : 'Item'} updated`,
      defer_item: (id: string | null) => `${id ? `#${id}` : 'Item'} deferred`,
      cancel_item: (id: string | null) => `${id ? `#${id}` : 'Item'} cancelled`,
      create_cron_trigger: (_id: string | null) => 'Scheduled task created',
      create_once_trigger: (_id: string | null) => 'Scheduled task created',
      set_trigger_enabled: (_id: string | null) => 'Scheduled task updated',
    },
    reminderRescheduled: (leadName: string) => `${leadName} changed the time`,
    reminderCancelled: (leadName: string) => `${leadName} cancelled it`,
    reminderAcknowledged: (leadName: string) => `${leadName} acknowledged it for you`,
    resolvedForYou: (leadName: string) => `${leadName} for you`,
    resolvedByYou: 'You',
    resolvedBySystem: 'System',
  },
  zh: {
    done: {
      create_reminder: (id) => `提醒${suffix(id)} 已创建`,
      reschedule_reminder: (id) => `提醒${suffix(id)} 已改期`,
      ack_reminder: (id) => `提醒${suffix(id)} 已确认`,
      create_task: (id) => `工单${suffix(id)} 已创建`,
      update_item: (id) => `${id ? `#${id}` : '事项'} 已更新`,
      defer_item: (id) => `${id ? `#${id}` : '事项'} 已推迟`,
      cancel_item: (id) => `${id ? `#${id}` : '事项'} 已取消`,
      create_cron_trigger: () => '定时任务已创建',
      create_once_trigger: () => '定时任务已创建',
      set_trigger_enabled: () => '定时任务已更新',
    },
    reminderRescheduled: (leadName) => `${leadName} 改了时间`,
    reminderCancelled: (leadName) => `${leadName} 取消了它`,
    reminderAcknowledged: (leadName) => `${leadName} 帮你确认了`,
    resolvedForYou: (leadName) => `${leadName} 代你`,
    resolvedByYou: '你',
    resolvedBySystem: '系统',
  },
});
