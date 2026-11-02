import {
  Badge, Box, Button, Card, Column, Icon, IconButton, Pressable, Row, SegmentedControl, ServiceMark, Switch, Text, type BadgeTone,
} from '@pi-lead-child/components';
import type { ConnectionDto, ConnectionRole, ConnectionToolDto, ConnectionWritePolicy } from '@pi-lead-child/protocol';
import { useState, type ReactNode } from 'react';

import { useLocale, useMessages } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useConnections, useLeadName } from '@/state/hooks';

import { ConnectFlowPanel } from './ConnectFlow';
import {
  accessExpiryLabel, attentionMessage, connectionErrorText, connectionRoles, connectionNeedsUser, connectionStatus,
  connectionTimeLabel, renewalLabel, retryLabel, toggleRole, toolCountLabel,
} from './connectionModel';
import { connectionsMessages } from './connections.messages';

const WRITE_POLICY_ORDER: readonly ConnectionWritePolicy[] = ['confirm', 'direct'];

const STATUS_TONE: Record<'success' | 'warning' | 'danger' | 'muted', BadgeTone> = {
  success: 'success', warning: 'warning', danger: 'danger', muted: 'muted',
};

// 一个连接的详情：授权、Lead 能做什么、谁可以用、写入之前，以及测试和断开。
// 桌面上在连接列表右边的抽屉里（onClose 关掉抽屉）；手机上是一整页。
export function ConnectionDetail({ connectionKey, onClose }: { connectionKey: string; onClose?: () => void }) {
  const m = useMessages(connectionsMessages);
  const { connections } = useConnections();
  const connection = connections?.items.find((item) => item.key === connectionKey) ?? null;

  if (!connection) {
    return (
      <Column testID="connection-detail-missing" gap="page-section">
        {onClose ? <Row justify="flex-end"><CloseButton onClose={onClose} /></Row> : null}
        <Text size="body" tone="muted">{connections ? m.notFound : m.loading}</Text>
      </Column>
    );
  }
  return <ConnectionDetailBody key={connection.key} connection={connection} onClose={onClose} />;
}

