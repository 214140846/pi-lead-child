// 问 daemon 网关在哪里：在 plc.sock 上写一行 {"type":"status"}，读一行 {success, data:{gatewayUrl,…}}
// （packages/protocol/src/local-sockets.ts 的 DaemonLocalStatus）。网关被占时会换端口，所以每次都问，不写死端口。
// 窗口只加载回环地址：status 里的地址不是 http://127.0.0.1、localhost 或 [::1] 时不用它（设计第 8.4 节）。
import { connect } from "node:net";

export type DaemonStatus = (timeoutMs?: number) => Promise<{ gatewayUrl: string } | null>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** 去掉末尾斜杠的回环网关地址；不是 http 回环地址时为 null。 */
export function loopbackGatewayUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) return null;
  return url.origin;
}

export function daemonStatusOver(socketPath: string): DaemonStatus {
  return (timeoutMs = 3_000) => new Promise((resolve) => {
    const sock = connect(socketPath);
    let buffer = "";
    let settled = false;
    const done = (value: { gatewayUrl: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, newline)) as { success?: unknown; data?: { gatewayUrl?: unknown } };
        const gatewayUrl = message.success === true ? loopbackGatewayUrl(message.data?.gatewayUrl) : null;
        done(gatewayUrl ? { gatewayUrl } : null);
      } catch {
        done(null);
      }
    });
    sock.once("error", () => done(null));
    sock.once("close", () => done(null));
    sock.once("connect", () => sock.write(`${JSON.stringify({ type: "status" })}\n`));
  });
}
