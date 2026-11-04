import { createHash } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { fetchVerifiedNode, parseShasums, type FetchLike } from "../lib/node-dist.js";

const sha = (data: string) => createHash("sha256").update(data).digest("hex");
const NAME = "node-v24.22.2-darwin-arm64.tar.gz";

function fakeDist(files: Record<string, string>): { fetchImpl: FetchLike; requests: string[] } {
  const requests: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    requests.push(url);
    const name = url.slice(url.lastIndexOf("/") + 1);
    const body = files[name];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  };
  return { fetchImpl, requests };
}

describe("parseShasums", () => {
  it("maps file names to hashes and skips other lines", () => {
    const text = `${"a".repeat(64)}  ${NAME}\n${"B".repeat(64)}  node-v24.22.2.pkg\n-----BEGIN PGP SIGNATURE-----\n`;
    expect(parseShasums(text)).toEqual(new Map([[NAME, "a".repeat(64)], ["node-v24.22.2.pkg", "b".repeat(64)]]));
  });
});

describe("fetchVerifiedNode", () => {
  it("downloads the tarball from the pinned version and checks it against SHASUMS256.txt", async () => {
    const cacheDir = tempDir("plc-desktop-node-");
    const dist = fakeDist({ "SHASUMS256.txt": `${sha("node")}  ${NAME}\n`, [NAME]: "node" });
    const result = await fetchVerifiedNode({ version: "24.22.2", arch: "arm64", cacheDir, baseUrl: "https://mirror.example.com/dist/", fetchImpl: dist.fetchImpl });
    expect(result).toEqual({ tarball: join(cacheDir, NAME), sha256: sha("node") });
    expect(dist.requests).toEqual([
      "https://mirror.example.com/dist/v24.22.2/SHASUMS256.txt",
      `https://mirror.example.com/dist/v24.22.2/${NAME}`,
    ]);
  });

  it("fails and deletes the download when the hash does not match", async () => {
    const cacheDir = tempDir("plc-desktop-node-");
    const dist = fakeDist({ "SHASUMS256.txt": `${sha("node")}  ${NAME}\n`, [NAME]: "tampered" });
    await expect(fetchVerifiedNode({ version: "24.22.2", arch: "arm64", cacheDir, fetchImpl: dist.fetchImpl }))
      .rejects.toThrow(/SHA-256 是 .* 不一致/);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("fails when SHASUMS256.txt has no line for the tarball or the download fails", async () => {
    const cacheDir = tempDir("plc-desktop-node-");
    await expect(fetchVerifiedNode({ version: "24.22.2", arch: "arm64", cacheDir, fetchImpl: fakeDist({ "SHASUMS256.txt": "" }).fetchImpl }))
      .rejects.toThrow(/里没有 node-v24\.22\.2-darwin-arm64\.tar\.gz/);
    await expect(fetchVerifiedNode({ version: "24.22.2", arch: "arm64", cacheDir, fetchImpl: fakeDist({}).fetchImpl }))
      .rejects.toThrow(/HTTP 404/);
    await expect(fetchVerifiedNode({
      version: "24.22.2", arch: "arm64", cacheDir, fetchImpl: fakeDist({ "SHASUMS256.txt": `${sha("node")}  ${NAME}\n` }).fetchImpl,
    })).rejects.toThrow(/HTTP 404/);
    expect(existsSync(join(cacheDir, NAME))).toBe(false);
  });

  it("reuses a cached tarball only when its hash matches", async () => {
    const cacheDir = tempDir("plc-desktop-node-");
    const files = { "SHASUMS256.txt": `${sha("node")}  ${NAME}\n`, [NAME]: "node" };
    writeFileSync(join(cacheDir, NAME), "node");
    const cached = fakeDist(files);
    await fetchVerifiedNode({ version: "24.22.2", arch: "arm64", cacheDir, fetchImpl: cached.fetchImpl });
    expect(cached.requests).toHaveLength(1);

    writeFileSync(join(cacheDir, NAME), "stale");
    const stale = fakeDist(files);
    await fetchVerifiedNode({ version: "24.22.2", arch: "arm64", cacheDir, fetchImpl: stale.fetchImpl });
    expect(stale.requests).toHaveLength(2);
  });
});
