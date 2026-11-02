// 权限清单里每条规则给人看的一句话（run-grants.ts 的 label）。清单建好时写进数据库；daemon 和 engine 暂时取 zh。
// 只给 Lead 和 child 看的文字（丢掉的部分、GrantError、调用检查的原因）不在这里。
import { defineMessages } from "./i18n.ts";

export const runGrantMessages = defineMessages({
  en: {
    approve: "can APPROVE",
    requestChanges: "can request changes",
    comment: "can COMMENT",
    eventSeparator: ", ",
    readOnly: (name: string) => `Read only ${name}`,
    reviewOn: (name: string, events: string) => `Only on ${name}: ${events}`,
    inlineComments: (name: string) => `Add inline comments in the review of ${name}`,
    localReadOnly: (name: string) => `Read only the local repository ${name}`,
  },
  zh: {
    approve: "可以 APPROVE",
    requestChanges: "可以要求改动",
    comment: "发 COMMENT",
    eventSeparator: "，",
    readOnly: (name) => `只读 ${name}`,
    reviewOn: (name, events) => `只在 ${name} 上${events}`,
    inlineComments: (name) => `在 ${name} 的 review 里加行内评论`,
    localReadOnly: (name) => `只读本地仓库 ${name}`,
  },
});
