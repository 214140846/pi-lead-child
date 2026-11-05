// 设置 → 免沙箱（工单 #246）的文案。输入框上方的标记在 chat 的 hostBypassBar.messages.ts。
import { defineMessages } from '@/i18n';

export const hostBypassMessages = defineMessages({
  en: {
    title: 'Skip the sandbox in your own turns',
    description: (leadName: string) =>
      `When this is on, ${leadName} runs commands outside the sandbox and without a confirmation card. `
      + 'This applies only in a turn that you start yourself, and only until the turn reads external content '
      + '(for example Slack messages or attachments). The safety floors stay on: no credentials, no writes to the PLC database, '
      + 'no deletes outside the work folders, no launchd changes, no paid operations.',
    off: 'Off',
    on: (minutes: number, until: string) => `On · ${minutes === 1 ? '1 minute' : `${minutes} minutes`} left · until ${until}`,
    duration: 'Duration',
    minutes: (minutes: number) => (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`),
    turnOn: 'Turn on',
    restart: 'Start again',
    turnOff: 'Turn off',
    working: 'Saving…',
    restartNote: 'Start again counts the new duration from now. It does not add to the time left.',
    onlyYou: (leadName: string) => `Only you can turn this on. ${leadName} can turn it off.`,
    loading: 'Loading…',
    loadFailed: (reason: string) => `Cannot load this setting: ${reason}`,
    errorForbidden: 'This device does not have permission to change this setting.',
    errorUnknown: 'The change did not save. Try again.',
  },
  zh: {
    title: '用户本人发话时免沙箱',
    description: (leadName) =>
      `打开以后，${leadName} 的命令在沙箱外跑，不弹确认卡。只在你自己发话的那一轮里生效；这一轮读了外部内容（例如 Slack 消息、附件）以后就退回沙箱。`
      + '底线照样保留：不碰凭证，不写 PLC 的数据库，不删工作目录以外的东西，不改 launchd，不做花钱的操作。',
    off: '关着',
    on: (minutes, until) => `开着 · 还剩 ${minutes} 分钟 · ${until} 自动关`,
    duration: '时长',
    minutes: (minutes) => (minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`),
    turnOn: '打开',
    restart: '重新计时',
    turnOff: '关闭',
    working: '正在保存…',
    restartNote: '重新计时按新的时长从现在算，不加在剩下的时间上。',
    onlyYou: (leadName) => `只有你能打开。${leadName} 能关。`,
    loading: '正在读取…',
    loadFailed: (reason) => `读不到这个设置：${reason}`,
    errorForbidden: '这台设备没有改这个设置的权限。',
    errorUnknown: '没有保存成功，请再试一次。',
  },
});
