// 设置页校验出的几条问题连成一句（交接说明、通道的把握度）。按用户现在的语言连。
import { defineMessages, type Locale } from "@pi-lead-child/protocol";

const problemMessages = defineMessages({
  en: { join: (problems: readonly string[]) => problems.join("; ") },
  zh: { join: (problems) => problems.join("；") },
});

export function joinProblems(problems: readonly string[], locale: Locale): string {
  return problemMessages(locale).join(problems);
}
