// 安全提醒的标题和正文（security-alerts.ts）。daemon 写进数据库，暂时取 zh；以后按用户的语言写。
import { defineMessages } from "./i18n.ts";

export const securityAlertMessages = defineMessages({
  en: {
    tamper: {
      sealInvalid: "The seal of the settings does not match",
      recordMismatch: "The settings in the ledger do not match the record of the settings page",
      title: (label: string) => `Someone changed the permission settings of ${label} outside the settings page. The system restored them.`,
      found: (how: string, found: string, expected: string) => `${how}. Found: "${found}". Recorded: "${expected}".`,
      restored: (restored: string) => `Restored to the stricter "${restored}".`,
      hint: "Usually a process changed the database directly (for example, a child with sqlite3). To allow more, change it in Settings → Connections.",
    },
    ledgerWrite: {
      target: { "plc.db": "the ledger plc.db", "config.json": "the configuration config.json" },
      title: (itemId: number, target: string) => `The agent of ticket #${itemId} tried to change ${target} directly`,
      command: (runId: number, command: string) => `Run #${runId} ran: ${command}`,
      dbOnly: "Only the daemon can write plc.db. The write guard stops writes with sqlite3.",
      configOnly: "Only the daemon can change config.json (through the settings page).",
      hint: "Find out why this agent did this. To change settings, use the settings page.",
    },
    configChanged: {
      title: "Someone changed config.json directly",
      changed: (items: string) => `Changed items: ${items}.`,
      contentChanged: "The content changed.",
      notDaemon: (leadName: string) =>
        `The daemon did not make this change (the settings page and the tools of ${leadName} write through the daemon). If you made the change, you can ignore this. If not, find the process that made it.`,
      separator: ", ",
    },
    guardRemoved: {
      title: "Someone removed or replaced the write guard of plc.db. The daemon installed it again.",
      count: (count: number) => `${count === 1 ? "1 guard trigger was" : `${count} guard triggers were`} missing or replaced. The daemon installed them again.`,
      hint: "The process that removed them may try to change the database directly. Look at what recent children do. A separate seal check covers the permission settings of connections.",
      rollback: "If you removed them for a rollback, stop the daemon first, then remove them (plc daemon ledger-guard uninstall).",
    },
  },
  zh: {
    tamper: {
      sealInvalid: "设置的封印对不上",
      recordMismatch: "账本里的设置和设置页的记录不一致",
      title: (label) => `${label} 的权限设置被绕过设置页修改，已恢复`,
      found: (how, found, expected) => `${how}：发现的是「${found}」，记录的是「${expected}」。`,
      restored: (restored) => `已恢复成更严的「${restored}」。`,
      hint: "这通常是有进程直接改了数据库（例如 child 用 sqlite3）。如果需要放开，请在设置 → 连接里改。",
    },
    ledgerWrite: {
      target: { "plc.db": "账本 plc.db", "config.json": "配置 config.json" },
      title: (itemId, target) => `工单 #${itemId} 的 agent 想直接改${target}`,
      command: (runId, command) => `Run #${runId} 执行了：${command}`,
      dbOnly: "plc.db 只能由 daemon 写，用 sqlite3 写库会被写入守卫拦住。",
      configOnly: "config.json 只能经 daemon 改（设置页）。",
      hint: "请看看这个 agent 为什么要这样做。需要改设置时，在设置页改。",
    },
    configChanged: {
      title: "config.json 被直接修改了",
      changed: (items) => `变了的配置项：${items}。`,
      contentChanged: "内容变了。",
      notDaemon: (leadName) => `这次修改不是经 daemon 做的（设置页、${leadName} 的工具都经 daemon 写）。如果是你自己改的，可以忽略；不是的话，请查一下是哪个进程改的。`,
      separator: "、",
    },
    guardRemoved: {
      title: "plc.db 的写入守卫被删掉或换掉了，已补装",
      count: (count) => `有 ${count} 个守卫触发器不见了或者被换过，daemon 已经补装。`,
      hint: "删掉它们的进程可能在准备直接改库。请看看最近的 child 在做什么；连接的权限设置另有封印核对。",
      rollback: "如果是你自己为回滚卸掉的，先停 daemon 再卸（plc daemon ledger-guard uninstall）。",
    },
  },
});
