# P0-7 实测：通知和登录项

本文是 P0-7 的实测步骤和记录。设计见 [macos-desktop-design.md](macos-desktop-design.md) 第 8.6 节和第 11 节。

PLC 执行器的沙箱里做不了这些实测：

- `osascript` 发通知时报 `NSNotificationCenter connection invalid`。
- Electron 启动时报 `bootstrap_check_in com.bytezard.plc.MachPortRendezvousServer: Permission denied`。
- `open` 和 `launchctl bootstrap` 被沙箱拦住。

所以实测要在沙箱外、在一台 Apple 芯片的 Mac 上做。每一步都要截图。

## 要准备的东西

1. 打一个 ad-hoc 签名的 App。在仓库根运行：

   ```sh
   cd desktop && npm ci && npm run build
   CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config desktop-builder.yml --mac dir --arm64 --publish never
   ```

   App 在 `out/desktop/mac-arm64/Bytezard Lead.app`。`codesign -dv` 应该显示 `Signature=adhoc`、`Identifier=com.bytezard.plc`。

2. 记下 macOS 版本：`sw_vers`。

## 实测 1：ad-hoc 签名的 App 能不能发 Electron 通知

1. 运行：

   ```sh
   open "out/desktop/mac-arm64/Bytezard Lead.app" --args --notification-probe
   ```

   App 不装服务、不开窗口。它发一条标题是 Lead 名字（第一次是 `Paimon`）的测试通知，20 秒后自己退出。
2. 如果 macOS 问要不要允许 Bytezard Lead 发通知，点「允许」，并截图。
3. 截图：通知有没有弹出来。
4. 打开通知中心，截图：这条通知的来源显示什么。
5. 20 秒后读结果：

   ```sh
   cat "$TMPDIR/bytezard-lead-notification-probe.json"
   ```

   `events` 里有 `show` 说明 Electron 发出去了；有 `failed` 说明没发出去，`error` 是原因。
6. 打开「系统设置 → 通知」，截图：列表里有没有 `Bytezard Lead`。

## 实测 2：LaunchAgent 的登录项名字，和 osascript 通知的来源

探测脚本装一个单独的 LaunchAgent（label `com.bytezard.plc.probe`），不碰正在运行的服务。它用本机 Node 的改名副本 `lead-agent` 启动，和运行包里的 `bin/lead-agent` 一样带 Node 官方的签名。它起来以后用 osascript 发一条通知，参数和 daemon 一样。

1. 运行：

   ```sh
   sh scripts/desktop/probe-login-item.sh install
   ```

   脚本打印 `lead-agent` 的签名（`Authority=` 那几行）。把它记下来。
2. 截图：macOS 弹出的「已添加后台项目」通知，上面显示的名字。
3. 打开「系统设置 → 通用 → 登录项与扩展」，截图：「允许在后台」里这一项显示的名字。
4. 截图：标题是 `Paimon` 的测试通知，以及它在通知中心里的来源。
5. 看完以后运行下面的命令，删掉 label、plist 和目录：

   ```sh
   sh scripts/desktop/probe-login-item.sh remove
   ```

## 记录

实测以后，把结果填进下表，截图附在工单 #205 里，再按第 8.6 节的规则选路径。

