// 桌面 App 的版本、构建号、提交和后台服务（运行包）的版本（desktop/src/build-info.ts，用户 2026-11-05）。
// 设置 → 设备 → 本设备显示它们。只有桌面 App 里的网页有这座桥（preload 的 window.bytezardLead.about），浏览器里没有。

// 和 desktop/src/build-info.ts 的 ShellAbout 一样。改一处要改另一处。
export interface ShellAbout {
  version: string;
  build: string | null;
  commit: string | null;
  runtimeVersion: string | null;
}

export type ShellAboutSource = () => Promise<ShellAbout | null>;

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** App 壳给的值。认不出来时为 null。 */
export function parseShellAbout(value: unknown): ShellAbout | null {
  if (!value || typeof value !== 'object') return null;
  const about = value as Record<string, unknown>;
  const version = text(about.version);
  if (!version) return null;
  return { version, build: text(about.build), commit: text(about.commit), runtimeVersion: text(about.runtimeVersion) };
}

export function shellAboutFromBridge(value: unknown): ShellAboutSource | undefined {
  if (typeof value !== 'function') return undefined;
  const read = value as () => Promise<unknown>;
  return async () => parseShellAbout(await read());
}

/**
 * 给人看的版本号（和 desktop/src/build-info.ts 的 displayVersion 一样）：本机构建的版本号以「.构建号」结尾，
 * 后面的括号里又有构建号，显示时去掉这一段，写成「1.1.1-local (202611050212)」。
 */
export function displayVersion(version: string, build: string | null): string {
  return build && version.endsWith(`.${build}`) ? version.slice(0, -(build.length + 1)) : version;
}

