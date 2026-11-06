import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync,
  unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeEvent } from "@pi-lead-child/runtime";
import type { Db } from "./db.js";
import { getRun, updateRun } from "./runs.js";

export interface RuntimeEventStore {
  persist(event: RuntimeEvent): { synced: boolean };
  reconcile(runId: number): string;
  readAuditLog(runId: number): RuntimeEvent[];
}

export function countDistinctToolStartedForItem(db: Db, itemId: number): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT events.run_id, json_extract(events.payload, '$.callId') AS call_id
       FROM runtime_events events
       JOIN runs ON runs.id=events.run_id
       WHERE runs.item_id=?
         AND events.event_type='tool.started'
         AND json_valid(events.payload)
         AND json_type(events.payload, '$.callId')='text'
       GROUP BY events.run_id, call_id
     )`,
  ).get(itemId) as { n: number }).n;
}

// 每条事件追加一行，不再 fsync（2026-11-03）：事实在 SQLite 里，这个文件是它的镜像。以前每条事件都 fsync 一次，
// 子 agent 一次运行几百条事件，磁盘忙的时候每次几十毫秒，都在 daemon 的主线程上。写进系统缓存的行在进程崩溃时不会丢，
// 只有整台机器断电才可能丢最后几行；那时文件可以从库里重建（reconcile）。
function appendLine(path: string, line: string): void {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

function durableRewrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(temporary, "w");
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

export function createRuntimeEventStore(
  db: Db,
  // redact：落库和写文件之前对整条事件的 JSON 做的脱敏（engine 盖掉已知密钥的值）。
  options: { dataDir: string; append?: (path: string, line: string) => void; redact?: (payload: string) => string },
): RuntimeEventStore {
  const eventDir = join(options.dataDir, "runtime-events");
  mkdirSync(eventDir, { recursive: true });
  const append = options.append ?? appendLine;
  const pathFor = (runId: number) => join(eventDir, `run-${runId}.jsonl`);

  const reconcile = (runId: number): string => {
    const run = getRun(db, runId);
    if (!run) throw new Error(`run #${runId} not found`);
    const path = run.session_path ?? pathFor(runId);
    const rows = db.prepare(
      "SELECT payload FROM runtime_events WHERE run_id=? ORDER BY seq",
    ).all(runId) as Array<{ payload: string }>;
    durableRewrite(path, rows.map((row) => row.payload).join("\n") + (rows.length ? "\n" : ""));
    updateRun(db, runId, { sessionPath: path, eventLogDirty: false });
    return path;
  };

  return {
    persist(event): { synced: boolean } {
      const path = pathFor(event.runId);
      const payload = options.redact ? options.redact(JSON.stringify(event)) : JSON.stringify(event);
      const inserted = db.transaction(() => {
        const result = db.prepare(
          `INSERT OR IGNORE INTO runtime_events
           (run_id, seq, event_type, payload, occurred_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(event.runId, event.seq, event.type, payload, event.occurredAt);
        if (result.changes) {
          updateRun(db, event.runId, { eventCursor: String(event.seq), eventLogDirty: true, sessionPath: path });
        }
        return result.changes > 0;
      })();
      if (!inserted) {
        const run = getRun(db, event.runId);
        if (run?.event_log_dirty || !existsSync(path)) reconcile(event.runId);
        return { synced: true };
      }
      try {
        append(path, `${payload}\n`);
        updateRun(db, event.runId, { eventLogDirty: false });
        return { synced: true };
      } catch {
        return { synced: false };
      }
    },

    reconcile,

    readAuditLog(runId): RuntimeEvent[] {
      const run = getRun(db, runId);
      if (!run) throw new Error(`run #${runId} not found`);
      let path = run.session_path ?? pathFor(runId);
      if (run.event_log_dirty || !existsSync(path)) path = reconcile(runId);
      const content = readFileSync(path, "utf8").trim();
      if (!content) return [];
      try {
        return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as RuntimeEvent);
      } catch {
        path = reconcile(runId);
        const repaired = readFileSync(path, "utf8").trim();
        return repaired ? repaired.split("\n").filter(Boolean).map((line) => JSON.parse(line) as RuntimeEvent) : [];
      }
    },
  };
}

export interface RunUsage {
  tokens: number;
  costUsd: number;
  // tokens 按计费不同的几部分拆开（ADR 0001，用户 2026-11-06）：未缓存的输入、缓存写、缓存读、输出。
  // 没报缓存的用量（旧事件、不报缓存的 runtime）只知道输出，其余记成 unsplitTokens。几部分加起来等于 tokens。
  uncachedInputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  unsplitTokens: number;
}

// 一个 Run 的用量账。ingest 记 items 的用量和 runTokenUsage 用同一本账（工单 #102，2026-10-21）。
// 按 seq 的顺序喂 run.started 和 usage.updated，其他事件不影响它：
// - delta：新增的用量，加上去。
// - cumulative：这个 runtime 进程到目前的总量。它替换这个进程之前报的全部用量，包括 delta，也可以比上一条小。
// - run.started：一个新的进程，例如过期会话在同一个 Run 里开的新会话。新进程从 0 重新累计，前面进程的用量保留。
// token 的口径见 docs/adr/0001-token-usage.md：输入（含缓存读取和缓存写入）加输出。
export interface RunUsageLedger {
  apply(event: {
    type: string; mode?: unknown; totalTokens?: unknown; costUsd?: unknown;
    inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown;
  }): void;
  total(): RunUsage;
}

const USAGE_PARTS = ["tokens", "costUsd", "uncachedInputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens", "unsplitTokens"] as const;

export function emptyRunUsage(): RunUsage {
  return { tokens: 0, costUsd: 0, uncachedInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, unsplitTokens: 0 };
}

function addRunUsage(left: RunUsage, right: RunUsage): RunUsage {
  const sum = emptyRunUsage();
  for (const key of USAGE_PARTS) sum[key] = left[key] + right[key];
  return sum;
}

export function createRunUsageLedger(): RunUsageLedger {
  let earlier = emptyRunUsage();
  let current = emptyRunUsage();
  const amount = (value: unknown): number => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  // 一条用量事件拆成几部分。报了缓存的：未缓存的输入是 inputTokens 减去缓存两部分；总数里多出来的记成未拆分。
  const partsOf = (event: Parameters<RunUsageLedger["apply"]>[0]): Omit<RunUsage, "costUsd"> => {
    const tokens = amount(event.totalTokens);
    const outputTokens = Math.min(amount(event.outputTokens), tokens);
    const split = typeof event.cacheReadTokens === "number" || typeof event.cacheWriteTokens === "number";
    if (!split) {
      return { tokens, uncachedInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens, unsplitTokens: tokens - outputTokens };
    }
    const cacheReadTokens = amount(event.cacheReadTokens);
    const cacheWriteTokens = amount(event.cacheWriteTokens);
    const uncachedInputTokens = Math.max(0, amount(event.inputTokens) - cacheReadTokens - cacheWriteTokens);
    const known = uncachedInputTokens + cacheWriteTokens + cacheReadTokens + outputTokens;
    return { tokens, uncachedInputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, unsplitTokens: Math.max(0, tokens - known) };
  };
  return {
    apply(event) {
      if (event.type === "run.started") {
        earlier = addRunUsage(earlier, current);
        current = emptyRunUsage();
        return;
      }
      if (event.type !== "usage.updated") return;
      const cost = typeof event.costUsd === "number" ? amount(event.costUsd) : null;
      const parts = partsOf(event);
      if (event.mode === "delta") {
        current = addRunUsage(current, { ...parts, costUsd: cost ?? 0 });
      } else {
        current = { ...parts, costUsd: cost ?? current.costUsd };
      }
    },
    total() {
      return addRunUsage(earlier, current);
    },
  };
}

// 一个 Run 的用量，按 createRunUsageLedger 的规则重放它的事件，和 items 上的记账一样。
// 一条用量都没有时是 null：不知道，不是 0。
export function runUsageBreakdown(db: Db, runId: number): RunUsage | null {
  const rows = db.prepare(
    `SELECT event_type, payload FROM runtime_events
     WHERE run_id = ? AND event_type IN ('run.started', 'usage.updated') AND json_valid(payload)
     ORDER BY seq`,
  ).all(runId) as Array<{ event_type: string; payload: string }>;
  if (!rows.some((row) => row.event_type === "usage.updated")) return null;
  const ledger = createRunUsageLedger();
  for (const row of rows) ledger.apply({ ...JSON.parse(row.payload), type: row.event_type });
  return ledger.total();
}

// 一个 Run 用了多少 token（总数）。工单对话的输入框用它估算续接这个会话的成本（工单 08）。
export function runTokenUsage(db: Db, runId: number): number | null {
  const usage = runUsageBreakdown(db, runId);
  return usage === null ? null : Math.round(usage.tokens);
}

// 一个 Run 实际做了什么，压成几行（Lead 的 read_run_events，2026-10-15）：跑了哪些命令、说了什么、哪里失败。
// 只取事件里的命令和说的话，不取命令输出（输出可能很长，也可能带密钥）。脱敏由调用方做。
export interface RunEventStep {
  seq: number;
  at: string;
  kind: "tool" | "tool_failed" | "message" | "run_failed" | "run_completed";
  text: string;
}

export function listRunEventSteps(
  db: Db, runId: number, opts: { sinceSeq?: number; limit?: number } = {},
): { total: number; steps: RunEventStep[] } {
  const total = (db.prepare("SELECT COUNT(*) AS n FROM runtime_events WHERE run_id=?").get(runId) as { n: number }).n;
  const rows = db.prepare(
    `SELECT seq, event_type, payload, occurred_at FROM runtime_events
     WHERE run_id=? AND seq > ? AND event_type IN ('tool.started','tool.failed','message.completed','run.failed','run.completed')
     ORDER BY seq`,
  ).all(runId, opts.sinceSeq ?? 0) as Array<{ seq: number; event_type: string; payload: string; occurred_at: string }>;
  const steps: RunEventStep[] = [];
  for (const row of rows) {
    const event = JSON.parse(row.payload) as Record<string, any>;
    const clip = (value: unknown, max: number) => {
      const text = String(value ?? "").replace(/\s+/g, " ").trim();
      return text.length > max ? `${text.slice(0, max)}…` : text;
    };
    if (row.event_type === "tool.started") {
      const command = event.args?.command ?? event.args?.cmd ?? null;
      steps.push({ seq: row.seq, at: row.occurred_at, kind: "tool", text: command ? clip(command, 160) : clip(event.name, 80) });
    } else if (row.event_type === "tool.failed") {
      steps.push({ seq: row.seq, at: row.occurred_at, kind: "tool_failed", text: clip(event.error, 160) });
    } else if (row.event_type === "message.completed") {
      if (event.role && event.role !== "assistant") continue;
      steps.push({ seq: row.seq, at: row.occurred_at, kind: "message", text: clip(event.text, 200) });
    } else if (row.event_type === "run.failed") {
      steps.push({ seq: row.seq, at: row.occurred_at, kind: "run_failed", text: clip(event.error, 160) });
    } else {
      steps.push({ seq: row.seq, at: row.occurred_at, kind: "run_completed", text: "" });
    }
  }
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  return { total, steps: steps.slice(-limit) };
}

