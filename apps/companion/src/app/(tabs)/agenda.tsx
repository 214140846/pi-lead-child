import { useRouter } from 'expo-router';

import { CollectionScreen } from '@/components/CollectionScreen';
import { AgendaTimeline } from '@/features/workspace/AgendaTimeline';
import { useMessages } from '@/i18n';
import { navigationMessages } from '@/navigation/navigation.messages';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useConnectionPhase, useTimeline } from '@/state/hooks';

export default function AgendaScreen() {
  const router = useRouter();
  const runtime = useCompanionRuntime();
  const phase = useConnectionPhase();
  const timeline = useTimeline();
  const m = useMessages(navigationMessages);
  return (
    <CollectionScreen title={m.agenda} subtitle={m.agendaSubtitle}>
      <AgendaTimeline
        timeline={phase === 'ready' ? timeline : null}
        onOpenTicket={(ticketId) => router.push(`/ticket/${ticketId}`)}
        onUpdateMilestone={(milestoneId, patch) => runtime.updateMilestone(milestoneId, patch)}
      />
    </CollectionScreen>
  );
}
