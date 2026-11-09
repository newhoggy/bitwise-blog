#!/usr/bin/env node
// The advisor tools: everything that reads a writer's corpus. See corpus/README.md.
//
//   npm run advisor -- link <path>                 point corpus/private at a clone of the data repo
//   npm run advisor -- index [<writer>]            regenerate the INDEX.md catalogues
//   npm run advisor -- holdout <writer> [--check]  choose (or check) the eval holdout
//   npm run advisor -- leak-check                  does any tracked file hold a run of atlas quote words?
//   npm run advisor -- parity                      does the port still agree with the Python reference?
//
// Exit code: 0 on success, 1 if a check or a command failed, 2 on a usage error.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CORPUS_DIR, atlasEligible, loadMeta, loadPosts, privateDir, validate, writeMeta } from "./advisor/corpus.mts";
import { leakCheck, LEAK_RUN_WORDS } from "./advisor/guards.mts";
import { applyHoldout, computeHoldout, DEFAULT_FRACTION, DEFAULT_SEED } from "./advisor/holdout.mts";
import { buildIndexes, writers } from "./advisor/index.mts";
import { parity } from "./advisor/parity.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `usage: npm run advisor -- <command>
  link <path> [--force]                  point corpus/private at a clone of the private data repo
  index [<writer>]                       regenerate the INDEX.md catalogues
  holdout <writer> [--check] [--fraction F] [--seed N]
                                         choose the eval holdout, or check it is current
  leak-check                             fail if a tracked file holds a run of words from an atlas quote
  parity                                 compare with the Python reference; skips without private data`;

/** The two output streams a command writes to (the console, or a test's sink). */
export interface Output { log: (...args: any[]) => void; error: (...args: any[]) => void }

export interface AdvisorContext {
  out?: Output;
  /** Where corpus/ lives (default: the repo's). */
  corpusRoot?: string;
  /** The git checkout `leak-check` reads (default: this repo). */
  repoRoot?: string;
}

/** Make corpus/private a symlink to the data repo. One per worktree, since worktrees don't share ignored files. */
function cmdLink(target: string, force: boolean, corpusRoot: string, repoRoot: string, out: Output): number {
  const resolved = path.resolve(target);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    out.error(`error: ${resolved} is not a directory`);
    return 1;
  }
  const relative = path.relative(repoRoot, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    out.error(`error: ${resolved} is inside this repository; the private data must live outside it`);
    return 1;
  }
  const link = privateDir(corpusRoot);
  const existing = fs.lstatSync(link, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === resolved) {
      out.log(`corpus/private already points at ${resolved}`);
      return 0;
    }
    if (!force) {
      out.error(`error: corpus/private points at ${fs.readlinkSync(link)}; pass --force to repoint it`);
      return 1;
    }
    fs.unlinkSync(link);
  } else if (existing) {
    // A real directory may hold synced posts that exist nowhere else.
    if (!existing.isDirectory() || fs.readdirSync(link).length > 0) {
      out.error(`error: corpus/private exists and is not an empty directory; move its contents into ${resolved} first`);
      return 1;
    }
    fs.rmdirSync(link);
  }
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(resolved, link, "dir");
  const found = writers(corpusRoot);
  out.log(`corpus/private -> ${resolved} (${found.length ? `writers: ${found.join(", ")}` : "no writers yet"})`);
  return 0;
}

function cmdHoldout(slug: string, options: { check: boolean; fraction: number; seed: number }, corpusRoot: string, out: Output): number {
  const meta = loadMeta(slug, corpusRoot);
  if (Object.keys(meta).length === 0) {
    out.error(`error: no corpus_meta.yaml for ${slug}`);
    return 1;
  }
  // A stale holdout may legitimately break the eval-versus-exclude rule; recomputing fixes it.
  const blocking = validate(slug, corpusRoot).filter((p) => !p.includes("eval holdout post is excluded"));
  if (blocking.length) {
    out.error(`error: corpus_meta.yaml is inconsistent:\n  ${blocking.join("\n  ")}`);
    return 1;
  }
  const posts = loadPosts(slug, corpusRoot);
  const chosen = computeHoldout(posts, options.fraction, options.seed);
  const updated = applyHoldout(meta, chosen);
  if (options.check) {
    if (!isDeepStrictEqual(updated, meta)) {
      out.error(`${slug}: holdout is stale; run \`npm run advisor -- holdout ${slug}\``);
      return 1;
    }
    out.log(`${slug}: holdout up to date (${chosen.size} eval posts)`);
    return 0;
  }
  writeMeta(slug, updated, corpusRoot);
  out.log(`${slug}: ${chosen.size} of ${posts.filter(atlasEligible).length} atlas-eligible posts held out for eval`);
  return 0;
}

