// 审批和决定请求走完持久化的整条路（P02，.scratch/ui-action-parity/plan.md）：child 要审批 → Lead 被事件叫醒、
// 想代用户批准 → 被拒；用户本人在这一轮里说了 → Lead 代他批准；用户自己在审批卡上批准另一条。两个入口经过同一个操作层，
// 记同样的账本（审批、工单的活动、checkpoint、收件箱、主人操作、ui_action.performed），只是 actor 不同。最后关掉 daemon、
// 重新打开数据库，读回落盘的结果。
//
// 以前 Lead 的 resolve_approval（2026-10-28 删掉，现在是 perform_action）让 Lead 自报 channel，记成「user via <渠道>」，不查用户这一轮。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { Value } from "typebox/value";
import { tempDir } from "@pi-lead-child/core/testing";
import { createCoordinator, updateDesignPreferences } from "@pi-lead-child/engine";
import { createLeadTools } from "@pi-lead-child/lead";
import {
  AGENT_TASK_STARTED, KernelInterventionListResponseSchema, OWNER_ACTION_PERFORMED_KIND, UI_ACTION_PERFORMED_KIND,
  USER_PR_REVIEW_BOUND, computeRunGrant,
} from "@pi-lead-child/protocol";
import {
  addActivity, createItem, createLoopbackBinding, createRun, createTurn, getApproval, getItem, insertDecisionRequest, insertRunGrant,
  listEvents, openDb, transition, type Db,
} from "@pi-lead-child/store";
import { startDaemon } from "../src/server.js";

let dir: string;
let dbPath: string;
let db: Db;
let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;

beforeEach(() => {
  dir = tempDir("plc-approval-authority-");
  dbPath = join(dir, "plc.db");
  db = openDb(dbPath);
  // 这个文件的断言是中文：先把界面语言设成中文（缺省是英文）。
  updateDesignPreferences(db, { request: { locale: "zh" }, caller: { kind: "user" } });
});

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

const sessionFactory = async () => ({
  modelName: "stub/model",
  session: {
    sessionId: "stub-session",
    subscribe() { return () => {}; },
    async prompt() {}, async steer() {}, async followUp() {}, dispose() {},
  },
});

