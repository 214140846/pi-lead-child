// 「用户本人发话时免沙箱」开关（protocol 的 host-bypass.ts）。存在 kv 的 lead.host-bypass，一行 JSON：
// { enabled, until, bindingId, enabledAt, reason }。不放 config.json：Lead 本来就写不了它，而且 kv 的改动能走操作层记账。
// 这里只读写库：权限、事件和通知在 engine 的 host-bypass.ts。
// 读的时候按 now 判断：kv 里是开的、但 until 已经过了的，读出来是关（daemon 重启时、定时器还没跑时都一样）。
// 读到的值坏了（手改、截断）时不抛错，按关算。
import { DEFAULT_HOST_BYPASS, type HostBypassDto } from "@pi-lead-child/protocol";
import type { Db } from "./db.js";

export const HOST_BYPASS_KEY = "lead.host-bypass";

// kv 里存的那一份。enabled 是写入时的值，不管到没到点。
export interface StoredHostBypass {
  enabled: boolean;
  until: string | null;
  bindingId: number | null;
  enabledAt: string | null;
  reason: string | null;
}

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

/** kv 里存的原样（整理过）。没有这一行、或者坏了时是关。 */
export function readStoredHostBypass(db: Db): StoredHostBypass {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(HOST_BYPASS_KEY) as { value: string } | undefined;
  let stored: Record<string, unknown> = {};
  if (row) {
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
    } catch {
      stored = {};
    }
  }
  const until = isoOrNull(stored.until);
  return {
    // 开着必须有到点的时间：没有 until 的「开」按关算。
    enabled: stored.enabled === true && until !== null,
    until,
    bindingId: typeof stored.bindingId === "number" && Number.isSafeInteger(stored.bindingId) ? stored.bindingId : null,
    enabledAt: isoOrNull(stored.enabledAt),
    reason: typeof stored.reason === "string" ? stored.reason : null,
  };
}

/** kv 里是开的，但已经到点了：定时器或者重启时的清理要把它置关。 */
export function hostBypassDue(stored: StoredHostBypass, now: Date): boolean {
  return stored.enabled && stored.until !== null && Date.parse(stored.until) <= now.getTime();
}

/** 现在的开关。到点以后读出来是关，到点的时间等字段清空，只留最近一次的原因。 */
export function getHostBypass(db: Db, now: Date): HostBypassDto {
  const stored = readStoredHostBypass(db);
  if (!stored.enabled || hostBypassDue(stored, now)) return { ...DEFAULT_HOST_BYPASS, reason: stored.reason };
  return { enabled: true, until: stored.until, enabledAt: stored.enabledAt, bindingId: stored.bindingId, reason: stored.reason };
}

/** 写入开关（engine 的 enableHostBypass、disableHostBypass、expireHostBypass 调它）。 */
export function writeHostBypass(db: Db, state: StoredHostBypass): void {
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(HOST_BYPASS_KEY, JSON.stringify(state));
}
