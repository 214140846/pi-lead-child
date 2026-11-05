// Lead 的模型选择（LeadModelPicker.tsx、leadModelGroups.ts）。
import { defineMessages } from '@/i18n';

export const leadModelMessages = defineMessages({
  en: {
    pickerLabel: (model: string) => `Lead model: ${model}. Open to change the model.`,
    pickerTitle: 'Lead model',
    resend: 'Resend with another model',
    loading: 'Reading the model list…',
    loadFailed: (message: string) => `Cannot read the model list: ${message}`,
    retry: 'Try again',
    afterTurn: (model: string) => `${model} starts after this answer ends.`,
    inUse: (model: string) => `In use: ${model}`,
    pending: (current: string, selected: string) =>
      `${current} is in use. ${selected}, which you selected, starts after this answer ends. When a rate limit or quota stops a model, the system also uses another model for a short time.`,
    effort: 'Reasoning effort',
    defaultEffort: 'Default',
    selected: 'Selected',
    selectedLabel: (model: string) => `${model}, selected`,
    quotaUsed: (time: string) => `Quota used up, back at ${time}`,
    noImages: 'Cannot read images',
  },
  zh: {
    pickerLabel: (model) => `Lead 的模型：${model}，点开换模型`,
    pickerTitle: 'Lead 的模型',
    resend: '换个模型重发',
    loading: '正在读模型目录…',
    loadFailed: (message) => `读不到模型目录：${message}`,
    retry: '重试',
    afterTurn: (model) => `${model} 会在这一轮回答结束后换上。`,
    inUse: (model) => `正在用：${model}`,
    pending: (current, selected) => `正在用 ${current}。你选的 ${selected} 会在这一轮回答结束后换上；限流或额度用完时系统也会暂时换用别的模型。`,
    effort: '推理强度',
    defaultEffort: '缺省',
    selected: '正在选着',
    selectedLabel: (model) => `${model}，正在选着`,
    quotaUsed: (time) => `额度用完，${time} 恢复`,
    noImages: '不能看图',
  },
});
