// 改界面的外观偏好（设置页「外观」，2026-10-22）。一份实现，两个入口：
//   - 设置页：网关的 POST /v1/design/preferences（gateway 的 design-preferences-routes.ts）。
//   - Lead：update_design_preferences 工具（lead 的 design-tools.ts）。用户在对话里说「卡片太挤了」「圆角大一点」时用它。
// 权限和「身份与风格」一样是 user_only：Lead 只能在用户这一轮明确要求时代他改（store 的 activePairedUserTurn），
// 账本写 actor=lead、代谁、凭哪一轮。每次修改记一次主人操作（ui.design），「不是我」/「撤销」恢复成改之前的样子。
import {
  DENSITY_ZONES, DESIGN_PREFERENCES_RESOURCE, DesignPreferencesRequestSchema, LOCALE_NAMES, PALETTE_ROLES,
  applyDesignPreferencesRequest, defineMessages, designPreferenceLabels, designPreferencesFields, designPreferencesProblem,
  normalizeDesignPreferencesRequest, sameDesignPreferences,
  type DesignPreferencesDto, type DesignPreferencesFields, type DesignPreferencesRequest, type Locale, type OwnerActionSource,
} from "@pi-lead-child/protocol";
import {
  activePairedUserTurn, getBinding, getDesignPreferences, getLocale, recordOwnerAction, writeDesignPreferences, type Db,
} from "@pi-lead-child/store";
import { Value } from "typebox/value";
import type { ActionAttribution } from "./ticket-actions/attribution.js";
import type { OwnerCredential } from "./ticket-actions/types.js";

export type DesignPreferencesCaller =
  | { kind: "user"; credential?: OwnerCredential | null; source?: OwnerActionSource | null }
  // external：这一轮读进了外部来源的原文（lead 的 turn-origin.ts）。
  | { kind: "lead"; turnId: string | null; external?: boolean };

export class DesignPreferencesError extends Error {
  constructor(readonly code: "invalid_input" | "needs_user_turn", message: string) {
    super(message);
  }
}

export interface DesignPreferencesUpdateRequest {
  request: DesignPreferencesRequest;
  caller: DesignPreferencesCaller;
  now?: Date;
  publish?: (resource: typeof DESIGN_PREFERENCES_RESOURCE) => void;
  log?: (line: string) => void;
}

export interface DesignPreferencesUpdateOutcome {
  preferences: DesignPreferencesDto;
  changed: boolean;
  by: ActionAttribution;
  ownerActionEventId: string | null;
}

// 主人操作记录里给用户看的文字。按写入时用户选的语言写；以后换语言，旧记录不重写。
const summaryMessages = defineMessages({
  en: {
    target: "Appearance",
    density: (zone: string, level: string) => `set ${zone.toLowerCase()} density to ${level.toLowerCase()}`,
    radius: (level: string) => `set corner radius to ${level.toLowerCase()}`,
    lineHeight: (level: string) => `set line height to ${level.toLowerCase()}`,
    textScale: (level: string) => `set text size to ${level.toLowerCase()}`,
    color: (role: string, value: string) => `set the ${role.toLowerCase()} color to ${value}`,
    notesChanged: "changed the design notes",
    notesCleared: "cleared the design notes",
    locale: (name: string) => `set the language to ${name}`,
    join: (parts: string[]) => parts.join(", "),
    byYou: (summary: string) => summary.charAt(0).toUpperCase() + summary.slice(1),
    byLead: (summary: string) => `The assistant ${summary} for you`,
  },
  zh: {
    target: "界面的外观",
    density: (zone, level) => `${zone}的密度改成${level}`,
    radius: (level) => `圆角改成${level}`,
    lineHeight: (level) => `行高改成${level}`,
    textScale: (level) => `字号改成${level}`,
    color: (role, value) => `${role}改成 ${value}`,
    notesChanged: "改了设计说明",
    notesCleared: "清空了设计说明",
    locale: (name) => `界面语言改成${name}`,
    join: (parts) => parts.join("，"),
    byYou: (summary) => summary,
    byLead: (summary) => `助手代你${summary}`,
  },
});

/** 主人操作的一句话：改了什么。 */
export function designPreferencesChangeSummary(before: DesignPreferencesFields, after: DesignPreferencesFields, locale: Locale): string {
  const m = summaryMessages(locale);
  const labels = designPreferenceLabels(locale);
  const parts: string[] = [];
  for (const zone of DENSITY_ZONES) {
    if (before.density[zone] !== after.density[zone]) parts.push(m.density(labels.zone[zone], labels.density[after.density[zone]]));
  }
  if (before.radius !== after.radius) parts.push(m.radius(labels.radius[after.radius]));
  if (before.lineHeight !== after.lineHeight) parts.push(m.lineHeight(labels.lineHeight[after.lineHeight]));
  if (before.textScale !== after.textScale) parts.push(m.textScale(labels.textScale[after.textScale]));
  for (const role of PALETTE_ROLES) {
    if (before.colors[role] !== after.colors[role]) parts.push(m.color(labels.palette[role], after.colors[role]));
  }
  if (before.notes !== after.notes) parts.push(after.notes ? m.notesChanged : m.notesCleared);
  if (before.locale !== after.locale) parts.push(m.locale(LOCALE_NAMES[after.locale]));
  return m.join(parts);
}

