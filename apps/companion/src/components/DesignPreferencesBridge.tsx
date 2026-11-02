import { DesignPreferencesProvider } from '@pi-lead-child/components';
import { useEffect, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';

import { DEFAULT_LOCALE } from '@/i18n';
import { cachedLocale, rememberLocale } from '@/i18n/localeCache';
import { useDesignPreferences } from '@/state/hooks';

// 外观偏好（设置 → 外观）从 daemon 取到后交给组件库：密度、字号、行高、圆角、颜色和界面语言都按它画。
// 没取到时用缺省值；语言用上次记住的（localeCache.ts）。
// 网页的静态导出按缺省语言（英文）预渲染：水合时先用缺省语言，水合完再换成记住的语言，不然 React 报水合不一致（#418）。
const noSubscribe = () => () => {};

export function DesignPreferencesBridge({ children }: PropsWithChildren) {
  const { designPreferences } = useDesignPreferences();
  const remembered = useSyncExternalStore(noSubscribe, cachedLocale, () => DEFAULT_LOCALE);
  const locale = designPreferences?.locale;
  useEffect(() => {
    if (locale) rememberLocale(locale);
  }, [locale]);
  const value = useMemo(() => designPreferences ?? { locale: remembered }, [designPreferences, remembered]);
  return <DesignPreferencesProvider value={value}>{children}</DesignPreferencesProvider>;
}
