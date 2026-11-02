// 设置 → 执行 → 执行器的文案（RuntimesSection）。
import { defineMessages } from '@/i18n';

export const runtimesMessages = defineMessages({
  en: {
    description: (leadName: string) => `The agents that do the work on tickets. A stopped runtime gets no new work and does no reviews, `
      + `and ${leadName} does not recommend it any more.`,
    loading: 'Loading the runtime settings…',
    loadFailed: (reason: string) => `Could not load the runtime settings: ${reason}`,
    notStarted: 'The runtime settings have not started.',
    canReview: 'Can do read-only reviews',
    notInstalled: 'Not installed',
    enabled: 'In use.',
    disabled: (leadName: string) => `Stopped: it gets no work and does no reviews. Tickets that name it wait until ${leadName} gives them to another runtime.`,
    reviewTitle: 'Automatic review',
    noReviewer: (leadName: string) => `All runtimes are stopped, so automatic reviews cannot start. `
      + `You must accept the tickets that you gave to ${leadName} to accept.`,
    readOnlyReviewer: (name: string) => `${name} does the automatic reviews. ${name} can only read code. It cannot run tests, `
      + 'so its review results come from reading. If it cannot be used, the next runtime that can be used takes over.',
    reviewer: (name: string) => `${name} does the automatic reviews. If it cannot be used, the next runtime that can be used takes over.`,
  },
  zh: {
    description: (leadName) => `执行工单的 agent。停用的不再接新的活，也不做核查，${leadName} 也不会再推荐它。`,
    loading: '正在读取执行器设置…',
    loadFailed: (reason) => `读不到执行器设置：${reason}`,
    notStarted: '执行器设置没有启动',
    canReview: '能做只读核查',
    notInstalled: '没有安装',
    enabled: '在用。',
    disabled: (leadName) => `已停用：不派活、不做核查，点名它的工单会等 ${leadName} 改派。`,
    reviewTitle: '自动核查',
    noReviewer: (leadName) => `所有执行器都停用了，自动核查派不出去。委托给 ${leadName} 验收的工单要你自己验收。`,
    readOnlyReviewer: (name) => `自动核查用 ${name}。${name} 只能读代码，不能运行测试，核查结论来自阅读。它不能用时，自动换下一个能用的执行器。`,
    reviewer: (name) => `自动核查用 ${name}。它不能用时，自动换下一个能用的执行器。`,
  },
});
