import { DevicesSection } from '@/features/settings/DevicesSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useMessages } from '@/i18n';

export default function DevicesRoute() {
  const m = useMessages(settingsMessages);
  return (
    <SettingsPage title={m.items.devices} description={m.devicesDescription}>
      <DevicesSection />
    </SettingsPage>
  );
}
