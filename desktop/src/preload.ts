// 网页能看到的壳的东西（设计第 8.4 节）：只有几个只读值，不暴露 Node 能力。
//   - 所有网页：window.bytezardLead.shellVersion（App 版本）。P1-4 再加「壳有没有新版」。
//   - 只有安装页（file:）：window.bytezardInstaller，读安装页的画面、点按钮。主进程也按发送方的地址再查一遍。
import { contextBridge, ipcRenderer } from "electron";

const SHELL_VERSION_ARG = "--bytezard-shell-version=";
const shellVersion = process.argv.find((arg) => arg.startsWith(SHELL_VERSION_ARG))?.slice(SHELL_VERSION_ARG.length) ?? null;

contextBridge.exposeInMainWorld("bytezardLead", Object.freeze({ shellVersion }));

if (globalThis.location?.protocol === "file:") {
  contextBridge.exposeInMainWorld("bytezardInstaller", Object.freeze({
    getView: () => ipcRenderer.invoke("installer:get-view"),
    onView: (callback: (view: unknown) => void) => {
      ipcRenderer.on("installer:view", (_event, view: unknown) => callback(view));
    },
    act: (action: string) => ipcRenderer.invoke("installer:act", action),
  }));
}
