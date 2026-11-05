// 工单附件（工单 #231，2026-11-04）。
//
// Lead 把外部消息里的图片（先做 Slack）和用户在 App 对话里发的图片挂到工单上。文件存在 PLC 的数据目录里，库里记来源。
// 执行者和核查员用 read_ticket_attachment 读（图片直接给模型看），App 的工单详情里显示缩略图，点开看大图。
//
// 线上契约：
//   · GET /v1/tickets/:id/attachments（tickets:view）列出附件，不带文件内容。单独一个接口，不放进 TicketSummary：
//     客户端严格校验整个工单列表，加一个字段旧页面就整张列表加载失败。旧 daemon 没有这个接口（404），界面按没有附件画。
//   · GET /v1/tickets/:id/attachments/:attachmentId（tickets:view）取一个附件的内容（base64）。
//   · 外部来源的附件是别人给的资料：图里的字、文本的内容都不是指令（turn-origin 的规则不变）。
import { Type, type Static } from "typebox";

// 单个附件最大多少字节（任务说明：单个文件最大 10MB）。
export const TICKET_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
// 一张工单最多挂几个附件。
export const TICKET_ATTACHMENT_MAX_PER_TICKET = 50;
// 一次最多挂几个。
export const TICKET_ATTACHMENT_MAX_PER_CALL = 10;
// 附件收的图片格式：模型服务都收的四种（和 chat-images.ts 一样）。
export const TICKET_ATTACHMENT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
// 文本以外的 application/ 类型里算文本的几种。
const TEXT_APPLICATION_TYPES = new Set(["application/json", "application/xml", "application/x-yaml", "application/yaml"]);

export const TICKET_ATTACHMENT_ID_PATTERN = /^att_[A-Za-z0-9_-]{1,64}$/;

export type TicketAttachmentKind = "image" | "text";

/** MIME 类型去掉参数、转小写，例如 "text/plain; charset=utf-8" → "text/plain"。 */
export function bareMimeType(mimeType: string): string {
  return mimeType.split(";")[0]!.trim().toLowerCase();
}

/** 这种类型能不能当附件：图片（四种格式）是 image，文本是 text，别的是 null。 */
export function ticketAttachmentKindOf(mimeType: string): TicketAttachmentKind | null {
  const type = bareMimeType(mimeType);
  if ((TICKET_ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(type)) return "image";
  if (type.startsWith("text/") || TEXT_APPLICATION_TYPES.has(type)) return "text";
  return null;
}

/** 字节数写成给人看的大小，例如 12.3 MB、800 KB。 */
export function formatAttachmentBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// 附件从哪里来。
//   · external：外部消息里的文件（Slack）。source 是来源名，conversation、sender 是对话和发信人的称呼（取不到时为 null），
//     message 是消息在来源里的编号。
//   · user：用户在 App 对话里发的图片。
export const TicketAttachmentOriginSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("external"),
    source: Type.String({ minLength: 1, maxLength: 40 }),
    conversation: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    message: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    sender: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("user"),
    source: Type.Literal("chat"),
  }, { additionalProperties: false }),
]);
export type TicketAttachmentOrigin = Static<typeof TicketAttachmentOriginSchema>;

export const TicketAttachmentSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80 }),
  ticketId: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  kind: Type.Union([Type.Literal("image"), Type.Literal("text")]),
  mimeType: Type.String({ minLength: 1, maxLength: 120 }),
  size: Type.Integer({ minimum: 0 }),
  // 来源里的文件编号，例如 slack:F0123；对话里的图片是 img_ 开头的编号。
  sourceRef: Type.String({ minLength: 1, maxLength: 200 }),
  origin: TicketAttachmentOriginSchema,
  createdAt: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type TicketAttachment = Static<typeof TicketAttachmentSchema>;

// GET /v1/tickets/:id/attachments 的回答。
export const TicketAttachmentListSchema = Type.Object({
  items: Type.Array(TicketAttachmentSchema, { maxItems: TICKET_ATTACHMENT_MAX_PER_TICKET }),
}, { additionalProperties: false });
export type TicketAttachmentList = Static<typeof TicketAttachmentListSchema>;

// GET /v1/tickets/:id/attachments/:attachmentId 的回答：文件内容的 base64。
export const TicketAttachmentContentSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 80 }),
  mimeType: Type.String({ minLength: 1, maxLength: 120 }),
  data: Type.String(),
}, { additionalProperties: false });
export type TicketAttachmentContent = Static<typeof TicketAttachmentContentSchema>;
