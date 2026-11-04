# 依赖漏洞审计（2026-11-03）

不用升大版本就能修的漏洞已经全部修掉。剩下 7 个高危：6 个要等 Expo 58，1 个（`@anthropic-ai/sandbox-runtime`）还没有修复版本，在 PLC 里也触发不到。

基线是 master `54e2ff41`。数字来自 `npm audit --json`，命令在仓库根目录运行。

| 范围 | 修前 | 修后 |
|---|---|---|
| 生产依赖（`npm audit --omit=dev`） | 26 个：高危 10、中危 14、低危 2 | 21 个：高危 7、中危 12、低危 2 |
| 全部依赖（`npm audit`） | 42 个：高危 11、中危 29、低危 2 | 34 个：高危 7、中危 25、低危 2 |

GitHub 上的 Dependabot 显示 37 个告警。这个数字和这里的数字对不上，原因没有核实：Dependabot 按 advisory 计数，`npm audit` 按包计数，而公开仓库只有快照，告警按上一次快照的锁文件算。修复合进 master 后，要等下一次推快照，GitHub 上的告警才会更新。

## 改了什么

只改了 `package.json` 和 `package-lock.json`。

| 包 | 修前 | 修后 | 方法 |
|---|---|---|---|
| `undici` | 8.10.2（`jsdom` 下另有 8.11.2） | 8.12.3（一份） | `overrides` |
| `minimatch`（只在 `@earendil-works/pi-coding-agent` 下） | 10.2.6 | 11.0.4 | `overrides` |
| `node-forge` | 1.4.0 | 1.4.2 | `npm update` |
| `source-map-js` | 1.2.1 | 1.2.2 | `npm update` |
| `postcss` | 8.5.20 | 8.5.32 | `npm update` |
| `vite`（开发依赖） | 8.1.5 | 8.3.5 | `npm update` |
| `vitest`、`@vitest/*`（开发依赖） | 4.1.10 | 4.1.12 | `npm update` |

`npm update` 还顺带更新了 `vite` 的依赖：`rolldown` 1.1.5 → 1.2.16、`@oxc-project/types`、`picomatch`、`chai`、`tinyrainbow`。

### 为什么用 overrides

- `undici`：`@earendil-works/pi-coding-agent` 1.1.0 把它锁死在 `8.10.2`，`npm update` 改不动。修复版本是 8.12.2，override 到 `^8.12.3`。其他用到它的包（`openai`、`@slack/socket-mode`、`jsdom`）声明的范围都包含 8.12.3。
- `minimatch`：同样被 pi 1.1.0 锁死在 `10.2.6`，修复版本是 11.0.1，10.x 没有修复。这条 override 只作用在 `pi-coding-agent` 下面，`eslint` 用的 `minimatch` 3.x 不受影响。pi 1.5.0 自己就依赖 `minimatch` 11.0.3。pi 的调用方式在 1.1.0 和 1.5.0 里完全一样，都是 `import { minimatch } from "minimatch"` 加 `minimatch(path, pattern, opts)`。
- 为什么不直接把 pi 升到 1.5.0：从 1.1 升到 1.5 要跨两次 breaking change。1.2.0 把 `before_agent_start` 的事件改成了按 `messageType` 区分的 union，还改了启动中的 run 算不算 busy。1.5.0 换了工具参数的校验器。PLC 在 `packages/lead/src/session.ts:305`、`packages/lead/src/session.ts:419`、`packages/lead/src/credibility/extension.ts:187` 用到 `before_agent_start`。这些改动不算低风险，应该单开一张工单升 pi。升 pi 以后，这两条 overrides 就可以删掉。

## 高危漏洞的结论

`npm audit` 修前报了 11 个高危包（全部依赖）。下表逐个写出结论。「运行时」指 daemon、Lead、执行者进程，或者 Companion 应用里实际会跑的代码。

