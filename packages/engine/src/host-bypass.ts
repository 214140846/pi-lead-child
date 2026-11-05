// 「用户本人发话时免沙箱」开关（docs/ticket-246-user-turn-bypass.md 第 5 节，实施单 A）：开、关、到点。
// 开和关的入口是操作层的 host_bypass（ui-actions/host-bypass.ts）：设置页和 Lead 的 perform_action 调同一个定义，权限在那里判断。
// 到点由 daemon 的定时器调 expireHostBypassIfDue；daemon 启动时也调一次，until 已经过了的直接置关。
// 每一次开、关、到点：写 kv，同一笔事务里写一条事件（5.5），然后发 snapshot.required 让界面刷新，再写一条 inbox 告诉 Lead。
import {
  DEFAULT_HOST_BYPASS, HOST_BYPASS_DISABLED_KIND, HOST_BYPASS_ENABLED_KIND, HOST_BYPASS_ENTITY_KEY, HOST_BYPASS_EXPIRED_KIND,
  HOST_BYPASS_RESOURCE,
  type HostBypassDisabledBy, type HostBypassDto, type HostBypassMinutes,
} from "@pi-lead-child/protocol";
import {
  addInbox, appendEvent, getHostBypass, hostBypassDue, publishGatewayEvent, readStoredHostBypass, writeHostBypass, type Db,
} from "@pi-lead-child/store";

// 用户自己去哪里打开。Lead 调 enable 被拒时，拒绝里写它。
export const HOST_BYPASS_WHERE = "设置 → 免沙箱（用户本人发话时免沙箱）";

export interface HostBypassChange {
  hostBypass: HostBypassDto;
  // 这次有没有改：关着时再关一次不算。
  changed: boolean;
}

function announce(db: Db, summary: string, state: "enabled" | "disabled" | "expired", wakeLead: boolean): void {
  publishGatewayEvent(db, { type: "snapshot.required", requiredScope: "tickets:view", payload: { resource: HOST_BYPASS_RESOURCE } });
  addInbox(db, {
    dedupScope: HOST_BYPASS_ENTITY_KEY, severity: "attention", source: "structural", lossless: true, summary,
    payload: { kind: "host_bypass", state, wakeLead, needsUser: false },
  });
}

// inbox 里的时间按 daemon 所在机器的本地时间写「HH:MM」。
function clock(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** 打开免沙箱：按新的时长从现在重算 until，不累加。授权已经由操作层做过。 */
export function enableHostBypass(db: Db, input: {
  minutes: HostBypassMinutes; bindingId: number | null; resolvedBy: string; reason: string; now: Date;
}): HostBypassChange {
  const enabledAt = input.now.toISOString();
  const until = new Date(input.now.getTime() + input.minutes * 60_000).toISOString();
  db.transaction(() => {
    writeHostBypass(db, { enabled: true, until, bindingId: input.bindingId, enabledAt, reason: input.reason });
    appendEvent(db, {
      source: "system", kind: HOST_BYPASS_ENABLED_KIND, entityKey: HOST_BYPASS_ENTITY_KEY, level: "record",
      payload: { until, minutes: input.minutes, bindingId: input.bindingId, resolvedBy: input.resolvedBy },
      occurredAt: enabledAt,
    });
  })();
  announce(db, `用户在设置页打开了「用户本人发话时免沙箱」，${input.minutes} 分钟，${clock(until)} 自动关。`, "enabled", true);
  return { hostBypass: getHostBypass(db, input.now), changed: true };
}

/**
 * 关掉免沙箱。已经关着时什么也不写（changed=false）。kv 里开着、但已经到点的，按到点处理（写 host_bypass.expired）。
 * Lead 自己关的不叫醒 Lead：它从工具结果里已经知道了。
 */
export function disableHostBypass(db: Db, input: {
  by: HostBypassDisabledBy; turnId: string | null; reason: string; now: Date;
}): HostBypassChange {
  if (expireHostBypassIfDue(db, input.now)) return { hostBypass: getHostBypass(db, input.now), changed: false };
  const changed = db.transaction((): boolean => {
    const stored = readStoredHostBypass(db);
    if (!stored.enabled) return false;
    writeHostBypass(db, { ...DEFAULT_HOST_BYPASS, enabled: false, reason: input.reason });
    appendEvent(db, {
      source: "system", kind: HOST_BYPASS_DISABLED_KIND, entityKey: HOST_BYPASS_ENTITY_KEY, level: "record",
      payload: { by: input.by, turnId: input.turnId, reason: input.reason },
      occurredAt: input.now.toISOString(),
    });
    return true;
  })();
  if (changed) {
    announce(
      db,
      input.by === "user" ? "用户关掉了「用户本人发话时免沙箱」。" : "你关掉了「用户本人发话时免沙箱」。",
      "disabled", input.by === "user",
    );
  }
  return { hostBypass: getHostBypass(db, input.now), changed };
}

/** 到点了就置关，写 host_bypass.expired。返回这次有没有置关。daemon 的定时器和启动时的清理调它。 */
export function expireHostBypassIfDue(db: Db, now: Date): boolean {
  const until = db.transaction((): string | null => {
    const stored = readStoredHostBypass(db);
    if (!hostBypassDue(stored, now)) return null;
    writeHostBypass(db, { ...DEFAULT_HOST_BYPASS, enabled: false, reason: "到点自动关" });
    appendEvent(db, {
      source: "system", kind: HOST_BYPASS_EXPIRED_KIND, entityKey: HOST_BYPASS_ENTITY_KEY, level: "record",
      payload: { until: stored.until }, occurredAt: now.toISOString(),
    });
    return stored.until;
  })();
  if (until === null) return false;
  announce(db, `「用户本人发话时免沙箱」到点自动关了（${clock(until)}）。`, "expired", true);
  return true;
}
