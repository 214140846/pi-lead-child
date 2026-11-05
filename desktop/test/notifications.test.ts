// 桌面通知的路径 A（设计第 8.6 节，P0-7）：App 开着时订阅 daemon 的桌面通知，用 Electron 的 Notification 发出。
// socket 和 Notification 都换成假的：只看壳写给 daemon 什么、对 daemon 推来的每一行做了什么。
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DESKTOP_NOTIFICATION_BODY_MAX, isLocalSocketCommand } from "@pi-lead-child/protocol";
import {
  BODY_MAX, FAILED_COMMAND, NOTIFICATION_EVENT, parseNotification, subscribeDesktopNotifications, SUBSCRIBE_COMMAND,
  type ShownNotification,
} from "../src/notifications.js";

class FakeSocket extends EventEmitter {
  written: unknown[] = [];
  destroyed = false;
  setEncoding() {
    return this;
  }
  write(data: string, callback?: () => void) {
    this.written.push(JSON.parse(data));
    callback?.();
    return true;
  }
  end() {
    this.destroy();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
  /** daemon 写来一行。 */
  push(line: object) {
    this.emit("data", `${JSON.stringify(line)}\n`);
  }
}

class FakeNotification extends EventEmitter implements ShownNotification {
  shown = false;
  constructor(readonly options: { title: string; body: string }) {
    super();
  }
  show() {
    this.shown = true;
  }
}

const KEY = "c".repeat(64);

function setup(o: { key?: () => string | null } = {}) {
  const sockets: FakeSocket[] = [];
  const created: FakeNotification[] = [];
  const onClick = vi.fn();
  const onGiveUp = vi.fn();
  const handle = subscribeDesktopNotifications({
    socketPath: "/Users/alice/data/plc.sock",
    readKey: o.key ?? (() => KEY),
    create: (options) => {
      const notification = new FakeNotification(options);
      created.push(notification);
      return notification;
    },
    onClick,
    onGiveUp,
    retryMs: 1_000,
    connectTo: (path) => {
      expect(path).toBe("/Users/alice/data/plc.sock");
      const sock = new FakeSocket();
      sockets.push(sock);
      return sock as unknown as Socket;
    },
  });
  const subscribe = (sock: FakeSocket) => {
    sock.emit("connect");
    sock.push({ type: "response", id: "subscribe", success: true });
  };
  return { handle, sockets, created, onClick, onGiveUp, subscribe };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("desktop notifications in the app", () => {
  it("uses the same command names and body limit as the daemon protocol", () => {
    expect(isLocalSocketCommand({ type: SUBSCRIBE_COMMAND, id: "subscribe", key: KEY })).toBe(true);
    expect(isLocalSocketCommand({ type: FAILED_COMMAND, body: "一" })).toBe(true);
    expect(BODY_MAX).toBe(DESKTOP_NOTIFICATION_BODY_MAX);
    expect(NOTIFICATION_EVENT).toBe("desktop_notification");
  });

  it("subscribes with the key and shows each notification once, titled with the Lead name the daemon sends", () => {
    const { handle, sockets, created, subscribe } = setup();
    expect(sockets).toHaveLength(1);
    subscribe(sockets[0]!);
    expect(sockets[0]!.written).toEqual([{ type: SUBSCRIBE_COMMAND, id: "subscribe", key: KEY }]);
    sockets[0]!.push({ type: NOTIFICATION_EVENT, title: "Paimon", body: "#12 需要你重新登录" });
    sockets[0]!.push({ type: NOTIFICATION_EVENT, title: "Nina", body: "#14 的评审写完了" });
    expect(created.map((n) => [n.options, n.shown])).toEqual([
      [{ title: "Paimon", body: "#12 需要你重新登录" }, true],
      [{ title: "Nina", body: "#14 的评审写完了" }, true],
    ]);
    handle.stop();
  });

  it("ignores lines before the subscription is confirmed and lines that are not notifications", () => {
    const { handle, sockets, created } = setup();
    const sock = sockets[0]!;
    sock.emit("connect");
    sock.push({ type: NOTIFICATION_EVENT, title: "Paimon", body: "还没订上" });
    sock.push({ type: "response", id: "subscribe", success: true });
    sock.push({ type: "response", id: "x", success: true });
    sock.push({ type: NOTIFICATION_EVENT, title: " ", body: "没有标题" });
    sock.emit("data", "not json\n");
    expect(created).toEqual([]);
    handle.stop();
  });

  it("hands a failed notification back to the daemon and stops subscribing", () => {
    vi.useFakeTimers();
    const { handle, sockets, created, onGiveUp, subscribe } = setup();
    subscribe(sockets[0]!);
    sockets[0]!.push({ type: NOTIFICATION_EVENT, title: "Paimon", body: "#12 需要你重新登录" });
    sockets[0]!.push({ type: NOTIFICATION_EVENT, title: "Paimon", body: "#13 也失败了" });
    created[0]!.emit("failed", {}, "the app is not signed");
    created[1]!.emit("failed", {}, "the app is not signed");
    expect(sockets[0]!.written.slice(1)).toEqual([{ type: FAILED_COMMAND, body: "#12 需要你重新登录" }]);
    // 告诉 main.ts 忘掉「这一份 App 能发通知」，下次打开再检查。
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.destroyed).toBe(true);
    // 不再重连：这次运行里的通知都由 daemon 自己弹。
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    handle.stop();
  });

  it("reconnects after the daemon restarts, and waits for the key file", () => {
    vi.useFakeTimers();
    let key: string | null = null;
    const { handle, sockets, subscribe } = setup({ key: () => key });
    expect(sockets).toHaveLength(0);
    key = KEY;
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(1);
    subscribe(sockets[0]!);
    sockets[0]!.destroy();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    // daemon 拒绝（口令换了）：断开，过一会儿再试。
    sockets[1]!.emit("connect");
    sockets[1]!.push({ type: "response", id: "subscribe", success: false, error: "wrong key", code: "unauthorized" });
    expect(sockets[1]!.destroyed).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(3);
    handle.stop();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(3);
    expect(sockets[2]!.destroyed).toBe(true);
  });

  it("opens the window when the user clicks a notification", () => {
    const { handle, sockets, created, onClick, subscribe } = setup();
    subscribe(sockets[0]!);
    sockets[0]!.push({ type: NOTIFICATION_EVENT, title: "Paimon", body: "#15 卡住了" });
    created[0]!.emit("click");
    expect(onClick).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("cuts a long body", () => {
    expect(parseNotification(JSON.stringify({ type: NOTIFICATION_EVENT, title: "Paimon", body: "长".repeat(BODY_MAX + 5) }))?.body)
      .toHaveLength(BODY_MAX);
    expect(parseNotification(JSON.stringify({ type: NOTIFICATION_EVENT, title: 1, body: "x" }))).toBeNull();
  });
});
