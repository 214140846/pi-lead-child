import { Button, Column, Row, Text } from '@pi-lead-child/components';
import type { MemorySwitch } from '@pi-lead-child/protocol';
import { useCallback, useEffect, useState } from 'react';

import { useMessages } from '@/i18n';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useLeadName } from '@/state/hooks';

import { genuiMessages } from './genui.messages';

type MemoryText = ReturnType<typeof genuiMessages>['memory'];

// 会话里的记忆切换确认（Lead 收到要确认的 memory_switch 后发）。卡片只带切换号，状态从
// /v1/memory/switches/:id 实时读取：已经在设置页或者别的设备上处理过的切换，旧卡片也不会显示过期的按钮。

// 结果和「不切换会怎样」按 parts 写：只有 embedding 的切换才重建索引；不切换时 daemon 把等确认的 reranker 设成「不用」。
function settledLabel(value: MemorySwitch, m: MemoryText): { label: string; tone: 'success-dark' | 'secondary' } | null {
  const embedding = value.parts.includes('embedding');
  const reranker = value.parts.includes('reranker');
  switch (value.state) {
    case 'applied':
      return { label: embedding ? m.appliedEmbedding : m.appliedReranker, tone: 'success-dark' };
    case 'rejected':
      return { label: m.rejected(rejectedEffect(embedding, reranker, m)), tone: 'secondary' };
    case 'superseded':
      return { label: m.superseded, tone: 'secondary' };
    default:
      return null;
  }
}

function rejectedEffect(embedding: boolean, reranker: boolean, m: MemoryText): string {
  if (embedding && reranker) return m.effectBoth;
  return reranker ? m.effectReranker : m.effectNone;
}

function errorStatus(reason: unknown): number | undefined {
  return typeof reason === 'object' && reason !== null ? (reason as { status?: number }).status : undefined;
}

function errorText(reason: unknown, m: MemoryText): string {
  const message = reason instanceof Error ? reason.message : '';
  return message || m.requestFailed;
}

export function MemorySwitchConfirmCard({ switch: id }: { switch: string }) {
  const runtime = useCompanionRuntime();
  const leadName = useLeadName();
  const m = useMessages(genuiMessages).memory;
  const [value, setValue] = useState<MemorySwitch | null>(null);
  // daemon 只记最近的一个切换：更早的卡片读到 404。
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback((signal?: AbortSignal) => runtime.memorySwitch(id, signal).then(
    (next) => { if (!signal?.aborted) setValue(next); },
    (reason: unknown) => {
      if (signal?.aborted) return;
      if (errorStatus(reason) === 404) setGone(true);
      else setError(errorText(reason, m));
    },
  ), [id, m, runtime]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const decide = (approve: boolean) => {
    setSubmitting(true);
    setError(null);
    runtime.confirmMemorySwitch(id, approve)
      .then((response) => setValue(response.switch), (reason: unknown) => {
        setError(errorText(reason, m));
        // 已经处理过（409）或者作废：重新读一次，显示它现在的状态。
        void load();
      })
      .finally(() => setSubmitting(false));
  };

  if (gone) return <Text testID={`surface-memory-switch-${id}`} size="secondary" tone="secondary">{m.gone}</Text>;
  if (!value) {
    return error ? <Text size="secondary" tone="danger-dark">{error}</Text> : <Text size="13" tone="secondary">{m.loading}</Text>; // spacing-exempt: 提示文字字号
  }
  const settled = settledLabel(value, m);
  return (
    <Column testID={`surface-memory-switch-${value.id}`} gap="card-row">
      <Text size="card-title" weight="bold">{m.title}</Text>
      <Text size="body">{value.summary}</Text>
      <Text size="secondary" tone="secondary">{value.reason}</Text>
      {value.state === 'pending' ? (
        <Column gap="card-row">
          <Text testID="surface-memory-switch-hint" size="note" tone="secondary">
            {m.hint(rejectedEffect(value.parts.includes('embedding'), value.parts.includes('reranker'), m), leadName)}
          </Text>
          <Row gap="actions">
            <Button testID="surface-memory-switch-approve" label={m.approve} disabled={submitting} onPress={() => decide(true)} />
            <Button testID="surface-memory-switch-reject" label={m.reject} variant="outline" tone="neutral" disabled={submitting} onPress={() => decide(false)} />
          </Row>
        </Column>
      ) : null}
      {settled ? <Text testID="surface-memory-switch-result" size="label" weight="bold" tone={settled.tone}>{settled.label}</Text> : null}
      {error && value.state === 'pending' ? <Text size="note" tone="danger-dark">{error}</Text> : null}
    </Column>
  );
}
