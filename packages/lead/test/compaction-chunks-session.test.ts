// 回归（2026-11-01）：压缩连续失败了几个小时，Lead 的上下文涨过了模型的上限。pi 的压缩把要摘要的历史拼成一个请求，
// 模型回「prompt is too long」，压缩永远成功不了，Lead 每一轮都失败。
// 这里走完整的一跳：真实的 createLeadSession，会话记录里预先写好很长的历史，模型接到本机的 OpenAI 兼容桩上，
// 桩和真的模型一样拒绝超长的请求。压缩要分段写完，每个请求都不超长，后一段带着前一段的摘要，压缩记录写进会话文件。
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tempDir } from "@pi-lead-child/core/testing";
import { openDb } from "@pi-lead-child/store";
import { createLeadSession } from "../src/session.js";

// 桩模型收下的请求最长多少个字符；更长的回 400「prompt is too long」，和真的模型一样。
const REQUEST_LIMIT = 120_000;

let server: Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
});

async function summaryStub(): Promise<{ baseUrl: string; requests: Array<{ size: number; text: string; rejected: boolean }> }> {
  const requests: Array<{ size: number; text: string; rejected: boolean }> = [];
  server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer) => parts.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(parts).toString("utf8");
      const rejected = body.length > REQUEST_LIMIT;
      requests.push({ size: body.length, text: body, rejected });
      if (rejected) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "invalid_request_error", message: `prompt is too long: ${body.length} tokens > ${REQUEST_LIMIT} maximum` } }));
        return;
      }
      const index = requests.filter((request) => !request.rejected).length;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (value: object) => res.write(`data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...value })}\n\n`);
      chunk({ choices: [{ index: 0, delta: { role: "assistant", content: `第 ${index} 段摘要` }, finish_reason: null }] });
      chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1`, requests };
}

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

// 预先写好的历史：60 轮对话，每条约 4000 个字符，一共约 48 万个字符，一个请求放不下。
function writeLongHistory(dataDir: string): string {
  const manager = SessionManager.create(dataDir, join(dataDir, "lead-sessions"));
  for (let round = 0; round < 60; round += 1) {
    manager.appendMessage({ role: "user", content: `第 ${round} 轮的问题 ${"q".repeat(4_000)}`, timestamp: round * 2 });
    manager.appendMessage({
      role: "assistant", content: [{ type: "text", text: `第 ${round} 轮的回答 ${"a".repeat(4_000)}` }],
      api: "openai-completions", provider: "stub", model: "m", usage, stopReason: "stop", timestamp: round * 2 + 1,
    } as never);
  }
  return manager.getSessionFile()!;
}

describe("compacting a history too long for one summary request", () => {
  it("summarizes it in parts that each fit, threads the summary through, and saves the compaction", async () => {
    const stub = await summaryStub();
    const dataDir = tempDir("plc-lead-compaction-chunks-");
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({
      lead: {
        providers: {
          stub: {
            api: "openai-completions", baseUrl: stub.baseUrl, apiKey: { value: "test" }, discover: false,
            models: [{ id: "m", contextWindow: 64_000, maxTokens: 2_000 }],
          },
        },
        models: ["stub/m"],
      },
    }));
    const sessionFile = writeLongHistory(dataDir);
    const db = openDb(join(dataDir, "plc.db"));
    const progress: Array<{ done: number; total: number }> = [];
    const lead = await createLeadSession({
      dataDir, dbPath: join(dataDir, "plc.db"), db, onCompactionProgress: (step) => progress.push({ done: step.done, total: step.total }),
    });
    const session = lead.session as unknown as { compact(instructions?: string): Promise<unknown>; dispose(): void };
    try {
      await session.compact();

      expect(stub.requests.some((request) => request.rejected)).toBe(false);
      expect(stub.requests.length).toBeGreaterThan(1);
      expect(stub.requests.every((request) => request.size <= REQUEST_LIMIT)).toBe(true);
      // 后一段带着前一段的摘要。
      for (const [index, request] of stub.requests.entries()) {
        if (index > 0) expect(request.text).toContain(`第 ${index} 段摘要`);
      }
      expect(progress).toEqual(stub.requests.map((_, index) => ({ done: index + 1, total: stub.requests.length })));
      // 压缩记录写进了会话文件：重启以后续接的也是压缩以后的上下文。
      const saved = readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string; summary?: string });
      const compaction = saved.find((entry) => entry.type === "compaction");
      expect(compaction?.summary).toBe(`第 ${stub.requests.length} 段摘要`);
    } finally {
      session.dispose();
      db.close();
    }
  }, 60_000);
});
