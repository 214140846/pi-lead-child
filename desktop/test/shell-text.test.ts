// 壳的文字和打包配置（设计第 8.5 节、docs/i18n.md）：en 和 zh 一样全；对外只用 Bytezard Lead；
// electron-builder 的 appId 和 productName 决定 Info.plist 的 CFBundleIdentifier 和 CFBundleName。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickLocale } from "../src/locale.js";
import { shellMessages } from "../src/shell.messages.js";

const DESKTOP = join(import.meta.dirname, "..");

// 把目录展开成「键 → 文字」，函数用样例参数调用一次。
function flatten(tree: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (typeof value === "function") out[path] = (value as (...args: string[]) => string)("REASON");
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

describe("shell messages", () => {
  it("have the same keys in English and Chinese", () => {
    expect(Object.keys(flatten(shellMessages("zh")))).toEqual(Object.keys(flatten(shellMessages("en"))));
  });

  it("name only Bytezard Lead, never an internal code name", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const [key, text] of Object.entries(flatten(shellMessages(locale)))) {
        expect(text, `${locale} ${key}`).not.toMatch(/Fairy|Paimon|pi-lead-child|plc|Electron|launchd|daemon/i);
      }
    }
  });

  it("use Chinese for a Chinese system and English for every other system", () => {
    expect(pickLocale(["zh-Hans-CN"])).toBe("zh");
    expect(pickLocale(["zh-TW", "en-US"])).toBe("zh");
    expect(pickLocale(["en-GB", "zh-CN"])).toBe("en");
    expect(pickLocale(["fr-FR"])).toBe("en");
    expect(pickLocale([])).toBe("en");
  });
});

describe("packaging", () => {
  const builder = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
  const line = (key: string) => builder.split("\n").find((text) => text.trimStart().startsWith(`${key}:`))?.split(":").slice(1).join(":").trim();

  it("sets the bundle id and the App name", () => {
    expect(line("appId")).toBe("com.bytezard.plc");
    expect(line("productName")).toBe("Bytezard Lead");
    const pkg = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8"));
    expect(pkg.productName).toBe("Bytezard Lead");
  });

  it("builds only arm64, with an ad-hoc signature and no Hardened Runtime", () => {
    expect(builder).toMatch(/arch:\n\s+- arm64\n/);
    expect(builder).not.toMatch(/x64|universal/);
    expect(line("identity")).toBe('"-"');
    expect(line("hardenedRuntime")).toBe("false");
    expect(line("npmRebuild")).toBe("false");
  });

  it("carries the runtime archive that the shell looks for", () => {
    expect(builder).toContain("bytezard-lead-runtime-*-arm64.tar.gz");
    expect(builder).toMatch(/to: runtime\n/);
  });
});
