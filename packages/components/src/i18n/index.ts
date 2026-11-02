// 组件库自己的文案目录（2026-11-01）。组件库不依赖 protocol，所以这里写一份同样形状的小工具：
// defineMessages、Translation 和 packages/protocol/src/i18n.ts 的保持一致，改一边时另一边一起改。
// 组件里用 useMessages(catalog) 取当前语言的那一份；纯函数收一个可选的 locale 参数，缺省 'en'。
import { useLocale, type Locale } from '../theme/preferences';

export type { Locale } from '../theme/preferences';
export const DEFAULT_LOCALE: Locale = 'en';

type MessageFn = (...args: never[]) => string;
export type MessageTree = { readonly [key: string]: string | MessageFn | MessageTree };

/** 和 T 一样的形状，字符串放宽成 string：一份翻译要满足的类型。 */
export type Translation<T> = {
  readonly [K in keyof T]: T[K] extends string ? string
    : T[K] extends (...args: infer A) => string ? (...args: A) => string
      : Translation<T[K]>;
};

/** 一个目录：每种语言一个对象。返回从语言到那种语言的文案的查找函数。 */
export function defineMessages<T extends MessageTree>(catalog: { en: T; zh: Translation<T> }): (locale: Locale) => Translation<T> {
  return (locale) => (locale === 'zh' ? catalog.zh : catalog.en as unknown as Translation<T>);
}

/** 当前语言的文案。 */
export function useMessages<T>(catalog: (locale: Locale) => T): T {
  return catalog(useLocale());
}
