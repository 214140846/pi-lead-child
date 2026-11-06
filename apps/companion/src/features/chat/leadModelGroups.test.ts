import type { LeadModelOption } from '@pi-lead-child/protocol';
import { describe, expect, it } from 'vitest';

import { effortForModel, groupLeadModels, leadModelLabel, leadModelProviders, matchesLeadModel } from './leadModelGroups';

// prefix 是 daemon 给的账号（group）：只有服务商的 accountPrefix 生效时才有。
function option(model: string, source: string | null, efforts: string[] = [], prefix: string | null = null): LeadModelOption {
  const provider = model.slice(0, model.indexOf('/'));
  const id = model.slice(provider.length + 1);
  return {
    model, provider, id, prefix, source, name: null,
    image: true, efforts, defaultEffort: null, blockedUntil: null,
  };
}

// 2026-10-26：用户有两个 Anthropic 账号，在 vibeproxy 里加了前缀 as1、as4。选模型时要分得清。
// 2026-11-05：分组换成和设置页共用的规则（provider → group · channel）。
describe('groupLeadModels', () => {
  it('puts each account in its own section first, in numeric order, then the sections without an account', () => {
    const groups = groupLeadModels([
      option('vibeproxy/claude-sonnet-5', 'anthropic'),
      option('vibeproxy/gemini-3.8-flash-high', 'antigravity'),
      option('vibeproxy/as4/claude-sonnet-5', 'anthropic', [], 'as4'),
      option('vibeproxy/as1/claude-sonnet-5', 'anthropic', [], 'as1'),
      option('vibeproxy/as1/claude-opus-5-5', 'anthropic', [], 'as1'),
      option('vibeproxy/as10/claude-opus-5-5', 'anthropic', [], 'as10'),
    ]);
    expect(groups.map((group) => [group.title, group.models.map((model) => model.id)])).toEqual([
      ['as1 · anthropic', ['as1/claude-sonnet-5', 'as1/claude-opus-5-5']],
      ['as4 · anthropic', ['as4/claude-sonnet-5']],
      ['as10 · anthropic', ['as10/claude-opus-5-5']],
      ['anthropic', ['claude-sonnet-5']],
      ['antigravity', ['gemini-3.8-flash-high']],
    ]);
  });

  it('names the provider when there is more than one, and does not treat a prefix as an account without the daemon saying so', () => {
    const groups = groupLeadModels([
      option('vibeproxy/as1/claude-sonnet-5', 'anthropic', [], 'as1'),
      option('magpie/auto/deepseek-flash', 'deepseek'),
      option('magpie/deepseek/deepseek-flash', 'deepseek'),
    ]);
    expect(groups.map((group) => [group.title, group.models.map((model) => model.id)])).toEqual([
      ['vibeproxy · as1', ['as1/claude-sonnet-5']],
      ['magpie', ['auto/deepseek-flash', 'deepseek/deepseek-flash']],
    ]);
  });
});

// PR #11（2026-11-06）：浮层左栏是 provider，右边是它的分段；搜索走 groupModelsByProvider 的 keep。
describe('the provider rail and the search', () => {
  const models = [
    option('vibeproxy/as1/claude-sonnet-5', 'anthropic', [], 'as1'),
    option('vibeproxy/gemini-3.8-flash-high', 'antigravity'),
    option('magpie/auto/deepseek-flash', 'deepseek'),
    { ...option('magpie/deepseek/deepseek-v4', 'deepseek'), name: 'DeepSeek V4' },
  ];

  it('lists each provider once, in catalog order, with its model count', () => {
    expect(leadModelProviders(models)).toEqual([{ provider: 'vibeproxy', count: 2 }, { provider: 'magpie', count: 2 }]);
  });

  it('shows only the picked provider, without the provider in the titles', () => {
    expect(groupLeadModels(models, { provider: 'vibeproxy' }).map((group) => group.title)).toEqual(['as1 · anthropic', 'antigravity']);
    expect(groupLeadModels(models).map((group) => group.title)).toEqual(['vibeproxy · as1 · anthropic', 'vibeproxy · antigravity', 'magpie']);
  });

  it('keeps the section titles and counts while searching, and drops sections with no match', () => {
    const groups = groupLeadModels(models, { query: 'Gemini', provider: 'vibeproxy' });
    // vibeproxy 有两种通道：只剩 antigravity 一段时也照样写通道，标题不跟着搜索变。
    expect(groups.map((group) => [group.title, group.count, group.models.map((model) => model.id)])).toEqual([
      ['antigravity', 1, ['gemini-3.8-flash-high']],
    ]);
    expect(groupLeadModels(models, { query: 'nothing' })).toEqual([]);
  });

  it('keeps the section total when search matches only one of two models', () => {
    const groups = groupLeadModels(models, { query: 'v4', provider: 'magpie' });
    expect(groups.map((group) => [group.count, group.models.map((model) => model.id)])).toEqual([
      [2, ['deepseek/deepseek-v4']],
    ]);
  });

  it('matches the full provider/id and the display name, ignoring case', () => {
    const v4 = models[3]!;
    expect(matchesLeadModel(v4, 'MAGPIE/deepseek')).toBe(true);
    expect(matchesLeadModel(v4, 'deepseek v4')).toBe(true);
    expect(matchesLeadModel(v4, '  ')).toBe(true);
    expect(matchesLeadModel(v4, 'opus')).toBe(false);
  });
});

describe('leadModelLabel', () => {
  it('shows the model id without the provider, drops the account only when it is known, and shows the effort', () => {
    expect(leadModelLabel('vibeproxy/as4/claude-sonnet-5(high)', 'as4')).toEqual({ id: 'claude-sonnet-5', effort: 'high' });
    expect(leadModelLabel('vibeproxy/gemini-3.8-flash-high')).toEqual({ id: 'gemini-3.8-flash-high', effort: null });
    // 前缀不是账号的两个同名模型：显示名分得开。
    expect(leadModelLabel('magpie/auto/deepseek-flash').id).not.toBe(leadModelLabel('magpie/deepseek/deepseek-flash').id);
  });
});

describe('effortForModel', () => {
  it('keeps the effort when the new model supports it, and uses the model default otherwise', () => {
    expect(effortForModel(option('vibeproxy/as4/claude-sonnet-5', 'anthropic', ['low', 'high'], 'as4'), 'high')).toBe('high');
    expect(effortForModel(option('vibeproxy/gemini-3.8-flash-high', 'antigravity'), 'high')).toBeNull();
  });
});
