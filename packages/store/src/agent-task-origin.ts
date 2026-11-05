// 这张工单是不是外部消息派的（工单 #246 设计第 6 节、实施单 E）：派单器（apps/daemon 的 agent-tasks.ts）开工单的那笔事务里
// 记一条 kind=decision、actor=system 的活动，payload.decision 是 AGENT_TASK_STARTED，带着来源、发起人和通道卡。
// 只认这条活动，不认 run_grants：用户本人要的 PR 评审也有权限清单，但它不是外部起因。
// 外部起因的执行要的审批只有用户本人能批（engine 的 approval.resolve 和 coordinator 的 resolveApproval 都用它）。
import { AGENT_TASK_STARTED } from "@pi-lead-child/protocol";
import type { Db } from "./db.js";

export interface ExternalTaskOrigin {
  // 来源，例如 slack。
  source: string;
  // 发起人（派单时 Lead 写的结构化说明，不是原话）。
  requester: string;
  // 来源里的引用，例如 card:<编号>。没有时为 null。
  ref: string | null;
}

/** 工单的外部起因。不是外部消息派的工单返回 null。 */
export function externalTaskOriginOf(db: Db, itemId: number): ExternalTaskOrigin | null {
  const row = db.prepare(
    `SELECT json_extract(payload, '$.source') AS source, json_extract(payload, '$.requester') AS requester,
            json_extract(payload, '$.ref') AS ref
       FROM activities
      WHERE item_id = ? AND kind = 'decision' AND actor = 'system' AND json_valid(payload)
        AND json_extract(payload, '$.decision') = ?
      ORDER BY id LIMIT 1`,
  ).get(itemId, AGENT_TASK_STARTED) as { source: unknown; requester: unknown; ref: unknown } | undefined;
  if (!row) return null;
  return {
    source: typeof row.source === "string" && row.source ? row.source : "外部消息",
    requester: typeof row.requester === "string" && row.requester ? row.requester : "对方",
    ref: typeof row.ref === "string" && row.ref ? row.ref : null,
  };
}
