# 桌面版运行包：打包和冒烟

本文说明 P0-2 的两个脚本怎样用、产出什么。设计见 [macos-desktop-design.md](macos-desktop-design.md) 第 2 节和第 8.1 节。

## 用法

先在仓库根构建，再打包，再冒烟：

```sh
npm run build && npm run build:web
node --import tsx scripts/desktop/pack-runtime.ts --arch arm64 --version 1.3.0 --repository <owner>/<repo>
node --import tsx scripts/desktop/smoke-runtime.ts out/runtime
```

参数：

| 参数 | 说明 |
|---|---|
| `--arch` | 只接受 `arm64`。 |
| `--version` | semver，例如 `1.3.0`、`1.3.0-rc.1`。它会成为 `versions/<版本>/` 的目录名，所以不接受斜杠和 `..`。 |
| `--repository` | `owner/repo`，写进 `release.json.updateSource.repository`。CI 传 `${{ github.repository }}`，代码里不写死。 |
| `--out` | 输出目录，缺省是仓库根的 `out/`（已在 `.gitignore` 里）。 |
| `--node-dist-url` | Node 下载站，缺省是 `https://nodejs.org/dist`。只在用镜像时改。 |

脚本要求 dist 来自已提交的代码：`apps/daemon/dist/build-info.json` 写着 `dirty: true` 时拒绝打包。`release.json.sourceTree` 是这个 commit 的 tree 哈希。

如果机器要经过 HTTP 代理才能访问 nodejs.org，运行脚本时加 `NODE_USE_ENV_PROXY=1`。Node 的 `fetch` 缺省不读 `HTTPS_PROXY`。

### 在本机打一个能装的 dmg

本机打的包要排在最近一次发布之后，App 和运行包才会按新版本安装（设计文档第 8.5 节「版本号和构建号」）。`--after` 写最近发布的版本：

1. 算出版本号和构建号：`node --import tsx scripts/desktop/local-version.ts --after 1.1.0`。它输出 `{"version":"1.1.1-local.202611050930","build":"202611050930"}`。
2. 用这个版本号运行上面的 `pack-runtime.ts` 和 `smoke-runtime.ts`。
3. 在 `desktop/` 里写版本号和构建信息，再打 dmg：

   ```sh
   npm version "$VERSION" --no-git-tag-version --allow-same-version
   npm pkg set "buildInfo.build=$BUILD" "buildInfo.commit=$(git rev-parse HEAD)"
   CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist -- --mac dmg --arm64 --publish never "-c.buildVersion=$BUILD"
   ```

4. 在仓库根把 dmg 记进 manifest：`node --import tsx scripts/desktop/add-dmg.ts --manifest out/manifest.json --dmg "out/desktop/bytezard-lead-$VERSION-arm64.dmg"`。
5. 打完以后用 `git checkout -- desktop/package.json desktop/package-lock.json` 还原第 3 步的改动。

## 产出

```
out/
  runtime/                                   运行包目录，冒烟脚本直接跑它
  bytezard-lead-runtime-<版本>-arm64.tar.gz  runtime/ 的内容，解开就是 versions/<版本>/
  manifest.json                             更新检查读的清单
  bytezard-lead-sourcemaps-<版本>-arm64.tar.gz  dist 里的源码映射，不进运行包（设计文档第 7.5.7 节）
  cache/node/                                下载的 Node，哈希对得上时下次复用
```

`runtime/` 的形状和设计文档第 1.1 节一致：

- `bin/lead-agent`：nodejs.org 的 Node 二进制，版本写在 `desktop/node-version`。脚本用同一个版本目录里的 `SHASUMS256.txt` 校验下载的 tar.gz，对不上时删掉文件并失败。
  脚本用 `codesign --force --sign - --identifier com.bytezard.plc.agent` 重新做 ad-hoc 签名，去掉 Node 原来的签名，「登录项与扩展」才不把它归到「Node.js Foundation」下面（设计第 8.7 节）。
