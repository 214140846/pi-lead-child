// 桌面通知的出口。没有客户端连着时，daemon 弹系统通知：Bytezard Lead 的 App 订阅了就交给 App，否则用 osascript
// （docs/desktop/macos-desktop-design.md 第 8.6 节，P0-7）。通知标题是用户配置的 Lead 名字。
// 测试起的是真实 daemon。以前每跑一次测试，用户桌面上都会弹出真实的 blocker 通知。
// 根 vitest 配置设置 PLC_DESKTOP_NOTIFY=off，让测试里的 daemon 不弹通知。
import { readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { startDaemon } from "../src/server.js";
import { openDb, type Db } from "@pi-lead-child/store";
import { addNotification, getNotification, writeLeadProfile } from "@pi-lead-child/store";
import { OSASCRIPT_NOTIFY_ARGS } from "../src/desktop-notifier.js";

// 这个文件里的 osascript 调用只记录，不执行，所以红的时候也不会弹通知。其他命令照常执行。
const osascript = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFile = (file: string, ...rest: unknown[]) => {
    if (file === "osascript") {
      osascript.calls.push(rest[0] as string[]);
      return undefined;
    }
    return (actual.execFile as (...args: unknown[]) => unknown)(file, ...rest);
  };
  return { ...actual, execFile };
});

