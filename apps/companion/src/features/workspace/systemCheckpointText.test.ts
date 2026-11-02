// 复核 P1-10：#66 的进展记录里，系统写的「Run started」「Run crashed」是英文。显示时换成中文，报错原文不动。
import { describe, expect, it } from 'vitest';

import { systemCheckpointText } from './systemCheckpointText';

describe('system checkpoint text', () => {
  it('writes a run start with the agent name and the model', () => {
    expect(systemCheckpointText({ source: 'system_derived', title: 'Run started', summary: 'codex run #74 started with gpt-5.5.' }))
      .toEqual({ title: 'Run #74 started', summary: 'Codex started Run #74 with the model gpt-5.5.' });
    expect(systemCheckpointText({ source: 'system_derived', title: 'Run started', summary: 'claude run #49 started.' }))
      .toEqual({ title: 'Run #49 started', summary: 'Claude Code started Run #49.' });
  });

  it('writes the system records in Chinese when the interface language is Chinese', () => {
    expect(systemCheckpointText({ source: 'system_derived', title: 'Run started', summary: 'codex run #74 started with gpt-5.5.' }, 'zh'))
      .toEqual({ title: 'Run #74 开始', summary: 'Codex 开始了 Run #74，模型 gpt-5.5。' });
    expect(systemCheckpointText({
      source: 'system_derived', title: 'Run crashed', summary: 'Run #71 crashed (claude_error_during_execution): boom',
    }, 'zh')).toEqual({ title: 'Run #71 失败', summary: 'Run #71 失败（claude_error_during_execution）：boom' });
  });

  it('writes a crash and keeps the raw error', () => {
    const error = 'No conversation found with session ID: 20fd5938-01a7-42ce-b4b4-bb1a98831c80';
    expect(systemCheckpointText({
      source: 'system_derived', title: 'Run crashed', summary: `Run #71 crashed (claude_error_during_execution): ${error}`,
    })).toEqual({ title: 'Run #71 failed', summary: `Run #71 failed (claude_error_during_execution): ${error}` });
  });

  it('leaves agent records and other system records as they are', () => {
    const agent = { source: 'agent_reported', title: 'Run started', summary: 'codex run #74 started.' };
    expect(systemCheckpointText(agent)).toEqual({ title: 'Run started', summary: 'codex run #74 started.' });
    const other = { source: 'system_derived', title: 'Codex 不支持该模型', summary: 'Codex · Run #73 · …' };
    expect(systemCheckpointText(other)).toEqual({ title: 'Codex 不支持该模型', summary: 'Codex · Run #73 · …' });
  });
});
