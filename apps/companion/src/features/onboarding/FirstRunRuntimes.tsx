import { Badge, Button, Card, Column, LeadAvatar, Link, Pressable, Row, Screen, ScrollArea, Switch, Text } from '@pi-lead-child/components';
import { useEffect, useState } from 'react';

import { useLeadAvatarSource } from '@/components/useLeadAvatarSource';
import { useLocale, useMessages } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useLeadName, useRuntimeSettings } from '@/state/hooks';
import { RESOURCE_KEYS } from '@/state/types';
import { memoryErrorText } from '@/features/settings/memoryModel';

import { onboardingMessages } from './onboarding.messages';
import { firstRunRuntimeRequests, firstRunRuntimeRows, type FirstRunRuntimePicks, type FirstRunRuntimeStatus } from './firstRunModel';

// 首次启动引导的第二步：选执行器（docs/desktop/macos-desktop-design.md 第 5.3 节，P0-6）。第一步接好大脑以后出现一次。
//   - 列出设置 → 执行器的同一份数据（GET /v1/runtimes/settings）：已安装的缺省开着，没找到的给安装说明和「重新检测」，
//     pi 是内置的，总是可以选。「重新检测」重新取这份设置：daemon 每次都重新找可执行文件。
//   - 「保存并继续」只拨和现在不同的开关，走设置页同一个操作（updateRuntimeSettings → 操作层 runtime 的 disable、enable）。
//   - 「跳过」不改任何设置。daemon 太旧、没有这条路由时这一步直接结束，不挡住 App。

const STATUS_TONE: Record<FirstRunRuntimeStatus, 'success' | 'warning' | 'neutral'> = {
  installed: 'success',
  not_found: 'warning',
  built_in: 'neutral',
};

export function FirstRunRuntimes({ onDone }: { onDone: () => void }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const locale = useLocale();
  const m = useMessages(onboardingMessages);
  const avatar = useLeadAvatarSource({ state: 'idle', tone: 'quiet' });
  const { runtimeSettings, resource } = useRuntimeSettings();
  const [picks, setPicks] = useState<FirstRunRuntimePicks>({});
  const [busy, setBusy] = useState<'saving' | 'checking' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const unsupported = resource?.state === 'unsupported';
  useEffect(() => {
    if (unsupported) onDone();
  }, [unsupported, onDone]);

  const rows = firstRunRuntimeRows(runtimeSettings, picks);
  const loaded = rows.length > 0;
  const missing = rows.some((row) => row.status === 'not_found');
  const statusLabel: Record<FirstRunRuntimeStatus, string> = {
    installed: m.runtimeInstalled,
    not_found: m.runtimeNotFound,
    built_in: m.runtimeBuiltIn,
  };

  const recheck = () => {
    setBusy('checking');
    setProblem(null);
    runtime.ensureResource(RESOURCE_KEYS.runtimeSettings, true)
      .catch((reason: unknown) => setProblem(memoryErrorText(reason, locale)))
      .finally(() => setBusy(null));
  };
  const save = async () => {
    setBusy('saving');
    setProblem(null);
    try {
      for (const request of firstRunRuntimeRequests(runtimeSettings, picks)) await runtime.updateRuntimeSettings(request);
    } catch (reason) {
      setProblem(memoryErrorText(reason, locale));
      setBusy(null);
      return;
    }
    onDone();
  };

  return (
    <Screen testID="first-run-runtimes" edges={['top', 'bottom']} bg="surface-subtle">
      <ScrollArea>
        <Column w="100%" items="center" px="page-x" py="page-section">
          <Column w="100%" maxW="prose" gap="page-section">
            <Column gap="card-row">
              <Row items="center" gap="icon-label">
                <LeadAvatar source={avatar} size={32} tone="quiet" name={leadName} />
                <Text size="label" weight="semibold" tone="secondary">{leadName}</Text>
              </Row>
              <Text testID="first-run-runtimes-title" size="page-title" weight="bold">{m.runtimesTitle(leadName)}</Text>
              <Text size="body" tone="secondary">{m.runtimesIntro(leadName)}</Text>
            </Column>

            <Card testID="first-run-runtimes-list" w="100%" rounded="xl" p="page-card" gap="card-section" aria-label={m.runtimesList}>
              {loaded ? (
                <Column gap="card-row">
                  {rows.map((row) => (
                    <Row key={row.id} testID={`first-run-runtime-${row.id}`} items="center" gap="side-item">
                      <Column flex={1} minW={0} gap="text-stack">
                        <Row items="center" gap="inline-item">
                          <Text size="card-title" weight="semibold">{row.label}</Text>
                          <Badge label={statusLabel[row.status]} tone={STATUS_TONE[row.status]} size="sm" />
                        </Row>
                        {row.status === 'built_in' ? <Text size="secondary" tone="secondary">{m.runtimeBuiltInNote}</Text> : null}
                        {row.status === 'not_found' ? (
                          <Row items="center" gap="inline-item" flexWrap="wrap">
                            <Text size="secondary" tone="secondary">{m.runtimeNotFoundNote}</Text>
                            {row.installUrl ? (
                              <Link testID={`first-run-runtime-install-${row.id}`} href={row.installUrl} size="secondary">
                                {m.runtimeInstall(row.label)}
                              </Link>
                            ) : null}
                          </Row>
                        ) : null}
                      </Column>
                      <Switch
                        testID={`first-run-runtime-switch-${row.id}`}
                        label={row.label}
                        value={row.checked}
                        disabled={busy !== null}
                        onValueChange={(on) => setPicks((current) => ({ ...current, [row.id]: on }))}
                      />
                    </Row>
                  ))}
                </Column>
              ) : (
                <Text testID="first-run-runtimes-loading" size="body" tone={resource?.state === 'error' ? 'danger-dark' : 'muted'}>
                  {resource?.state === 'error' && resource.error ? m.runtimesLoadFailed(memoryErrorText(resource.error, locale)) : m.runtimesLoading}
                </Text>
              )}
              {problem ? <Text testID="first-run-runtimes-problem" size="note" color="danger-dark">{problem}</Text> : null}
              <Row items="center" justify="flex-end" gap="actions">
                {missing ? (
                  <Button testID="first-run-runtimes-recheck" label={busy === 'checking' ? m.rechecking : m.recheck} size="sm" variant="outline"
                    tone="neutral" disabled={busy !== null} onPress={recheck} />
                ) : null}
                <Button testID="first-run-runtimes-save" label={busy === 'saving' ? m.runtimesSaving : m.runtimesSave} size="sm" tone="accent"
                  disabled={busy !== null || !loaded} onPress={() => void save()} />
              </Row>
            </Card>

            <Row justify="center" gap="icon-label">
              <Pressable testID="first-run-runtimes-skip" aria-label={m.runtimesSkip} disabled={busy !== null} onPress={onDone}>
                <Text size="note" weight="semibold" color="accent-strong">{m.runtimesSkip}</Text>
              </Pressable>
              <Text size="note" tone="secondary">{m.runtimesSkipNote}</Text>
            </Row>
          </Column>
        </Column>
      </ScrollArea>
    </Screen>
  );
}
