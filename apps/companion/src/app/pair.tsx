import {
  Box, Button, Card, Column, Dot, Icon, IconButton, isWeb, platformOS, Pressable, Row, Screen, Text, TextField,
} from '@pi-lead-child/components';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { PairingScanner } from '@/components/PairingScanner';
import { pairingMessages } from '@/components/pairing.messages';
import { useMessages } from '@/i18n';
import { resolveLoopbackAutoPairEndpoint } from '@pi-lead-child/client';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { isDevicePaired } from '@/features/settings/settingsNav';
import { PairedDeviceStatus } from '@/features/settings/PairedDeviceStatus';
import { useConnectionPhase, useControlPlaneError, useLeadName } from '@/state/hooks';

// 还没配对时的配对页。配对以后，这台设备的状态和「移除此设备凭证」在设置的「本设备」里（/settings/device）。
export default function PairScreen() {
  const router = useRouter();
  const runtime = useCompanionRuntime();
  const phase = useConnectionPhase();
  const leadName = useLeadName();
  const m = useMessages(pairingMessages);
  const controlPlaneError = useControlPlaneError();
  const [invitation, setInvitation] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [code, setCode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualVisible, setManualVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const loopbackEndpoint = resolveLoopbackAutoPairEndpoint({
    platform: platformOS,
    appOrigin: typeof location === 'undefined' ? null : location.origin,
    configuredEndpoint: process.env.EXPO_PUBLIC_PLC_GATEWAY_URL,
    servedByGateway: process.env.EXPO_PUBLIC_PLC_SERVED_BY_GATEWAY === '1',
  });

  const retryLoopback = async () => {
    if (!loopbackEndpoint) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await runtime.pairLoopback(loopbackEndpoint);
      router.back();
    } catch (reason) {
      setFormError(pairingErrorText(reason, m));
    } finally {
      setSubmitting(false);
    }
  };

  const submitManual = async () => {
    if (!endpoint.trim() || !code.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await runtime.pair(endpoint, code);
      router.back();
    } catch (reason) {
      setFormError(pairingErrorText(reason, m));
    } finally {
      setSubmitting(false);
    }
  };

  const submitSocket = async (value = invitation) => {
    const uri = value.trim();
    if (!uri) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await runtime.pairSocket(uri);
      router.back();
    } catch (reason) {
      setFormError(pairingErrorText(reason, m));
    } finally {
      setSubmitting(false);
    }
  };

  const handleScanned = (uri: string) => {
    setScannerOpen(false);
    setInvitation(uri);
    if (!uri.startsWith('plc-pair://')) {
      setFormError(m.notInvitation(leadName));
      return;
    }
    void submitSocket(uri);
  };

  const connected = isDevicePaired(phase);
  const invitationDisabled = submitting || !invitation.trim();
  const manualDisabled = submitting || !endpoint.trim() || !code.trim();

  if (scannerOpen && !isWeb) {
    return <PairingScanner onClose={() => setScannerOpen(false)} onScanned={handleScanned} />;
  }

  return (
    <Screen bg="canvas" edges={['top', 'bottom', 'left', 'right']}>
      <Column flex={1} justify="center" px="page-x" py="page-y">
        <Card
          w="100%"
          maxW={520}
          self="center"
          p="page-card"
          rounded="4xl"
          borderColor="border-strong"
          boxShadow="0 28px 70px rgba(16,24,40,0.18)"
        >
          <Row justify="space-between" items="flex-start" mb="page-section">
            <Column gap="text-stack">
              <Text size="eyebrow" weight="extrabold" tone="muted" letterSpacing={1.1}>CONTROL PLANE</Text>
              <Text size="page-title" weight="extrabold" letterSpacing={-0.5}>{m.title(leadName)}</Text>
            </Column>
            <IconButton
              testID="pair-close"
              icon="close"
              label={m.close}
              variant="soft"
              size="sm"
              rounded="md"
              iconSize={17}
              iconColor="text-secondary"
              onPress={() => router.back()}
            />
          </Row>

          {connected ? (
            <PairedDeviceStatus />
          ) : (
            <>
              {loopbackEndpoint && isWeb ? (
                <Card testID="pair-loopback" tone="success" rounded="xl" px="inset-x" py="inset-y" gap="card-row" mb="page-section">
                  <Row items="center" gap="icon-label">
                    <Dot color="success" size={8} />
                    <Text size="card-title" weight="extrabold" tone="success-dark">{m.loopbackTitle}</Text>
                  </Row>
                  <Text size="secondary" tone="secondary">{m.loopbackHelp}</Text>
                  <Button
                    label={submitting ? m.loopbackPairing : m.loopbackRetry}
                    tone="success"
                    size="lg"
                    fullWidth
                    disabled={submitting}
                    onPress={() => void retryLoopback()}
                  />
                </Card>
              ) : null}
              <Column mt="text-stack" mb="card-section" gap="text-stack">
                <Text size="section-title" weight="extrabold">{m.crossDeviceTitle}</Text>
                <HelpText>{m.crossDeviceHelp}</HelpText>
              </Column>
              {!isWeb ? (
                <Pressable
                  testID="pair-scan"
                  disabled={submitting}
                  onPress={submitting ? undefined : () => setScannerOpen(true)}
                  minH={78}
                  mb="page-section"
                  px={16} // spacing-exempt: 按钮自己的规格
                  rounded="4xl"
                  bg="text"
                  justify="center"
                >
                  <Row items="center" gap="side-item">
                    <Box w={42} h={42} rounded="xl" bg="accent" items="center" justify="center">
                      <Icon name="qr-scan" color="white" size={23} />
                    </Box>
                    <Column flex={1} gap="text-stack">
                      <Text size="card-title" weight="extrabold" color="white">{m.scanTitle}</Text>
                      <Text size="secondary" color="ink-subtle">{m.scanHelp}</Text>
                    </Column>
                    <Icon name="chevron-right" color="ink-accent" size={17} />
                  </Row>
                </Pressable>
              ) : null}

              <FieldLabel>{m.invitationLabel}</FieldLabel>
              <TextField
                testID="pair-invitation"
                value={invitation}
                onChangeText={setInvitation}
                placeholder={m.invitationPlaceholder}
                variant="filled"
                size="lg"
                multiline
                height={82}
                mono
                fontSize="11.5"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {formError || controlPlaneError ? (
                <Box mt="field"><ErrorText>{formError ?? controlPlaneError ?? ''}</ErrorText></Box>
              ) : null}
              <Box mt="page-section">
                <Button
                  testID="pair-invitation-submit"
                  label={submitting ? m.invitationPairing : m.invitationSubmit}
                  size="xl"
                  fullWidth
                  disabled={invitationDisabled}
                  onPress={() => void submitSocket()}
                />
              </Box>

              <Pressable
                mt="card-section"
                h={42}
                px={6} // spacing-exempt: 按钮点击区
                justify="center"
                onPress={() => setManualVisible((current) => !current)}
              >
                <Row items="center" justify="center" gap="icon-label">
                  {/* spacing-exempt: 说明文字字号 */}
                  <Text size="12" weight="bold" tone="secondary">{manualVisible ? m.manualHide : m.manualShow}</Text>
                  <Icon name={manualVisible ? 'chevron-up' : 'chevron-down'} color="text-secondary" size={16} />
                </Row>
              </Pressable>

              {manualVisible ? (
                <Card tone="subtle" bg="surface-muted" borderColor="border" rounded="xl" px="inset-x" py="inset-y" mt="card-row" gap="field">
                  <FieldLabel>{m.endpointLabel}</FieldLabel>
                  <TextField
                    value={endpoint}
                    onChangeText={setEndpoint}
                    placeholder="http://192.168.1.10:47130"
                    variant="filled"
                    size="lg"
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Box h={11} />
                  <FieldLabel>{m.codeLabel}</FieldLabel>
                  <TextField
                    value={code}
                    onChangeText={setCode}
                    placeholder="PLC-ABCD"
                    variant="filled"
                    size="lg"
                    mono
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onSubmit={() => void submitManual()}
                  />
                  <Box h={11} />
                  <Button
                    testID="pair-manual-submit"
                    label={m.manualSubmit}
                    variant="outline"
                    tone="neutral"
                    size="lg"
                    fullWidth
                    disabled={manualDisabled}
                    onPress={() => void submitManual()}
                  />
                </Card>
              ) : null}
              <Box mt="card-section">
                <HelpText>{m.invitationNote}</HelpText>
              </Box>
            </>
          )}
        </Card>
      </Column>
    </Screen>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text size="label" weight="bold" tone="strong" mb="field">{children}</Text>;
}

function HelpText({ children }: { children: string }) {
  return <Text size="note" tone="muted">{children}</Text>;
}

function ErrorText({ children }: { children: string }) {
  return <Text size="note" weight="semibold" tone="danger-dark">{children}</Text>;
}

function pairingErrorText(reason: unknown, m: ReturnType<typeof pairingMessages>): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/loopback auto-pair|forbidden/i.test(message)) return m.errorLoopbackForbidden;
  if (/failed to fetch|network|connect|timeout/i.test(message)) return m.errorLoopbackUnreachable;
  return message || m.errorUnknown;
}
