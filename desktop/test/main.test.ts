// Electron 主进程（设计第 4、8.4 节，P0-4）。Electron 换成假的：只记下主进程对它做了什么。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function fakeElectron(o: { packaged?: boolean; inApplications?: boolean; languages?: string[] } = {}) {
  const order: string[] = [];
  const windows: FakeWindow[] = [];
  const handlers = new Map<string, Listener>();
  const headerHooks: Array<{ filter: { urls: string[] }; listener: Listener }> = [];
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
    quit: vi.fn(),
  });
  const electron = {
    app,
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel: string, handler: Listener) => handlers.set(channel, handler) },
    shell: { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => "") },
    clipboard: { writeText: vi.fn() },
    Menu: { buildFromTemplate: vi.fn((template: unknown) => template), setApplicationMenu: vi.fn() },
    session: {
      defaultSession: {
        webRequest: { onBeforeSendHeaders: (filter: { urls: string[] }, listener: Listener) => headerHooks.push({ filter, listener }) },
      },
    },
  };
  return {
    electron: electron as unknown as ShellElectron,
    app,
    shell: electron.shell,
    clipboard: electron.clipboard,
    order,
    windows,
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

function setup(o: Parameters<typeof fakeElectron>[0] & { install?: ShellOptions["runInstall"] } = {}) {
  const dataDir = join(tempDir("plc-desktop-main-"), "Application Support", "Bytezard Lead");
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
  });
  const installPageUrl = pathToFileURL(join(distDir, "renderer", "install.html")).href;
  return { ...fake, dataDir, distDir, runInstall, collectDiagnostics, installPageUrl };
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

  it("offers retry, logs and diagnostics after a failure", async () => {
    const shell = setup({ install: async () => progress("failed", { error: { code: "release_invalid", message: "damaged" } }) });
    await shell.ready();
    const view = shell.windows[0]!.webContents.lastView();
    expect(view.actions.map((action) => action.id)).toEqual(["retry", "logs", "diagnostics"]);

    await shell.invoke(IPC.act, shell.installPageUrl, "retry");
    expect(shell.runInstall).toHaveBeenCalledTimes(2);
    // desktop-install 说运行包坏了：重试时重新解包。
    expect(shell.runInstall.mock.calls[1]![2]).toEqual({ forceUnpack: true });

    await shell.invoke(IPC.act, shell.installPageUrl, "logs");
    expect(shell.shell.openPath).toHaveBeenCalledWith(join(shell.dataDir, "logs"));

    await shell.invoke(IPC.act, shell.installPageUrl, "diagnostics");
    expect(shell.clipboard.writeText).toHaveBeenCalledWith("doctor output\n");
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
