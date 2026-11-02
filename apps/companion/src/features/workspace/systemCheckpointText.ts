// 系统自己写的两种进展记录是英文的：「Run started」和「Run crashed」（packages/engine 的 children/manager.ts）。
// 服务端的文字还有测试和 Lead 在读，这里只在显示时换成中文（复核 P1-10）。报错原文保持原样。
import { DEFAULT_LOCALE, type Locale } from '@/i18n';

import { runtimeDisplayName } from './runtimeNames';
import { systemCheckpointMessages } from './systemCheckpoint.messages';

type SystemCheckpointText = { title: string; summary: string };

const RUN_STARTED = /^(\w+) run #(\d+) started(?: with (.+?))?\.$/;
const RUN_CRASHED = /^Run #(\d+) crashed \(([^)]*)\): ([\s\S]*)$/;

/** 系统记录按界面语言的标题和说明。不认识的记录原样返回。 */
export function systemCheckpointText(
  checkpoint: { source: string; title: string; summary: string },
  locale: Locale = DEFAULT_LOCALE,
): SystemCheckpointText {
  const { title, summary } = checkpoint;
  const m = systemCheckpointMessages(locale);
  if (checkpoint.source !== 'system_derived') return { title, summary };
  if (title === 'Run started') {
    const match = RUN_STARTED.exec(summary.trim());
    if (!match) return { title: m.runStarted, summary };
    const [, runtime, runId, model] = match;
    return {
      title: m.runStartedTitle(runId!),
      summary: m.runStartedSummary(runtimeDisplayName(runtime) ?? runtime!, runId!, model ?? null),
    };
  }
  if (title === 'Run crashed') {
    const match = RUN_CRASHED.exec(summary.trim());
    if (!match) return { title: m.runFailed, summary };
    const [, runId, code, error] = match;
    return { title: m.runFailedTitle(runId!), summary: m.runFailedSummary(runId!, code!, error!) };
  }
  return { title, summary };
}
