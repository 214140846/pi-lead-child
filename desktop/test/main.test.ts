// Electron 主进程（设计第 4、8.4 节，P0-4）。Electron 换成假的：只记下主进程对它做了什么。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import type { InstallProgress } from "../src/install.js";
import type { InstallView } from "../src/install-view.js";
import { IPC, startShell, type ShellElectron, type ShellOptions } from "../src/main.js";

type Listener = (...args: any[]) => any;

class Emitter {
  listeners = new Map<string, Listener[]>();
  on(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    return this;
  }
  once(name: string, listener: Listener) {
    return this.on(name, listener);
  }
  emit(name: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(name) ?? []) listener(...args);
  }
}

class FakeContents extends Emitter {
  url = "";
  sent: Array<{ channel: string; value: unknown }> = [];
  openHandler: ((details: { url: string }) => { action: string; overrideBrowserWindowOptions?: unknown }) | null = null;
  send(channel: string, value: unknown) {
    this.sent.push({ channel, value });
  }
  setWindowOpenHandler(handler: FakeContents["openHandler"]) {
    this.openHandler = handler;
  }
  getURL() {
    return this.url;
  }
  lastView(): InstallView {
    return [...this.sent].reverse().find((entry) => entry.channel === IPC.view)!.value as InstallView;
  }
}

function fakeElectron(o: { packaged?: boolean; inApplications?: boolean; languages?: string[]; notifications?: boolean } = {}) {
  const order: string[] = [];
  const windows: FakeWindow[] = [];
  const handlers = new Map<string, Listener>();
  const headerHooks: Array<{ filter: { urls: string[] }; listener: Listener }> = [];
  const notes: FakeNotification[] = [];
  let ready!: () => void;
  const whenReady = new Promise<void>((resolve) => { ready = resolve; });

  class FakeWindow extends Emitter {
    webContents = new FakeContents();
    title: string;
    loaded: Array<{ kind: "file" | "url"; target: string }> = [];
    constructor(readonly options: { title: string; webPreferences: Record<string, unknown> }) {
      super();
      this.title = options.title;
      windows.push(this);
    }
    async loadFile(file: string) {
      this.loaded.push({ kind: "file", target: file });
      this.webContents.url = pathToFileURL(file).href;
    }
    async loadURL(url: string) {
      this.loaded.push({ kind: "url", target: url });
      this.webContents.url = url;
    }
    setTitle(title: string) {
      this.title = title;
    }
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    restore() {}
    focus() {}
    show() {}
  }

  class FakeNotification extends Emitter {
    static isSupported = () => o.notifications ?? false;
    shown = 0;
    constructor(readonly options: { title: string; body: string }) {
      super();
      notes.push(this);
    }
    show() {
      this.shown += 1;
    }
  }

  const app = Object.assign(new Emitter(), {
    isPackaged: o.packaged ?? false,
    setPath: vi.fn((name: string) => order.push(`setPath:${name}`)),
    requestSingleInstanceLock: vi.fn(() => {
      order.push("lock");
      return true;
    }),
    whenReady: () => {
      order.push("whenReady");
      return whenReady;
    },
    getPreferredSystemLanguages: () => o.languages ?? ["en-US"],
    getVersion: () => "1.3.0",
    isInApplicationsFolder: () => o.inApplications ?? true,
    moveToApplicationsFolder: vi.fn(() => true),
    setAboutPanelOptions: vi.fn(),
    quit: vi.fn(),
  });
  const electron = {
    app,
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel: string, handler: Listener) => handlers.set(channel, handler) },
    shell: { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => "") },
    clipboard: { writeText: vi.fn() },
    Menu: { buildFromTemplate: vi.fn((template: unknown) => template), setApplicationMenu: vi.fn() },
    dialog: { showMessageBox: vi.fn(async (..._args: unknown[]) => ({ response: 0 })) },
    // 缺省当作发不了通知：别的测试不去连 plc.sock。
    Notification: FakeNotification,
    session: {
      defaultSession: {
        webRequest: { onBeforeSendHeaders: (filter: { urls: string[] }, listener: Listener) => headerHooks.push({ filter, listener }) },
      },
    },
  };
  return {
    electron: electron as unknown as ShellElectron,
    app,
    dialog: electron.dialog,
    /** App 菜单里名字是 label 的那一项。 */
    menuItem: (label: string) => {
      const template = electron.Menu.setApplicationMenu.mock.calls.at(-1)?.[0] as Array<{ submenu?: Array<{ label?: string; role?: string; click?: () => void }> }>;
      return template.flatMap((menu) => menu.submenu ?? []).find((item) => item.label === label);
    },
    shell: electron.shell,
    clipboard: electron.clipboard,
    order,
    windows,
    /** 主进程新建的 Electron 通知（测试通知）。 */
    notes,
    /** 按 Electron 的方式把一个请求交给最后注册的 onBeforeSendHeaders，返回它发出去的请求头。 */
    sendHeaders: (url: string, requestHeaders: Record<string, string> = {}) => {
      const hook = headerHooks.at(-1);
      if (!hook) return requestHeaders;
      let sent: Record<string, string> = requestHeaders;
      hook.listener({ url, requestHeaders }, (response: { requestHeaders: Record<string, string> }) => { sent = response.requestHeaders; });
      return sent;
    },
    ready: async () => {
      ready();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    invoke: (channel: string, senderUrl: string, ...args: unknown[]) => handlers.get(channel)!({ senderFrame: { url: senderUrl } }, ...args),
  };
}

