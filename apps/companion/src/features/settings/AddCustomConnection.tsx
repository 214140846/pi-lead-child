import { Button, Card, Column, Row, ServiceMark, Text, TextField } from '@pi-lead-child/components';
import { useState } from 'react';

import { useLocale, useMessages } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';

import { ConnectFlowSteps, useConnectFlow, type FlowTarget } from './ConnectFlow';
import { serverUrlProblem } from './connectionModel';
import { connectionsMessages } from './connections.messages';

// 添加一个远程 MCP 服务器：填 HTTPS 地址，点「连接」，后面和别的服务走同一个连接流程。
// 地址明显不对时这里先说；别的检查（能不能发现授权服务器等）由 daemon 做，它的说明原样显示。
export function AddCustomConnection({ onClose }: { onClose: () => void }) {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = useMessages(connectionsMessages);
  const flow = useConnectFlow();
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const host = hostOf(url);
  const target: FlowTarget = {
    key: 'custom',
    label: host ?? m.customServer,
    provider: 'custom',
    capability: m.customCapability,
    state: 'not_connected',
    setupHint: null,
    writePolicy: 'confirm',
    problem: null,
  };

  const connect = () => {
    const found = serverUrlProblem(url, locale);
    setProblem(found);
    if (found) return;
    flow.run(() => runtime.addCustomConnection(url.trim()), { browser: true });
  };

  // daemon 不接受这个地址时，说明写在输入框下面，地址留着可以改。
  const serverProblem = flow.state.step === 'failed' ? flow.state.message : null;
  const shown = problem ?? serverProblem;

  if (flow.state.step !== 'consent' && flow.state.step !== 'failed') {
    return (
      <Card testID="connections-custom" p="page-card" rounded="xl" gap="card-row">
        <ConnectFlowSteps target={target} flow={flow} onClose={onClose} onRetry={flow.reset} />
      </Card>
    );
  }

  return (
    <Card testID="connections-custom" p="page-card" rounded="xl" gap="card-section">
      <Row items="center" gap="side-item">
        <ServiceMark service="custom" label={host ?? undefined} size={32} />
        <Column flex={1} minW={0} gap="text-stack">
          <Text size="card-title" weight="bold">{m.addCustom}</Text>
          <Text size="secondary" tone="secondary">{m.addCustomHint}</Text>
        </Column>
      </Row>
      <TextField
        testID="connections-custom-url"
        value={url}
        onChangeText={(value) => {
          setUrl(value);
          setProblem(null);
          if (serverProblem) flow.reset();
        }}
        placeholder="https://mcp.example.com/mcp"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={m.customUrlLabel}
        onSubmit={connect}
      />
      {shown ? <Text testID="connections-custom-problem" size="note" weight="semibold" tone="danger-dark">{shown}</Text> : null}
      <Row gap="actions">
        <Button testID="connections-custom-connect" label={m.connect} disabled={!url.trim()} onPress={connect} />
        <Button label={m.cancel} variant="ghost" tone="neutral" onPress={onClose} />
      </Row>
    </Card>
  );
}

function hostOf(value: string): string | null {
  try {
    return new URL(value.trim()).host || null;
  } catch {
    return null;
  }
}
