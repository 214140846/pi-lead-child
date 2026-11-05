// P0-7 的实测工具（docs/desktop/p0-7-measurements.md）：ad-hoc 签名的 App 能不能用 Electron 的 Notification 发通知。
// 用法：open "Bytezard Lead.app" --args --notification-probe。App 不装服务、不开窗口，只发一条测试通知，
// 记下 Electron 报的事件（show、failed、click、close），20 秒后把结果写进 $TMPDIR/bytezard-lead-notification-probe.json 并退出。
// userData 放在临时目录，不碰数据目录。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as ElectronModule from "electron";
import { readLeadName } from "./lead-name.js";
import { pickLocale } from "./locale.js";
import { shellPaths } from "./paths.js";
import { shellMessages } from "./shell.messages.js";

export const NOTIFICATION_PROBE_ARG = "--notification-probe";
export const NOTIFICATION_PROBE_FILE = "bytezard-lead-notification-probe.json";

export interface NotificationProbeResult {
  appName: string;
  appVersion: string;
  supported: boolean;
  title: string;
  events: Array<{ event: string; atMs: number; error?: string }>;
}

export interface NotificationProbeOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  waitMs?: number;
  write?: (file: string, text: string) => void;
}

export function runNotificationProbe(
  electron: Pick<typeof ElectronModule, "app" | "Notification">,
  options: NotificationProbeOptions = {},
): void {
  const { app, Notification } = electron;
  const tempDir = join(app.getPath("temp"), "bytezard-lead-notification-probe");
  mkdirSync(tempDir, { recursive: true });
  app.setPath("userData", tempDir);
  const write = options.write ?? ((file, text) => writeFileSync(file, text));

  void app.whenReady().then(() => {
    const started = Date.now();
    const m = shellMessages(pickLocale(app.getPreferredSystemLanguages()));
    const result: NotificationProbeResult = {
      appName: app.getName(),
      appVersion: app.getVersion(),
      supported: Notification.isSupported(),
      title: readLeadName(shellPaths(options.env ?? process.env, options.home).leadNameFile),
      events: [],
    };
    const record = (event: string, error?: string) => {
      result.events.push({ event, atMs: Date.now() - started, ...(error === undefined ? {} : { error }) });
    };
    // 通知对象没人引用时可能被回收，事件就收不到：留到写结果的时候。
    const held = new Set<object>();
    if (result.supported) {
      const notification = new Notification({ title: result.title, body: m.notificationProbe });
      held.add(notification);
      notification.on("show", () => record("show"));
      notification.on("failed", (_event, error) => record("failed", error));
      notification.on("click", () => record("click"));
      notification.on("close", () => record("close"));
      notification.show();
      record("called show()");
    }
    setTimeout(() => {
      held.clear();
      const file = join(app.getPath("temp"), NOTIFICATION_PROBE_FILE);
      const text = `${JSON.stringify(result, null, 2)}\n`;
      write(file, text);
      process.stdout.write(`${file}\n${text}`);
      app.quit();
    }, options.waitMs ?? 20_000);
  });
}
