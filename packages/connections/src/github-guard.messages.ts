// GitHub 守卫给写操作写的一句话（describe 的 summary，2026-11-01 多语言）。它进 Run 的审计、工单的活动和推给你的主人操作，
// 按写入时用户选的语言写。守卫拒绝的原因只给 agent 看，不在这里。
import { defineMessages } from "@pi-lead-child/protocol";

export const githubGuardMessages = defineMessages({
  en: {
    deletedPendingReview: (target: string) => `Deleted the unsubmitted review on ${target}`,
    createdPendingReview: (target: string) => `Created an unsubmitted review on ${target}`,
    resolvedThread: (target: string) => `Marked a review thread on ${target} as resolved`,
    unresolvedThread: (target: string) => `Opened a review thread on ${target} again`,
    submittedReview: (target: string, event: string) => `Submitted a review (${event}) on ${target}`,
    addedLineComment: (target: string, where: string | null) =>
      `Added a line comment to the review on ${target}${where ? ` (${where})` : ""}`,
    addedIssueComment: (target: string) => `Posted a comment on ${target}`,
    calledTool: (tool: string, target: string | null) => `Called the GitHub tool ${tool}${target ? ` (${target})` : ""}`,
  },
  zh: {
    deletedPendingReview: (target) => `删掉了 ${target} 上没提交的 review`,
    createdPendingReview: (target) => `在 ${target} 上建了一个没提交的 review`,
    resolvedThread: (target) => `在 ${target} 上把一个 review 线程标成已解决`,
    unresolvedThread: (target) => `在 ${target} 上重新打开一个 review 线程`,
    submittedReview: (target, event) => `在 ${target} 上提交了 review（${event}）`,
    addedLineComment: (target, where) => `在 ${target} 的 review 里加了一条行内评论${where ? `（${where}）` : ""}`,
    addedIssueComment: (target) => `在 ${target} 上发了一条评论`,
    calledTool: (tool, target) => `调用了 GitHub 的 ${tool}${target ? `（${target}）` : ""}`,
  },
});
