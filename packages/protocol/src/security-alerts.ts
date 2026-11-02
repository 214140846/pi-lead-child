// 安全报警：daemon 发现有人绕过 API 直接改了账本里的权限设置（2026-10-19 审查）。
//
// 背景：一个 child 在 bash 里执行了 `sqlite3 plc.db "UPDATE connections SET write_policy = 'direct' …"`，
// 之后 GitHub 的写入都不再出确认卡，事件日志里也没有记录。现在 daemon 用保险库给每个连接的权限设置加封印，
// 启动时、每分钟、每次用到连接时核对。核对不上时，恢复成更严的值，并记下这里的事件、直接推送给用户。
//
// 和主人操作的提醒（owner-actions.ts）同级：interrupt 级，daemon 直接推，不经过 Lead。
// 改动可能就是一个 child 做的，提醒不能取决于 Lead 判断要不要说。没有发出操作的凭证，所以没有「不是我」。
import { Type } from "typebox";
import { describeConnectionSettings, type ConnectionSettings } from "./connections.ts";
import { registerEventKind, type EventKindDefinition } from "./events.ts";
import type { Locale } from "./i18n.ts";
import { DEFAULT_LEAD_NAME } from "./lead-profile.ts";
import { securityAlertMessages } from "./security-alerts.messages.ts";

// 推送用的通知（notifications.kind）。daemon 直接推送它，不请 Lead 播报。不挂工单。
export const SECURITY_ALERT_NOTIFICATION_KIND = "security_alert";

export const CONNECTION_SETTINGS_TAMPERED_KIND = "connection.settings_tampered";
// child 的一条命令像是在直接写账本（plc.db）或配置（config.json）。规则：这两个文件可以读，不能写，改设置走 daemon 的 API。
export const LEDGER_WRITE_ATTEMPTED_KIND = "ledger.write_attempted";
// config.json 的内容变了，但不是 daemon 自己写的（设置页、Lead 换模型、plc lead use 都经 daemon 写）。
// 多半是用户自己手改的，所以它是 tell 级，交给 Lead 告诉用户，不直接推送（2026-10-19 审查）。
// child 改配置的命令另有 ledger.write_attempted（interrupt 级，直接推送）。
export const CONFIG_CHANGED_OUTSIDE_API_KIND = "config.changed_outside_api";
// 账本的写入守卫有触发器不见了，或者被换成了同名的别的触发器（有进程 DROP TRIGGER）。daemon 已经补装。
export const LEDGER_GUARD_REMOVED_KIND = "ledger.guard_removed";

// daemon 直接推送、不交给 Lead 的报警。config.changed_outside_api 不在里面：它交给 Lead。
export const PUSHED_SECURITY_ALERT_KINDS: readonly string[] = [
  "connection.settings_tampered", "ledger.write_attempted", "ledger.guard_removed",
];

// 封印的状态：missing 是这一行没有封印（功能上线前建的行，或者封印被删了），invalid 是封印解不开（被改过）。
export type ConnectionSettingsSealState = "valid" | "missing" | "invalid";

const SettingsPayload = Type.Object({
  roles: Type.Array(Type.String()),
  writePolicy: Type.String(),
});

