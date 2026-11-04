import { basename } from "node:path";
import type { Db } from "@pi-lead-child/store";
import {
  createProject, findProject, getProject, linkProjectRepository, type Project,
} from "@pi-lead-child/store";
import { gitFacts, warmGitFacts, type GitFactSource } from "./git-facts.js";

export interface RepositoryIdentity {
  root: string;
  remoteUrl: string | null;
  name: string;
}

export function normalizeRemoteUrl(value: string): string {
  let remote = value.trim();
  const scp = remote.match(/^[^@]+@([^:]+):(.+)$/);
  if (scp) remote = `${scp[1]}/${scp[2]}`;
  else {
    try {
      const url = new URL(remote);
      remote = `${url.hostname}${url.pathname}`;
    } catch {
      remote = remote.replace(/^file:\/\//, "");
    }
  }
  return remote.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
}

// git 的事实从 facts 来（git-facts.ts）：缺省是缓存优先、缺了同步查。建工单的入口先用 warmRepositoryIdentity 异步预热，
// 建工单的事务里就不再同步跑 git。
export function repositoryIdentity(workdir: string, facts: GitFactSource = gitFacts): RepositoryIdentity | null {
  const root = facts.get({ kind: "top", dir: workdir });
  if (!root) return null;
  const rawRemote = facts.get({ kind: "origin", root });
  return { root, remoteUrl: rawRemote ? normalizeRemoteUrl(rawRemote) : null, name: basename(root) };
}

/** 异步备好 workdir 的仓库身份（根目录、origin）：建工单之前用。 */
export function warmRepositoryIdentity(workdir: string | null | undefined): Promise<void> {
  if (!workdir) return Promise.resolve();
  return warmGitFacts((facts) => repositoryIdentity(workdir, facts));
}

export function resolveProjectForWorkdir(
  db: Db,
  workdir: string,
  args: { createdBy: string },
): Project | null {
  const identity = repositoryIdentity(workdir);
  if (!identity) return null;
  const byRoot = db.prepare(
    "SELECT project_id FROM project_repositories WHERE repo_root = ?",
  ).get(identity.root) as { project_id: number } | undefined;
  if (byRoot) return getProject(db, byRoot.project_id) ?? null;
  if (identity.remoteUrl) {
    const byRemote = db.prepare(
      "SELECT project_id FROM project_repositories WHERE remote_url = ? ORDER BY id LIMIT 1",
    ).get(identity.remoteUrl) as { project_id: number } | undefined;
    if (byRemote) {
      linkProjectRepository(db, byRemote.project_id, {
        repoRoot: identity.root, remoteUrl: identity.remoteUrl, repoName: identity.name, confidence: 0.9,
      });
      return getProject(db, byRemote.project_id) ?? null;
    }
  }
  const known = findProject(db, identity.name);
  const projectId = known?.id ?? createProject(db, {
    name: identity.name, createdBy: args.createdBy, confidence: 0.8,
  });
  linkProjectRepository(db, projectId, {
    repoRoot: identity.root, remoteUrl: identity.remoteUrl ?? undefined,
    repoName: identity.name, confidence: 0.8,
  });
  return getProject(db, projectId) ?? null;
}
