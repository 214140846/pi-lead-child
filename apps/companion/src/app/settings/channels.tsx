import { channelsDescription, ChannelSettingsSection } from '@/features/settings/ChannelSettingsSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function ChannelsRoute() {
  const m = useMessages(settingsMessages);
  const leadName = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage title={m.items.channels} description={channelsDescription(leadName, locale)}>
      <ChannelSettingsSection />
    </SettingsPage>
  );
}
