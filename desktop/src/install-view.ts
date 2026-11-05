// 安装页画什么（设计第 4.1、4.3、8.3、8.6 节）。主进程算好整页的文字和按钮，安装页只按它画（renderer/install.ts），
// 自己不带文案，也不做判断。
import { INSTALL_STEPS, type InstallProgress } from "./install.js";
import type { Locale } from "./locale.js";
import { shellMessages } from "./shell.messages.js";

export const INSTALL_ACTIONS = [
  "move", "retry", "logs", "diagnostics",
  "notify-test", "notify-seen", "notify-missing", "notify-settings", "notify-later",
] as const;
export type InstallAction = typeof INSTALL_ACTIONS[number];

export function isInstallAction(value: unknown): value is InstallAction {
  return typeof value === "string" && (INSTALL_ACTIONS as readonly string[]).includes(value);
}

export interface InstallView {
  lang: Locale;
  /** 窗口标题：Lead 的名字。 */
  title: string;
  heading: string;
  body: string | null;
  steps: Array<{ id: string; label: string; state: string; stateLabel: string }>;
  detail: string | null;
  notice: string | null;
  error: string | null;
  /** 按钮下面的一句反馈，例如「诊断信息已经复制到剪贴板」。 */
  status: string | null;
  actions: Array<{ id: InstallAction; label: string; primary: boolean }>;
  busy: boolean;
}

export type InstallScreen =
  | { kind: "move"; error: string | null }
  | { kind: "progress"; progress: InstallProgress }
  // 装好以后、打开 Companion 以前：请用户确认桌面通知能显示（notification-check.ts）。
  //   intro：说明，发测试通知；sent：发出去了，问看没看到；missing：没看到；failed：Electron 报 failed，error 是原因。
  | { kind: "notifications"; phase: NotificationCheckPhase; error?: string };

export type NotificationCheckPhase = "intro" | "sent" | "missing" | "failed";

export function installView(screen: InstallScreen, o: { leadName: string; locale: Locale; status?: string | null; busy?: boolean }): InstallView {
  const m = shellMessages(o.locale);
  const base = { lang: o.locale, title: o.leadName, status: o.status ?? null, busy: o.busy ?? false };
  if (screen.kind === "move") {
    return {
      ...base,
      heading: m.move.heading,
      body: m.move.body,
      steps: [],
      detail: null,
      notice: null,
      error: screen.error,
      actions: [{ id: "move", label: m.actions.move, primary: true }],
    };
  }
  if (screen.kind === "notifications") {
    const n = m.notificationCheck;
    const later = { id: "notify-later", label: m.actions.notifyLater, primary: false } as const;
    const settings = { id: "notify-settings", label: m.actions.notifySettings, primary: false } as const;
    const body = {
      intro: n.intro,
      sent: n.sent,
      missing: n.missing,
      failed: n.failed(screen.error ?? m.errors.noReason),
    }[screen.phase];
    const actions: InstallView["actions"] = screen.phase === "intro"
      ? [{ id: "notify-test", label: m.actions.notifyTest, primary: true }, later]
      : screen.phase === "sent"
        ? [{ id: "notify-seen", label: m.actions.notifySeen, primary: true }, { id: "notify-missing", label: m.actions.notifyMissing, primary: false }]
        : [{ ...settings, primary: true }, { id: "notify-test", label: m.actions.notifyAgain, primary: false }, later];
    return {
      ...base,
      heading: n.heading,
      body,
      steps: [],
      detail: null,
      notice: screen.phase === "missing" || screen.phase === "failed" ? n.notListed : n.notice,
      error: null,
      actions,
    };
  }
  const { progress } = screen;
  const failed = progress.stage === "failed";
  return {
    ...base,
    heading: m.heading,
    body: null,
    // 「接手已有的数据和设置」只在接管时出现（设计第 12.7 节）。换版本要重启时这一行写「备份数据，换到新版本」，
    // 不说接手（设计第 7.5.2 节）；不重启时跳过，不出现。
    steps: INSTALL_STEPS.filter((id) => id !== "takeover" || !["pending", "skipped"].includes(progress.steps[id])).map((id) => ({
      id,
      label: id === "takeover" && progress.takeoverKind === "upgrade" ? m.steps.upgrade : m.steps[id],
      state: progress.steps[id],
      stateLabel: m.stepStates[progress.steps[id]],
    })),
    detail: failed ? null : progress.detail,
    notice: progress.backgroundNotice ? m.backgroundNotice : null,
    error: failed ? progress.error?.message ?? null : null,
    actions: failed
      ? [
        { id: "retry", label: m.actions.retry, primary: true },
        { id: "logs", label: m.actions.logs, primary: false },
        { id: "diagnostics", label: m.actions.diagnostics, primary: false },
      ]
      : [],
  };
}
