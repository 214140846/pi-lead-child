import { Button, Card, Dot, Row, Text } from '@pi-lead-child/components';
import { useRouter, type Href } from 'expo-router';

import { useMessages } from '@/i18n';
import { useLeadName } from '@/state/hooks';

import { devicesMessages } from './devices.messages';

// 设备分组里还没配对时的提示。配对表单只有配对页一份，这里只给入口。
export function UnpairedNotice() {
  const router = useRouter();
  const leadName = useLeadName();
  const m = useMessages(devicesMessages);
  return (
    <Card testID="settings-unpaired" p="page-card" rounded="2xl" gap="card-row">
      <Row items="center" gap="icon-label">
        <Dot color="text-muted" size={9} />
        <Text size="card-title" weight="extrabold">{m.unpairedTitle}</Text>
      </Row>
      <Text size="secondary" tone="secondary">{m.unpairedBody(leadName)}</Text>
      <Row>
        <Button testID="settings-pair" label={m.pair(leadName)} size="lg" onPress={() => router.push('/pair' as Href)} />
      </Row>
    </Card>
  );
}
