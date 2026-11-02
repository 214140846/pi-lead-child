// 会话里一次工具调用的一行（ToolCallRow.tsx）。
import { defineMessages } from '@/i18n';

export const toolCallMessages = defineMessages({
  en: {
    rowLabel: (name: string, state: string, toggle: 'expand' | 'collapse' | null) =>
      `${name}, ${state}${toggle === 'expand' ? ', show details' : toggle === 'collapse' ? ', hide details' : ''}`,
    redacted: 'Sensitive fields are hidden',
    truncated: 'The content is cut short',
  },
  zh: {
    rowLabel: (name, state, toggle) => `${name}，${state}${toggle === 'expand' ? '，展开详情' : toggle === 'collapse' ? '，收起详情' : ''}`,
    redacted: '敏感字段已脱敏',
    truncated: '内容已截断',
  },
});
