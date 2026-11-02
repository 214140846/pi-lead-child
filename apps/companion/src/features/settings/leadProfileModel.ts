// 设置 → Lead → 身份与风格（2026-10-22）的文字和表单规则。页面在 LeadProfileSection.tsx。
import {
  leadProfileProblem, normalizeLeadProfileRequest,
  type LeadProfileDto, type LeadProfileFields, type LeadProfileRequest, type Locale,
} from '@pi-lead-child/protocol';

import { formatConversationDate, formatConversationTime } from '@/features/chat/conversationTime';

import { profileMessages } from './profile.messages';

export type LeadProfileForm = { name: string; persona: string; interactionStyle: string };

export function leadProfileDescription(name: string, locale: Locale): string {
  return profileMessages(locale).description(name);
}

export function leadProfileBoundaryNote(name: string, locale: Locale): string {
  return profileMessages(locale).boundary(name);
}

/** 这次要发的修改：只带改了的字段（按整理以后的文字比较）。没有改时返回 null。 */
export function leadProfileChanges(form: LeadProfileForm, saved: LeadProfileFields): Partial<LeadProfileFields> | null {
  const next = normalizeLeadProfileRequest(form);
  const request: Partial<LeadProfileFields> = {};
  if (next.name !== saved.name) request.name = next.name;
  if (next.persona !== saved.persona) request.persona = next.persona;
  if (next.interactionStyle !== saved.interactionStyle) request.interactionStyle = next.interactionStyle;
  return Object.keys(request).length ? request : null;
}

/** 保存之前的检查：有问题时返回用户能看懂的一句话。 */
export function leadProfileFormProblem(request: LeadProfileRequest, locale: Locale): string | null {
  return leadProfileProblem(normalizeLeadProfileRequest(request), locale);
}

/** 「最近一次修改」那一行。从没改过时返回 null。 */
export function leadProfileUpdatedLine(profile: LeadProfileDto, now: Date, locale: Locale): string | null {
  if (!profile.updatedAt) return null;
  const m = profileMessages(locale);
  const when = `${formatConversationDate(profile.updatedAt, now, locale)} ${formatConversationTime(profile.updatedAt, undefined, locale)}`.trim();
  const who = profile.updatedBy === 'lead' ? m.byLead(profile.name) : m.byYou;
  return m.updated(when, who);
}
