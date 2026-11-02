// 记住上次的界面语言。外观偏好要等连上 daemon 才取得到；这之前用记住的语言画，选了中文的人打开页面时不会先闪一下英文。
// 只在 web 上有 localStorage；原生上和隐私模式下读写失败，按缺省的英文画。
import { DEFAULT_LOCALE, isLocale, type Locale } from '@pi-lead-child/protocol';

const KEY = 'plc.locale';

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function cachedLocale(): Locale {
  try {
    const value = storage()?.getItem(KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function rememberLocale(locale: Locale): void {
  try {
    storage()?.setItem(KEY, locale);
  } catch {
    // 存不下时下次按缺省语言画，不影响功能。
  }
}
