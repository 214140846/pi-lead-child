// Bytezard Lead 的 Electron 主进程（docs/desktop/macos-desktop-design.md 第 4、8.4 节，P0-4）。
// App 是一个薄壳：首次打开装好后台服务，然后在窗口里打开 daemon 网关提供的 Companion 网页；失败时说清楚、能重试。
// App 关掉以后 supervisor 和 daemon 照旧在跑：App 只是窗口、安装器和（P0-7 以后的）通知出口。
//
// Electron 由 index.ts 传进来，单元测试换成假的（desktop/test/main.test.ts），所以这里只 import electron 的类型。
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as ElectronModule from "electron";
import { collectDiagnostics as realCollectDiagnostics, runInstall as realRunInstall, type InstallProgress } from "./install.js";
import { installView, isInstallAction, type InstallScreen, type InstallView } from "./install-view.js";
import { readLeadName, rememberLeadName } from "./lead-name.js";
import { pickLocale } from "./locale.js";
import { shellPaths } from "./paths.js";
import { findBundledRuntime } from "./runtime-bundle.js";
import { shellMessages } from "./shell.messages.js";
import { pairingHeaders, readShellPairingKey } from "./shell-pairing.js";
import { navigationDecision, secureWebPreferences } from "./window-policy.js";

export type ShellElectron = Pick<typeof ElectronModule, "app" | "BrowserWindow" | "ipcMain" | "shell" | "clipboard" | "Menu" | "session">;

export const IPC = {
  getView: "installer:get-view",
  view: "installer:view",
  act: "installer:act",
} as const;

export const SHELL_VERSION_ARG = "--bytezard-shell-version=";

export interface ShellOptions {
  /** 编译后的 main.cjs 所在目录：preload.cjs 和 renderer/ 在它旁边。 */
  distDir: string;
  /** App 带的运行包所在目录（打包后是 Resources/runtime）。 */
  runtimeDir: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  runInstall?: typeof realRunInstall;
  collectDiagnostics?: typeof realCollectDiagnostics;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function startShell(electron: ShellElectron, options: ShellOptions): void {
  const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, session } = electron;
  const paths = shellPaths(options.env ?? process.env, options.home);
  const runInstall = options.runInstall ?? realRunInstall;
  const collectDiagnostics = options.collectDiagnostics ?? realCollectDiagnostics;

  // 第一件事，在 ready 和单实例锁之前：Chromium 的缓存、锁文件都进 <数据目录>/shell，不混进数据目录的根（设计第 1.1 节）。
  mkdirSync(paths.shellUserData, { recursive: true, mode: 0o700 });
  app.setPath("userData", paths.shellUserData);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  const preload = join(options.distDir, "preload.cjs");
  const installPage = join(options.distDir, "renderer", "install.html");
  const installPageUrl = pathToFileURL(installPage).href;
  const webPreferences = () => secureWebPreferences(preload, [`${SHELL_VERSION_ARG}${app.getVersion()}`]);

  let window: ElectronModule.BrowserWindow | null = null;
  let locale = pickLocale([]);
  let leadName = readLeadName(paths.leadNameFile);
  let gatewayOrigin: string | null = null;
  let screen: InstallScreen | null = null;
  let status: string | null = null;
  let busy = false;
  let installing = false;
  let lastProgress: InstallProgress | null = null;

  const currentView = (): InstallView | null => (screen ? installView(screen, { leadName, locale, status, busy }) : null);
  const pushView = () => {
    const view = currentView();
    if (view && window && !window.isDestroyed()) window.webContents.send(IPC.view, view);
  };

