// 换版本时是哪种更新（docs/desktop/macos-desktop-design.md 第 7.5.2 节）。按 release.json 的 components 判断，不靠猜：
//   none     五个组成和 schemaVersion 都一样：只换了 App 壳。不停服务，不备份。
//   web      只有 web、cli 变了。不停服务，不备份：在跑的 daemon 从 current 提供新网页（servedWebRoot）。
//   service  node、node_modules、service 有一个变了。排空后重启，先在线备份。
//   schema   schemaVersion 变了。排空后重启，停服务以后备份（必须）。
// 有一边没有 components（2026-11-05 以前打的包）时按 service 处理：宁可多重启一次。
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { RELEASE_MANIFEST_FILE, releaseComponents, RUNTIME_COMPONENTS, SERVICE_COMPONENTS, type ReleaseManifest } from "./release.js";

export const UPDATE_KINDS = ["none", "web", "service", "schema"] as const;
export type UpdateKind = typeof UPDATE_KINDS[number];

type Comparable = Pick<ReleaseManifest, "schemaVersion" | "components">;

/** 这种更新要不要停服务、重启。 */
export function restartsService(kind: UpdateKind): boolean {
  return kind === "service" || kind === "schema";
}

/** 从 from 换到 to 是哪种更新。from 读不了时为 null。 */
export function updateKind(from: Comparable | null, to: Comparable): UpdateKind {
  if (from && from.schemaVersion !== to.schemaVersion) return "schema";
  const a = from?.components;
  const b = to.components;
  if (!a || !b || RUNTIME_COMPONENTS.some((name) => !a[name] || !b[name])) return "service";
  if (SERVICE_COMPONENTS.some((name) => a[name] !== b[name])) return "service";
  return RUNTIME_COMPONENTS.every((name) => a[name] === b[name]) ? "none" : "web";
}

/** 两个运行包的服务一样：node、node_modules、service 的哈希和 schemaVersion 都相同。有一边没有 components 时为 false。 */
export function sameService(a: Comparable, b: Comparable): boolean {
  if (a.schemaVersion !== b.schemaVersion || !a.components || !b.components) return false;
  return SERVICE_COMPONENTS.every((name) => a.components![name] !== undefined && a.components![name] === b.components![name]);
}

function readComparable(root: string): Comparable | null {
  try {
    const value = JSON.parse(readFileSync(join(root, RELEASE_MANIFEST_FILE), "utf8")) as Record<string, unknown>;
    if (!Number.isSafeInteger(value.schemaVersion)) return null;
    const components = releaseComponents(value.components);
    return { schemaVersion: value.schemaVersion as number, ...(components ? { components } : {}) };
  } catch {
    return null;
  }
}

const WEB_DIR = ["apps", "daemon", "dist", "web"];
const DEFAULT_TTL_MS = 2_000;

/**
 * 发布模式下 daemon 提供网页的目录（第 7.5.3 节）。root 是 daemon 自己的运行包（versions/<版本>，解开软链接以后的路径）。
 * <安装根>/current 的服务和自己一样时用 current 的网页：只改了网页的更新不重启 daemon，也能换上新网页。不一样时
 * （换版本以后、重启以前），或者 root 不在 versions/ 下面时，用自己的网页 ownWebRoot。结果缓存 ttlMs。
 */
export function servedWebRoot(o: { root: string; ownWebRoot: string; ttlMs?: number; now?: () => number }): () => string {
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? DEFAULT_TTL_MS;
  let root = o.root;
  try {
    root = realpathSync(o.root);
  } catch {
    // 读不了时照原样比较：current 解开以后不会等于它，下面按 release.json 判断。
  }
  const own = readComparable(root);
  const current = basename(dirname(root)) === "versions" ? join(dirname(dirname(root)), "current") : null;
  let cached: { at: number; value: string } | null = null;
  const resolve = (): string => {
    if (!own || !current) return o.ownWebRoot;
    let target: string;
    try {
      target = realpathSync(current);
    } catch {
      return o.ownWebRoot;
    }
    if (target === root) return o.ownWebRoot;
    const next = readComparable(target);
    return next && sameService(own, next) ? join(target, ...WEB_DIR) : o.ownWebRoot;
  };
  return () => {
    const at = now();
    if (!cached || at - cached.at >= ttl) cached = { at, value: resolve() };
    return cached.value;
  };
}
