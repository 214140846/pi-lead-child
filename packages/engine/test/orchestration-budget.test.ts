import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { createCoordinator } from "../src/coordinator/service.js";
import { createDispatcher } from "../src/coordinator/dispatch.js";
import { openDb } from "@pi-lead-child/store";
import { createRun, updateRun } from "@pi-lead-child/store";
import { createItem, getItem } from "@pi-lead-child/store";
import { addInbox, listEvents, listInbox, markInbox } from "@pi-lead-child/store";
import { runTicketAction } from "../src/ticket-actions/index.js";

function plannedRoot(options: { tokenBudget?: number; costBudgetUsd?: number; siblings?: boolean } = {}) {
  const db = openDb(join(tempDir("plc-budget-"), "plc.db"));
  const coordinator = createCoordinator({ db });
  const root = coordinator.createRootItem({ title: "root", brief: "b", createdBy: "lead" });
  db.prepare("UPDATE items SET stage='active', token_budget=?, cost_budget_usd=? WHERE id=?")
    .run(options.tokenBudget ?? null, options.costBudgetUsd ?? null, root);
  const planner = createRun(db, { itemId: root });
  updateRun(db, planner, { state: "running" });
  const revision = coordinator.beginPlanning({ itemId: root, runId: planner });
  const child = coordinator.createSubitem(
    { itemId: root, runId: planner, revision },
    { title: "child", brief: "b", runtime: "codex" },
  );
  const sibling = options.siblings
    ? coordinator.createSubitem({ itemId: root, runId: planner, revision }, { title: "sibling", brief: "b", runtime: "codex" })
    : null;
  coordinator.finishPlanning({ itemId: root, runId: planner, revision });
  return { db, root, child, sibling };
}

