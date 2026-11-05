import type { ShellUpdateSource } from '@/state/shellUpdate';

// 兜底实现：Metro 在 web 上选 .web.ts。原生应用和 node 测试不在桌面 App 里，没有一键更新。
export const platformShellUpdate: ShellUpdateSource | undefined = undefined;
