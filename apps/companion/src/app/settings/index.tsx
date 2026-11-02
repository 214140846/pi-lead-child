import { useBreakpoint } from '@pi-lead-child/components';

import { LeadIdentitySettings } from '@/features/settings/LeadIdentitySettings';
import { leadProfileDescription } from '@/features/settings/leadProfileModel';
import { SettingsHome } from '@/features/settings/SettingsHome';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useLocale, useMessages } from '@/i18n';
import { memoryNeedsUser } from '@/features/settings/memoryModel';
import { useConnections, useLeadName, useMemorySettings } from '@/state/hooks';

// /settings。手机上是分组列表（最上面是健康条，「连接」一行带要你处理的个数）；桌面上停在第一个条目「身份与风格」。
export default function SettingsIndexRoute() {
  const m = useMessages(settingsMessages);
  const { desktop } = useBreakpoint();
  const { connections } = useConnections();
  const { memory } = useMemorySettings();
  const name = useLeadName();
  const locale = useLocale();
  if (!desktop) {
    return (
      <SettingsHome
        badges={{ connections: connections?.attention ?? 0, memory: memoryNeedsUser(memory) ? 1 : 0 }}
        connections={connections?.items}
        memory={memory}
      />
    );
  }
  return (
    <SettingsPage title={m.items.profile} description={leadProfileDescription(name, locale)}>
      <LeadIdentitySettings />
    </SettingsPage>
  );
}
