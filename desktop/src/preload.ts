// 网页能看到的壳的东西（设计第 8.4 节）：只有几个值和几个按钮，不暴露 Node 能力。
//   - 所有网页：window.bytezardLead.shellVersion（App 版本）。
//   - 网关的网页（http:）：window.bytezardLead.update，App 的一键更新（updater.ts）：读状态、收状态的变化、「更新」「以后」；
//     window.bytezardLead.about()：版本、构建号、提交和运行包的版本（build-info.ts，设置 → 本设备用）。
//   - 只有安装页（file:）：window.bytezardInstaller，读安装页的画面、点按钮。
// 主进程按发送方的地址再查一遍。IPC 的名字和 main.ts 的 IPC 一样（preload 单独打包，不 import main.ts）。
import { contextBridge, ipcRenderer } from "electron";

const SHELL_VERSION_ARG = "--bytezard-shell-version=";
const shellVersion = process.argv.find((arg) => arg.startsWith(SHELL_VERSION_ARG))?.slice(SHELL_VERSION_ARG.length) ?? null;

const update = globalThis.location?.protocol === "file:" ? null : Object.freeze({
  get: () => ipcRenderer.invoke("update:get"),
  apply: () => ipcRenderer.invoke("update:apply"),
  dismiss: () => ipcRenderer.invoke("update:dismiss"),
  onStatus: (callback: (status: unknown) => void) => {
    ipcRenderer.on("update:status", (_event, status: unknown) => callback(status));
  },
});

const about = globalThis.location?.protocol === "file:" ? null : () => ipcRenderer.invoke("shell:about");

contextBridge.exposeInMainWorld("bytezardLead", Object.freeze({ shellVersion, update, about }));

if (globalThis.location?.protocol === "file:") {
  contextBridge.exposeInMainWorld("bytezardInstaller", Object.freeze({
    getView: () => ipcRenderer.invoke("installer:get-view"),
    onView: (callback: (view: unknown) => void) => {
      ipcRenderer.on("installer:view", (_event, view: unknown) => callback(view));
    },
    act: (action: string) => ipcRenderer.invoke("installer:act", action),
  }));
}
