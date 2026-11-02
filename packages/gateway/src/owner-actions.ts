// 高风险的主人操作在网关这一层（工单 15 第一步）。清单和规则在 protocol 的 owner-actions.ts，写库在 store 的 owner-actions.ts。
//
// 这里做三件事：
//   - 每条路由在操作成功以后，用这里的构造函数说清做了什么、对象是谁、撤销要的操作前的状态，交给 paired-server 记下来；
//   - revertOwnerAction：用户点「不是我」时撤销这次操作。能撤销的撤销，不能撤销的说明原因；
//   - disownOwnerAction：撤销，再作废发出这次操作的凭证，最后记下结果。
//
// 「不是我」只作废发出那次操作的凭证（payload.credential.bindingId），不碰调用方指定的别的凭证：
// 冒用者拿网页会话点「不是我」，也作废不了手机或者别人的凭证。来自扫码配对的手机的操作只记录，不能点「不是我」。
// 撤回授权、拒绝审批这类更保守的结果不自动改回去：「不是我」只撤销放开了什么的那一类。
import {
  bindingOriginOf, canDisownOwnerAction, connectionSettingsLoosened, DEFAULT_CONNECTION_SETTINGS,
  describeConnectionSettings, describeConnectionSettingsChange, isOnBehalfOwnerActionSource, ITEM_ACTION_RISK, normalizeConnectionSettings,
  DEFAULT_LEAD_NAME, DESIGN_PREFERENCES_RESOURCE, LEAD_PROFILE_RESOURCE, REPLY_STYLE_RESOURCE, onBehalfUndoCredentialNote, ownerActionDefinition, ownerActionUndoNote,
  sameConnectionSettings, stricterConnectionSettings, withoutGrantRules,
  type ConnectionDto, type ConnectionSettings, type DesignPreferencesFields, type LeadProfileFields, type OwnerActionDto, type OwnerActionId, type OwnerActionRevertStatus,
  type Locale, type UserItemActionId,
} from "@pi-lead-child/protocol";
import {
  activeDelegationPolicy, activeLeadGrant, applyRunGrantChange, clearApprovalSessionExemption, getApproval, getBinding, getItem,
  getCoreMemoryChange, getLocale, getOwnerAction, getRunGrant, getRunGrantChange, grantChangeRevertedBy, leadDisplayName,
  getRun, getStandingOrder, isTerminalRunState, itemLabel, itemTarget, itemUpdatedEvent, ownerActionView,
  recordOwnerActionDisowned, revokeBinding, revokeDelegationPolicy, rollbackStandingOrderByUser, transition, withdrawApproval,
  type Approval, type Binding, type Db, type EventRecord, type LeadCapability, type LeadGrantChannel,
  type OwnerActionInput, type PublishGatewayEventInput,
} from "@pi-lead-child/store";
import type { DecisionRequest, Item, Run } from "@pi-lead-child/core";
import {
  CoreMemoryError, revertDesignPreferences, revertLeadProfile, revertReplyStyle, undoCoreMemoryChange, type NotesMemory,
} from "@pi-lead-child/engine";
import type { UserActionService } from "./user-actions.js";
import type { ConnectionsService } from "./connections-routes.js";
import type { ChannelSettingsService } from "./channel-settings-routes.js";
import { gatewayOwnerActionMessages } from "./owner-actions.messages.js";

// 撤销要的状态（OwnerActionUndo）和工单、Run、审批、决定请求的构造函数在 store 的 owner-actions.ts：engine 的操作层
// （Lead 代你做）也要用同一份。这里转出去，网关的老调用方不用改。
export {
  approvalConsumerLive, approvalOwnerAction, decisionOwnerAction, delegationOwnerAction,
  itemLabel, itemOwnerAction, itemTarget, runOwnerAction, workspaceOwnerAction, type OwnerActionInput, type OwnerActionUndo,
} from "@pi-lead-child/store";

// ── 路由用的构造函数 ──────────────────────────────────────────────────────────────

