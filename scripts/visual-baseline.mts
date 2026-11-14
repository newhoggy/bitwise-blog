#!/usr/bin/env node
// Fetch main's renders as the baseline for a pull request's `npm run visual` (the CI render job).
//
//   node scripts/visual-baseline.mts --dir .visual/system-fonts/baseline [--base <sha>]
//
// Every build of main uploads its renders as the artifact `visual-baseline` (ci.yml). This lists
// the repository's artifacts of that name, keeps the unexpired ones that a build of
// main in this repository made (a fork's pull request runs in this repository too, and could name
// an artifact the same), prefers the one built from `--base` (the commit the pull request is based
// on), else takes the newest, and downloads it into `--dir`. Needs `gh`, with GH_TOKEN and GH_REPO
// (or GITHUB_REPOSITORY) set, and the job permission `actions: read`.
//
// It never fails the job: finding no baseline (before the first build of main, or after the
// artifact expires) or a `gh` error is a warning, and `npm run visual` then has nothing to compare.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ARTIFACT = "visual-baseline";

/** The fields of a GitHub artifact (REST `actions/artifacts`) this reads. */
export type Artifact = {
  name: string;
  expired: boolean;
  created_at: string;
  workflow_run: { id: number; repository_id: number; head_repository_id: number; head_branch: string; head_sha: string };
};

/** The baseline chosen: the run to download from, its commit, and whether that is the base commit. */
export type Baseline = { runId: number; sha: string; exact: boolean };

/** Whether an API record has the fields `pickBaseline` reads (a malformed one is skipped, not trusted). */
export function isArtifact(x: unknown): x is Artifact {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>, run = a["workflow_run"] as Record<string, unknown> | null | undefined;
  return typeof a["name"] === "string" && typeof a["expired"] === "boolean" && typeof a["created_at"] === "string"
    && !!run && typeof run === "object" && typeof run["id"] === "number" && typeof run["repository_id"] === "number"
    && typeof run["head_repository_id"] === "number" && typeof run["head_branch"] === "string" && typeof run["head_sha"] === "string";
}

/** The baseline to use from an artifact listing, or null when there is none. */
export function pickBaseline(artifacts: readonly unknown[], base: string | null, branch = "main"): Baseline | null {
  const usable = artifacts.filter(isArtifact)
    .filter((a) => a.name === ARTIFACT && !a.expired && a.workflow_run.head_branch === branch
      && a.workflow_run.head_repository_id === a.workflow_run.repository_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const exact = base ? usable.find((a) => a.workflow_run.head_sha === base) : undefined;
  const chosen = exact ?? usable[0];
  return chosen ? { runId: chosen.workflow_run.id, sha: chosen.workflow_run.head_sha, exact: !!exact } : null;
}

const flag = (args: string[], name: string): string | null => args.includes(name) ? args[args.indexOf(name) + 1] || null : null;
// A hung `gh` must not hold the job until its timeout-minutes.
const gh = (args: string[], timeout: number): string => execFileSync("gh", args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
const warn = (message: string): void => console.log(`::warning::${message}`);

function main(args: string[]): void {
  const dir = flag(args, "--dir"), base = flag(args, "--base");
  const repo = process.env["GH_REPO"] || process.env["GITHUB_REPOSITORY"];
  if (!dir || !repo) {
    console.error("usage: GH_REPO=<owner/repo> node scripts/visual-baseline.mts --dir <dir> [--base <sha>]");
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  let baseline: Baseline | null;
  try {
    // Every page: the listing is only roughly newest first, so the newest could be on any of them.
    const lines = gh(["api", "--paginate", `repos/${repo}/actions/artifacts?name=${ARTIFACT}&per_page=100`, "--jq", ".artifacts[]"], 120_000);
    baseline = pickBaseline(lines.split("\n").filter((l) => l.trim()).map((l): unknown => JSON.parse(l)), base);
  } catch (e) {
    warn(`could not list the ${ARTIFACT} artifacts, so there is no baseline: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!baseline) {
    console.log(`No baseline yet: no build of main has a ${ARTIFACT} artifact (main saves one on every build, kept for 90 days).`);
    return;
  }
  try {
    gh(["run", "download", String(baseline.runId), "--repo", repo, "--name", ARTIFACT, "--dir", dir], 180_000);
  } catch (e) {
    warn(`could not download the baseline from run ${baseline.runId}, so there is none: ${e instanceof Error ? e.message : String(e)}`);
    // A partial download would compare some pages and call the rest new: start from nothing instead.
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    return;
  }
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).length;
  console.log(`Baseline: ${pngs} renders of main at ${baseline.sha.slice(0, 7)} (run ${baseline.runId})${base && !baseline.exact ? `; this pull request is based on ${base.slice(0, 7)}, which has no baseline (yet)` : ""}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
