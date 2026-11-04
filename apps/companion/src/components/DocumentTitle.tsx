import { useEffect } from 'react';

import { useLeadName } from '@/state/hooks';

// 网页的标题是用户配置的 Lead 名字（docs/desktop/macos-desktop-design.md 第 4.1 节）。桌面版的窗口标题跟着网页标题走，
// 用户在设置里改了名字，标题跟着变。Expo Router 关掉了按页面设标题（ExpoRoot 的 documentTitle），所以这里是唯一设它的地方。
// 原生上没有 document，什么也不做。
export function DocumentTitle() {
  const leadName = useLeadName();
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = leadName;
  }, [leadName]);
  return null;
}
