// 执行者的审批按派活的起因分（工单 #246 设计第 6 节、实施单 E）：外部消息派的执行（派单器开的工单，带 agent_task_started 活动）
// 要的审批只有用户本人能批。Fairy 在别的轮次里批被拒，拒绝写明去哪里点；用户本人正在说话、说了「批了」的一轮里能代批；
// 那一轮读过外部内容时拒绝并带确认卡。用户本人要的 PR 评审有权限清单、没有这条活动，Fairy 照旧能批。
// coordinator 的 resolveApproval 再查一次：不经过操作层的调用方也不能让 Lead 自己批。
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { tempDir } from "@pi-lead-child/core/testing";
import { AGENT_TASK_STARTED, KernelInterventionSchema, USER_PR_REVIEW_BOUND, computeRunGrant } from "@pi-lead-child/protocol";
import {
  addActivity, createApproval, createItem, createLoopbackBinding, createRun, createTurn, externalTaskOriginOf, getApproval,
  insertRunGrant, openDb, type Binding, type Db,
} from "@pi-lead-child/store";
import { InterventionConflictError, createCoordinator, listLeadUiActions, runUiAction, type UiActionError } from "../src/index.js";

const APPROVAL_WHERE = "会话里的审批卡、工单详情，或者 Slack 消息上的批准按钮";
const SLACK_READ = [{ via: "tool", tool: "read_channel_conversation" }] as const;

let db: Db;
let owner: Binding;

beforeEach(() => {
  db = openDb(join(tempDir("plc-external-approval-"), "plc.db"));
  owner = createLoopbackBinding(db, { name: "Mac 网页" }).binding;
});

// 派单器开的工单（apps/daemon 的 agent-tasks.ts）：system 建、purpose=lookup、同一笔事务里记 agent_task_started。
function externalTask(): { itemId: number; runId: number } {
  const itemId = createItem(db, { title: "slack 代码 review：Ethan 的请求", brief: "b", createdBy: "system", purpose: "lookup" });
  const runId = createRun(db, { itemId, purpose: "lookup" });
  addActivity(db, {
    itemId, runId, actor: "system", kind: "decision",
    payload: { decision: AGENT_TASK_STARTED, intent: "code_review", source: "slack", requester: "Ethan", ref: "card:7" },
  });
  return { itemId, runId };
}

// 用户本人要的 PR 评审：有权限清单（pr-review-grant.ts），没有 agent_task_started。
function userPrReview(): { itemId: number; runId: number } {
  const itemId = createItem(db, { title: "评审 acme/x#12", brief: "b", createdBy: "lead" });
  const runId = createRun(db, { itemId });
  const scope = { pullRequest: { owner: "acme", repo: "x", number: 12 }, reviewEvents: [] };
  const { grant, dropped } = computeRunGrant({ intent: "code_review", scope, bound: USER_PR_REVIEW_BOUND, resolveLocalRepo: () => null, locale: "zh" });
  insertRunGrant(db, { runId, itemId, grant, bound: USER_PR_REVIEW_BOUND, scope, dropped, actor: "system" });
  return { itemId, runId };
}

// 审批要在用户这一轮开始以前就有（created_at 只精确到秒，挪到一分钟前）。
function approvalOn(itemId: number, runId: number): number {
  const approvalId = createApproval(db, { itemId, runId, requestedBy: "child", tool: "send_email", action: "回复 Ethan" });
  db.prepare("UPDATE approvals SET created_at=datetime('now', '-60 seconds') WHERE id=?").run(approvalId);
  return approvalId;
}

function liveTurn(id = "turn-live"): string {
  createTurn(db, { id, originBindingId: owner.id, originKind: "paired:companion", userText: "批了", state: "streaming" });
  return id;
}

