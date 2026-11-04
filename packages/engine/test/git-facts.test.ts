import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@pi-lead-child/core/testing";
import {
  forgetGitFacts, gitFacts, gitFactsReady, resolveGitFact, setGitFactsLog, warmGitFacts, type GitFact,
} from "../src/coordinator/git-facts.js";

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

beforeEach(() => {
  repo = join(tempDir("plc-git-facts-"), "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("remote", "add", "origin", "git@example.com:acme/x.git");
  forgetGitFacts();
});
afterEach(() => {
  setGitFactsLog(null);
  forgetGitFacts();
});

// 2026-11-03：判定工作区的 git 以前在主线程上同步跑。后台异步查到的，必须和同步查到的一样。
describe("git facts", () => {
  it("gives the same answers when looked up in the background as when run synchronously", async () => {
    const facts: GitFact[] = [
      { kind: "top", dir: join(repo, "docs") },
      { kind: "commonDir", dir: repo },
      { kind: "origin", root: repo },
      { kind: "headHas", repository: repo, path: "docs" },
      { kind: "headHas", repository: repo, path: "missing" },
    ];
    const synchronous = facts.map((fact) => gitFacts.get(fact));
    forgetGitFacts();
    await Promise.all(facts.map(resolveGitFact));
    const logged: string[] = [];
    setGitFactsLog((line) => logged.push(line));
    expect(facts.map((fact) => gitFacts.get(fact))).toEqual(synchronous);
    expect(logged).toEqual([]);
    expect(synchronous[2]).toBe("git@example.com:acme/x.git");
    expect(synchronous.slice(3)).toEqual([true, false]);
  });

  it("is not ready until the facts a decision reads are in the cache, and looks them up meanwhile", async () => {
    const decide = (source: typeof gitFacts) => {
      const top = source.get({ kind: "top", dir: repo });
      if (top) source.get({ kind: "origin", root: top });
    };
    expect(gitFactsReady(decide)).toBe(false);
    await warmGitFacts(decide);
    expect(gitFactsReady(decide)).toBe(true);
  });

  it("answers that a directory outside any checkout is not in a repository", async () => {
    const outside = tempDir("plc-git-facts-outside-");
    await resolveGitFact({ kind: "top", dir: outside });
    expect(gitFacts.get({ kind: "top", dir: outside })).toBeNull();
  });
});
