import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { projectRoot } from "@pi-lead-child/core";

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// node 版本号从新到旧：v24.1.0 排在 v22.19.0 前面，v9 排在 v10 后面。
function compareNodeVersionsDescending(a: string, b: string): number {
  const parts = (name: string) => name.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function nvmBinDirectories(home: string): string[] {
  try {
    return readdirSync(join(home, ".nvm", "versions", "node"))
      .filter((name) => name.startsWith("v"))
      .sort(compareNodeVersionsDescending)
      .map((name) => join(home, ".nvm", "versions", "node", name, "bin"));
  } catch {
    return [];
  }
}

/**
 * 用户常把 codex、claude 装在这些目录里（docs/desktop/macos-desktop-design.md 第 5.1 节）。从 Dock 打开的 App 和
 * launchd 起的进程拿不到用户 shell 的 PATH，靠这份清单兜底。nvm 的各个 Node 版本按版本号从新到旧排。
 */
export function knownUserBinDirectories(home = homedir()): string[] {
  return [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".claude", "local"),
    ...nvmBinDirectories(home),
  ];
}

/**
 * 找执行器的目录，按顺序：daemon 自己的 Node 和仓库的 node_modules/.bin，登录 shell 的 PATH（login-shell-path.json，
 * 和用户终端里找到的是同一个），进程现在的 PATH，已知的用户目录，Homebrew 和系统目录。
 */
export function runtimeBinDirectories(
  existingPath = process.env.PATH ?? "",
  options: { loginShellPath?: string[]; home?: string } = {},
): string[] {
  return [...new Set([
    dirname(process.execPath),
    join(projectRoot(), "node_modules", ".bin"),
    ...(options.loginShellPath ?? []),
    ...existingPath.split(delimiter).filter(Boolean),
    ...knownUserBinDirectories(options.home),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ])];
}

export function runtimeSearchPath(
  existingPath = process.env.PATH ?? "",
  options: { loginShellPath?: string[]; home?: string } = {},
): string {
  return runtimeBinDirectories(existingPath, options).join(delimiter);
}

export function findRuntimeExecutable(
  nameOrPath: string,
  existingPath = process.env.PATH ?? "",
): string | null {
  if (isAbsolute(nameOrPath) || nameOrPath.includes("/")) {
    return executable(nameOrPath) ? nameOrPath : null;
  }
  for (const dir of runtimeBinDirectories(existingPath)) {
    const candidate = join(dir, nameOrPath);
    if (executable(candidate)) return candidate;
  }
  return null;
}

export function resolveRuntimeExecutable(
  nameOrPath: string,
  existingPath = process.env.PATH ?? "",
): string {
  return findRuntimeExecutable(nameOrPath, existingPath) ?? nameOrPath;
}