export const SECURITY_ALERT_EVENT_KINDS: readonly EventKindDefinition[] = [
  {
    kind: CONNECTION_SETTINGS_TAMPERED_KIND,
    sources: ["system"],
    anomaly: true,
    payload: Type.Object({
      connection: Type.Object({ id: Type.Integer({ minimum: 1 }), key: Type.String(), label: Type.String() }),
      // 最后一次经设置页（或者连接时）定下的设置。没有封印、也没有改动记录时是缺省设置。
      expected: SettingsPayload,
      // 账本里发现的设置。
      found: SettingsPayload,
      // 恢复成的设置：expected 和 found 里更严的那一份。
      restored: SettingsPayload,
      seal: Type.Union([Type.Literal("valid"), Type.Literal("missing"), Type.Literal("invalid")]),
      notificationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    }),
    description: "daemon 发现一个连接的权限设置（谁能用、写入策略）不是经设置页改的，已经恢复成更严的值。",
  },
  {
    kind: LEDGER_WRITE_ATTEMPTED_KIND,
    sources: ["system"],
    anomaly: true,
    payload: Type.Object({
      runId: Type.Integer({ minimum: 1 }),
      itemId: Type.Integer({ minimum: 1 }),
      target: Type.Union([Type.Literal("plc.db"), Type.Literal("config.json")]),
      // 那条命令，脱敏并截断过。
      command: Type.String(),
      notificationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    }),
    description: "一个 child 执行的命令像是在直接写 plc.db 或 config.json。写库会被账本的写入守卫拦住；这条事件让用户知道它试过。",
  },
  {
    kind: CONFIG_CHANGED_OUTSIDE_API_KIND,
    sources: ["system"],
    anomaly: true,
    payload: Type.Object({
      // 变了的配置项，例如 env.GH_TOKEN、lead.models。只有名字，没有值。
      changed: Type.Array(Type.String()),
      notificationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    }),
    description: "config.json 被 daemon 以外的进程改了（不是经设置页、Lead 的工具或 plc lead use）。tell 级，交给 Lead。",
  },
  {
    kind: LEDGER_GUARD_REMOVED_KIND,
    sources: ["system"],
    anomaly: true,
    payload: Type.Object({
      // 不见了的触发器（最多列 20 个）和总数。
      missing: Type.Array(Type.String()),
      count: Type.Integer({ minimum: 1 }),
      notificationId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    }),
    description: "账本的写入守卫有触发器被删掉了。daemon 已经补装；删掉它的进程可能在准备直接改库。",
  },
];

for (const definition of SECURITY_ALERT_EVENT_KINDS) registerEventKind(definition);

/** 推送和收件箱里的文字。标题说发生了什么，正文说现在是什么、要用户做什么。 */
// 文字按界面语言（security-alerts.messages.ts）。locale 暂时缺省 zh：daemon 写进数据库的提醒照旧是中文，
// 连接设置的描述（connections.ts 的 describeConnectionSettings）也还是中文。都迁完以后去掉缺省值。
export function connectionSettingsTamperAlertText(input: {
  label: string;
  expected: ConnectionSettings;
  found: ConnectionSettings;
  restored: ConnectionSettings;
  seal: ConnectionSettingsSealState;
}, locale: Locale = "zh"): { title: string; body: string } {
  const m = securityAlertMessages(locale).tamper;
  const how = input.seal === "invalid" ? m.sealInvalid : m.recordMismatch;
  return {
    title: m.title(input.label),
    body: [
      m.found(how, describeConnectionSettings(input.found, locale), describeConnectionSettings(input.expected, locale)),
      m.restored(describeConnectionSettings(input.restored, locale)),
      m.hint,
    ].join("\n"),
  };
}

export function ledgerWriteAttemptAlertText(input: {
  itemId: number; runId: number; target: "plc.db" | "config.json"; command: string;
}, locale: Locale = "zh"): { title: string; body: string } {
  const m = securityAlertMessages(locale).ledgerWrite;
  return {
    title: m.title(input.itemId, m.target[input.target]),
    body: [
      m.command(input.runId, input.command),
      input.target === "plc.db" ? m.dbOnly : m.configOnly,
      m.hint,
    ].join("\n"),
  };
}

// leadName 是 Lead 的名字（设置 → 身份与风格），不给时用缺省的。
export function configChangedAlertText(changed: readonly string[], leadName: string = DEFAULT_LEAD_NAME, locale: Locale = "zh"): { title: string; body: string } {
  const m = securityAlertMessages(locale).configChanged;
  return {
    title: m.title,
    body: [
      changed.length ? m.changed(changed.join(m.separator)) : m.contentChanged,
      m.notDaemon(leadName),
    ].join("\n"),
  };
}

export function ledgerGuardRemovedAlertText(count: number, locale: Locale = "zh"): { title: string; body: string } {
  const m = securityAlertMessages(locale).guardRemoved;
  return {
    title: m.title,
    body: [m.count(count), m.hint, m.rollback].join("\n"),
  };
}
