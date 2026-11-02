import { describe, expect, it } from 'vitest';
import {
  answeredTogetherNotice, nextTurnNotice, placementCopyFor, steeredNotice, steeredNoticeFor,
} from './steeredNotice';

// 提示里称呼 Lead 时写它的名字（设置 → 身份与风格），缺省是 Paimon。
const NAME = 'Paimon';

describe('steeredNoticeFor', () => {
  it('turns a silent steered turn into a notice instead of an empty bubble', () => {
    expect(steeredNoticeFor({ role: 'assistant', state: 'steered' }, false, null, NAME, 'en')).toBe(steeredNotice(NAME, 'en'));
    expect(steeredNotice(NAME, 'en')).toBe('Steered in. Paimon sees it after the current step');
  });

  // daemon 把出水口改接到插话那一轮之后，插话通常**有**自己的回答（回答就长在用户那句话
  // 下面）。那种情况必须按普通气泡渲染，否则真正的回复会被这行提示顶掉。
  it('renders a steered turn that got its own answer as an ordinary bubble', () => {
    expect(steeredNoticeFor({ role: 'assistant', state: 'steered' }, true, null, NAME, 'en')).toBeNull();
  });

  it('leaves ordinary assistant turns alone', () => {
    for (const state of ['queued', 'streaming', 'completed', 'failed']) {
      expect(steeredNoticeFor({ role: 'assistant', state }, false, null, NAME, 'en')).toBeNull();
      expect(steeredNoticeFor({ role: 'assistant', state }, true, null, NAME, 'en')).toBeNull();
    }
  });

  it('never applies to the user side — their own text already rendered', () => {
    expect(steeredNoticeFor({ role: 'user', state: 'steered' }, false, null, NAME, 'en')).toBeNull();
  });
});

// 工单 04（spec D10）：用户的消息现在怎么放的，以及没有自己回答的那一条怎么写。
describe('placement copy', () => {
  it('says a message without its own answer was answered together with the next one, not that Lead failed', () => {
    expect(steeredNoticeFor({ role: 'assistant', state: 'steered' }, false, 'answered_together', NAME, 'en')).toBe(answeredTogetherNotice('en'));
    expect(steeredNoticeFor({ role: 'assistant', state: 'steered' }, false, 'next_turn', NAME, 'en')).toBe(nextTurnNotice(NAME, 'en'));
    expect(nextTurnNotice(NAME, 'en')).toBe('Next turn: Paimon answers it after the current turn');
    expect(steeredNoticeFor({ role: 'assistant', state: 'steered' }, true, 'answered_together', NAME, 'en')).toBeNull();
  });

  it('labels a user message as queued, inserted or answered in the next round while it waits', () => {
    expect(placementCopyFor({ state: 'queued', placement: 'queued' }, NAME, 'en')).toBe('In queue · Paimon answers it after this turn');
    expect(placementCopyFor({ state: 'queued', placement: 'queued' }, 'Jarvis', 'en')).toBe('In queue · Jarvis answers it after this turn');
    expect(placementCopyFor({ state: 'steered', placement: 'steered' }, NAME, 'en')).toBe('Steered in');
    expect(placementCopyFor({ state: 'steered', placement: 'next_turn' }, NAME, 'en')).toBe('Next turn');
  });

  it('drops the label once the message is being answered or has an outcome', () => {
    expect(placementCopyFor({ state: 'streaming', placement: null }, NAME, 'en')).toBeNull();
    expect(placementCopyFor({ state: 'completed', placement: 'next_turn' }, NAME, 'en')).toBeNull();
    expect(placementCopyFor({ state: 'failed', placement: 'queued' }, NAME, 'en')).toBeNull();
    expect(placementCopyFor({ state: 'steered', placement: 'answered_together' }, NAME, 'en')).toBeNull();
    expect(placementCopyFor({ state: 'completed' }, NAME, 'en')).toBeNull();
    expect(placementCopyFor(null, NAME, 'en')).toBeNull();
  });
});

describe('placement copy in Chinese', () => {
  it('keeps the original Chinese words', () => {
    expect(steeredNotice(NAME, 'zh')).toBe('已插话，Paimon 将在当前步骤后看到');
    expect(nextTurnNotice(NAME, 'zh')).toBe('下一轮回答：Paimon 答完当前这一轮以后接着答它');
    expect(placementCopyFor({ state: 'queued', placement: 'queued' }, NAME, 'zh')).toBe('排队中 · Paimon 答完这一轮后回答');
    expect(placementCopyFor({ state: 'steered', placement: 'next_turn' }, NAME, 'zh')).toBe('下一轮回答');
    expect(placementCopyFor({ state: 'queued', placement: 'cancelled' }, NAME, 'zh')).toBe('已取消 · 没有发给 Paimon');
  });
});
