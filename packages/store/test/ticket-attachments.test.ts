// 工单附件（工单 #231）：文件存在数据目录里，库里记来源；只收图片和文本，单个最大 10 MB。
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { TICKET_ATTACHMENT_MAX_BYTES } from "@pi-lead-child/protocol";

import { openDb, type Db } from "../src/db.js";
import { createItem } from "../src/items.js";
import {
  addTicketAttachment, checkTicketAttachment, getTicketAttachment, listTicketAttachments, readTicketAttachment, TicketAttachmentError,
} from "../src/ticket-attachments.js";

let dataDir: string;
let db: Db;
let itemId: number;
beforeEach(() => {
  dataDir = tempDir("plc-");
  db = openDb(join(dataDir, "plc.db"));
  itemId = createItem(db, { title: "t", brief: "b", createdBy: "user" });
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const slackOrigin = { kind: "external", source: "slack", conversation: "#returns", message: "1730700000.000100", sender: "Ethan" } as const;

describe("ticket attachments", () => {
  it("stores the file under the data directory and records where it came from", async () => {
    const { attachment, added } = await addTicketAttachment(db, dataDir, {
      itemId, name: "screenshot.png", mimeType: "image/png", data: png, sourceRef: "slack:F0123", origin: slackOrigin, addedBy: "lead",
    });

    expect(added).toBe(true);
    expect(attachment).toMatchObject({
      ticketId: itemId, name: "screenshot.png", kind: "image", mimeType: "image/png", size: png.length, sourceRef: "slack:F0123",
      origin: slackOrigin,
    });
    const row = db.prepare("SELECT storage_path FROM ticket_attachments WHERE id = ?").get(attachment.id) as { storage_path: string };
    expect(row.storage_path).toBe(`attachments/item-${itemId}/${attachment.id}.png`);
    const file = join(dataDir, row.storage_path);
    expect(readFileSync(file)).toEqual(png);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(listTicketAttachments(db, itemId)).toEqual([attachment]);
    expect(getTicketAttachment(db, itemId, attachment.id)).toEqual(attachment);
    expect((await readTicketAttachment(db, dataDir, itemId, attachment.id)).data).toEqual(png);
  });

  it("attaches the same source file to a ticket only once", async () => {
    const input = { itemId, name: "a.png", mimeType: "image/png", data: png, sourceRef: "img_abc", origin: { kind: "user", source: "chat" } as const, addedBy: "lead" as const };
    const first = await addTicketAttachment(db, dataDir, input);
    const again = await addTicketAttachment(db, dataDir, input);

    expect(again).toEqual({ attachment: first.attachment, added: false });
    expect(listTicketAttachments(db, itemId)).toHaveLength(1);
    expect(first.attachment.origin).toEqual({ kind: "user", source: "chat" });
  });

  it("keeps only images and text, and names the file and the reason when it refuses", () => {
    expect(checkTicketAttachment({ name: "notes.md", mimeType: "text/markdown; charset=utf-8", data: Buffer.from("# 标题") }))
      .toEqual({ kind: "text", mimeType: "text/markdown" });
    // 声明的类型不对时以文件头为准。
    expect(checkTicketAttachment({ name: "x.bin", mimeType: "application/octet-stream", data: png })).toEqual({ kind: "image", mimeType: "image/png" });
    expect(() => checkTicketAttachment({ name: "spec.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7") }))
      .toThrow("附件只收图片（PNG、JPEG、GIF、WebP）和文本文件，spec.pdf 是 application/pdf");
    expect(() => checkTicketAttachment({ name: "fake.png", mimeType: "image/png", data: Buffer.from("not a png") }))
      .toThrow("附件 fake.png 说是 image/png，但内容不是 PNG、JPEG、GIF、WebP 图片");
    expect(() => checkTicketAttachment({ name: "a.txt", mimeType: "text/plain", data: Buffer.from([0xff, 0xfe, 0x00]) }))
      .toThrow("不是 UTF-8 文字");
  });

  it("refuses a file over 10 MB with its size and the limit", async () => {
    const big = Buffer.alloc(TICKET_ATTACHMENT_MAX_BYTES + 1, 0x61);
    const attempt = addTicketAttachment(db, dataDir, {
      itemId, name: "big.txt", mimeType: "text/plain", data: big, sourceRef: "slack:F9", origin: slackOrigin, addedBy: "lead",
    });
    await expect(attempt).rejects.toThrow("附件 big.txt 有 10 MB，超过了单个附件的上限 10 MB");
    await expect(attempt).rejects.toBeInstanceOf(TicketAttachmentError);
    expect(listTicketAttachments(db, itemId)).toEqual([]);
    expect(existsSync(join(dataDir, "attachments", `item-${itemId}`))).toBe(false);
    // 正好 10 MB 收。
    const exact = await addTicketAttachment(db, dataDir, {
      itemId, name: "ok.txt", mimeType: "text/plain", data: Buffer.alloc(TICKET_ATTACHMENT_MAX_BYTES, 0x61), sourceRef: "slack:F10",
      origin: slackOrigin, addedBy: "lead",
    });
    expect(exact.attachment.size).toBe(TICKET_ATTACHMENT_MAX_BYTES);
  });

  it("refuses a missing ticket and will not read a file that changed after it was attached", async () => {
    await expect(addTicketAttachment(db, dataDir, {
      itemId: 9999, name: "a.png", mimeType: "image/png", data: png, sourceRef: "img_x", origin: { kind: "user", source: "chat" }, addedBy: "lead",
    })).rejects.toThrow("没有工单 #9999");
    const { attachment } = await addTicketAttachment(db, dataDir, {
      itemId, name: "a.png", mimeType: "image/png", data: png, sourceRef: "img_y", origin: { kind: "user", source: "chat" }, addedBy: "lead",
    });
    writeFileSync(join(dataDir, "attachments", `item-${itemId}`, `${attachment.id}.png`), Buffer.from([0x89, 0x50]));
    await expect(readTicketAttachment(db, dataDir, itemId, attachment.id)).rejects.toThrow("和挂上时的不一样");
    await expect(readTicketAttachment(db, dataDir, itemId, "../../plc.db")).rejects.toThrow("没有编号是");
  });
});
