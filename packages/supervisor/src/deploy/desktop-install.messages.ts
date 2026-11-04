// desktop-install 的进度文字（docs/desktop/macos-desktop-design.md 第 4 节）。App 的安装进度页直接显示它们。
// 安装时还没有库，读不到外观偏好里的语言：语言由 App 用 --locale 传进来，缺省是英文。
import { defineMessages } from "@pi-lead-child/protocol";

export const desktopInstallMessages = defineMessages({
  en: {
    preflight: {
      running: "Checking the program files.",
      done: "The program files are complete.",
    },
    detect: {
      running: "Looking for an existing installation.",
      done: "No other installation is on this Mac.",
      devInstall: "A developer copy of Bytezard Lead already runs on this Mac. Bytezard Lead opens it.",
      legacyInstall: "An installation with the old name is on this Mac. Run the migration first, then try again.",
    },
    loginShellPath: {
      running: "Reading the command search path of your login shell.",
      done: (count: number) => (count === 1
        ? "Found 1 folder in the search path of your login shell."
        : `Found ${count} folders in the search path of your login shell.`),
      skipped: "Could not read the search path of your login shell. Bytezard Lead looks in the usual folders.",
    },
    launchd: {
      running: "Setting up the background service. macOS then shows that a background item was added. This is normal.",
      done: "The background service is set up.",
      unchanged: "The background service is already set up.",
    },
    supervisor: {
      running: "Starting the background service.",
      done: "The background service runs.",
    },
    daemon: {
      running: "Starting Bytezard Lead. On a busy Mac, this can take several minutes.",
      done: "Bytezard Lead is ready.",
    },
    done: "Bytezard Lead is installed.",
    errors: {
      rootInvalid: (root: string) => `The program folder is not in the expected place: ${root}. Install Bytezard Lead again.`,
      releaseInvalid: (reason: string) => `The program files are damaged or incomplete. Install Bytezard Lead again. Details: ${reason}`,
      socketPathTooLong: (path: string, bytes: number, max: number) =>
        `The path of the data folder is too long for macOS: ${path} has ${bytes} bytes, and the limit is ${max}. Copy the diagnostics and send them to support.`,
      bootstrapFailed: "The background service could not start. Open System Settings > General > Login Items & Extensions, turn on the background item of Bytezard Lead, then try again.",
      supervisorTimeout: (seconds: number) => `The background service did not start in ${seconds} seconds. Try again.`,
      daemonRefused: (reason: string) => `The background service did not start Bytezard Lead: ${reason}`,
      daemonTimeout: "The service is still starting. It starts more slowly than usual. Wait a moment, then try again.",
      diskFull: "There is not enough disk space. Free at least 1 GB, then try again.",
      unexpected: (reason: string) => `The installation stopped because of an error: ${reason}`,
    },
  },
  zh: {
    preflight: {
      running: "正在检查程序文件。",
      done: "程序文件完整。",
    },
    detect: {
      running: "正在查找已有的安装。",
      done: "这台电脑上没有别的安装。",
      devInstall: "这台电脑上已经有一份开发版的 Bytezard Lead 在运行，直接打开它。",
      legacyInstall: "这台电脑上还有旧名字的安装。请先运行迁移，再重试。",
    },
    loginShellPath: {
      running: "正在读取登录 shell 的命令搜索路径。",
      done: (count) => `登录 shell 的搜索路径里有 ${count} 个目录。`,
      skipped: "没能读到登录 shell 的搜索路径。Bytezard Lead 在常用的目录里查找命令。",
    },
    launchd: {
      running: "正在设置后台服务。接下来 macOS 会提示添加了后台项目，这是正常的。",
      done: "后台服务设置好了。",
      unchanged: "后台服务已经设置好了。",
    },
    supervisor: {
      running: "正在启动后台服务。",
      done: "后台服务在运行。",
    },
    daemon: {
      running: "正在启动 Bytezard Lead。电脑忙的时候可能要几分钟。",
      done: "Bytezard Lead 准备好了。",
    },
    done: "Bytezard Lead 装好了。",
    errors: {
      rootInvalid: (root) => `程序目录不在应该在的位置：${root}。请重新安装 Bytezard Lead。`,
      releaseInvalid: (reason) => `程序文件损坏或者不完整。请重新安装 Bytezard Lead。详情：${reason}`,
      socketPathTooLong: (path, bytes, max) =>
        `数据目录的路径对 macOS 来说太长：${path} 有 ${bytes} 字节，上限是 ${max}。请复制诊断信息发给我们。`,
      bootstrapFailed: "后台服务没能启动。打开「系统设置 → 通用 → 登录项与扩展」，把 Bytezard Lead 的后台项目打开，再点重试。",
      supervisorTimeout: (seconds) => `后台服务在 ${seconds} 秒内没有启动。请重试。`,
      daemonRefused: (reason) => `后台服务没有启动 Bytezard Lead：${reason}`,
      daemonTimeout: "服务还在启动，比平常慢。请稍等后点重试。",
      diskFull: "磁盘空间不够，至少需要 1 GB。腾出空间后再重试。",
      unexpected: (reason) => `安装因为一个错误停下了：${reason}`,
    },
  },
});
