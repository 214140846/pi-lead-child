import { CollectionScreen } from '@/components/CollectionScreen';
import { ProjectList } from '@/features/workspace/ProjectList';
import { useMessages } from '@/i18n';
import { navigationMessages } from '@/navigation/navigation.messages';
import { useCompanionRuntime } from '@/state/CompanionStateProvider';
import { useConnectionPhase, useProjectOverviews } from '@/state/hooks';

export default function ProjectsScreen() {
  const runtime = useCompanionRuntime();
  const phase = useConnectionPhase();
  const overviews = useProjectOverviews();
  const m = useMessages(navigationMessages);
  return (
    <CollectionScreen title={m.projects} subtitle={m.projectsSubtitle}>
      <ProjectList
        overviews={phase === 'ready' ? overviews : null}
        onSetArchived={(projectId, archived) => runtime.setProjectArchived(projectId, archived)}
      />
    </CollectionScreen>
  );
}
