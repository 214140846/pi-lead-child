import { Box, Button, Column, Icon, Pressable, Row, Screen, Text } from '@pi-lead-child/components';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useState } from 'react';

import { useMessages } from '@/i18n';

import { pairingMessages } from './pairing.messages';

interface PairingScannerProps {
  onClose(): void;
  onScanned(uri: string): void;
}

// 原生上的配对二维码扫描页。相机画面来自 expo-camera，其余界面由组件库组成。
export function PairingScanner({ onClose, onScanned }: PairingScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const m = useMessages(pairingMessages);

  const handleBarcode = (result: BarcodeScanningResult) => {
    if (locked) return;
    setLocked(true);
    onScanned(result.data);
  };

  return (
    <Screen bg="text">
      <Column flex={1} px="page-x" pb="page-section">
        <Row h={82} items="center" justify="space-between">
          <Pressable
            testID="pairing-scanner-close"
            aria-label={m.scannerClose}
            onPress={onClose}
            w={38}
            h={38}
            rounded="full"
            bg="rgba(255,255,255,0.1)"
            items="center"
            justify="center"
          >
            <Icon name="close" color="surface-subtle" size={18} />
          </Pressable>
          <Column items="center" gap="text-stack">
            <Text size="eyebrow" weight="extrabold" color="ink-muted" letterSpacing={1.2}>LOCAL PAIRING</Text>
            <Text size="section-title" weight="extrabold" color="surface-subtle">{m.scannerTitle}</Text>
          </Column>
          <Box w={38} />
        </Row>

        {!permission ? (
          <Column flex={1} minH={360} items="center" justify="center" p="empty-state" rounded={28} bg="surface-subtle">
            <Text size="body" tone="muted" align="center">{m.scannerPermissionLoading}</Text>
          </Column>
        ) : !permission.granted ? (
          <Column flex={1} minH={360} items="center" justify="center" p="empty-state" rounded={28} bg="surface-subtle">
            <Column w="100%" maxW={300} items="center" gap="card-row">
              <Box w={56} h={56} mb="card-row" rounded="xl" bg="icon-well" items="center" justify="center">
                <Icon name="camera" color="text" size={25} />
              </Box>
              <Text size="section-title" weight="extrabold">{m.scannerPermissionTitle}</Text>
              <Text size="secondary" tone="muted" align="center">{m.scannerPermissionHelp}</Text>
              <Button testID="pairing-scanner-permission" label={m.scannerPermissionAllow} size="xl" onPress={() => void requestPermission()} />
            </Column>
          </Column>
        ) : (
          <Box flex={1} minH={360} overflow="hidden" rounded={28} bg="ink-raised">
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={locked ? undefined : handleBarcode}
              style={{ flex: 1 }}
            />
            {/* spacing-exempt: 负边距居中 232 框 */}
            <Box pointerEvents="none" position="absolute" t="50%" l="50%" w={232} h={232} mt={-116} ml={-116}>
              <Box position="absolute" t={0} l={0} w={38} h={38} borderColor="white" borderTopWidth={4} borderLeftWidth={4} borderTopLeftRadius={12} />
              <Box position="absolute" t={0} r={0} w={38} h={38} borderColor="white" borderTopWidth={4} borderRightWidth={4} borderTopRightRadius={12} />
              <Box position="absolute" b={0} l={0} w={38} h={38} borderColor="white" borderBottomWidth={4} borderLeftWidth={4} borderBottomLeftRadius={12} />
              <Box position="absolute" b={0} r={0} w={38} h={38} borderColor="white" borderBottomWidth={4} borderRightWidth={4} borderBottomRightRadius={12} />
            </Box>
          </Box>
        )}

        <Text mt="page-section" size="note" color="ink-muted" align="center">
          {m.scannerCommand}
        </Text>
      </Column>
    </Screen>
  );
}
