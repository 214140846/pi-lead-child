// 安装页画什么（设计第 4.1、4.3、8.3 节）。主进程算好整页的文字和按钮，安装页只按它画（renderer/install.ts），
// 自己不带文案，也不做判断。
import { INSTALL_STEPS, type InstallProgress } from "./install.js";
import type { Locale } from "./locale.js";
import { shellMessages } from "./shell.messages.js";

export const INSTALL_ACTIONS = ["move", "retry", "logs", "diagnostics"] as const;
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
  | { kind: "progress"; progress: InstallProgress };

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
  const { progress } = screen;
  const failed = progress.stage === "failed";
  return {
    ...base,
    heading: m.heading,
    body: null,
    steps: INSTALL_STEPS.map((id) => ({
      id,
      label: m.steps[id],
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