describe("orchestration budgets", () => {
  it("warns at the soft token threshold but still dispatches", () => {
    const { db, root, child } = plannedRoot({ tokenBudget: 100 });
    db.prepare("UPDATE items SET total_tokens=80 WHERE id=?").run(child);
    const dispatcher = createDispatcher(db, { softBudgetRatio: 0.8 });
    expect(dispatcher.claimNext()?.itemId).toBe(child);
    expect(listInbox(db, { severity: "attention" }).some((row) => row.summary.includes("预算接近上限"))).toBe(true);
    expect(getItem(db, root)?.stage).toBe("active");
  });

  it("blocks the root when descendant tokens reach the hard budget", () => {
    const { db, root, child } = plannedRoot({ tokenBudget: 100 });
    db.prepare("UPDATE items SET total_tokens=100 WHERE id=?").run(child);
    const dispatcher = createDispatcher(db);
    expect(dispatcher.claimNext()).toBeNull();
    expect(getItem(db, root)).toMatchObject({ stage: "blocked", plan_state: "failed" });
    expect(listInbox(db, { severity: "blocker" }).some((row) => row.summary.includes("token 预算"))).toBe(true);
  });

  it("rejects unknown-cost runtimes under a hard USD budget unless an estimator exists", () => {
    const first = plannedRoot({ costBudgetUsd: 2 });
    expect(createDispatcher(first.db).claimNext()).toBeNull();
    expect(getItem(first.db, first.root)?.stage).toBe("blocked");

    const second = plannedRoot({ costBudgetUsd: 2 });
    expect(createDispatcher(second.db, {
      hasCostEstimator: (runtime) => runtime === "codex",
    }).claimNext()?.itemId).toBe(second.child);
  });

  it("does not claim an item that already has an active run", () => {
    const { db, child } = plannedRoot();
    const run = createRun(db, { itemId: child });
    updateRun(db, run, { state: "running" });
    expect(createDispatcher(db).claimNext()).toBeNull();
  });

  // #262：11-05 两张单的派发被 1000 万的 token 预算拦下以后，派发请求一直排着队，每隔约 10 秒 claim 一次。
  // 以前每次 claim 都按"现在有没有未处理的同一条"判断：Lead 一处理完，下一次 claim 又报一条，#259 报了 5 条。
  // 同一张单、同一个原因只报一条；用户调高预算以后，排着的请求自己放行。
  it("raises one budget blocker per budget, however often the queued request is retried", async () => {
    const { db, root, child } = plannedRoot({ tokenBudget: 100 });
    db.prepare("UPDATE items SET total_tokens=100 WHERE id=?").run(child);
    const dispatcher = createDispatcher(db);
    const budgetBlockers = () => listInbox(db, { severity: "blocker" }).filter((row) => row.summary.includes("token 预算"));
    for (let retry = 0; retry < 5; retry++) {
      expect(dispatcher.claimNext()).toBeNull();
      // Lead 处理完了这一条（线上每条都记了 told_user）。
      markInbox(db, budgetBlockers().map((row) => row.id), "consumed");
    }
    expect(budgetBlockers()).toHaveLength(1);
    expect(listEvents(db, { kind: "inbox.blocker" })
      .filter((event) => (event.payload as { inboxKind?: string }).inboxKind === "orchestration_budget")).toHaveLength(1);

    await runTicketAction(db, {
      itemId: root, action: "set_budget", input: { tokenBudget: 1_000 }, caller: { kind: "user" }, reason: "调高预算",
    });
    expect(dispatcher.claimNext()?.itemId).toBe(child);
    expect(budgetBlockers()).toHaveLength(1);
  });

  // 调高预算以后又用到了新的上限：这是新的一轮，再报一条。
  it("raises a new blocker when the raised budget is reached again", async () => {
    const { db, root, child } = plannedRoot({ tokenBudget: 100 });
    db.prepare("UPDATE items SET total_tokens=100 WHERE id=?").run(child);
    const dispatcher = createDispatcher(db);
    expect(dispatcher.claimNext()).toBeNull();
    await runTicketAction(db, {
      itemId: root, action: "set_budget", input: { tokenBudget: 200 }, caller: { kind: "user" }, reason: "调高预算",
    });
    db.prepare("UPDATE items SET total_tokens=200 WHERE id=?").run(child);
    expect(dispatcher.claimNext()).toBeNull();
    expect(listInbox(db, { severity: "blocker" }).map((row) => row.summary)).toEqual([
      `工单 #${root} 已达到 token 预算上限 100`, `工单 #${root} 已达到 token 预算上限 200`,
    ]);
  });

  // 预算的 blocker 以前直接写 inbox 表，绕过了 addInbox 里的熔断（常设指令 inbox.fuse_blockers：
  // 同一范围 1 小时内第 3 条 blocker 起只进摘要）。
  it("folds the budget blocker into the fuse once the ticket has had too many blockers", () => {
    const { db, root, child } = plannedRoot({ tokenBudget: 100 });
    for (const summary of ["第一条", "第二条"]) {
      addInbox(db, { itemId: root, severity: "blocker", source: "structural", summary });
    }
    db.prepare("UPDATE items SET total_tokens=100 WHERE id=?").run(child);
    expect(createDispatcher(db).claimNext()).toBeNull();

    const blockers = listInbox(db, { severity: "blocker" }).filter((row) => row.item_id === root);
    expect(blockers.map((row) => row.summary)).toEqual(["第一条", "第二条", expect.stringContaining("异常频繁")]);
    expect(JSON.parse(blockers[2]!.payload)).toMatchObject({ lastSummary: `工单 #${root} 已达到 token 预算上限 100` });
    expect(listEvents(db, { kind: "inbox.blocker" }).at(-1)).toMatchObject({
      payload: { inboxKind: "orchestration_budget", delivery: "folded" },
    });
  });

  // #266：11-05 晚上 #263 在待验收，自动核查的派发请求撞上 1000 万的 token 预算，每 5–10 秒 claim 一次，
  // 每次都重算预算、改工单、再报一条 blocker，Lead 一晚上被叫醒约 900 次。
  // 预算超限时请求挂起，写明原因；之后的 claim 只看预算够不够，不再写库，也不再报。调高预算以后照常派发。
  it("suspends a queued review that hits the budget, stops retrying it, and resumes after the budget is raised", async () => {
    const db = openDb(join(tempDir("plc-budget-review-"), "plc.db"));
    const itemId = createItem(db, { title: "delivered", brief: "b", createdBy: "lead", runtime: "codex" });
    db.prepare("UPDATE items SET stage='review', token_budget=100, total_tokens=150 WHERE id=?").run(itemId);
    const dispatcher = createDispatcher(db);
    const requestId = dispatcher.request({
      itemId, role: "reviewer", purpose: "review", runtime: "codex",
      trigger: "automatic-review", idempotencyKey: `automatic-review:${itemId}:test`,
    });
    const request = () => db.prepare("SELECT state, suspended_reason FROM dispatch_requests WHERE id=?")
      .get(requestId) as { state: string; suspended_reason: string | null };
    const writes = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const wakes = () => listEvents(db, { kind: "inbox.blocker" })
      .filter((event) => (event.payload as { wakeLead?: boolean }).wakeLead === true);

    expect(dispatcher.claimNext()).toBeNull();
    expect(request()).toMatchObject({ state: "pending", suspended_reason: expect.stringContaining("预算") });
    expect(wakes()).toHaveLength(1);

    // Lead 处理完了这一条（线上每条都记了 told_user）。挂起以后，每一拍的 claim 都不再写库：不改工单，不记活动，不报 blocker。
    markInbox(db, listInbox(db, { state: ["pending", "delivered"] }).map((row) => row.id), "consumed");
    const before = writes();
    for (let tick = 0; tick < 20; tick++) expect(dispatcher.claimNext()).toBeNull();
    // 挂起记在库里：daemon 重启以后的新 dispatcher 也不再重试。
    for (let tick = 0; tick < 5; tick++) expect(createDispatcher(db).claimNext()).toBeNull();
    expect(writes()).toBe(before);
    expect(wakes()).toHaveLength(1);

    await runTicketAction(db, {
      itemId, action: "set_budget", input: { tokenBudget: 1_000 }, caller: { kind: "user" }, reason: "调高预算",
    });
    expect(dispatcher.claimNext()).toMatchObject({ requestId, itemId, role: "reviewer" });
    expect(request()).toMatchObject({ state: "claimed", suspended_reason: null });
    expect(wakes()).toHaveLength(1);
  });

  // 接近上限的提醒带着用量，摘要每次都不一样。同一轮预算只提醒一次。
  it("warns once per budget at the soft threshold", () => {
    const { db, child, sibling } = plannedRoot({ tokenBudget: 100, siblings: true });
    db.prepare("UPDATE items SET total_tokens=80 WHERE id=?").run(child);
    const softWarnings = () => listEvents(db, { kind: "inbox.attention" })
      .filter((event) => (event.payload as { inboxKind?: string }).inboxKind === "orchestration_budget");
    const dispatcher = createDispatcher(db, { softBudgetRatio: 0.8 });
    expect(dispatcher.claimNext()?.itemId).toBe(child);
    markInbox(db, listInbox(db).map((row) => row.id), "consumed");
    db.prepare("UPDATE items SET total_tokens=90 WHERE id=?").run(child);
    expect(dispatcher.claimNext()?.itemId).toBe(sibling);
    expect(softWarnings()).toHaveLength(1);
  });
});