// leadName 是 Lead 的名字（设置 → 身份与风格）。locale 是写入时用户选的语言（store 的 getLocale）。
export function leadTrustOwnerAction(
  capability: string, change: { granted: true; grantId: number; changed: boolean } | { granted: false; revoked: number },
  leadName: string = DEFAULT_LEAD_NAME, locale: Locale = "zh",
): OwnerActionInput {
  const m = gatewayOwnerActionMessages(locale);
  const target = { key: `lead_trust:${capability}`, label: m.leadTrustTarget(leadName, capability), ticketId: null };
  if (!change.granted) {
    return {
      action: "lead.trust", target, summary: m.leadTrustRevoked(leadName, capability),
      detail: { capability, granted: false, revoked: change.revoked },
      undo: { kind: "lead_trust", capability, granted: false, grantId: null, changed: true },
    };
  }
  return {
    action: "lead.trust", target,
    summary: change.changed ? m.leadTrustGranted(leadName, capability) : m.leadTrustReconfirmed(leadName, capability),
    detail: { capability, granted: true, grantId: change.grantId },
    undo: { kind: "lead_trust", capability, granted: true, grantId: change.grantId, changed: change.changed },
  };
}

const settingsOf = (connection: Pick<ConnectionDto, "roles" | "writePolicy"> | null | undefined): ConnectionSettings =>
  normalizeConnectionSettings(connection ?? DEFAULT_CONNECTION_SETTINGS);

/** 设置页改了一个连接的权限设置。before 是改之前的连接（读不到时按缺省设置）。locale 是写入时用户选的语言。 */
export function connectionSettingsOwnerAction(
  before: Pick<ConnectionDto, "roles" | "writePolicy"> | null | undefined, after: ConnectionDto, locale: Locale = "zh",
): OwnerActionInput {
  const m = gatewayOwnerActionMessages(locale);
  const from = settingsOf(before);
  const to = settingsOf(after);
  const loosened = connectionSettingsLoosened(from, to);
  const change = describeConnectionSettingsChange(from, to, locale);
  return {
    action: "connection.settings",
    target: { key: `connection:${after.key}`, label: m.connectionSettingsTarget(after.label), ticketId: null },
    // 只写变了的那一项（2026-10-28）：改之前和改之后的完整设置在 detail 里。
    summary: change === null || sameConnectionSettings(from, to)
      ? m.connectionSettingsSaved(after.label, describeConnectionSettings(to, locale))
      : m.connectionSettingsChanged(after.label, change),
    detail: { before: from, after: to, loosened },
    undo: { kind: "connection_settings", key: after.key, before: from, after: to, loosened },
  };
}

/** 设置页保存或者删除了一个外部通道的凭据。names 是密钥名（没有值）。locale 是写入时用户选的语言。 */
export function channelCredentialsOwnerAction(
  change:
    | { op: "save"; source: string; label: string; names: readonly string[]; revision: string }
    | { op: "delete"; source: string; label: string; names: readonly string[] },
  locale: Locale = "zh",
): OwnerActionInput {
  const m = gatewayOwnerActionMessages(locale);
  const target = { key: `channel_settings:${change.source}`, label: m.channelCredentialsTarget(change.label), ticketId: null };
  const names = m.joinNames(change.names);
  if (change.op === "delete") {
    return {
      action: "channel.credentials", target,
      summary: m.channelCredentialsDeleted(change.label, names),
      detail: { op: "delete", source: change.source, names: [...change.names] },
      undo: { kind: "channel_credentials", op: "delete", source: change.source, label: change.label },
    };
  }
  return {
    action: "channel.credentials", target,
    summary: m.channelCredentialsSaved(change.label, names),
    detail: { op: "save", source: change.source, names: [...change.names] },
    undo: { kind: "channel_credentials", op: "save", source: change.source, label: change.label, revision: change.revision },
  };
}

// ── 撤销 ──────────────────────────────────────────────────────────────────────────

