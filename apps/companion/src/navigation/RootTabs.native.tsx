import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { ticketsNeedingUser } from '@pi-lead-child/protocol';

import { FirstRunGate } from '@/features/onboarding/FirstRunGate';
import { useMessages } from '@/i18n';
import { useTickets } from '@/state/hooks';

import { navigationMessages } from './navigation.messages';

export default function RootTabs() {
  const tickets = useTickets();
  const m = useMessages(navigationMessages);
  // 和收件箱、会话底栏同一条规则（protocol 的 ticketNeedsUser）。
  const todoCount = ticketsNeedingUser(tickets).length;
  return (
    <FirstRunGate>
      <NativeTabs
        tintColor="#2F6BFF"
        iconColor={{ default: '#98A2B3', selected: '#2F6BFF' }}
        backgroundColor="#FFFFFF"
        badgeBackgroundColor="#D92D20"
        badgeTextColor="#FFFFFF"
        backBehavior="history"
        labelVisibilityMode="labeled"
        minimizeBehavior="never"
        disableTransparentOnScrollEdge
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
          <NativeTabs.Trigger.Label>{m.conversation}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="tickets">
          <NativeTabs.Trigger.Icon sf={{ default: 'rectangle.stack', selected: 'rectangle.stack.fill' }} md="view_agenda" />
          <NativeTabs.Trigger.Label>{m.tickets}</NativeTabs.Trigger.Label>
          {todoCount > 0 && <NativeTabs.Trigger.Badge>{String(Math.min(todoCount, 99))}</NativeTabs.Trigger.Badge>}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="projects">
          <NativeTabs.Trigger.Icon sf={{ default: 'folder', selected: 'folder.fill' }} md="folder" />
          <NativeTabs.Trigger.Label>{m.projects}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="agenda">
          <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar.circle.fill' }} md="calendar_month" />
          <NativeTabs.Trigger.Label>{m.agenda}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </FirstRunGate>
  );
}
