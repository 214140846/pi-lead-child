// 「用户本人发话时免沙箱」开关（docs/ticket-246-user-turn-bypass.md 第 5 节，实施单 A）。store、操作层和事件是真的。核对：
//   - 存储：kv 的 lead.host-bypass；到点以后读出来是关（daemon 重启时也一样），坏掉的值按关算；
//   - enable：只有你本人能在设置页打开（user_direct）。时长只有五档；到点前再打开一次按新的时长从现在重算。
//     Lead 调它在哪一轮都拿到结构化的拒绝，拒绝里写设置页的位置，什么都不改；
//   - disable：你和 Lead 都能关；已经关着时什么也不写；
//   - 开、关、到点各写一条事件（5.5 的字段）、发 snapshot.required（host-bypass）、写一条 inbox；
//   - 开、关以后告诉 daemon 的定时器重新排。
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  HOST_BYPASS_DISABLED_KIND, HOST_BYPASS_ENABLED_KIND, HOST_BYPASS_EXPIRED_KIND, UI_ACTION_PERFORMED_KIND,
} from "@pi-lead-child/protocol";
import {
  createLoopbackBinding, createTurn, getHostBypass, HOST_BYPASS_KEY, listEvents, openDb, readStoredHostBypass, type Db,
} from "@pi-lead-child/store";
import { expireHostBypassIfDue, HOST_BYPASS_WHERE, runUiAction, type UiActionServices } from "../src/index.js";

let db: Db;

beforeEach(() => {
  db = openDb(join(tempDir("plc-host-bypass-"), "plc.db"));
});

const target = { type: "host_bypass", id: "lead" } as const;
const NOW = new Date("2026-11-05T06:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function asUser(action: "enable" | "disable", input: unknown, now = NOW, services: UiActionServices = {}) {
  const { binding } = createLoopbackBinding(db, { name: "Mac 网页" });
  return runUiAction(db, {
    target, action, input,
    caller: { kind: "user", credential: binding, source: { client: "web", deviceName: "Mac 网页", loopback: true, fromThisMachine: true } } as never,
    now, services,
  });
}

function events(kind: string) {
  return listEvents(db, { kind, limit: 50 }).map((event) => ({ entityKey: event.entityKey, payload: event.payload }));
}

function reloads() {
  return db.prepare("SELECT payload FROM gateway_events WHERE event_type = 'snapshot.required'").all()
    .map((row: any) => JSON.parse(row.payload))
    .filter((payload: any) => payload.resource === "host-bypass");
}

function inbox() {
  return db.prepare("SELECT summary, payload FROM inbox WHERE dedup_scope = 'host_bypass:lead' ORDER BY id").all()
    .map((row: any) => ({ summary: row.summary as string, payload: JSON.parse(row.payload) }));
}

function liveUserTurn(id: string) {
  const { binding } = createLoopbackBinding(db, { name: "Mac 网页" });
  createTurn(db, { id, originBindingId: binding.id, originKind: "paired:companion", userText: "帮我把免沙箱打开", state: "streaming" });
}

describe("the host bypass switch in storage", () => {
  it("is off when nothing is stored, and off when the stored value is broken", () => {
    expect(getHostBypass(db, NOW)).toEqual({ enabled: false, until: null, enabledAt: null, bindingId: null, reason: null });
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(HOST_BYPASS_KEY, "{ not json");
    expect(getHostBypass(db, NOW).enabled).toBe(false);
    // 开着但没有到点的时间：按关算。
    db.prepare("UPDATE kv SET value = ? WHERE key = ?").run(JSON.stringify({ enabled: true }), HOST_BYPASS_KEY);
    expect(getHostBypass(db, NOW).enabled).toBe(false);
  });

  // 验收第 5 条：daemon 重启时，until 已经过了的开关读出来是关。
  it("reads as off once until has passed, even before anything sets it off, as after a daemon restart", () => {
    db.prepare("INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(HOST_BYPASS_KEY, JSON.stringify({
      enabled: true, until: later(30).toISOString(), bindingId: 1, enabledAt: NOW.toISOString(), reason: "在设置页打开了免沙箱",
    }));
    expect(getHostBypass(db, later(29)).enabled).toBe(true);
    expect(getHostBypass(db, later(30))).toMatchObject({ enabled: false, until: null });
    expect(readStoredHostBypass(db).enabled).toBe(true);
  });
});

