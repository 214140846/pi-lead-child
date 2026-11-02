import { AppearanceSection } from '@/features/settings/AppearanceSection';
import { appearanceMessages } from '@/features/settings/appearance.messages';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useMessages } from '@/i18n';

export default function AppearanceRoute() {
  const m = useMessages(settingsMessages);
  const appearance = useMessages(appearanceMessages);
  return (
    <SettingsPage title={m.items.appearance} description={appearance.description}>
      <AppearanceSection />
    </SettingsPage>
  );
}