function progress(stage: InstallProgress["stage"], extra: Partial<InstallProgress> = {}): InstallProgress {
  const state = stage === "ready" ? "done" : "pending";
  return {
    stage,
    steps: { unpack: state, service: state, start: state },
    detail: null,
    backgroundNotice: false,
    error: null,
    gatewayUrl: stage === "ready" ? "http://127.0.0.1:47130" : null,
    ...extra,
  };
}

function setup(o: Parameters<typeof fakeElectron>[0] & { install?: ShellOptions["runInstall"]; dataDir?: string; createUpdater?: ShellOptions["createUpdater"] } = {}) {
  const subscribeNotifications = vi.fn((_options: Parameters<NonNullable<ShellOptions["subscribeNotifications"]>>[0]) => ({ stop: vi.fn() }));
  const dataDir = o.dataDir ?? join(tempDir("plc-desktop-main-"), "Application Support", "Bytezard Lead");
  const distDir = join(tempDir("plc-desktop-dist-"), "dist");
  const fake = fakeElectron(o);
  const runInstall = vi.fn(o.install ?? (async () => progress("ready")));
  const collectDiagnostics = vi.fn(async () => "doctor output\n");
  startShell(fake.electron, {
    distDir,
    runtimeDir: join(distDir, "..", "runtime"),
    env: { PLC_DATA_DIR: dataDir },
    runInstall,
    collectDiagnostics,
    subscribeNotifications,
    ...(o.createUpdater ? { createUpdater: o.createUpdater } : {}),
  });
  const installPageUrl = pathToFileURL(join(distDir, "renderer", "install.html")).href;
  return { ...fake, dataDir, distDir, runInstall, collectDiagnostics, installPageUrl, subscribeNotifications };
}

