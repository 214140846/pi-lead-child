// 测试用：测试进程不许监听的端口。reserveTestPorts 登记端口，并包装 node:net 的 Server.prototype.listen。
// 监听登记的端口时，包装不绑定端口，而是在下一拍让这个 server 发出 error，code 是 ERR_RESERVED_TEST_PORT。
// http 和 ws 的 server 都继承 net.Server，所以也在范围里。
//
// 起因：网关没配置端口时监听 47130，那也是用户 App 里真实 daemon 的端口。真实 daemon 监听 *:47130，
// macOS 允许测试 daemon 再绑更具体的 127.0.0.1:47130。2026-11-05，一次全量测试绑上了它，App 的本机连接都到了
// 测试 daemon 上，App 页面拿到了别的 worktree 的 web 构建。所以这里在绑定之前拒绝，不等绑上以后再报告。
// error 不用 EADDRINUSE：网关遇到 EADDRINUSE 会退回随机端口，测试照样通过，问题就藏起来了。
//
// 只管本进程：测试启动的子进程（例如 fake daemon）不经过这个包装，它们的环境要自己带 PLC_GATEWAY_PORT=0。
//
// 状态放在 globalThis 上：vitest 每个测试文件重新加载模块，包装只装一次，包装要找到当前的状态。
import { Server } from "node:net";

export const RESERVED_TEST_PORT_ERROR = "ERR_RESERVED_TEST_PORT";

interface State {
  // 端口和拒绝时的说明。
  ports: Map<number, string>;
  installed: boolean;
}

const KEY = Symbol.for("pi-lead-child.testing.reserved-ports");

function state(): State {
  const holder = globalThis as unknown as Record<symbol, State | undefined>;
  return holder[KEY] ??= { ports: new Map(), installed: false };
}

// listen 的参数里要监听的 TCP 端口：数字、数字字符串，或者 options 里的 port。
// 监听路径（Unix socket）、句柄，或者没有给端口时，返回 null。
export function listenPort(args: readonly unknown[]): number | null {
  const first = args[0];
  const value = first !== null && typeof first === "object" ? (first as { port?: unknown }).port : first;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

// 登记测试进程不许监听的端口。reason 写进 error 的消息，告诉测试作者怎样改。
export function reserveTestPorts(ports: readonly number[], reason: string): void {
  const current = state();
  for (const port of ports) current.ports.set(port, reason);
  if (current.installed) return;
  current.installed = true;
  const listen = Server.prototype.listen as (this: Server, ...args: unknown[]) => Server;
  Server.prototype.listen = function guardedListen(this: Server, ...args: unknown[]): Server {
    const port = listenPort(args);
    const why = port === null ? undefined : state().ports.get(port);
    if (why === undefined) return listen.apply(this, args);
    const error = Object.assign(new Error(`A test must not listen on port ${port}: ${why}`), { code: RESERVED_TEST_PORT_ERROR });
    process.nextTick(() => this.emit("error", error));
    return this;
  } as typeof Server.prototype.listen;
}

// 取消登记。只给测试这个包装的用例用：它们登记一个空闲端口，用完取消。
export function releaseTestPorts(ports: readonly number[]): void {
  const current = state();
  for (const port of ports) current.ports.delete(port);
}

export function reservedTestPorts(): number[] {
  return [...state().ports.keys()];
}
