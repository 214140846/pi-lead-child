import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../testing/index.js";
import { readHead, readTailLines } from "../src/file-read.js";

// 2026-11-03：读子 agent 会话的最后几行、预览交付文件时，以前把整个文件同步读进来。现在只异步读要的那一段，结果必须和整读一样。
const wholeTail = (path: string, count: number) => readFileSync(path, "utf8").trim().split("\n").slice(-count);

describe("readTailLines", () => {
  const cases: Array<[string, string]> = [
    ["many short lines over several chunks", Array.from({ length: 20_000 }, (_, i) => `{"n":${i}}`).join("\n") + "\n"],
    ["lines longer than a chunk", Array.from({ length: 6 }, (_, i) => `${i}:${"x".repeat(100_000)}`).join("\n")],
    ["no trailing newline", "a\nb\nc"],
    ["fewer lines than asked", "only\n"],
    ["an empty file", ""],
    ["multibyte characters across chunk ends", Array.from({ length: 5_000 }, (_, i) => `第${i}行：你好，世界🌏`).join("\n") + "\n"],
  ];
  for (const [label, content] of cases) {
    it(`matches reading the whole file: ${label}`, async () => {
      const path = join(tempDir("plc-file-read-"), "session.jsonl");
      writeFileSync(path, content);
      for (const count of [1, 3, 30, 1_000]) {
        expect(await readTailLines(path, count)).toEqual(wholeTail(path, count));
      }
    });
  }
});

describe("readHead", () => {
  it("reads only the first bytes and reports the whole size", async () => {
    const path = join(tempDir("plc-file-read-"), "big.txt");
    writeFileSync(path, "y".repeat(3 * 1024 * 1024));
    const { head, size } = await readHead(path, 1024);
    expect(head.length).toBe(1024);
    expect(size).toBe(3 * 1024 * 1024);
  });

  it("reads an empty file", async () => {
    const path = join(tempDir("plc-file-read-"), "empty.txt");
    writeFileSync(path, "");
    expect(await readHead(path, 1024)).toEqual({ head: Buffer.alloc(0), size: 0 });
  });
});
