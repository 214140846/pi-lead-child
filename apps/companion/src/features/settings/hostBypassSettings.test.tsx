// @vitest-environment jsdom
// 设置 → 免沙箱（工单 #246 实施单 A）：时长只有五档、缺省 30；打开以后看到倒计时；到点自动变成关；开着时能关、能重新计时。
// 契约在 packages/protocol/src/host-bypass.ts；客户端方法是假的，断言的是界面发出的请求和画出来的状态。
import type { HostBypassDto } from '@pi-lead-child/protocol';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithRuntime } from '../../../test/connections';
import { createCompanionStateRuntime, type CompanionRuntimeDependencies } from '../../state/runtime';
import { HostBypassSection } from './HostBypassSection';
import { hostBypassStatusLine } from './hostBypassModel';

vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn(), digest: vi.fn(), CryptoDigestAlgorithm: {} }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/settings/host-bypass', Slot: () => null, Stack: () => null }));

afterEach(() => vi.useRealTimers());

const OFF: HostBypassDto = { enabled: false, until: null, enabledAt: null, bindingId: null, reason: null };
const onFor = (ms: number): HostBypassDto => ({
  enabled: true, until: new Date(Date.now() + ms).toISOString(), enabledAt: new Date().toISOString(), bindingId: 3, reason: '在设置页打开了免沙箱',
});

function hostBypassRuntime(initial: HostBypassDto) {
  const fake = {
    getHostBypass: vi.fn(async () => initial),
    enableHostBypass: vi.fn(async ({ minutes }: { minutes: number }) => onFor(minutes * 60_000)),
    disableHostBypass: vi.fn(async () => OFF),
  };
  const runtime = createCompanionStateRuntime({
    client: fake as unknown as CompanionRuntimeDependencies['client'],
    credentials: {} as CompanionRuntimeDependencies['credentials'],
    scheduler: { schedule: () => 0, cancel: () => {}, now: () => 0 },
  });
  (runtime as unknown as { scopes: Set<string> }).scopes = new Set(['chat', 'tickets:view', 'tickets:create']);
  runtime.control.setState((state) => ({
    phase: 'ready',
    connectionState: 'connected',
    hostBypass: initial,
    resourceState: {
      ...state.resourceState,
      'host-bypass': { state: 'ready', generation: 0, observerCount: 0, lastSuccessAt: 0, error: null },
    },
  }));
  return { runtime, client: fake };
}

describe('the sandbox bypass settings', () => {
  it('offers only the five durations and turns on for 30 minutes by default', async () => {
    const { runtime, client } = hostBypassRuntime(OFF);
    renderWithRuntime(<HostBypassSection />, runtime);
    expect(screen.getByTestId('host-bypass-status').textContent).toBe('Off');
    expect(['15', '30', '60', '120', '240'].map((value) => screen.getByTestId(`host-bypass-minutes-${value}`).textContent))
      .toEqual(['15 min', '30 min', '1 h', '2 h', '4 h']);
    expect(screen.queryByTestId('host-bypass-minutes-45')).toBeNull();
    expect(screen.queryByTestId('host-bypass-off')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByTestId('host-bypass-on')); });
    expect(client.enableHostBypass).toHaveBeenCalledWith({ minutes: 30 });
    expect(screen.getByTestId('host-bypass-status').textContent).toMatch(/^On · 30 minutes left · until \d{2}:\d{2}$/);
    expect(screen.getByTestId('host-bypass-off')).toBeTruthy();
    expect(screen.queryByTestId('host-bypass-on')).toBeNull();
  });

  it('turns on for the chosen duration', async () => {
    const { runtime, client } = hostBypassRuntime(OFF);
    renderWithRuntime(<HostBypassSection />, runtime);
    fireEvent.click(screen.getByTestId('host-bypass-minutes-120'));
    await act(async () => { fireEvent.click(screen.getByTestId('host-bypass-on')); });
    expect(client.enableHostBypass).toHaveBeenCalledWith({ minutes: 120 });
    expect(screen.getByTestId('host-bypass-status').textContent).toContain('120 minutes left');
  });

  it('counts down and shows off at the end time without waiting for the daemon', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const { runtime } = hostBypassRuntime(onFor(20_000));
    renderWithRuntime(<HostBypassSection />, runtime);
    expect(screen.getByTestId('host-bypass-status').textContent).toContain('1 minute left');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('host-bypass-status').textContent).toBe('Off');
    expect(screen.getByTestId('host-bypass-on')).toBeTruthy();
  });

  it('turns off, and starts the time again from now', async () => {
    const { runtime, client } = hostBypassRuntime(onFor(27 * 60_000 - 1_000));
    renderWithRuntime(<HostBypassSection />, runtime);
    expect(screen.getByTestId('host-bypass-status').textContent).toContain('27 minutes left');
    fireEvent.click(screen.getByTestId('host-bypass-minutes-60'));
    await act(async () => { fireEvent.click(screen.getByTestId('host-bypass-restart')); });
    expect(client.enableHostBypass).toHaveBeenCalledWith({ minutes: 60 });
    expect(screen.getByTestId('host-bypass-status').textContent).toContain('60 minutes left');
    await act(async () => { fireEvent.click(screen.getByTestId('host-bypass-off')); });
    expect(client.disableHostBypass).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('host-bypass-status').textContent).toBe('Off');
  });

  it('writes the status in Chinese', () => {
    const until = new Date(Date.now() + 27 * 60_000 - 1_000);
    expect(hostBypassStatusLine(onFor(27 * 60_000 - 1_000), Date.now(), 'zh'))
      .toBe(`开着 · 还剩 27 分钟 · ${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')} 自动关`);
    expect(hostBypassStatusLine(OFF, Date.now(), 'zh')).toBe('关着');
  });
});
