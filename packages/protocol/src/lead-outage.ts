// 一次停摆，一张卡片（2026-10-16）。Lead 不能工作时（断网、模型连不上、没有响应），系统把积压的事汇总给用户。
// daemon 写这条系统通知，companion 和 plc chat 显示它；这里是两边共用的说法：
//   · 开头一行："Lead 离线 19:11–20:07（网络中断）· 期间积压 1 件 · 20:07 已恢复并补处理"；
//   · 每件积压的事一行，写给用户看。Lead 写给自己的跟进和工具名（notify_user 之类）从不转给用户。
import type { LeadModelFailureKind } from "./lead-failure.ts";
import type { Locale } from "./i18n.ts";
import { leadOutageMessages } from "./lead-outage.messages.ts";
import { DEFAULT_LEAD_NAME } from "./lead-profile.ts";

// 原因和标题的文字按界面语言（lead-outage.messages.ts）。locale 暂时缺省 zh：daemon 写进数据库的标题照旧是中文，
// 它也靠 leadOutageCause 的中文认回原因（apps/daemon 的 lead-outage.ts）。都迁完以后去掉缺省值。
export function leadOutageCause(kind: LeadModelFailureKind | "silent", locale: Locale = "zh"): string {
  return leadOutageMessages(locale).cause[kind];
}

// start、end 是给人看的时间（HH:MM）。end 为 null：还没恢复。resumed：已经恢复，并且积压的事交回给了 Lead。
// 停摆不到一分钟：不写成「02:46–02:46」（看起来像一次时长为零的停摆，发布评审），写「02:46，不到一分钟」。
// durationMs 是按完整时间算的时长。有它就按它判断：02:46:50 到 02:47:10 也是不到一分钟（发布评审 reliability-backlog）。
// 没有它时只能比 HH:MM：同一分钟算不到一分钟。
// name 是 Lead 的名字（设置 → 身份与风格），不给时用缺省的。
export function leadOutageHeadline(args: {
  start: string; end: string | null; cause: string; pending: number; resumed: boolean; durationMs?: number | null; name?: string;
  locale?: Locale;
}): string {
  const m = leadOutageMessages(args.locale ?? "zh");
  const measured = typeof args.durationMs === "number" && Number.isFinite(args.durationMs);
  const brief = args.end !== null && (measured ? args.durationMs! < 60_000 : args.end === args.start);
  const range = args.end === null ? m.rangeOpen(args.start) : brief ? m.rangeBrief(args.start) : `${args.start}–${args.end}`;
  const recovered = args.end === null ? "" : brief ? m.recoveredNow : m.recovered(args.end);
  const tail = args.end === null ? "" : args.resumed ? m.resumed(recovered) : recovered;
  return m.headline(args.name ?? DEFAULT_LEAD_NAME, range, args.cause, args.pending, tail);
}

// 系统通知开头那一行是停摆卡片的标题吗（daemon 新写的格式）。开头是 Lead 的名字：写下以后名字可能又改过，
// 所以不认具体的名字，认「<名字> 离线 <时:分>」。2026-10-22 以前写的是「Lead 离线 …」，也认。
// 英文的标题是「<名字> offline 19:11–20:07」或「<名字> offline since 19:11」（2026-11-01）。
const OUTAGE_HEADLINE = /^\S.{0,40}? 离线 \d{1,2}:\d{2}/u;
const OUTAGE_HEADLINE_EN = /^\S.{0,40}? offline (?:since )?\d{1,2}:\d{2}/u;

export function isLeadOutageHeadline(line: string): boolean {
  return OUTAGE_HEADLINE.test(line) || OUTAGE_HEADLINE_EN.test(line);
}

// 积压的一件事，写给用户看：
//   · Lead 设的跟进（"跟进：…"）是 Lead 写给自己的话，只说"Lead 设的一次跟进到点了"；
//   · 其余的去掉工具名一类的标识符（notify_user、record_disposition、process_exit……）和因此空出来的括号。
export function userFacingBacklogText(summary: string, name: string = DEFAULT_LEAD_NAME, locale: Locale = "zh"): string {
  const text = summary.trim();
  if (/^跟进[：:]/u.test(text)) return leadOutageMessages(locale).followUpDue(name);
  return text
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu, "")
    .replace(/[（(]\s*[）)]/gu, "")
    .replace(/\s{2,}/gu, " ")
    .replace(/\s+([，。；：、,.;:])/gu, "$1")
    .trim();
}