function ConnectionDetailBody({ connection, onClose }: { connection: ConnectionDto; onClose?: () => void }) {
  const locale = useLocale();
  const status = connectionStatus(connection, locale);
  const connected = connection.state === 'connected' || connection.state === 'degraded' || connection.state === 'needs_reauth';
  // 在这一页上连接时，连上以后先留在连接流程里，看到「已连接」再换成详情。
  const [connecting, setConnecting] = useState(false);
  return (
    <Column testID={`connection-detail-${connection.key}`} gap="page-section">
      <Row items="center" gap="side-item">
        <ServiceMark service={connection.provider} label={connection.label} size={40} />
        <Column flex={1} minW={0} gap="text-stack">
          <Text size="section-title" weight="extrabold" numberOfLines={1}>{connection.label}</Text>
          {status ? (
            <Badge
              label={connection.account && connection.state === 'connected' ? `${status.label} · ${connection.account}` : status.label}
              tone={STATUS_TONE[status.tone]}
              dot={status.tone !== 'muted'}
            />
          ) : null}
        </Column>
        {onClose ? <CloseButton onClose={onClose} /> : null}
      </Row>
      {connected && !connecting ? <ConnectedSections connection={connection} /> : (
        <NotConnected connection={connection} open={connecting} onOpen={() => setConnecting(true)} onClose={() => setConnecting(false)} />
      )}
    </Column>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const m = useMessages(connectionsMessages);
  return <IconButton testID="connection-detail-close" icon="close" label={m.closeDetail} variant="ghost" size="sm" onPress={onClose} />;
}

// 还没连上的服务：说明它能做什么，下面是连接流程。即将支持的只有说明。
function NotConnected({ connection, open, onOpen, onClose }: {
  connection: ConnectionDto;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const m = useMessages(connectionsMessages);
  return (
    <Column gap="page-section">
      <Text size="body" tone="secondary">{connection.setupHint ?? connection.capability}</Text>
      {connection.state === 'unavailable' ? null : open ? (
        <ConnectFlowPanel target={connection} onClose={onClose} />
      ) : (
        <Row>
          <Button testID="connection-detail-connect" label={connection.state === 'needs_setup' ? m.setUp : m.connect} onPress={onOpen} />
        </Row>
      )}
    </Column>
  );
}

function ConnectedSections({ connection }: { connection: ConnectionDto }) {
  const leadName = useLeadName();
  const locale = useLocale();
  const m = useMessages(connectionsMessages);
  const now = new Date();
  const renewal = renewalLabel(connection, locale, now);
  return (
    <>
      <ProblemBanner connection={connection} />
      <Section title={m.authorization}>
        <Fact label={m.account} value={connection.account ?? '—'} />
        {connection.connectedAt ? <Fact label={m.connectedAt} value={connectionTimeLabel(connection.connectedAt, now, locale)} /> : null}
        {renewal ? <Fact label={m.renewalFact} value={renewal} /> : null}
        {connection.accessExpiresAt ? <Fact label={m.accessToken} value={accessExpiryLabel(connection.accessExpiresAt, locale, now)} /> : null}
        {connection.grantExpiresAt ? <Fact label={m.grantExpires} value={connectionTimeLabel(connection.grantExpiresAt, now, locale)} /> : null}
      </Section>
      <Section title={m.canDo(leadName)}>
        <Text size="body">{connection.capability}</Text>
        <ToolList connection={connection} />
      </Section>
      <Section title={m.whoCanUse}>
        <RoleSwitches connection={connection} />
      </Section>
      <Section title={m.beforeWrites}>
        <WritePolicy connection={connection} />
      </Section>
      <Footer connection={connection} />
    </>
  );
}

// 要你处理的事：重新授权、授权快到期；或者暂时连不上（daemon 自己会重试）。
function ProblemBanner({ connection }: { connection: ConnectionDto }) {
  const locale = useLocale();
  const m = useMessages(connectionsMessages);
  const [open, setOpen] = useState(false);
  // 重新授权完成后它不再要你处理；这一条留到你点「完成」。
  if (connectionNeedsUser(connection) || open) {
    return (
      <Card testID="connection-detail-problem" tone="warning" rounded="xl" px="banner-x" py="banner-y" gap="card-row">
        {connectionNeedsUser(connection) ? <Text size="body" weight="semibold">{attentionMessage(connection, locale)}</Text> : null}
        {open ? <ConnectFlowPanel target={connection} onClose={() => setOpen(false)} /> : (
          <Row><Button testID="connection-detail-reauth" label={m.reauthorize} variant="outline" tone="neutral" size="sm" onPress={() => setOpen(true)} /></Row>
        )}
      </Card>
    );
  }
  if (connection.state === 'degraded') {
    return (
      <Card testID="connection-detail-problem" tone="warning" rounded="xl" px="banner-x" py="banner-y">
        <Text size="body">{retryLabel(connection.problem, locale)}</Text>
      </Card>
    );
  }
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Column gap="group-label">
      <Text size="eyebrow" weight="bold" tone="secondary">{title}</Text>
      {children}
    </Column>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Row items="baseline" gap="inline-item">
      <Text w={72} shrink={0} size="label" tone="secondary">{label}</Text>
      <Text flex={1} minW={0} size="meta" weight="semibold">{value}</Text>
    </Row>
  );
}

// 工具数，以及「查看全部」：从 daemon 读这个连接的工具，标出只读和会写入。
function ToolList({ connection }: { connection: ConnectionDto }) {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = useMessages(connectionsMessages);
  const [open, setOpen] = useState(false);
  const [tools, setTools] = useState<ConnectionToolDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!connection.tools) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next || tools) return;
    setError(null);
    runtime.connectionTools(connection.key).then(setTools, (reason: unknown) => setError(connectionErrorText(reason, locale)));
  };
  return (
    <Column gap="card-row">
      <Row items="center" gap="inline-item">
        <Text flex={1} size="meta" tone="secondary">{toolCountLabel(connection.tools, locale)}</Text>
        <Pressable testID="connection-tools-toggle" onPress={toggle} aria-label={open ? m.collapseTools : m.showAllTools}>
          {/* spacing-exempt: 链接字号 */}
          <Text size="12.5" weight="bold" tone="accent">{open ? m.collapse : m.showAll}</Text>
        </Pressable>
      </Row>
      {open ? (
        <Column testID="connection-tools" gap="stacked-card">
          {error ? <Text size="note" tone="danger-dark">{error}</Text> : null}
          {!tools && !error ? <Text size="body" tone="muted">{m.loadingTools}</Text> : null}
          {tools?.map((tool) => (
            <Row key={tool.name} items="flex-start" gap="inline-item">
              <Column flex={1} minW={0} gap="text-stack">
                <Text size="code" mono weight="semibold" numberOfLines={1}>{tool.name}</Text>
                {(tool.description ?? tool.title) ? (
                  <Text size="secondary" tone="secondary" numberOfLines={2}>{tool.description ?? tool.title}</Text>
                ) : null}
              </Column>
              <Badge label={tool.readOnly ? m.readOnly : m.writes} tone={tool.readOnly ? 'neutral' : 'warning'} size="sm" />
            </Row>
          ))}
        </Column>
      ) : null}
    </Column>
  );
}