const resolveAs = (approvalId: number, caller: Parameters<typeof runUiAction>[1]["caller"]) => runUiAction(db, {
  target: { type: "approval", id: approvalId }, action: "resolve", input: { decision: "approve" }, reason: "工单要回这封", caller,
}).then((outcome) => ({ outcome, refusal: null }), (caught: unknown) => ({ outcome: null, refusal: caught as UiActionError }));

const user = () => ({
  kind: "user", credential: owner, source: { client: "web", deviceName: owner.display_name, loopback: true, fromThisMachine: true },
}) as const;

describe("externalTaskOriginOf", () => {
  it("reads the source, requester and ref from the dispatcher's agent_task_started, and nothing else", () => {
    expect(externalTaskOriginOf(db, externalTask().itemId)).toEqual({ source: "slack", requester: "Ethan", ref: "card:7" });
    // 用户本人要的 PR 评审有权限清单，但不是外部起因。
    expect(externalTaskOriginOf(db, userPrReview().itemId)).toBeNull();
    expect(externalTaskOriginOf(db, createItem(db, { title: "t", brief: "b", createdBy: "lead" }))).toBeNull();
    // 只认 system 写的那一条。
    const forged = createItem(db, { title: "t", brief: "b", createdBy: "lead" });
    addActivity(db, { itemId: forged, actor: "lead", kind: "decision", payload: { decision: AGENT_TASK_STARTED, source: "slack" } });
    expect(externalTaskOriginOf(db, forged)).toBeNull();
  });
});

describe("approvals of a run that an external message started", () => {
  // 验收 1：系统回合（不是用户的一轮）里 Fairy 批，被拒，拒绝写明去哪里点。
  it("refuses Lead outside the user's turn and says where the user clicks", async () => {
    const { itemId, runId } = externalTask();
    const approvalId = approvalOn(itemId, runId);
    const { refusal } = await resolveAs(approvalId, { kind: "lead", turnId: null });
    expect(refusal?.refusal).toMatchObject({ code: "needs_user_turn", permission: "user_only", where: APPROVAL_WHERE });
    expect(refusal?.message).toContain("这次执行是 slack 上的外部消息派的（Ethan 的请求），要用户自己批");
    expect(refusal?.message).toContain(APPROVAL_WHERE);
    // 清单给 Lead 同一个答案。
    const listed = (await listLeadUiActions(db, { type: "approval", id: approvalId }, { turnId: null })).actions[0]!;
    expect(listed).toMatchObject({ lead: "user_turn", leadReady: false, leadReason: expect.stringContaining("要用户自己批") });
    expect(getApproval(db, approvalId)?.status).toBe("pending");
  });

  // 验收 2：同一张审批，用户在审批卡上批，成功。
  it("lets the user approve it on the card", async () => {
    const { itemId, runId } = externalTask();
    const approvalId = approvalOn(itemId, runId);
    expect((await resolveAs(approvalId, { kind: "lead", turnId: null })).refusal).not.toBeNull();
    const { outcome } = await resolveAs(approvalId, user());
    expect(outcome).toMatchObject({ authority: "user", result: { status: "resolved" } });
    expect(getApproval(db, approvalId)).toMatchObject({ status: "approved", resolved_by: `user via paired binding:${owner.id}` });
  });

  // 验收 4 前半：用户本人正在说话的一轮里说「批了」，Fairy 代批。
  it("lets Lead approve for the user inside the user's live turn", async () => {
    const { itemId, runId } = externalTask();
    const approvalId = approvalOn(itemId, runId);
    const turnId = liveTurn();
    const { outcome } = await resolveAs(approvalId, { kind: "lead", turnId });
    expect(outcome).toMatchObject({ authority: "on_behalf", by: { actor: "lead", onBehalfOf: { sourceTurnId: turnId } } });
    expect(getApproval(db, approvalId)).toMatchObject({ status: "approved", resolved_by: `lead for user via turn:${turnId}` });
  });

  // 验收 4 后半：那一轮读过外部内容，拒绝并带确认卡；用户确认卡以后照存下的那一次批。
  it("refuses it with a confirm card when the user's live turn read outside content, and runs it once the user confirms", async () => {
    const { itemId, runId } = externalTask();
    const approvalId = approvalOn(itemId, runId);
    const turnId = liveTurn();
    const { refusal } = await resolveAs(approvalId, { kind: "lead", turnId, externalContent: SLACK_READ });
    expect(refusal?.refusal).toMatchObject({ code: "external_turn", userAction: { kind: "confirm_rule_change" } });
    expect(getApproval(db, approvalId)?.status).toBe("pending");

    const id = refusal!.refusal!.confirm!.id!;
    await runUiAction(db, {
      target: { type: "rule_change", id }, action: "resolve", input: { decision: "confirm" }, reason: "在确认卡上决定", caller: user(),
    });
    expect(getApproval(db, approvalId)).toMatchObject({ status: "approved", resolved_by: `lead for user via turn:rule_change:${id}` });
  });

  // 下层再查一次：Lead 自己（不代用户）直接调 coordinator 也批不了。
  it("refuses Lead in the coordinator too, when the call skips the operation layer", () => {
    const { itemId, runId } = externalTask();
    const approvalId = approvalOn(itemId, runId);
    const coordinator = createCoordinator({ db });
    expect(() => coordinator.resolveApproval({ approvalId, decision: "approve", actor: { kind: "lead", resolvedBy: "lead" } }))
      .toThrow(InterventionConflictError);
    expect(() => coordinator.resolveApproval({ approvalId, decision: "approve", actor: { kind: "lead", resolvedBy: "lead" } }))
      .toThrow(/要用户自己批/);
    expect(getApproval(db, approvalId)?.status).toBe("pending");
  });

  // 审批卡读的线上数据：外部派的执行带 externalOrigin，别的不带这个字段。
  it("marks the approval card data of an external run, and only that", () => {
    const external = externalTask();
    const own = userPrReview();
    const externalId = approvalOn(external.itemId, external.runId);
    const ownId = approvalOn(own.itemId, own.runId);
    const listed = createCoordinator({ db }).listInterventions({}, { kind: "user" });
    const byId = new Map(listed.map((entry) => [entry.id, entry]));
    expect(byId.get(`approval:${externalId}`)).toMatchObject({ externalOrigin: true });
    expect(byId.get(`approval:${ownId}`)).not.toHaveProperty("externalOrigin");
    for (const entry of listed) expect(Value.Check(KernelInterventionSchema, entry)).toBe(true);
  });
});

