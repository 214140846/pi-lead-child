import { Button, Dot, Row, Text } from '@pi-lead-child/components';
import { useState } from 'react';

import { useLocale } from '@/i18n';
import { useNow } from '@/features/tickets/useNow';
import { hostBypassErrorText, hostBypassLeft } from '@/features/settings/hostBypassModel';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useHostBypass } from '@/state/hooks';

import { hostBypassBarMessages } from './hostBypassBar.messages';

// 「用户本人发话时免沙箱」开着时，主对话输入框上方的标记（工单 #246 设计 5.3，主题 11.17「模式标记」）。
// 系统画（P8.1），一行，固定高度：琥珀色的点（C-11）、「免沙箱 · 还剩 27 分钟」、右边的「关闭」。文字写明状态，不只靠颜色（P7.2）。
// 它在输入框这一栏里，不在会话列表里：出现和消失都不插进列表，列表不跳（P1）。「关闭」调 host_bypass.disable。
// 倒计时每 15 秒按本机时间重算；到点以后这里先自己收起，daemon 的推送随后把开关置关。
export function HostBypassBar() {
  const runtime = useCompanionRuntime();
  const { hostBypass } = useHostBypass();
  const locale = useLocale();
  const m = hostBypassBarMessages(locale);
  // 每 15 秒画一次；时间按画的这一刻取。
  useNow(hostBypass?.enabled ? 15_000 : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = hostBypassLeft(hostBypass, Date.now());
  if (left <= 0) return null;

  const close = () => {
    setBusy(true);
    setError(null);
    runtime.disableHostBypass()
      .catch((reason: unknown) => setError(hostBypassErrorText(reason, locale)))
      .finally(() => setBusy(false));
  };

  return (
    <Row
      testID="host-bypass-bar"
      w="100%"
      mb={8} // spacing-exempt: 输入框上方的状态行间距，和 InterruptBanner 一样
      items="center"
      gap="side-item"
      bg="surface"
      borderWidth={1}
      borderColor="border-soft"
      rounded="md"
      px="banner-x"
      py="banner-y"
    >
      <Dot color="warning" size={7} />
      <Text testID="host-bypass-bar-text" size="label" tone="warning-dark" numberOfLines={1} flex={1} minW={0}>
        {error ? m.failed(error) : m.line(left)}
      </Text>
      <Button
        testID="host-bypass-bar-close"
        label={busy ? m.closing : m.close}
        onPress={close}
        disabled={busy}
        variant="link"
        size="xs"
      />
    </Row>
  );
}
