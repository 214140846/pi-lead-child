// 安装说明（设计第 8.3 节、P0-5 的验收）：README、release 说明模板和 dmg 背景图用同一份文字，
// 步骤照 Apple 支持文章 102445，中英文都有，写明需要 Apple 芯片，只用 Bytezard Lead 这个名字。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dmgBackgroundSpec } from "../src/dmg-background.js";
import { installGuideMessages } from "../src/install-guide.messages.js";
import { dmgFileName, GUIDE_TARGETS, installGuideMarkdown, QUARANTINE_COMMAND, syncInstallGuide } from "../src/install-guide.js";

const ROOT = join(import.meta.dirname, "..", "..");

function flatten(tree: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (typeof value === "function") out[path] = (value as (...args: string[]) => string)("FILE");
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

describe("install guide messages", () => {
  it("have the same keys in English and Chinese", () => {
    expect(Object.keys(flatten(installGuideMessages("zh")))).toEqual(Object.keys(flatten(installGuideMessages("en"))));
  });

  it("name only Bytezard Lead, never an internal code name", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const [key, text] of Object.entries(flatten(installGuideMessages(locale)))) {
        expect(text, `${locale} ${key}`).not.toMatch(/Fairy|Paimon|pi-lead-child|plc|Electron|launchd|daemon|Intel|x64/i);
      }
    }
  });

  it("follow the steps of Apple support article 102445", () => {
    const en = installGuideMarkdown({ locale: "en", headingLevel: 2, troubleshooting: false });
    // 先试着打开 App，再到系统设置的「隐私与安全性」点「仍要打开」，警告再出现时点「打开」。
    const order = ["Open Bytezard Lead", "System Settings → Privacy & Security", "Open Anyway", "click **Open**"];
    const positions = order.map((text) => en.indexOf(text));
    expect(positions.every((position) => position >= 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const zh = installGuideMarkdown({ locale: "zh", headingLevel: 2, troubleshooting: false });
    const zhOrder = ["打开 Bytezard Lead", "系统设置 → 隐私与安全性", "仍要打开", "点「打开」"];
    const zhPositions = zhOrder.map((text) => zh.indexOf(text));
    expect(zhPositions.every((position) => position >= 0), JSON.stringify(zhPositions)).toBe(true);
    expect([...zhPositions].sort((a, b) => a - b)).toEqual(zhPositions);
  });

  it("say that Bytezard Lead needs Apple silicon and name the arm64 dmg", () => {
    expect(installGuideMarkdown({ locale: "en", headingLevel: 2, troubleshooting: false })).toContain("needs a Mac with Apple silicon");
    expect(installGuideMarkdown({ locale: "zh", headingLevel: 2, troubleshooting: false })).toContain("需要 Apple 芯片的 Mac");
    expect(dmgFileName("1.3.0")).toBe("bytezard-lead-1.3.0-arm64.dmg");
  });

  it("keep the quarantine command out of the download page", () => {
    expect(installGuideMarkdown({ locale: "en", headingLevel: 2, troubleshooting: false })).not.toContain("xattr");
    expect(installGuideMarkdown({ locale: "en", headingLevel: 2, troubleshooting: true })).toContain(QUARANTINE_COMMAND);
    expect(QUARANTINE_COMMAND).toBe('xattr -dr com.apple.quarantine "/Applications/Bytezard Lead.app"');
  });
});

describe("generated install guide", () => {
  it.each(GUIDE_TARGETS)("$file holds the current install guide", ({ file, blocks }) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    // 不一致时，在仓库根运行 node --import tsx desktop/scripts/install-guide.ts。
    expect(syncInstallGuide(text, blocks)).toBe(text);
  });

  it("puts the English guide with troubleshooting in README and the Chinese one in README.zh-CN", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("## Install Bytezard Lead");
    expect(readme).toContain("### If Bytezard Lead does not open");
    const zh = readFileSync(join(ROOT, "README.zh-CN.md"), "utf8");
    expect(zh).toContain("## 安装 Bytezard Lead");
    expect(zh).toContain("### 打不开怎么办");
  });

  // GitHub 上的 commit 和 release 只用英文（用户 2026-11-05）：两条横线之间贴进 release 的部分没有中文。
  it("puts only the English guide, and no troubleshooting, in the part of the template that goes into a release", () => {
    const template = readFileSync(join(ROOT, "docs/desktop/release-notes-template.md"), "utf8");
    const release = template.split(/^---$/m)[1]!;
    expect(release).toContain("## Install Bytezard Lead");
    expect(release).not.toMatch(/[\u3400-\u9fff]/);
    expect(release).not.toContain("xattr");
    expect(template).not.toMatch(/Fairy/);
  });

  it("refuses a file without the markers instead of skipping it", () => {
    expect(() => syncInstallGuide("# README\n", [{ name: "en", locale: "en", headingLevel: 2, troubleshooting: true }])).toThrow(/install-guide:en:start/);
  });
});

describe("dmg background text", () => {
  it("shows the same System Settings path and button as the guide, in both languages", () => {
    const [en, zh] = dmgBackgroundSpec().lines;
    const enTerms = installGuideMessages("en").terms;
    const zhTerms = installGuideMessages("zh").terms;
    expect(en!.text).toBe(`First open: ${enTerms.systemSettings} → ${enTerms.privacySecurity} → ${enTerms.openAnyway}`);
    expect(zh!.text).toBe(`首次打开：${zhTerms.systemSettings} → ${zhTerms.privacySecurity} → ${zhTerms.openAnyway}`);
    expect(installGuideMarkdown({ locale: "en", headingLevel: 2, troubleshooting: false })).toContain(`${enTerms.systemSettings} → ${enTerms.privacySecurity}`);
    expect(installGuideMarkdown({ locale: "zh", headingLevel: 2, troubleshooting: false })).toContain(`${zhTerms.systemSettings} → ${zhTerms.privacySecurity}`);
  });
});
