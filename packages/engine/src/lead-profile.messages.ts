// 改「身份与风格」时给用户看的文字（lead-profile.ts）：设置页的错误、主人操作的摘要。按写入时用户选的语言写。
import { defineMessages } from "@pi-lead-child/protocol";

export const leadProfileMessages = defineMessages({
  en: {
    invalidInput: "You can change only name, persona and interactionStyle. Each value must be text.",
    renamed: (before: string, after: string) => `changed the assistant name from "${before}" to "${after}"`,
    personaChanged: (name: string) => `changed the persona of ${name}`,
    personaCleared: (name: string) => `cleared the persona of ${name}`,
    styleChanged: (name: string) => `changed how ${name} interacts with you`,
    styleCleared: (name: string) => `cleared how ${name} interacts with you`,
    join: (parts: string[]) => parts.join(", "),
    target: (name: string) => `Identity and style of ${name}`,
    byYou: (summary: string) => summary.charAt(0).toUpperCase() + summary.slice(1),
    byLead: (name: string, summary: string) => `${name} ${summary} for you`,
  },
  zh: {
    invalidInput: "只能改 name、persona、interactionStyle，值是文字",
    renamed: (before, after) => `把助手的名字从「${before}」改成「${after}」`,
    personaChanged: (name) => `改了 ${name} 的人格`,
    personaCleared: (name) => `清空了 ${name} 的人格`,
    styleChanged: (name) => `改了 ${name} 和你的互动风格`,
    styleCleared: (name) => `清空了 ${name} 和你的互动风格`,
    join: (parts) => parts.join("，"),
    target: (name) => `${name} 的身份与风格`,
    byYou: (summary) => summary,
    byLead: (name, summary) => `${name} 代你${summary}`,
  },
});
