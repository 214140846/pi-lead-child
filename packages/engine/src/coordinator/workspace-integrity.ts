import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { Db } from "@pi-lead-child/store";
import type { Workspace } from "@pi-lead-child/core";

import { workspaceTreeHash } from "../pipeline/workspace-tree-hash.js";

const execFileAsync = promisify(execFile);

// git diff --binary of a worktree can be large; the 1 MB default of execFile would fail on it.
const CONTENT_HASH_MAX_BUFFER = 256 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: CONTENT_HASH_MAX_BUFFER,
  });
  return stdout;
}

async function addFile(hash: ReturnType<typeof createHash>, root: string, path: string): Promise<void> {
  const stat = await lstat(path);
  const name = relative(root, path);
  hash.update(`path:${name}\0mode:${stat.mode}\0size:${stat.size}\0`);
  if (stat.isSymbolicLink()) hash.update(`link:${await readlink(path)}\0`);
  else if (stat.isFile()) hash.update(await readFile(path));
}

/**
 * Stable content identity of a git worktree that plc created (release and cleanup of isolated
 * worktrees). It reads git's view only: tracked changes and untracked files that are not ignored.
 * Any other workspace is the user's own directory, so it throws.
 * It runs git and reads files asynchronously: it used to run on the daemon main thread, and a large
 * worktree held the thread while the daemon released it (2026-11-03).
 * The reviewer check uses reviewWorkspaceFingerprint below.
 */
