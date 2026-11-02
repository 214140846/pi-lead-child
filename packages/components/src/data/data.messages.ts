// 数据积木（条形图、勾选表、进度、引用的消息、走势小图、步骤）的文案。
import { defineMessages } from '../i18n';

export const dataMessages = defineMessages({
  en: {
    barValue: (label: string, value: string) => `${label}: ${value}`,
    scaleHighest: (value: string) => `Highest ${value}`,
    scaleFull: (value: string) => `Full scale ${value}`,
    unit: (unit: string) => `Unit: ${unit}`,
    confirmItem: (label: string) => `Confirm: ${label}`,
    noVerdict: (column: string) => `${column}: no result yet`,
    progressUnknown: 'Progress unknown',
    earlierMessages: (count: number) => (count === 1 ? '1 earlier message' : `${count} earlier messages`),
    messageCount: (count: number) => (count === 1 ? '1 message' : `${count} messages`),
    sparklineSummary: (label: string | undefined, first: string, last: string, high: string, low: string) =>
      `${label ? `${label}: ` : ''}From ${first} to ${last}. Highest ${high}, lowest ${low}.`,
    sparklineRange: (high: string, low: string) => `High ${high} · Low ${low}`,
    stepState: {
      done: 'Done', current: 'In progress', pending: 'Not started', failed: 'Failed', skipped: 'Skipped', blocked: 'Blocked',
    },
  },
  zh: {
    barValue: (label, value) => `${label}：${value}`,
    scaleHighest: (value) => `最高 ${value}`,
    scaleFull: (value) => `满格 ${value}`,
    unit: (unit) => `单位：${unit}`,
    confirmItem: (label) => `确认：${label}`,
    noVerdict: (column) => `${column}还没有结论`,
    progressUnknown: '进度未知',
    earlierMessages: (count) => `更早的 ${count} 条`,
    messageCount: (count) => `${count} 条`,
    sparklineSummary: (label, first, last, high, low) =>
      `${label ? `${label}：` : ''}从 ${first} 到 ${last}，最高 ${high}，最低 ${low}`,
    sparklineRange: (high, low) => `最高 ${high} · 最低 ${low}`,
    stepState: {
      done: '已完成', current: '进行中', pending: '未开始', failed: '失败', skipped: '已跳过', blocked: '受阻',
    },
  },
});
