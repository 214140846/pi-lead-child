import { shellUpdateFromBridge, type ShellUpdateSource } from '@/state/shellUpdate';

// 桌面 App 里的网页：preload 给的 window.bytezardLead.update（desktop/src/preload.ts）。浏览器里没有。
function bridge(): unknown {
  if (typeof window === 'undefined') return undefined;
  return (window as { bytezardLead?: { update?: unknown } }).bytezardLead?.update;
}

export const platformShellUpdate: ShellUpdateSource | undefined = shellUpdateFromBridge(bridge());