async function boot() {
  daemon = await startDaemon({ dataDir: dir, dbPath, sessionFactory: sessionFactory as any, gatewayPort: 0, log: () => {} });
  const owner = createLoopbackBinding(db, { name: "Mac 网页" });
  const base = `http://127.0.0.1:${daemon.pairedPort}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as any };
  };
  return { owner, post };
}

// Lead 的工具，当前这一轮由 daemon 给（这里直接给）。
const leadTool = (name: string, turnId: string | null, external = false) =>
  createLeadTools({ db, dbPath, dataDir: dir, currentTurnId: () => turnId, turnOrigin: () => ({ external, timer: null }) })
    .find((tool: any) => tool.name === name) as any;

function requestApproval(itemId: number, runId: number, action: string) {
  return createCoordinator({ db }).requestApproval({
    itemId, runId, requestedBy: "child", tool: "send_email", action,
    checkpoint: { title: "要发邮件", summary: action, nextStep: "等用户批准" },
  });
}

// 一条审批落了哪些账：审批本身、工单的活动、checkpoint、收件箱、主人操作、ui_action.performed。
function ledgerOf(reader: Db, approvalId: number) {
  const json = (row: { payload: string } | undefined) => (row ? JSON.parse(row.payload) : null);
  const approval = getApproval(reader, approvalId)!;
  const activity = reader.prepare(
    "SELECT actor, payload FROM activities WHERE kind='decision' AND json_extract(payload, '$.approvalId')=? AND json_extract(payload, '$.decision') IS NOT NULL",
  ).get(approvalId) as { actor: string; payload: string } | undefined;
  const checkpoints = reader.prepare(
    "SELECT title FROM checkpoints WHERE action_type='approval' AND action_id=? ORDER BY id",
  ).all(approvalId).map((row: any) => row.title);
  const inbox = reader.prepare(
    "SELECT state FROM inbox WHERE json_extract(payload, '$.authorityType')='approval' AND json_extract(payload, '$.authorityId')=?",
  ).all(approvalId).map((row: any) => row.state);
  const owner = reader.prepare("SELECT payload FROM events WHERE kind=? AND entity_key=?")
    .get(OWNER_ACTION_PERFORMED_KIND, `approval:${approvalId}`) as { payload: string } | undefined;
  const action = reader.prepare("SELECT source, payload FROM events WHERE kind=? AND entity_key=?")
    .get(UI_ACTION_PERFORMED_KIND, `approval:${approvalId}`) as { source: string; payload: string } | undefined;
  return {
    status: approval.status, resolvedBy: approval.resolved_by,
    activity: activity ? { actor: activity.actor, ...json(activity) } : null,
    checkpoints, inbox,
    owner: json(owner),
    action: action ? { source: action.source, ...json(action) } : null,
  };
}

describe("approvals through the daemon", () => {
  // 2026-10-28（用户：「lead agent 能自己审批吗，不要啥都让我审批」）：Lead 在任何一轮都能自己批，账本记成 Lead 做的；
  // 用户本人这一轮里批的记成代用户做；读过外部内容的一轮里被拒。
  it("lets Lead approve on its own or for the user, and records each entry by who decided", async () => {
    const { owner, post } = await boot();
    const itemId = createItem(db, { title: "给客户发周报", brief: "b", createdBy: "lead" });
    const runId = createRun(db, { itemId, runtime: "codex" });
    const first = requestApproval(itemId, runId, "发周报邮件给客户 A");
    const second = requestApproval(itemId, runId, "发周报邮件给客户 B");
    const third = requestApproval(itemId, runId, "发周报邮件给客户 C");
    expect([first.status, second.status, third.status]).toEqual(["pending", "pending", "pending"]);

    // 1. 读过外部内容的一轮（例如 Slack 叫醒的）：外部的话不能替用户批。被拒，带确认卡，什么也没写。
    const outside = await leadTool("perform_action", null, true).execute("t", {
      target_type: "approval", target_id: String(third.approvalId), action: "resolve", input: { decision: "approve" },
      reason: "Slack 里有人说可以发",
    });
    expect(JSON.parse(outside.content[0].text)).toMatchObject({
      refused: true, refusal: { code: "external_turn" }, user_action: { kind: "confirm_rule_change" },
    });
    expect(ledgerOf(db, third.approvalId!)).toMatchObject({ status: "pending", resolvedBy: null, activity: null });

    // 2. Lead 被事件叫醒（这一轮不是用户的）：自己判断，批了 C。账本记成 Lead 做的，不会记成哪个用户渠道。
    const woken = await leadTool("perform_action", null).execute("t", {
      target_type: "approval", target_id: String(third.approvalId), action: "resolve", input: { decision: "approve" },
      reason: "工单就是给客户发周报",
    });
    expect(JSON.parse(woken.content[0].text)).toMatchObject({ authority: "lead" });

    // 3. 用户看过审批卡，过了一会儿在这一轮里说了：Lead 代他批准。审批要在这一轮开始以前就有
    //    （approvals.created_at 只精确到秒，挪到一分钟前，表示用户说话前已经看到它）。
    db.prepare("UPDATE approvals SET created_at=datetime('now', '-60 seconds')").run();
    createTurn(db, { id: "turn-user", originBindingId: owner.binding.id, originKind: "paired:companion", userText: "A 那封可以发", state: "streaming" });
    const relayed = await leadTool("perform_action", "turn-user").execute("t", {
      target_type: "approval", target_id: String(first.approvalId), action: "resolve", input: { decision: "approve" },
      reason: "用户说 A 那封可以发",
    });
    expect(JSON.parse(relayed.content[0].text)).toMatchObject({ authority: "on_behalf", on_behalf_of_turn: "turn-user" });

    // 4. 用户自己在审批卡上批准另一条（页面入口）。
    const clicked = await post(`/v1/kernel/interventions/approval:${second.approvalId}/resolve`, { authority: "approval", decision: "approve" });
    expect(clicked).toEqual({ status: 200, body: { status: "resolved", interventionId: `approval:${second.approvalId}` } });

    // 关掉 daemon，重新打开数据库，读回落盘的结果。
    await daemon!.close();
    daemon = null;
    db.close();
    const reader = openDb(dbPath);
    const byLead = ledgerOf(reader, first.approvalId!);
    const byPage = ledgerOf(reader, second.approvalId!);
    const byLeadAlone = ledgerOf(reader, third.approvalId!);
    expect(byLeadAlone).toMatchObject({
      status: "approved", resolvedBy: "lead",
      activity: { actor: "lead", decision: "approve" },
      checkpoints: ["要发邮件", "Authorization approved, execution resumed"], inbox: ["consumed"],
      action: { source: "lead", action: "resolve", actor: "lead", authority: "lead" },
    });
    expect(byLeadAlone.activity.onBehalfOf).toBeUndefined();

    expect(byLead).toMatchObject({
      status: "approved", resolvedBy: "lead for user via turn:turn-user",
      activity: { actor: "lead", decision: "approve", onBehalfOf: "user", sourceTurnId: "turn-user" },
      checkpoints: ["要发邮件", "Authorization approved, execution resumed"], inbox: ["consumed"],
      owner: {
        action: "approval.resolve", summary: expect.stringMatching(/^\S+ 代你批准了审批/),
        credential: { bindingId: owner.binding.id }, source: { client: "lead" }, detail: { sourceTurnId: "turn-user" },
      },
      action: {
        source: "lead", action: "resolve", actor: "lead", authority: "on_behalf", onBehalfOf: "user", sourceTurnId: "turn-user",
        bindingId: owner.binding.id, detail: { decision: "approve", status: "approved" },
      },
    });
    expect(byPage).toMatchObject({
      status: "approved", resolvedBy: `user via paired binding:${owner.binding.id}`,
      activity: { actor: "user", decision: "approve" },
      checkpoints: ["要发邮件", "Authorization approved, execution resumed"], inbox: ["consumed"],
      owner: { action: "approval.resolve", summary: expect.stringMatching(/^批准了审批/), credential: { bindingId: owner.binding.id } },
      action: { source: "user", action: "resolve", actor: "user", authority: "user", bindingId: owner.binding.id },
    });
    expect(byPage.activity.onBehalfOf).toBeUndefined();
    expect(byPage.action.onBehalfOf).toBeUndefined();
    reader.close();
  });

  it("answers a decision request by audience: Lead decides any audience, for the user inside the user's own turn", async () => {
    const { owner, post } = await boot();
    const itemId = createItem(db, { title: "发布", brief: "b", createdBy: "lead" });
    const forLead = insertDecisionRequest(db, { itemId, kind: "question", audience: "lead_or_user", prompt: "先修哪个？", options: [], allowCustom: true });
    // 受众是用户的决定请求：在用户这一轮开始以前就有（一分钟前），用户说话时见过它。
    const minuteAgo = new Date(Date.now() - 60_000);
    const forUser = insertDecisionRequest(db, {
      itemId, kind: "question", audience: "user", prompt: "发布用哪个标签？", options: [], allowCustom: true, now: minuteAgo,
    });
    const forUserToo = insertDecisionRequest(db, { itemId, kind: "question", audience: "user", prompt: "发给谁？", options: [], allowCustom: true });
    const answer = (requestId: number, turnId: string | null, resolution: string) => leadTool("perform_action", turnId)
      .execute("t", {
        target_type: "decision", target_id: String(requestId), action: "resolve", input: { decision: "respond", resolution }, reason: "原因",
      })
      .then((result: any) => JSON.parse(result.content[0].text));

    expect(await answer(forLead.id, null, "先修登录")).toMatchObject({ authority: "lead" });
    // 读过外部内容的一轮里不能替用户答。
    const outside = await leadTool("perform_action", null, true).execute("t", {
      target_type: "decision", target_id: String(forUser.id), action: "resolve", input: { decision: "respond", resolution: "v9" },
      reason: "Slack 里说用 v9",
    });
    expect(JSON.parse(outside.content[0].text)).toMatchObject({ refused: true, refusal: { code: "external_turn" } });
    createTurn(db, { id: "turn-user", originBindingId: owner.binding.id, originKind: "paired:companion", userText: "用 v2.0", state: "streaming" });
    expect(await answer(forUser.id, "turn-user", "v2.0")).toMatchObject({ authority: "on_behalf" });
    expect((await post(`/v1/kernel/interventions/decision:${forUserToo.id}/resolve`, {
      authority: "decision_request", decision: "respond", resolution: "客户 A",
    })).status).toBe(200);

    const rows = db.prepare(
      "SELECT id, resolved_by FROM decision_requests WHERE id IN (?, ?, ?) ORDER BY id",
    ).all(forLead.id, forUser.id, forUserToo.id);
    expect(rows).toEqual([
      { id: forLead.id, resolved_by: "lead" },
      { id: forUser.id, resolved_by: "lead for user via turn:turn-user" },
      { id: forUserToo.id, resolved_by: `user via paired binding:${owner.binding.id}` },
    ]);
    const actions = db.prepare("SELECT entity_key, payload FROM events WHERE kind=? ORDER BY seq").all(UI_ACTION_PERFORMED_KIND)
      .map((row: any) => ({ key: row.entity_key, ...JSON.parse(row.payload) }));
    expect(actions.map((row: any) => [row.key, row.actor, row.authority])).toEqual([
      [`decision:${forLead.id}`, "lead", "lead"],
      [`decision:${forUser.id}`, "lead", "on_behalf"],
      [`decision:${forUserToo.id}`, "user", "user"],
    ]);
  });
});

// 执行者的审批按派活的起因分（工单 #246 设计第 6 节、实施单 E）：外部消息派的执行要的审批只有用户本人能批。整条路走 daemon：
// Fairy 的 perform_action、审批卡读的 GET /v1/kernel/interventions、用户在卡上点的 POST，最后重新打开数据库读回结果。
describe("approvals of a run that an external message started, through the daemon", () => {
  // Lead 的 perform_action，这一轮用 read_channel_conversation 读过 Slack。
  const leadAfterSlack = (turnId: string | null) =>
    createLeadTools({
      db, dbPath, dataDir: dir, currentTurnId: () => turnId,
      turnOrigin: () => ({ external: false, timer: null, externalBy: [{ via: "tool", tool: "read_channel_conversation" }] }),
    }).find((tool: any) => tool.name === "perform_action") as any;
  const approve = (tool: any, approvalId: number, reason: string) => tool.execute("t", {
    target_type: "approval", target_id: String(approvalId), action: "resolve", input: { decision: "approve" }, reason,
  }).then((result: any) => JSON.parse(result.content[0].text));

  it("refuses Lead outside the user's turn, lets the user approve on the card, and keeps Lead's own PR review as before", async () => {
    const { owner, post } = await boot();
    // 派单器开的工单（agent-tasks.ts）：system 建、purpose=lookup、记 agent_task_started。
    const external = createItem(db, { title: "slack 代码 review：Ethan 的请求", brief: "b", createdBy: "system", purpose: "lookup" });
    const externalRun = createRun(db, { itemId: external, purpose: "lookup" });
    addActivity(db, {
      itemId: external, runId: externalRun, actor: "system", kind: "decision",
      payload: { decision: AGENT_TASK_STARTED, intent: "code_review", source: "slack", requester: "Ethan", ref: "card:7" },
    });
    // 用户本人要的 PR 评审：有权限清单，没有 agent_task_started。
    const review = createItem(db, { title: "评审 acme/x#12", brief: "b", createdBy: "lead" });
    const reviewRun = createRun(db, { itemId: review });
    const scope = { pullRequest: { owner: "acme", repo: "x", number: 12 }, reviewEvents: [] };
    const { grant, dropped } = computeRunGrant({ intent: "code_review", scope, bound: USER_PR_REVIEW_BOUND, resolveLocalRepo: () => null, locale: "zh" });
    insertRunGrant(db, { runId: reviewRun, itemId: review, grant, bound: USER_PR_REVIEW_BOUND, scope, dropped, actor: "system" });

    const onCard = requestApproval(external, externalRun, "在 PR 上回复 Ethan").approvalId!;
    const inTurn = requestApproval(external, externalRun, "在 PR 上再回一条").approvalId!;
    const ownReview = requestApproval(review, reviewRun, "在 acme/x#12 上发评审").approvalId!;
    db.prepare("UPDATE approvals SET created_at=datetime('now', '-60 seconds')").run();

    // 审批卡读的数据：外部派的那两张带 externalOrigin，评审的不带；整份回答过客户端的校验。
    const listed = await fetch(`http://127.0.0.1:${daemon!.pairedPort}/v1/kernel/interventions?state=pending`, {
      headers: { authorization: `Bearer ${owner.accessToken}` },
    }).then((response) => response.json() as Promise<any>);
    expect(Value.Check(KernelInterventionListResponseSchema, listed)).toBe(true);
    expect(Object.fromEntries(listed.items.map((entry: any) => [entry.id, entry.externalOrigin ?? null]))).toEqual({
      [`approval:${onCard}`]: true, [`approval:${inTurn}`]: true, [`approval:${ownReview}`]: null,
    });

    // 1. 系统回合（不是用户的一轮）：Fairy 批外部派的，被拒，拒绝写明去哪里点。
    const woken = await approve(leadTool("perform_action", null), onCard, "工单就是回 Ethan");
    expect(woken).toMatchObject({
      refused: true,
      refusal: { code: "needs_user_turn", where: "会话里的审批卡、工单详情，或者 Slack 消息上的批准按钮" },
    });
    expect(woken.refusal.message).toContain("这次执行是 slack 上的外部消息派的（Ethan 的请求），要用户自己批");
    // 2. 同一张，用户在审批卡上批：成功。
    expect(await post(`/v1/kernel/interventions/approval:${onCard}/resolve`, { authority: "approval", decision: "approve" }))
      .toEqual({ status: 200, body: { status: "resolved", interventionId: `approval:${onCard}` } });
    // 3. 用户本人要的 PR 评审：Fairy 照旧自己批。
    expect(await approve(leadTool("perform_action", null), ownReview, "用户要的评审")).toMatchObject({ authority: "lead" });

    // 4. 用户本人正在说话的一轮：读过 Slack 时拒绝并带确认卡；同一轮没读过外部内容时代批。
    createTurn(db, { id: "turn-user", originBindingId: owner.binding.id, originKind: "paired:companion", userText: "批了", state: "streaming" });
    expect(await approve(leadAfterSlack("turn-user"), inTurn, "用户说批了")).toMatchObject({
      refused: true, refusal: { code: "external_turn" }, user_action: { kind: "confirm_rule_change" },
    });
    expect(getApproval(db, inTurn)?.status).toBe("pending");
    expect(await approve(leadTool("perform_action", "turn-user"), inTurn, "用户说批了"))
      .toMatchObject({ authority: "on_behalf", on_behalf_of_turn: "turn-user" });

    // 关掉 daemon，重新打开数据库，读回落盘的结果。
    await daemon!.close();
    daemon = null;
    db.close();
    const reader = openDb(dbPath);
    expect(ledgerOf(reader, onCard)).toMatchObject({
      status: "approved", resolvedBy: `user via paired binding:${owner.binding.id}`, activity: { actor: "user", decision: "approve" },
    });
    expect(ledgerOf(reader, inTurn)).toMatchObject({
      status: "approved", resolvedBy: "lead for user via turn:turn-user",
      activity: { actor: "lead", decision: "approve", onBehalfOf: "user", sourceTurnId: "turn-user" },
    });
    expect(ledgerOf(reader, ownReview)).toMatchObject({ status: "approved", resolvedBy: "lead", activity: { actor: "lead" } });
    reader.close();
  });
});

