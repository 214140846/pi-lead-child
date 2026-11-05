# 桌面版的 Electron 壳

本文说明 P0-4 的壳怎样构建、启动时做什么。设计见 [macos-desktop-design.md](macos-desktop-design.md) 第 4 节和第 8.4 节。

## 构建

壳在仓库根的 `desktop/`，有自己的 `package.json` 和 lockfile，不进根目录的 workspaces。

```sh
cd desktop
npm ci
npm run build        # esbuild 输出到 desktop/dist/
npm run typecheck
npm run dist         # electron-builder，输出到仓库根的 out/desktop/
```

- 打包前先在仓库根运行 `scripts/desktop/pack-runtime.ts`（见 [runtime-bundle.md](runtime-bundle.md)）。electron-builder 把 `out/bytezard-lead-runtime-<版本>-arm64.tar.gz` 放进 App 的 `Contents/Resources/runtime/`。
- 测试跑在根 vitest 里：`npx vitest run desktop/test`。测试不加载 Electron，主进程拿到的是假的 `electron` 对象。
- 开发时用 `npm start`（`electron .`）。这时不检查 App 在不在「应用程序」里，运行包从仓库根的 `out/` 找。

2026-11-03 用 `electron-builder --mac dir --arm64` 本地打过一次：Info.plist 的 `CFBundleName` 是 `Bytezard Lead`，`CFBundleIdentifier` 是 `com.bytezard.plc`，签名是 ad-hoc。

## dmg 和安装说明

发版时 `.github/workflows/release-macos.yml` 打 dmg，步骤见 [release-notes-template.md](release-notes-template.md)。本地打 dmg 用 `npm run dist -- --mac dmg --arm64 --publish never`，附件名是 `bytezard-lead-<版本>-arm64.dmg`，版本号取 `desktop/package.json`。

- 安装说明的文字只有一份：`desktop/src/install-guide.messages.ts`，有 `en` 和 `zh`。`README.md`、`README.zh-CN.md` 和 release 说明模板里标出的那一段由它生成。改了文字以后，在仓库根运行 `node --import tsx desktop/scripts/install-guide.ts`。
- dmg 的背景图是 `desktop/assets/dmg-background.png` 和 `@2x`，文字也来自同一个文件。窗口尺寸和图标位置在 `desktop/src/dmg-background.ts` 的 `DMG_LAYOUT`，要和 `electron-builder.yml` 的 `dmg` 一致。改了文字或布局以后，在仓库根运行 `node --import tsx desktop/scripts/dmg-background.ts` 重画（要用 macOS 自带的 `swift`）。
- 两处都有测试核对：文件里的内容和生成的不一致时，`desktop/test/install-guide.test.ts` 或 `dmg-config.test.ts` 失败。

PLC 执行器的沙箱里，`hdiutil create` 报 `Device not configured`，所以那里只能打到 `.app`，打不出 dmg。

## 启动时做什么

1. 在 `ready` 和单实例锁之前，把 Electron 的 `userData` 设到 `<数据目录>/shell`。
2. 打开窗口，先显示安装页。窗口标题是上次记下的 Lead 名字，第一次是 `Paimon`。
3. App 打包后不在「应用程序」里时，安装页只给一个按钮「移动并重新打开」，它调用 `app.moveToApplicationsFolder()`。
4. 运行包不比已装的新，launchd 的 plist 指向这份 App 的 `<安装根>/current`，并且 `plc.sock` 回答 `status` 时，直接打开网关，不重新安装。同时在后台运行一次 `ops.mjs login-shell-path`。
5. 否则先解包（只在 App 带的运行包比已装的新时），再运行 `ops.mjs desktop-install`，按它每行一个 JSON 的进度更新安装页。遇到存量安装时，安装页多一行「接手已有的数据和设置」（设计文档第 12.7 节）。
6. 拿到 `gatewayUrl` 以后，窗口加载 `<gatewayUrl>/`。

解包的顺序：

1. 删掉上次中途退出留下的 `versions/<版本>.partial/`。
2. 用 `/usr/bin/tar` 解到 `.partial`。
3. 校验 `release.json`：`product`、`version`、`arch`、`files` 里每个文件的 SHA-256。
4. 运行 `xattr -dr com.apple.quarantine <.partial 目录>`，用 `execFile`，不经 shell。
5. `rename` 成 `versions/<版本>/`，再用临时软链接 `rename` 覆盖 `current`。

任何一步失败都删掉 `.partial`，`current` 不变。壳自己的步骤失败时写进 `<安装根>/install-state.json`。

