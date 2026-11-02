import {
  Box, Button, canCopyText, Card, Chip, Column, copyText, IconButton, QrCode, Row, Text, TextField,
} from '@pi-lead-child/components';
import type { LoopbackInvitation } from '@pi-lead-child/protocol';
import { useState } from 'react';

import { useLocale } from '@/i18n';

import { devicesMessages } from './devices.messages';
import {
  countdownLabel, defaultPhoneName, endpointLabel, PHONE_NAME_MAX, phoneNameError, qrModuleSize,
} from './phonePairingModel';
import { usePhoneInvitation } from './usePhoneInvitation';

// 设置 → 设备 → 添加手机（只在 web 上显示，见 DevicesSection）。
// 网页生成一个配对二维码，手机上的 Companion 点「扫描局域网配对码」扫它。
// 邀请是凭证：页面上只画二维码，不显示 URI 的文字；「复制邀请」把它放进剪贴板。
export function AddPhone({ onPaired }: { onPaired?: () => void }) {
  const locale = useLocale();
  const m = devicesMessages(locale).phone;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => defaultPhoneName(locale));
  const { state, create, reset } = usePhoneInvitation(onPaired);

  const close = () => {
    reset();
    setName(defaultPhoneName(locale));
    setOpen(false);
  };

  if (!open) {
    return (
      <Row>
        <Button testID="add-phone" label={m.add} icon="plus" variant="outline" tone="neutral" size="sm" onPress={() => setOpen(true)} />
      </Row>
    );
  }

  const nameError = phoneNameError(name, locale);

  return (
    <Card testID="add-phone-panel" rounded="2xl" p="page-card" gap="card-section">
      <Row items="center" gap="inline-item">
        <Text flex={1} size="card-title" weight="bold">{m.add}</Text>
        <IconButton testID="add-phone-close" icon="close" label={m.close} variant="ghost" size="sm" iconSize={15} onPress={close} />
      </Row>

      {state.phase === 'idle' || state.phase === 'failed' ? (
        <Column gap="form-field">
          <Text size="secondary" tone="secondary">
            {m.instructions}
          </Text>
          <Column gap="field">
            <Text size="label" weight="semibold" tone="secondary">{m.deviceName}</Text>
            <TextField
              testID="add-phone-name"
              value={name}
              onChangeText={setName}
              maxLength={PHONE_NAME_MAX}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={m.deviceName}
              onSubmit={() => { if (!nameError) create(name.trim()); }}
            />
            {nameError ? <Text testID="add-phone-name-error" size="note" tone="danger-dark">{nameError}</Text> : null}
          </Column>
          {state.phase === 'failed' ? (
            <Text testID="add-phone-error" size="secondary" tone="danger-dark">{state.error}</Text>
          ) : null}
          <Row>
            <Button
              testID="add-phone-create"
              label={m.create}
              size="sm"
              disabled={nameError !== null}
              onPress={() => create(name.trim())}
            />
          </Row>
        </Column>
      ) : null}

      {state.phase === 'creating' ? (
        <Text testID="add-phone-creating" size="body" tone="secondary">{m.creating}</Text>
      ) : null}

      {state.phase === 'showing' || state.phase === 'expired' ? (
        <InvitationView
          name={state.name}
          invitation={state.invitation}
          remainingMs={state.phase === 'showing' ? state.remainingMs : 0}
          expired={state.phase === 'expired'}
          onRegenerate={(endpoint) => create(state.name, endpoint)}
        />
      ) : null}

      {state.phase === 'paired' ? (
        <Column testID="add-phone-paired" gap="card-row">
          <Text size="label" weight="bold" tone="success-dark">{m.pairedTitle(state.name)}</Text>
          <Text size="secondary" tone="secondary">{m.pairedBody}</Text>
          <Row><Button testID="add-phone-done" label={m.done} size="sm" onPress={close} /></Row>
        </Column>
      ) : null}
    </Card>
  );
}

function InvitationView({ name, invitation, remainingMs, expired, onRegenerate }: {
  name: string;
  invitation: LoopbackInvitation;
  remainingMs: number;
  expired: boolean;
  onRegenerate: (endpoint: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const m = devicesMessages(useLocale()).phone;
  const side = (invitation.qr.size + 8) * qrModuleSize(invitation.qr.size);

  return (
    <Column gap="card-row">
      <Row gap="side-item" items="flex-start" flexWrap="wrap">
        {expired ? (
          <Box testID="add-phone-expired" w={side} h={side} rounded="md" bg="surface-muted" items="center" justify="center" px="inset-x" py="inset-y" gap="card-row">
            <Text size="label" weight="bold" tone="secondary">{m.expired}</Text>
            <Button testID="add-phone-regenerate" label={m.regenerate} size="sm" onPress={() => onRegenerate(invitation.endpoint)} />
          </Box>
        ) : (
          <Box rounded="md" overflow="hidden" borderWidth={1} borderColor="border">
            <QrCode
              testID="add-phone-qr"
              rows={invitation.qr.rows}
              moduleSize={qrModuleSize(invitation.qr.size)}
              accessibilityLabel={m.qrLabel(name)}
            />
          </Box>
        )}
        <Column flex={1} minW={200} gap="card-row">
          <Text size="card-title" weight="bold">{m.scanTitle(name)}</Text>
          <Text size="secondary" tone="secondary">{m.scanHint}</Text>
          {expired ? null : (
            <Text testID="add-phone-countdown" size="secondary" tone="secondary">{m.expiresIn(countdownLabel(remainingMs))}</Text>
          )}
          <EndpointChoice invitation={invitation} onPick={onRegenerate} />
          {canCopyText && !expired ? (
            <Row>
              <Button
                testID="add-phone-copy"
                label={copied ? m.copied : m.copy}
                icon="copy"
                variant="outline"
                tone="neutral"
                size="sm"
                onPress={() => { void copyText(invitation.uri).then(setCopied); }}
              />
            </Row>
          ) : null}
        </Column>
      </Row>
    </Column>
  );
}

// 网关在几个局域网地址上监听时（例如 Wi-Fi 和 Tailscale），让用户选手机能连到的那个。选了别的就重新生成。
function EndpointChoice({ invitation, onPick }: { invitation: LoopbackInvitation; onPick: (endpoint: string) => void }) {
  const m = devicesMessages(useLocale()).phone;
  if (invitation.endpoints.length < 2) {
    return <Text testID="add-phone-endpoint" size="meta" tone="muted">{m.endpoint(endpointLabel(invitation.endpoint))}</Text>;
  }
  return (
    <Column gap="field">
      <Text size="label" tone="muted">{m.whichEndpoint}</Text>
      <Row gap="chips" flexWrap="wrap">
        {invitation.endpoints.map((endpoint) => (
          <Chip
            key={endpoint}
            testID={`add-phone-endpoint-${endpointLabel(endpoint)}`}
            label={endpointLabel(endpoint)}
            selected={endpoint === invitation.endpoint}
            onPress={endpoint === invitation.endpoint ? undefined : () => onPick(endpoint)}
          />
        ))}
      </Row>
    </Column>
  );
}
