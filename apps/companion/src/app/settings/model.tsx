import { modelDescription } from '@/features/settings/memoryModel';
import { ModelSection } from '@/features/settings/ModelSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function ModelRoute() {
  const m = useMessages(settingsMessages);
  const leadName = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage title={m.items.model} description={modelDescription(leadName, locale)}>
      <ModelSection />
    </SettingsPage>
  );
}
