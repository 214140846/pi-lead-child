// 桌面通知的出口，不起 daemon（P0-7）：标题是当前的 Lead 名字；Bytezard Lead 的 App 订阅了就只交给 App，
// 没有订阅时用 App 不在时的出口（osascript）。plc.sock 上的整条路见 desktop-notifier.test.ts。
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_NOTIFICATION_BODY_MAX } from "@pi-lead-child/protocol";

// 这个文件里的 osascript 调用只记录，不执行。
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

const { DesktopNotifier, desktopSubscription, osascriptNotifier, OSASCRIPT_NOTIFY_ARGS } = await import("../src/desktop-notifier.js");

const KEY = "a".repeat(64);

function setup(enabled = true) {
  let name = "Paimon";
  const fallback: Array<[string, string]> = [];
  const notifier = new DesktopNotifier({ leadName: () => name, fallback: (body, title) => fallback.push([body, title]), enabled });
  const connection = () => {
    const lines: unknown[] = [];
    const sub = desktopSubscription(notifier, { key: () => KEY, send: (line) => lines.push(line), log: () => {} });
    return { lines, sub };
  };
  return { notifier, fallback, connection, rename: (next: string) => { name = next; } };
}

afterEach(() => {
  osascript.calls.length = 0;
  vi.unstubAllEnvs();
});

describe("DesktopNotifier", () => {
  it("titles every notification with the current Lead name", () => {
    const { notifier, fallback, rename } = setup();
    notifier.notify("#12 需要你重新登录");
    rename("Nina");
    notifier.notify("#14 的评审写完了");
    expect(fallback).toEqual([["#12 需要你重新登录", "Paimon"], ["#14 的评审写完了", "Nina"]]);
  });

  it("uses only the fallback when desktop notifications are off", () => {
    const { notifier, fallback, connection } = setup(false);
    const app = connection();
    app.sub.handle({ type: "subscribe_desktop_notifications", id: "s", key: KEY });
    notifier.notify("一");
    expect(app.lines).toEqual([{ type: "response", id: "s", success: true }]);
    expect(fallback).toEqual([["一", "Paimon"]]);
  });
});

describe("desktop app subscription", () => {
  it("sends a notification only to the subscribed app while it is open, and to the fallback after it quits", () => {
    const { notifier, fallback, connection, rename } = setup();
    const app = connection();
    app.sub.handle({ type: "subscribe_desktop_notifications", id: "s", key: KEY });
    // 重复订阅不会让同一条通知发两次。
    app.sub.handle({ type: "subscribe_desktop_notifications", id: "s2", key: KEY });
    notifier.notify("#15 卡住了，需要你决定");
    rename("韩梅梅");
    notifier.notify("提醒：下午 3 点和 Ethan 1:1");
    expect(app.lines).toEqual([
      { type: "response", id: "s", success: true },
      { type: "response", id: "s2", success: true },
      { type: "desktop_notification", title: "Paimon", body: "#15 卡住了，需要你决定" },
      { type: "desktop_notification", title: "韩梅梅", body: "提醒：下午 3 点和 Ethan 1:1" },
    ]);
    expect(fallback).toEqual([]);
    expect(notifier.subscriberCount).toBe(1);

    app.sub.close();
    notifier.notify("#16 交付了");
    expect(fallback).toEqual([["#16 交付了", "韩梅梅"]]);
    expect(app.lines).toHaveLength(4);
    expect(notifier.subscriberCount).toBe(0);
  });

  it("refuses a subscription with a wrong key, and a failure report from a connection that did not subscribe", () => {
    const { notifier, fallback, connection } = setup();
    const other = connection();
    other.sub.handle({ type: "subscribe_desktop_notifications", id: "s", key: "b".repeat(64) });
    other.sub.handle({ type: "subscribe_desktop_notifications", id: "short", key: "a" });
    other.sub.handle({ type: "desktop_notification_failed", id: "f", body: "伪造的通知" });
    notifier.notify("#12 需要你重新登录");
    expect(other.lines).toEqual([
      { type: "response", id: "s", success: false, error: "wrong key", code: "unauthorized" },
      { type: "response", id: "short", success: false, error: "wrong key", code: "unauthorized" },
      { type: "response", id: "f", success: false, error: "not subscribed", code: "unauthorized" },
    ]);
    expect(fallback).toEqual([["#12 需要你重新登录", "Paimon"]]);
  });

  it("shows a notification through the fallback when the app reports that it failed", () => {
    const { notifier, fallback, connection } = setup();
    const app = connection();
    app.sub.handle({ type: "subscribe_desktop_notifications", key: KEY });
    notifier.notify("#12 需要你重新登录");
    app.sub.handle({ type: "desktop_notification_failed", id: "f", body: "#12 需要你重新登录" });
    expect(fallback).toEqual([["#12 需要你重新登录", "Paimon"]]);
    expect(app.lines.at(-1)).toEqual({ type: "response", id: "f", success: true });
  });

  it("cuts a long body to the protocol limit", () => {
    const { notifier, connection } = setup();
    const app = connection();
    app.sub.handle({ type: "subscribe_desktop_notifications", key: KEY });
    notifier.notify("长".repeat(DESKTOP_NOTIFICATION_BODY_MAX + 10));
    expect((app.lines[1] as { body: string }).body).toHaveLength(DESKTOP_NOTIFICATION_BODY_MAX);
  });
});

describe("osascript fallback", () => {
  it("passes the body and the Lead name as arguments, not inside the script", () => {
    vi.stubEnv("PLC_DESKTOP_NOTIFY", undefined);
    const body = '需要你看一下 "发布" \\ 这一步\n" with title "x';
    osascriptNotifier()(body, "Paimon");
    expect(osascript.calls).toEqual([[...OSASCRIPT_NOTIFY_ARGS, body, "Paimon"]]);
    expect(OSASCRIPT_NOTIFY_ARGS.join(" ")).not.toContain(body);
  });

  it("does not run osascript when PLC_DESKTOP_NOTIFY is off", () => {
    vi.stubEnv("PLC_DESKTOP_NOTIFY", "off");
    osascriptNotifier()("一", "Paimon");
    expect(osascript.calls).toEqual([]);
  });
});
