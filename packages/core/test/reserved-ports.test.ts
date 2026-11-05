// 测试进程不许监听的端口（testing/reserved-ports.ts）的决策边界：哪些 listen 调用被拒绝，被拒绝时端口没有绑上。
// 用例只登记一个刚找到的空闲端口，不碰 47130：包装坏了时，用例也不会占用用户真实 daemon 的端口。
import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RESERVED_TEST_PORT_ERROR, listenPort, releaseTestPorts, reserveTestPorts, reservedTestPorts,
} from "../testing/reserved-ports.js";
import { tempDir } from "../testing/temp-dirs.js";

const servers: Server[] = [];
const reserved: number[] = [];

afterEach(async () => {
  releaseTestPorts(reserved.splice(0));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (server.listening) server.close(() => resolve());
    else resolve();
  })));
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function reserve(port: number): void {
  reserveTestPorts([port], "the test reserved it");
  reserved.push(port);
}

// listen 的结果：listening，或者 server 发出的 error。
function listen(server: Server, ...args: unknown[]): Promise<"listening" | NodeJS.ErrnoException> {
  servers.push(server);
  return new Promise((resolve) => {
    server.once("error", resolve);
    server.once("listening", () => resolve("listening"));
    Reflect.apply(server.listen, server, args);
  });
}

describe("listenPort", () => {
  it("reads the TCP port from every listen form, and null for a path or a handle", () => {
    expect(listenPort([47130, "127.0.0.1"])).toBe(47130);
    expect(listenPort(["47130"])).toBe(47130);
    expect(listenPort([{ port: 47130, host: "127.0.0.1" }])).toBe(47130);
    expect(listenPort([{ port: "47130" }])).toBe(47130);
    expect(listenPort([0])).toBe(0);
    expect(listenPort(["/tmp/plc.sock"])).toBeNull();
    expect(listenPort([{ path: "/tmp/plc.sock" }])).toBeNull();
    expect(listenPort([{ fd: 3 }])).toBeNull();
    expect(listenPort([])).toBeNull();
  });
});

describe("reserveTestPorts", () => {
  it("fails a listen on a reserved port before it binds, for net and http servers", async () => {
    const port = await freePort();
    reserve(port);
    expect(reservedTestPorts()).toContain(port);

    for (const [server, args] of [
      [createServer(), [port, "127.0.0.1"]],
      [createServer(), [{ port, host: "127.0.0.1" }]],
      [createHttpServer(), [String(port)]],
    ] as const) {
      const result = await listen(server, ...args);
      expect(result).toMatchObject({ code: RESERVED_TEST_PORT_ERROR });
      expect((result as Error).message).toContain(`port ${port}: the test reserved it`);
      expect(server.listening).toBe(false);
    }

    // 端口一直空着：取消登记以后，别的 server 能绑上它。
    releaseTestPorts([port]);
    expect(await listen(createServer(), port, "127.0.0.1")).toBe("listening");
  });

  it("lets other ports and socket paths listen as before", async () => {
    reserve(await freePort());
    const random = createServer();
    expect(await listen(random, 0, "127.0.0.1")).toBe("listening");
    expect((random.address() as AddressInfo).port).toBeGreaterThan(0);
    expect(await listen(createServer(), join(tempDir("plc-reserved-ports-"), "plc.sock"))).toBe("listening");
  });
});
