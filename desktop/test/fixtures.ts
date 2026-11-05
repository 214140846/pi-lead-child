// 测试用的运行包：一个带 release.json 和两个文件的目录，打成和 P0-2 同名的 tar.gz。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "@pi-lead-child/core/testing";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface RuntimeFixture {
  dir: string;
  tarball: string;
}

/**
 * 在 resourcesDir 里放一个 bytezard-lead-runtime-<version>-arm64.tar.gz。corrupt 时 release.json 的哈希和文件对不上。
 * modules / agent 给出时，包里有 node_modules 和这份内容的 lead-agent，release.json 带 components（设计第 7.5.1 节），
 * release.json 是压缩包的第一项，和 scripts/desktop/lib/pack.ts 打的一样。
 */
export function runtimeTarball(
  resourcesDir: string, version: string,
  o: { corrupt?: boolean; arch?: string; modules?: string; agent?: string } = {},
): RuntimeFixture {
  const dir = tempDir("plc-desktop-runtime-");
  const withComponents = o.modules !== undefined || o.agent !== undefined;
  const agent = o.agent ?? `#!/bin/sh\necho lead-agent ${version}\n`;
  const files: Record<string, string> = {
    "bin/lead-agent": agent,
    "apps/daemon/dist/ops.mjs": `// ops ${version}\n`,
    ...(o.modules !== undefined ? { "node_modules/better-sqlite3/build/Release/better_sqlite3.node": `sqlite ${o.modules}` } : {}),
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  if (withComponents) {
    chmodSync(join(dir, "bin/lead-agent"), 0o755);
    symlinkSync("lead-agent", join(dir, "bin/node"));
    if (o.modules !== undefined) {
      mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
      mkdirSync(join(dir, "node_modules/pi"), { recursive: true });
      writeFileSync(join(dir, "node_modules/pi/cli.js"), `pi ${o.modules}`, { flag: "w" });
      symlinkSync("../pi/cli.js", join(dir, "node_modules/.bin/pi"));
    }
  }
  const hashes = Object.fromEntries(Object.entries(files).map(([file, content]) => [file, sha256(o.corrupt ? `${content}x` : content)]));
  writeFileSync(join(dir, "release.json"), JSON.stringify({
    schema: 1, product: "bytezard-lead", version, arch: o.arch ?? "arm64", node: "24.22.2", schemaVersion: 63, files: hashes,
    ...(withComponents ? {
      components: {
        node: sha256(`node ${agent}`), node_modules: sha256(`modules ${o.modules ?? ""}`),
        service: sha256(`service ${version}`), web: sha256(`web ${version}`), cli: sha256(`cli ${version}`),
      },
    } : {}),
  }));
  mkdirSync(resourcesDir, { recursive: true });
  const tarball = join(resourcesDir, `bytezard-lead-runtime-${version}-arm64.tar.gz`);
  const entries = withComponents ? ["./release.json", ...readdirSync(dir).filter((name) => name !== "release.json").map((name) => `./${name}`)] : ["."];
  execFileSync("/usr/bin/tar", ["-czf", tarball, "-C", dir, ...entries], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { dir, tarball };
}