| 项目 | 结果 | 截图 |
|---|---|---|
| macOS 版本 | 27.2（26B123） | |
| Electron 通知有没有弹出 | 第一轮（授权前）：没弹出，桌面和通知中心都没有。授权后重跑：弹出了，很快消失，和样式 Temporary（横幅）一致 | 截图见 Lead 会话，Lead 已转述 |
| 有没有 `failed` 事件，原因 | 两次都没有。第一轮 events 是 `called show()`@1ms、`show`@43ms；授权后那次也有 `show`，没有 `failed` | probe JSON（第一轮原文见下；授权后那次由 Lead 转述） |
| Electron 通知在通知中心里的来源 | 实测 5（2026-11-04 17:13）：probe 有 `show`，没有 `failed`，但通知中心里**没有这一条**，横幅也没看到；`ncprefs` 里没有 `com.bytezard.plc` 的记录。推测这次的 App 从来没有申请到通知授权。实测 1 时「系统设置 → 通知」里列出过 Bytezard Lead，这次为什么没有记录，没查。记成遗留风险，见设计文档第 8.6、11 节。（15:57 那次主人看到过一条测试通知，看完删了，来源没有记下来） | `~/.pi-lead-child/lead-scratch/p0-7-p9-20261104-171257.png`（菜单栏当前 App 是 Bytezard Lead，没有横幅） |
| osascript 通知在通知中心里的来源 | 实测 5（主人 17:19 截图确认）：通知中心里有这一条，标题 Paimon，正文「实测 5：osascript 通知来源」，图标是脚本编辑器的通用图标，没有单独的 App 名，不显示 Bytezard Lead。这次横幅没有弹出，原因没查（可能是专注模式，或者脚本编辑器的提醒样式）。实测 2 时横幅弹出过 | 主人 17:19 的通知中心截图，在 Lead 会话里，Lead 已转述 |
| 「已添加后台项目」通知里的名字 | 实测 2–4 没有出现这条通知。实测 5（1b）出现了系统的「App Background Activity」通知，原文「"Bytezard Lead" can run in the background」 | `~/.pi-lead-child/lead-scratch/p0-7-p9-20261104-171257.png`（右上角） |
| 「登录项与扩展」里的名字 | 改之前：「允许在后台」里显示 **Node.js Foundation**（Running in background），图标是通用占位图；不显示 `lead-agent`，也不显示 Bytezard Lead。改之后（实测 3 的 p5，交付的做法）：设置页显示 **`lead-agent`**（可执行文件名），图标是通用的可执行文件图标；`sfltool dumpbtm` 的 Name 写的是 Bytezard Lead，和设置页不一致。交付的做法 1b（实测 5 的 p9）：列表第一行显示 **Bytezard Lead**，图标带替身箭头，状态 Running，不在「Node.js Foundation」下面 | 改之前、实测 3：截图在 Lead 会话里，Lead 已转述。1b：`~/.pi-lead-child/lead-scratch/p0-7-p9list-cropped.png` |
| `lead-agent` 的签名 | `Identifier=node`、`TeamIdentifier=HX7739G8FX`（Node 官方签名） | 脚本输出 |

实测 1–3 的截图在主人那里，主人发在 Lead 的会话里，工单附不上，那几轮的观察来自 Lead 的转述。实测 4、5 的截图由 Lead 在主机上用 `screencapture` 截（主人已给主机上的 node 开了屏幕录制权限），存在本机的 `~/.pi-lead-child/lead-scratch/`，不进仓库。p9 登录项列表那张只保留设置窗口：原图里有私人聊天窗口，Lead 裁掉后删了原图。

## 第一轮观察（2026-11-04）

实测 1，`--notification-probe`：

- 第一次运行时，macOS 弹出权限卡「"Bytezard Lead" Notifications」。卡上的名字是 Bytezard Lead，图标是缺省的 Electron 图标：打包时没设 App 图标（构建日志写着 `default Electron icon is used`）。主人点了 Allow。
- 「系统设置 → 通知」里列出了 Bytezard Lead：允许通知已打开，Desktop、Notification Center、Lock Screen 都勾上，样式是 Temporary。
- probe JSON：`supported=true`，`title=Paimon`，events 是 `called show()`@1ms、`show`@43ms，没有 `failed`。
- 但是桌面上没看到这条通知，通知中心里也没有。推测：这次通知发出时还没授权，Electron 交给了系统，系统没有显示。授权后有没有重跑，还没确认。
- Electron 的 `show` 事件只说明通知交给了系统，不说明系统显示了它。

实测 2，`probe-login-item.sh install`：

