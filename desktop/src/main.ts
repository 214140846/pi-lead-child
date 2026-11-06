// Bytezard Lead 的 Electron 主进程（docs/desktop/macos-desktop-design.md 第 4、8.4 节，P0-4）。
// App 是一个薄壳：首次打开装好后台服务，然后在窗口里打开 daemon 网关提供的 Companion 网页；失败时说清楚、能重试。
// App 关掉以后 supervisor 和 daemon 照旧在跑：App 只是窗口、安装器和 App 开着时的通知出口（notifications.ts）。
// 装好以后，用户还没确认过这一份 App 的通知能显示时，先请用户发一条测试通知确认（notification-check.ts，设计第 8.6 节）。
// 打包好的 App 每天检查一次新版，网页里点「更新」就换成新版并重开（updater.ts）。App 菜单里也能马上检查一次。
//
// Electron 由 index.ts 传进来，单元测试换成假的（desktop/test/main.test.ts），所以这里只 import electron 的类型。
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as ElectronModule from "electron";
import { aboutText, displayVersion, shellAbout } from "./build-info.js";
import { collectDiagnostics as realCollectDiagnostics, runInstall as realRunInstall, type InstallProgress } from "./install.js";
import { installView, isInstallAction, type InstallScreen, type InstallView, type NotificationCheckPhase } from "./install-view.js";
import { readLeadName, rememberLeadName } from "./lead-name.js";
import { pickLocale } from "./locale.js";
import {
  appBuildIdentity,
  forgetNotificationConfirmed,
  isNotificationConfirmed,
  notificationSettingsUrl,
  rememberNotificationConfirmed,
} from "./notification-check.js";
import { subscribeDesktopNotifications as realSubscribeNotifications, type DesktopNotifications } from "./notifications.js";
import { shellPaths } from "./paths.js";
import { findBundledRuntime, installedVersion, needsUnpack, unpackRuntime } from "./runtime-bundle.js";
import { shellMessages } from "./shell.messages.js";
import { execFile as realExecFile } from "./process.js";
import { pairingHeaders, readShellPairingKey } from "./shell-pairing.js";
import { appBundleOf, createUpdater as realCreateUpdater, UPDATE_TICK_MS, type ShellUpdateStatus, type Updater } from "./updater.js";
import { navigationDecision, secureWebPreferences } from "./window-policy.js";

export type ShellElectron = Pick<typeof ElectronModule, "app" | "BrowserWindow" | "ipcMain" | "shell" | "clipboard" | "Menu" | "session" | "Notification" | "net" | "dialog">;

