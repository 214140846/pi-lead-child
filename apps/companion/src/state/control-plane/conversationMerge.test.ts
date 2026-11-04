import type { ConversationTurn } from '@pi-lead-child/protocol';
import { describe, expect, it } from 'vitest';

import { applyControlPlaneMutation, createOptimisticUserMessage } from './actions';
import { createControlPlaneStore } from './store';

// 2026-11-04：主会话打开时只取最近一段，往上滚时取更早的一页，Lead 说完一句只取那一轮。
// 快照叠到手上的会话上（mergeConversationTurns），不能把已经加载的历史、实时的轮次、本机发件箱的消息清掉。

const SESSION = 'session-1';
const base = Date.parse('2026-11-04T08:00:00.000Z');

function turn(index: number, overrides: Partial<ConversationTurn> = {}): ConversationTurn {
  const at = new Date(base + index * 60_000).toISOString();
  return {
    id: `turn-${String(index).padStart(2, '0')}`,
    originBindingId: 7,
    originKind: 'paired:companion',
    ticketId: null,
    state: 'completed',
    userText: `第 ${index} 句`,
    assistantText: `回答 ${index}`,
    error: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => turn(from + index));

function visibleTurns(store: ReturnType<typeof createControlPlaneStore>, ticketId?: number): string[] {
  const state = store.getState();
  const ids = ticketId === undefined ? state.messageIdsBySession[SESSION] ?? [] : state.messageIdsByTicket[ticketId] ?? [];
  return ids.map((id) => {
    const message = state.messagesById[id]!;
    return message.source === 'optimistic' ? `optimistic:${message.role}` : `${message.turnId}:${message.role}`;
  });
}

const both = (...indexes: number[]) => indexes.flatMap((index) => {
  const id = `turn-${String(index).padStart(2, '0')}`;
  return [`${id}:user`, `${id}:assistant`];
});

describe('mergeConversationTurns', () => {
  // 以前主会话的快照整份重建：不在快照里的轮次全部丢掉。往上翻加载的更早一页，下一次刷新就没了。
  it('adds an older page in front without dropping the loaded window', () => {
    const store = createControlPlaneStore();
    store.getState().mergeConversation(SESSION, range(4, 6), { kind: 'window', complete: false });
    store.getState().mergeConversation(SESSION, range(1, 3), { kind: 'merge' });

    expect(visibleTurns(store)).toEqual(both(1, 2, 3, 4, 5, 6));
    expect(store.getState().turnIdsBySession[SESSION]).toEqual(range(1, 6).map((item) => item.id));
  });

  it('corrects one turn in place and keeps every other turn, the outbox message and local image data', () => {
    const store = createControlPlaneStore();
    const withImage = turn(5, { images: [{ id: 'img-1', mimeType: 'image/png' }] });
    store.getState().mergeConversation(SESSION, [...range(1, 4), withImage], { kind: 'window', complete: false });
    // 本机刚发出去的那张图还留着数据。
    const imagePartId = `${SESSION}:turn-05:user:image:0`;
    store.setState({
      messagePartsById: {
        ...store.getState().messagePartsById,
        [imagePartId]: { kind: 'image', id: imagePartId, mimeType: 'image/png', imageId: 'img-1', data: 'iVBORw0KGgo=' },
      },
    });
    createOptimisticUserMessage(store, { sessionId: SESSION, commandId: 'cmd-1', message: '还在发', createdAt: new Date(base + 40 * 60_000).toISOString() });

    store.getState().mergeConversation(SESSION, [turn(3, { assistantText: '改过的回答' })], { kind: 'merge' });

    const state = store.getState();
    expect(visibleTurns(store)).toEqual([...both(1, 2, 3, 4, 5), 'optimistic:user']);
    expect(state.messagePartsById[`${SESSION}:turn-03:assistant:text`]).toMatchObject({ text: '改过的回答' });
    expect(state.messagePartsById[imagePartId]).toMatchObject({ data: 'iVBORw0KGgo=' });
  });

  it('places a corrected new turn at its time, before messages still in the outbox', () => {
    const store = createControlPlaneStore();
    store.getState().mergeConversation(SESSION, range(1, 2), { kind: 'window', complete: true });
    createOptimisticUserMessage(store, { sessionId: SESSION, commandId: 'cmd-1', message: '还在发', createdAt: new Date(base + 40 * 60_000).toISOString() });

    store.getState().mergeConversation(SESSION, [turn(3, { userText: '' })], { kind: 'merge' });

    // Lead 自己发起的一轮没有你的话：只列它的回答。
    expect(visibleTurns(store)).toEqual([...both(1, 2), 'turn-03:assistant', 'optimistic:user']);
  });

  it('keeps older history when the newest window joins it, and drops in-range turns the window no longer has', () => {
    const store = createControlPlaneStore();
    store.getState().mergeConversation(SESSION, range(4, 7), { kind: 'window', complete: false });
    store.getState().mergeConversation(SESSION, range(1, 3), { kind: 'merge' });

    // 重连：最近一段是 5–8。6 不在里面（daemon 那边没有这一轮了），1–4 比这一段早，留着。
    store.getState().mergeConversation(SESSION, [turn(5), turn(7), turn(8)], { kind: 'window', complete: false });

    expect(visibleTurns(store)).toEqual(both(1, 2, 3, 4, 5, 7, 8));
    expect(store.getState().turnsById['turn-06']).toBeUndefined();
  });

  // 离开太久：最近一段和手上的轮次之间隔着没取过的轮次。留着旧的会在中间留一个洞，往上翻也取不到那一截。
  it('replaces the loaded history when the newest window does not join it', () => {
    const store = createControlPlaneStore();
    store.getState().mergeConversation(SESSION, range(1, 3), { kind: 'window', complete: false });

    store.getState().mergeConversation(SESSION, range(10, 12), { kind: 'window', complete: false });

    expect(visibleTurns(store)).toEqual(both(10, 11, 12));
  });

  it('replaces every turn when the window is the whole conversation, but keeps a live turn the snapshot has not seen yet', () => {
    const store = createControlPlaneStore();
    store.getState().mergeConversation(SESSION, range(1, 3), { kind: 'window', complete: false });
    // 快照发出以后才开始的一轮：实时事件先到了。
    applyControlPlaneMutation(store, SESSION, {
      type: 'lead.ensure-shell', turnId: 'turn-live', ticketId: null, occurredAt: new Date(base + 30 * 60_000).toISOString(),
    });

    store.getState().mergeConversation(SESSION, [turn(2), turn(3)], { kind: 'window', complete: true });

    expect(visibleTurns(store)).toEqual([...both(2, 3), 'turn-live:user', 'turn-live:assistant']);
  });

  it('adds a corrected ticket turn to its ticket conversation without dropping the ticket history', () => {
    const store = createControlPlaneStore();
    const ticketTurn = (index: number, overrides: Partial<ConversationTurn> = {}) => turn(index, { ticketId: 42, originKind: 'paired:companion:ticket-agent', ...overrides });
    store.getState().replaceConversation(SESSION, [ticketTurn(1), ticketTurn(2)], { ticketId: 42 });
    store.getState().mergeConversation(SESSION, [turn(3)], { kind: 'window', complete: false });

    store.getState().mergeConversation(SESSION, [ticketTurn(4)], { kind: 'merge' });

    expect(visibleTurns(store, 42)).toEqual(both(1, 2, 4));
    expect(visibleTurns(store)).toEqual(both(3));
  });

  it('keeps unchanged entities and lists by reference when the same turn comes again', () => {
    const store = createControlPlaneStore();
    store.getState().mergeConversation(SESSION, range(1, 3), { kind: 'window', complete: true });
    const before = store.getState();

    store.getState().mergeConversation(SESSION, [turn(2)], { kind: 'merge' });

    const after = store.getState();
    expect(after.messageIdsBySession).toBe(before.messageIdsBySession);
    expect(after.turnsById).toBe(before.turnsById);
    expect(after.messagePartsById).toBe(before.messagePartsById);
  });
});