| 包 | advisory | 在 PLC 里的位置 | 能不能触发 | 结论 |
|---|---|---|---|---|
| `undici` | GHSA-xjj6-f33q-929c、GHSA-4w7w-5xrc-9h26、GHSA-2m5v-pch6-74hx、GHSA-qrxm-fqhp-jwvm，另有 4 条中危 | 运行时。pi 用它替换了全局 `fetch`（`pi-coding-agent/dist/core/http-dispatcher.js`），所以 Lead 和执行者进程里的模型调用和网页抓取都走它。Slack socket-mode 也用它。 | 能。例如 GHSA-xjj6：Lead 抓取一个恶意服务器的网页时，对方回 6 个以上的 content-encoding 再断开连接，就能让进程崩溃。 | 已修（8.12.3） |
| `node-forge` | GHSA-86w9-cpqp-85rv、GHSA-7wch-p9px-956x、GHSA-jc66-7q78-782g、GHSA-8hrf-8g6f-7xwp、GHSA-hqq3-7jhf-c5jx、GHSA-5x38-2vff-x55p，另有中低危 6 条 | 运行时，但只有一个用法：`sandbox-runtime` 的 `mitm-ca.js`、`mitm-leaf.js` 用它生成沙箱代理的临时 CA 和证书。只有设置了打码密钥时，PLC 才打开 TLS 终止（`packages/core/src/sandbox-policy.ts:357`）。Expo 的 `@expo/code-signing-certificates` 也依赖它，但 Companion 没有用 `expo-updates`。 | 触发不到。sandbox-runtime 只生成证书、读回自己写的 PEM。它不用 `forge.tls`、`pkcs12`、`verifyCertificateChain`、RSA 验签，也不解析外来的 PEM。TLS 连接由 Node 的 `tls` 处理。 | 已修（1.4.2） |
| `source-map-js` | GHSA-68fv-2mgg-jv7q | 构建时：`postcss`（Metro 处理 CSS、vitest 里的 vite）和 `css-tree` 的依赖。 | 触发不到。只处理仓库自己的源码和 source map。 | 已修（1.2.2） |
| `vite`（开发依赖） | GHSA-587h-7wmj-h5pm，另有中低危 4 条 | 只在 vitest 跑测试时用到。 | 触发不到。主要问题在 `launch-editor` 上，只影响 Windows；测试也不起 vite 的 dev server。 | 已修（8.3.5） |
| `zod`（`@anthropic-ai/sandbox-runtime` 下的那份，3.25.76） | GHSA-mrhx-c7xc-m3w5 | 运行时：sandbox-runtime 用 `zod/v3` 校验 PLC 传给它的沙箱配置（`sandbox-config.js`），以及它的 decider 客户端收到的消息。 | 触发不到。被校验的是 PLC 自己生成的配置（`packages/core/src/sandbox-policy.ts:443`），不是外来输入；PLC 也不用 decider。 | 没有修复版本，见下文 |
| `@anthropic-ai/sandbox-runtime` | 本身没有 advisory，只是因为依赖上面这份 `zod` 被标成高危 | 同上 | 同上 | 没有修复版本，见下文 |
| `zod`（`expo` 下的那份，3.25.76） | GHSA-mrhx-c7xc-m3w5 | 构建和开发时：只有 `@expo/cli` 用它，也就是 `expo start` 和 `expo export`。 | 触发不到。只在开发机上读项目自己的配置。 | 待 Expo 升级 |
| `@expo/cli` | 本身没有高危 advisory，因为 `zod`、`glob` 等被标成高危 | 构建和开发时：`build:web` 调用的 `expo export`，以及 `expo start`。 | 触发不到。理由同上。 | 待 Expo 升级 |
| `expo` | 本身没有高危 advisory，因为 `@expo/cli` 和一串 `@expo/*` 被标成高危 | 同上 | 同上 | 待 Expo 升级 |
| `decode-uri-component` | GHSA-qr28-fpjm-wq7f（另有中危 GHSA-vcc3-ghjq-m6fr） | 运行时，在 Companion 应用里：`expo-router` 用 `query-string.parse()` 解析地址里的查询参数（`expo-router/build/fork/getStateFromPath.js:538`）。 | 能，但影响小。打开一个查询串约 224 KB、格式错误的链接（网页地址或 `lead-child://` 深链接），会让应用的 JS 线程卡住约 20 秒。只影响这一个页面或这一个应用，不泄露数据，也碰不到 daemon。 | 待 Expo 升级 |
| `query-string` | 本身没有 advisory，因为 `decode-uri-component` 被标成高危 | 同上 | 同上 | 待 Expo 升级 |
| `expo-router` | 本身没有 advisory，因为 `query-string` 被标成高危 | 同上 | 同上 | 待 Expo 升级。`expo-router` 58.0.29 已经不依赖 `query-string`。 |

### 中危和低危

