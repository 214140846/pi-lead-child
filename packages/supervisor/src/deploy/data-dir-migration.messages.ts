// ops.mjs migrate-data-dir 的进度文字（docs/desktop/macos-desktop-design.md 第 10 节 P0-8）。按行输出 JSON，开发者在终端里看。
// 语言由 --locale 传进来，缺省英文。
import { defineMessages } from "@pi-lead-child/protocol";

export const dataDirMigrationMessages = defineMessages({
  en: {
    precheck: {
      running: "Checking that this Mac can move to the new names.",
      done: (from: string, to: string) => `Ready to move ${from} to ${to}.`,
      alreadyMigrated: (to: string) => `Already migrated: the data folder is ${to}. Nothing changed.`,
      nothingToMigrate: (to: string) => `No data folder with the old name. This Mac uses ${to}. Nothing changed.`,
    },
    backup: {
      running: "Making an online backup of the database.",
      done: (path: string) => `Backed up the database to ${path}.`,
      afterStop: "The database changes its format in the new version, so the backup is made after the service stops.",
    },
    scan: {
      running: "Looking for the old folder in the database and in config.json.",
      done: (rewrite: number, history: number, config: number) =>
        `Found the old folder in ${rewrite} rows to update, ${history} rows of history to keep as they are, and ${config} settings in config.json.`,
    },
    drain: {
      running: "Waiting until Bytezard Lead finishes the current turn and no work blocks a restart.",
      done: "Nothing runs that a restart would break.",
    },
    stopOld: {
      running: "Stopping the background services with the old names.",
      done: "The old background services stopped.",
    },
    move: {
      running: "Moving the data folder.",
      done: (to: string) => `Moved the data folder to ${to}.`,
    },
    rewrite: {
      running: "Updating the old folder in the database and in config.json.",
      done: (rows: number, config: number) => `Updated ${rows} rows and ${config} settings.`,
    },
    startNew: {
      running: "Starting the background services with the new names.",
      done: "The new background services are set up.",
    },
    health: {
      running: "Waiting until the new service answers.",
      done: "The new service answers, with the same database version as before.",
    },
    done: (to: string) => `Migration complete. The data folder is ${to}.`,
    rollback: {
      step: (what: string) => `Rollback: ${what}`,
      done: "Rolled back. The old names and the old service are in use again.",
      failed: (error: string) => `The rollback did not complete: ${error}. Check the log lines above.`,
    },
    errors: {
      legacyServiceMissing: (plist: string) => `The background service with the old name is not installed (${plist} is missing). Nothing changed.`,
      targetNotEmpty: (to: string) => `${to} already holds files. Move them away first. Nothing changed.`,
      notSameVolume: (from: string, to: string) => `${from} and ${to} are on different disks, so the folder cannot move in one step. Nothing changed.`,
      diskSpace: (needed: number, free: number) => `Not enough free space for a database backup: ${needed} bytes needed, ${free} bytes free. Nothing changed.`,
      socketPathTooLong: (path: string, bytes: number) => `The socket path ${path} is ${bytes} bytes; macOS allows 103. Nothing changed.`,
      schemaBehind: (current: number | null, latest: number) =>
        `The database version is ${current ?? "unknown"}, and this code expects ${latest}. Restart the service on the new code first, then migrate. Nothing changed.`,
      schemaAhead: (current: number, latest: number) =>
        `The database version is ${current}, newer than the ${latest} that this code supports. Install a newer version. Nothing changed.`,
      step: (error: string) => `Failed: ${error}`,
    },
  },
  zh: {
    precheck: {
      running: "检查这台 Mac 能不能换成新名字。",
      done: (from: string, to: string) => `可以把 ${from} 移到 ${to}。`,
      alreadyMigrated: (to: string) => `已经迁移过：数据目录是 ${to}。什么都没改。`,
      nothingToMigrate: (to: string) => `没有旧名字的数据目录，这台 Mac 直接用 ${to}。什么都没改。`,
    },
    backup: {
      running: "在线备份数据库。",
      done: (path: string) => `数据库已备份到 ${path}。`,
      afterStop: "新版本要升级数据库的格式，所以停服务以后再备份。",
    },
    scan: {
      running: "在数据库和 config.json 里找旧目录。",
      done: (rewrite: number, history: number, config: number) =>
        `找到 ${rewrite} 行要改，${history} 行是历史记录、不改，config.json 里有 ${config} 项设置。`,
    },
    drain: {
      running: "等 Bytezard Lead 这一轮结束，没有会被重启打断的工作。",
      done: "没有会被重启打断的工作。",
    },
    stopOld: {
      running: "停掉旧名字的后台服务。",
      done: "旧的后台服务已经停了。",
    },
    move: {
      running: "移动数据目录。",
      done: (to: string) => `数据目录已移到 ${to}。`,
    },
    rewrite: {
      running: "把数据库和 config.json 里的旧目录改成新目录。",
      done: (rows: number, config: number) => `改了 ${rows} 行和 ${config} 项设置。`,
    },
    startNew: {
      running: "用新名字装好后台服务。",
      done: "新的后台服务装好了。",
    },
    health: {
      running: "等新服务回答。",
      done: "新服务回答了，数据库版本和迁移前一样。",
    },
    done: (to: string) => `迁移完成，数据目录是 ${to}。`,
    rollback: {
      step: (what: string) => `回滚：${what}`,
      done: "已经回滚，旧名字和旧服务照常在用。",
      failed: (error: string) => `回滚没有做完：${error}。看上面每一行的记录。`,
    },
    errors: {
      legacyServiceMissing: (plist: string) => `没有装旧名字的后台服务（没有 ${plist}）。什么都没改。`,
      targetNotEmpty: (to: string) => `${to} 里已经有文件，先把它们移走。什么都没改。`,
      notSameVolume: (from: string, to: string) => `${from} 和 ${to} 不在同一个磁盘上，不能一步移过去。什么都没改。`,
      diskSpace: (needed: number, free: number) => `剩余空间不够放一份数据库备份：要 ${needed} 字节，只有 ${free} 字节。什么都没改。`,
      socketPathTooLong: (path: string, bytes: number) => `socket 路径 ${path} 有 ${bytes} 字节，macOS 最多 103 字节。什么都没改。`,
      schemaBehind: (current: number | null, latest: number) =>
        `数据库版本是 ${current ?? "未知"}，这份代码要的是 ${latest}。先用新代码重启服务，再迁移。什么都没改。`,
      schemaAhead: (current: number, latest: number) =>
        `数据库版本是 ${current}，比这份代码支持的 ${latest} 新。请装更新的版本。什么都没改。`,
      step: (error: string) => `失败：${error}`,
    },
  },
});