export interface OwnerActionDeps {
  db: Db;
  userActions?: UserActionService;
  leadTrust?: { revoke(capability: LeadCapability, via: LeadGrantChannel): number };
  connections?: Pick<ConnectionsService, "list" | "updateSettings">;
  channelSettings?: Pick<ChannelSettingsService, "revertSave">;
  // 常驻偏好的「不是我」：按改动编号恢复，并经它把笔记同步到记忆服务（daemon 的 NotesMemory）。
  notesMemory?: NotesMemory;
  publish(event: PublishGatewayEventInput): void;
  log(line: string): void;
  now?: () => Date;
}

export interface RevertResult {
  status: OwnerActionRevertStatus;
  message: string;
}

const reverted = (message: string): RevertResult => ({ status: "reverted", message });
const notRevertible = (message: string): RevertResult => ({ status: "not_revertible", message });
const unchanged = (message: string): RevertResult => ({ status: "unchanged", message });
const executed = (message: string): RevertResult => ({ status: "executed", message });

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

// 撤销的结果在用户点「不是我」时写进记录，按那时用户选的语言写。
const messagesOf = (db: Db) => gatewayOwnerActionMessages(getLocale(db));

// 工单完成以后可能已经开始的下游：依赖它的工单、父工单的集成。撤回验收不会把它们停下。
function downstreamNote(db: Db, itemId: number, m: ReturnType<typeof messagesOf>): string {
  const dependents = (db.prepare(
    `SELECT COUNT(*) AS n FROM ticket_relations
     WHERE target_item_id = ? AND relation_type = 'depends_on' AND revoked_at IS NULL`,
  ).get(itemId) as { n: number }).n;
  const parent = getItem(db, itemId)?.parent_item_id ?? null;
  if (!dependents && parent === null) return "";
  return m.downstream;
}

async function revertItem(deps: OwnerActionDeps, action: string, undo: Record<string, unknown>, by: string): Promise<RevertResult> {
  const { db } = deps;
  const locale = getLocale(db);
  const m = gatewayOwnerActionMessages(locale);
  const itemId = num(undo.itemId);
  const item = itemId === null ? undefined : getItem(db, itemId);
  if (!item) return notRevertible(m.ticketNotFound(itemId));
  const label = itemLabel(item, locale);
  const stage = m.stage(item.stage);
  if (action === "ticket.stop") return notRevertible(ownerActionUndoNote(action, locale));
  const actions = deps.userActions;
  if (action === "ticket.complete") {
    if (item.stage !== "done") return notRevertible(m.notAccepted(label, stage));
    transition(db, { itemId: item.id, to: "review", actor: "system", reason: `用户否认了这次验收（不是我，${by}）` });
    deps.publish(itemUpdatedEvent(item.id));
    return reverted(m.backToReview(label, downstreamNote(db, item.id, m)));
  }
  if (!actions) return notRevertible(m.controlUnavailable);
  if (action === "ticket.confirm") {
    if (item.stage === "ready") {
      actions.unconfirmItem(item.id);
      return reverted(m.backToDraft(label));
    }
    if (item.stage === "active" || item.stage === "blocked") {
      await actions.stopItem(item.id);
      actions.unconfirmItem(item.id);
      return reverted(m.stoppedBackToDraft(label));
    }
    return notRevertible(m.notBackToDraft(label, stage));
  }
  if (action === "ticket.cancel") {
    if (item.stage !== "cancelled") return notRevertible(m.notRestored(label, stage));
    await actions.restoreItem(item.id, { mode: "root_only", requestedBy: `user via 不是我（${by}）` });
    const after = getItem(db, item.id);
    return reverted(m.restored(label, m.stage(after?.stage ?? "draft")));
  }
  return notRevertible(m.unknownItemAction(label, action));
}

