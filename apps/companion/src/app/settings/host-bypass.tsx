import { HostBypassSection } from '@/features/settings/HostBypassSection';
import { settingsMessages } from '@/features/settings/settings.messages';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useMessages } from '@/i18n';

// 设置 → 免沙箱（工单 #246）：「用户本人发话时免沙箱」的开关。
export default function HostBypassRoute() {
  const m = useMessages(settingsMessages);
  return (
    <SettingsPage title={m.items['host-bypass']}>
      <HostBypassSection />
    </SettingsPage>
  );
}
