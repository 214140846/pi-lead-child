// 工单附件的 HTTP 面（工单 #231）：App 的工单详情列出附件、按编号取内容画缩略图和大图。只读，要 tickets:view。
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { TicketAttachmentContentSchema, TicketAttachmentListSchema } from "@pi-lead-child/protocol";
import { addTicketAttachment, createItem, createPairing, openDb, type Db } from "@pi-lead-child/store";
import { Value } from "typebox/value";

import { createControlPlaneService } from "../src/control-plane.js";
import { startPairedServer } from "../src/paired-server.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let db: Db;
let dir: string;
beforeEach(() => {
  dir = tempDir("plc-attachments-http-");
  db = openDb(join(dir, "plc.db"));
});
afterEach(() => db.close());

function runtime() {
  return { model: "stub/model", sessionId: "stub-session", busy: false, runningItemIds: [], aish: null };
}

async function start() {
  const server = await startPairedServer({
    db,
    controlPlane: createControlPlaneService(db, { runtime, now: () => new Date(), dataDir: dir }),
    hello: runtime,
    chat: () => "started",
    addClient: () => () => {},
    log: () => {},
  }, { port: 0 });
  return { ...server, base: `http://127.0.0.1:${server.port}` };
}

async function token(base: string, scopes: string[]) {
  const { code } = createPairing(db, { name: "attachments-client", kind: "companion", scopes });
  const response = await fetch(`${base}/v1/paired/redeem`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pairing_code: code }),
  });
  return (await response.json() as { access_token: string }).access_token;
}

describe("ticket attachments over HTTP", () => {
  it("lists a ticket's attachments with their origin and returns one attachment's content", async () => {
    const itemId = createItem(db, { title: "Ethan 的反馈", brief: "b", createdBy: "lead" });
    const { attachment } = await addTicketAttachment(db, dir, {
      itemId, name: "screenshot.png", mimeType: "image/png", data: PNG, sourceRef: "slack:F0SHOT",
      origin: { kind: "external", source: "slack", conversation: "#returns", message: "C0RET/1730700000.000100", sender: "Ethan" },
      addedBy: "lead",
    });
    const server = await start();
    try {
      const auth = { authorization: `Bearer ${await token(server.base, ["tickets:view"])}` };

      const list = await fetch(`${server.base}/v1/tickets/${itemId}/attachments`, { headers: auth });
      expect(list.status).toBe(200);
      const body = await list.json();
      expect(Value.Check(TicketAttachmentListSchema, body)).toBe(true);
      expect(body.items).toEqual([expect.objectContaining({
        id: attachment.id, name: "screenshot.png", kind: "image",
        origin: { kind: "external", source: "slack", conversation: "#returns", message: "C0RET/1730700000.000100", sender: "Ethan" },
      })]);

      const content = await fetch(`${server.base}/v1/tickets/${itemId}/attachments/${attachment.id}`, { headers: auth });
      expect(content.status).toBe(200);
      const image = await content.json();
      expect(Value.Check(TicketAttachmentContentSchema, image)).toBe(true);
      expect(Buffer.from(image.data, "base64")).toEqual(PNG);

      expect((await fetch(`${server.base}/v1/tickets/${itemId}/attachments/att_missing`, { headers: auth })).status).toBe(404);
      expect((await fetch(`${server.base}/v1/tickets/${itemId + 99}/attachments`, { headers: auth })).status).toBe(404);
      // 别的工单的附件编号不能借这张工单取。
      const other = createItem(db, { title: "other", brief: "b", createdBy: "lead" });
      expect((await fetch(`${server.base}/v1/tickets/${other}/attachments/${attachment.id}`, { headers: auth })).status).toBe(404);
      expect((await fetch(`${server.base}/v1/tickets/${itemId}/attachments`)).status).toBe(401);
    } finally {
      await server.close();
    }
  });
});