- `bin/Bytezard Lead`：指向 `lead-agent` 的软链接。launchd 的 plist 写这个路径：「允许在后台」显示它的名字 Bytezard Lead，进程名还是 `lead-agent`（设计第 8.7 节，做法 1b）。
- `bin/Bytezard Lead Memory`：指向 `lead-agent` 的软链接。supervisor 用它拉起 Hindsight 记忆服务（设计文档第 8.7 节），`ps` 里看得出是记忆服务。
- `bin/node`：指向 `lead-agent` 的软链接。
- `bin/plc`：shell 包装，用 `bin/lead-agent` 运行 `apps/cli/dist/cli.mjs`。
- `package.json`（`workspaces: []`）、`apps/daemon/package.json`、`apps/cli/package.json`：让 `projectRoot()` 和 `workspaceDir()` 照旧找到目录。
- `apps/daemon/dist/`、`apps/cli/dist/`：构建产物。`build-info.json`、`build:web` 的临时目录和源码映射（`*.map`）不复制。源码映射另打成 `bytezard-lead-sourcemaps-<版本>-arm64.tar.gz`，CI 把它挂到 release 上。
- `node_modules/`：见下一节。
- `release.json`：设计文档第 2.3 节的格式。`files` 里是 10 个关键文件的 SHA-256，列表在 `scripts/desktop/lib/release.ts` 的 `HASHED_FILES`。`components` 里是五个组成（`node`、`node_modules`、`service`、`web`、`cli`）的内容哈希，换版本时按它决定要不要重启、哪些部分不用再解（设计文档第 7.5 节）。每个文件归哪个组成见 `componentOf`；有文件不属于任何组成时打包失败。
- 压缩包的第一项是 `./release.json`：App 解包时先只读它。

`manifest.json` 的格式：

```json
{
  "schema": 1,
  "product": "bytezard-lead",
  "version": "1.3.0",
  "arch": "arm64",
  "node": "24.22.2",
  "schemaVersion": 63,
  "sourceTree": "<git tree 哈希>",
  "builtAt": "2026-11-03T08:00:00.000Z",
  "runtime": { "file": "bytezard-lead-runtime-1.3.0-arm64.tar.gz", "size": 105472554, "sha256": "<sha256>" },
  "components": { "node": "<sha256>", "node_modules": "<sha256>", "service": "<sha256>", "web": "<sha256>", "cli": "<sha256>" }
}
```

`components` 和 `release.json` 的一样。CI 打出 dmg 以后，`add-dmg.ts` 再加上 `dmg` 一项。

P1-4 会加 `shellVersion` 和 `minShellVersion`。

## node_modules 怎样来的

运行包的 `node_modules` 只有 daemon 构建的三个 external 和它们的依赖：better-sqlite3、`@earendil-works/pi-coding-agent`、`@anthropic-ai/sandbox-runtime`。列表只有一份，在 `apps/daemon/scripts/externals.ts`，`build.ts` 和打包脚本都读它。

脚本按根 `package-lock.json` 算依赖闭包，再从仓库已经装好的 `node_modules` 复制，位置和锁文件一致。设计文档第 2.1 节写的是「在暂存目录里再 `npm install --omit=dev`」，实现改成了复制，原因有三个：

- 复制出来的树和锁文件一模一样，版本不会漂。脚本逐个核对磁盘上的 `package.json` 版本和锁文件一致，不一致就失败，并提示先运行 `npm ci`。
- 不用第二次联网，better-sqlite3 也不会再下载一次预编译文件。
- CI 的 `npm ci` 和运行包用同一个 Node 版本（setup-node 读 `desktop/node-version`），所以原生模块的 ABI 一致。

复制完以后，脚本检查 `better_sqlite3.node` 和 `bin/lead-agent` 的 Mach-O 文件头是 arm64，不是时失败退出。

2026-11-03 在本机打的包：`node_modules` 里有 162 个包，`runtime/` 约 450 MB，tar.gz 约 101 MB。

## 冒烟测试做什么

`smoke-runtime.ts` 按顺序检查：

1. `bin/lead-agent node_modules/.bin/pi --version` 输出版本号。
2. `bin/plc --help` 正常退出。
3. 用 `bin/lead-agent` 启动 `apps/daemon/dist/supervisor.mjs`，60 秒内 `plc.sock` 回答 `status`。
4. `ps` 里 supervisor 和 daemon 的进程名都是 `lead-agent`。
5. 给 supervisor 发 SIGTERM（和 launchd 停服务一样），等两个进程都退出。

任何一步失败，脚本都打印 supervisor 的输出和数据目录里的日志，并以 1 退出。没停下来的进程会被杀掉。

冒烟不能碰机器上已有的服务，所以它这样隔离：

- `PLC_DATA_DIR` 和 `HOME` 都是新建的临时目录，结束后删掉。
- `PATH` 最前面放假的 `launchctl`、`security`、`osascript`、`open`。它们只记下参数，返回失败。
- 不继承调用者的 `PLC_*` 变量和 `NODE_OPTIONS`。

