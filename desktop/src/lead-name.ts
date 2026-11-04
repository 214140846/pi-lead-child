// 窗口标题用用户配置的 Lead 名字（设计第 4.1 节、第 9 节决定 6）。
//   - Companion 网页把 document.title 设成 Lead 名字，壳从 page-title-updated 记下它（<shell>/lead-name.json）。
//   - 安装页还没有网页可读，用上次记下的名字；第一次安装时用缺省名 Paimon（protocol 的 DEFAULT_LEAD_NAME）。
// 名字的整理和长度上限照 packages/protocol/src/lead-profile.ts 写：去掉控制字符和不可见的方向字符，空白合成一个，最多 24 个字。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_LEAD_NAME = "Paimon";
export const LEAD_NAME_MAX_LENGTH = 24;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/gu;

/** 整理以后合法的 Lead 名字；不合法时为 null。 */
export function validLeadName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const clean = name.replace(CONTROL, "").replace(/\s+/gu, " ").trim();
  return clean && [...clean].length <= LEAD_NAME_MAX_LENGTH ? clean : null;
}

/** 上次记下的名字；没有或读不了时是缺省名。 */
export function readLeadName(file: string): string {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown };
    return validLeadName(value?.name) ?? DEFAULT_LEAD_NAME;
  } catch {
    return DEFAULT_LEAD_NAME;
  }
}

/** 记下新的名字。不合法时不记，返回 null；写不了时只在这次运行里用。 */
export function rememberLeadName(file: string, name: string): string | null {
  const clean = validLeadName(name);
  if (!clean) return null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ name: clean })}\n`);
    renameSync(temp, file);
  } catch {
    // 见上。
  }
  return clean;
}
