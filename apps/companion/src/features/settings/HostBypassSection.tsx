import { Box, Button, Card, Column, Dot, Row, SegmentedControl, Text } from '@pi-lead-child/components';
import { HOST_BYPASS_DEFAULT_MINUTES, isHostBypassMinutes } from '@pi-lead-child/protocol';
import { useState } from 'react';

import { useLocale } from '@/i18n';
import { useNow } from '@/features/tickets/useNow';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useHostBypass, useLeadName } from '@/state/hooks';

import { hostBypassMessages } from './hostBypass.messages';
import { hostBypassDurationOptions, hostBypassErrorText, hostBypassLeft, hostBypassStatusLine } from './hostBypassModel';

// 设置 → 免沙箱（工单 #246 设计 5.1–5.3，实施单 A）：「用户本人发话时免沙箱」的开关。
// 一张卡：标题和说明；状态一行（开着时琥珀色的点，C-11「等你」，加文字写还剩几分钟、几点自动关，不只靠颜色，P7.2）；
// 时长五档（15、30、60、120、240 分钟，缺省 30）；按钮。关着时「打开」是唯一的主按钮；开着时「关闭」是主按钮，
// 「重新计时」是默认按钮（按新的时长从现在算，不累加）。
// 打开走操作层的 host_bypass.enable（user_direct，只有你本人能做）；关闭走 host_bypass.disable（Lead 也能做）。
// 倒计时每 15 秒按本机时间重算一次；到点以后 daemon 推 snapshot.required，这里跟着变成关。
export function HostBypassSection() {
  const runtime = useCompanionRuntime();
  const { hostBypass, resource } = useHostBypass();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = hostBypassMessages(locale);
  // 每 15 秒画一次；时间按画的这一刻取，刚打开、刚重新计时的那一下也准。
  useNow(15_000);
  const [minutes, setMinutes] = useState(String(HOST_BYPASS_DEFAULT_MINUTES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hostBypass) {
    return (
      <Text testID="host-bypass-loading" size="note" tone={resource?.state === 'error' ? 'danger-dark' : 'muted'}>
        {resource?.state === 'error' ? m.loadFailed(hostBypassErrorText(resource.error, locale)) : m.loading}
      </Text>
    );
  }

  const now = Date.now();
  const on = hostBypassLeft(hostBypass, now) > 0;
  const act = (change: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    change()
      .catch((reason: unknown) => setError(hostBypassErrorText(reason, locale)))
      .finally(() => setBusy(false));
  };
  const enable = () => {
    const value = Number(minutes);
    if (isHostBypassMinutes(value)) act(() => runtime.enableHostBypass(value));
  };

  return (
    <Card testID="host-bypass-section" rounded="xl" p="page-card" gap="card-section">
      <Column gap="text-stack">
        <Text size="card-title" weight="semibold">{m.title}</Text>
        <Text size="secondary" tone="secondary">{m.description(leadName)}</Text>
      </Column>
      <Row items="center" gap="side-item">
        <Dot color={on ? 'warning' : 'text-faint'} size={8} />
        <Text testID="host-bypass-status" size="body" tone={on ? 'warning-dark' : 'secondary'}>
          {hostBypassStatusLine(hostBypass, now, locale)}
        </Text>
      </Row>
      <Column gap="field">
        <Text size="label" weight="bold" tone="secondary">{m.duration}</Text>
        <Box w={360} maxW="100%">
          <SegmentedControl
            testID="host-bypass-minutes"
            options={hostBypassDurationOptions(locale)}
            value={minutes}
            onChange={setMinutes}
            optionTestID={(value) => `host-bypass-minutes-${value}`}
            size="sm"
          />
        </Box>
        {on ? <Text size="note" tone="muted">{m.restartNote}</Text> : null}
      </Column>
      <Row items="center" gap="actions" flexWrap="wrap">
        {on ? (
          <>
            <Button testID="host-bypass-off" label={busy ? m.working : m.turnOff} size="sm" disabled={busy} onPress={() => act(() => runtime.disableHostBypass())} />
            <Button testID="host-bypass-restart" label={m.restart} variant="outline" tone="neutral" size="sm" disabled={busy} onPress={enable} />
          </>
        ) : (
          <Button testID="host-bypass-on" label={busy ? m.working : m.turnOn} size="sm" disabled={busy} onPress={enable} />
        )}
      </Row>
      {error ? <Text testID="host-bypass-error" size="note" tone="danger-dark">{error}</Text> : null}
      <Text size="meta" tone="muted">{m.onlyYou(leadName)}</Text>
    </Card>
  );
}
