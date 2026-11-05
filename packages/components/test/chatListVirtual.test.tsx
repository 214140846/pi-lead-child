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
    // 列表的滚动节点（web 上是一个 div）。缺省没有，像原生上一样。
    node: null as HTMLElement | null,
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
      this.scrollToEnd.mockReset();
      this.scrollToEnd.mockImplementation(async () => {});
      this.node = null;
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
      getScrollableNode: () => legend.node,
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

// 浏览器的滚动区替身。和浏览器一样：scrollTop 按 scrollHeight - clientHeight 夹住；直接写 scrollTop 会打断正在进行的平滑滚动；
// 平滑滚动每一帧走一段；requestAnimationFrame 的回调在画这一帧之前跑。frames 记下每一帧画出来的位置。
function scroller(metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }) {
  const node = document.createElement('div');
  let top = metrics.scrollTop;
  let smooth = false;
  const state = { scrollHeight: metrics.scrollHeight, clientHeight: metrics.clientHeight };
  const bottom = () => state.scrollHeight - state.clientHeight;
  const clamp = (value: number) => Math.max(0, Math.min(value, bottom()));
  Object.defineProperty(node, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => { smooth = false; top = clamp(value); },
  });
  Object.defineProperty(node, 'scrollHeight', { configurable: true, get: () => state.scrollHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, get: () => state.clientHeight });
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callbacks.push(callback));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks[id - 1] = () => {}; });
  const frames: number[] = [top];
  return {
    node,
    frames,
    // Legend List 的 scrollToEnd({ animated: true })：从现在的位置平滑滚到底。
    scrollToEnd: () => { smooth = true; },
    // 你滚到了这里：浏览器发 scroll 事件。
    scrollTo(value: number) {
      top = clamp(value);
      node.dispatchEvent(new Event('scroll'));
    },
    // 列表下面的东西变矮（输入框清空后变回一行）：滚动区变高，浏览器马上把 scrollTop 夹到新的最大值。
    grow(by: number) {
      state.clientHeight += by;
      top = clamp(top);
    },
    // 列表的内容变长（新消息画出来了）。
    extend(by: number) {
      state.scrollHeight += by;
    },
    // 浏览器画一帧：先跑 requestAnimationFrame 的回调，平滑滚动走一段，再画。
    frame() {
      for (const callback of callbacks.splice(0)) act(() => callback(0));
      if (smooth) {
        top = clamp(top + Math.max(1, (bottom() - top) / 2));
        if (top >= bottom()) smooth = false;
      }
      frames.push(top);
    },
    get bottom() { return bottom(); },
  };
}

// 工单 #251：在会话里按回车发消息，列表先往下跳、再往上滚。多行消息发出去以后输入框变回一行，列表的可视区变高；
// 这一刻新消息还没画出来，浏览器把 scrollTop 夹回旧内容的底部，旧内容整体往下移。接着新消息出来，列表再滚到底。
describe('sending a message while you are at the bottom', () => {
  it('scrolls down to the new message in one direction, without first jumping back up', () => {
    const view = scroller({ scrollTop: 1596, scrollHeight: 2218, clientHeight: 622 });
    legend.node = view.node;
    legend.scrollToEnd.mockImplementation(async () => view.scrollToEnd());
    const { rerender } = renderUI(<List data={[block('a'), block('b')]} followKey="m1" />);
    act(() => view.scrollTo(1596));
    view.frame();

    // 回车：输入框变矮 96，消息进列表；Legend List 在这一帧画出来之前才把新消息（100 高）写进页面。
    view.grow(96);
    rerender(<List data={[block('a'), block('b'), block('c')]} followKey="m2" />);
    view.extend(100);
    for (let index = 0; index < 12; index += 1) view.frame();

    expect(legend.scrollToEnd).toHaveBeenCalledWith({ animated: true });
    expect(view.frames.at(-1)).toBe(view.bottom);
    for (let index = 1; index < view.frames.length; index += 1) {
      expect(view.frames[index]).toBeGreaterThanOrEqual(view.frames[index - 1]!);
    }
  });

  it('leaves the position alone when nothing pulled the list back', () => {
    const view = scroller({ scrollTop: 1500, scrollHeight: 2218, clientHeight: 718 });
    legend.node = view.node;
    const { rerender } = renderUI(<List data={[block('a'), block('b')]} followKey="m1" />);
    act(() => view.scrollTo(1500));
    rerender(<List data={[block('a'), block('b'), block('c')]} followKey="m2" />);
    view.extend(100);
    view.frame();
    expect(view.node.scrollTop).toBe(1500);
    expect(legend.scrollToEnd).toHaveBeenCalledTimes(1);
    expect(legend.scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  it('does not move you when a new block arrives while you read further up', () => {
    const view = scroller({ scrollTop: 400, scrollHeight: 2218, clientHeight: 622 });
    legend.node = view.node;
    const { rerender } = renderUI(<List data={[block('a'), block('b')]} followKey="m1" />);
    act(() => view.scrollTo(400));
    act(() => legend.emit('isFollowingEnd', false));
    act(() => legend.emit('isAtEnd', false));
    view.grow(96);
    rerender(<List data={[block('a'), block('b'), block('c')]} followKey="m1" />);
    view.extend(100);
    view.frame();
    expect(view.node.scrollTop).toBe(400);
    expect(legend.scrollToEnd).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-new')).toBeTruthy();
  });
});
