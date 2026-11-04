// 壳的界面语言和文案目录（docs/i18n.md）。壳不 import 后端的包（设计第 8.1 节），所以这里按
// packages/protocol/src/i18n.ts 的形状写一份：zh 必须和 en 有完全一样的键和参数，漏写是类型错误。
// 壳在装好服务以前读不到用户在设置 → 外观里选的语言，所以按系统的首选语言选：中文用 zh，其余用缺省的 en。

export const LOCALES = ["en", "zh"] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = "en";

type MessageFn = (...args: never[]) => string;
export type MessageTree = { readonly [key: string]: string | MessageFn | MessageTree };

export type Translation<T> = {
  readonly [K in keyof T]: T[K] extends string ? string
    : T[K] extends (...args: infer A) => string ? (...args: A) => string
      : Translation<T[K]>;
};

export function defineMessages<T extends MessageTree>(catalog: { en: T; zh: Translation<T> }): (locale: Locale) => Translation<T> {
  return (locale) => (locale === "zh" ? catalog.zh : catalog.en as unknown as Translation<T>);
}

/** 系统的首选语言列表（app.getPreferredSystemLanguages()）里第一个认识的语言。 */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (language === "zh") return "zh";
    if (language === "en") return "en";
  }
  return DEFAULT_LOCALE;
}
