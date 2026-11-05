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
      preRename: "Found an installation with the old name. Next, Bytezard Lead moves its data and settings to the new place.",
      dev: "Found a developer installation. Next, Bytezard Lead takes over its data and settings.",
      upgrade: (from: string, to: string) => `Next, Bytezard Lead changes from version ${from} to ${to}.`,
    },
    takeover: {
      notNeeded: "There is no earlier installation to take over.",
      starting: "Taking over the data and settings that are already on this Mac.",
      phases: {
        precheck: "Checking that the takeover can start.",
        backup: "Making a backup of the database.",
        scan: "Looking for the old folder in your data.",
        drain: "Waiting until Bytezard Lead finishes its current work. This can take up to 30 minutes.",
        stop_old: "Stopping the earlier background service.",
        move: "Moving your data to the new place.",
        rewrite: "Updating the folder names in your data.",
        start_new: "Starting the new background service.",
        health: "Checking that the service runs and that your data is complete.",
        done: "The takeover is complete.",
      },
      rollingBack: "A problem occurred. Bytezard Lead puts everything back as it was.",
      done: "Bytezard Lead took over your data and settings.",
      refused: {
        targetNotEmpty: "The new data folder already holds other files. To keep them safe, Bytezard Lead did not take over. Nothing changed, and the earlier service runs as before.",
        notSameVolume: "Your data and the new data folder are on different disks, so Bytezard Lead cannot move the data. Nothing changed, and the earlier service runs as before.",
        diskSpace: "There is not enough disk space for a backup of the database. Free some space, then try again. Nothing changed, and the earlier service runs as before.",
        socketPathTooLong: "The path of the new data folder is too long for macOS. Copy the diagnostics and send them to support. Nothing changed, and the earlier service runs as before.",
        schemaAhead: "Your data comes from a newer version of Bytezard Lead. Download a newer version. Nothing changed, and the earlier service runs as before.",
        other: "Bytezard Lead cannot take over the earlier installation. Copy the diagnostics and send them to support. Nothing changed, and the earlier service runs as before.",
      },
      failed: (reason: string) => `Bytezard Lead could not take over the earlier installation: ${reason}. Nothing changed, and the earlier service runs as before. Try again.`,
      rolledBack: (reason: string) => `Bytezard Lead could not take over the earlier installation, so it put everything back as it was. Your data did not change, and the earlier service runs as before. Reason: ${reason}. Try again.`,
      rollbackFailed: (reason: string, backup: string) =>
        `Bytezard Lead could not take over the earlier installation, and a problem occurred when it put things back: ${reason}. No data was deleted. The backup of the database is ${backup}. Copy the diagnostics and send them to support.`,
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
      installRunning: "An earlier installation still runs. Wait until it finishes, then try again.",
      schemaAhead: (current: number, supported: number) =>
        `Your data comes from a newer version of Bytezard Lead (data version ${current}; this version supports up to ${supported}). Download a newer version. Nothing changed.`,
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
      preRename: "找到了旧名字的安装。接下来把它的数据和设置搬到新位置。",
      dev: "找到了开发版的安装。接下来由 Bytezard Lead 接手它的数据和设置。",
      upgrade: (from, to) => `接下来从 ${from} 版换到 ${to} 版。`,
    },
    takeover: {
      notNeeded: "没有要接手的旧安装。",
      starting: "正在接手这台电脑上已有的数据和设置。",
      phases: {
        precheck: "正在检查能不能接手。",
        backup: "正在备份数据库。",
        scan: "正在查找数据里记着旧位置的地方。",
        drain: "正在等 Bytezard Lead 做完手上这一轮工作。最多等 30 分钟。",
        stop_old: "正在停下原来的后台服务。",
        move: "正在把数据搬到新位置。",
        rewrite: "正在更新数据里记着的位置。",
        start_new: "正在启动新的后台服务。",
        health: "正在确认服务正常、数据完整。",
        done: "接手完成。",
      },
      rollingBack: "出了问题，正在恢复原样。",
      done: "已经接手原来的数据和设置。",
      refused: {
        targetNotEmpty: "新的数据目录里已经有别的文件。为了不覆盖它们，没有接手。什么都没改，原来的服务照常运行。",
        notSameVolume: "原来的数据和新的数据目录不在同一块磁盘上，没法搬过去。什么都没改，原来的服务照常运行。",
        diskSpace: "磁盘空间不够备份数据库。腾出空间后点重试。什么都没改，原来的服务照常运行。",
        socketPathTooLong: "新的数据目录的路径对 macOS 来说太长。请复制诊断信息发给我们。什么都没改，原来的服务照常运行。",
        schemaAhead: "你的数据来自更新的 Bytezard Lead。请下载更新的版本。什么都没改，原来的服务照常运行。",
        other: "没法接手原来的安装。请复制诊断信息发给我们。什么都没改，原来的服务照常运行。",
      },
      failed: (reason) => `没能接手原来的安装：${reason}。什么都没改，原来的服务照常运行。请点重试。`,
      rolledBack: (reason) => `没能接手原来的安装，已经恢复原样：数据没有改动，原来的服务照常运行。原因：${reason}。请点重试。`,
      rollbackFailed: (reason, backup) =>
        `没能接手原来的安装，恢复原样时也出了问题：${reason}。数据没有删除，数据库的备份在 ${backup}。请点「复制诊断信息」发给我们。`,
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
      installRunning: "上一次安装还在进行。等它做完，再点重试。",
      schemaAhead: (current, supported) =>
        `你的数据来自更新的 Bytezard Lead（数据版本 ${current}，这个版本最多支持 ${supported}）。请下载更新的版本。什么都没改。`,
      unexpected: (reason) => `安装因为一个错误停下了：${reason}`,
    },
  },
});
