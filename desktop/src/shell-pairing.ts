// 发布模式下 Companion 网页怎样拿到凭证（P0-4 返工，docs/desktop/shell.md「拿凭证」）。
// daemon 在发布模式缺省打开回环自动配对，但只认带口令的请求：口令在数据目录的 shell-pairing.key（0600）里，
// 由 daemon 生成（apps/daemon/src/shell-pairing.ts）。壳读它，给发往网关的请求加上 SHELL_PAIRING_HEADER，网页自己看不到它。
// 同一台 Mac 上别的系统用户能连回环端口、能伪造 Origin，但读不到这个文件，所以配不上。
// 名字和 packages/gateway 的 SHELL_PAIRING_HEADER、daemon 的 SHELL_PAIRING_KEY_FILE 一致，desktop/test 里核对。
import { readFileSync } from "node:fs";

export const SHELL_PAIRING_HEADER = "x-bytezard-shell-pairing";
export const SHELL_PAIRING_KEY_FILE = "shell-pairing.key";
const KEY = /^[0-9a-f]{64}$/;

/** 数据目录里的口令；没有（开发安装，或者 daemon 还没起来过）或者内容不对时为 null。 */
export function readShellPairingKey(file: string): string | null {
  try {
    const key = readFileSync(file, "utf8").trim();
    return KEY.test(key) ? key : null;
  } catch {
    return null;
  }
}

/** 发往网关（同源）的请求加上口令；别的地址原样不动，口令不会发到网关以外。 */
export function pairingHeaders(
  requestHeaders: Record<string, string>,
  url: string,
  gatewayOrigin: string | null,
  key: string | null,
): Record<string, string> {
  if (!key || !gatewayOrigin) return requestHeaders;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return requestHeaders;
  }
  return origin === gatewayOrigin ? { ...requestHeaders, [SHELL_PAIRING_HEADER]: key } : requestHeaders;
}
