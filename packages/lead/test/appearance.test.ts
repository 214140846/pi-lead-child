// 系统提示的 appearance 一节（2026-10-22）写着界面语言（2026-11-01）：Lead 用用户这条消息的语言回复，主动发的文字用界面语言。
import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN_PREFERENCES, designPreferencesFields } from "@pi-lead-child/protocol";
import { renderAppearance } from "../src/appearance.js";

describe("renderAppearance", () => {
  it("tells Lead the interface language", () => {
    const fields = designPreferencesFields(DEFAULT_DESIGN_PREFERENCES);
    expect(renderAppearance(fields)).toContain("界面语言：English（en）");
    expect(renderAppearance({ ...fields, locale: "zh" })).toContain("界面语言：中文（zh）");
    // 档位的名字跟着中文的提示词写，不随界面语言变。
    expect(renderAppearance({ ...fields, locale: "en" })).toContain("圆角：标准");
  });
});
