#!/usr/bin/env node
// Pull a writer's posts from their platforms into the private data: corpus/private/<name>/posts/.
//
//   npm run sync-posts -- duncan-sabien          one writer
//   npm run sync-posts -- --all                  every writer with a sources.yaml
//   npm run sync-posts -- duncan-sabien --full   no early exit: try every post (catch-up)
//
// Reads corpus/<name>/sources.yaml, runs each configured ingester and writes each new post as
// <platform>-<slug>.md under dataDir(name). Idempotent: a post already on disk is skipped, and each
// ingester stops once it has seen five already-ingested posts in a row. The posts are git-ignored
// (they are other people's writing); only sources.yaml is committed. See corpus/README.md.
//
// A port of scripts/update_advisor.py in the shoulder-advisors repo.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { CORPUS_DIR, dataDir } from "./advisor/corpus.mts";
import { describeError, reportSummary, type IngesterOptions, type SourceConfig } from "./ingest/base.mts";
import { getIngester } from "./ingest/index.mts";

/** The two output streams `main` writes to (the console, or a test's sink). */
export interface Output { log: (...args: any[]) => void; error: (...args: any[]) => void }

export interface SyncOptions extends IngesterOptions {
  /** Disable early exit: attempt every post in every source. */
  full?: boolean;
  /** Where corpus/ lives (default: the repo's). */
  corpusRoot?: string;
  out?: Output;
}

/** Sync one writer. Returns 0 on success, 1 if there is no sources.yaml, 2 if any source or post failed. */
export async function syncWriter(name: string, options: SyncOptions = {}): Promise<number> {
  const { full = false, corpusRoot = CORPUS_DIR, out = console, ...ingesterOptions } = options;
  const sourcesFile = path.join(corpusRoot, name, "sources.yaml");
  if (!fs.existsSync(sourcesFile)) {
    out.error(`error: ${sourcesFile} not found`);
    return 1;
  }

  const config = parseYaml(fs.readFileSync(sourcesFile, "utf8")) as { sources?: SourceConfig[] } | null;
  const sources = config?.sources ?? [];
  if (!sources.length) {
    out.log(`warning: no sources configured in ${sourcesFile}`);
    return 0;
  }

  out.log(`Syncing: ${name}${full ? "  (full catch-up)" : ""}`);
  let totalErrors = 0;
  for (const source of sources) {
    const platform = source.platform ?? "?";
    let ingester;
    try {
      ingester = getIngester(source, dataDir(name, corpusRoot), ingesterOptions);
    } catch (e) {
      out.log(`  ${platform}: skipped (${describeError(e)})`);
      totalErrors++;
      continue;
    }
    try {
      const report = await ingester.run(full ? Infinity : undefined);
      out.log(`  ${reportSummary(report)}`);
      totalErrors += report.errors.length;
      for (const [slug, err] of report.errors) out.error(`    error: ${slug}: ${err}`);
    } catch (e) {
      out.error(`  ${platform}: FAILED (${describeError(e)})`);
      totalErrors++;
    }
  }
  return totalErrors === 0 ? 0 : 2;
}

/** Sync every writer that has a sources.yaml. The result is the worst exit code. */
export async function syncAll(options: SyncOptions = {}): Promise<number> {
  const { corpusRoot = CORPUS_DIR, out = console } = options;
  if (!fs.existsSync(corpusRoot)) {
    out.log("no corpus/ directory");
    return 0;
  }
  const names = fs
    .readdirSync(corpusRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(corpusRoot, d.name, "sources.yaml")))
    .map((d) => d.name)
    .sort();
  const codes = [];
  for (const name of names) codes.push(await syncWriter(name, options));
  return Math.max(0, ...codes);
}

export async function main(argv: string[] = process.argv.slice(2), out: Output = console): Promise<number> {
  const usage = "usage: npm run sync-posts -- <writer> | --all  [--full]";
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { all: { type: "boolean" }, full: { type: "boolean" } } });
  } catch (e) {
    out.error(`${describeError(e)}\n${usage}`);
    return 2;
  }
  const { all, full } = parsed.values;
  const [name, ...rest] = parsed.positionals;
  if (rest.length || (all && name) || (!all && !name)) {
    out.error(usage);
    return 2;
  }
  return all ? syncAll({ full, out }) : syncWriter(name, { full, out });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
