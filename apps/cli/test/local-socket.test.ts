// 2026-11-03 10:1xZ：负载 35–90，daemon 忙着。supervisor 的 status 要先问 daemon（最多 1.5 秒），plc 只给它 1 秒，
// 就以为 supervisor 没在跑：plc daemon restart 去运维入口再起一个 supervisor，最后报「supervisor 启动失败」。
// 决策边界：有没有 supervisor 在跑，只看 supervisor.sock 连不连得上，不看它答得快不快。
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { socketListening } from "../src/local-socket.js";

const servers: Server[] = [];
const accepted = new Set<Socket>();
afterEach(async () => {
  for (const socket of accepted) socket.destroy();
  accepted.clear();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

// 只接受连接、从不回答的 socket：一个活着但正忙的 supervisor。
async function busySocket(path: string): Promise<Server> {
  const server = createServer((socket) => { accepted.add(socket); });
  servers.push(server);
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(path, () => done()); });
  return server;
}

describe("whether a supervisor is running", () => {
  it("counts a supervisor that accepts the connection but is slow to answer", async () => {
    const path = join(tempDir("plc-cli-sock-"), "supervisor.sock");
    await busySocket(path);
    expect(await socketListening(path)).toBe(true);
  });

  it("does not count a missing socket", async () => {
    expect(await socketListening(join(tempDir("plc-cli-sock-"), "supervisor.sock"))).toBe(false);
  });
});
