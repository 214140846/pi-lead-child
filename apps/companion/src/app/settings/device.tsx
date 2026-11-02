import { DeviceSection } from '@/features/settings/DeviceSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function DeviceRoute() {
  const m = useMessages(settingsMessages);
  const leadName = useLeadName();
  return (
    <SettingsPage title={m.items.device} description={m.deviceDescription(leadName)}>
      <DeviceSection />
    </SettingsPage>
  );
}
