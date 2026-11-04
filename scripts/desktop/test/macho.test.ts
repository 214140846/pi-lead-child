import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { assertMachOArch, machOArchitectures } from "../lib/macho.js";
import { CPU, fatMachO, thinMachO } from "./fixtures.js";

describe("machOArchitectures", () => {
  it("reads thin and universal headers", () => {
    expect(machOArchitectures(thinMachO(CPU.arm64))).toEqual(["arm64"]);
    expect(machOArchitectures(thinMachO(CPU.x86_64))).toEqual(["x86_64"]);
    expect(machOArchitectures(fatMachO([CPU.x86_64, CPU.arm64]))).toEqual(["x86_64", "arm64"]);
  });

  it("returns null for files that are not Mach-O", () => {
    expect(machOArchitectures(Buffer.from("#!/bin/sh\necho hi\n"))).toBeNull();
    expect(machOArchitectures(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]))).toBeNull();
    expect(machOArchitectures(Buffer.alloc(2))).toBeNull();
    // Java 的 class 文件也以 cafebabe 开头，后面跟的是版本号，不是架构个数。
    const javaClass = Buffer.alloc(8);
    javaClass.writeUInt32BE(0xcafebabe, 0);
    javaClass.writeUInt32BE(0x00000041, 4);
    expect(machOArchitectures(javaClass)).toBeNull();
  });
});

describe("assertMachOArch", () => {
  it("passes arm64 and universal binaries with an arm64 slice, and fails the rest with the file name", () => {
    const dir = tempDir("plc-desktop-macho-");
    const write = (name: string, data: Buffer | string) => { writeFileSync(join(dir, name), data); return join(dir, name); };
    expect(() => assertMachOArch(write("arm", thinMachO(CPU.arm64)), "x.node", "arm64")).not.toThrow();
    expect(() => assertMachOArch(write("fat", fatMachO([CPU.x86_64, CPU.arm64])), "x.node", "arm64")).not.toThrow();
    expect(() => assertMachOArch(write("intel", thinMachO(CPU.x86_64)), "x.node", "arm64")).toThrow(/x\.node 的架构是 x86_64，不是 arm64：.*intel/);
    expect(() => assertMachOArch(write("text", "hello"), "x.node", "arm64")).toThrow(/不是 Mach-O/);
  });
});
