// 设置 → 外观（2026-10-22）的文字和表单规则。页面在 AppearanceSection.tsx。
import {
  DEFAULT_DESIGN_PREFERENCES, DENSITY_LEVELS, DENSITY_ZONES, LINE_HEIGHT_LEVELS, LOCALE_NAMES, LOCALES,
  PALETTE_ROLES, RADIUS_LEVELS, TEXT_SCALE_LEVELS,
  designPreferenceLabels, designPreferencesProblem, normalizeDesignPreferencesRequest,
  type DensityLevel, type DesignPreferencesDto, type DesignPreferencesFields, type DesignPreferencesRequest,
  type LineHeightLevel, type Locale, type RadiusLevel, type TextScaleLevel,
} from '@pi-lead-child/protocol';

import { formatConversationDate, formatConversationTime } from '@/features/chat/conversationTime';

import { appearanceMessages } from './appearance.messages';

/** 各个分段选择的选项，名字按界面语言。 */
export function appearanceOptions(locale: Locale) {
  const labels = designPreferenceLabels(locale);
  return {
    density: DENSITY_LEVELS.map((value) => ({ value, label: labels.density[value] })),
    radius: RADIUS_LEVELS.map((value) => ({ value, label: labels.radius[value] })),
    lineHeight: LINE_HEIGHT_LEVELS.map((value) => ({ value, label: labels.lineHeight[value] })),
    textScale: TEXT_SCALE_LEVELS.map((value) => ({ value, label: labels.textScale[value] })),
    // 语言的名字不翻译：每种语言用它自己的文字写（protocol 的 LOCALE_NAMES）。
    locale: LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value] })),
  };
}

// 表单里的字段都是字符串（useServerForm 的要求）：密度和颜色按键展开。
// 语言不在表单里：它在自己的一行，选了立即保存（AppearanceSection 的 LanguageCard）。
export type AppearanceForm = Record<string, string>;

export function appearanceForm(fields: DesignPreferencesFields): AppearanceForm {
  const form: AppearanceForm = { radius: fields.radius, lineHeight: fields.lineHeight, textScale: fields.textScale, notes: fields.notes };
  for (const zone of DENSITY_ZONES) form[`density.${zone}`] = fields.density[zone];
  for (const role of PALETTE_ROLES) form[`colors.${role}`] = fields.colors[role];
  return form;
}

/** 这次要发的修改：只带改了的字段（颜色按整理以后的值比较）。没有改时返回 null。 */
export function appearanceChanges(form: AppearanceForm, saved: DesignPreferencesFields): DesignPreferencesRequest | null {
  const request: DesignPreferencesRequest = {};
  for (const zone of DENSITY_ZONES) {
    const value = form[`density.${zone}`] as DensityLevel;
    if (value !== saved.density[zone]) (request.density ??= {})[zone] = value;
  }
  if (form.radius !== saved.radius) request.radius = form.radius as RadiusLevel;
  if (form.lineHeight !== saved.lineHeight) request.lineHeight = form.lineHeight as LineHeightLevel;
  if (form.textScale !== saved.textScale) request.textScale = form.textScale as TextScaleLevel;
  for (const role of PALETTE_ROLES) {
    const value = (form[`colors.${role}`] ?? '').trim().toUpperCase();
    if (value !== saved.colors[role]) (request.colors ??= {})[role] = value;
  }
  const notes = (form.notes ?? '').replace(/\r\n?/gu, '\n').trim();
  if (notes !== saved.notes) request.notes = notes;
  return Object.keys(request).length ? request : null;
}

/** 保存之前的检查：有问题时返回用户能看懂的一句话。 */
export function appearanceFormProblem(request: DesignPreferencesRequest, locale: Locale): string | null {
  return designPreferencesProblem(normalizeDesignPreferencesRequest(request), locale);
}

/** 「恢复缺省」要发的修改：和缺省不一样的字段。已经是缺省时返回 null。 */
export function appearanceResetRequest(saved: DesignPreferencesFields): DesignPreferencesRequest | null {
  return appearanceChanges(appearanceForm({ ...DEFAULT_DESIGN_PREFERENCES, notes: saved.notes, locale: saved.locale }), saved);
}

/** 「最近一次修改」那一行。从没改过时返回 null。 */
export function appearanceUpdatedLine(preferences: DesignPreferencesDto, leadName: string, now: Date, locale: Locale): string | null {
  if (!preferences.updatedAt) return null;
  const m = appearanceMessages(locale);
  const when = `${formatConversationDate(preferences.updatedAt, now, locale)} ${formatConversationTime(preferences.updatedAt, undefined, locale)}`.trim();
  const who = preferences.updatedBy === 'lead' ? m.byLead(leadName) : m.byYou;
  return m.updated(when, who);
}
