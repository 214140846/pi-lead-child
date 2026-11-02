import { Badge, Card, Column, Row, Switch, Text } from '@pi-lead-child/components';
import type { Locale, RuntimeSettingEntry, RuntimeSettingsDto } from '@pi-lead-child/protocol';
import { useState } from 'react';

import { useLocale } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useLeadName, useRuntimeSettings } from '@/state/hooks';

import { memoryErrorText } from './memoryModel';
import { runtimesMessages } from './runtimes.messages';

// leadName 是 Lead 的名字（useLeadName）。
export function runtimesDescription(leadName: string, locale: Locale): string {
  return runtimesMessages(locale).description(leadName);
}

// 设置 → 执行 → 执行器（2026-10-19）。每个 runtime 一个开关。
// 停用以前只能对 Lead 说「不用 codex」，那句话只进了 Lead 的笔记，系统不读笔记。现在开关存在 config.json，马上生效。
export function RuntimesSection() {
  const { runtimeSettings, resource } = useRuntimeSettings();
  const locale = useLocale();
  const m = runtimesMessages(locale);
  if (!runtimeSettings) {
    return (
      <Text testID="runtimes-loading" size="body" tone={resource?.state === 'error' ? 'danger-dark' : 'muted'}>
        {resource?.state === 'error'
          ? m.loadFailed(resource.error ? memoryErrorText(resource.error, locale) : m.notStarted)
          : m.loading}
      </Text>
    );
  }
  return (
    <Column testID="runtimes-section" gap="page-section">
      <RuntimeSwitches settings={runtimeSettings} />
      <ReviewerNote settings={runtimeSettings} />
    </Column>
  );
}

function RuntimeSwitches({ settings }: { settings: RuntimeSettingsDto }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = runtimesMessages(locale);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const change = (entry: RuntimeSettingEntry, enabled: boolean) => {
    setSaving(entry.id);
    setError(null);
    runtime.updateRuntimeSettings({ runtime: entry.id, enabled })
      .catch((reason: unknown) => setError(memoryErrorText(reason, locale)))
      .finally(() => setSaving(null));
  };
  return (
    <Card rounded="xl" p="page-card">
      <Column gap="card-row">
        {settings.runtimes.map((entry) => (
          <Row key={entry.id} testID={`runtime-row-${entry.id}`} items="center" gap="side-item">
            <Column flex={1} minW={0} gap="text-stack">
              <Row items="center" gap="inline-item">
                <Text size="card-title" weight="semibold">{entry.label}</Text>
                {entry.canReview ? <Badge label={m.canReview} tone="neutral" size="sm" /> : null}
                {!entry.installed ? <Badge label={m.notInstalled} tone="warning" size="sm" /> : null}
              </Row>
              <Text size="secondary" tone="secondary">
                {entry.enabled ? m.enabled : m.disabled(leadName)}
              </Text>
            </Column>
            <Switch
              testID={`runtime-switch-${entry.id}`}
              value={entry.enabled}
              disabled={saving !== null}
              onValueChange={(on) => change(entry, on)}
            />
          </Row>
        ))}
        {error ? <Text size="secondary" tone="danger-dark">{error}</Text> : null}
      </Column>
    </Card>
  );
}

// 自动核查用哪个执行器（2026-10-20 起任何执行器都能当核查员，能跑命令的优先）。它不能用时，派发时自动换下一个能用的。
// 只有所有执行器都停用时才派不出去，那时委托验收闭不了环。runtimes 里的 canReview 指这个执行器核查时能不能运行命令。
function ReviewerNote({ settings }: { settings: RuntimeSettingsDto }) {
  const leadName = useLeadName();
  const m = runtimesMessages(useLocale());
  const reviewer = settings.runtimes.find((entry) => entry.id === settings.reviewer.id);
  const name = reviewer?.label ?? settings.reviewer.id;
  const text = !settings.reviewer.canReview
    ? m.noReviewer(leadName)
    : reviewer?.canReview === false
      ? m.readOnlyReviewer(name)
      : m.reviewer(name);
  return (
    <Column gap="group-label">
      <Text size="eyebrow" weight="bold" tone="secondary">{m.reviewTitle}</Text>
      <Card rounded="xl" p="page-card">
        <Text testID="runtimes-reviewer" size="secondary" tone={settings.reviewer.canReview ? 'secondary' : 'danger-dark'}>
          {text}
        </Text>
      </Card>
    </Column>
  );
}
