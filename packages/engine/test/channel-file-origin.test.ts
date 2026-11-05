// 工单 #231：挂到工单上的 Slack 文件要记来源。hub 在记过的消息里找正文带着这个文件标记的那一条。
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { appendEvent, openDb } from "@pi-lead-child/store";

import { ChannelHub } from "../src/channels/hub.js";
import { ChannelRegistry } from "../src/channels/registry.js";
import { createSlackChannelAdapter } from "../src/channels/sources/slack.js";

describe("channel file origin", () => {
  it("finds the latest message that carried the file: conversation, message ref and sender", () => {
    const db = openDb(join(tempDir("plc-file-origin-"), "plc.db"));
    const hub = new ChannelHub({ db, registry: new ChannelRegistry([createSlackChannelAdapter({ api: {} as never })]), credentials: { credential: async () => null } } as never);
    const message = (seq: number, text: string, sender: string, lane: string) => db.transaction(() => appendEvent(db, {
      source: "slack", sourceRef: `slack:delivery:${seq}`, kind: "slack.dm.received", entityKey: "slack:D0ETHAN:main",
      occurredAt: `2026-11-04T08:0${seq}:00.000Z`,
      payload: {
        channelId: "D0ETHAN", channelType: "im", ts: `173070000${seq}.000100`, threadTs: null, echo: false, summary: "s", urgent: false,
        role: "message", laneLabel: lane, sender: { id: "U0ETHAN", name: sender, trust: "colleague" }, text,
        messageRef: { channel: "D0ETHAN", ts: `173070000${seq}.000100` },
      },
    }))();
    message(1, "看这个\n[图片 a.png，文件编号 slack:F0SHOT]", "Ethan", "私信 Ethan");
    message(2, "别的消息\n[图片 b.png，文件编号 slack:F0SHOT2]", "Nina", "#returns");

    expect(hub.fileOrigin("slack:F0SHOT")).toEqual({ conversation: "私信 Ethan", message: "D0ETHAN/1730700001.000100", sender: "Ethan" });
    expect(hub.fileOrigin("slack:F0SHOT2")).toEqual({ conversation: "#returns", message: "D0ETHAN/1730700002.000100", sender: "Nina" });
    expect(hub.fileOrigin("slack:F0NONE")).toBeNull();
    expect(hub.fileOrigin("F0SHOT")).toBeNull();
  });
});
