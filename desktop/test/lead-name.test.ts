// 安装页的窗口标题：上次记下的 Lead 名字，第一次安装时是 Paimon（设计第 4.1 节）。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { DEFAULT_LEAD_NAME, LEAD_NAME_MAX_LENGTH, readLeadName, rememberLeadName, validLeadName } from "../src/lead-name.js";

describe("Lead name", () => {
  it("is Paimon before any name was remembered", () => {
    expect(readLeadName(join(tempDir("plc-desktop-name-"), "shell", "lead-name.json"))).toBe("Paimon");
  });

  it("returns the remembered name on the next start", () => {
    const file = join(tempDir("plc-desktop-name-"), "shell", "lead-name.json");
    expect(rememberLeadName(file, "  Nina​ ")).toBe("Nina");
    expect(readLeadName(file)).toBe("Nina");
  });

  it("does not remember a title that is not a valid Lead name", () => {
    const file = join(tempDir("plc-desktop-name-"), "lead-name.json");
    expect(rememberLeadName(file, "   ")).toBeNull();
    expect(rememberLeadName(file, "x".repeat(LEAD_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(readLeadName(file)).toBe(DEFAULT_LEAD_NAME);
    writeFileSync(file, "{not json");
    expect(readLeadName(file)).toBe(DEFAULT_LEAD_NAME);
  });

  it("allows 24 characters, counted as characters and not UTF-16 units", () => {
    expect(validLeadName("韩梅梅".repeat(8))).toBe("韩梅梅".repeat(8));
    expect(validLeadName("🦊".repeat(24))).toBe("🦊".repeat(24));
  });
});
