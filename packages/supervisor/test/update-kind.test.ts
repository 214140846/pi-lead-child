// 换版本时是哪种更新，以及只改了网页时在跑的 daemon 给哪一份网页（docs/desktop/macos-desktop-design.md 第 7.5.2、7.5.3 节）。
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import { restartsService, sameService, servedWebRoot, updateKind } from "../src/deploy/update-kind.js";

const hash = (char: string) => char.repeat(64);
const components = (overrides: Record<string, string> = {}) => ({
  node: hash("1"), node_modules: hash("2"), service: hash("3"), web: hash("4"), cli: hash("5"), ...overrides,
});
const release = (overrides: Record<string, string> = {}, schemaVersion = 63) => ({ schemaVersion, components: components(overrides) });

describe("updateKind", () => {
  it("says none when nothing in the runtime changed (only the App)", () => {
    expect(updateKind(release(), release())).toBe("none");
  });

  it("says web when only the pages or the command line changed", () => {
    expect(updateKind(release(), release({ web: hash("a") }))).toBe("web");
    expect(updateKind(release(), release({ cli: hash("a") }))).toBe("web");
    expect(restartsService("web")).toBe(false);
  });

  it("says service when the service code, node_modules or Node changed", () => {
    for (const name of ["service", "node_modules", "node"]) {
      expect(updateKind(release(), release({ [name]: hash("a"), web: hash("b") }))).toBe("service");
    }
    expect(restartsService("service")).toBe(true);
  });

  it("says schema when the database schema changed, whatever else changed", () => {
    expect(updateKind(release({}, 62), release({}, 63))).toBe("schema");
    expect(restartsService("schema")).toBe(true);
  });

  it("restarts when it cannot compare: an older release.json without components, or none at all", () => {
    expect(updateKind({ schemaVersion: 63 }, release())).toBe("service");
    expect(updateKind(release(), { schemaVersion: 63 })).toBe("service");
    expect(updateKind(null, release())).toBe("service");
    expect(updateKind({ schemaVersion: 63, components: { web: hash("4") } }, release())).toBe("service");
  });
});

describe("sameService", () => {
  it("is true only when Node, node_modules, the service code and the schema are the same", () => {
    expect(sameService(release(), release({ web: hash("a"), cli: hash("b") }))).toBe(true);
    expect(sameService(release(), release({ service: hash("a") }))).toBe(false);
    expect(sameService(release({}, 62), release({}, 63))).toBe(false);
    expect(sameService({ schemaVersion: 63 }, release())).toBe(false);
  });
});

describe("servedWebRoot", () => {
  function installRoot() {
    // 解开软链接以后的路径（macOS 的临时目录在 /private 下面）：daemon 的 projectRoot() 也是这样的路径。
    const root = join(realpathSync(tempDir("plc-served-web-")), "Bytezard Lead", "runtime");
    const add = (version: string, value: object) => {
      const dir = join(root, "versions", version);
      mkdirSync(join(dir, "apps", "daemon", "dist", "web"), { recursive: true });
      writeFileSync(join(dir, "release.json"), JSON.stringify({ schema: 1, version, ...value }));
      return dir;
    };
    const point = (version: string) => {
      rmSync(join(root, "current"), { force: true });
      symlinkSync(join("versions", version), join(root, "current"));
    };
    return { root, add, point };
  }

  it("serves the pages of current when current runs the same service as this daemon", () => {
    const f = installRoot();
    const running = f.add("1.3.0", release());
    const next = f.add("1.4.0", release({ web: hash("a") }));
    f.point("1.4.0");
    const web = servedWebRoot({ root: running, ownWebRoot: join(running, "apps", "daemon", "dist", "web") });
    expect(web()).toBe(join(next, "apps", "daemon", "dist", "web"));
  });

  it("keeps its own pages while current waits for a restart, and when it cannot compare", () => {
    const f = installRoot();
    const running = f.add("1.3.0", release());
    f.add("1.4.0", release({ service: hash("a") }));
    f.add("1.5.0", { schemaVersion: 63 });
    const own = join(running, "apps", "daemon", "dist", "web");
    f.point("1.4.0");
    expect(servedWebRoot({ root: running, ownWebRoot: own })()).toBe(own);
    f.point("1.5.0");
    expect(servedWebRoot({ root: running, ownWebRoot: own })()).toBe(own);
    f.point("1.3.0");
    expect(servedWebRoot({ root: running, ownWebRoot: own })()).toBe(own);
  });

  it("looks at current again after the cache time, and uses its own pages outside an install root", () => {
    const f = installRoot();
    const running = f.add("1.3.0", release());
    const next = f.add("1.4.0", release({ web: hash("a") }));
    const own = join(running, "apps", "daemon", "dist", "web");
    f.point("1.3.0");
    let now = 0;
    const web = servedWebRoot({ root: running, ownWebRoot: own, ttlMs: 2_000, now: () => now });
    expect(web()).toBe(own);
    f.point("1.4.0");
    now = 1_000;
    expect(web()).toBe(own);
    now = 2_000;
    expect(web()).toBe(join(next, "apps", "daemon", "dist", "web"));

    const checkout = join(tempDir("plc-checkout-"), "repo");
    mkdirSync(checkout, { recursive: true });
    writeFileSync(join(checkout, "release.json"), JSON.stringify(release()));
    expect(servedWebRoot({ root: checkout, ownWebRoot: "/own" })()).toBe("/own");
  });
});