- `plutil` 检查 plist 通过。`lead-agent` 是 `~/.nvm/versions/node/v24.22.1/bin/node` 的副本，签名是 `Identifier=node`、`TeamIdentifier=HX7739G8FX`。
- osascript 发的通知弹出了：标题 Paimon，正文是探测脚本的测试文字。图标是脚本编辑器那类通用图标，不是 Bytezard Lead。现在 daemon 发的 `pi-lead-child` 通知也是这个图标。
- 没有出现「已添加后台项目」（Background Items Added）通知。
- 同时出现两条系统提示，都把进程叫作 `node`，不叫 `lead-agent`：
  - 「Privacy & Security: "node" was prevented from modifying apps on your Mac.」
  - 「Data Access Blocked: "node" tried to access your data from other apps and was blocked」
- 探测脚本只用 osascript 发一条通知，然后空等。它不读别的 App 的数据，也不改 App。所以这两条提示是谁触发的，还没确认。可能是探测用的 `lead-agent`，也可能是同一时间开发机上别的 `node` 进程（开发版的 daemon 和执行器用的是同一个签名）。要查 TCC 日志才能确定。

当时的推断，和后来的核实情况：

- 「把 Node 改名为 `lead-agent` 不够，后台项目按代码签名的开发者归类」：**已核实**。实测 2 里改名后的副本归到「Node.js Foundation」下面；实测 3、4 里重签以后不再归到它下面。
- 「没有出现『已添加后台项目』通知，是因为开发机上已经有同一个开发者签名的后台项」：**没有核实**。这台机器装了 MDM 和安全软件，也可能是它们压掉了提示。

## 第二轮观察（2026-11-04）

实测 1，授权后重跑 `--notification-probe`：

- 通知弹出了，很快消失，和样式 Temporary（横幅）一致。probe 收到 `show`，没有 `failed`。
- 所以第一轮没弹出，是因为当时还没授权：系统收下了通知（`show` 事件），但没有显示。
- 结论：ad-hoc 签名的 App 在用户授权后能用 Electron 发通知。按下面的规则选路径 A。

实测 2，`probe-login-item.sh install`：

- macOS 27.2（26B123）。
- 「系统设置 → 通用 → 登录项与扩展 → 允许在后台」里，这一项显示为 **Node.js Foundation**（Running in background，开关打开），图标是通用占位图。它不显示 `lead-agent`，也不显示 Bytezard Lead。原因是 `lead-agent` 用的还是 Node 官方的签名（Team ID `HX7739G8FX`），只改了文件名。
- 「Node.js Foundation」这一项可能也包含开发机上 daemon 本来用的 node，不一定只有探测服务。remove 探测服务后再看一次就能确认。
- 仍然没有出现「已添加后台项目」通知。这台机器装了 MDM 和安全软件，提示可能被压掉了，也可能是同一个开发者已经有后台项。没有验证。
- 卸掉探测服务以后，「Node.js Foundation」还在：它包含开发机上原有的 supervisor 和 hindsight（也用 Node 运行）。
- 结论和改法见设计文档第 8.7 节。

## 还要补的

1. 两条 `node` 隐私提示是谁触发的：待补。在终端（沙箱外）运行下面的命令，只发回输出里的进程路径和服务名：

   ```sh
   log show --last 3h --style compact --predicate 'subsystem == "com.apple.TCC"' | grep -iE "AppData|AppBundles" | tail -40
   ```

## 实测 3：登录项显示 Bytezard Lead（P0-7 返工）

用户 2026-11-04 13:35 定：登录项要显示成 Bytezard Lead。做法见设计文档第 8.7 节：Node 放进 `Bytezard Lead.app` 程序包，重新做 ad-hoc 签名，plist 加 `AssociatedBundleIdentifiers`。

实测工具 `scripts/desktop/probe-btm.ts` 一次装 5 个探测项（label `com.bytezard.plc.probe-p1` … `p5`），不碰正在运行的服务。每个探测项的名字各不相同，看「允许在后台」里出现了哪个名字，就知道系统用的是哪一项：

