// 用户登录 shell 里的 PATH 和工具目录变量（2026-10-28）。用户：「我预期 Fairy 能正常调用我本机的 CLI，各种 bash」。
// daemon 由 launchd 拉起，环境里只有系统的 PATH 加几个目录：/pkg/env/global/bin、~/go/bin、~/.cargo/bin、~/.bun/bin、
// /opt/homebrew/sbin、Python 的 bin 都没有，Lead 和执行者在里面一跑就是 command not found。
// daemon 启动时用用户的 shell 读一次（`$SHELL -ilc`，和用户开一个终端一样），补到 daemon 的环境里，Lead 的 bash 和
// child 都继承（runtime 的 environment.ts：child 继承 daemon 的全部环境）。
//   - PATH：按登录 shell 的顺序（`python3` 这类命令要和用户终端里找到的是同一个；2026-10-28 发现接在后面时 Lead 的
//     python3 是 /usr/bin 下命令行工具自带的 3.9，用户终端里是 python.org 的 3.12）。daemon 自己的 Node 和仓库的
//     node_modules/.bin 仍然排在最前；daemon 原来有、登录 shell 没有的目录接在最后。
//   - 工具目录变量（*_HOME、*_ROOT、GOPATH 这类路径、HOMEBREW_*、NVM_*、LANG）：daemon 里没有的才补。
//   - 别的变量不补，尤其是密钥（OPENAI_API_KEY 这类）和改变 CLI 行为的（ANTHROPIC_BASE_URL 这类）：并进 daemon 的环境，
//     Codex 这类执行者会从订阅登录换成按 API key 计费。
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

const MARKER = "__PLC_LOGIN_ENV__";

// 补的变量：名字是路径或目录的，或者几个工具自己的前缀。
const TOOL_VARIABLE = /^(?:[A-Z][A-Z0-9_]*_(?:HOME|ROOT|INSTALL)|GOPATH|GOBIN|MANPATH|INFOPATH|HOMEBREW_[A-Z_]+|NVM_[A-Z_]+|PNPM_HOME|LANG|LC_[A-Z]+)$/;

/** 解析 `printf MARKER; env -0` 的输出。rc 文件可能往 stdout 打印别的东西，只认标记以后的部分。 */
export function parseLoginShellEnv(output: string): Record<string, string> | null {
  const at = output.lastIndexOf(MARKER);
  if (at < 0) return null;
  const env: Record<string, string> = {};
  for (const entry of output.slice(at + MARKER.length).split("\0")) {
    const eq = entry.indexOf("=");
    const name = entry.slice(0, eq).trim();
    if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) env[name] = entry.slice(eq + 1);
  }
  return env;
}

/**
 * 用户登录 shell 的环境。读不到（没有 shell、超时、rc 文件出错）时为 null。最多等 timeoutMs：rc 文件慢不能卡住 daemon 启动。
 * 值里可能有密钥：只给 mergeLoginShellEnv 挑选，不要整个存下或者打印。
 */