## 拿凭证

窗口里的 Companion 网页靠回环自动配对拿凭证（2026-11-03 定，P0-4 返工）：

1. 发布模式（运行包根目录有 `release.json`）下，daemon 缺省打开回环自动配对，并在数据目录写 `shell-pairing.key`（0600，64 位十六进制）。
2. 壳打开网关时读这个文件，给发往网关的请求加 `x-bytezard-shell-pairing` 头。只有和网关同源的请求带它。
3. 网关只给带对口令的请求配对。

为什么不直接打开：回环端口不分系统用户，`Origin` 也能伪造（`docs/ARCHITECTURE.md`）。只看 `Origin` 时，同一台 Mac 上别的系统用户也能配上。口令文件只有本机这个用户读得到。执行器的沙箱禁读它，Lead 的凭证守卫按 `*.key` 拦它。

开发机不变：`PLC_DEV=1` 或 `PLC_ALLOW_LOOPBACK_AUTO_PAIR=1` 时照旧打开，不要口令；显式的 `PLC_ALLOW_LOOPBACK_AUTO_PAIR` 在发布模式下也以它为准。

## 等多久

`desktop-install` 等服务就绪的期限和 supervisor 一样：`DEFAULT_DAEMON_READY_TIMEOUT_MS`（10 分钟），`ensure_running` 再多等 30 秒（`ensureRunningTimeoutMs`）。等过了报「服务还在启动」（`daemon_timeout`），不报被拒绝。判断服务是不是已经在跑只看 `supervisor.sock` 能不能连上，不等 `status` 的回答：机器忙时按回答判断，会把在跑的服务停掉重装。壳自己不给 `desktop-install` 设期限。

## 失败时

安装页显示一句原因和三个按钮：

| 按钮 | 做什么 |
|---|---|
| 重试 | 整个流程再跑一遍。上一次 desktop-install 报 `release_invalid` 时，这次重新解包，不管版本号。 |
| 查看日志 | 打开 `<数据目录>/logs/`。 |
| 复制诊断信息 | 运行 `ops.mjs doctor`，加上 `install-state.json`，复制到剪贴板。 |

desktop-install 每一步的说明来自运行包（`--locale` 按系统的首选语言传 `zh` 或 `en`）。壳自己的文字在 `desktop/src/shell.messages.ts`。

## 窗口

- `contextIsolation` 开，`sandbox` 开，`nodeIntegration` 关，不允许 `<webview>`。
- 和网关同源的地址在窗口里打开。其他 `https:` 链接交给系统浏览器。其他协议都拒绝。
- preload 给所有网页一个只读的 `window.bytezardLead.shellVersion`。安装 IPC（`window.bytezardInstaller`）只给安装页（`file:`），主进程也按发送方的地址检查。
- 窗口标题跟着网页标题走。Companion 把 `document.title` 设成 Lead 名字（`apps/companion/src/components/DocumentTitle.tsx`），壳把它记在 `<数据目录>/shell/lead-name.json`，给下次的安装页用。网页没设标题时，窗口用记下的名字。
- 关掉窗口就退出 App。后台服务照旧在跑。

## 在受限沙箱里

PLC 执行器的沙箱不允许 Electron 注册 mach 端口，App 启动即退出（`bootstrap_check_in … Permission denied`）。在那里只能跑单元测试和 `electron-builder --mac dir`。

## 通知

App 开着时，桌面通知由壳发出（设计第 8.6 节路径 A，`desktop/src/notifications.ts`）：

1. `ready` 以后，如果 `Notification.isSupported()`，壳连 `<数据目录>/plc.sock`，发 `subscribe_desktop_notifications`，带 `shell-pairing.key` 的口令。
2. daemon 每条通知推一行 `{type:"desktop_notification", title, body}`。`title` 是用户配置的 Lead 名字。壳用 Electron 的 `Notification` 发出；用户点通知时，窗口回到前面。
3. daemon 没起来、重启了、或者还没有口令时，壳每 5 秒重连一次。
4. Electron 发某一条失败（`failed` 事件）时，壳发 `desktop_notification_failed` 把正文交回 daemon，daemon 用 osascript 补发。壳随后退订，这次运行里不再订阅。
5. App 退出时连接断开，daemon 改回自己用 osascript 发。

实测工具：`open "Bytezard Lead.app" --args --notification-probe` 只发一条测试通知，结果写进 `$TMPDIR/bytezard-lead-notification-probe.json`。步骤见 [p0-7-measurements.md](p0-7-measurements.md)。
