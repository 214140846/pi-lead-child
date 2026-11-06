import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { tempDir } from "@pi-lead-child/core/testing";
import { openDb, type Db } from "../src/db.js";
import { createItem } from "../src/items.js";
import { addInbox, addLeadFollowUp, listInbox, markInbox } from "../src/inbox.js";
import { listEvents } from "../src/events.js";

let db: Db;
let itemId: number;
beforeEach(() => {
  db = openDb(join(tempDir("plc-"), "plc.db"));
  itemId = createItem(db, { title: "t", brief: "b", createdBy: "user" });
});

describe("inbox DAO", () => {
  it("adds blocker rows directly", () => {
    const r = addInbox(db, { itemId, severity: "blocker", source: "structural", summary: "crash" });
    expect(r.suppressed).toBe(false);
    expect(listInbox(db, { state: ["pending"] }).length).toBe(1);
  });

  it("debounces attention: merges into existing pending row", () => {
    addInbox(db, { itemId, severity: "attention", source: "structural", summary: "第一次" });
    const r2 = addInbox(db, { itemId, severity: "attention", source: "structural", summary: "第二次" });
    expect(r2.suppressed).toBe(true);
    const rows = listInbox(db, { state: ["pending"], severity: "attention" });
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].payload).merged).toContain("第二次");
  });

  // 2026-10-29 跟进 #395：#159 的预算告警并进了还没到点的跟进行，Lead 11:02 就收到了这条跟进，11:05 到点又收到一次。
  // 跟进是 Lead 给自己定的时间，不是同一张工单上可以合并的说明：别的说明不并进它。
  it("does not merge a notice into a pending follow-up of the same ticket", () => {
    const followUp = addLeadFollowUp(db, { at: new Date(Date.now() + 3_600_000), note: "11:05 看 #159", itemId });
    const result = addInbox(db, { itemId, severity: "attention", source: "structural", summary: "预算告警" });
    expect(result).toEqual({ id: expect.any(Number), suppressed: false });
    expect(result.id).not.toBe(followUp);
    expect(JSON.parse(listInbox(db).find((row) => row.id === followUp)!.payload).merged).toBeUndefined();
  });

  it("fuses after 3 blockers within an hour", () => {
    addInbox(db, { itemId, severity: "blocker", source: "structural", summary: "b1" });
    addInbox(db, { itemId, severity: "blocker", source: "structural", summary: "b2" });
    const r3 = addInbox(db, { itemId, severity: "blocker", source: "structural", summary: "b3" });
    expect(r3.suppressed).toBe(true); // 第 3 条触发熔断，转为聚合通知
    const pending = listInbox(db, { state: ["pending"], severity: "blocker" });
    expect(pending.some((r) => r.summary.includes("异常频繁"))).toBe(true);
    const before = pending.length;
    const r4 = addInbox(db, { itemId, severity: "blocker", source: "structural", summary: "b4" });
    expect(r4.suppressed).toBe(true); // 第 4 条只计数不新增
    expect(listInbox(db, { state: ["pending"], severity: "blocker" }).length).toBe(before);
    // 被熔断吞掉的条数记在聚合通知自己的 payload 上，不再写 items 的冗余计数列
    const fused = listInbox(db, { state: ["pending"], severity: "blocker" })
      .find((r) => r.summary.includes("异常频繁"))!;
    expect(JSON.parse(fused.payload).suppressedCount).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(fused.payload).lastSummary).toBe("b4");
  });

  // #266：熔断行被 Lead 处理掉以后，同一个小时里的下一条 blocker 找不到 pending 的熔断行，又开一行新的熔断，
  // 打开熔断的那一条照常叫醒 Lead。blocker 一直来，熔断就一直叫醒 Lead，等于没有熔断。
  // 时间窗里的熔断行不论处理没处理，后来的都折进它，只加计数，不再叫醒。
  it("keeps folding into the fuse row after Lead has handled it", () => {
    for (const summary of ["b1", "b2", "b3"]) addInbox(db, { itemId, severity: "blocker", source: "structural", summary });
    const fuse = listInbox(db, { severity: "blocker" }).find((row) => row.summary.includes("异常频繁"))!;
    markInbox(db, listInbox(db).map((row) => row.id), "consumed");

    for (const summary of ["b4", "b5", "b6"]) {
      expect(addInbox(db, { itemId, severity: "blocker", source: "structural", summary })).toEqual({ id: fuse.id, suppressed: true });
    }
    expect(listInbox(db, { severity: "blocker" }).filter((row) => row.summary.includes("异常频繁"))).toHaveLength(1);
    expect(JSON.parse(listInbox(db).find((row) => row.id === fuse.id)!.payload)).toMatchObject({ suppressedCount: 4, lastSummary: "b6" });
    const folded = listEvents(db, { kind: "inbox.blocker" })
      .filter((event) => (event.payload as { delivery: string }).delivery === "folded");
    expect(folded.map((event) => (event.payload as { fuseOpened?: boolean }).fuseOpened)).toEqual([true, false, false, false]);
    // 只有打开熔断的那一条按 blocker 交给 Lead（tell），后来折进来的只进摘要（digest）。
    expect(folded.map((event) => event.level)).toEqual(["tell", "digest", "digest", "digest"]);
  });

  it("never merges or fuses a lossless structural blocker", () => {
    for (const summary of ["b1", "b2", "b3"]) {
      addInbox(db, { itemId, severity: "blocker", source: "structural", summary });
    }
    const result = addInbox(db, {
      itemId,
      severity: "blocker",
      source: "structural",
      summary: "terminal handoff failed",
      lossless: true,
    });
    expect(result.suppressed).toBe(false);
    expect(listInbox(db, { state: ["pending"] }).some((row) => (
      row.summary === "terminal handoff failed"
    ))).toBe(true);
  });

  // 不挂事项的行必须能各自去抖：SQLite 里 col = NULL 恒不为真，若仍按 item_id 分组，
  // 这一类新放开的行会既不去抖也不熔断（spec §5.5）。
  it("debounces item-less rows by their own scope", () => {
    addInbox(db, { dedupScope: "sys:watchdog", severity: "attention",
                   source: "structural", summary: "一" });
    const r2 = addInbox(db, { dedupScope: "sys:watchdog", severity: "attention",
                              source: "structural", summary: "二" });
    expect(r2.suppressed).toBe(true);
  });

  it("keeps different scopes independent", () => {
    addInbox(db, { dedupScope: "sys:a", severity: "attention", source: "structural", summary: "一" });
    const r2 = addInbox(db, { dedupScope: "sys:b", severity: "attention",
                              source: "structural", summary: "二" });
    expect(r2.suppressed).toBe(false);
  });

  it("fuses item-less rows by their own scope", () => {
    for (const s of ["b1", "b2"]) {
      addInbox(db, { dedupScope: "sys:watchdog", severity: "blocker", source: "structural", summary: s });
    }
    const r3 = addInbox(db, { dedupScope: "sys:watchdog", severity: "blocker",
                              source: "structural", summary: "b3" });
    expect(r3.suppressed).toBe(true);
    expect(listInbox(db, { state: ["pending"], severity: "blocker" })
      .some((r) => r.summary.includes("异常频繁"))).toBe(true);
  });

  it("refuses a row that names neither an item nor a scope", () => {
    expect(() => addInbox(db, { severity: "attention", source: "structural", summary: "x" }))
      .toThrow(/itemId or dedupScope/);
  });

  it("marks state transitions", () => {
    const { id } = addInbox(db, { itemId, severity: "blocker", source: "semantic", summary: "s" });
    markInbox(db, [id!], "consumed");
    expect(listInbox(db, { state: ["pending"] }).length).toBe(0);
    expect(listInbox(db, { state: ["consumed"] }).length).toBe(1);
  });
});
