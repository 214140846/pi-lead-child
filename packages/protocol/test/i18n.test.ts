// 文案目录（2026-11-01）：按语言取文案；中文缺键、多键、参数不对都是类型错误（typecheck 检查下面的 @ts-expect-error）。
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, defineMessages, intlLocale, isLocale } from "../src/i18n.ts";

const messages = defineMessages({
  en: { title: "Settings", count: (n: number) => (n === 1 ? "1 ticket" : `${n} tickets`), nested: { save: "Save" } },
  zh: { title: "设置", count: (n) => `${n} 个工单`, nested: { save: "保存" } },
});

describe("defineMessages", () => {
  it("returns the messages of the asked language, English by default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(messages("en").title).toBe("Settings");
    expect(messages("zh").title).toBe("设置");
    expect(messages("en").count(1)).toBe("1 ticket");
    expect(messages("en").count(3)).toBe("3 tickets");
    expect(messages("zh").count(3)).toBe("3 个工单");
    expect(messages("zh").nested.save).toBe("保存");
  });

  it("makes a missing, extra or mistyped translation a type error", () => {
    // @ts-expect-error zh 少了 nested
    defineMessages({ en: { title: "a", nested: { save: "b" } }, zh: { title: "甲" } });
    // @ts-expect-error zh 多了 extra
    defineMessages({ en: { title: "a" }, zh: { title: "甲", extra: "乙" } });
    // @ts-expect-error 参数类型和 en 不一样
    defineMessages({ en: { count: (n: number) => `${n}` }, zh: { count: (n: string) => n } });
    // @ts-expect-error en 是函数时 zh 不能是字符串
    defineMessages({ en: { count: (n: number) => `${n}` }, zh: { count: "个" } });
  });

  it("knows the supported languages and their Intl tags", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(intlLocale("en")).toBe("en-US");
    expect(intlLocale("zh")).toBe("zh-CN");
  });
});