| 探测项 | 做法 | 可能显示的名字 |
|---|---|---|
| p1 | 程序包 + ad-hoc 重签 | `P1 Folder`（目录名）、`P1 BundleName`、`P1 DisplayName`、`p1-exec`（程序名） |
| p2 | 同 p1，plist 加 `AssociatedBundleIdentifiers=com.bytezard.plc` | Bytezard Lead（App 的名字），或者 p2 的几个名字之一 |
| p3 | 不放进程序包，只 ad-hoc 重签 | `p3-exec` 或签名标识 |
| p4 | 保留 Node 官方签名，plist 加 `AssociatedBundleIdentifiers` | Bytezard Lead，或者 Node.js Foundation |
| p5 | 和运行包完全一样（要交付的样子） | Bytezard Lead |

在仓库根、沙箱外运行（Lead 用 `run_on_host` 代跑）。要用 Node 24，并且已经打开过一次 `out/desktop/mac-arm64/Bytezard Lead.app`，系统才认得 `com.bytezard.plc`：

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
node --import tsx scripts/desktop/probe-btm.ts install
sleep 15
node --import tsx scripts/desktop/probe-btm.ts status
```

`install` 会打开「系统设置 → 通用 → 登录项与扩展」。请主人截图「允许在后台」里 p1 到 p5 显示的名字。`status` 打印每个探测项的签名、launchd 状态、`sfltool dumpbtm` 里它们的记录（只打印探测项的记录；要管理员权限时会说明），以及聚焦搜索里有没有程序包。看完运行：

```sh
node --import tsx scripts/desktop/probe-btm.ts remove
```

判断：

- p5 显示 Bytezard Lead：做法成立，不用再改。
- p5 不显示 Bytezard Lead：看 p1 到 p4 显示什么，再决定改程序包的哪个名字，或者回到设计文档第 8.7 节的方向 b（`SMAppService`）。

### 实测 3 的结果（2026-11-04）

Lead 用 `run_on_host` 代跑了 `install` 和 `status`，得到 `sfltool dumpbtm` 的记录。主人 15:57 截了「允许在后台」的图（截图见 Lead 会话，Lead 已转述）。**设置页和 `sfltool` 的 Name 不一致，以设置页截图为准。** 之前只根据 `sfltool` 写的结论「名字取自目录名，p5 显示 Bytezard Lead」是错的，这里改正。

| 探测项 | 签名 | 设置页显示的名字（截图） | `sfltool` 的 Name | 开发者名 | Disposition |
|---|---|---|---|---|---|
| p1 | ad-hoc，`com.bytezard.plc.probe-p1` | `p1-exec` | `P1 Folder` | (null) | enabled, allowed, notified |
| p2 | ad-hoc，`com.bytezard.plc.probe-p2` | `p2-exec` | `P2 Folder` | (null) | enabled, allowed, notified |
| p3 | ad-hoc，`com.bytezard.plc.probe-p3` | `p3-exec` | `p3-exec` | (null) | enabled, allowed, notified |
| p4 | Node 官方（`node`，`HX7739G8FX`） | 没有单独一行，推测合进了「Node.js Foundation」（截图没截到那一行） | `p4-exec` | Node.js Foundation | enabled, allowed, not notified |
| p5 | ad-hoc，`com.bytezard.plc.agent` | **`lead-agent`**，通用的可执行文件图标，Running | `Bytezard Lead` | (null) | enabled, allowed, notified |

聚焦搜索里查不到 `com.bytezard.plc.agent`。

结论：

- 设置页显示的是**可执行文件名**。程序包的目录名、`CFBundleName`、`CFBundleDisplayName` 都不起作用（p1、p2、p5）。
- `AssociatedBundleIdentifiers` 在 ad-hoc 签名和 Node 官方签名下都不起作用（p2、p4）。
- 交付的做法（p5）显示 `lead-agent`，不是 Bytezard Lead。设计文档第 8.7 节的方向 a 只做到了一半：去掉了「Node.js Foundation」，没有显示 Bytezard Lead。下一步见实测 4。

同一次，Lead 在沙箱外运行了 `npx vitest run apps/daemon/test/desktop-notifier.test.ts packages/supervisor/test/supervisor.test.ts packages/supervisor/test/single-owner.test.ts`：3 个文件、40 条测试全部通过。

上一次代跑时，`install` 在最后一步等了 180 秒才结束。现在脚本里每个子命令最多等 30 秒，超时就记成失败，接着做下一步。

## 按结果选路径

- Electron 通知弹出、来源是 `Bytezard Lead`：选路径 A。代码已经按路径 A 写好，不用再改。
- Electron 通知收到 `failed`：路径 A 的代码自动退回 B1（壳把这条交回 daemon，daemon 用 osascript 补发，壳随后退订），通知不会丢。要做到「来源显示 App 名」，只剩 B2。选 B2 之前先回来问用户（第 10 节 P0-7）。
- 授权后仍然只有 `show`、没有 `failed`，通知却不显示：自动退回不会触发，App 开着时通知会静默丢失。这时路径 A 不成立，要改代码（改用 B1，或者回来问 B2）。第二轮实测没有出现这种情况：授权后通知弹出来了。
- 「登录项与扩展」里显示的是 Node 签名里的开发者名，而不是 `lead-agent`：写进第 11 节，并提出下一步。第二轮实测就是这种情况（显示 Node.js Foundation），改法见设计文档第 8.7 节。

## 实测 4：可执行文件直接叫 Bytezard Lead（P0-7 返工）

实测 3 证明设置页显示的是可执行文件名。实测 4 看设计文档第 8.7 节的方案 1：可执行文件直接叫 Bytezard Lead 行不行，以及能不能用软链接，让登录项显示 Bytezard Lead、进程名仍是 `lead-agent`（第 9 节决定 6）。

| 探测项 | 做法 | 设置页可能显示 | 进程名可能是 |
|---|---|---|---|
| p5 | 对照组：实测 3 的交付做法 | `lead-agent` | `lead-agent` |
| p6 | 不放进程序包，ad-hoc 重签，可执行文件叫 `Bytezard Lead P6` | `Bytezard Lead P6` | `Bytezard Lead P6` |
| p7 | 真实文件叫 `Bytezard Lead P7`，plist 写指向它的软链接 `lead-agent-p7` | 两个名字之一 | 两个名字之一 |
| p8 | 真实文件叫 `lead-agent-p8`，plist 写指向它的软链接 `Bytezard Lead P8` | 两个名字之一 | 两个名字之一 |

名字里带 P6、P7、P8，截图里才分得清是哪一项。`status` 会打印每个探测项的进程名：`ucomm` 是内核记的短名字，`comm` 是可执行文件的路径。脚本只打这两列，不打参数和环境变量。

已知的一点：Node 的 `process.execPath` 会解开软链接，返回真实路径（2026-11-04 在执行器里实测）。supervisor 用 `process.execPath` 拉起 daemon，所以 daemon 的进程名跟着真实文件名走。

在仓库根、沙箱外运行（Lead 用 `run_on_host` 代跑）。截图由 Lead 截，不用主人动手：

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
node --import tsx scripts/desktop/probe-btm.ts install p5 p6 p7 p8
sleep 15
node --import tsx scripts/desktop/probe-btm.ts status p5 p6 p7 p8
open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
sleep 3
screencapture -x "$HOME/.pi-lead-child/lead-scratch/p0-7-btm-$(date +%Y%m%d-%H%M%S).png"
node --import tsx scripts/desktop/probe-btm.ts remove p5 p6 p7 p8
```

