// 系统自己写的进展记录（systemCheckpointText.ts）显示时的标题和说明。报错原文不翻译。
import { defineMessages } from '@/i18n';

export const systemCheckpointMessages = defineMessages({
  en: {
    runStarted: 'Run started',
    runStartedTitle: (runId: string) => `Run #${runId} started`,
    runStartedSummary: (runtime: string, runId: string, model: string | null) =>
      `${runtime} started Run #${runId}${model ? ` with the model ${model}` : ''}.`,
    runFailed: 'Run failed',
    runFailedTitle: (runId: string) => `Run #${runId} failed`,
    runFailedSummary: (runId: string, code: string, error: string) => `Run #${runId} failed (${code}): ${error}`,
  },
  zh: {
    runStarted: 'Run 开始',
    runStartedTitle: (runId) => `Run #${runId} 开始`,
    runStartedSummary: (runtime, runId, model) => `${runtime} 开始了 Run #${runId}${model ? `，模型 ${model}` : ''}。`,
    runFailed: 'Run 失败',
    runFailedTitle: (runId) => `Run #${runId} 失败`,
    runFailedSummary: (runId, code, error) => `Run #${runId} 失败（${code}）：${error}`,
  },
});
