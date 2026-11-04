// 下载 nodejs.org 的官方 Node 二进制，用同一个版本目录里的 SHASUMS256.txt 校验（设计文档第 2.1 节）。
// 哈希对不上时删掉下载的文件并失败：不能把一个来历不明的 Node 放进运行包。
import { execFile } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { sha256File } from "./release.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_NODE_DIST_URL = "https://nodejs.org/dist";
export const SHASUMS_FILE = "SHASUMS256.txt";

export function nodeTarballName(version: string, arch: string): string {
  return `node-v${version}-darwin-${arch}.tar.gz`;
}

/** SHASUMS256.txt 的每一行是「<64 位十六进制哈希>  <文件名>」。返回文件名到哈希的表。 */
export function parseShasums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (match) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

export type FetchLike = (url: string) => Promise<Response>;

async function download(fetchImpl: FetchLike, url: string, target: string): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`下载 ${url} 失败：HTTP ${response.status}`);
  const partial = `${target}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
    renameSync(partial, target);
  } finally {
    rmSync(partial, { force: true });
  }
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`下载 ${url} 失败：HTTP ${response.status}`);
  return response.text();
}

/**
 * 下载并校验 Node 的 tar.gz，返回缓存里的路径。每次都重新下载 SHASUMS256.txt；
 * 缓存里已有的 tar.gz 只有哈希对得上才复用，对不上就重新下载一次再校验。
 */
export async function fetchVerifiedNode(o: {
  version: string; arch: string; cacheDir: string; baseUrl?: string; fetchImpl?: FetchLike; log?: (line: string) => void;
}): Promise<{ tarball: string; sha256: string }> {
  const fetchImpl = o.fetchImpl ?? ((url: string) => fetch(url));
  const base = `${(o.baseUrl ?? DEFAULT_NODE_DIST_URL).replace(/\/+$/, "")}/v${o.version}`;
  const name = nodeTarballName(o.version, o.arch);
  const sums = parseShasums(await fetchText(fetchImpl, `${base}/${SHASUMS_FILE}`));
  const expected = sums.get(name);
  if (!expected) throw new Error(`${base}/${SHASUMS_FILE} 里没有 ${name}`);
  mkdirSync(o.cacheDir, { recursive: true });
  const tarball = join(o.cacheDir, name);
  if (existsSync(tarball) && (await sha256File(tarball)) === expected) {
    o.log?.(`Node ${o.version}：用缓存 ${tarball}`);
    return { tarball, sha256: expected };
  }
  o.log?.(`Node ${o.version}：下载 ${base}/${name}`);
  await download(fetchImpl, `${base}/${name}`, tarball);
  const actual = await sha256File(tarball);
  if (actual !== expected) {
    rmSync(tarball, { force: true });
    throw new Error(`${name} 的 SHA-256 是 ${actual}，和 ${SHASUMS_FILE} 里的 ${expected} 不一致，已删除下载的文件`);
  }
  return { tarball, sha256: actual };
}

/** 从 Node 的 tar.gz 里只取出 bin/node，复制到 dest（权限 0755）。 */
export async function extractNodeBinary(o: { tarball: string; version: string; arch: string; dest: string; workDir: string }): Promise<void> {
  const member = `node-v${o.version}-darwin-${o.arch}/bin/node`;
  const scratch = mkdtempSync(join(o.workDir, "node-extract-"));
  try {
    await execFileAsync("tar", ["-xzf", o.tarball, "-C", scratch, member]);
    copyFileSync(join(scratch, member), o.dest);
    chmodSync(o.dest, 0o755);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