- `screencapture` 要「屏幕录制」权限。没有权限时，截出来的图里只有桌面背景，没有窗口内容。
- 「允许在后台」的列表可能要往下翻，探测项才露出来。截图里看不到时，要有人把列表滚到探测项那里再截一次。

判断：

- p6 显示 `Bytezard Lead P6`：方案 1 成立。接下来按第 8.7 节的冲突表，请用户在 1a、1b、1c 里选一种。
- p7 或 p8 的设置页名字和进程名不同：1b 成立，两个名字可以都保住。
- p6 也不显示 Bytezard Lead：方案 1 不成立，回到方案 2（`SMAppService`）或方案 3（接受 `lead-agent`），请用户定。

### 实测 4 的结果（2026-11-04）

macOS 27.2（26B123）。Lead 用 `run_on_host` 代跑了 `install` 和 `status`。截图有两张：

- 主人 16:55 截的「允许在后台」（截图见 Lead 会话，Lead 已转述）：p5、p7。
- Lead 16:56 用 `screencapture` 截的：p6、p8。截图存在本机 `~/.pi-lead-child/lead-scratch/p0-7-btm-20261104-165654.png`，不放进仓库（图里有别的私人内容）。

第一次 `screencapture` 报 `could not create image from display`：主机上的 node 没有「屏幕录制」权限。主人 16:56 之前给 node 开了这个权限，现在 Lead 能自己用 `screencapture` 截图。

