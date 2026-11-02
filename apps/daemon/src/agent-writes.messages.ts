// 子 agent 代你做的写操作（agent-writes.ts）记成主人操作时给用户看的文字。按写入时用户选的语言写。
import { defineMessages } from "@pi-lead-child/protocol";

export const agentWriteMessages = defineMessages({
  en: {
    ticket: (id: number) => `Ticket #${id}`,
    target: (runId: number, ticket: string) => `Run #${runId} (${ticket})`,
    summary: (leadName: string, what: string) => `A sub-agent that ${leadName} sent did this for you: ${what}`,
    link: (url: string) => `Link: ${url}`,
  },
  zh: {
    ticket: (id) => `工单 #${id}`,
    target: (runId, ticket) => `Run #${runId}（${ticket}）`,
    summary: (leadName, what) => `${leadName} 派的子 agent 代你${what}`,
    link: (url) => `链接：${url}`,
  },
});
