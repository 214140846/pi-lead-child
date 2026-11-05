// 这一份 App 的版本、构建号和提交，加上装着的运行包的版本（关于窗口、设置页和诊断信息用，用户 2026-11-05）。
// 构建号和提交由发版的 workflow 写进打包后的 package.json 的 buildInfo（本机打包也一样）。构建号是 UTC 的年月日时分，
// 同时是 Info.plist 的 CFBundleVersion，所以关于窗口显示「版本 1.1.0 (202611050930)」。开发时（electron .）没有 buildInfo。
// 运行包的版本平时和 App 一样；升级、回滚的中途可能不同，所以单独读 current 的 release.json。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ShellPaths } from "./paths.js";
import { installedVersion } from "./runtime-bundle.js";

export interface ShellAbout {
  version: string;
  /** UTC 的年月日时分，例如 202611050930。 */
  build: string | null;
  /** 提交的前 7 位。 */
  commit: string | null;
  runtimeVersion: string | null;
}

const BUILD = /^\d{12}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

/** appRoot 是 App 的 package.json 所在的目录（打包后是 app.asar，dist/ 的上一级）。 */
export function readBuildInfo(appRoot: string): Pick<ShellAbout, "build" | "commit"> {
  try {
    const value = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { buildInfo?: { build?: unknown; commit?: unknown } };
    // npm pkg set 可能把纯数字写成数字。
    const build = value.buildInfo?.build === undefined ? "" : String(value.buildInfo.build);
    const commit = typeof value.buildInfo?.commit === "string" ? value.buildInfo.commit : "";
    return { build: BUILD.test(build) ? build : null, commit: COMMIT.test(commit) ? commit.slice(0, 7) : null };
  } catch {
    return { build: null, commit: null };
  }
}

export function shellAbout(o: { version: string; appRoot: string; paths: Pick<ShellPaths, "current"> }): ShellAbout {
  return { version: o.version, ...readBuildInfo(o.appRoot), runtimeVersion: installedVersion(o.paths) };
}

/**
 * 给人看的版本号：本机构建的版本号以「.构建号」结尾（1.1.1-local.202611050212），关于窗口的括号里又有构建号，
 * 显示时去掉这一段，写成「1.1.1-local (202611050212)」。发布版（1.1.0）照原样。
 */
export function displayVersion(version: string, build: string | null): string {
  return build && version.endsWith(`.${build}`) ? version.slice(0, -(build.length + 1)) : version;
}

/** 诊断信息开头的一段：用户把诊断信息发给别人时，一眼看出是哪个版本。 */
export function aboutText(about: ShellAbout): string {
  return [
    `App ${about.version}${about.build ? ` (${about.build})` : ""}`,
    `commit ${about.commit ?? "-"}`,
    `runtime ${about.runtimeVersion ?? "-"}`,
  ].join("\n");
}