function authorize(db: Db, caller: DesignPreferencesCaller): ActionAttribution {
  if (caller.kind === "user") return { actor: "user" };
  // 这些设置写进 Lead 的系统提示词。用户 2026-10-27：「严禁 Lead 本身的行为模式存在可能被 slack 消息通过提示词注入的机制
  // 导致改写的可能性」。这一轮读过外部原文时，即使是用户本人的一轮也不能改。
  if (caller.external) {
    throw new DesignPreferencesError(
      "needs_user_turn",
      "界面的外观会写进你的系统提示词，这一轮读过外部通道（例如 Slack）的消息，不能改。请用户在新的一条消息里再说一次。",
    );
  }
  try {
    const turn = activePairedUserTurn(db, caller.turnId, "update_design_preferences", "tickets:create");
    return { actor: "lead", onBehalfOf: { actor: "user", sourceTurnId: turn.id, bindingId: turn.origin_binding_id } };
  } catch (error) {
    throw new DesignPreferencesError(
      "needs_user_turn",
      "界面的外观只有用户在这一轮明确要求时你才能改"
        + `（${error instanceof Error ? error.message : String(error)}）。用户没有这样要求时，先把建议说给他听，或者请他在设置 → 外观里改。`,
    );
  }
}

function ownerOf(db: Db, caller: DesignPreferencesCaller, by: ActionAttribution): { credential: OwnerCredential; source: OwnerActionSource } | null {
  if (caller.kind === "user") {
    return caller.credential && caller.source ? { credential: caller.credential, source: caller.source } : null;
  }
  if (by.actor !== "lead" || !by.onBehalfOf) return null;
  const binding = getBinding(db, by.onBehalfOf.bindingId);
  if (!binding) return null;
  return { credential: binding, source: { client: "lead", deviceName: binding.display_name, loopback: false, fromThisMachine: true } };
}

/** 改外观偏好。两个入口都调它。 */
export function updateDesignPreferences(db: Db, update: DesignPreferencesUpdateRequest): DesignPreferencesUpdateOutcome {
  if (!Value.Check(DesignPreferencesRequestSchema, update.request)) {
    throw new DesignPreferencesError("invalid_input", "只能改 density、radius、lineHeight、textScale、colors、notes、locale，值要在各自的档位里");
  }
  const request = normalizeDesignPreferencesRequest(update.request);
  // 两个入口共用这句话：设置页直接显示它，所以按用户现在的语言写。
  const problem = designPreferencesProblem(request, getLocale(db));
  if (problem) throw new DesignPreferencesError("invalid_input", problem);
  const by = authorize(db, update.caller);
  const now = update.now ?? new Date();
  const current = getDesignPreferences(db);
  const before = designPreferencesFields(current);
  const after = applyDesignPreferencesRequest(before, request);
  if (sameDesignPreferences(before, after)) return { preferences: current, changed: false, by, ownerActionEventId: null };

  const preferences = db.transaction(() => writeDesignPreferences(db, after, { by: by.actor, at: now })).immediate();
  update.log?.(`[design-preferences] updated by ${by.actor}${by.actor === "lead" && by.onBehalfOf ? " on behalf of the user" : ""}`);
  let ownerActionEventId: string | null = null;
  const owner = ownerOf(db, update.caller, by);
  if (owner) {
    // 改语言的这一次，记录就用新的语言写：用户接下来看到的界面是新语言。
    const locale = after.locale;
    const m = summaryMessages(locale);
    const summary = designPreferencesChangeSummary(before, after, locale);
    try {
      ownerActionEventId = recordOwnerAction(db, {
        action: "ui.design",
        target: { key: "ui:design", label: m.target, ticketId: null },
        summary: by.actor === "lead" ? m.byLead(summary) : m.byYou(summary),
        detail: by.actor === "lead" && by.onBehalfOf ? { sourceTurnId: by.onBehalfOf.sourceTurnId } : {},
        undo: { kind: "design_preferences", before, after },
        credential: owner.credential,
        source: owner.source,
        now,
      }).event.eventId;
    } catch (error) {
      update.log?.(`[design-preferences] failed to record the owner action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  update.publish?.(DESIGN_PREFERENCES_RESOURCE);
  return { preferences, changed: true, by, ownerActionEventId };
}

/** 「不是我」/「撤销」：现在还是那次改完的样子时，恢复成改之前的样子。之后又改过的不动。 */
export function revertDesignPreferences(
  db: Db, undo: { before: DesignPreferencesFields; after: DesignPreferencesFields }, options: { now?: Date } = {},
): "reverted" | "changed_since" | "unchanged" {
  const current = designPreferencesFields(getDesignPreferences(db));
  // 2026-11-01 以前的记录没有 locale：那次修改没碰语言，按现在的语言算。
  const before = { ...undo.before, locale: undo.before.locale ?? current.locale };
  const after = { ...undo.after, locale: undo.after.locale ?? current.locale };
  undo = { before, after };
  if (sameDesignPreferences(current, undo.before)) return "unchanged";
  if (!sameDesignPreferences(current, undo.after)) return "changed_since";
  db.transaction(() => writeDesignPreferences(db, undo.before, { by: "user", at: options.now ?? new Date() })).immediate();
  return "reverted";
}