export function loginShellEnv(options: { shell?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Record<string, string> | null {
  const shell = options.shell ?? options.env?.SHELL ?? process.env.SHELL ?? "/bin/zsh";
  try {
    const result = spawnSync(shell, ["-ilc", `printf '%s' ${MARKER}; command env -0`], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: options.timeoutMs ?? 8_000,
      env: options.env ?? process.env, maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) return null;
    return parseLoginShellEnv(result.stdout);
  } catch {
    return null;
  }
}

/**
 * 把登录 shell 的 PATH 和工具目录变量补进 target（就地改），返回补了哪些名字（只有名字）。
 * PATH：daemon 自己的目录（nodeDir 和 node_modules/.bin）在前，然后按登录 shell 的顺序，daemon 原来有、登录 shell 没有的接在最后，去重。
 */
export function mergeLoginShellEnv(
  target: Record<string, string | undefined>, login: Record<string, string>, nodeDir: string = dirname(process.execPath),
): string[] {
  const merged: string[] = [];
  const current = (target.PATH ?? "").split(delimiter).filter(Boolean);
  const loginDirs = (login.PATH ?? "").split(delimiter).filter(Boolean);
  if (loginDirs.length) {
    const own = current.filter((dir) => dir === nodeDir || dir.endsWith("/node_modules/.bin"));
    const next = [...new Set([...own, ...loginDirs, ...current])].join(delimiter);
    if (next !== target.PATH) {
      target.PATH = next;
      merged.push("PATH");
    }
  }
  for (const [name, value] of Object.entries(login)) {
    if (name === "PATH" || target[name] !== undefined || !value || !TOOL_VARIABLE.test(name)) continue;
    target[name] = value;
    merged.push(name);
  }
  return merged;
}

// ── 登录 shell 的 PATH，存成文件（桌面版，docs/desktop/macos-desktop-design.md 第 5.1 节，P0-3）──
// 从 Dock 打开的 App 和 launchd 起的进程只有 /usr/bin:/bin:/usr/sbin:/sbin，用 nvm、Volta、npm 全局目录装的 codex、claude
// 找不到。安装时和每次打开 App 时读一次登录 shell 的 PATH，写进 <数据目录>/login-shell-path.json；supervisor 和 daemon
// 启动时读它，合并进 runtimeSearchPath。文件里只有 PATH，没有别的变量，所以不会存下密钥。
//   - 命令是固定字符串，不拼接任何外部输入。shell 本身用参数数组传给 spawn，不经过另一层 shell。
//   - $SHELL 只接受 /etc/shells 里列出的绝对路径。
//   - 最多等 5 秒。交互式 shell 不理 SIGTERM：到时间就用 SIGKILL 杀掉整个进程组，不等管道关闭。
const PATH_MARKER = "__PLC_PATH__";
export const LOGIN_SHELL_PATH_COMMAND = `printf "${PATH_MARKER}%s${PATH_MARKER}" "$PATH"`;
export const LOGIN_SHELL_PATH_TIMEOUT_MS = 5_000;
export const LOGIN_SHELL_PATH_FILE = "login-shell-path.json";

export type LoginShellPathResult =
  | { state: "ok"; shell: string; path: string[] }
  | { state: "skipped"; reason: "no_shell" | "shell_not_listed"; shell: string | null }
  | { state: "timed_out"; shell: string }
  | { state: "failed"; shell: string; reason: string };

/** 只取最后一对标记之间的内容：rc 文件往 stdout 打印的别的文字不算。只留绝对路径，去重。 */
export function parseLoginShellPath(output: string): string[] | null {
  const end = output.lastIndexOf(PATH_MARKER);
  if (end < 0) return null;
  const start = output.lastIndexOf(PATH_MARKER, end - 1);
  if (start < 0) return null;
  const value = output.slice(start + PATH_MARKER.length, end);
  return [...new Set(value.split(delimiter).filter((dir) => isAbsolute(dir)))];
}

/** /etc/shells 里列出的 shell。读不到时为空：那就一个都不信。 */
export function listedShells(etcShells = "/etc/shells"): string[] {
  try {
    return readFileSync(etcShells, "utf8").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("/"));
  } catch {
    return [];
  }
}

export async function captureLoginShellPath(options: {
  shell?: string | null; etcShells?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv;
} = {}): Promise<LoginShellPathResult> {
  const shell = options.shell === undefined ? process.env.SHELL ?? null : options.shell;
  if (!shell) return { state: "skipped", reason: "no_shell", shell: null };
  if (!isAbsolute(shell) || !listedShells(options.etcShells).includes(shell)) {
    return { state: "skipped", reason: "shell_not_listed", shell };
  }
  const timeoutMs = options.timeoutMs ?? LOGIN_SHELL_PATH_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    const child = spawn(shell, ["-ilc", LOGIN_SHELL_PATH_COMMAND], {
      stdio: ["ignore", "pipe", "ignore"], detached: true, env: options.env ?? process.env,
    });
    const finish = (result: LoginShellPathResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      resolve(result);
    };
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // 进程组已经没了。
      }
    };
    const timer = setTimeout(() => { killGroup(); finish({ state: "timed_out", shell }); }, timeoutMs);
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) { killGroup(); finish({ state: "failed", shell, reason: "output too large" }); }
    });
    child.once("error", (error) => finish({ state: "failed", shell, reason: error.message }));
    let exit: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null };
    const evaluate = () => {
      const path = parseLoginShellPath(stdout);
      if (path?.length) finish({ state: "ok", shell, path });
      else finish({ state: "failed", shell, reason: exit.code === 0 ? "no PATH in the output" : `exit ${exit.code ?? exit.signal}` });
    };
    child.once("close", evaluate);
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      // shell 自己退出了，rc 文件起的后台进程可能还占着 stdout：再等一小会儿读完已经写出的内容，不等管道关闭。
      // 那个后台进程不是卡住的 shell，不杀它，只关掉这一端的管道。
      setTimeout(evaluate, 200).unref();
    });
  });
}

export function loginShellPathFile(dir: string): string {
  return join(dir, LOGIN_SHELL_PATH_FILE);
}

/** 读不到成功的结果时不改文件：上一次读到的 PATH 比没有好。 */
export function saveLoginShellPath(dir: string, result: LoginShellPathResult, now = new Date()): boolean {
  if (result.state !== "ok") return false;
  const file = loginShellPathFile(dir);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, capturedAt: now.toISOString(), shell: result.shell, path: result.path }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  return true;
}

/** 上一次存下的登录 shell PATH。没有文件或者内容不对时为空。 */
export function readLoginShellPath(dir: string): string[] {
  try {
    const value = JSON.parse(readFileSync(loginShellPathFile(dir), "utf8")) as { version?: unknown; path?: unknown };
    if (value.version !== 1 || !Array.isArray(value.path)) return [];
    return value.path.filter((dir): dir is string => typeof dir === "string" && isAbsolute(dir));
  } catch {
    return [];
  }
}