let dir: string;
let dbPath: string;
let db: Db;
beforeEach(() => {
  dir = tempDir("plc-desktop-");
  vi.stubEnv("PLC_DATA_DIR", dir);
  vi.stubEnv("PLC_NOTICE_POLL_MS", "20");
  dbPath = join(dir, "plc.db");
  db = openDb(dbPath);
  osascript.calls.length = 0;
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

// Lead 用 notify_user 写的一条通知，没有客户端连着：daemon 马上推到桌面。
// 2026-10-15 起（Jarvis 模式）blocker 先交给 Lead，桌面通知只在 Lead 决定推、或者 Lead 不能工作时才弹。
let noticeId = 0;
function seedLeadNotice(summary = "Claude Code 需要你重新登录；#12 已经换到 Codex 继续"): string {
  noticeId = addNotification(db, { kind: "lead_notice", urgency: "immediate", title: summary, createdAt: new Date().toISOString() });
  return summary;
}

// 不调用模型的 lead session，只记下收到的 prompt。
function stubLead() {
  const prompts: string[] = [];
  const factory = async () => ({
    modelName: "stub/model",
    session: {
      sessionId: "stub-session",
      subscribe() { return () => {}; },
      async prompt(msg: string) { prompts.push(msg); },
      async steer() {},
      async followUp() {},
      dispose() {},
    },
  });
  return { factory, prompts };
}

describe("desktop notifier", () => {
  it("does not spawn osascript from a daemon started by the test suite", async () => {
    seedLeadNotice();
    const lead = stubLead();
    const daemon = await startDaemon({
      dataDir: dir,
      dbPath,
      sessionFactory: lead.factory as never,
      log: () => {},
    });
    try {
      // 通知推出去以后记为已送达：那一步已经走过。
      await vi.waitFor(() => expect(getNotification(db, noticeId)?.state).toBe("delivered"));
      expect(osascript.calls).toEqual([]);
    } finally {
      await daemon.close();
    }
  });

  it("hands Lead's notice to the injected notifier with the Lead name as the title", async () => {
    const summary = seedLeadNotice();
    const lead = stubLead();
    const shown: Array<[string, string]> = [];
    const daemon = await startDaemon({
      dataDir: dir,
      dbPath,
      sessionFactory: lead.factory as never,
      log: () => {},
      notifyDesktop: (text, title) => { shown.push([text, title]); },
    });
    try {
      await vi.waitFor(() => expect(shown).toEqual([[summary, "Paimon"]]));
      // 用户改名以后，下一条通知用新名字。
      renameLead("Nina");
      const next = seedLeadNotice("#14 的评审写完了");
      await vi.waitFor(() => expect(shown).toEqual([[summary, "Paimon"], [next, "Nina"]]));
      expect(osascript.calls).toEqual([]);
    } finally {
      await daemon.close();
    }
  });

  it("keeps osascript as the production default, titled with the Lead name", async () => {
    vi.stubEnv("PLC_DESKTOP_NOTIFY", undefined);
    renameLead("韩梅梅");
    const summary = seedLeadNotice('需要你看一下 "发布" \\ 这一步');
    const lead = stubLead();
    const daemon = await startDaemon({
      dataDir: dir,
      dbPath,
      sessionFactory: lead.factory as never,
      log: () => {},
    });
    try {
      // 正文和标题作为参数传给 osascript，不拼进 AppleScript 源码。
      await vi.waitFor(() => expect(osascript.calls).toEqual([[...OSASCRIPT_NOTIFY_ARGS, summary, "韩梅梅"]]));
    } finally {
      await daemon.close();
    }
  });
});

// 路径 A：App 开着时订阅 plc.sock，通知只交给 App，不调 osascript；App 关掉后 daemon 照常用 osascript。
describe("desktop app subscription", () => {
  type Line = { type: string; success?: boolean; code?: string; title?: string; body?: string };

  function open(sockPath: string): Promise<{ sock: Socket; lines: Line[] }> {
    const sock = connect(sockPath);
    const lines: Line[] = [];
    let buffer = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        lines.push(JSON.parse(buffer.slice(0, newline)) as Line);
        buffer = buffer.slice(newline + 1);
      }
    });
    return new Promise((resolve, reject) => {
      sock.once("connect", () => resolve({ sock, lines }));
      sock.once("error", reject);
    });
  }

  const send = (sock: Socket, command: object) => sock.write(`${JSON.stringify(command)}\n`);
  const shellKey = () => readFileSync(join(dir, "shell-pairing.key"), "utf8").trim();

  async function startProductionDaemon() {
    vi.stubEnv("PLC_DESKTOP_NOTIFY", undefined);
    return startDaemon({ dataDir: dir, dbPath, sessionFactory: stubLead().factory as never, log: () => {} });
  }

  it("sends each notification only to the app while it is subscribed, and back to osascript after it quits", async () => {
    const daemon = await startProductionDaemon();
    try {
      const app = await open(daemon.sockPath);
      send(app.sock, { type: "subscribe_desktop_notifications", id: "s", key: shellKey() });
      await vi.waitFor(() => expect(app.lines).toEqual([{ type: "response", id: "s", success: true }]));

      const first = seedLeadNotice();
      await vi.waitFor(() => expect(app.lines.slice(1)).toEqual([{ type: "desktop_notification", title: "Paimon", body: first }]));
      await vi.waitFor(() => expect(getNotification(db, noticeId)?.state).toBe("delivered"));
      expect(osascript.calls).toEqual([]);

      // App 关掉：连接断开就是退订。
      await new Promise<void>((resolve) => { app.sock.once("close", () => resolve()); app.sock.destroy(); });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = seedLeadNotice("#15 卡住了，需要你决定");
      await vi.waitFor(() => expect(osascript.calls).toEqual([[...OSASCRIPT_NOTIFY_ARGS, second, "Paimon"]]));
      expect(app.lines).toHaveLength(2);
    } finally {
      await daemon.close();
    }
  });

  it("refuses a subscription without the key and keeps using osascript", async () => {
    const daemon = await startProductionDaemon();
    try {
      const other = await open(daemon.sockPath);
      send(other.sock, { type: "subscribe_desktop_notifications", id: "s", key: "0".repeat(64) });
      await vi.waitFor(() => expect(other.lines).toEqual([{ type: "response", id: "s", success: false, error: "wrong key", code: "unauthorized" }]));
      send(other.sock, { type: "desktop_notification_failed", id: "f", body: "伪造的通知" });
      await vi.waitFor(() => expect(other.lines[1]).toMatchObject({ id: "f", success: false, code: "unauthorized" }));

      const summary = seedLeadNotice();
      await vi.waitFor(() => expect(osascript.calls).toEqual([[...OSASCRIPT_NOTIFY_ARGS, summary, "Paimon"]]));
      expect(other.lines).toHaveLength(2);
      other.sock.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("shows a notification with osascript when the app reports that it failed", async () => {
    const daemon = await startProductionDaemon();
    try {
      const app = await open(daemon.sockPath);
      send(app.sock, { type: "subscribe_desktop_notifications", id: "s", key: shellKey() });
      await vi.waitFor(() => expect(app.lines).toHaveLength(1));
      const summary = seedLeadNotice();
      await vi.waitFor(() => expect(app.lines).toHaveLength(2));
      send(app.sock, { type: "desktop_notification_failed", id: "f", body: summary });
      await vi.waitFor(() => expect(osascript.calls).toEqual([[...OSASCRIPT_NOTIFY_ARGS, summary, "Paimon"]]));
      app.sock.destroy();
    } finally {
      await daemon.close();
    }
  });

  it("does not forward to a subscribed app when PLC_DESKTOP_NOTIFY is off", async () => {
    const daemon = await startDaemon({ dataDir: dir, dbPath, sessionFactory: stubLead().factory as never, log: () => {} });
    try {
      const app = await open(daemon.sockPath);
      send(app.sock, { type: "subscribe_desktop_notifications", id: "s", key: shellKey() });
      await vi.waitFor(() => expect(app.lines).toHaveLength(1));
      seedLeadNotice();
      await vi.waitFor(() => expect(getNotification(db, noticeId)?.state).toBe("delivered"));
      expect(app.lines).toHaveLength(1);
      expect(osascript.calls).toEqual([]);
      app.sock.destroy();
    } finally {
      await daemon.close();
    }
  });
});

function renameLead(name: string): void {
  writeLeadProfile(db, { name, persona: "", interactionStyle: "" }, { by: "user", at: new Date() });
}
