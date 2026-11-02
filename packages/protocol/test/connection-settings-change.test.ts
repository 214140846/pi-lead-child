// 改连接的权限设置时，会话里的记录只写变了的那一项（2026-10-28 用户：系统信息行太长，换行很难看）。
import { describe, expect, it } from "vitest";

import { describeConnectionSettings, describeConnectionSettingsChange } from "../src/index.ts";

describe("describeConnectionSettingsChange", () => {
  it("names only the write policy when only it changed", () => {
    expect(describeConnectionSettingsChange(
      { roles: ["lead", "executor", "reviewer"], writePolicy: "confirm" },
      { roles: ["lead", "executor", "reviewer"], writePolicy: "direct" }, "zh",
    )).toBe("写入从「先问我」改成「直接执行」");
  });

  it("names only who can use it when only the roles changed", () => {
    expect(describeConnectionSettingsChange(
      { roles: ["lead"], writePolicy: "confirm" },
      { roles: ["lead", "reviewer"], writePolicy: "confirm" }, "zh",
    )).toBe("可以用的从「Lead」改成「Lead、评审 agent」");
  });

  it("names both when both changed, and nobody when the roles are empty", () => {
    expect(describeConnectionSettingsChange(
      { roles: ["lead"], writePolicy: "direct" },
      { roles: [], writePolicy: "confirm" }, "zh",
    )).toBe("可以用的从「Lead」改成「谁都不能用」；写入从「直接执行」改成「先问我」");
  });

  it("writes English by default", () => {
    expect(describeConnectionSettingsChange(
      { roles: ["lead"], writePolicy: "direct" },
      { roles: ["lead", "executor", "reviewer"], writePolicy: "confirm" },
    )).toBe('who can use it changed from "Lead" to "Lead, agents that do tickets and review agents"; writes changed from "do it directly" to "ask me first"');
    expect(describeConnectionSettings({ roles: [], writePolicy: "confirm" })).toBe("Nobody can use it. Writes: ask me first");
    expect(describeConnectionSettings({ roles: ["lead"], writePolicy: "confirm" }, "zh")).toBe("Lead可以用；写入先问我");
  });

  it("is null when nothing changed", () => {
    expect(describeConnectionSettingsChange(
      { roles: ["lead"], writePolicy: "direct" }, { roles: ["lead"], writePolicy: "direct" },
    )).toBeNull();
  });
});
