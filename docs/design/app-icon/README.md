# Bytezard Lead 图标素材：π 水母

用户在 2026-11-05 选定了这套图标，要求打包时使用。
- App 图标用「F3 深海 π」：一只发光的水母，钟体和两条主触手组成 π。
- 扁平的地方用「G 一笔 π」去掉星以后的剪影。

## 文件和用途

| 文件 | 用在哪里 | 尺寸 |
|---|---|---|
| `png/AppIcon.icns` | 桌面 App 的图标：`desktop/desktop-builder.yml` 的 `mac.icon` | 16–1024，10 张 |
| `png/macos-1024.png` | macOS 图标的 1024 原图（带圆角和阴影，四角透明），给发布说明、README 用 | 1024 |
| `png/icon.png` | Companion `apps/companion/assets/images/icon.png`（Expo、iOS 用，满版、不透明，系统自己加圆角） | 1024 |
| `png/favicon.png` | Companion `assets/images/favicon.png` | 48 |
| `png/android-icon-foreground.png` | Companion `assets/images/android-icon-foreground.png`，水母在 66% 安全区内 | 512 |
| `png/android-icon-background.png` | Companion `assets/images/android-icon-background.png`，深海底色 | 512 |
| `png/android-icon-monochrome.png` | Companion `assets/images/android-icon-monochrome.png`，白色剪影 | 432 |
| `png/splash-icon.png` | Companion `assets/images/splash-icon.png`，放在 `#10131A` 的启动底色上 | 228 宽 |
| `png/flat-tile-1024.png` | 扁平版：白底墨色剪影。现在没有接入的地方，留给文档和浅色场合 | 1024 |
| `png/silhouette-1024.png` | 黑色剪影，透明底。以后做菜单栏图标（模板图）或 App 内的小标记时用 | 1024 |

`svg/` 里是每个 PNG 对应的矢量原稿。

## 接入时要注意

1. 桌面 App 现在没有设图标，electron-builder 用的是缺省图标。在 `mac:` 下加 `icon:`，指向仓库里的 `.icns`。
2. 如果 Companion 也换图标，有三处要改：
   - `app.json` 的 `ios.icon` 现在指向 `./assets/expo.icon`，这是 Expo 模板的 Icon Composer 包，里面还是 Expo 的标志。要么删掉这一项，让 iOS 用 `icon.png`；要么重新做一个 `.icon` 包。
   - `android.adaptiveIcon.backgroundColor` 现在是 `#F5F6F8`。建议改成深海色 `#0E1630`，和背景图一致。
   - 启动底色 `#10131A` 不用改，发光的水母在深色上正合适。
3. 不要改会话里 Lead 的头像（`apps/companion/assets/images/lead-avatar/`）。换不换头像是另一个决定，用户还没定。
4. 构建后，在真的 Dock 里看一眼。macOS 26 会把不符合系统圆角形状的旧图标放进一块灰色底板里。这套图标按标准网格画（1024 画布，824 的超椭圆主体），按理不会出现底板。如果出现了，就要改用 Icon Composer 做 `.icon` 文件。

## 接入的位置（2026-11-05）

- 桌面 App：`desktop/assets/AppIcon.icns`，`desktop/desktop-builder.yml` 的 `mac.icon` 指向它。
- Companion：`apps/companion/assets/images/` 里的同名文件；`app.json` 去掉了 `ios.icon`（iOS 用 `icon.png`），安卓自适应图标的底色改成 `#0E1630`。
- `desktop/test/app-icon.test.ts` 核对这些文件和 `png/` 里的一样。重新生成以后，把用到的文件复制过去。

## 重新生成

需要 macOS（`sips`、`iconutil`）和 Google Chrome。

```bash
cd docs/design/app-icon
node src/make-kit.mjs svg
sh src/render.sh svg png
```

- `make-kit.mjs` 只用 Node，没有依赖。
- 改造型改 `make-kit.mjs` 里的 `BELL`、`LEG_L`、`LEG_R`。
- 改颜色改 `GLOW_DEFS`、`SEA_DEFS`。

## 已经检查过的

- macOS 原图的四角透明，阴影在画布内。
- `AppIcon.icns` 用 `iconutil` 拆回去有 10 个尺寸。
- `icon.png` 没有透明通道（iOS 要求）。
- 安卓前景在 66% 安全区内，单色版是纯白剪影。
- 16、32 像素下仍然能认出水母和 π。

没有检查的：装进 App 以后在 Dock、启动台、Finder 里的真实效果。