- 已修：`@earendil-works/pi-coding-agent`（通过 `undici`、`minimatch`）、`postcss`（GHSA-fxqj-rqcc-2cmp，构建时）、`vitest` 和 `@vitest/mocker`（GHSA-82fw-gwwq-j7x9、GHSA-qxg6-89mg-rqv8，只在跑测试时）。
- 待 Expo 升级：`@expo/config`、`@expo/config-plugins`、`@expo/fingerprint`、`@expo/inline-modules`、`@expo/local-build-cache-provider`、`@expo/metro-config`、`@expo/prebuild-config`、`expo-sharing`、`expo-splash-screen`、`glob`、`minimatch`（根目录那份 10.2.6）、`uuid`、`xcode`、`deepmerge`。这些都是 Expo 的构建工具链。
- 没有修复版本，只在开发时用到：`eslint` 9 的一整串（`@eslint/*`、`@typescript-eslint/*`、`eslint-config-expo`、`eslint-plugin-*`），原因是它们依赖 `minimatch` 3.x。`apps/companion` 的 `expo lint` 才会用到。

## `@anthropic-ai/sandbox-runtime`

- advisory：它自己没有 advisory。`npm audit` 把它标成高危，是因为它依赖 `zod@^3.25.0`，而 GHSA-mrhx-c7xc-m3w5（CVE-2023-54404）的范围是「zod 4.6.6 以下」，3.x 没有修复版本。漏洞的内容是：校验一个很大、又没有长度限制的数组时，zod 为每个出错的元素都记一条错误，最后内存耗尽。
- PLC 怎么用它：`packages/engine/src/sandbox/bash.ts` 用它包住 Lead 和执行者的 bash 命令（macOS 上是 `sandbox-exec`，Linux 上是 bubblewrap），网络走它在进程里起的代理。设置了打码密钥时，它还会做 TLS 终止，把占位值换成真值。版本锁在 `0.0.81`，这是 npm 上最新的版本（2026-10-20 发布）。
- 为什么触发不到：zod 在它里面只校验两样东西。第一样是 `SandboxManager.initialize()` 收到的配置，由 PLC 的 `sandboxRuntimeConfig()` 生成（`packages/core/src/sandbox-policy.ts:443`），数组的内容来自 PLC 自己的策略。第二样是 decider 客户端收到的消息，PLC 没有用 decider，放行由 `allowEveryHost` 回调决定（`packages/engine/src/sandbox/bash.ts:33`）。外来输入到不了 zod。
- 为什么不用 overrides 把它的 zod 换成 4.6.6：sandbox-runtime 导入的是 `zod/v3`。在 zod 4 的包里，这个路径对应的是旧的 v3 实现。对比 zod 4.6.5 和 4.6.6 两个包，`v3/` 目录一个文件都没变，修复只改在 `v4/core`。换版本只会让 `npm audit` 不再报，实际运行的代码不变，所以没有做。
- 缓解办法：现在不需要额外处理。以后如果有外来数据进入沙箱配置，例如让外部消息决定放行哪些域名，要先在 PLC 这边限制数组长度。sandbox-runtime 发布基于 zod 4 的版本后，再升级。

## Expo 58 升级评估

建议单开一张工单，等 Expo 58 出了第一批补丁（58.0.x 和配套的 reanimated、worklets 补丁版本），并且用户手上的 iPhone 能装上对应的 Expo Go 后再做。原因如下：

- 可以拖：要等这次升级才能修的漏洞里，运行时可达的只有 `decode-uri-component`，影响是卡住用户自己的页面。其余都在构建工具链里。
- 不能当小改动做：它会一起升 React Native、React、reanimated 和 gesture-handler，而且 gesture-handler 是跨大版本。

### 版本会变的地方

数字来自 `expo@58.0.22` 的 `bundledNativeModules.json`。

| 包 | 现在 | Expo 58 |
|---|---|---|
| `expo`、`expo-*`、`@expo/ui` | ~57.0.x | ~58.0.x |
| `react-native` | 0.86.3 | 0.88.1 |
| `react`、`react-dom` | 19.2.3 | 19.3.0 |
| `react-native-reanimated` | 4.5.1 | 4.7.1 |
| `react-native-worklets` | 0.10.1 | 0.13.0 |
| `react-native-gesture-handler` | ~2.32.0 | ~3.3.0（大版本） |
| `react-native-screens` | ~4.26.0 | ~4.30.1 |
| `react-native-safe-area-context` | ~5.7.0 | ~5.10.1 |
| `react-native-svg` | 15.15.4 | 15.16.0 |
| `react-native-web` | ~0.21.0 | ~0.21.4 |
| `eslint-config-expo` | ~57.0.0 | ~58.x |

`apps/companion/package.json` 和 `packages/components/package.json` 都要改。`packages/components` 也依赖 `expo`（~57.0.8）。

### 要改的代码

下面按 Expo 58 的发布说明（<https://expo.dev/changelog/sdk-58>，2026-10-15）对照了仓库代码：

