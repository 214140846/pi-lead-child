// 文件尾部的几行：从文件末尾往前一块一块异步读，读到够用的行数就停。子 agent 的会话文件有几十 MB，以前整个同步读进来再切分，
// 只为取最后几十行（2026-11-03）。
import { open } from "node:fs/promises";

const CHUNK_BYTES = 64 * 1024;

/** 文件最后 count 行（去掉首尾空白以后按 \n 切分，和 readFileSync(path).trim().split("\n").slice(-count) 一样）。 */
export async function readTailLines(path: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const parts: Buffer[] = [];
    let position = size;
    let newlines = 0;
    // 多读到 count + 2 个换行：最前面那一段可能只是半行，结尾也可能有一个换行。
    while (position > 0 && newlines < count + 2) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const part = Buffer.alloc(length);
      const { bytesRead } = await handle.read(part, 0, length, position);
      const read = part.subarray(0, bytesRead);
      for (const byte of read) if (byte === 0x0a) newlines += 1;
      parts.unshift(read);
    }
    const lines = Buffer.concat(parts).toString("utf8").trim().split("\n");
    // 没读到文件开头时，第一段可能是半行：只要后面的 count 行。
    return lines.slice(-count);
  } finally {
    await handle.close();
  }
}

/** 文件开头的 maxBytes 个字节和文件的总字节数：预览只要开头一段，不把整个文件读进来。 */
export async function readHead(path: string, maxBytes: number): Promise<{ head: Buffer; size: number }> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const head = Buffer.alloc(length);
    const { bytesRead } = length ? await handle.read(head, 0, length, 0) : { bytesRead: 0 };
    return { head: head.subarray(0, bytesRead), size };
  } finally {
    await handle.close();
  }
}