// preload.ts 里写的是同样的字符串（preload 单独打包，不 import 这里）。
export const IPC = {
  getView: "installer:get-view",
  view: "installer:view",
  act: "installer:act",
  updateGet: "update:get",
  updateStatus: "update:status",
  updateApply: "update:apply",
  updateDismiss: "update:dismiss",
  about: "shell:about",
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
  subscribeNotifications?: typeof realSubscribeNotifications;
  /** App 的可执行文件（process.execPath）：从它找到签名文件，算这一份 App 的标识；也从它找到要换掉的 .app。 */
  execPath?: string;
  createUpdater?: typeof realCreateUpdater;
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
  const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, session, Notification, dialog } = electron;
  const paths = shellPaths(options.env ?? process.env, options.home);
  const runInstall = options.runInstall ?? realRunInstall;
  const collectDiagnostics = options.collectDiagnostics ?? realCollectDiagnostics;
  const subscribeNotifications = options.subscribeNotifications ?? realSubscribeNotifications;
  const createUpdater = options.createUpdater ?? realCreateUpdater;

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
  let notifications: DesktopNotifications | null = null;
  let notificationsSupported = false;
  let appBuild = "";
  // 装好了、等通知检查做完再打开的网关。
  let pendingGateway: string | null = null;
  // 测试通知：留着引用，failed 和 click 才收得到。
  let testNotification: ElectronModule.Notification | null = null;
  // 一键更新：只有打包好的 App 才有（ready 以后建）。
  let updater: Updater | null = null;

  // App 的图标（electron-builder 放在 Resources/icon.icns）：解包时设成后台程序的访达图标（runtime-bundle.ts 的 setAgentIcon）。
  // 没打包时没有。
  const appIcon = (): string | null => {
    if (!app.isPackaged) return null;
    const icon = join(options.runtimeDir, "..", "icon.icns");
    return existsSync(icon) ? icon : null;
  };
  // 解包用了多久、复用了什么（install.ts、updater.ts 的 prepareRuntime）。写不下不影响安装。
  const logInstall = (line: string) => {
    try {
      appendFileSync(join(paths.shellUserData, "install.log"), `[${new Date().toISOString()}] ${line}\n`);
    } catch {
      // 见上。
    }
  };

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
  // 只有网关的网页能调更新的 IPC。
  const fromGateway = (event: ElectronModule.IpcMainInvokeEvent) =>
    gatewayOrigin !== null && originOf(event.senderFrame?.url ?? "") === gatewayOrigin;
  // 版本、构建号、提交和运行包的版本（build-info.ts）。package.json 在 dist/ 的上一级（打包后是 app.asar 的根）。
  const about = () => shellAbout({ version: app.getVersion(), appRoot: join(options.distDir, ".."), paths });
  // 关于窗口：「版本 1.1.0 (202611050930)」，说明一栏写提交和运行包的版本。装好以后运行包可能换了，再设一次。
  const refreshAboutPanel = () => {
    if (!app.isPackaged) return;
    const current = about();
    const m = shellMessages(locale).about;
    app.setAboutPanelOptions({
      applicationVersion: displayVersion(current.version, current.build),
      ...(current.build ? { version: current.build } : {}),
      credits: [
        current.commit ? m.commit(current.commit) : null,
        current.runtimeVersion ? m.service(displayVersion(current.runtimeVersion, current.build)) : null,
      ]
        .filter((line): line is string => line !== null).join("\n"),
    });
  };
  const pushUpdate = (status: ShellUpdateStatus) => {
    if (!window || window.isDestroyed() || gatewayOrigin === null) return;
    if (originOf(window.webContents.getURL()) === gatewayOrigin) window.webContents.send(IPC.updateStatus, status);
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

  const notificationsConfirmed = () => isNotificationConfirmed(paths.notificationCheckFile);

  // App 开着时由它发桌面通知（设计第 8.6 节路径 A），但只在用户确认过这一份 App 的通知能显示以后。
  // 没确认时不订阅，daemon 照旧用 osascript 发：Electron 报了 show，系统也可能不显示，通知不能这样丢掉。
  const startNotifications = () => {
    if (notifications || !notificationsSupported || !notificationsConfirmed()) return;
    notifications = subscribeNotifications({
      socketPath: paths.daemonSocket,
      readKey: () => readShellPairingKey(paths.shellPairingKeyFile),
      create: (note) => new Notification(note),
      onClick: focusWindow,
      onGiveUp: () => forgetNotificationConfirmed(paths.notificationCheckFile),
    });
  };

  const showNotificationCheck = (phase: NotificationCheckPhase, error?: string) => {
    screen = { kind: "notifications", phase, ...(error === undefined ? {} : { error }) };
    pushView();
  };

  const afterInstall = (gatewayUrl: string) => {
    if (notificationsSupported && !notificationsConfirmed()) {
      pendingGateway = gatewayUrl;
      showNotificationCheck("intro");
      return;
    }
    openGateway(gatewayUrl);
  };

  // 看到了（或者点了测试通知）：记下这一份 App，开始订阅。以后再说：不记，daemon 接着用 osascript 发，下次打开再问。
  const finishNotificationCheck = (confirmed: boolean) => {
    if (confirmed) rememberNotificationConfirmed(paths.notificationCheckFile, appBuild);
    testNotification = null;
    // 检查做完了：画面回到装好的那一页，检查的按钮不再起作用。
    screen = lastProgress ? { kind: "progress", progress: lastProgress } : null;
    startNotifications();
    const gatewayUrl = pendingGateway;
    pendingGateway = null;
    if (gatewayUrl) openGateway(gatewayUrl);
  };

  const sendTestNotification = () => {
    const note = new Notification({ title: leadName, body: shellMessages(locale).notificationCheck.testBody });
    testNotification = note;
    const current = () => testNotification === note && screen?.kind === "notifications";
    note.on("failed", (_event, error) => {
      if (current()) showNotificationCheck("failed", error);
    });
    note.on("click", () => {
      focusWindow();
      if (current()) finishNotificationCheck(true);
    });
    // 先换画面再 show：failed 可能马上就来，它要盖过「发出去了」。
    showNotificationCheck("sent");
    note.show();
  };

  const install = async (forceUnpack: boolean) => {
    if (installing) return;
    installing = true;
    status = null;
    try {
      const progress = await runInstall(
        { paths, bundled: findBundledRuntime(options.runtimeDir), locale, log: logInstall, icon: appIcon() },
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
      refreshAboutPanel();
      if (progress.stage === "ready" && progress.gatewayUrl) afterInstall(progress.gatewayUrl);
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
    if (action.startsWith("notify-")) {
      if (screen?.kind !== "notifications") return;
      if (action === "notify-test") sendTestNotification();
      else if (action === "notify-seen") finishNotificationCheck(true);
      else if (action === "notify-missing") showNotificationCheck("missing");
      else if (action === "notify-settings") await shell.openExternal(notificationSettingsUrl(app.isPackaged));
      else if (action === "notify-later") finishNotificationCheck(false);
      return;
    }
    if (action === "retry") {
      // desktop-install 说运行包坏了：重新解包，不管版本号。
      await install(lastProgress?.error?.code === "release_invalid");
      return;
    }
    if (action === "logs") {
      // 不新建 logs/：还没迁移的开发机上，新数据目录里只能有 App 自己的项（设计第 12.9 节）。没有时打开安装根，
      // install-state.json 在那里。
      await shell.openPath(existsSync(paths.logsDir) ? paths.logsDir : paths.installRoot);
      return;
    }
    if (action === "diagnostics") {
      busy = true;
      pushView();
      try {
        clipboard.writeText(`${aboutText(about())}\n\n${await collectDiagnostics(paths, readOrNull)}`);
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
  ipcMain.handle(IPC.updateGet, (event) => (fromGateway(event) ? updater?.status() ?? { state: "none" } : null));
  ipcMain.handle(IPC.updateApply, async (event) => {
    if (fromGateway(event)) await updater?.apply();
  });
  ipcMain.handle(IPC.updateDismiss, (event) => {
    if (fromGateway(event)) updater?.dismiss();
  });
  ipcMain.handle(IPC.about, (event) => (fromGateway(event) ? about() : null));
  ipcMain.handle(IPC.act, async (event, action: unknown) => {
    if (!fromInstallPage(event) || !isInstallAction(action) || busy) return;
    await act(action);
  });

  // App 菜单的「检查更新…」：马上查一次，结果用对话框说；有新版时可以直接更新（和网页里的「更新」是同一个动作）。
  const checkForUpdates = async () => {
    const m = shellMessages(locale).update;
    const show = (options: ElectronModule.MessageBoxOptions) =>
      (window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
    if (!updater) {
      await show({ type: "info", message: m.notInstalled, buttons: [m.ok] });
      return;
    }
    const before = updater.status();
    if (before.state === "downloading" || before.state === "installing") {
      await show({ type: "info", message: m.busy(before.version), buttons: [m.ok] });
      return;
    }
    const result = await updater.check({ manual: true });
    if (result.kind === "available") {
      const { response } = await show({
        type: "info", message: m.available(result.version), detail: m.availableDetail(app.getVersion()),
        buttons: [m.updateNow, m.later], defaultId: 0, cancelId: 1,
      });
      if (response !== 0) return;
      // 成功时 App 换好就重开，不回到这里。
      await updater.apply();
      const after = updater.status();
      if (after.state === "failed") await show({ type: "warning", message: m.applyFailed(after.detail), buttons: [m.ok] });
      return;
    }
    if (result.kind === "current") await show({ type: "info", message: m.upToDate, detail: m.upToDateDetail(app.getVersion()), buttons: [m.ok] });
    else if (result.kind === "no_info") await show({ type: "warning", message: m.noInfo, detail: m.noInfoDetail, buttons: [m.ok] });
    else if (result.kind === "failed") await show({ type: "warning", message: m.failed, detail: m.failedDetail(result.reason), buttons: [m.ok] });
    else await show({ type: "warning", message: m.noSource, buttons: [m.ok] });
  };

  const focusWindow = () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  };
  app.on("second-instance", focusWindow);
  // 关掉窗口就退出 App。后台服务不跟着退出；通知的订阅断开，daemon 改回自己用 osascript 弹。
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    notifications?.stop();
    notifications = null;
  });

  void app.whenReady().then(async () => {
    locale = pickLocale(app.getPreferredSystemLanguages());
    leadName = readLeadName(paths.leadNameFile);
    refreshAboutPanel();
    // 只用系统的菜单角色：菜单里的 App 名来自 Info.plist（Bytezard Lead），没有 Electron 缺省菜单里的帮助链接。
    // App 菜单照 appMenu 角色的顺序写出来，在「关于」下面加「检查更新…」（用户 2026-11-05）。
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { label: shellMessages(locale).update.menu, click: () => void checkForUpdates() },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]));
    window = createWindow();
    // isSupported() 让 Electron 建好通知的 presenter，它在这时向系统申请通知授权：第一次打开 App 时 macOS 弹权限卡。
    // daemon 还没起来时，订阅会隔一会儿重连。
    notificationsSupported = Notification.isSupported();
    appBuild = appBuildIdentity({ packaged: app.isPackaged, execPath: options.execPath ?? process.execPath, version: app.getVersion() });
    startNotifications();
    if (app.isPackaged) {
      const execPath = options.execPath ?? process.execPath;
      updater = createUpdater({
        paths,
        env: options.env ?? process.env,
        currentVersion: app.getVersion(),
        appBundle: appBundleOf(execPath),
        fetch: (url, init) => electron.net.fetch(url, init),
        execFile: realExecFile,
        // 换好了 App：用新的那份重开。不用 quit：网页的 beforeunload 可能拦住它。
        relaunch: () => {
          app.relaunch();
          app.exit(0);
        },
        onStatus: pushUpdate,
        // 换掉 App 以前先解好新版本的运行包，不换 current（设计第 7.5.6 节）：新 App 打开时只要换 current。
        prepareRuntime: async (staged) => {
          const bundled = findBundledRuntime(join(staged, "Contents", "Resources", "runtime"));
          if (!bundled || !needsUnpack(bundled, installedVersion(paths))) return null;
          const icon = join(staged, "Contents", "Resources", "icon.icns");
          const result = await unpackRuntime({ bundled, paths, execFile: realExecFile, switchCurrent: false, icon: existsSync(icon) ? icon : null });
          return JSON.stringify(result);
        },
      });
      void updater.cleanup();
      const due = () => void updater?.checkIfDue();
      due();
      setInterval(due, UPDATE_TICK_MS).unref();
    }
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
