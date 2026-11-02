import {
  Avatar, Box, Button, Card, Column, EmptyState, ListItem, Row, Skeleton, Text, type IconName,
} from '@pi-lead-child/components';

import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';
import type { InterventionCommandState } from '@/state/types';

import { timeLabel } from './timeLabels';
import {
  buildCheckpointFeedPresentation,
  type CheckpointFeedResource,
  type CheckpointRunFacts,
  type CheckpointPresentationInput,
  type InterventionActionId,
  type InterventionAuthority,
  type TicketStatus,
} from '@/features/workspace/model';

import { InterventionPanel } from './InterventionPanel';
import { ticketRecordsMessages } from './ticketRecords.messages';

type CheckpointFeedProps = {
  checkpoints: CheckpointPresentationInput[];
  interventions?: Record<string, InterventionAuthority>;
  interventionCommandStates?: Record<string, InterventionCommandState>;
  resource?: CheckpointFeedResource & { pagination?: CheckpointFeedPagination };
  onResolveIntervention?: (interventionId: string, actionId: InterventionActionId, customResponse?: string) => void;
  onOpenTicket?: (ticketId: string) => void;
  onRetry?: () => void;
  /** 工单当前的 stage：用来区分"现在需要介入"和"当时阻塞过"。 */
  ticketStatus?: TicketStatus;
  /** 正在等待验收的那次交付；只有它的提交记录才算"等待验收"。 */
  deliveryRunId?: number | null;
  /** 每次 Run 的用途和它有没有让工单阻塞：没让工单阻塞的失败不写「当时阻塞」。 */
  runs?: CheckpointRunFacts;
};

export type CheckpointFeedPagination = {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadOlder?: () => void;
};

