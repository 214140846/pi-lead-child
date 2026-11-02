import { connectionsDescription } from '@/features/settings/connectionModel';
import { ConnectionsSection } from '@/features/settings/ConnectionsSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function ConnectionsRoute() {
  const m = useMessages(settingsMessages);
  const leadName = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage title={m.items.connections} description={connectionsDescription(leadName, locale)}>
      <ConnectionsSection connectionId={null} />
    </SettingsPage>
  );
}