注意：daemon 用全新的数据目录启动时，记忆模块会对 Hindsight 的 launchd 任务执行 `launchctl bootout`，并删掉 `~/Library/LaunchAgents` 里它的 plist（`apps/daemon/src/memory-controller.ts` 的 `reconcile` → `stopService`）。launchd 的 label 不分数据目录，所以在开发机上直接用临时数据目录起 `coordinatord.mjs`（例如 `npm run smoke:daemon`）会停掉正在用的 Hindsight。冒烟脚本用假的 `launchctl` 和临时 `HOME` 挡住了这件事。

## 在受限沙箱里

PLC 执行器的沙箱不允许监听 Unix socket（`listen EPERM`），也不允许运行 `ps`。在那里：

- 冒烟脚本会停在第 3 步，报 supervisor 在 `supervisor.sock` 上 `listen EPERM`。
- `scripts/desktop/test/smoke.test.ts` 里要起 socket 的 3 个用例会被跳过，测试输出里显示为 skipped。

## desktop-install 的进度输出

App 解出运行包、切好 `current` 以后运行（P0-3，设计文档第 4.2 节）：

```sh
"<安装根>/current/bin/lead-agent" "<安装根>/current/apps/daemon/dist/ops.mjs" desktop-install --root "<安装根>/current" --locale zh --progress-json
```

- `--root` 必须正好是 `<安装根>/current`。`<安装根>` 是 `installRoot()`（`packages/core/src/config.ts`），等于 `dataDir()` 下的 `runtime/`。P0-8 改数据目录以后，它就是 `~/Library/Application Support/Bytezard Lead/runtime`。
- `--locale` 是 `en` 或 `zh`，缺省是 `en`。安装时还没有库，读不到用户选的界面语言。文案在 `packages/supervisor/src/deploy/desktop-install.messages.ts`。
- stdout 每行一个 JSON：`{step, state, message}`，失败时带 `code`，最后一行带 `gatewayUrl`。`detect` 做完的那一行带 `takeover`（`pre_rename`、`dev`、`upgrade`），换了版本时还带 `update`（`none`、`web`、`service`、`schema`，设计文档第 7.5.2 节）。装好时 `install-state.json` 记下 `installedVersion` 和后台服务跑在哪个版本上（`serviceVersion`）。同样的内容写进 `<安装根>/install-state.json`，失败时 `lastError.detail` 里有 launchctl 的原文。
- 退出码：0 是装好了，或者发现了开发安装；1 是失败；2 是参数不对。

步骤按顺序是：

| step | 做什么 | 可能的 code |
|---|---|---|
| `preflight` | 同时只跑一个（`<安装根>/install.lock`）；`--root` 的位置、`release.json` 和文件哈希、数据目录里 socket 路径的长度（最多 103 字节） | `install_running`、`root_invalid`、`release_invalid`、`socket_path_too_long` |
| `detect` | 认出已有的是哪种安装（设计文档第 12.2 节）；库比运行包新时不装。设了 `PLC_KEEP_DEV_INSTALL=1` 时保留开发安装、直接打开它 | `schema_ahead`、`dev_install_detected`（退出码 0） |
| `takeover` | 自动接管存量安装：改名以前的、跑开发 checkout 的、换了版本的（设计文档第 12 节）。没有要接管的时，或者换版本时服务没变（`none`、`web`），是 `skipped`。进度行带 `phase`（迁移模块的步骤） | `takeover_refused`（什么都没改）、`takeover_failed`（停服务以前失败，什么都没改）、`takeover_rolled_back`、`takeover_rollback_failed` |
| `login_shell_path` | 读登录 shell 的 PATH，写进 `<数据目录>/login-shell-path.json`。读不到时是 `skipped`，安装继续 | `login_shell_path_unavailable` |
| `launchd` | 写 plist，bootout 再 bootstrap。plist 没变、服务在跑时不重启 | `launchd_unchanged`、`launchd_bootstrap_failed` |
| `supervisor` | 等 `supervisor.sock` 回答（60 秒） | `supervisor_timeout` |
| `daemon` | 发 `ensure_running`，等 `plc.sock` 回答 `status`（和 supervisor 一样最多 10 分钟，`ensure_running` 多等 30 秒） | `daemon_refused`、`daemon_timeout` |
| `done` | 带 `gatewayUrl` | |

任何一步遇到 `ENOSPC` 时 code 是 `disk_full`，别的意外错误是 `unexpected`。

另外两个命令：

- `ops.mjs login-shell-path`：只重新读一次登录 shell 的 PATH。App 每次打开时运行，输出一行 `{state, saved, directories}`。
- `ops.mjs selfcheck`：能加载 better-sqlite3，能读 `release.json`。换版本以前，用新版本自己的 `lead-agent` 运行它。
