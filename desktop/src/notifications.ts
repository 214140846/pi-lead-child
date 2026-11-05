// 桌面通知的路径 A（docs/desktop/macos-desktop-design.md 第 8.6 节，P0-7）：App 开着时，壳在 plc.sock 上订阅 daemon 的
// 桌面通知，用 Electron 的 Notification 发出，通知中心里的来源是 App 名（Bytezard Lead），标题是 daemon 给的 Lead 名字。
// 有订阅时 daemon 不调 osascript，同一条通知只弹一次；App 关掉、连接断开，daemon 自己用 osascript 弹。
//
// 订阅要带数据目录里 shell-pairing.key 的口令（执行器的沙箱读不到它）。daemon 没起来、重启或者还没有口令时，隔一会儿重连。
// Electron 发某一条失败（failed 事件，未签名的 App 会这样）时，把正文交回 daemon 用 osascript 补发，然后退订，
// 这次运行里以后的通知都由 daemon 自己弹。
// Electron 报 show 不等于系统显示了：授权还没定时系统收下通知却不显示，也没有 failed。所以壳只在用户确认过通知能显示以后
// 才订阅（notification-check.ts，main.ts 决定）。
//
// 命令和消息的名字照 packages/protocol/src/local-sockets.ts 写一份（壳不 import 后端的包），desktop/test/notifications.test.ts 核对。
import { connect, type Socket } from "node:net";

export const SUBSCRIBE_COMMAND = "subscribe_desktop_notifications";
export const FAILED_COMMAND = "desktop_notification_failed";
export const NOTIFICATION_EVENT = "desktop_notification";
/** 和 protocol 的 DESKTOP_NOTIFICATION_BODY_MAX 一致。 */
export const BODY_MAX = 4_000;
const TITLE_MAX = 200;

export interface ShownNotification {
  on(event: "failed", listener: (event: unknown, error: string) => void): unknown;
  on(event: "click" | "close", listener: () => void): unknown;
  show(): void;
}

export interface DesktopNotificationsOptions {
  socketPath: string;
  /** 每次连接前重新读：daemon 启动时才生成口令。 */
  readKey: () => string | null;
  /** 新建一条 Electron 通知（new Notification(options)）。 */
  create: (options: { title: string; body: string }) => ShownNotification;
  /** 用户点了通知：打开窗口。 */
  onClick?: () => void;
  /** Electron 发失败、退订以后：下次打开 App 时重新检查通知（notification-check.ts）。 */
  onGiveUp?: () => void;
  retryMs?: number;
  log?: (line: string) => void;
  connectTo?: (path: string) => Socket;
}

export interface DesktopNotifications {
  stop(): void;
}

/** daemon 推来的一行；不是合法的通知时为 null。 */
export function parseNotification(line: string): { title: string; body: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const { type, title, body } = (value ?? {}) as { type?: unknown; title?: unknown; body?: unknown };
  if (type !== NOTIFICATION_EVENT || typeof title !== "string" || typeof body !== "string" || !title.trim()) return null;
  return { title: title.slice(0, TITLE_MAX), body: body.slice(0, BODY_MAX) };
}

export function subscribeDesktopNotifications(options: DesktopNotificationsOptions): DesktopNotifications {
  const retryMs = options.retryMs ?? 5_000;
  const log = options.log ?? (() => {});
  const connectTo = options.connectTo ?? connect;
  // Electron 的 Notification 对象没人引用时可能被回收，failed 和 click 就收不到：发出去的先留着，关掉或失败后放掉。
  const live = new Set<ShownNotification>();
  let socket: Socket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  // 发失败过一次：这次运行里不再订阅，通知由 daemon 弹。
  let gaveUp = false;

  const schedule = () => {
    if (stopped || gaveUp || timer) return;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, retryMs);
  };

  const show = (sock: Socket, note: { title: string; body: string }) => {
    const notification = options.create(note);
    live.add(notification);
    notification.on("failed", (_event, error) => {
      live.delete(notification);
      log(`[notifications] Electron could not show a notification (${error}); daemon shows it and the next ones`);
      if (gaveUp) return;
      gaveUp = true;
      options.onGiveUp?.();
      sock.write(`${JSON.stringify({ type: FAILED_COMMAND, body: note.body })}\n`, () => sock.end());
    });
    notification.on("close", () => live.delete(notification));
    notification.on("click", () => {
      live.delete(notification);
      options.onClick?.();
    });
    notification.show();
  };

  function open(): void {
    if (stopped || gaveUp) return;
    const key = options.readKey();
    if (!key) {
      schedule();
      return;
    }
    const sock = connectTo(options.socketPath);
    socket = sock;
    let buffer = "";
    let subscribed = false;
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      sock.write(`${JSON.stringify({ type: SUBSCRIBE_COMMAND, id: "subscribe", key })}\n`);
    });
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!subscribed) {
          const reply = safeParse(line) as { type?: unknown; id?: unknown; success?: unknown } | null;
          if (reply?.type !== "response" || reply.id !== "subscribe") continue;
          if (reply.success !== true) {
            // 口令不对（daemon 换了口令文件）：断开，过一会儿重新读口令再订。
            log("[notifications] daemon refused the subscription");
            sock.destroy();
            return;
          }
          subscribed = true;
          continue;
        }
        const note = parseNotification(line);
        if (note && !gaveUp) show(sock, note);
      }
    });
    sock.on("error", () => sock.destroy());
    sock.on("close", () => {
      if (socket === sock) socket = null;
      schedule();
    });
  }

  open();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      socket?.destroy();
      socket = null;
    },
  };
}

function safeParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
