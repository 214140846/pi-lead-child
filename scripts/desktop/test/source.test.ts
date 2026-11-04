import { describe, expect, it } from "vitest";
import { sourceTreeOf } from "../lib/source.js";

const clean = { version: 1 as const, commit: "c".repeat(40), dirty: false, dirtyFiles: [], builtAt: "2026-11-03T08:00:00Z" };

describe("sourceTreeOf", () => {
  it("returns the tree of the commit the dist was built from", () => {
    const calls: string[][] = [];
    expect(sourceTreeOf(clean, (args) => { calls.push(args); return `${"d".repeat(40)}\n`; })).toBe("d".repeat(40));
    expect(calls).toEqual([["rev-parse", `${"c".repeat(40)}^{tree}`]]);
  });

  it("refuses a dist without a build record or built from uncommitted changes", () => {
    const git = () => "d".repeat(40);
    expect(() => sourceTreeOf(null, git)).toThrow(/没有 build-info\.json/);
    expect(() => sourceTreeOf({ ...clean, dirty: true, dirtyFiles: ["packages/core/src/config.ts"] }, git))
      .toThrow(/未提交改动.*packages\/core\/src\/config\.ts/);
    expect(() => sourceTreeOf(clean, () => "fatal: bad revision")).toThrow(/不是 tree 哈希/);
  });
});
