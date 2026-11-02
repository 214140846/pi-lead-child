import { Card, Column, Row, Text } from '@pi-lead-child/components';

import { useLocale } from '@/i18n';
import { useConnectionPhase, useConnectionState } from '@/state/hooks';

import { bindingKindLabel } from './deviceModel';
import { devicesMessages } from './devices.messages';
import { PairedDeviceStatus } from './PairedDeviceStatus';
import { isDevicePaired } from './settingsNav';
import { UnpairedNotice } from './UnpairedNotice';
import { useOwnBinding } from './useDeviceData';

// 设置 → 设备 → 本设备。以前是会话顶栏 Lead 名字后面的配对弹窗；配对以后它的内容放在这里。
export function DeviceSection() {
  const phase = useConnectionPhase();
  const paired = isDevicePaired(phase);
  const own = useOwnBinding(paired);
  const connectionState = useConnectionState();
  const locale = useLocale();
  const m = devicesMessages(locale);

  if (!paired) return <UnpairedNotice />;

  return (
    <Card testID="settings-device" p="page-card" rounded="2xl">
      <PairedDeviceStatus
        details={(
          // spacing-exempt: 光学对齐
          <Column gap="card-row" py={4}>
            <Fact label={m.name} value={own.binding?.name ?? m.loading} testID="device-name" />
            <Fact label={m.kind} value={own.binding ? bindingKindLabel(own.binding.kind, locale) : m.loading} testID="device-kind" />
            <Fact label={m.daemon} value={connectionState === 'connected' ? m.online : m.offline} testID="device-daemon" />
            {own.error ? (
              <Text size="secondary" tone="danger-dark">{m.ownLoadFailed(own.error)}</Text>
            ) : null}
          </Column>
        )}
      />
    </Card>
  );
}

function Fact({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <Row items="baseline" gap="inline-item">
      <Text w={72} shrink={0} size="label" tone="secondary">{label}</Text>
      <Text testID={testID} flex={1} minW={0} size="body" weight="semibold" numberOfLines={1}>{value}</Text>
    </Row>
  );
}
