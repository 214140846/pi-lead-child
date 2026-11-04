// 外部来源的补拉水位（2026-11-03）：到这个时刻为止，这个来源的消息都收到了。一个来源一行 kv（channel.catch_up.<来源>，ISO 时间）。
// 来源的传输连着时往前推；断线、daemon 重启以后，从这里往后补拉这段时间里的消息。daemon 重启以后还在。
// 从来没记过时是 null：来源第一次启动时只记下现在，不补以前的消息。
import type { Db } from "./db.js";

const keyOf = (source: string) => `channel.catch_up.${source}`;

export function getChannelCatchUpMark(db: Db, source: string): Date | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(keyOf(source)) as { value: string } | undefined;
  if (!row) return null;
  const at = new Date(row.value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** 记下水位。时间不合法时抛错。 */
export function setChannelCatchUpMark(db: Db, source: string, at: Date): void {
  if (Number.isNaN(at.getTime())) throw new Error(`not a valid catch-up mark for ${source}`);
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(keyOf(source), at.toISOString());
}
