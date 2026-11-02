// 界面语言（2026-11-01）：用户在设置 → 外观里选，和外观偏好存在一起（locale 字段）。缺省是英文。
//
// 文案放在有类型的目录里，不用字符串键：
//
//   export const appearanceMessages = defineMessages({
//     en: { title: "Appearance", updated: (when: string) => `Last changed ${when}.` },
//     zh: { title: "外观", updated: (when) => `最近一次修改：${when}。` },
//   });
//   const m = appearanceMessages(locale);   // m.title、m.updated("10-29 14:00")
//
// zh 必须和 en 有完全一样的键和参数，漏翻译是类型错误。带参数的文案（数量、名字、单复数）写成函数。
// 目录放在用它的代码旁边。写法见 docs/i18n.md。

export const LOCALES = ["en", "zh"] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = "en";

// 每种语言用它自己的文字写名字：看不懂当前语言的人也能找到自己的语言。
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", zh: "中文" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** 给 Intl 和 toLocaleString 用的 BCP 47 标签。 */
export function intlLocale(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

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
  return (locale) => (locale === "zh" ? catalog.zh : catalog.en as unknown as Translation<T>);
}