// 验收 3：用户或 Fairy 自己建的工单要的审批，包括用户本人要的 PR 评审，Fairy 照旧能批。
describe("approvals of a run the user or Lead started", () => {
  it("lets Lead approve on its own, also for the user's own PR review that has a run grant", async () => {
    for (const { itemId, runId } of [userPrReview(), { itemId: createItem(db, { title: "t", brief: "b", createdBy: "user" }), runId: undefined }]) {
      const approvalId = runId === undefined
        ? createApproval(db, { itemId, requestedBy: "child", tool: "send_email", action: "发邮件" })
        : approvalOn(itemId, runId);
      const { outcome } = await resolveAs(approvalId, { kind: "lead", turnId: null });
      expect(outcome).toMatchObject({ authority: "lead", result: { status: "resolved" } });
      expect(getApproval(db, approvalId)).toMatchObject({ status: "approved", resolved_by: "lead" });
    }
  });

  // 没变的：用户本人正在说话的一轮读过外部内容，别的审批照旧能代批（2.6 的例外）。
  it("still exempts the user's live turn for an ordinary approval", async () => {
    const { itemId, runId } = userPrReview();
    const approvalId = approvalOn(itemId, runId);
    const turnId = liveTurn();
    const { outcome } = await resolveAs(approvalId, { kind: "lead", turnId, externalContent: SLACK_READ });
    expect(outcome).toMatchObject({ authority: "on_behalf" });
  });
});
