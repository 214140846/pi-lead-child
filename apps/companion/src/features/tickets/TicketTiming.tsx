import { Column, Row, Text } from '@pi-lead-child/components';

import { formatCompactElapsed } from '@/features/workspace/model';
import { useMessages } from '@/i18n';

import { ticketRecordsMessages } from './ticketRecords.messages';

// 工单耗时。compact 时标签和数值在同一行。
export function TicketTiming({ elapsedMs, compact = false }: { elapsedMs: number | null | undefined; compact?: boolean }) {
  const m = useMessages(ticketRecordsMessages).timing;
  const value = formatCompactElapsed(elapsedMs) ?? m.notStarted;
  const Layout = compact ? Row : Column;
  return (
    <Layout aria-label={m.aria(value)} minW={compact ? 0 : 92} items={compact ? 'center' : undefined} gap={compact ? 6 : 3}>
      <Text size="label" weight="bold" tone="muted">{m.label}</Text>
      <Text size={compact ? '11.5' : '12.5'} mono weight="bold" tone={compact ? 'secondary' : 'default'}>{value}</Text>
    </Layout>
  );
}
