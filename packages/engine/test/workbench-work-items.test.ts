import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { createItem, openDb, type Db } from "@pi-lead-child/store";
import type { KernelInterventionRef } from "@pi-lead-child/protocol";
import { createWorkbenchDomainService } from "../src/coordinator/workbench.js";
import type { InterventionDomainService } from "../src/coordinator/interventions.js";

let db: Db;

beforeEach(() => {
  db = openDb(join(tempDir("plc-workbench-"), "plc.db"));
});

// 2026-11-03：列表给每张工单各查一遍全部介入（工单数 × 决策数次查询），202 张工单时一次列表占住 daemon 主线程好几秒。
describe("work item lists", () => {
  it("lists the interventions once per list and counts the pending ones per ticket", () => {
    const first = createItem(db, { title: "first", brief: "b", createdBy: "user" });
    const second = createItem(db, { title: "second", brief: "b", createdBy: "user" });
    const third = createItem(db, { title: "third", brief: "b", createdBy: "user" });
    const queries: unknown[] = [];
    const refs = [
      { id: "decision:1", ticketId: first, state: "pending" },
      { id: "decision:2", ticketId: first, state: "pending" },
      { id: "approval:1", ticketId: second, state: "pending" },
      { id: "decision:3", ticketId: third, state: "resolved" },
    ] as unknown as KernelInterventionRef[];
    const interventions = {
      listInterventionRefs(query?: { itemId?: number; state?: string }) {
        queries.push(query);
        return refs.filter((ref) => (query?.itemId === undefined || ref.ticketId === query.itemId)
          && (query?.state === undefined || ref.state === query.state));
      },
    } as unknown as InterventionDomainService;
    const workbench = createWorkbenchDomainService({ db, interventions });

    const counts = (items: Array<{ ticketId: number; pendingInterventionCount: number }>) =>
      Object.fromEntries(items.map((item) => [item.ticketId, item.pendingInterventionCount]));
    expect(counts(workbench.listTicketWorkItemsV2())).toEqual({ [first]: 2, [second]: 1, [third]: 0 });
    expect(queries).toHaveLength(1);

    queries.length = 0;
    expect(counts(workbench.listTicketWorkItems({ itemIds: [first, third] }))).toEqual({ [first]: 2, [third]: 0 });
    expect(queries).toHaveLength(1);
  });
});