function revertApproval(deps: OwnerActionDeps, undo: Record<string, unknown>, by: string): RevertResult {
  const { db } = deps;
  const m = messagesOf(db);
  const approvalId = num(undo.approvalId);
  const approval = approvalId === null ? undefined : getApproval(db, approvalId);
  if (!approval) return notRevertible(m.approvalNotFound(approvalId));
  if (str(undo.decision) === "reject") return unchanged(m.rejectionStays);
  if (approval.status !== "approved") return notRevertible(m.approvalStatus(approval.id, approval.status));
  const publish = () => deps.publish({
    type: "approval.resolved", requiredScope: "approvals:respond",
    ...(approval.item_id === null ? {} : { itemId: approval.item_id }),
    payload: { approvalId: approval.id, status: getApproval(db, approval.id)?.status ?? approval.status, snapshotRequired: true },
  });
  if (undo.consumerLive !== false) {
    const exemption = clearApprovalSessionExemption(db, approval.id);
    if (exemption) publish();
    return executed(m.approvalConsumed(approval.id, Boolean(exemption)));
  }
  if (!withdrawApproval(db, approval.id, `user via 不是我（${by}）`)) {
    return notRevertible(m.approvalRaced(approval.id));
  }
  publish();
  return reverted(m.approvalWithdrawn(approval.id));
}

function revertStandingOrderProposal(deps: OwnerActionDeps, undo: Record<string, unknown>, by: string): RevertResult {
  const m = messagesOf(deps.db);
  if (undo.approve !== true) return unchanged(m.proposalRejectionStays(leadDisplayName(deps.db)));
  const orderId = str(undo.orderId);
  const baseVersion = num(undo.baseVersion);
  const appliedVersion = num(undo.appliedVersion);
  if (baseVersion === null) return notRevertible(m.newOrder(orderId));
  return rollbackOrder(deps, orderId, appliedVersion, baseVersion, by);
}

function revertStandingOrderRollback(deps: OwnerActionDeps, undo: Record<string, unknown>, by: string): RevertResult {
  const orderId = str(undo.orderId);
  return rollbackOrder(deps, orderId, num(undo.writtenVersion), num(undo.fromVersion), by);
}

function rollbackOrder(deps: OwnerActionDeps, orderId: string, expected: number | null, to: number | null, by: string): RevertResult {
  const m = messagesOf(deps.db);
  const current = getStandingOrder(deps.db, orderId);
  if (!current || expected === null || to === null) return notRevertible(m.orderVersionNotFound(orderId));
  if (current.version !== expected) return notRevertible(m.orderChangedSince(orderId, current.version));
  try {
    const written = rollbackStandingOrderByUser(deps.db, {
      id: orderId, toVersion: to, resolvedBy: `user via 不是我（${by}）`, ...(deps.now ? { now: deps.now() } : {}),
    });
    return reverted(m.orderRolledBack(orderId, to, written.order.version));
  } catch (error) {
    return notRevertible(m.orderRollbackFailed(orderId, error));
  }
}

function revertLeadTrust(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const m = messagesOf(deps.db);
  if (undo.granted !== true) return unchanged(m.trustRevocationStays);
  if (undo.changed !== true) return unchanged(m.trustUnchanged);
  const capability = str(undo.capability) as LeadCapability;
  const active = activeLeadGrant(deps.db, capability);
  if (!active || active.id !== num(undo.grantId)) return notRevertible(m.trustReplaced);
  if (!deps.leadTrust) return notRevertible(m.trustUnavailable);
  deps.leadTrust.revoke(capability, "control-plane");
  return reverted(m.trustWithdrawn(leadDisplayName(deps.db), capability));
}

function revertLeadDelegation(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const m = messagesOf(deps.db);
  if (undo.granted !== true) return unchanged(m.delegationRevocationStays);
  const policyId = num(undo.policyId);
  const ticketId = num(undo.ticketId);
  if (policyId === null || ticketId === null) return notRevertible(m.delegationNotFound);
  const active = activeDelegationPolicy(deps.db, ticketId);
  const revoked = revokeDelegationPolicy(deps.db, { policyId, via: "control-plane", reason: "用户否认了这次委托（不是我）" });
  if (!revoked) return notRevertible(m.delegationGone(policyId));
  deps.publish(itemUpdatedEvent(ticketId));
  const rework = undo.reworkStarted === true ? m.reworkContinues : "";
  return reverted(m.delegationWithdrawn(ticketId, policyId, Boolean(active && active.id !== policyId), rework));
}

