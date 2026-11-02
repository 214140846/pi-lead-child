import { useBreakpoint } from '@pi-lead-child/components';
import { useLocalSearchParams } from 'expo-router';

import { connectionsDescription } from '@/features/settings/connectionModel';
import { ConnectionsSection } from '@/features/settings/ConnectionsSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

// 一个连接（id 是连接的 key）。桌面上列表留着，详情在右边的抽屉里；手机上是详情页，返回到连接列表。
export default function ConnectionRoute() {
  const m = useMessages(settingsMessages);
  const { desktop } = useBreakpoint();
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadName = useLeadName();
  const locale = useLocale();
  return (
    <SettingsPage
      title={desktop ? m.items.connections : undefined}
      description={desktop ? connectionsDescription(leadName, locale) : undefined}
      back={{ label: m.items.connections, href: '/settings/connections' }}
    >
      <ConnectionsSection connectionId={id ?? null} />
    </SettingsPage>
  );
}
