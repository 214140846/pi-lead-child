// 收件箱（InboxQueue、InboxChannelCards、inboxModel）的文案。
import { defineMessages } from '@/i18n';

export const inboxMessages = defineMessages({
  en: {
    // 等了多久（waitedText）：用最大的整单位。
    justNow: 'just now',
    days: (n: number) => (n === 1 ? '1 day' : `${n} days`),
    hours: (n: number) => (n === 1 ? '1 hour' : `${n} hours`),
    minutes: (n: number) => (n === 1 ? '1 minute' : `${n} minutes`),
    waited: (time: string) => `Waited ${time}`,
    notices: (n: number) => (n === 1 ? '1 notice' : `${n} notices`),
    // 收件箱
    needsYou: 'Needs you',
    nothingTitle: 'Nothing needs you',
    nothingBody: 'Look at running and queued work in Tickets.',
    working: 'Working…',
    open: 'Open',
    times: (n: number) => (n === 1 ? '1 time' : `${n} times`),
    problem: 'Problem',
    cause: 'Cause',
    myAction: 'I did',
    followUp: 'Next',
    undo: 'Undo',
    ok: 'OK',
    undoQuestion: 'Undo this action? Your credential stays valid.',
    confirmUndo: 'Confirm undo',
    notMe: 'Not me',
    itsMe: 'It was me',
    notMeQuestion: 'Undo this action and revoke the credential that sent it?',
    confirmNotMe: 'Confirm not me',
    cancel: 'Cancel',
    confirm: 'Confirm',
    olderNotices: (n: number) => (n === 1 ? '1 older notice' : `${n} older notices`),
    unackedReminders: (n: number) => (n === 1 ? '1 reminder is not acknowledged' : `${n} reminders are not acknowledged`),
    foldedReminders: (n: number) => (n === 1
      ? '1 more is older than 30 days. It is in Overdue in the agenda.'
      : `${n} more are older than 30 days. They are in Overdue in the agenda.`),
    onlyFoldedReminders: (n: number) => (n === 1
      ? '1 reminder is older than 30 days and not acknowledged. It is in Overdue in the agenda.'
      : `${n} reminders are older than 30 days and not acknowledged. They are in Overdue in the agenda.`),
    acknowledgeAll: 'Acknowledge all',
    upcoming: 'Waiting reminders',
    important: 'Important',
    leadHandled: (lead: string) => `Handled by ${lead}`,
    earlier: (n: number) => (n === 1 ? '1 earlier item' : `${n} earlier items`),
    channelMessages: 'Channel messages',
    // 外部的人要求设的定时器
    askedShort: (name: string) => `Asked by ${name}`,
    askedTitle: (name: string) => `Timer that ${name} asked for`,
    askedDetail: (name: string, source: string) => `${name} asked for it in ${source}`,
    fromShort: (source: string) => `From ${source}`,
    fromTitle: (source: string) => `Timer set after reading a ${source} message`,
    fromDetail: (source: string) => `Set after reading a ${source} message`,
    // 后台检查
    watchByUserShort: (lead: string) => `You asked ${lead}`,
    watchByUserTitle: (lead: string) => `Background check that you asked ${lead} to set`,
    watchByLeadShort: (lead: string) => `Set by ${lead}`,
    watchByLeadTitle: (lead: string) => `Background check that ${lead} set`,
    watchExternalShort: 'From outside',
    watchExternalTitle: 'Background check set after reading an outside message',
    watchAskedShort: (name: string, source: string) => `Asked by ${name} (${source})`,
    watchAskedTitle: (name: string, source: string) => `Background check that ${name} asked for in ${source}`,
    watchFromTitle: (source: string) => `Background check set after reading a ${source} message`,
    checking: 'Checking',
    lastPassed: 'Last check passed',
    lastFailed: 'Last check failed',
    lastError: 'Last check had an error',
    watchDetail: (schedule: string, status: 'running' | 'pass' | 'fail' | 'error' | 'never', lastAt: string | null, nextAt: string | null) => {
      const last = lastAt ? `The last check at ${lastAt}` : 'The last check';
      const result = status === 'running' ? 'A check is running now.'
        : status === 'pass' ? `${last} passed.`
          : status === 'fail' ? `${last} failed.`
            : status === 'error' ? `${last} had an error.`
              : 'No check ran yet.';
      const next = nextAt ? ` The next check is at ${nextAt}.` : '';
      return `${schedule}. ${result}${next}`;
    },
    watchRowLabel: (title: string) => `Background check "${title}": see details, cancel`,
    watchCancelDetail: (lead: string) => `Stop the checks. ${lead} is not woken again.`,
    timerRowLabel: (title: string) => `${title}: see the source, cancel`,
    timerDetail: (detail: string, at: string | null) => `${detail}${at ? `. It is due at ${at}` : ''}.`,
    timerCancelDetail: (lead: string) => `Stop the reminder. ${lead} is not woken when it is due.`,
    cancelling: 'Cancelling…',
    notCancelled: (error: string) => `Not cancelled: ${error}`,
    moreWatches: (n: number) => (n === 1 ? '1 more background check' : `${n} more background checks`),
    moreWatchesLabel: (label: string) => `${label}: see, cancel`,
    moreWatchesNote: (lead: string) => `After you cancel, the checks stop and ${lead} is not woken again.`,
    cancelWatch: (title: string) => `Cancel background check "${title}"`,
  },
  zh: {
    justNow: '刚刚',
    days: (n) => `${n} 天`,
    hours: (n) => `${n} 小时`,
    minutes: (n) => `${n} 分钟`,
    waited: (time) => `等了 ${time}`,
    notices: (n) => `${n} 条通知`,
    needsYou: '需要你',
    nothingTitle: '没有需要你的事',
    nothingBody: '在跑和排队的事在工单里看。',
    working: '正在处理…',
    open: '查看',
    times: (n) => `${n} 次`,
    problem: '问题',
    cause: '原因',
    myAction: '我做了',
    followUp: '以后',
    undo: '撤销',
    ok: '知道了',
    undoQuestion: '撤销这次操作？不作废凭证。',
    confirmUndo: '确认撤销',
    notMe: '不是我',
    itsMe: '是我',
    notMeQuestion: '撤销这次操作，并作废发出它的凭证？',
    confirmNotMe: '确认不是我',
    cancel: '取消',
    confirm: '确认',
    olderNotices: (n) => `还有 ${n} 条较早的通知`,
    unackedReminders: (n) => `${n} 条提醒没有确认`,
    foldedReminders: (n) => `另有 ${n} 条超过 30 天，收在日程的「已过期」里`,
    onlyFoldedReminders: (n) => `${n} 条提醒超过 30 天没有确认，收在日程的「已过期」里`,
    acknowledgeAll: '全部确认',
    upcoming: '等待中的提醒',
    important: '重要',
    leadHandled: (lead) => `${lead} 已处理`,
    earlier: (n) => `更早 ${n} 件`,
    channelMessages: '外部消息',
    askedShort: (name) => `${name} 要求`,
    askedTitle: (name) => `${name} 要求设的定时器`,
    askedDetail: (name, source) => `${source} 里 ${name} 要求设的`,
    fromShort: (source) => `来自 ${source}`,
    fromTitle: (source) => `读了 ${source} 消息以后设的定时器`,
    fromDetail: (source) => `读了 ${source} 的消息以后设的`,
    watchByUserShort: (lead) => `你让 ${lead} 设的`,
    watchByUserTitle: (lead) => `你让 ${lead} 设的后台检查`,
    watchByLeadShort: (lead) => `${lead} 设的`,
    watchByLeadTitle: (lead) => `${lead} 自己设的后台检查`,
    watchExternalShort: '来自外部',
    watchExternalTitle: '读了外部消息以后设的后台检查',
    watchAskedShort: (name, source) => `${name}（${source}）要求的`,
    watchAskedTitle: (name, source) => `${source} 里 ${name} 要求设的后台检查`,
    watchFromTitle: (source) => `读了 ${source} 消息以后设的后台检查`,
    checking: '正在查',
    lastPassed: '上次通过',
    lastFailed: '上次没通过',
    lastError: '上次出错',
    watchDetail: (schedule, status, lastAt, nextAt) => {
      const last = lastAt ? `上次 ${lastAt} 查过，` : '上次';
      const result = status === 'running' ? '现在正在查。'
        : status === 'pass' ? `${last}通过了。`
          : status === 'fail' ? `${last}没通过。`
            : status === 'error' ? `${last}出错了。`
              : '还没查过。';
      const next = nextAt ? `下次 ${nextAt} 查。` : '';
      return `${schedule}。${result}${next}`;
    },
    watchRowLabel: (title) => `后台检查「${title}」：查看详情、取消`,
    watchCancelDetail: (lead) => `不再检查，也不会再叫醒 ${lead}`,
    timerRowLabel: (title) => `${title}：查看来源、取消`,
    timerDetail: (detail, at) => `${detail}${at ? `，${at} 到点` : ''}。`,
    timerCancelDetail: (lead) => `不再提醒你，到点也不会叫醒 ${lead}`,
    cancelling: '正在取消…',
    notCancelled: (error) => `没有取消：${error}`,
    moreWatches: (n) => `还有 ${n} 个后台检查`,
    moreWatchesLabel: (label) => `${label}：查看、取消`,
    moreWatchesNote: (lead) => `取消以后不再检查，也不会再叫醒 ${lead}。`,
    cancelWatch: (title) => `取消后台检查「${title}」`,
  },
});