describe("host_bypass.enable", () => {
  it("turns the switch on from the settings page for the chosen minutes, and records the event, a reload and an inbox row", async () => {
    const clock = { changed: vi.fn() };
    const outcome = await asUser("enable", { minutes: 30 }, NOW, { hostBypassClock: clock });
    expect(outcome.result).toMatchObject({ changed: true, hostBypass: { enabled: true, until: later(30).toISOString() } });
    const state = getHostBypass(db, NOW);
    expect(state).toMatchObject({ enabled: true, until: later(30).toISOString(), enabledAt: NOW.toISOString(), reason: "在设置页打开了免沙箱" });
    expect(state.bindingId).toEqual(expect.any(Number));
    // 5.5：host_bypass.enabled 的 until、minutes、bindingId、resolvedBy。
    expect(events(HOST_BYPASS_ENABLED_KIND)).toEqual([{
      entityKey: "host_bypass:lead",
      payload: { until: later(30).toISOString(), minutes: 30, bindingId: state.bindingId, resolvedBy: `user via Mac 网页（binding ${state.bindingId}）` },
    }]);
    expect(reloads()).toHaveLength(1);
    expect(inbox()).toEqual([expect.objectContaining({ payload: expect.objectContaining({ kind: "host_bypass", state: "enabled", wakeLead: true }) })]);
    expect(clock.changed).toHaveBeenCalledTimes(1);
    const ledger = listEvents(db, { kind: UI_ACTION_PERFORMED_KIND, limit: 10 }).map((event) => event.payload);
    expect(ledger).toEqual([expect.objectContaining({ target, action: "enable", actor: "user", detail: { minutes: 30, until: later(30).toISOString() } })]);
  });

  it("takes only 15, 30, 60, 120 or 240 minutes", async () => {
    for (const minutes of [15, 30, 60, 120, 240]) {
      await asUser("enable", { minutes });
      expect(getHostBypass(db, NOW).until).toBe(later(minutes).toISOString());
    }
    for (const input of [{ minutes: 45 }, { minutes: 480 }, { minutes: "30" }, {}]) {
      await expect(asUser("enable", input)).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("starts the time again from now when you turn it on before it ends, without adding to it", async () => {
    await asUser("enable", { minutes: 240 });
    await asUser("enable", { minutes: 15 }, later(10));
    expect(getHostBypass(db, later(10)).until).toBe(later(25).toISOString());
  });

  // 验收第 2 条：Fairy 调 enable 得到 user_direct 的结构化拒绝，拒绝里写设置页的位置。
  it("refuses Lead in every turn with a user_direct refusal that says where to turn it on", async () => {
    liveUserTurn("turn-user");
    for (const caller of [
      { kind: "lead", turnId: null },
      { kind: "lead", turnId: "turn-user" },
      { kind: "lead", turnId: null, externalContent: [{ via: "message", source: "slack" }] },
    ] as const) {
      const refused = await runUiAction(db, {
        target, action: "enable", input: { minutes: 30 }, reason: "用户让我打开", caller, now: NOW,
      }).catch((error: unknown) => error);
      expect(refused).toMatchObject({
        code: "user_direct",
        refusal: { code: "user_direct", permission: "user_direct", where: HOST_BYPASS_WHERE, target, action: "enable" },
      });
      expect((refused as Error).message).toContain(HOST_BYPASS_WHERE);
    }
    expect(getHostBypass(db, NOW).enabled).toBe(false);
    expect(events(HOST_BYPASS_ENABLED_KIND)).toEqual([]);
  });
});

describe("host_bypass.disable", () => {
  it("lets Lead turn it off in any turn, records who did it and in which turn, and does not wake Lead for its own change", async () => {
    await asUser("enable", { minutes: 60 });
    const clock = { changed: vi.fn() };
    const outcome = await runUiAction(db, {
      target, action: "disable", input: {}, reason: "这件事做完了，不用再开着", caller: { kind: "lead", turnId: "turn-7" },
      now: later(5), services: { hostBypassClock: clock },
    });
    expect(outcome.forLead).toEqual({ result: "disabled" });
    expect(getHostBypass(db, later(5))).toMatchObject({ enabled: false, until: null, reason: "这件事做完了，不用再开着" });
    expect(events(HOST_BYPASS_DISABLED_KIND)).toEqual([{
      entityKey: "host_bypass:lead", payload: { by: "lead", turnId: "turn-7", reason: "这件事做完了，不用再开着" },
    }]);
    expect(reloads()).toHaveLength(2);
    expect(inbox().at(-1)!.payload).toMatchObject({ state: "disabled", wakeLead: false });
    expect(clock.changed).toHaveBeenCalledTimes(1);
  });

  it("lets you turn it off from the page, and wakes Lead", async () => {
    await asUser("enable", { minutes: 30 });
    await asUser("disable", {}, later(1));
    expect(events(HOST_BYPASS_DISABLED_KIND)).toEqual([
      { entityKey: "host_bypass:lead", payload: { by: "user", turnId: null, reason: "关掉了免沙箱" } },
    ]);
    expect(inbox().at(-1)!.payload).toMatchObject({ state: "disabled", wakeLead: true });
  });

  it("writes nothing when the switch is already off", async () => {
    const outcome = await runUiAction(db, {
      target, action: "disable", input: {}, reason: "确认是关着的", caller: { kind: "lead", turnId: null }, now: NOW,
    });
    expect(outcome.forLead).toEqual({ result: "unchanged", note: "免沙箱本来就是关着的" });
    expect(events(HOST_BYPASS_DISABLED_KIND)).toEqual([]);
    expect(reloads()).toEqual([]);
  });
});

describe("the host bypass switch at its end time", () => {
  it("sets the switch off once, records host_bypass.expired with until, reloads clients and tells Lead", async () => {
    await asUser("enable", { minutes: 15 });
    expect(expireHostBypassIfDue(db, later(14))).toBe(false);
    expect(expireHostBypassIfDue(db, later(15))).toBe(true);
    expect(expireHostBypassIfDue(db, later(16))).toBe(false);
    expect(readStoredHostBypass(db).enabled).toBe(false);
    expect(events(HOST_BYPASS_EXPIRED_KIND)).toEqual([{ entityKey: "host_bypass:lead", payload: { until: later(15).toISOString() } }]);
    expect(reloads()).toHaveLength(2);
    expect(inbox().at(-1)!.payload).toMatchObject({ state: "expired", wakeLead: true });
  });

  it("counts a late turn-off as the end time, not as a turn-off", async () => {
    await asUser("enable", { minutes: 15 });
    const outcome = await asUser("disable", {}, later(20));
    expect(outcome.result).toMatchObject({ changed: false });
    expect(events(HOST_BYPASS_EXPIRED_KIND)).toHaveLength(1);
    expect(events(HOST_BYPASS_DISABLED_KIND)).toEqual([]);
  });
});