// 只撤销这次放开的部分：新加的角色去掉，直接写入改回先问我。这次收紧的部分保持收紧。
// 之后又改过的不自动恢复（和常设指令的回滚一样）。
function revertConnectionSettings(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const locale = getLocale(deps.db);
  const m = gatewayOwnerActionMessages(locale);
  if (undo.loosened !== true) return unchanged(m.connectionNotLoosened);
  if (!deps.connections) return notRevertible(m.connectionsUnavailable);
  const key = str(undo.key);
  const read = (value: unknown) => normalizeConnectionSettings(
    (value && typeof value === "object" ? value : DEFAULT_CONNECTION_SETTINGS) as { roles: unknown[]; writePolicy: unknown },
  );
  const before = read(undo.before);
  const after = read(undo.after);
  const current = deps.connections.list().items.find((item) => item.key === key);
  if (!current) return notRevertible(m.connectionNotFound(key));
  const now = settingsOf(current);
  if (!sameConnectionSettings(now, after)) {
    return notRevertible(m.connectionChangedSince(current.label, describeConnectionSettings(now, locale)));
  }
  const target = stricterConnectionSettings(before, after);
  deps.connections.updateSettings(key, { roles: target.roles, writePolicy: target.writePolicy });
  return reverted(m.connectionRestored(current.label, describeConnectionSettings(target, locale)));
}

// 保存的凭据：保险库里这个来源的密钥还是这次保存的那一版时，全部删掉并重连（Keychain 或环境变量里还有时用它们）。
// 之后又改过的不自动删。删除凭据本来就更保守，不自动恢复（也没有留下删掉的值）。
async function revertChannelCredentials(deps: OwnerActionDeps, undo: Record<string, unknown>): Promise<RevertResult> {
  const source = str(undo.source);
  const label = str(undo.label) || source;
  const m = messagesOf(deps.db);
  if (undo.op !== "save") return unchanged(m.credentialDeletionStays);
  if (!deps.channelSettings) return notRevertible(m.channelsUnavailable);
  const result = await deps.channelSettings.revertSave(source, str(undo.revision));
  if (result.status === "unknown") return notRevertible(m.channelNotFound(source));
  if (result.status === "changed") return notRevertible(m.credentialsChangedSince(label));
  const fallback = result.source?.secrets.some((secret) => secret.present) ? m.credentialsFallback : m.credentialsDisconnected;
  return reverted(m.credentialsDeleted(label, fallback));
}

// 名字、人格和互动风格：现在还是那次改完的样子时，恢复成改之前的样子。之后又改过的不自动恢复。
function revertLeadProfileChange(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const fields = (value: unknown): LeadProfileFields | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return typeof record.name === "string" && typeof record.persona === "string" && typeof record.interactionStyle === "string"
      ? { name: record.name, persona: record.persona, interactionStyle: record.interactionStyle }
      : null;
  };
  const m = messagesOf(deps.db);
  const before = fields(undo.before);
  const after = fields(undo.after);
  if (!before || !after) return notRevertible(m.noBefore);
  const result = revertLeadProfile(deps.db, { before, after }, deps.now ? { now: deps.now() } : {});
  if (result === "changed_since") return notRevertible(m.profileChangedSince);
  if (result === "unchanged") return unchanged(m.profileUnchanged);
  deps.publish({ type: "snapshot.required", requiredScope: "tickets:view", payload: { resource: LEAD_PROFILE_RESOURCE } });
  return reverted(m.profileRestored(before.name));
}

