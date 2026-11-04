// 壳用到的路径（docs/desktop/macos-desktop-design.md 第 1.1 节）。
// 壳不 import 后端的包，数据目录的规则在这里照 packages/core/src/config.ts 的 dataDir()、installRoot() 写一份：
// PLC_DATA_DIR 优先，缺省是 ~/.pi-lead-child。P0-8 改数据目录时两处一起改；desktop/test/paths.test.ts 拿这里的结果和
// core 的比，改了一处没改另一处会失败。
import { homedir } from "node:os";
import { join } from "node:path";

export interface ShellPaths {
  /** 数据目录：plc.db、config.json、socket、logs。 */
  dataDir: string;
  /** 安装根：<数据目录>/runtime。 */
  installRoot: string;
  versionsDir: string;
  /** <安装根>/current：plist 和 desktop-install 都用这个路径，不用解开软链接以后的版本目录。 */
  current: string;
  /** Electron 的 userData：缓存和窗口状态放这里，不混进数据目录的根（设计第 1.1 节）。 */
  shellUserData: string;
  /** 上次记下的 Lead 名字，安装页的窗口标题用它。 */
  leadNameFile: string;
  logsDir: string;
  daemonSocket: string;
  installStateFile: string;
  /** daemon 在发布模式写的回环自动配对口令（shell-pairing.ts）。 */
  shellPairingKeyFile: string;
}

export function shellPaths(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): ShellPaths {
  const dataDir = env.PLC_DATA_DIR ?? join(home, ".pi-lead-child");
  const installRoot = join(dataDir, "runtime");
  const shellUserData = join(dataDir, "shell");
  return {
    dataDir,
    installRoot,
    versionsDir: join(installRoot, "versions"),
    current: join(installRoot, "current"),
    shellUserData,
    leadNameFile: join(shellUserData, "lead-name.json"),
    logsDir: join(dataDir, "logs"),
    daemonSocket: join(dataDir, "plc.sock"),
    installStateFile: join(installRoot, "install-state.json"),
    shellPairingKeyFile: join(dataDir, "shell-pairing.key"),
  };
}

/** 运行包里的 Node（改名为 lead-agent）和 ops 入口。 */
export function runtimeCommand(root: string): { node: string; ops: string } {
  return { node: join(root, "bin", "lead-agent"), ops: join(root, "apps", "daemon", "dist", "ops.mjs") };
}
