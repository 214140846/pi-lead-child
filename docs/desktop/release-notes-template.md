# release 说明模板

发布 Bytezard Lead 的 release 时，把下面两条横线之间的内容贴进 release 说明，把 `<version>` 和 `<版本>` 换成这次的版本号（tag 去掉开头的 `v`，例如 `1.3.0`）。设计见 [macos-desktop-design.md](macos-desktop-design.md) 第 8.1、8.3 节。

## 发版的步骤

1. 在 GitHub 上新建 release，tag 写成 `v<版本>`，例如 `v1.3.0`。
2. 贴上下面的说明，换好版本号，然后点 **Publish release**。
3. `release-macos` workflow 自动开始。它在 `macos-15`（Apple 芯片）上打包、跑冒烟测试，然后把 3 个附件挂到 release 上：
   - `bytezard-lead-<版本>-arm64.dmg`
   - `bytezard-lead-runtime-<版本>-arm64.tar.gz`
   - `manifest.json`
4. 如果 workflow 失败了，修好以后在 Actions 页面手动运行 `release-macos`，填同一个 tag。`--clobber` 会覆盖已经传上去的附件。

注意：

- release 要由仓库所有者本人发布。用别的 workflow 的 `GITHUB_TOKEN` 建的 release 不会触发 `release-macos`。
- 冒烟测试失败时，workflow 不上传任何附件。
- 安装说明的文字来自 `desktop/src/install-guide.messages.ts`。改了那里以后，在仓库根运行 `node --import tsx desktop/scripts/install-guide.ts`，重新生成本文、`README.md` 和 `README.zh-CN.md` 里的这一段。

---

<!-- install-guide:en:start -->
## Install Bytezard Lead

Bytezard Lead needs a Mac with Apple silicon.

1. Download `bytezard-lead-<version>-arm64.dmg`.
2. Open the dmg and drag **Bytezard Lead** to **Applications**.
3. Open Bytezard Lead. macOS says it cannot verify the developer. Click **Done**.
4. Open **System Settings → Privacy & Security**. Scroll down and click **Open Anyway**.
5. When the warning shows again, click **Open**.

Bytezard Lead is not signed with an Apple certificate yet. You do these steps only once.
<!-- install-guide:en:end -->

<!-- install-guide:zh:start -->
## 安装 Bytezard Lead

Bytezard Lead 需要 Apple 芯片的 Mac。

1. 下载 `bytezard-lead-<版本>-arm64.dmg`。
2. 打开 dmg，把 **Bytezard Lead** 拖到「应用程序」。
3. 打开 Bytezard Lead。macOS 提示无法验证开发者，点「完成」。
4. 打开「系统设置 → 隐私与安全性」，向下滚动，点「仍要打开」。
5. 警告再次出现时，点「打开」。

Bytezard Lead 还没有 Apple 证书签名。这几步只需要做一次。
<!-- install-guide:zh:end -->

---