// 代回复风格：现在还是那次改完的样子时，恢复成改之前的样子。之后又改过的不自动恢复。
function revertReplyStyleChange(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const m = messagesOf(deps.db);
  if (typeof undo.before !== "string" || typeof undo.after !== "string") return notRevertible(m.noBefore);
  const result = revertReplyStyle(deps.db, { before: undo.before, after: undo.after }, deps.now ? { now: deps.now() } : {});
  if (result === "changed_since") return notRevertible(m.replyStyleChangedSince);
  if (result === "unchanged") return unchanged(m.replyStyleUnchanged);
  deps.publish({ type: "snapshot.required", requiredScope: "tickets:view", payload: { resource: REPLY_STYLE_RESOURCE } });
  return reverted(undo.before ? m.replyStyleRestored : m.replyStyleCleared);
}

// 常驻偏好（2026-10-29）：按这次的改动编号撤销（core_memory_changes）。之后又改过、或者已经撤销过的不自动恢复。
function revertCoreMemoryChange(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const m = messagesOf(deps.db);
  const changeId = num(undo.changeId);
  if (changeId === null) return notRevertible(m.noChangeId);
  if (!deps.notesMemory) return notRevertible(m.memoryNotStarted);
  if (getCoreMemoryChange(deps.db, changeId)?.undoneAt) return unchanged(m.memoryAlreadyUndone);
  try {
    undoCoreMemoryChange(deps.db, deps.notesMemory, changeId, {
      actor: "user", reason: "「不是我」撤销了这次改动", ...(deps.now ? { now: deps.now() } : {}),
    });
  } catch (error) {
    if (!(error instanceof CoreMemoryError)) throw error;
    return notRevertible(m.memoryFailed(error.message));
  }
  return reverted(m.memoryRestored);
}

// 外观偏好：现在还是那次改完的样子时，恢复成改之前的样子。之后又改过的不自动恢复。
function revertDesignPreferencesChange(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const fields = (value: unknown): DesignPreferencesFields | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return record.density && typeof record.density === "object" && typeof record.radius === "string" && typeof record.lineHeight === "string"
      && typeof record.textScale === "string" && record.colors && typeof record.colors === "object" && typeof record.notes === "string"
      ? record as unknown as DesignPreferencesFields
      : null;
  };
  const before = fields(undo.before);
  const after = fields(undo.after);
  if (!before || !after) return notRevertible(messagesOf(deps.db).noBefore);
  const result = revertDesignPreferences(deps.db, { before, after }, deps.now ? { now: deps.now() } : {});
  // 撤销可能改了语言：结果按恢复以后的语言写，用户接下来看到的界面是那种语言。
  const m = messagesOf(deps.db);
  if (result === "changed_since") return notRevertible(m.designChangedSince);
  if (result === "unchanged") return unchanged(m.designUnchanged);
  deps.publish({ type: "snapshot.required", requiredScope: "tickets:view", payload: { resource: DESIGN_PREFERENCES_RESOURCE } });
  return reverted(m.designRestored);
}

async function revertRun(deps: OwnerActionDeps, action: string, undo: Record<string, unknown>): Promise<RevertResult> {
  const locale = getLocale(deps.db);
  const m = gatewayOwnerActionMessages(locale);
  if (action === "run.stop") return notRevertible(ownerActionUndoNote(action, locale));
  const runId = num(undo.runId);
  const run = runId === null ? undefined : getRun(deps.db, runId);
  if (!run) return notRevertible(m.runNotFound(runId));
  if (run.state !== "paused") return notRevertible(m.runNotPaused(run.id, run.state));
  if (!deps.userActions) return notRevertible(m.controlUnavailableResume);
  try {
    await deps.userActions.resumeRun(run.id);
    return reverted(m.runResumed(run.id));
  } catch (error) {
    return notRevertible(m.runResumeFailed(run.id, error));
  }
}

