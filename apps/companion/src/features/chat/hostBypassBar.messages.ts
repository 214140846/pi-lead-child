// 输入框上方「免沙箱」标记（工单 #246 设计 5.3）的文案。
import { defineMessages } from '@/i18n';

export const hostBypassBarMessages = defineMessages({
  en: {
    line: (minutes: number) => `Outside the sandbox · ${minutes === 1 ? '1 minute left' : `${minutes} minutes left`}`,
    close: 'Turn off',
    closing: 'Turning off…',
    failed: (reason: string) => `Did not turn off: ${reason}`,
  },
  zh: {
    line: (minutes) => `免沙箱 · 还剩 ${minutes} 分钟`,
    close: '关闭',
    closing: '正在关闭…',
    failed: (reason) => `没有关掉：${reason}`,
  },
});
