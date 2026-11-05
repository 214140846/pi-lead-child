// Electron 的入口（package.json 的 main 指向它的构建产物 dist/main.cjs）。逻辑都在 main.ts，这里只把真的 electron 交给它。
import * as electron from "electron";
import { runtimeDirFor, startShell } from "./main.js";
import { NOTIFICATION_PROBE_ARG, runNotificationProbe } from "./notification-probe.js";

// --notification-probe：P0-7 的实测工具，只发一条测试通知（notification-probe.ts）。
if (process.argv.includes(NOTIFICATION_PROBE_ARG)) runNotificationProbe(electron);
else startShell(electron, { distDir: __dirname, runtimeDir: runtimeDirFor(electron.app, process.resourcesPath) });