// 放宽权限清单：删掉这一次加上的规则（和只给这次加上的本地仓库）。之后又放宽的规则不动。
// 撤销记成账本里的一条 reverted。用新权限已经做了的写操作不会撤回（它们各自是一条 connection.agent_write）。
function revertRunGrant(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const m = messagesOf(deps.db);
  const runId = num(undo.runId);
  const changeId = num(undo.changeId);
  const change = changeId === null ? null : getRunGrantChange(deps.db, changeId);
  if (runId === null || !change || change.runId !== runId || change.change !== "widened") {
    return notRevertible(m.grantChangeNotFound);
  }
  if (grantChangeRevertedBy(deps.db, change.id)) return unchanged(m.grantAlreadyReverted);
  return deps.db.transaction((): RevertResult => {
    const record = getRunGrant(deps.db, runId);
    if (!record) return notRevertible(m.grantMissing(runId));
    const grant = withoutGrantRules(record.grant, change.rules.map((rule) => rule.id), change.localRepos.map((entry) => entry.name));
    applyRunGrantChange(deps.db, {
      runId, expectedRevision: record.revision, grant, change: "reverted", rules: change.rules, localRepos: change.localRepos,
      actor: "user", reason: "用户撤销了这次放宽", revertsChangeId: change.id,
      ...(deps.now ? { now: deps.now() } : {}),
    });
    return reverted(m.grantReverted(runId, m.joinRules(change.rules.map((rule) => rule.label))));
  }).immediate();
}

// 子 agent 经连接中心的写操作（landing.md C3）。记成主人操作的都是别人看得到的写操作（提交了的 review、发出的评论），
// 已经发到外部服务。连接（GitHub 的远程 MCP）没有删掉提交了的 review 或评论的工具，所以系统撤不回：给出链接，请你在那边改或删。
function revertAgentWrite(deps: OwnerActionDeps, undo: Record<string, unknown>): RevertResult {
  const m = messagesOf(deps.db);
  const url = str(undo.url);
  return executed(m.agentWriteSent(str(undo.connection) || m.externalService, url || null));
}

