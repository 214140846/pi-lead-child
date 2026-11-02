import { memoryDescription } from '@/features/settings/memoryModel';
import { MemorySection } from '@/features/settings/MemorySection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function MemoryRoute() {
  const m = useMessages(settingsMessages);
  const leadName = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage title={m.items.memory} description={memoryDescription(leadName, locale)}>
      <MemorySection />
    </SettingsPage>
  );
}