function RoleSwitches({ connection }: { connection: ConnectionDto }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (role: ConnectionRole, on: boolean) => {
    setSaving(true);
    setError(null);
    runtime.updateConnectionSettings(connection.key, { roles: toggleRole(connection.roles, role, on) })
      .catch((reason: unknown) => setError(connectionErrorText(reason, locale)))
      .finally(() => setSaving(false));
  };
  return (
    <Column gap="card-row">
      {connectionRoles(leadName, locale).map((item) => (
        <Row key={item.role} items="center" gap="inline-item">
          <Text flex={1} minW={0} size="label">{item.label}</Text>
          <Switch
            testID={`connection-role-${item.role}`}
            value={connection.roles.includes(item.role)}
            disabled={saving}
            onValueChange={(on) => change(item.role, on)}
          />
        </Row>
      ))}
      {error ? <Text size="note" tone="danger-dark">{error}</Text> : null}
    </Column>
  );
}

function WritePolicy({ connection }: { connection: ConnectionDto }) {
  const runtime = useCompanionRuntime();
  const locale = useLocale();
  const m = useMessages(connectionsMessages);
  const options = WRITE_POLICY_ORDER.map((value) => ({ value, label: m.writePolicy[value] }));
  const [error, setError] = useState<string | null>(null);
  const change = (writePolicy: ConnectionWritePolicy) => {
    if (writePolicy === connection.writePolicy) return;
    setError(null);
    runtime.updateConnectionSettings(connection.key, { writePolicy }).catch((reason: unknown) => setError(connectionErrorText(reason, locale)));
  };
  return (
    <Column gap="field">
      <SegmentedControl
        options={options}
        value={connection.writePolicy}
        onChange={change}
        optionTestID={(value) => `connection-write-${value}`}
      />
      <Text size="note" tone="secondary">{m.writePolicyHelp}</Text>
      {error ? <Text size="note" tone="danger-dark">{error}</Text> : null}
    </Column>
  );
}

// 测试连接（结果写在按钮下面）和断开连接（在这里再确认一次，不弹系统对话框）。
function Footer({ connection }: { connection: ConnectionDto }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = useMessages(connectionsMessages);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const test = () => {
    setTesting(true);
    setResult(null);
    runtime.testConnection(connection.key)
      .then((response) => setResult({ ok: response.ok, message: response.message }))
      .catch((reason: unknown) => setResult({ ok: false, message: connectionErrorText(reason, locale) }))
      .finally(() => setTesting(false));
  };
  const disconnect = () => {
    setDisconnecting(true);
    setError(null);
    runtime.disconnectConnection(connection.key)
      .then(() => setConfirming(false))
      .catch((reason: unknown) => setError(connectionErrorText(reason, locale)))
      .finally(() => setDisconnecting(false));
  };

  return (
    <Column gap="card-row" pt="text-stack">
      <Row items="center" gap="actions">
        <Button testID="connection-test" label={testing ? m.testing : m.test} variant="outline" tone="neutral" size="sm" disabled={testing} onPress={test} />
        <Box flex={1} />
        {!confirming ? (
          <Button testID="connection-disconnect" label={m.disconnect} variant="outline" tone="danger" size="sm" onPress={() => setConfirming(true)} />
        ) : null}
      </Row>
      {result ? (
        <Row testID="connection-test-result" items="center" gap="icon-label">
          <Icon name={result.ok ? 'check' : 'error-outline'} size={14} color={result.ok ? 'success-dark' : 'danger-dark'} />
          <Text flex={1} size="note" tone={result.ok ? 'success-dark' : 'danger-dark'}>{result.message}</Text>
        </Row>
      ) : null}
      {confirming ? (
        <Column testID="connection-disconnect-confirm" px="inset-x" py="inset-y" gap="card-row" rounded="lg" bg="danger-surface">
          <Text size="body">{m.disconnectWarning(leadName)}</Text>
          {error ? <Text size="note" weight="semibold" tone="danger-dark">{error}</Text> : null}
          <Row gap="actions">
            <Button
              testID="connection-disconnect-confirm-button"
              label={disconnecting ? m.disconnecting : m.disconnectConfirm}
              tone="danger"
              size="sm"
              disabled={disconnecting}
              onPress={disconnect}
            />
            <Button label={m.cancel} variant="ghost" tone="neutral" size="sm" disabled={disconnecting} onPress={() => setConfirming(false)} />
          </Row>
        </Column>
      ) : null}
    </Column>
  );
}