/** 撤销一次主人操作。按事件的 action 和 undo 来，不会抛错：出了问题就返回 not_revertible 和原因。 */
export async function revertOwnerAction(deps: OwnerActionDeps, performed: EventRecord, by: string): Promise<RevertResult> {
  const action = str(performed.payload.action);
  const undo = (performed.payload.undo ?? {}) as Record<string, unknown>;
  const definition = ownerActionDefinition(action);
  const locale = getLocale(deps.db);
  const m = gatewayOwnerActionMessages(locale);
  if (!definition) return notRevertible(m.unknownAction(action));
  try {
    switch (definition.id) {
      case "ticket.confirm": case "ticket.complete": case "ticket.stop": case "ticket.cancel":
        return await revertItem(deps, definition.id, undo, by);
      case "approval.resolve":
        return revertApproval(deps, undo, by);
      case "decision.resolve":
      case "memory.switch_confirm":
      case "workspace.release":
      case "workspace.cleanup":
        return notRevertible(ownerActionUndoNote(definition.id, locale, leadDisplayName(deps.db)));
      case "connection.confirm":
        if (undo.approve !== true) return unchanged(m.connectionRefusalStays);
        if (str(undo.state) === "failed") return unchanged(m.connectionWriteFailed);
        return executed(ownerActionUndoNote(definition.id, locale));
      case "standing_order.proposal_decide":
        return revertStandingOrderProposal(deps, undo, by);
      case "standing_order.rollback":
        return revertStandingOrderRollback(deps, undo, by);
      case "lead.trust":
        return revertLeadTrust(deps, undo);
      case "lead.delegation":
        return revertLeadDelegation(deps, undo);
      case "connection.settings":
        return revertConnectionSettings(deps, undo);
      case "channel.credentials":
        return await revertChannelCredentials(deps, undo);
      case "run.pause": case "run.stop":
        return await revertRun(deps, definition.id, undo);
      case "run.grant":
        return revertRunGrant(deps, undo);
      case "connection.agent_write":
        return revertAgentWrite(deps, undo);
      case "lead.profile":
        return revertLeadProfileChange(deps, undo);
      case "ui.design":
        return revertDesignPreferencesChange(deps, undo);
      case "channel.reply_style":
        return revertReplyStyleChange(deps, undo);
      case "memory.preferences":
        return revertCoreMemoryChange(deps, undo);
    }
  } catch (error) {
    deps.log(`[owner-action] revert ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
    return notRevertible(m.revertFailed(error));
  }
}

// ── 作废凭证和「不是我」 ──────────────────────────────────────────────────────────

/** 作废发出这次操作的凭证。只看事件里记的 bindingId。 */
export function revokeOwnerActionCredential(db: Db, credential: Record<string, unknown>): {
  bindingId: number; revoked: boolean; message: string;
} {
  const m = messagesOf(db);
  const bindingId = num(credential.bindingId) ?? 0;
  if (bindingId < 1) return { bindingId, revoked: false, message: m.adminToken };
  const binding = getBinding(db, bindingId);
  if (!binding) return { bindingId, revoked: false, message: m.credentialNotFound(bindingId) };
  const name = m.credentialName(binding.display_name, binding.id);
  if (binding.status !== "active") return { bindingId, revoked: true, message: m.credentialAlreadyRevoked(name) };
  revokeBinding(db, binding.id);
  return { bindingId, revoked: true, message: m.credentialRevoked(name, binding.kind === "cli" ? m.cliAgain : m.pairAgain) };
}

export class OwnerActionError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "conflict", message: string) {
    super(message);
  }
}

const inFlight = new WeakMap<Db, Set<string>>();

/**
 * 用户点了「不是我」。调用方只能是扫码配对的手机或者网页会话（protocol 的 canDisownOwnerAction）。
 * 先撤销，再作废发出那次操作的凭证，最后记下结果。同一次操作点两次，第二次直接回第一次的结果。
 */
export async function disownOwnerAction(deps: OwnerActionDeps, eventId: string, caller: Binding): Promise<OwnerActionDto> {
  const { db } = deps;
  const m = messagesOf(db);
  if (!canDisownOwnerAction({ kind: caller.kind, origin: bindingOriginOf(caller) })) {
    throw new OwnerActionError("forbidden", m.disownForbidden);
  }
  const found = getOwnerAction(db, eventId);
  if (!found) throw new OwnerActionError("not_found", m.disownNotFound(eventId));
  if (found.disowned) return ownerActionView(db, eventId)!;
  if (found.performed.payload.delivery !== "push") throw new OwnerActionError("conflict", m.disownRecordOnly);
  const running = inFlight.get(db) ?? new Set<string>();
  inFlight.set(db, running);
  if (running.has(eventId)) throw new OwnerActionError("conflict", m.disownInFlight);
  running.add(eventId);
  try {
    const by = `${caller.display_name}，binding ${caller.id}`;
    const revert = await revertOwnerAction(deps, found.performed, by);
    // Lead 在对话里代你做的（审查 M5）：只撤销，不作废那一轮来自的凭证——多半是 Lead 理解错了，你的设备还要用。
    const performedCredential = (found.performed.payload.credential ?? {}) as Record<string, unknown>;
    const credential = isOnBehalfOwnerActionSource((found.performed.payload.source ?? { client: "" }) as { client: string })
      ? { bindingId: num(performedCredential.bindingId) ?? 0, revoked: false, message: onBehalfUndoCredentialNote(leadDisplayName(db), getLocale(db)) }
      : revokeOwnerActionCredential(db, performedCredential);
    recordOwnerActionDisowned(db, {
      performed: found.performed, by: caller, revert, credential, ...(deps.now ? { now: deps.now() } : {}),
    });
    deps.publish({
      type: "snapshot.required", requiredScope: "notices",
      payload: { resource: "notifications" },
    });
    deps.log(`[owner-action] ${str(found.performed.payload.action)} disowned by binding #${caller.id}: `
      + `${revert.status}; binding #${credential.bindingId} ${credential.revoked ? "revoked" : "not revoked"}`);
    return ownerActionView(db, eventId)!;
  } finally {
    running.delete(eventId);
  }
}
