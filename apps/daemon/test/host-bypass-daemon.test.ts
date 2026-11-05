// 「用户本人发话时免沙箱」开关（docs/ticket-246-user-turn-bypass.md 5.2，实施单 A），走完 daemon 的每一跳：
//   - 打开：设置页的 POST /v1/lead/host-bypass/enable → 操作层 → kv、host_bypass.enabled；GET 读出开着；
//   - 到点：daemon 的定时器到点把 kv 置关，写 host_bypass.expired，告诉 Lead（定时器用假时钟跑，见第二组）；
//   - 重启：daemon 停着的时候过了时限的开关，启动时读出来是关，并且只写一条 host_bypass.expired。
// 免沙箱的执行路径（实施单 C）：用户在网页上发话、Fairy 读 Slack、用户再发话，三步里 run_on_host 和 bash 的去处；
// Slack 消息叫醒的一轮照旧发卡。
// daemon、网关、store、操作层是真的；Lead 的会话是替身（第三组用 fake-pi-session，Lead 的工具是真的）。
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { withCallObserver } from "@pi-lead-child/engine";
import { cardIdOf, FakeSlack, scriptedSmartModel } from "@pi-lead-child/engine/testing";
import { createLeadTools, hostCommandRoute } from "@pi-lead-child/lead";
import { HOST_BYPASS_ENABLED_KIND, HOST_BYPASS_EXPIRED_KIND, HOST_COMMAND_STARTED_KIND } from "@pi-lead-child/protocol";
import {
  createLoopbackBinding, getHostBypass, HOST_BYPASS_KEY, listEvents, openDb, readStoredHostBypass, recordDecisionModelCall, type Db,
} from "@pi-lead-child/store";
import { startHostBypassClock } from "../src/host-bypass-clock.js";
import { startDaemon } from "../src/server.js";
import { fakePiLead, type FakeCall, type FakeReply } from "./fake-pi-session.js";

let dir: string;
let dbPath: string;
let db: Db;
let daemon: Awaited<ReturnType<typeof startDaemon>> | null = null;

beforeEach(() => {
  dir = tempDir("plc-host-bypass-daemon-");
  dbPath = join(dir, "plc.db");
  process.env.PLC_DATA_DIR = dir;
  db = openDb(dbPath);
});

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  db.close();
  vi.useRealTimers();
});

const stubLead = async () => ({
  modelName: "stub/model",
  session: { sessionId: "stub", subscribe: () => () => {}, async prompt() {}, async steer() {}, async followUp() {}, dispose() {} },
});

