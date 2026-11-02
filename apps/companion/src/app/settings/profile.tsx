import { LeadIdentitySettings } from '@/features/settings/LeadIdentitySettings';
import { leadProfileDescription } from '@/features/settings/leadProfileModel';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function LeadProfileRoute() {
  const m = useMessages(settingsMessages);
  const name = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage title={m.items.profile} description={leadProfileDescription(name, locale)}>
      <LeadIdentitySettings />
    </SettingsPage>
  );
}
