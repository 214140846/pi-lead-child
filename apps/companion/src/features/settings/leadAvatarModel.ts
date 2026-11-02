// 设置页「形象」卡的文字（主题 11.15）。界面在 LeadAvatarSection.tsx。
import type { LeadAvatarDto, LeadAvatarSlot, Locale, SlackEmojiPreview } from '@pi-lead-child/protocol';

import type { LeadAvatarLook } from '@/components/leadAvatarSource';
import { formatAvatarBytes } from '@/data/avatarImagePicker.types';

import { profileMessages } from './profile.messages';

/** 四个格子的名字，按界面语言。 */
export function leadAvatarSlotLabels(locale: Locale): Record<LeadAvatarSlot, string> {
  return profileMessages(locale).avatar.slots;
}

// 每个格子的预览按界面上的哪个状态画。
export const LEAD_AVATAR_SLOT_LOOKS: Record<LeadAvatarSlot, LeadAvatarLook> = {
  default: { state: 'idle', tone: 'color' },
  thinking: { state: 'thinking', tone: 'color' },
  muted: { state: 'idle', tone: 'muted' },
  offline: { state: 'idle', tone: 'quiet' },
};

/** 格子下面的一行说明：上传了的写大小；没上传、但上传了默认图的写「用默认图」；都没有时是「系统素材」。 */
export function leadAvatarSlotStatus(avatar: LeadAvatarDto, slot: LeadAvatarSlot, locale: Locale): string {
  const m = profileMessages(locale).avatar;
  const own = avatar.slots[slot];
  if (own) return m.uploaded(formatAvatarBytes(own.bytes));
  if (slot !== 'default' && avatar.slots.default) return m.usesDefault;
  return m.systemAsset;
}

export function leadAvatarFootnote(canUpload: boolean, locale: Locale): string {
  const m = profileMessages(locale).avatar;
  return canUpload ? m.footnoteUpload : m.footnoteWeb;
}

/** 预览下面的说明：查不到图时说为什么。能显示图、或者没写 emoji 时没有说明。 */
export function slackEmojiPreviewNote(preview: SlackEmojiPreview, locale: Locale): string | null {
  const m = profileMessages(locale).avatar;
  if (preview.status === 'not_found') return m.notFound;
  if (preview.status === 'unavailable') return preview.reason ?? m.unavailable;
  if (preview.status === 'invalid') return m.slackEmojiInvalid;
  return null;
}

/** 生效的 emoji 从哪来，写在保存按钮旁边。 */
export function slackEmojiSourceNote(avatar: LeadAvatarDto, locale: Locale): string {
  const m = profileMessages(locale).avatar;
  if (avatar.slackEmojiSource === 'settings') return m.sourceSettings;
  if (avatar.slackEmojiSource === 'config') return m.sourceConfig;
  return m.sourceDefault;
}
