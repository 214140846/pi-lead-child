import { shellAboutFromBridge, type ShellAboutSource } from '@/state/shellAbout';

// 桌面 App 里的网页：preload 给的 window.bytezardLead.about（desktop/src/preload.ts）。浏览器里没有。
function bridge(): unknown {
  if (typeof window === 'undefined') return undefined;
  return (window as { bytezardLead?: { about?: unknown } }).bytezardLead?.about;
}

export const platformShellAbout: ShellAboutSource | undefined = shellAboutFromBridge(bridge());