  // 只有安装页能调安装的 IPC：Companion 网页（http:）发来的一律不理。
  const fromInstallPage = (event: ElectronModule.IpcMainInvokeEvent) => {
    const url = event.senderFrame?.url ?? "";
    return url.split(/[?#]/)[0] === installPageUrl;
  };

  const guardContents = (contents: ElectronModule.WebContents) => {
    const onNavigate = (event: { preventDefault(): void }, url: string) => {
      const decision = navigationDecision(url, gatewayOrigin);
      if (decision === "allow") return;
      event.preventDefault();
      if (decision === "external") void shell.openExternal(url);
    };
    contents.on("will-navigate", onNavigate);
    contents.on("will-redirect", onNavigate);
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      const decision = navigationDecision(url, gatewayOrigin);
      if (decision === "allow") return { action: "allow", overrideBrowserWindowOptions: { webPreferences: webPreferences() } };
      if (decision === "external") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (child) => guardContents(child.webContents));
  };

  const openGateway = (gatewayUrl: string) => {
    gatewayOrigin = originOf(gatewayUrl);
    if (!gatewayOrigin || !window || window.isDestroyed()) return;
    // 发布模式下网关只给带口令的请求做回环自动配对（shell-pairing.ts）。每次打开网关时重新读：口令由 daemon 启动时生成。
    // 过滤器放宽到所有 http 请求，是否同源在 pairingHeaders 里按 origin 比，口令只发给网关。
    const key = readShellPairingKey(paths.shellPairingKeyFile);
    const origin = gatewayOrigin;
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["http://*/*"] }, (details, callback) => {
      callback({ requestHeaders: pairingHeaders(details.requestHeaders, details.url, origin, key) });
    });
    void window.loadURL(`${gatewayOrigin}/`);
  };

  const install = async (forceUnpack: boolean) => {
    if (installing) return;
    installing = true;
    status = null;
    try {
      const progress = await runInstall(
        { paths, bundled: findBundledRuntime(options.runtimeDir), locale },
        (next) => {
          lastProgress = next;
          screen = { kind: "progress", progress: next };
          pushView();
        },
        { forceUnpack },
      );
      lastProgress = progress;
      screen = { kind: "progress", progress };
      pushView();
      if (progress.stage === "ready" && progress.gatewayUrl) openGateway(progress.gatewayUrl);
    } finally {
      installing = false;
    }
  };

  const act = async (action: string) => {
    const m = shellMessages(locale);
    if (action === "move") {
      try {
        // 移动成功时 App 会退出再从「应用程序」重新打开（Electron app API）。返回 false 是用户取消了。
        app.moveToApplicationsFolder();
      } catch (error) {
        screen = { kind: "move", error: m.move.failed(error instanceof Error ? error.message : String(error)) };
        pushView();
      }
      return;
    }
    if (action === "retry") {
      // desktop-install 说运行包坏了：重新解包，不管版本号。
      await install(lastProgress?.error?.code === "release_invalid");
      return;
    }
    if (action === "logs") {
      mkdirSync(paths.logsDir, { recursive: true });
      await shell.openPath(paths.logsDir);
      return;
    }
    if (action === "diagnostics") {
      busy = true;
      pushView();
      try {
        clipboard.writeText(await collectDiagnostics(paths, readOrNull));
        status = m.diagnosticsCopied;
      } finally {
        busy = false;
        pushView();
      }
    }
  };

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 720,
      minHeight: 520,
      title: leadName,
      show: false,
      webPreferences: webPreferences(),
    });
    win.once("ready-to-show", () => win.show());
    guardContents(win.webContents);
    // 窗口标题是 Lead 的名字（设计第 4.1 节）。Companion 把 document.title 设成它，Electron 的窗口标题缺省跟着网页标题走；
    // 这里把它记下来给下次的安装页用。网页自己没设标题（explicitSet 为 false，标题是网址拼的）、或者不是网关的网页时，
    // 不让网页改标题，用记下的名字。
    win.webContents.on("page-title-updated", (event, title, explicitSet) => {
      const onGateway = gatewayOrigin !== null && originOf(win.webContents.getURL()) === gatewayOrigin;
      const name = onGateway && explicitSet ? rememberLeadName(paths.leadNameFile, title) : null;
      if (name) {
        leadName = name;
        return;
      }
      event.preventDefault();
      win.setTitle(leadName);
    });
    win.on("closed", () => {
      if (window === win) window = null;
    });
    return win;
  };

  ipcMain.handle(IPC.getView, (event) => (fromInstallPage(event) ? currentView() : null));
  ipcMain.handle(IPC.act, async (event, action: unknown) => {
    if (!fromInstallPage(event) || !isInstallAction(action) || busy) return;
    await act(action);
  });

  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  // 关掉窗口就退出 App。后台服务不跟着退出。
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(async () => {
    locale = pickLocale(app.getPreferredSystemLanguages());
    leadName = readLeadName(paths.leadNameFile);
    // 只用系统的菜单角色：菜单里的 App 名来自 Info.plist（Bytezard Lead），没有 Electron 缺省菜单里的帮助链接。
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]));
    window = createWindow();
    await window.loadFile(installPage);
    // 不在「应用程序」里时先请用户移过去（设计第 4.2 节第 1 步）。开发时（electron .）不检查。
    if (app.isPackaged && !app.isInApplicationsFolder()) {
      screen = { kind: "move", error: null };
      pushView();
      return;
    }
    await install(false);
  });
}

/** 开发时（没有打包）运行包在仓库根的 out/（scripts/desktop/pack-runtime.ts 的输出）；打包后在 Resources/runtime。 */
export function runtimeDirFor(app: Pick<typeof ElectronModule.app, "isPackaged" | "getAppPath">, resourcesPath: string): string {
  return app.isPackaged ? join(resourcesPath, "runtime") : join(app.getAppPath(), "..", "out");
}