1. `expo-file-system`：`File.write()` 变成异步、返回 promise。下面 3 处要改成 `await file.write(...)`，或者改用 `File.writeSync()`：
   - `apps/companion/src/data/artifactDownload.native.ts:22`
   - `apps/companion/src/data/platformOutboxStorage.native.ts:17`
   - `apps/companion/src/data/platformSectionMemory.native.ts:16`

   发件箱那一处和「用户消息不能丢」有关，改完要补测试。
2. `@expo/ui`：iOS 上的 `<Host>` 改成内容顶部对齐，`spacing` 没设时用系统默认值。要在 iPhone 上逐个看这 4 个组件：`packages/components/src/lists/ListItem.native.tsx`、`controls/Switch.native.tsx`、`controls/ChatInput.native.tsx`、`controls/TextField.native.tsx`。
3. React Native 0.87 默认启用严格的 TypeScript API：从 `react-native/Libraries/*` 深导入会报类型错误，ref 的类型变成 `ViewInstance` 这类实例类型。仓库里现在没有深导入。ref 类型要改的地方，运行 `npm run typecheck:companion` 和 `npm run typecheck:components` 就能找出来。
4. 已经移除的 RN 接口（`InteractionManager`、`Touchable*`、`NativeMethods`、`Modal` 的 `animated`）：仓库里都没有用到。`StatusBar` 只在 `apps/companion/src/app/_layout.tsx` 用到，要确认用到的属性没有被删掉。
5. `react-native-gesture-handler` 3.x：跨大版本。仓库代码没有直接导入它，滑动手势用的是 RN 的 `PanResponder`（`packages/components/src/display/ChatDockFrame.tsx`）。它是 `expo-router` 和 `react-native-screens` 的依赖，所以只要确认导航的返回手势正常。
6. `expo-router`：导航核心重写了，React Navigation 的一部分 API 被删掉，网页上的异步路由默认打开。仓库里没有用 `withLayoutContext`，也没有直接导入 `@react-navigation/*`。

### 对 `export:web`（`build:web`）的影响

会受影响，但能控制住：

- Expo 58 在没设 `web.output` 时默认用 `"server"`，每次请求时才渲染 HTML。daemon 的网关只提供静态文件（`packages/gateway/src/web-static.ts`），用不了 server 输出。`apps/companion/app.json` 已经明确写了 `"output": "static"`，所以导出仍然是静态文件。升级后要确认这一点：`apps/daemon/dist/web` 里有每个路由的 HTML 文件，而且没有 `server/` 目录。
- 网页上的异步路由默认打开，导出会拆成多个 JS 文件。要确认网关能提供这些文件，缓存头也合适。网页版本检测（`web-build.json`）不受影响。如果有问题，在 `expo-router` 插件里设 `asyncRoutes: { web: false }`。
- 网页上的安全区边距改成从 CSS 的 `env(safe-area-inset-*)` 读取，要在手机浏览器里看一次底部输入框的位置。
- Expo CLI 现在按命令自己设置 `NODE_ENV`。`build-web.ts` 本来就设了 `EXPO_NO_DOTENV=1`，不读 `.env`，不受影响。
- Node 版本：Expo 58 要求 Node 22.13+、24.3+ 或 26+。这次验证用的是 Node 24.22，满足要求。

### 风险

- 原生版本必须和 Expo Go 一致。reanimated、worklets 只差一个补丁版本，Expo Go 就会闪退。用 `npx expo install --fix` 装依赖，不要手写版本号。
- React Compiler 只在网页构建里跑，vitest 不跑。React 19.3 加上新的 compiler 以后，有些问题只会在浏览器里出现，所以要用 `build:web` 的产物实际点一遍。
- reanimated 和 worklets 升级后，jsdom 里的动画测试可能要调整。
- Android 的 release 构建默认打开 R8 混淆。PLC 现在不打 Android release 包，影响小。

### 建议的做法

1. 单开一张工单。先单独把 pi 升到 1.5（见上文），不要和 Expo 混在一起做。
2. 在 `apps/companion` 里运行 `npx expo install expo@^58.0.0 --fix`，再运行 `npx expo-doctor@latest`。`packages/components` 的 `expo` 版本跟着改。
3. 按「要改的代码」一节修改，然后运行 `npm run typecheck:companion`、`npm run typecheck:components`、`npm run test:companion`、`npm run test:components`。
4. 运行 `npm run build:web`，在桌面浏览器和手机浏览器里各走一遍主要页面：Lead 会话、工单详情、设置。
5. 在 iPhone 的 Expo Go 上走一遍同样的页面，重点看 `@expo/ui` 的 4 个组件、滑动手势、发件箱。
6. 再运行一次 `npm audit`，确认 Expo 这一串都清掉了。