| 探测项 | 设置页「允许在后台」的名字（截图） | 「App Background Activity」系统通知里的名字 | 进程名 ucomm | comm（可执行文件的路径） | `sfltool` 的 Name |
|---|---|---|---|---|---|
| p5 | `lead-agent` | 没有弹出 | `lead-agent` | `…/p5/Bytezard Lead.app/Contents/MacOS/lead-agent` | `Bytezard Lead`（和设置页不一致） |
| p6 | `Bytezard Lead P6`，Running in background | `Bytezard Lead P6` | `Bytezard Lead P6` | `…/p6/Bytezard Lead P6` | `Bytezard Lead P6` |
| p7 | `lead-agent-p7`，图标左下角有替身箭头 | `lead-agent-p7` | `Bytezard Lead P7` | `…/p7/lead-agent-p7` | `lead-agent-p7` |
| p8 | `Bytezard Lead P8`，图标左下角有替身箭头，Running in background | `Bytezard Lead P8` | `lead-agent-p8` | `…/p8/Bytezard Lead P8` | `Bytezard Lead P8` |

「Node.js Foundation」那一项还在（开发机原有的 node 后台项目）。p5 到 p8 已经由 Lead 卸掉。

结论（已核实，p5–p8 的设置页截图都有）：

- 不在 `.app` 里的程序，设置页和「App Background Activity」通知显示的是 plist 里 `ProgramArguments[0]` 那个路径的文件名。是软链接时，显示软链接自己的名字，不是它指向的真实文件名（p7、p8 的截图）。
- 活动监视器的进程名（`ucomm`）跟着真实文件名走（p7、p8）。`comm` 是 plist 里写的路径。
- 所以 p8 的做法能让登录项显示 Bytezard Lead，同时进程名还是 `lead-agent`：plist 写一个名叫 Bytezard Lead 的软链接，它指向真实文件 `lead-agent`。
- 对 `sfltool` 的 Name：不在 `.app` 里的程序（p6、p7、p8），它和系统通知、设置页都一致；在 `.app` 里的程序（p5），它和设置页不一致。
- 按这个结论选定做法 1b（设计文档第 8.7 节），已经实现，见下一节。

## 实测 5：交付的做法（1b）的端到端实测

做法 1b 已经实现（设计文档第 8.7 节）：

```
<运行包>/bin/lead-agent                    Node，ad-hoc 重签，标识 com.bytezard.plc.agent
<运行包>/bin/Bytezard Lead -> lead-agent   软链接；launchd 的 plist 写它
```