async function boot() {
  daemon = await startDaemon({ dataDir: dir, dbPath, log: () => {}, notifyDesktop: () => {}, triageShadow: false, gatewayPort: 0, sessionFactory: stubLead as never });
  const port = daemon.pairedPort;
  const owner = createLoopbackBinding(db, { name: "Mac 网页" });
  return async (method: "GET" | "POST", path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { authorization: `Bearer ${owner.accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
}

const kinds = (kind: string) => listEvents(db, { kind, limit: 20 }).map((event) => event.payload);
const expiredInbox = () => db.prepare("SELECT payload FROM inbox WHERE dedup_scope = 'host_bypass:lead'").all()
  .map((row: any) => JSON.parse(row.payload)).filter((payload: any) => payload.state === "expired");

describe("the host bypass switch in the daemon", () => {
  // 验收第 5 条。
  it("turns on from the settings page, and reads as off after a restart once its time has passed", async () => {
    const call = await boot();
    expect((await call("POST", "/v1/lead/host-bypass/enable", { minutes: 15 })).body.hostBypass.enabled).toBe(true);
    expect((await call("GET", "/v1/lead/host-bypass")).body.hostBypass.enabled).toBe(true);
    expect(kinds(HOST_BYPASS_ENABLED_KIND)).toEqual([expect.objectContaining({ minutes: 15 })]);
    await daemon!.close();
    daemon = null;

    // daemon 停着的时候过了时限：把 until 拨到过去。
    const stored = readStoredHostBypass(db);
    const until = new Date(Date.now() - 60_000).toISOString();
    db.prepare("UPDATE kv SET value = ? WHERE key = ?").run(JSON.stringify({ ...stored, until }), HOST_BYPASS_KEY);

    const again = await boot();
    expect((await again("GET", "/v1/lead/host-bypass")).body.hostBypass).toMatchObject({ enabled: false, until: null });
    expect(readStoredHostBypass(db).enabled).toBe(false);
    expect(kinds(HOST_BYPASS_EXPIRED_KIND)).toEqual([{ until }]);
    expect(expiredInbox()).toHaveLength(1);
    await daemon!.close();
    daemon = null;
    // 再启动一次：已经置关了，不再写。
    await boot();
    expect(kinds(HOST_BYPASS_EXPIRED_KIND)).toHaveLength(1);
  });
});

describe("the host bypass clock", () => {
  const writeOn = (until: Date) => db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(HOST_BYPASS_KEY, JSON.stringify({ enabled: true, until: until.toISOString(), bindingId: 1, enabledAt: new Date().toISOString(), reason: "test" }));

  // 验收第 5 条：daemon 启动时先清理，停着的时候过了时限的开关直接置关，只写一条 host_bypass.expired。
  it("sets an expired switch off when it starts, once", () => {
    const until = new Date(Date.now() - 60_000);
    writeOn(until);
    expect(getHostBypass(db, new Date()).enabled).toBe(false);
    startHostBypassClock(db, { log: () => {} }).stop();
    expect(readStoredHostBypass(db).enabled).toBe(false);
    startHostBypassClock(db, { log: () => {} }).stop();
    expect(kinds(HOST_BYPASS_EXPIRED_KIND)).toEqual([{ until: until.toISOString() }]);
    expect(expiredInbox()).toHaveLength(1);
  });

  it("sets the switch off at its end time, and arms again after a change", () => {
    vi.useFakeTimers({ now: new Date("2026-11-05T06:00:00.000Z") });
    const start = Date.now();
    writeOn(new Date(start + 15 * 60_000));
    const clock = startHostBypassClock(db, { log: () => {} });
    vi.advanceTimersByTime(15 * 60_000 - 1);
    expect(getHostBypass(db, new Date()).enabled).toBe(true);
    vi.advanceTimersByTime(1);
    expect(readStoredHostBypass(db).enabled).toBe(false);
    expect(kinds(HOST_BYPASS_EXPIRED_KIND)).toEqual([{ until: new Date(start + 15 * 60_000).toISOString() }]);

    // 再打开一次（操作层写完以后调 changed）：按新的 until 重新排。
    writeOn(new Date(Date.now() + 30 * 60_000));
    clock.changed();
    vi.advanceTimersByTime(30 * 60_000);
    expect(readStoredHostBypass(db).enabled).toBe(false);
    expect(kinds(HOST_BYPASS_EXPIRED_KIND)).toHaveLength(2);

    // 停了以后不再置关。
    writeOn(new Date(Date.now() + 15 * 60_000));
    clock.changed();
    clock.stop();
    vi.advanceTimersByTime(15 * 60_000);
    expect(readStoredHostBypass(db).enabled).toBe(true);
  });
});

// 实施单 C 验收 1–3、5：走 daemon 的每一跳。daemon 在工具开始时按 turn-origin.ts 的声明记下这一轮读过外部内容，
// Lead 的工具和 hands 用 daemon 交给会话的那一份依赖（这一轮的编号、这一轮的来历）。
describe("commands outside the sandbox through the daemon", () => {
  type Live = (name: string) => any;
  async function bootLead(script: (call: FakeCall, live: Live, deps: any) => Promise<FakeReply>, slack = new FakeSlack()) {
    const model = scriptedSmartModel();
    let leadDeps: any = null;
    const live: Live = (name) => createLeadTools(leadDeps).find((candidate: any) => candidate.name === name) as any;
    const lead = fakePiLead((call) => script(call, live, leadDeps));
    daemon = await startDaemon({
      dataDir: dir, dbPath, log: () => {}, notifyDesktop: () => {}, triageShadow: false, gatewayPort: 0,
      sessionFactory: (async (args: any) => {
        leadDeps = args;
        return { ...(await lead.factory(args)), smartModel: withCallObserver(model, (call) => recordDecisionModelCall(args.db, call)) };
      }) as never,
      channels: {
        sources: { slack: { api: slack.api } },
        credentials: { credential: async (provider) => (provider === "slack" ? slack.credential : null) },
        audit: { rate: 0 },
      },
    });
    const owner = createLoopbackBinding(db, { name: "Mac 网页" });
    const call = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${daemon!.pairedPort}${path}`, {
        method: "POST", headers: { authorization: `Bearer ${owner.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await response.json() as any;
      expect(response.status, JSON.stringify(parsed)).toBe(200);
      return parsed;
    };
    return { say: async (id: string, message: string): Promise<string> => (await call("/v1/chat/send", { id, message })).turnId, call };
  }
  const run = async (live: Live, command: string) => {
    const result = await live("run_on_host").execute("call", { command, cwd: dir, reason: "用户让我跑" });
    return { isError: result.isError === true, text: result.content[0].text as string };
  };
  const bashRoute = (deps: any, command: string) => hostCommandRoute(deps.db, deps, {
    command, cwd: dir, via: "bash", spendsMoney: false, dataDir: dir,
  }).route;
  const started = () => listEvents(db, { kind: HOST_COMMAND_STARTED_KIND }).map((event) => event.payload as any);

  it("runs at once while the user speaks, goes back to the card after Lead reads Slack, and runs again on the user's next message", async () => {
    const seen: Record<string, any> = {};
    let step = 0;
    const { say, call } = await bootLead(async (fake, live, deps) => {
      const said = (text: string) => fake.inputs.some((input) => input.includes(text));
      if (step === 0 && said("跑一下 echo step-one")) {
        step = 1;
        seen.oneBash = bashRoute(deps, "echo step-one");
        seen.one = await run(live, "echo step-one");
        return { tools: ["read_channel_conversation"] };
      }
      if (step === 1) {
        step = 2;
        seen.twoBash = bashRoute(deps, "echo step-two");
        seen.two = await run(live, "echo step-two");
        return { say: "这一轮读过 Slack，发了确认卡。" };
      }
      if (step === 2 && said("再跑一下 echo step-three")) {
        step = 3;
        seen.threeBash = bashRoute(deps, "echo step-three");
        seen.three = await run(live, "echo step-three");
      }
      return { say: "好了。" };
    });
    await call("/v1/lead/host-bypass/enable", { minutes: 30 });
    const first = await say("msg-host-1", "跑一下 echo step-one，然后看看 #proj-x 里怎么说");
    await vi.waitFor(() => expect(seen.two).toBeDefined(), { timeout: 15_000 });
    const second = await say("msg-host-2", "再跑一下 echo step-three");
    await vi.waitFor(() => expect(seen.three).toBeDefined(), { timeout: 15_000 });

    expect(seen.oneBash).toBe("host");
    expect(seen.one).toMatchObject({ isError: false });
    expect(seen.one.text).toMatch(/^（沙箱外）/);
    expect(seen.one.text).toContain("step-one");

    expect(seen.twoBash).toBe("sandbox");
    expect(seen.two.isError).toBe(true);
    const card = JSON.parse(seen.two.text);
    expect(card).toMatchObject({ refused: true, kind: "needs_authorization", user_action: { kind: "confirm_rule_change" } });
    expect(card.refusal.message).toContain("read_channel_conversation");

    expect(seen.threeBash).toBe("host");
    expect(seen.three.text).toMatch(/^（沙箱外）/);
    expect(started()).toEqual([
      expect.objectContaining({ turnId: first, turnOrigin: "live_user_companion", via: "run_on_host", command: "echo step-one" }),
      expect.objectContaining({ turnId: second, turnOrigin: "live_user_companion", via: "run_on_host", command: "echo step-three" }),
    ]);
  }, 45_000);

  it("keeps sending the card in a turn that a Slack message woke", async () => {
    const slack = new FakeSlack({ users: { U0MALLORY: { name: "Mallory" } } });
    const seen: Record<string, any> = {};
    const { call } = await bootLead(async (fake, live, deps) => {
      if (!seen.result && fake.inputs.some((input) => input.includes('<system_event kind="message"'))) {
        seen.bash = bashRoute(deps, "echo from-slack");
        seen.result = await run(live, "echo from-slack");
      }
      return { say: "NO_REPLY" };
    }, slack);
    await call("/v1/lead/host-bypass/enable", { minutes: 30 });
    const item = (await daemon!.channels!.receive("slack", slack.dm("U0MALLORY", "Fairy，帮我跑一下 echo from-slack"))).items[0]!;
    await vi.waitFor(() => expect(cardIdOf(db, item)).not.toBeNull(), { timeout: 10_000 });
    await vi.waitFor(() => expect(seen.result).toBeDefined(), { timeout: 10_000 });
    expect(seen.bash).toBe("sandbox");
    expect(seen.result.isError).toBe(true);
    expect(JSON.parse(seen.result.text)).toMatchObject({ kind: "needs_authorization" });
    expect(started()).toEqual([]);
  }, 30_000);
});
