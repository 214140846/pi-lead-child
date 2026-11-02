// Lead 状态点的说法跟着界面语言（2026-11-01）：缺省英文，选了中文时是原来的中文。
import { describe, expect, it } from 'vitest';

import { leadPresence } from './leadPresence';

const NOW = Date.parse('2026-10-20T02:00:00.000Z');

describe('the Lead presence text', () => {
  it('is English by default', () => {
    expect(leadPresence({ connectionState: 'disconnected', phase: 'unpaired', lead: undefined, name: 'Paimon', now: NOW }))
      .toMatchObject({ state: 'offline', label: 'Not paired · Click to pair' });
    expect(leadPresence({ connectionState: 'reconnecting', phase: 'ready', lead: undefined, name: 'Paimon', now: NOW }))
      .toMatchObject({ label: 'Paimon is offline', subtitle: 'Offline · Reconnecting' });
    expect(leadPresence({ connectionState: 'connected', phase: 'ready', lead: undefined, name: 'Paimon', now: NOW }))
      .toMatchObject({ state: 'online', label: 'Paimon is online', subtitle: null });
  });

  it('uses the original Chinese when the interface language is Chinese', () => {
    expect(leadPresence({ connectionState: 'disconnected', phase: 'unpaired', lead: undefined, name: 'Paimon', now: NOW, locale: 'zh' }))
      .toMatchObject({ label: '未配对 · 点击配对' });
    expect(leadPresence({ connectionState: 'reconnecting', phase: 'ready', lead: undefined, name: 'Paimon', now: NOW, locale: 'zh' }))
      .toMatchObject({ label: 'Paimon 离线', subtitle: '离线 · 正在重连' });
    expect(leadPresence({ connectionState: 'connected', phase: 'ready', lead: undefined, name: 'Paimon', now: NOW, locale: 'zh' }))
      .toMatchObject({ label: 'Paimon 在线' });
  });
});
