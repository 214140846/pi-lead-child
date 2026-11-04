// 测试用的运行包：一个带 release.json 和两个文件的目录，打成和 P0-2 同名的 tar.gz。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "@pi-lead-child/core/testing";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface RuntimeFixture {
  dir: string;
  tarball: string;
}

/** 在 resourcesDir 里放一个 bytezard-lead-runtime-<version>-arm64.tar.gz。corrupt 时 release.json 的哈希和文件对不上。 */
export function runtimeTarball(resourcesDir: string, version: string, o: { corrupt?: boolean; arch?: string } = {}): RuntimeFixture {
  const dir = tempDir("plc-desktop-runtime-");
  const files: Record<string, string> = {
    "bin/lead-agent": `#!/bin/sh\necho lead-agent ${version}\n`,
    "apps/daemon/dist/ops.mjs": `// ops ${version}\n`,
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  const hashes = Object.fromEntries(Object.entries(files).map(([file, content]) => [file, sha256(o.corrupt ? `${content}x` : content)]));
  writeFileSync(join(dir, "release.json"), JSON.stringify({
    schema: 1, product: "bytezard-lead", version, arch: o.arch ?? "arm64", node: "24.22.2", schemaVersion: 63, files: hashes,
  }));
  mkdirSync(resourcesDir, { recursive: true });
  const tarball = join(resourcesDir, `bytezard-lead-runtime-${version}-arm64.tar.gz`);
  execFileSync("/usr/bin/tar", ["-czf", tarball, "-C", dir, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { dir, tarball };
}
