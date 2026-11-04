// 用户登录 shell 的 PATH 和工具目录变量（2026-10-28，用户：「我预期 Fairy 能正常调用我本机的 CLI，各种 bash」）。
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../testing/index.js";
import {
  captureLoginShellPath, LOGIN_SHELL_PATH_COMMAND, loginShellEnv, loginShellPathFile, mergeLoginShellEnv, parseLoginShellEnv,
  parseLoginShellPath, readLoginShellPath, saveLoginShellPath,
} from "../src/login-shell.js";

describe("parseLoginShellEnv", () => {
  it("reads only what follows the marker, so rc files that print banners do not leak in", () => {
    const output = "Welcome!\nPATH=/fake\n__PLC_LOGIN_ENV__PATH=/usr/bin:/opt/x\0GOPATH=/Users/u/go\0MULTI=a\nb\0bad name=1\0";
    expect(parseLoginShellEnv(output)).toEqual({ PATH: "/usr/bin:/opt/x", GOPATH: "/Users/u/go", MULTI: "a\nb" });
    expect(parseLoginShellEnv("no marker here")).toBeNull();
  });
});

describe("mergeLoginShellEnv", () => {
  it("follows the login shell's PATH order after the daemon's own Node, and fills only missing tool variables", () => {
    const target: Record<string, string | undefined> = { PATH: "/node/bin:/repo/node_modules/.bin:/usr/bin:/daemon/only", JAVA_HOME: "/daemon/java" };
    const merged = mergeLoginShellEnv(target, {
      PATH: "/Library/Frameworks/Python.framework/Versions/3.12/bin:/opt/homebrew/bin:/usr/bin:/pkg/env/global/bin:/opt/homebrew/bin",
      JAVA_HOME: "/shell/java", GOPATH: "/Users/u/go", NVM_DIR: "/Users/u/.nvm", PNPM_HOME: "/Users/u/pnpm",
      // 不补：密钥，和会改变 CLI 行为的变量。
      OPENAI_API_KEY: "sk-x", ANTHROPIC_BASE_URL: "http://127.0.0.1:1", NODE_OPTIONS: "--x",
    }, "/node/bin");
    // daemon 的 Node 仍然排第一；python3 这类命令和用户终端里找到的是同一个（3.12 在 /usr/bin 前面）。
    expect(target.PATH).toBe([
      "/node/bin", "/repo/node_modules/.bin", "/Library/Frameworks/Python.framework/Versions/3.12/bin", "/opt/homebrew/bin",
      "/usr/bin", "/pkg/env/global/bin", "/daemon/only",
    ].join(":"));
    expect(target.JAVA_HOME).toBe("/daemon/java");
    expect(target).toMatchObject({ GOPATH: "/Users/u/go", NVM_DIR: "/Users/u/.nvm", PNPM_HOME: "/Users/u/pnpm" });
    for (const name of ["OPENAI_API_KEY", "ANTHROPIC_BASE_URL", "NODE_OPTIONS"]) expect(target).not.toHaveProperty(name);
    expect(merged.sort()).toEqual(["GOPATH", "NVM_DIR", "PATH", "PNPM_HOME"]);
  });
});

describe.runIf(process.platform !== "win32")("loginShellEnv", () => {
  it("reads the environment a login shell ends up with", () => {
    const home = tempDir("plc-login-shell-");
    const env = loginShellEnv({ shell: "/bin/sh", env: { HOME: home, PATH: "/usr/bin:/bin", FOO_HOME: "/x/foo" } });
    expect(env).toMatchObject({ FOO_HOME: "/x/foo" });
    expect(env?.PATH).toContain("/usr/bin");
  });

  it("gives up instead of failing when the shell does not exist", () => {
    expect(loginShellEnv({ shell: "/no/such/shell" })).toBeNull();
  });
});

// 桌面版（docs/desktop/macos-desktop-design.md 第 5.1 节）：安装时读登录 shell 的 PATH，存成 login-shell-path.json。
describe("parseLoginShellPath", () => {
  it("takes only the text between the last pair of markers, so rc files that print other text do not leak in", () => {
    const output = "Welcome back!\n__PLC_PATH__ in a banner\nnvm: using v24\n__PLC_PATH__/Users/alice/.nvm/versions/node/v24.1.0/bin:relative/dir:/usr/bin:/usr/bin__PLC_PATH__\nbye\n";
    expect(parseLoginShellPath(output)).toEqual(["/Users/alice/.nvm/versions/node/v24.1.0/bin", "/usr/bin"]);
    expect(parseLoginShellPath("only one __PLC_PATH__ marker")).toBeNull();
    expect(parseLoginShellPath("nothing")).toBeNull();
  });
});