export function CheckpointFeed({
  checkpoints,
  interventions = {},
  interventionCommandStates = {},
  resource = { state: 'ready' },
  onResolveIntervention,
  onOpenTicket,
  onRetry,
  ticketStatus,
  deliveryRunId,
  runs,
}: CheckpointFeedProps) {
  const leadName = useLeadName();
  const locale = useLocale();
  const messages = useMessages(ticketRecordsMessages);
  const m = messages.feed;
  const feed = buildCheckpointFeedPresentation(checkpoints, interventions, resource, { ticketStatus, deliveryRunId, runs, locale });
  const pagination = resource.pagination;

  if (feed.state === 'loading') {
    return (
      <Card aria-label={m.loading} gap="card-row" p="card" borderColor="border-soft" rounded="2xl">
        <Skeleton w="72%" h={12} rounded="full" />
        <Skeleton w="44%" h={10} rounded="full" />
      </Card>
    );
  }
  if (feed.state === 'empty') return <FeedEmpty icon="inbox" title={m.emptyTitle} body={m.emptyBody} />;
  if (feed.state === 'disconnected') return <FeedEmpty icon="offline" title={m.disconnectedTitle} body={m.disconnectedBody(leadName)} />;
  if (feed.state === 'error') return <FeedEmpty icon="error-outline" title={m.errorTitle} body={feed.pageError ?? m.errorBody} actionLabel={messages.retry} onAction={onRetry} />;

  return (
    <Column>
      {resource.state === 'disconnected' ? (
        <Text px="section-label-x" size="secondary" weight="bold" tone="warning-dark">{m.cached}</Text>
      ) : null}
      {pagination && (pagination.hasMore || pagination.loading || pagination.error) ? (
        <Column items="center" gap="card-row" py="banner-y">
          {pagination.error ? (
            <Text role="alert" size="secondary" tone="danger-dark" align="center">{m.olderFailed(pagination.error)}</Text>
          ) : null}
          <Button
            accessibilityLabel={pagination.loading ? m.loadingOlder : m.loadOlder}
            disabled={pagination.loading || !pagination.onLoadOlder}
            label={pagination.loading ? m.loadingOlderNow : pagination.error ? m.retryOlder : m.loadOlder}
            onPress={pagination.onLoadOlder}
            testID="checkpoint-load-older"
            variant="outline"
            tone="neutral"
            shape="pill"
            size="sm"
          />
        </Column>
      ) : null}
      {feed.items.map((checkpoint) => (
        <Column
          key={checkpoint.id}
          pb="stacked-card"
          borderBottomWidth={1}
          borderBottomColor="border-soft"
          {...(checkpoint.kind === 'blocked' && !checkpoint.historical
            ? { pl: 10, borderLeftWidth: 3, borderLeftColor: 'danger' } as const
            : {})}
        >
          <ListItem
            testID={`checkpoint-${checkpoint.id}`}
            title={checkpoint.title}
            subtitle={[checkpoint.sourceLabel, checkpoint.kindLabel, checkpoint.stage].filter(Boolean).join(' · ')}
            subtitleLines={2}
            leading={<Avatar label={checkpoint.source === 'system_derived' ? 'S' : 'π'} size={24} tone="surface" textSize="11" />}
            trailing={<Text size="meta" mono tone="faint">{timeLabel(checkpoint.createdAt, undefined, locale)}</Text>}
          />
          <Text px="row-x" size="body" tone="secondary">{checkpoint.summary}</Text>
          {checkpoint.keyFacts && checkpoint.keyFacts.length > 0 ? (
            <Column gap="card-row" mt="card-row">
              {checkpoint.keyFacts.map((fact, index) => (
                <Row key={`${fact.label}-${index}`} items="baseline" gap="inline-item">
                  <Text size="label" weight="bold" tone="muted">{fact.label}</Text>
                  {/* spacing-exempt: 光学对齐 */}
                  <Text mt={3} size="code" mono weight="bold">{fact.value}</Text>
                </Row>
              ))}
            </Column>
          ) : null}
          {checkpoint.artifactRefs && checkpoint.artifactRefs.length > 0 ? (
            <Row flexWrap="wrap" gap="chips" mt="card-row">
              {checkpoint.artifactRefs.map((artifact) => (
                <Box key={artifact.id} px="pill-x" py="pill-y" rounded="md" bg="accent-soft">
                  {/* spacing-exempt: 徽标字号 */}
                  <Text size="10.5" mono tone="accent">{artifact.label}</Text>
                </Box>
              ))}
            </Row>
          ) : null}
          {checkpoint.relatedTicketIds && checkpoint.relatedTicketIds.length > 0 ? (
            <Row flexWrap="wrap" gap="actions" mt="card-row">
              {checkpoint.relatedTicketIds.map((ticketId) => (
                <Button
                  key={ticketId}
                  accessibilityLabel={m.openRelated(ticketId)}
                  disabled={!onOpenTicket}
                  label={`#${ticketId}`}
                  onPress={() => onOpenTicket?.(ticketId)}
                  testID={`related-ticket-${ticketId}`}
                  variant="outline"
                  tone="neutral"
                  size="xs"
                />
              ))}
            </Row>
          ) : null}
          {checkpoint.nextStep ? (
            <Row mt="card-section" pt="card-section" borderTopWidth={1} borderTopColor="border-soft" items="flex-start" gap="inline-item">
              <Text size="label" weight="bold">{m.nextStep}</Text>
              <Text flex={1} minW={0} size="secondary" tone="secondary">{checkpoint.nextStep}</Text>
            </Row>
          ) : null}
          {checkpoint.intervention ? <InterventionPanel commandState={interventionCommandStates[checkpoint.intervention.id]} intervention={checkpoint.intervention} onResolve={onResolveIntervention} /> : null}
        </Column>
      ))}
      {feed.pageError ? (
        <Row items="center" gap="side-item" px="banner-x" py="banner-y" rounded="lg" bg="warning-soft">
          <Text flex={1} minW={0} size="secondary" tone="warning-dark">{m.olderReadFailed(feed.pageError)}</Text>
          {onRetry ? (
            <Button accessibilityLabel={m.retryOlderLabel} label={messages.retry} onPress={onRetry} testID="checkpoint-page-retry" variant="link" size="xs" />
          ) : null}
        </Row>
      ) : null}
    </Column>
  );
}

function FeedEmpty({ icon, title, body, actionLabel, onAction }: { icon: IconName; title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <Column minH={230} items="center" justify="center">
      <EmptyState
        icon={icon}
        iconColor="text-muted"
        iconBackground="surface-muted"
        title={title}
        body={body}
        action={actionLabel && onAction ? { label: actionLabel, onPress: onAction, testID: 'checkpoint-empty-retry' } : undefined}
      />
    </Column>
  );
}
