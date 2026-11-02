import { Button, Column, Dot, Row, Text } from '@pi-lead-child/components';
import type { ReactNode } from 'react';

import { useMessages } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useEndpointMismatch } from '@/state/hooks';

import { devicesMessages } from './devices.messages';

// 已经配对的设备：状态、说明、配置的地址配不上时的提示，以及移除凭证。
// 设置的「本设备」和配对页（配对完成的那一刻）都用它。details 放在状态下面，例如这个设备的名称和类型。
export function PairedDeviceStatus({ details }: { details?: ReactNode }) {
  const runtime = useCompanionRuntime();
  const endpointMismatch = useEndpointMismatch();
  const m = useMessages(devicesMessages);
  return (
    <Column testID="paired-device-status" gap="card-row">
      <Row items="center" gap="icon-label">
        <Dot color="success" size={9} />
        <Text size="card-title" weight="extrabold">{m.paired}</Text>
      </Row>
      {details}
      <Text size="note" tone="muted">{m.credentialSaved}</Text>
      {endpointMismatch ? (
        <Text size="secondary" weight="semibold" tone="danger-dark">
          {m.endpointMismatch(endpointMismatch.configuredEndpoint, endpointMismatch.error, endpointMismatch.activeEndpoint)}
        </Text>
      ) : null}
      <Button
        testID="pair-forget"
        label={m.forget}
        variant="outline"
        tone="danger"
        size="lg"
        fullWidth
        onPress={() => void runtime.forget()}
      />
    </Column>
  );
}
