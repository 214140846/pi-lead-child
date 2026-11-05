// 桌面通知的出口（docs/desktop/macos-desktop-design.md 第 8.6 节，P0-7）。
// 每条通知的标题是用户配置的 Lead 名字，正文是通知内容；每次发都重新读名字，用户改名后下一条就用新名字。
//
// 路径 A：Bytezard Lead 的 App 开着时，壳在 plc.sock 上订阅（subscribe_desktop_notifications），用 Electron 的 Notification 发出，
// 通知中心里的来源是 App 名。有订阅时 daemon 不调 osascript，同一条通知只弹一次。
// App 关着（没有订阅）时，daemon 自己用 osascript 弹。壳发通知失败（Electron 的 failed 事件）时把正文交回来
// （desktop_notification_failed），daemon 用 osascript 补发这一条，壳随后退订。
//
// PLC_DESKTOP_NOTIFY=off（根 vitest 配置设置了它）：osascript 不弹，也不转给订阅的壳。测试不在用户桌面上弹通知。
import { execFile } from "node:child_process";
import { DESKTOP_NOTIFICATION_BODY_MAX, type DesktopNotificationEvent, type LocalSocketResponse } from "@pi-lead-child/protocol";
import { sameSecret } from "./shell-pairing.js";

export interface DesktopNotification {
  title: string;
  body: string;
}

/** App 不在时的出口。参数顺序是 (正文, 标题)：只关心正文的测试可以注入 (text) => …。 */
export type DesktopFallback = (body: string, title: string) => void;

export function desktopNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PLC_DESKTOP_NOTIFY !== "off";
}

// 正文和标题作为 osascript 的参数传进去（on run argv），不拼进 AppleScript 源码：Lead 名字和通知内容里有引号、
// 反斜杠或换行时也不会改变脚本。
export const OSASCRIPT_NOTIFY_ARGS = [
  "-e", "on run argv",
  "-e", "display notification (item 1 of argv) with title (item 2 of argv)",
  "-e", "end run",
] as const;

export function osascriptNotifier(env: Record<string, string | undefined> = process.env): DesktopFallback {
  if (!desktopNotifyEnabled(env)) return () => {};
  return (body, title) => {
    execFile("osascript", [...OSASCRIPT_NOTIFY_ARGS, body, title], () => { /* 非 macOS / 失败静默 */ });
  };
}

export interface DesktopNotifierOptions {
  /** 当前的 Lead 名字（store 的 leadDisplayName）。 */
  leadName: () => string;
  fallback: DesktopFallback;
  enabled?: boolean;
}

export class DesktopNotifier {
  private readonly subscribers = new Set<(note: DesktopNotification) => void>();
  private readonly enabled: boolean;

  constructor(private readonly options: DesktopNotifierOptions) {
    this.enabled = options.enabled ?? desktopNotifyEnabled();
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  notify(body: string): void {
    const title = this.options.leadName();
    if (this.enabled && this.subscribers.size > 0) {
      for (const send of this.subscribers) send({ title, body });
      return;
    }
    this.options.fallback(body, title);
  }

  /** 壳发这一条失败了：用 App 不在时的出口补发。 */
  fallback(body: string): void {
    this.options.fallback(body, this.options.leadName());
  }

  /** 返回退订函数。 */
  subscribe(send: (note: DesktopNotification) => void): () => void {
    this.subscribers.add(send);
    return () => { this.subscribers.delete(send); };
  }
}

type SubscriptionCommand =
  | { type: "subscribe_desktop_notifications"; id?: string; key: string }
  | { type: "desktop_notification_failed"; id?: string; body: string };

export interface DesktopSubscriptionOptions {
  /** 数据目录里 shell-pairing.key 的内容。 */
  key: () => string;
  /** 往这条 plc.sock 连接写一行。 */
  send: (line: LocalSocketResponse | DesktopNotificationEvent) => void;
  log: (line: string) => void;
}

/**
 * plc.sock 上一条连接的订阅状态。订阅要带对口令；desktop_notification_failed 只在订阅了的连接上有效。
 * 连接断开时调 close()，就是退订。
 */
export function desktopSubscription(notifier: DesktopNotifier, options: DesktopSubscriptionOptions) {
  let unsubscribe: (() => void) | null = null;
  const refuse = (id: string | undefined, error: string) =>
    options.send({ type: "response", ...(id === undefined ? {} : { id }), success: false, error, code: "unauthorized" });
  const ok = (id: string | undefined) => options.send({ type: "response", ...(id === undefined ? {} : { id }), success: true });
  return {
    handle(cmd: SubscriptionCommand): void {
      if (cmd.type === "subscribe_desktop_notifications") {
        if (!sameSecret(cmd.key, options.key())) {
          options.log("[plc.sock] refused a desktop notification subscription: wrong key");
          refuse(cmd.id, "wrong key");
          return;
        }
        if (!unsubscribe) {
          unsubscribe = notifier.subscribe(({ title, body }) => {
            options.send({ type: "desktop_notification", title, body: body.slice(0, DESKTOP_NOTIFICATION_BODY_MAX) });
          });
          options.log("[plc.sock] the desktop app subscribed to notifications");
        }
        ok(cmd.id);
        return;
      }
      if (!unsubscribe) {
        refuse(cmd.id, "not subscribed");
        return;
      }
      notifier.fallback(cmd.body);
      ok(cmd.id);
    },
    close(): void {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