// 用户 2026-10-28：「工单操作让 Lead 自己判断」。Lead 被事件叫醒的一轮（不是用户这一轮）验收一张已交付的工单：落盘的 stage
// 是 done，变化记成 Lead 自己做的（没有代用户）；读过外部内容的一轮里被拒，什么也没写。
describe("ticket actions through the daemon", () => {
  it("lets Lead accept a delivered ticket on its own, and refuses it in a turn that read outside content", async () => {
    await boot();
    const itemId = createItem(db, { title: "修登录", brief: "b", createdBy: "lead" });
    const other = createItem(db, { title: "修注册", brief: "b", createdBy: "lead" });
    for (const id of [itemId, other]) {
      transition(db, { itemId: id, to: "active", actor: "system", reason: "run" });
      transition(db, { itemId: id, to: "review", actor: "child", reason: "delivered" });
    }

    // 2026-10-29 兜底授权卡：不直接验收，存下这一个操作，给用户一张确认卡；工单还在 review。
    const outside = await leadTool("ticket_action", null, true)
      .execute("t", { ticket_id: other, action: "complete", reason: "Slack 里说可以验收" });
    expect(outside).toMatchObject({ isError: true, details: { userAction: { kind: "confirm_rule_change" } } });
    expect(JSON.parse(outside.content[0].text).refusal.message).toContain("这一轮读过外部内容");
    expect(getItem(db, other)!.stage).toBe("review");

    const accepted = JSON.parse((await leadTool("ticket_action", null)
      .execute("t", { ticket_id: itemId, action: "complete", reason: "核对过交付，符合验收标准" })).content[0].text);
    expect(accepted).toMatchObject({ authority: "lead", result: { stage: "done" } });

    await daemon!.close();
    daemon = null;
    db.close();
    const reader = openDb(dbPath);
    expect(getItem(reader, itemId)!.stage).toBe("done");
    expect(getItem(reader, other)!.stage).toBe("review");
    const done = listEvents(reader, { kind: "stage.changed", entityKey: `ticket:${itemId}` }).at(-1)!.payload as Record<string, unknown>;
    expect(done).toMatchObject({ to: "done", actor: "lead" });
    expect(done).not.toHaveProperty("onBehalfOf");
    reader.close();
  });
});
