// Lead 模型分组（用户 2026-11-05，原型 docs/prototypes/model-grouping 的 README「分组规则」）。
import { describe, expect, it } from "vitest";
import {
  flatModelSections, groupModelsByProvider, leadModelDisplayId, modelSectionTitle, parseLeadModelSpec, type GroupableModel,
} from "../src/index.ts";

type M = GroupableModel & { id: string };
const m = (provider: string, id: string, group: string | null, source: string | null): M => ({ provider, id, group, source });

// 和原型的三家数据一样：vibeproxy 有详细目录（按账号分），Magpie、网关只有普通目录。
const models: M[] = [
  m("vibeproxy", "as4/claude-opus-5-5", "as4", "anthropic"),
  m("vibeproxy", "as4/claude-sonnet-5-5", "as4", "anthropic"),
  m("vibeproxy", "as10/claude-opus-5-5", "as10", "anthropic"),
  m("vibeproxy", "as1/claude-opus-5-5", "as1", "anthropic"),
  m("vibeproxy", "gemini-3-flash", null, "antigravity"),
  m("magpie", "auto/deepseek-flash", null, "deepseek"),
  m("magpie", "deepseek/deepseek-flash", null, "deepseek"),
  m("magpie", "bailian/qwen-max", null, "bailian-token-plan"),
  m("gateway", "gpt-5.5", null, "openai"),
  m("gateway", "claude-sonnet-4-6", null, "openai"),
];

const titles = (withProvider: boolean) => flatModelSections(groupModelsByProvider(models))
  .map((section) => [modelSectionTitle(section, withProvider), section.models.map((model) => model.id)]);

describe("groupModelsByProvider", () => {
  it("puts providers on the left in catalog order, and account sections first in numeric order", () => {
    const providers = groupModelsByProvider(models);
    expect(providers.map((provider) => [provider.provider, provider.count])).toEqual([["vibeproxy", 5], ["magpie", 3], ["gateway", 2]]);
    expect(titles(false)).toEqual([
      ["as1 · anthropic", ["as1/claude-opus-5-5"]],
      ["as4 · anthropic", ["as4/claude-opus-5-5", "as4/claude-sonnet-5-5"]],
      ["as10 · anthropic", ["as10/claude-opus-5-5"]],
      ["antigravity", ["gemini-3-flash"]],
      // magpie：前缀不是账号，按通道分段。
      ["deepseek", ["auto/deepseek-flash", "deepseek/deepseek-flash"]],
      ["bailian-token-plan", ["bailian/qwen-max"]],
      // 网关只有一种通道：不写，分段没有标题。
      ["", ["gpt-5.5", "claude-sonnet-4-6"]],
    ]);
  });

  it("writes the provider in front of each title when a dropdown has more than one provider", () => {
    expect(titles(true).map(([title]) => title)).toEqual([
      "vibeproxy · as1 · anthropic", "vibeproxy · as4 · anthropic", "vibeproxy · as10 · anthropic", "vibeproxy · antigravity",
      "magpie · deepseek", "magpie · bailian-token-plan", "gateway",
    ]);
  });

  it("keeps the titles of the full catalog while a search hides models, and drops empty sections", () => {
    const providers = groupModelsByProvider(models, { keep: (model) => model.id.includes("opus") });
    expect(flatModelSections(providers).map((section) => [modelSectionTitle(section, false), section.models.length])).toEqual([
      ["as1 · anthropic", 1], ["as4 · anthropic", 1], ["as10 · anthropic", 1],
    ]);
    expect(providers.map((provider) => provider.provider)).toEqual(["vibeproxy"]);
  });
});

describe("the display name of a model", () => {
  it("tells apart two models with the same name behind different prefixes", () => {
    // 前缀不是账号（magpie）：显示完整的 id，两个名字不一样。
    const auto = parseLeadModelSpec("magpie/auto/deepseek-flash");
    const deepseek = parseLeadModelSpec("magpie/deepseek/deepseek-flash");
    expect([auto.bareId, deepseek.bareId]).toEqual(["auto/deepseek-flash", "deepseek/deepseek-flash"]);
    // 是账号（vibeproxy）：分段标题已经写了账号，行里去掉它。
    expect(parseLeadModelSpec("vibeproxy/as4/claude-opus-5-5(high)", "as4")).toMatchObject({ bareId: "claude-opus-5-5", effort: "high" });
    expect(leadModelDisplayId("as4/claude-opus-5-5", "as4")).toBe("claude-opus-5-5");
    expect(leadModelDisplayId("auto/deepseek-flash", null)).toBe("auto/deepseek-flash");
  });
});
