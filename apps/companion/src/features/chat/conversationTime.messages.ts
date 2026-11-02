// 会话里的日期文字（conversationTime.ts）。纯函数用，不引 React Native。
import { defineMessages } from '@pi-lead-child/protocol';

export const dateMessages = defineMessages({
  en: {
    today: 'Today',
    yesterday: 'Yesterday',
    // 英文的日期交给 Intl，这三条只有中文用。
    weekdays: (day: number) => String(day),
    monthDay: (month: number, day: number, weekday: string) => `${month}/${day} ${weekday}`,
    withYear: (year: number, monthDay: string) => `${year} ${monthDay}`,
  },
  zh: {
    today: '今天',
    yesterday: '昨天',
    weekdays: (day) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day] ?? '',
    monthDay: (month, day, weekday) => `${month}月${day}日 ${weekday}`,
    withYear: (year, monthDay) => `${year}年${monthDay}`,
  },
});
