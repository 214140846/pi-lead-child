// 聊天列表（ChatList）在量得出行高的地方用 Legend List，只画看得见的块（2026-11-04）。jsdom 量不出行高，
// 这里用一个替身代替 Legend List：记下列表拿到的参数，按它的接口报告「跟着底部」「在底部」和行高的变化。
import { act, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatList, Text, UIProvider } from '../src';

// rerender 也要在组件库的根下（renderUI 只包第一次）。
const renderUI = (element: Parameters<typeof render>[0]) => render(element, { wrapper: UIProvider });

const legend = vi.hoisted(() => {
  type Listener = (value: boolean) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    props: null as Record<string, any> | null,
    state: { isFollowingEnd: true, isAtEnd: true },
    scrollToEnd: vi.fn(async () => {}),
    listeners,
    emit(name: 'isFollowingEnd' | 'isAtEnd', value: boolean) {
      this.state[name] = value;
      for (const listener of listeners.get(name) ?? []) listener(value);
    },
    reset() {
      this.props = null;
      this.state = { isFollowingEnd: true, isAtEnd: true };
      this.scrollToEnd.mockClear();
      listeners.clear();
    },
  };
});

vi.mock('@legendapp/list/react-native', () => ({
  LegendList: forwardRef(function FakeLegendList(props: Record<string, any>, ref) {
    legend.props = props;
    useImperativeHandle(ref, () => ({
      getState: () => ({
        ...legend.state,
        listen: (name: string, listener: (value: boolean) => void) => {
          const set = legend.listeners.get(name) ?? new Set();
          set.add(listener);
          legend.listeners.set(name, set);
          return () => set.delete(listener);
        },
      }),
      scrollToEnd: legend.scrollToEnd,
      getScrollableNode: () => null,
      anchorVisibleContent: () => undefined,
    }));
    const data = props.data as unknown[];
    return (
      <>
        {props.ListHeaderComponent as ReactNode}
        {data.map((item, index) => <div key={props.keyExtractor(item)}>{props.renderItem({ item, index })}</div>)}
        {props.ListFooterComponent as ReactNode}
      </>
    );
  }),
}));

type Block = { id: string };
const block = (id: string): Block => ({ id });

function List({ data, followKey = null, onStartReached }: { data: Block[]; followKey?: string | null; onStartReached?: () => void }) {
  return (
    <ChatList
      testID="chat"
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={(item) => <Text testID={`block-${item.id}`}>{item.id}</Text>}
      extraData={{ latest: data.at(-1)?.id }}
      followKey={followKey}
      bottomAligned={false}
      {...(onStartReached ? { onStartReached } : {})}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  legend.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('the chat list on Legend List', () => {
  it('lands at the newest block, follows the bottom, keeps what you read in place and never recycles blocks', () => {
    const onStartReached = vi.fn();
    renderUI(<List data={[block('a'), block('b')]} onStartReached={onStartReached} />);
    const props = legend.props!;
    expect(props).toMatchObject({
      initialScrollAtEnd: true,
      maintainScrollAtEnd: true,
      maintainVisibleContentPosition: true,
      alignItemsAtEnd: false,
      extraData: { latest: 'b' },
    });
    expect(props.recycleItems).toBeUndefined();
    expect(props.keyExtractor(block('x'))).toBe('x');
    props.onStartReached({ distanceFromStart: 10 });
    expect(onStartReached).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('block-b')).toBeTruthy();
  });

  it('says there is something new below when a block arrives while you read further up, and goes back down on a press', () => {
    const { rerender } = renderUI(<List data={[block('a'), block('b')]} />);
    act(() => legend.emit('isFollowingEnd', false));
    act(() => legend.emit('isAtEnd', false));
    rerender(<List data={[block('a'), block('b'), block('c')]} />);

    fireEvent.click(screen.getByTestId('chat-new'));
    expect(legend.scrollToEnd).toHaveBeenCalledWith({ animated: true });
    expect(screen.queryByTestId('chat-new')).toBeNull();
  });

  it('says nothing when older blocks come in above', () => {
    const { rerender } = renderUI(<List data={[block('c'), block('d')]} />);
    act(() => legend.emit('isFollowingEnd', false));
    act(() => legend.emit('isAtEnd', false));
    rerender(<List data={[block('a'), block('b'), block('c'), block('d')]} />);
    expect(screen.queryByTestId('chat-new')).toBeNull();
  });

  it('says there is something new when the last block grows while you read further up, and stops once you are back at the bottom', () => {
    renderUI(<List data={[block('a'), block('b')]} />);
    act(() => legend.emit('isFollowingEnd', false));
    act(() => legend.emit('isAtEnd', false));
    act(() => legend.props!.onItemSizeChanged({ size: 320, previous: 200, itemKey: 'a', index: 0 }));
    expect(screen.queryByTestId('chat-new')).toBeNull();
    act(() => legend.props!.onItemSizeChanged({ size: 320, previous: 200, itemKey: 'b', index: 1 }));
    expect(screen.getByTestId('chat-new')).toBeTruthy();

    act(() => legend.emit('isAtEnd', true));
    expect(screen.queryByTestId('chat-new')).toBeNull();
  });

  it('follows along without a hint while you are at the bottom', () => {
    const { rerender } = renderUI(<List data={[block('a')]} />);
    rerender(<List data={[block('a'), block('b')]} />);
    act(() => legend.props!.onItemSizeChanged({ size: 320, previous: 200, itemKey: 'b', index: 1 }));
    expect(screen.queryByTestId('chat-new')).toBeNull();
  });

  it('goes back to the bottom when you send a message, not on the first render', () => {
    const { rerender } = renderUI(<List data={[block('a')]} followKey="m1" />);
    expect(legend.scrollToEnd).not.toHaveBeenCalled();
    rerender(<List data={[block('a'), block('b')]} followKey="m2" />);
    expect(legend.scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });
});