为什么不直接装真的运行包：`desktop-install` 装的 LaunchAgent 用 `LAUNCHD_LABEL`，在 P0-8 改名以前它还是开发机正在运行的 `com.pi-lead-child.supervisor`，装上去会顶掉主人正在用的服务。所以端到端实测用探测项 p9：它用和打包脚本同一个函数（`scripts/desktop/lib/agent-bundle.ts` 的 `installAgent`）生成 `bin/lead-agent` 和软链接，plist 写的路径和交付的 plist 一样（`<目录>/bin/Bytezard Lead`），只是 label 换成 `com.bytezard.plc.probe-p9`。

在仓库根、沙箱外运行（Lead 用 `run_on_host` 代跑，截图也由 Lead 截）：

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
node --import tsx scripts/desktop/probe-btm.ts install p9
sleep 15
node --import tsx scripts/desktop/probe-btm.ts status p9
open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
sleep 3
screencapture -x "$HOME/.pi-lead-child/lead-scratch/p0-7-p9-$(date +%Y%m%d-%H%M%S).png"
node --import tsx scripts/desktop/probe-btm.ts remove p9
```

预期：

- 「允许在后台」里有一项叫 **Bytezard Lead**（图标带替身箭头），不归在「Node.js Foundation」下面。
- `status` 打印的进程名 `ucomm` 是 `lead-agent`，`comm` 是 `…/p9/bin/Bytezard Lead`。
- 签名：`Identifier=com.bytezard.plc.agent`，`Signature=adhoc`，`TeamIdentifier=not set`。

结果（2026-11-04 17:13，HEAD 5f101da4，macOS 27.2（26B123），Lead 用 `run_on_host` 代跑；原始输出在本机 `~/.pi-lead-child/lead-scratch/host-commands/rcc_MfUmKL47-rwFx_Vg.log`）：

| 项目 | 结果 |
|---|---|
| 「允许在后台」的名字 | **已核实**：列表第一行显示 Bytezard Lead，图标带替身箭头，状态 Running，不在「Node.js Foundation」下面。`sfltool dumpbtm` 里 Name 是 Bytezard Lead，Executable Path 是 `…/p9/bin/Bytezard Lead` |
| 系统通知 | 「App Background Activity」：「"Bytezard Lead" can run in the background」 |
| 进程名 ucomm | **已核实**：`lead-agent` |
| 签名 | `Identifier=com.bytezard.plc.agent`，adhoc，没有 Team ID |
| 截图 | `~/.pi-lead-child/lead-scratch/p0-7-p9list-cropped.png`（登录项列表，17:19）；`~/.pi-lead-child/lead-scratch/p0-7-p9-20261104-171257.png`（系统通知） |
| 沙箱外的测试 | `supervisor.test.ts`、`single-owner.test.ts`、`desktop-notifier.test.ts`：3 个文件 40 条全部通过 |

p9 已经卸掉。同一轮还发了 Electron 和 osascript 测试通知，结果写在上面的「记录」表里。

## 实测 6：通知授权（#232）

#232 改成：用户确认测试通知显示了以后，壳才接管通知（设计文档第 8.6 节「通知授权」）。这次实测核实三件事：

- Electron 申请授权的结果是什么。实测 5 的 App 为什么只有 `show`、不显示。
- 换一次构建（签名摘要变了）以后，授权还在不在。它决定确认记录按签名摘要区分是不是必要。
- 在系统设置里关掉通知以后，Electron 报不报 `failed`。

实测只跑 `--notification-probe`：它不装服务、不碰数据目录，不影响主人正在用的服务。「打开通知」这一屏的截图在 `artifacts/ticket-232-notification-check/`，是在浏览器里用同一份安装页脚本画的。

在仓库根、沙箱外运行（Lead 用 `run_on_host` 代跑，截图也由 Lead 截）。先按「要准备的东西」第 1 步打一个 App，然后：

1. 用调试日志跑 probe。`ELECTRON_DEBUG_NOTIFICATIONS` 让 Electron 写出授权申请的结果（`Notification authorization granted: …`，或者错误原因）：

   ```sh
   APP="out/desktop/mac-arm64/Bytezard Lead.app"
   LOG="$TMPDIR/bytezard-lead-probe-stderr.log"
   SHOTS="$HOME/.pi-lead-child/lead-scratch"
   shasum -a 256 "$APP/Contents/_CodeSignature/CodeResources"
   open -n "$APP" --env ELECTRON_ENABLE_LOGGING=1 --env ELECTRON_DEBUG_NOTIFICATIONS=1 --stderr "$LOG" --args --notification-probe
   sleep 3; screencapture -x "$SHOTS/p0-7-m6-probe-$(date +%Y%m%d-%H%M%S).png"
   sleep 22
   grep -iE "authoriz|notification" "$LOG" | tail -20
   cat "$TMPDIR/bytezard-lead-notification-probe.json"
   ```

2. 打开 Bytezard Lead 的通知设置，截图。这一步也核实壳的「打开系统设置」按钮用的地址：

   ```sh
   open "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.bytezard.plc"
   sleep 3; screencapture -x "$SHOTS/p0-7-m6-settings-$(date +%Y%m%d-%H%M%S).png"
   ```

3. 换一次构建，再跑第 1 步。`extraMetadata.version` 改了 `app.asar` 里的版本号，签名摘要就变了：

   ```sh
   cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config desktop-builder.yml --mac dir --arm64 --publish never -c.extraMetadata.version=0.0.1-m6 && cd ..
   ```

   看第 1 步的 `shasum` 变了没有，通知还显示不显示，系统有没有再弹权限卡。

4. 请主人在「系统设置 → 通知 → Bytezard Lead」里关掉「允许通知」，再跑第 1 步，看 events 里有没有 `failed` 和它的 `error`。看完再打开「允许通知」。

记录（2026-11-04 20:16–20:31，macOS 27.2，Lead 用 run_on_host 代跑，脚本和原始输出在 `artifacts/ticket-232-notification-check/m6-host/`）：

| 项目 | 结果 | 截图 |
|---|---|---|
| 授权申请的结果（第 1 步的日志） | `Notification authorization granted: 1`。首次启动没有弹权限卡：这台 Mac 上 com.bytezard.plc 之前已经授权过（实测 5） | `m6-host/probe-a-stderr.log` |
| probe 的 events，通知有没有显示 | events 只有 `called show()`、`show`；Electron 日志 `Notification displayed`。关掉专注模式以后横幅弹出，来源 Bytezard Lead；主人截到通知中心里也有这一条（附件在 #232）。前两次截图没拍到横幅，是专注模式压住了 | `m6-host/probe-d-banner.png`（裁到只剩横幅） |
| 「打开系统设置」的地址打开了哪一页 | 打开「通知 → Bytezard Lead」那一页，地址正确。横幅样式缺省是「临时」，几秒后自动收起 | `m6-host/settings-pane.png`（裁到只剩设置窗口） |
| 换构建以后签名摘要、授权、权限卡 | CodeResources 的 sha256 从 `e0bc66e3…` 变成 `91f98fac…`，版本 0.0.0 → 0.0.1-m6；授权仍是 granted: 1，没有再弹权限卡，通知照常显示。结论：确认记录可以只按 App 记，不必按签名摘要 | `m6-host/run.log`、`m6-host/probe-b.json` |
| 关掉通知以后有没有 `failed` | 未实测（主人 2026-11-04 20:40 决定先不测）。试了 3 次，每次点确认时「允许通知」都还开着，横幅照常弹出，结果不算数。留到正式 App 首次引导的实测里补 | `m6-host/step4.log`–`step6.log` |

按结果改：

- 换构建以后授权还在：确认记录可以只按 App 记，不按签名摘要，用户更新 App 以后不用再确认。
- 关掉通知以后没有 `failed`：确认以后用户关掉通知，App 开着时的通知又会丢。那时要另想办法（例如每次打开 App 发一条测试通知），先问主人。
