// 窗口里能打开什么（docs/desktop/macos-desktop-design.md 第 8.4 节）：
//   - 和网关同源的地址在窗口里打开。
//   - 其他 https: 链接交给系统浏览器（shell.openExternal）。
//   - 其他协议（http: 的别的地址、file:、javascript:、mailto: ……）一律拒绝。
// 网关还没打开时（安装页）没有同源地址，窗口里的跳转一律不放行。

export type NavigationDecision = "allow" | "external" | "deny";

export function navigationDecision(target: string, gatewayOrigin: string | null): NavigationDecision {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "deny";
  }
  if (gatewayOrigin && url.origin === gatewayOrigin && (url.protocol === "http:" || url.protocol === "https:")) return "allow";
  if (url.protocol === "https:" && !url.username && !url.password) return "external";
  return "deny";
}

/** 每个窗口都用的安全设置。新开的同源窗口也用它，不继承网页给的选项。 */
export function secureWebPreferences(preload: string, additionalArguments: string[]) {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    additionalArguments,
  } as const;
}