export async function workspaceContentHash(workspace: Workspace): Promise<string> {
  // This function used to walk and read every file of any other workspace, node_modules included.
  // When the daemon's TTL sweep released the user's main checkout, the daemon froze.
  // Cleanup never deletes those directories, so they need no content hash (see workspace.ts).
  if (!workspace.git_worktree || !workspace.repo_root) {
    throw new Error(`workspace #${workspace.id} is not a plc git worktree; its content is not hashed`);
  }
  const hash = createHash("sha256");
  try { await lstat(workspace.path); } catch { return createHash("sha256").update(`missing:${workspace.path}`).digest("hex"); }
  hash.update(`head:${(await git(workspace.path, ["rev-parse", "HEAD"])).trim()}\0`);
  hash.update(`index:${await git(workspace.path, ["diff", "--cached", "--binary", "--no-ext-diff"])}\0`);
  hash.update(`worktree:${await git(workspace.path, ["diff", "--binary", "--no-ext-diff"])}\0`);
  const untracked = new Set((await git(workspace.path, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0").filter(Boolean));
  for (const path of [...untracked].sort()) await addFile(hash, workspace.path, join(workspace.path, path));
  return hash.digest("hex");
}

// ── 核查前后的工作区指纹 ─────────────────────────────────────────────────────────
//
// 以前核查前后用上面的同步 workspaceContentHash。共享工作区就是用户的主 checkout，它不是 git worktree，
// 函数就同步遍历整棵树，连 node_modules 和其他会话的 worktree 一起读。它跑在 daemon 的主线程上：
// 2026-10-14/15 工单 #66 的核查 Run #73–#78 每次启动，daemon 都停摆约 1 小时 45 分钟。
// 现在用对话 Run 的那一套（pipeline/workspace-tree-hash.ts）：异步、有时限，git 仓库按 git 的视角算，
// 被忽略的文件不读。量不出来时记成 unmeasured，核查照常结束，结论不判成「改过」。
const MEASURED = "tree:";
const UNMEASURED = "unmeasured:";
/** 核查前后算一次指纹的时限。 */
export const REVIEW_FINGERPRINT_TIMEOUT_MS = 30_000;

/** 核查前后的工作区指纹。不会抛错：目录不存在记成 tree:missing，量不出来记成 unmeasured:原因。 */
export async function reviewWorkspaceFingerprint(
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  try {
    return `${MEASURED}${await workspaceTreeHash(path, { timeoutMs: options.timeoutMs ?? REVIEW_FINGERPRINT_TIMEOUT_MS })}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${MEASURED}missing`;
    return `${UNMEASURED}${String((error as Error).message ?? error).slice(0, 200)}`;
  }
}

export type ReviewFingerprintComparison = "matching" | "drifted" | "unknown";

/**
 * 核查前后两个指纹的比较。只有两边都量出来、并且是同一种算法时才说得出改没改：
 * 一边量不出来，或者一边是部署前的同步指纹（64 位十六进制，没有前缀），结果是 unknown。
 */
export function compareReviewFingerprints(pre: string | null, post: string | null): ReviewFingerprintComparison {
  if (!pre || !post) return "unknown";
  const legacy = (hash: string) => /^[0-9a-f]{64}$/.test(hash);
  const comparable = (pre.startsWith(MEASURED) && post.startsWith(MEASURED)) || (legacy(pre) && legacy(post));
  if (!comparable) return "unknown";
  return pre === post ? "matching" : "drifted";
}

export interface ReviewWorkspaceCheck {
  runId: number; workspaceId: number; preHash: string; postHash: string | null;
  verdict: "pass" | "fail" | null; evidence: string | null;
  state: "pending" | "passed" | "drifted" | "failed";
}

// 同一个 Run 的检查只在第一次开始时记核查前的指纹。恢复暂停的核查 Run 会再走到这里：沿用原来的指纹和已经交的结论，
// 暂停期间对工作区的改动照样会被比出来（发布评审 run-resume F3：以前重记指纹、清掉结论，改动就成了新的基准）。
export async function beginReviewWorkspaceCheck(db: Db, runId: number, workspace: Workspace): Promise<string> {
  const existing = db.prepare("SELECT pre_hash FROM review_workspace_checks WHERE run_id=?").get(runId) as
    { pre_hash: string } | undefined;
  if (existing) return existing.pre_hash;
  const preHash = await reviewWorkspaceFingerprint(workspace.path);
  db.prepare(`INSERT INTO review_workspace_checks (run_id, workspace_id, pre_hash) VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING`)
    .run(runId, workspace.id, preHash);
  return (db.prepare("SELECT pre_hash FROM review_workspace_checks WHERE run_id=?").get(runId) as { pre_hash: string }).pre_hash;
}

/**
 * 核查结束后的指纹。没有核查记录、或者 reviewer 没有交结论时返回 null（不用算）。
 * 异步：调用方在登记步骤和事务之外 await 它，再把结果交给 completeReviewWorkspaceCheck。
 */
export async function reviewWorkspacePostFingerprint(db: Db, runId: number): Promise<string | null> {
  const row = db.prepare("SELECT workspace_id, verdict, evidence FROM review_workspace_checks WHERE run_id=?")
    .get(runId) as { workspace_id: number; verdict: string | null; evidence: string | null } | undefined;
  if (!row?.verdict || !row.evidence) return null;
  const workspace = db.prepare("SELECT path FROM workspaces WHERE id=?").get(row.workspace_id) as Pick<Workspace, "path"> | undefined;
  if (!workspace) throw new Error(`review workspace #${row.workspace_id} not found`);
  return reviewWorkspaceFingerprint(workspace.path);
}

export function completeReviewWorkspaceCheck(
  db: Db, runId: number, input: { verdict: "pass" | "fail"; evidence: string; postHash: string },
): { accepted: boolean; preHash: string; postHash: string } {
  const row = db.prepare("SELECT * FROM review_workspace_checks WHERE run_id=?")
    .get(runId) as { workspace_id: number; pre_hash: string } | undefined;
  if (!row) throw new Error(`review workspace check missing for run #${runId}`);
  const postHash = input.postHash;
  // 量不出来不算改过：结论照常登记，指纹的比较在投影上显示为 unknown。
  const accepted = compareReviewFingerprints(row.pre_hash, postHash) !== "drifted";
  db.prepare(`UPDATE review_workspace_checks SET post_hash=?, verdict=?, evidence=?, state=?, completed_at=datetime('now') WHERE run_id=?`)
    .run(postHash, input.verdict, input.evidence, accepted ? "passed" : "drifted", runId);
  return { accepted, preHash: row.pre_hash, postHash };
}

export function pendingReviewWorkspaceCheck(db: Db, runId: number): {
  verdict: "pass" | "fail"; evidence: string; preHash: string; postHash: string;
} | null {
  const row = db.prepare("SELECT verdict, evidence, pre_hash, post_hash, state FROM review_workspace_checks WHERE run_id=?")
    .get(runId) as { verdict: "pass" | "fail" | null; evidence: string | null; pre_hash: string; post_hash: string | null; state: string } | undefined;
  if (!row?.verdict || !row.evidence || !row.post_hash || row.state !== "passed") return null;
  return { verdict: row.verdict, evidence: row.evidence, preHash: row.pre_hash, postHash: row.post_hash };
}
