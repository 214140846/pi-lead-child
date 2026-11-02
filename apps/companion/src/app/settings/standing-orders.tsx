import { standingOrdersDescription } from '@/features/settings/standingOrderModel';
import { StandingOrdersSection } from '@/features/settings/StandingOrdersSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

export default function StandingOrdersRoute() {
  const m = useMessages(settingsMessages);
  const leadName = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage title={m.items['standing-orders']} description={standingOrdersDescription(leadName, locale)}>
      <StandingOrdersSection />
    </SettingsPage>
  );
}
