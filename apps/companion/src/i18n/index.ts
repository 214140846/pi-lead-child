// 界面文案的多语言（2026-11-01）。机制在 protocol 的 i18n.ts；语言来自外观偏好（设置 → 外观），组件库的 useLocale() 给出。
// 功能代码把文案写成目录（defineMessages），放在用它的文件旁边，在组件里用 useMessages 取当前语言的那一份。
// 不在组件里的函数（*Model.ts）收一个 locale 参数，或者直接收目录取好的文案。写法见 docs/i18n.md。
import { useLocale } from '@pi-lead-child/components';
import type { Locale } from '@pi-lead-child/protocol';

export { DEFAULT_LOCALE, LOCALE_NAMES, LOCALES, defineMessages, intlLocale, isLocale, type Locale } from '@pi-lead-child/protocol';
export { useLocale } from '@pi-lead-child/components';

/** 当前语言的文案。 */
export function useMessages<T>(catalog: (locale: Locale) => T): T {
  return catalog(useLocale());
}
