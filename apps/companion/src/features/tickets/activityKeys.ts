// 服务端写进活动流的中文键和原文开头（2026-11-01 迁多语言时从各文件收到这里）。
// 它们是数据，不是界面文字：界面按它们认出一件事，再从 *.messages.ts 取当前语言的话。不要翻译这些值。
//   - 用户动作的决策直接用中文记（gateway 写的「开始执行」「停止执行」），不是机器 id。
//   - daemon 的「运行结束，交接失败」通知用这个标题。
//   - 核查员的报告用「独立核查 FAIL。关键证据：」这类开头，经过里要去掉。

/** 用户点「开始执行」时记下的决策。 */
export const START_RUN_DECISION = '开始执行';

/** 用户点「停止执行」时记下的决策。 */
export const STOP_RUN_DECISION = '停止执行';

/** Run 结束但没有终态交接时，daemon 发的通知的标题。 */
export const HANDOFF_FAILED_TITLE = '运行结束，交接失败';

/** 核查报告开头的「独立核查 PASS/FAIL。」。 */
export const REVIEW_REPORT_VERDICT_PREFIX = /^\s*独立核查\s*(?:PASS|FAIL)\s*[。.:：]?\s*/i;

/** 核查报告里紧跟着的「关键证据：」。 */
export const REVIEW_REPORT_EVIDENCE_PREFIX = /^关键证据\s*[:：]\s*/;