describe.runIf(process.platform !== "win32")("captureLoginShellPath", () => {
  // 假的 shell：先往 stdout 打印别的文字，再像 sh 一样运行 -ilc 后面的命令。它必须列在（假的）/etc/shells 里。
  function fakeShell(body: string): { shell: string; etcShells: string } {
    const dir = tempDir("plc-login-path-");
    const shell = join(dir, "fake shell");
    writeFileSync(shell, `#!/bin/sh\n${body}\n`);
    chmodSync(shell, 0o755);
    const etcShells = join(dir, "shells");
    writeFileSync(etcShells, `# List of acceptable shells\n/bin/sh\n${shell}\n`);
    return { shell, etcShells };
  }

  it("runs the fixed command and reads the PATH even when the rc files print other text", async () => {
    const { shell, etcShells } = fakeShell('echo "Last login: today"\nprintf "__PLC_PATH__ not this"\n/bin/sh -c "$2"\necho "goodbye"');
    const result = await captureLoginShellPath({ shell, etcShells, env: { PATH: "/opt/tools/bin:/usr/bin:/bin" } });
    expect(result).toEqual({ state: "ok", shell, path: ["/opt/tools/bin", "/usr/bin", "/bin"] });
    expect(LOGIN_SHELL_PATH_COMMAND).toBe('printf "__PLC_PATH__%s__PLC_PATH__" "$PATH"');
  });

  it("gives up after the timeout and kills the shell, which may ignore SIGTERM", async () => {
    const { shell, etcShells } = fakeShell("trap '' TERM\nsleep 30");
    const started = Date.now();
    const result = await captureLoginShellPath({ shell, etcShells, timeoutMs: 300 });
    expect(result).toEqual({ state: "timed_out", shell });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("skips a shell that /etc/shells does not list, and a missing $SHELL", async () => {
    const { shell } = fakeShell("exit 0");
    const etcShells = join(tempDir("plc-login-path-"), "shells");
    writeFileSync(etcShells, "/bin/sh\n");
    expect(await captureLoginShellPath({ shell, etcShells })).toEqual({ state: "skipped", reason: "shell_not_listed", shell });
    expect(await captureLoginShellPath({ shell: "sh", etcShells })).toEqual({ state: "skipped", reason: "shell_not_listed", shell: "sh" });
    expect(await captureLoginShellPath({ shell: null, etcShells })).toEqual({ state: "skipped", reason: "no_shell", shell: null });
  });

  it("reports a shell that exits without printing the PATH as failed", async () => {
    const { shell, etcShells } = fakeShell("echo broken rc file\nexit 1");
    expect(await captureLoginShellPath({ shell, etcShells })).toMatchObject({ state: "failed", shell });
  });
});

describe("login-shell-path.json", () => {
  it("stores only the PATH, owner-only, and keeps the last good PATH when a later read fails", () => {
    const dir = tempDir("plc-login-path-file-");
    expect(readLoginShellPath(dir)).toEqual([]);
    const now = new Date("2026-11-03T08:00:00.000Z");
    expect(saveLoginShellPath(dir, { state: "ok", shell: "/bin/zsh", path: ["/Users/alice/.volta/bin", "/usr/bin"] }, now)).toBe(true);
    expect(JSON.parse(readFileSync(loginShellPathFile(dir), "utf8"))).toEqual({
      version: 1, capturedAt: now.toISOString(), shell: "/bin/zsh", path: ["/Users/alice/.volta/bin", "/usr/bin"],
    });
    expect(statSync(loginShellPathFile(dir)).mode & 0o777).toBe(0o600);
    expect(readLoginShellPath(dir)).toEqual(["/Users/alice/.volta/bin", "/usr/bin"]);
    expect(saveLoginShellPath(dir, { state: "timed_out", shell: "/bin/zsh" })).toBe(false);
    expect(readLoginShellPath(dir)).toEqual(["/Users/alice/.volta/bin", "/usr/bin"]);
  });

  it("ignores a file with the wrong shape and entries that are not absolute paths", () => {
    const dir = tempDir("plc-login-path-file-");
    writeFileSync(loginShellPathFile(dir), JSON.stringify({ version: 1, path: ["/ok/bin", "relative", 3] }));
    expect(readLoginShellPath(dir)).toEqual(["/ok/bin"]);
    writeFileSync(loginShellPathFile(dir), "not json");
    expect(readLoginShellPath(dir)).toEqual([]);
    expect(existsSync(loginShellPathFile(dir))).toBe(true);
  });
});