function cmdLeakCheck(repoRoot: string, corpusRoot: string, out: Output): number {
  const result = leakCheck(repoRoot, corpusRoot);
  if (result.status === "skipped") {
    out.log(`leak-check skipped: ${result.reason}`);
    return 0;
  }
  // Only places and lengths, never the words: this output may end up somewhere public.
  for (const hit of result.hits) out.error(`${hit.file}:${hit.line}: ${hit.words}-word run from an atlas quote`);
  if (result.hits.length) {
    out.error(`leak-check FAILED: ${result.hits.length} run(s) of ${LEAK_RUN_WORDS}+ words in tracked files`);
    return 1;
  }
  for (const { file, words, reason } of result.allowed) out.log(`allowed: ${file} (${words} words): ${reason}`);
  out.log(`leak-check passed: ${result.quotes} quotes, ${result.files} tracked files`);
  return 0;
}

function cmdParity(repoRoot: string, corpusRoot: string, out: Output): number {
  const result = parity(repoRoot, corpusRoot);
  if (result.status === "skipped") {
    out.log(`parity skipped: ${result.reason}`);
    return 0;
  }
  for (const [writer, row] of result.rows) out.log(`${row.status.toUpperCase().padEnd(7)} ${writer.padEnd(16)} ${row.check.padEnd(32)} ${row.detail}`);
  return result.rows.some(([, row]) => row.status === "fail") ? 1 : 0;
}

export async function main(argv: string[] = process.argv.slice(2), context: AdvisorContext = {}): Promise<number> {
  const { out = console, corpusRoot = CORPUS_DIR, repoRoot = ROOT } = context;
  const usageError = (message?: string) => {
    out.error(message ? `${message}\n${USAGE}` : USAGE);
    return 2;
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { check: { type: "boolean" }, force: { type: "boolean" }, fraction: { type: "string" }, seed: { type: "string" } },
    });
  } catch (e) {
    return usageError((e as Error).message);
  }
  const { values } = parsed;
  const [command, ...args] = parsed.positionals;
  switch (command) {
    case "link":
      if (args.length !== 1) return usageError();
      return cmdLink(args[0], values.force ?? false, corpusRoot, repoRoot, out);
    case "index": {
      if (args.length > 1) return usageError();
      const report = buildIndexes(args[0], corpusRoot);
      if (report.length === 0) {
        out.error(args[0] ? `error: no posts for ${args[0]}` : "error: nothing to index; is corpus/private linked?");
        return 1;
      }
      for (const line of report) out.log(line);
      return 0;
    }
    case "holdout": {
      if (args.length !== 1) return usageError();
      const fraction = values.fraction === undefined ? DEFAULT_FRACTION : Number(values.fraction);
      if (!(fraction > 0 && fraction < 1)) return usageError("--fraction must be between 0 and 1 (exclusive)");
      const seed = values.seed === undefined ? DEFAULT_SEED : Number(values.seed);
      if (!Number.isInteger(seed)) return usageError("--seed must be an integer");
      return cmdHoldout(args[0], { check: values.check ?? false, fraction, seed }, corpusRoot, out);
    }
    case "leak-check":
      if (args.length) return usageError();
      return cmdLeakCheck(repoRoot, corpusRoot, out);
    case "parity":
      if (args.length) return usageError();
      return cmdParity(repoRoot, corpusRoot, out);
    default:
      return usageError(command ? `unknown command: ${command}` : undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
