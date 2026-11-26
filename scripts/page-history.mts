// Earlier versions of a page, read from git, and the diff data the published site carries.
//
// A review comment records the commit its reader saw (`commit`), so "what changed since this comment"
// is the diff from `git show <commit>:<page>` to the page as it is now. This module reads those old
// versions and writes one data file per (page, commit) that a merged review file names:
// theme/diffs/<slug>.<commit>.js. The files are generated at deploy time and by `npm run serve`, and
// are never committed (see contracts/page-diff.md).
//
// No installed package: scripts/publish.mts imports this, and the package job installs nothing.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { COMMIT_RE, diffPages, diffData, diffScript } from "./page-diff.mts";
import { reviewFiles, readReview, canonicalDocument, isPrivateDocument, isSealedShell } from "./reviews.mts";
import type { ReviewFile } from "./types.mts";

/** A page's path from the site root. Anything else is refused before it reaches git or the file system. */
export const PAGE_RE = /^docs\/[a-z0-9][a-z0-9-]*\.html$/;

function git(root: string, args: string[]): string | null {
  try { return execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28, timeout: 30_000 }).toString(); }
  catch { return null; }
}

/** A revision the caller typed (a branch, a tag, HEAD~2): never an option, never a path. */
const safeRev = (rev: string) => /^[\w./@^~-]+$/.test(rev) && !rev.startsWith("-");

/** The page as it was at `rev`, or null when the revision or the page does not exist there. */
export function pageAt(root: string, rev: string, page: string): string | null {
  if (!safeRev(rev) || !PAGE_RE.test(page)) return null;
  return git(root, ["show", `${rev}:${page}`]);
}

/** The full commit id of `rev`, or null. */
export function resolveCommit(root: string, rev: string): string | null {
  if (!safeRev(rev)) return null;
  return git(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])?.trim() || null;
}

/** Whether the checkout has only part of the history (a CI clone made without `fetch-depth: 0`). */
export const isShallow = (root: string): boolean => git(root, ["rev-parse", "--is-shallow-repository"])?.trim() === "true";

export type PageState = "changed" | "new" | "deleted";

/** The pages that differ between `base` and the working tree (or `head`), sealed and private ones included: the caller decides what to read. */
export function changedPages(root: string, base: string, head = ""): { page: string; state: PageState }[] | null {
  if (!safeRev(base) || (head && !safeRev(head))) return null;
  const out = git(root, ["diff", "--name-status", "--no-renames", base, ...(head ? [head] : []), "--", "docs"]);
  if (out === null) return null;
  return out.split("\n").map((line) => line.split("\t")).filter(([, file]) => file && PAGE_RE.test(file))
    .map(([status, file]) => ({ page: file, state: status === "A" ? "new" as const : status === "D" ? "deleted" as const : "changed" as const }));
}

/** The commits that merged review files name, by page ("docs/x.html"). Private pages are left out, as everywhere. */
export function reviewCommits(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const file of reviewFiles(root).sort()) {
    let r: ReviewFile;
    try { r = readReview(file); } catch { continue; } // reported by reviewProblems()
    if (!r || r.format !== "bh-review/1" || !Array.isArray(r.comments) || isPrivateDocument(root, r.document)) continue;
    const page = canonicalDocument(r.document);
    if (typeof page !== "string" || !PAGE_RE.test(page)) continue;
    for (const cm of r.comments) {
      const commit: unknown = cm && cm.commit;
      if (typeof commit !== "string" || !COMMIT_RE.test(commit)) continue;
      if (!out.has(page)) out.set(page, new Set());
      out.get(page)!.add(commit);
    }
  }
  return out;
}

/** Where a page's diff against `commit` is served: "theme/diffs/<slug>.<commit>.js". */
export const diffFile = (page: string, commit: string) => `theme/diffs/${path.posix.basename(page, ".html")}.${commit}.js`;

/** The data file for one page against one commit, or null when there is nothing to compare (unknown commit, no such page then, a sealed page). */
export function reviewDiffScript(root: string, page: string, commit: string, current: string): string | null {
  if (!COMMIT_RE.test(commit) || isSealedShell(current)) return null;
  const old = pageAt(root, commit, page);
  if (old === null || isSealedShell(old)) return null;
  const diff = diffPages(old, current);
  return diff && diffScript(page, diffData(diff, commit));
}

export interface WrittenDiffs { written: string[]; skipped: { page: string; commit: string }[] }

/**
 * Write the diff data of every (page, commit) the review files in `source` name into `stage`, from the
 * staged copy of each page (so a page the site does not publish gets none). `source` must be a git
 * checkout with the commits in it; a commit it lacks is skipped and returned.
 */
export function writeReviewDiffs(source: string, stage: string): WrittenDiffs {
  const result: WrittenDiffs = { written: [], skipped: [] };
  for (const [page, commits] of [...reviewCommits(source)].sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(stage, page);
    if (!fs.existsSync(file)) continue;
    const current = fs.readFileSync(file, "utf8");
    for (const commit of [...commits].sort()) {
      const script = reviewDiffScript(source, page, commit, current);
      if (script === null) { result.skipped.push({ page, commit }); continue; }
      const out = path.join(stage, diffFile(page, commit));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, script);
      result.written.push(diffFile(page, commit));
    }
  }
  return result;
}