describe("startShell", () => {
  it("moves the Electron user data below the data folder before anything else", () => {
    const { app, order, dataDir } = setup();
    expect(app.setPath).toHaveBeenCalledWith("userData", join(dataDir, "shell"));
    expect(order.indexOf("setPath:userData")).toBe(0);
    expect(order.indexOf("lock")).toBeGreaterThan(0);
    expect(order.indexOf("whenReady")).toBeGreaterThan(0);
  });

  it("opens one window that isolates the page from Node, then loads the gateway that the install reports", async () => {
    const shell = setup();
    await shell.ready();
    const [window] = shell.windows;
    expect(shell.windows).toHaveLength(1);
    expect(window!.options.webPreferences).toMatchObject({
      contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(shell.distDir, "preload.cjs"),
    });
    expect(window!.loaded).toEqual([
      { kind: "file", target: join(shell.distDir, "renderer", "install.html") },
      { kind: "url", target: "http://127.0.0.1:47130/" },
    ]);
  });

  it("asks to move the App into Applications and does not install from elsewhere", async () => {
    const shell = setup({ packaged: true, inApplications: false });
    await shell.ready();
    expect(shell.runInstall).not.toHaveBeenCalled();
    const view = shell.windows[0]!.webContents.lastView();
    expect(view.actions).toEqual([{ id: "move", label: "Move and Reopen", primary: true }]);
    await shell.invoke(IPC.act, shell.installPageUrl, "move");
    expect(shell.app.moveToApplicationsFolder).toHaveBeenCalledTimes(1);
  });

  it("shows why the move failed", async () => {
    const shell = setup({ packaged: true, inApplications: false });
    shell.app.moveToApplicationsFolder.mockImplementation(() => {
      throw new Error("permission denied");
    });
    await shell.ready();
    await shell.invoke(IPC.act, shell.installPageUrl, "move");
    expect(shell.windows[0]!.webContents.lastView().error).toContain("permission denied");
  });

  it("does not check the folder when it runs from the repository", async () => {
    const shell = setup({ packaged: false, inApplications: false });
    await shell.ready();
    expect(shell.runInstall).toHaveBeenCalledTimes(1);
  });

  it("answers the installer IPC only from the install page", async () => {
    const shell = setup({ install: async () => progress("failed", { error: { code: "daemon_timeout", message: "slow" } }) });
    await shell.ready();
    expect(await shell.invoke(IPC.getView, "http://127.0.0.1:47130/")).toBeNull();
    await shell.invoke(IPC.act, "http://127.0.0.1:47130/", "retry");
    expect(shell.runInstall).toHaveBeenCalledTimes(1);
    expect((await shell.invoke(IPC.getView, shell.installPageUrl)).error).toBe("slow");
    await shell.invoke(IPC.act, shell.installPageUrl, "rm -rf /");
    expect(shell.runInstall).toHaveBeenCalledTimes(1);
  });

  // App 的一键更新（updater.ts）：打包好的 App 才检查；只有网关的网页能读状态、点「更新」，状态也只推给它。
  it("checks for updates in a packaged App and answers the update IPC only from the gateway page", async () => {
    let deps: Parameters<NonNullable<ShellOptions["createUpdater"]>>[0] | null = null;
    const updater = {
      status: vi.fn(() => ({ state: "available" as const, version: "1.4.0", size: 3 })),
      checkIfDue: vi.fn(async () => {}),
      check: vi.fn(async () => {}),
      dismiss: vi.fn(),
      apply: vi.fn(async () => {}),
      cleanup: vi.fn(),
    };
    const shell = setup({ packaged: true, inApplications: true, createUpdater: (next) => { deps = next; return updater; } });
    await shell.ready();
    expect(updater.cleanup).toHaveBeenCalledTimes(1);
    expect(updater.checkIfDue).toHaveBeenCalledTimes(1);
    expect(deps!.currentVersion).toBe("1.3.0");

    expect(await shell.invoke(IPC.updateGet, shell.installPageUrl)).toBeNull();
    await shell.invoke(IPC.updateApply, "http://127.0.0.1:9999/");
    await shell.invoke(IPC.updateDismiss, "https://evil.example.com/");
    expect(updater.apply).not.toHaveBeenCalled();
    expect(updater.dismiss).not.toHaveBeenCalled();

    expect(await shell.invoke(IPC.updateGet, "http://127.0.0.1:47130/")).toEqual({ state: "available", version: "1.4.0", size: 3 });
    await shell.invoke(IPC.updateApply, "http://127.0.0.1:47130/");
    await shell.invoke(IPC.updateDismiss, "http://127.0.0.1:47130/");
    expect(updater.apply).toHaveBeenCalledTimes(1);
    expect(updater.dismiss).toHaveBeenCalledTimes(1);

    deps!.onStatus({ state: "installing", version: "1.4.0" });
    expect(shell.windows[0]!.webContents.sent.at(-1)).toEqual({ channel: IPC.updateStatus, value: { state: "installing", version: "1.4.0" } });
  });

  // App 菜单的「检查更新…」（用户 2026-11-05）：马上查一次，用对话框说结果；有新版时可以直接更新。
  describe("Check for Updates in the App menu", () => {
    function packagedWith(result: Awaited<ReturnType<ReturnType<NonNullable<ShellOptions["createUpdater"]>>["check"]>>, response = 0) {
      const updater = {
        status: vi.fn(() => ({ state: "none" as const })),
        checkIfDue: vi.fn(async () => {}),
        check: vi.fn(async () => result),
        dismiss: vi.fn(),
        apply: vi.fn(async () => {}),
        cleanup: vi.fn(),
      };
      const shell = setup({ packaged: true, inApplications: true, createUpdater: () => updater });
      shell.dialog.showMessageBox.mockResolvedValue({ response });
      return { shell, updater };
    }
    const click = async (shell: ReturnType<typeof setup>) => {
      shell.menuItem("Check for Updates…")!.click!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const lastMessage = (shell: ReturnType<typeof setup>) => (shell.dialog.showMessageBox.mock.calls.at(-1)!.at(-1) as { message: string; buttons: string[] });

    it("sits under About, and offers Update when a newer version is out", async () => {
      const { shell, updater } = packagedWith({ kind: "available", version: "1.4.0" });
      await shell.ready();
      const appMenu = (shell.electron.Menu.setApplicationMenu as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0] as Array<{ submenu: Array<{ role?: string; label?: string }> }>;
      expect(appMenu[0]!.submenu.slice(0, 2)).toMatchObject([{ role: "about" }, { label: "Check for Updates…" }]);
      expect(appMenu[0]!.submenu.at(-1)).toMatchObject({ role: "quit" });
      await click(shell);
      expect(updater.check).toHaveBeenCalledWith({ manual: true });
      expect(lastMessage(shell)).toMatchObject({ message: "Bytezard Lead 1.4.0 is available.", buttons: ["Update", "Later"] });
      expect(updater.apply).toHaveBeenCalledTimes(1);
    });

    it("does not update when the user picks Later", async () => {
      const { shell, updater } = packagedWith({ kind: "available", version: "1.4.0" }, 1);
      await shell.ready();
      await click(shell);
      expect(updater.apply).not.toHaveBeenCalled();
    });

    it("says that the App is up to date, or why the check failed", async () => {
      const current = packagedWith({ kind: "current" });
      await current.shell.ready();
      await click(current.shell);
      expect(lastMessage(current.shell).message).toBe("Bytezard Lead is up to date.");

      const failed = packagedWith({ kind: "failed", reason: "HTTP 502" });
      await failed.shell.ready();
      await click(failed.shell);
      expect(lastMessage(failed.shell).message).toBe("Bytezard Lead could not check for updates.");
      expect(failed.updater.apply).not.toHaveBeenCalled();
    });

    it("says that only an installed copy updates itself when it runs from the repository", async () => {
      const shell = setup({ packaged: false });
      await shell.ready();
      await click(shell);
      expect(lastMessage(shell).message).toBe("Only an installed copy of Bytezard Lead can update itself.");
    });
  });

  // 版本、构建号、提交和运行包的版本（build-info.ts，用户 2026-11-05）：关于窗口显示「版本 1.3.0 (202611050930)」，
  // 说明一栏写提交和运行包；设置 → 本设备经 about 接口读同一份，只有网关的网页读得到。
  it("does not repeat the build number of a local build in About", async () => {
    const dataDir = join(tempDir("plc-desktop-main-"), "Application Support", "Bytezard Lead");
    mkdirSync(join(dataDir, "runtime", "current"), { recursive: true });
    writeFileSync(join(dataDir, "runtime", "current", "release.json"), JSON.stringify({ version: "1.1.1-local.202611050212" }));
    const shell = setup({ packaged: true, inApplications: true, dataDir, createUpdater: () => ({
      status: () => ({ state: "none" as const }), checkIfDue: async () => {}, check: async () => ({ kind: "current" as const }),
      dismiss: () => {}, apply: async () => {}, cleanup: () => {},
    }) });
    (shell.app as unknown as { getVersion: () => string }).getVersion = () => "1.1.1-local.202611050212";
    writeFileSync(join(shell.distDir, "..", "package.json"), JSON.stringify({ buildInfo: { build: "202611050212", commit: "1f9375ea8d5e" } }));
    await shell.ready();
    expect(shell.app.setAboutPanelOptions).toHaveBeenLastCalledWith({
      applicationVersion: "1.1.1-local", version: "202611050212", credits: "Commit 1f9375e\nBackground service 1.1.1-local",
    });
  });

  it("shows the build number, the commit and the runtime version in About and to the gateway page", async () => {
    const dataDir = join(tempDir("plc-desktop-main-"), "Application Support", "Bytezard Lead");
    mkdirSync(join(dataDir, "runtime", "current"), { recursive: true });
    writeFileSync(join(dataDir, "runtime", "current", "release.json"), JSON.stringify({ version: "1.3.0" }));
    const shell = setup({ packaged: true, inApplications: true, dataDir, createUpdater: () => ({
      status: () => ({ state: "none" as const }), checkIfDue: async () => {}, check: async () => ({ kind: "current" as const }),
      dismiss: () => {}, apply: async () => {}, cleanup: () => {},
    }) });
    writeFileSync(join(shell.distDir, "..", "package.json"), JSON.stringify({ version: "1.3.0", buildInfo: { build: "202611050930", commit: "8965d9a79f9ce9aca6adf2a871c6155e78de825c" } }));
    await shell.ready();
    expect(shell.app.setAboutPanelOptions).toHaveBeenLastCalledWith({
      applicationVersion: "1.3.0", version: "202611050930", credits: "Commit 8965d9a\nBackground service 1.3.0",
    });
    expect(await shell.invoke(IPC.about, "http://127.0.0.1:47130/")).toEqual({
      version: "1.3.0", build: "202611050930", commit: "8965d9a", runtimeVersion: "1.3.0",
    });
    expect(await shell.invoke(IPC.about, shell.installPageUrl)).toBeNull();
    expect(await shell.invoke(IPC.about, "https://evil.example.com/")).toBeNull();
  });

  it("does not look for updates when it runs from the repository", async () => {
    const createUpdater = vi.fn();
    const shell = setup({ packaged: false, createUpdater });
    await shell.ready();
    expect(createUpdater).not.toHaveBeenCalled();
    expect(await shell.invoke(IPC.updateGet, "http://127.0.0.1:47130/")).toEqual({ state: "none" });
  });

  it("offers retry, logs and diagnostics after a failure", async () => {
    const shell = setup({ install: async () => progress("failed", { error: { code: "release_invalid", message: "damaged" } }) });
    await shell.ready();
    const view = shell.windows[0]!.webContents.lastView();
    expect(view.actions.map((action) => action.id)).toEqual(["retry", "logs", "diagnostics"]);

    await shell.invoke(IPC.act, shell.installPageUrl, "retry");
    expect(shell.runInstall).toHaveBeenCalledTimes(2);
    // desktop-install 说运行包坏了：重试时重新解包。
    expect(shell.runInstall.mock.calls[1]![2]).toEqual({ forceUnpack: true });

    // 没有 logs/ 时不新建它，打开安装根（设计第 12.9 节：还没迁移时新数据目录里只能有 App 自己的项）。
    await shell.invoke(IPC.act, shell.installPageUrl, "logs");
    expect(shell.shell.openPath).toHaveBeenLastCalledWith(join(shell.dataDir, "runtime"));
    expect(existsSync(join(shell.dataDir, "logs"))).toBe(false);
    mkdirSync(join(shell.dataDir, "logs"), { recursive: true });
    await shell.invoke(IPC.act, shell.installPageUrl, "logs");
    expect(shell.shell.openPath).toHaveBeenLastCalledWith(join(shell.dataDir, "logs"));

    await shell.invoke(IPC.act, shell.installPageUrl, "diagnostics");
    // 开头是版本：开发时没有构建号和提交，也没有装好的运行包。
    expect(shell.clipboard.writeText).toHaveBeenCalledWith("App 1.3.0\ncommit -\nruntime -\n\ndoctor output\n");
    expect(shell.windows[0]!.webContents.lastView().status).toBe("The diagnostics are on the clipboard.");
  });

  it("shows the install page in the language of the system", async () => {
    const shell = setup({ languages: ["zh-Hans-CN", "en-US"], install: async () => progress("failed", { error: { code: "x", message: "m" } }) });
    await shell.ready();
    expect(shell.windows[0]!.webContents.lastView()).toMatchObject({ lang: "zh", heading: "正在准备 Bytezard Lead" });
  });

  it("keeps the gateway pages in the window, hands https links to the browser, and refuses the rest", async () => {
    const shell = setup();
    await shell.ready();
    const contents = shell.windows[0]!.webContents;
    const navigate = (url: string) => {
      const event = { preventDefault: vi.fn() };
      contents.emit("will-navigate", event, url);
      return event.preventDefault.mock.calls.length > 0;
    };
    expect(navigate("http://127.0.0.1:47130/settings")).toBe(false);
    expect(navigate("https://github.com/acme/x")).toBe(true);
    expect(shell.shell.openExternal).toHaveBeenCalledWith("https://github.com/acme/x");
    expect(navigate("file:///etc/passwd")).toBe(true);
    expect(navigate("http://example.com/")).toBe(true);
    expect(shell.shell.openExternal).toHaveBeenCalledTimes(1);

    expect(contents.openHandler!({ url: "https://example.com/doc" })).toEqual({ action: "deny" });
    expect(shell.shell.openExternal).toHaveBeenCalledWith("https://example.com/doc");
    expect(contents.openHandler!({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    const same = contents.openHandler!({ url: "http://127.0.0.1:47130/views" });
    expect(same.action).toBe("allow");
    expect(same.overrideBrowserWindowOptions).toMatchObject({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  });
});

describe("pairing in release mode", () => {
  // P0-4 返工：发布模式下网关只给带口令的请求做回环自动配对。口令在数据目录的 shell-pairing.key 里。
  it("adds the token from the data folder to requests to the gateway, and to nothing else", async () => {
    const dataDir = join(tempDir("plc-desktop-pairing-"), "data");
    mkdirSync(dataDir, { recursive: true });
    const key = "c".repeat(64);
    writeFileSync(join(dataDir, "shell-pairing.key"), `${key}\n`, { mode: 0o600 });
    const fake = fakeElectron();
    startShell(fake.electron, { distDir: "/app/dist", runtimeDir: "/app/runtime", env: { PLC_DATA_DIR: dataDir }, runInstall: async () => progress("ready") });
    await fake.ready();
    expect(fake.sendHeaders("http://127.0.0.1:47130/v1/paired/loopback", { origin: "http://127.0.0.1:47130" }))
      .toEqual({ origin: "http://127.0.0.1:47130", "x-bytezard-shell-pairing": key });
    expect(fake.sendHeaders("http://127.0.0.1:47131/v1/paired/loopback")).toEqual({});
    expect(fake.sendHeaders("http://example.com/")).toEqual({});
  });

  it("sends no token when the data folder has none, as in a developer install", async () => {
    const shell = setup();
    await shell.ready();
    expect(shell.sendHeaders("http://127.0.0.1:47130/v1/paired/loopback")).toEqual({});
  });
});

describe("the window title", () => {
  it("is Paimon on the first install", async () => {
    const shell = setup({ install: async () => progress("working") });
    await shell.ready();
    expect(shell.windows[0]!.title).toBe("Paimon");
  });

  it("is the remembered Lead name on the install page", async () => {
    const dataDir = join(tempDir("plc-desktop-title-"), "data");
    mkdirSync(join(dataDir, "shell"), { recursive: true });
    writeFileSync(join(dataDir, "shell", "lead-name.json"), JSON.stringify({ name: "Nina" }));
    const fake = fakeElectron();
    startShell(fake.electron, { distDir: "/app/dist", runtimeDir: "/app/runtime", env: { PLC_DATA_DIR: dataDir }, runInstall: async () => progress("working") });
    await fake.ready();
    expect(fake.windows[0]!.title).toBe("Nina");
    // 安装页自己设的标题不算 Lead 的名字。
    const event = { preventDefault: vi.fn() };
    fake.windows[0]!.webContents.emit("page-title-updated", event, "install.html", true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(fake.windows[0]!.title).toBe("Nina");
  });

  it("follows the name that Companion sets, and remembers it for the next install page", async () => {
    const shell = setup();
    await shell.ready();
    const window = shell.windows[0]!;
    const renamed = { preventDefault: vi.fn() };
    window.webContents.emit("page-title-updated", renamed, "Jarvis", true);
    // Electron 自己把窗口标题换成网页标题；壳不拦。
    expect(renamed.preventDefault).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(shell.dataDir, "shell", "lead-name.json"), "utf8"))).toEqual({ name: "Jarvis" });

    // 网页还没设标题时，Chromium 用网址当标题（explicitSet 为 false）：不让它出现在窗口上。
    const synthesized = { preventDefault: vi.fn() };
    window.webContents.emit("page-title-updated", synthesized, "127.0.0.1:47130/", false);
    expect(synthesized.preventDefault).toHaveBeenCalled();
    expect(window.title).toBe("Jarvis");
  });
});

// 设计第 8.6 节路径 A（P0-7）：App 开着时由它发桌面通知，关掉时退订，daemon 改回 osascript。
// #232：Electron 报 show 不等于系统显示了。用户确认过这一份 App 的通知能显示以前，壳不订阅，通知留给 daemon。
describe("desktop notifications", () => {
  // 开发时（没有打包）这一份 App 的标识是版本号（notification-check.ts），假 Electron 的版本是 1.3.0。
  const confirmed = (dataDir: string, build = "version:1.3.0") => {
    mkdirSync(join(dataDir, "shell"), { recursive: true });
    writeFileSync(join(dataDir, "shell", "notification-check.json"), JSON.stringify({ confirmedBuild: build, confirmedAt: "2026-11-04T00:00:00.000Z" }));
    return dataDir;
  };
  const freshDataDir = () => join(tempDir("plc-desktop-main-"), "Application Support", "Bytezard Lead");
  const checkFile = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, "shell", "notification-check.json"), "utf8"));

  it("subscribes to the daemon socket in the data folder once the app is ready, and stops when it quits", async () => {
    const shell = setup({ notifications: true, dataDir: confirmed(freshDataDir()) });
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();
    await shell.ready();
    expect(shell.subscribeNotifications).toHaveBeenCalledTimes(1);
    const options = shell.subscribeNotifications.mock.calls[0]![0];
    expect(options.socketPath).toBe(join(shell.dataDir, "plc.sock"));
    // 口令每次连接前重新读，没有时为 null。
    expect(options.readKey()).toBeNull();
    writeFileSync(join(shell.dataDir, "shell-pairing.key"), `${"d".repeat(64)}\n`);
    expect(options.readKey()).toBe("d".repeat(64));
    expect(options.create({ title: "Nina", body: "#14 的评审写完了" })).toMatchObject({ options: { title: "Nina", body: "#14 的评审写完了" } });
    // 确认过的这一份 App 直接打开 Companion，不再问。
    expect(shell.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });

    const handle = shell.subscribeNotifications.mock.results[0]!.value as { stop: ReturnType<typeof vi.fn> };
    shell.app.emit("will-quit");
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it("leaves notifications to the daemon when Electron cannot show them", async () => {
    const shell = setup({ notifications: false });
    await shell.ready();
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();
    expect(shell.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });
  });

  // 回归（#232 实测 5）：以前 App 一起来就订阅，Electron 报 show、系统不显示时通知就丢了。
  it("does not take notifications over before the user confirms that they show, and asks after the install", async () => {
    const shell = setup({ notifications: true });
    await shell.ready();
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();
    const [window] = shell.windows;
    expect(window!.loaded).toEqual([{ kind: "file", target: join(shell.distDir, "renderer", "install.html") }]);
    const view = window!.webContents.lastView();
    expect(view.heading).toBe("Turn on notifications");
    expect(view.body).toContain("click Allow");
    expect(view.notice).toContain("Script Editor");
    expect(view.actions.map((action) => [action.id, action.primary])).toEqual([["notify-test", true], ["notify-later", false]]);
  });

  it("sends a test notification, then subscribes, opens Companion and remembers this copy when the user sees it", async () => {
    const dataDir = freshDataDir();
    const shell = setup({ notifications: true, dataDir });
    await shell.ready();
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-test");
    expect(shell.notes.map((note) => [note.options.title, note.shown])).toEqual([["Paimon", 1]]);
    expect(shell.notes[0]!.options.body).toContain("I See It");
    const sent = shell.windows[0]!.webContents.lastView();
    expect(sent.actions.map((action) => action.id)).toEqual(["notify-seen", "notify-missing"]);
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();

    await shell.invoke(IPC.act, shell.installPageUrl, "notify-seen");
    expect(shell.subscribeNotifications).toHaveBeenCalledTimes(1);
    expect(shell.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });
    expect(checkFile(dataDir).confirmedBuild).toBe("version:1.3.0");

    // 下次打开：直接订阅，直接打开 Companion。
    const next = setup({ notifications: true, dataDir });
    await next.ready();
    expect(next.subscribeNotifications).toHaveBeenCalledTimes(1);
    expect(next.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });
  });

  it("counts a click on the test notification as seeing it", async () => {
    const shell = setup({ notifications: true });
    await shell.ready();
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-test");
    shell.notes[0]!.emit("click");
    expect(shell.subscribeNotifications).toHaveBeenCalledTimes(1);
    expect(shell.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });
  });

  it("shows how to allow notifications when the user does not see the test, or when macOS refuses it", async () => {
    const shell = setup({ notifications: true });
    await shell.ready();
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-test");
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-missing");
    const missing = shell.windows[0]!.webContents.lastView();
    expect(missing.body).toContain("System Settings > Notifications > Bytezard Lead");
    expect(missing.actions.map((action) => [action.id, action.primary])).toEqual([
      ["notify-settings", true], ["notify-test", false], ["notify-later", false],
    ]);
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-settings");
    expect(shell.shell.openExternal).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.Notifications-Settings.extension");

    await shell.invoke(IPC.act, shell.installPageUrl, "notify-test");
    shell.notes[1]!.emit("failed", {}, "Notifications are not allowed for this application");
    expect(shell.windows[0]!.webContents.lastView().body).toContain("macOS refused the notification: Notifications are not allowed for this application.");
    // 旧的测试通知晚到的事件不算数。
    shell.notes[0]!.emit("click");
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();
  });

  it("opens Companion on Not Now, keeps notifications with the daemon, and asks again next time", async () => {
    const dataDir = freshDataDir();
    const shell = setup({ notifications: true, dataDir });
    await shell.ready();
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-later");
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();
    expect(shell.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });
    // Companion 打开以后，通知检查的按钮不再起作用。
    await shell.invoke(IPC.act, shell.installPageUrl, "notify-seen");
    expect(shell.subscribeNotifications).not.toHaveBeenCalled();

    const next = setup({ notifications: true, dataDir });
    await next.ready();
    expect(next.windows[0]!.webContents.lastView().heading).toBe("Turn on notifications");
  });

  // 实测 6（2026-11-04）：换了构建（签名摘要变了），系统的授权还在，通知照常显示。所以更新 App 以后不再问（用户 2026-11-05：
  // 「为什么每次重新安装或者升级都要显示」）。Electron 放弃一条通知以后才重新问。
  it("does not ask again after the App changes to another build, only after Electron gives up on a notification", async () => {
    const other = setup({ notifications: true, dataDir: confirmed(freshDataDir(), "sig:an-older-build") });
    await other.ready();
    expect(other.subscribeNotifications).toHaveBeenCalledTimes(1);
    expect(other.windows[0]!.loaded.at(-1)).toEqual({ kind: "url", target: "http://127.0.0.1:47130/" });

    const dataDir = confirmed(freshDataDir());
    const shell = setup({ notifications: true, dataDir });
    await shell.ready();
    shell.subscribeNotifications.mock.calls[0]![0].onGiveUp!();
    const next = setup({ notifications: true, dataDir });
    await next.ready();
    expect(next.subscribeNotifications).not.toHaveBeenCalled();
  });
});
