// 桌面 App 的一键更新（用户 2026-11-04）。App 每天查一次 GitHub release，有新版时网页的顶栏显示新版本和「更新」；
// 点了以后 App 自己下载、校验、换成新版并重开（desktop/src/updater.ts）。网页只读状态、转交两个按钮。
// 这不是调后端的操作（P5.7）：按钮调的是 App 壳，不是 daemon，所以没有 HTTP 路由和 Lead 工具。
// 只有桌面 App 里的网页有这座桥（desktop/src/preload.ts 的 window.bytezardLead.update），浏览器和原生应用里没有。

// 和 desktop/src/updater.ts 的 ShellUpdateStatus 一样。改一处要改另一处。
export type ShellUpdateFailure = 'download_failed' | 'checksum_mismatch' | 'mount_failed' | 'app_invalid' | 'not_writable' | 'replace_failed';

export type ShellUpdateStatus =
  | { state: 'none' }
  | { state: 'available'; version: string; size: number }
  | { state: 'downloading'; version: string; received: number; total: number }
  | { state: 'installing'; version: string }
  | { state: 'failed'; version: string; code: ShellUpdateFailure; detail: string };

export interface ShellUpdateSource {
  get(): Promise<ShellUpdateStatus>;
  /** 状态变了时调 listener。返回的函数停止收。 */
  subscribe(listener: (status: ShellUpdateStatus) => void): () => void;
  apply(): Promise<void>;
  dismiss(): Promise<void>;
}

const NONE: ShellUpdateStatus = { state: 'none' };
const FAILURES: ReadonlySet<string> = new Set<ShellUpdateFailure>([
  'download_failed', 'checksum_mismatch', 'mount_failed', 'app_invalid', 'not_writable', 'replace_failed',
]);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** App 壳给的状态。认不出来时当成没有新版。 */
export function parseShellUpdateStatus(value: unknown): ShellUpdateStatus {
  if (!value || typeof value !== 'object') return NONE;
  const status = value as Record<string, unknown>;
  const version = typeof status.version === 'string' ? status.version : null;
  if (status.state === 'available' && version && isCount(status.size)) return { state: 'available', version, size: status.size };
  if (status.state === 'downloading' && version && isCount(status.received) && isCount(status.total)) {
    return { state: 'downloading', version, received: status.received, total: status.total };
  }
  if (status.state === 'installing' && version) return { state: 'installing', version };
  if (status.state === 'failed' && version && typeof status.code === 'string' && FAILURES.has(status.code)) {
    return { state: 'failed', version, code: status.code as ShellUpdateFailure, detail: typeof status.detail === 'string' ? status.detail : '' };
  }
  return NONE;
}

interface ShellUpdateBridge {
  get(): Promise<unknown>;
  apply(): Promise<unknown>;
  dismiss(): Promise<unknown>;
  onStatus(callback: (status: unknown) => void): void;
}

function isBridge(value: unknown): value is ShellUpdateBridge {
  if (!value || typeof value !== 'object') return false;
  const bridge = value as Record<string, unknown>;
  return typeof bridge.get === 'function' && typeof bridge.apply === 'function'
    && typeof bridge.dismiss === 'function' && typeof bridge.onStatus === 'function';
}

/** 把 preload 给的桥包成 ShellUpdateSource。桥只能注册、不能注销监听，所以只注册一次，再分给各个订阅者。 */
export function shellUpdateFromBridge(value: unknown): ShellUpdateSource | undefined {
  if (!isBridge(value)) return undefined;
  const listeners = new Set<(status: ShellUpdateStatus) => void>();
  value.onStatus((status) => {
    const parsed = parseShellUpdateStatus(status);
    for (const listener of listeners) listener(parsed);
  });
  return {
    get: async () => parseShellUpdateStatus(await value.get()),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    apply: async () => { await value.apply(); },
    dismiss: async () => { await value.dismiss(); },
  };
}
