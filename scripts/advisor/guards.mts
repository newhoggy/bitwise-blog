// The rule from corpus/README.md, as a check: nothing derived from a writer's text is committed.
//
// `tests/advisor-guards.test.mts` holds the guards that run everywhere (what git tracks under corpus/,
// what publishing copies). This file holds the one that needs the private data: whether a tracked
// file, or any blob in git history, contains a run of words from the text kept private (posts, atlas
// quotes and statements, voice negatives, authored samples). Its output is meant to be safe to paste:
// file names, line numbers and run lengths, never the matched words.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, dataDir, markdownFiles } from "./corpus.mts";
import { writers } from "./index.mts";

/** A shared run this long is taken to be copied text. */
export const LEAK_RUN_WORDS = 8;

/** A file allowed to share text with the private data, on purpose. */
export interface LeakAllowance {
  /** How many words of shared runs were reviewed. More than this fails: someone has to look again. */
  maxWords: number;
  reason: string;
}

/**
 * Files that quote a writer deliberately. The exception is per file and capped, so quoting more, or
 * quoting anywhere else, still fails. A generated file gets a cap of Infinity only if every word in it
 * comes from pages that are checked themselves.
 */
export const LEAK_ALLOWED: Record<string, LeakAllowance> = {
  // 1,500 words measured against post text, atlas, voice negatives and authored samples (#112). Most are one
  // 1,156-word run: the <template> blocks that hold verbatim essay passages shown as popups. The page says
  // they are used with permission, and the owner has to confirm that this covers all of them; the cap only
  // records what was measured, so more quoting still fails.
  "docs/voice-notes-on-trial.html": { maxWords: 1500, reason: "a published page: cited quotations and verbatim essay passages, said to be used with the writer's permission (scope to be confirmed by the owner)" },
  "theme/search-index.js": { maxWords: Infinity, reason: "generated from the text of docs/*.html, which are checked themselves" },
};

const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;
// A quote may elide with "...", "…" or "[...]"; the words either side of one are not a run.
const ELISION = /\.{3,}|…|\[[\s.…]*\]/;
const TAG = /<\/?[a-zA-Z][^<>]*>/g;
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "—", ndash: "–", hellip: "…",
};

const wordsOf = (text: string) => text.toLowerCase().replaceAll("’", "'").match(WORD) ?? [];

function codePoint(digits: string, radix: number, whole: string): string {
  const cp = parseInt(digits, radix);
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
}

/** Text as a reader would see it: HTML entities, and the string escapes of JSON and generated JS. Raw line breaks stay. */
function decoded(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (whole, hex) => codePoint(hex, 16, whole))
    .replace(/\\[nrt]/g, " ")
    .replace(/\\(["'\/\\])/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => codePoint(hex, 16, whole))
    .replace(/&#([0-9]+);/g, (whole, dec) => codePoint(dec, 10, whole))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** What a run came from, worded to follow "run from" in a message. Never the text itself. */
export type LeakSource = "an atlas quote" | "an atlas statement" | "a voice negative" | "an authored sample" | "post text";

/** Runs seen so far, with where each came from, or just the runs. */
export type RunSet = ReadonlySet<string> | ReadonlyMap<string, LeakSource>;

/** The parsed lines of a .jsonl file, with their line numbers. An error names the line only: JSON.parse's own message would repeat the start of the text. */
function jsonlLines(name: string, text: string): [line: number, entry: unknown][] {
  const out: [number, unknown][] = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      out.push([index + 1, JSON.parse(line)]);
    } catch {
      throw new Error(`${name} line ${index + 1} is not valid JSON`);
    }
  });
  return out;
}

/** Every string anywhere in a parsed JSON value. */
function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

/** Add every run of `LEAK_RUN_WORDS` consecutive words in `text` to `into`; with `elide`, words either side of an elision aren't a run. */
function addRuns(into: Set<string>, text: string, elide: boolean): void {
  for (const segment of elide ? text.split(ELISION) : [text]) {
    const words = wordsOf(segment);
    for (let i = 0; i + LEAK_RUN_WORDS <= words.length; i++) into.add(words.slice(i, i + LEAK_RUN_WORDS).join(" "));
  }
}

/** Every run of `LEAK_RUN_WORDS` consecutive words in the quotes of an ATLAS.jsonl. */
export function quoteRuns(atlasText: string): Set<string> {
  const runs = new Set<string>();
  for (const [line, entry] of jsonlLines("ATLAS.jsonl", atlasText)) {
    const quote = (entry as { quote?: unknown } | null)?.quote;
    if (quote === undefined) continue;
    if (typeof quote !== "string") throw new Error(`ATLAS.jsonl line ${line}: quote is not a string`);
    addRuns(runs, quote, true);
  }
  return runs;
}

/** Every run in every string of every line of a .jsonl file. Short values such as ids can't make a run, so no field names are assumed. */
export function jsonlRuns(name: string, text: string): Set<string> {
  const runs = new Set<string>();
  for (const [, entry] of jsonlLines(name, text)) for (const value of stringValues(entry)) addRuns(runs, value, false);
  return runs;
}

/** Every run in the `statement` of each entry of an ATLAS.jsonl. */
function statementRuns(atlasText: string): Set<string> {
  const runs = new Set<string>();
  for (const [, entry] of jsonlLines("ATLAS.jsonl", atlasText)) {
    const statement = (entry as { statement?: unknown } | null)?.statement;
    if (typeof statement === "string") addRuns(runs, statement, true);
  }
  return runs;
}

/** Every run in a post file. The target of a markdown link is not prose, so `[word](url)` reads as `[word]`. */
export function postRuns(postText: string): Set<string> {
  const runs = new Set<string>();
  addRuns(runs, postText.replace(/\]\([^()\s]*(?:\([^()\s]*\)[^()\s]*)*(?:\s+"[^"]*")?\)/g, "]"), false);
  return runs;
}

export interface LeakHit {
  file: string;
  line: number;
  /** Length of the shared run, in words. */
  words: number;
  /** Where the run came from, when known. */
  source?: LeakSource;
  /** In a history scan, the first 7 characters of the blob's id. */
  blob?: string;
}

interface Word { text: string; line: number }

/** The words of consecutive runs found in `words`, merged where they overlap. */
function scan(file: string, words: Word[], runs: RunSet): LeakHit[] {
  const hits: LeakHit[] = [];
  let current: LeakHit | null = null;
  let currentEnd = -1;
  for (let i = 0; i + LEAK_RUN_WORDS <= words.length; i++) {
    const run = words.slice(i, i + LEAK_RUN_WORDS).map((w) => w.text).join(" ");
    if (!runs.has(run)) continue;
    if (current && i <= currentEnd) current.words += i + LEAK_RUN_WORDS - currentEnd;
    else {
      const source = runs instanceof Map ? runs.get(run) : undefined;
      const hit: LeakHit = { file, line: words[i].line, words: LEAK_RUN_WORDS };
      if (source) hit.source = source;
      hits.push(hit);
      current = hit;
    }
    currentEnd = i + LEAK_RUN_WORDS;
  }
  return hits;
}

/**
 * The runs from `runs` that appear in `text`. Prose is read across tags, so `<em>a</em> b` is two
 * words in a row. Each tag is read on its own, so a quote in a `content=` or `alt=` attribute counts,
 * without attribute names breaking up the prose around the tag.
 */
export function findRuns(file: string, text: string, runs: RunSet): LeakHit[] {
  let line = 1;
  const wordsIn = (segment: string): Word[] => {
    const lower = decoded(segment).toLowerCase().replaceAll("’", "'");
    const words: Word[] = [];
    let at = 0;
    for (const m of lower.matchAll(WORD)) {
      for (; at < m.index; at++) if (lower[at] === "\n") line++;
      words.push({ text: m[0], line });
    }
    for (; at < lower.length; at++) if (lower[at] === "\n") line++;
    return words;
  };
  const prose: Word[] = [];
  const hits: LeakHit[] = [];
  let last = 0;
  for (const tag of text.matchAll(TAG)) {
    prose.push(...wordsIn(text.slice(last, tag.index)));
    hits.push(...scan(file, wordsIn(tag[0]), runs));
    last = tag.index + tag[0].length;
  }
  prose.push(...wordsIn(text.slice(last)));
  return [...hits, ...scan(file, prose, runs)].sort((a, b) => a.line - b.line);
}

interface Text { file: string; blob?: string; text: string }

/** The files git tracks in `repoRoot`, skipping binaries and symlinks. */
function* trackedTexts(repoRoot: string): Generator<Text> {
  const listed = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const rel of listed.split("\0")) {
    if (!rel) continue;
    const file = path.join(repoRoot, rel);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue;
    yield { file: rel, text: bytes.toString("utf8") };
  }
}

/** A blob bigger than this is a media file or a dump, not prose someone pasted. */
const HISTORY_MAX_BLOB_BYTES = 8 * 1024 * 1024;
/** Blobs are read from git in batches of about this many bytes, to bound memory. */
const HISTORY_BATCH_BYTES = 32 * 1024 * 1024;

/** Every text blob reachable from any ref, once each, under the first path it was seen at. */
function* historyTexts(repoRoot: string): Generator<Text> {
  const gitOut = (args: string[], input?: string) => execFileSync("git", ["-C", repoRoot, ...args], { input, maxBuffer: 1024 * 1024 * 1024 });
  const paths = new Map<string, string>();
  for (const line of gitOut(["rev-list", "--objects", "--all"]).toString("utf8").split("\n")) {
    const space = line.indexOf(" ");
    if (space !== -1 && !paths.has(line.slice(0, space))) paths.set(line.slice(0, space), line.slice(space + 1));
  }
  const sizes = gitOut(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], [...paths.keys()].join("\n") + "\n").toString("utf8");
  const blobs: [sha: string, size: number][] = [];
  for (const line of sizes.split("\n")) {
    const [sha, type, size] = line.split(" ");
    if (type === "blob" && Number(size) <= HISTORY_MAX_BLOB_BYTES) blobs.push([sha, Number(size)]);
  }
  for (let from = 0; from < blobs.length;) {
    let to = from, bytes = 0;
    while (to < blobs.length && (to === from || bytes + blobs[to][1] <= HISTORY_BATCH_BYTES)) bytes += blobs[to++][1];
    const batch = gitOut(["cat-file", "--batch"], blobs.slice(from, to).map(([sha]) => sha).join("\n") + "\n");
    let at = 0;
    for (; at < batch.length;) {
      const headerEnd = batch.indexOf("\n", at);
      const [sha, , size] = batch.toString("utf8", at, headerEnd).split(" ");
      const body = batch.subarray(headerEnd + 1, headerEnd + 1 + Number(size));
      at = headerEnd + 1 + Number(size) + 1;
      if (body.includes(0)) continue;
      yield { file: paths.get(sha)!, blob: sha.slice(0, 7), text: body.toString("utf8") };
    }
    from = to;
  }
}

/** How many of each kind of private text the comparison read. */
export type LeakSources = Record<"atlas entries" | "voice negatives" | "authored samples" | "posts", number>;

/** "12 atlas entries, 163 posts", leaving out what the private data doesn't have. */
export function describeSources(sources: LeakSources): string {
  return Object.entries(sources).filter(([, n]) => n > 0).map(([name, n]) => `${n} ${name}`).join(", ");
}

export interface LeakAllowed { file: string; blob?: string; words: number; reason: string }

export type LeakCheckResult =
  | { status: "skipped"; reason: string }
  | { status: "done"; sources: LeakSources; files: number; hits: LeakHit[]; allowed: LeakAllowed[] };

const readIfThere = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

/**
 * The runs of every private text of every writer, each with where it came from. A run found in more than
 * one place keeps the first label, and the order is from most to least specific: an atlas quote is also in
 * its post. Null when there is nothing to compare with.
 */
function privateRuns(corpusRoot: string): { runs: Map<string, LeakSource>; sources: LeakSources } | null {
  const runs = new Map<string, LeakSource>();
  const sources: LeakSources = { "atlas entries": 0, "voice negatives": 0, "authored samples": 0, posts: 0 };
  const add = (found: Set<string>, source: LeakSource) => {
    for (const run of found) if (!runs.has(run)) runs.set(run, source);
  };
  const lines = (text: string) => text.split("\n").filter((l) => l.trim()).length;
  const perWriter = writers(corpusRoot);
  // Specific sources first, for every writer, then post text.
  for (const writer of perWriter) {
    const dir = dataDir(writer, corpusRoot);
    const atlas = readIfThere(path.join(dir, "ATLAS.jsonl"));
    if (atlas !== null) {
      sources["atlas entries"] += lines(atlas);
      add(quoteRuns(atlas), "an atlas quote");
      add(statementRuns(atlas), "an atlas statement");
    }
  }
  for (const writer of perWriter) {
    const dir = dataDir(writer, corpusRoot);
    const authored = readIfThere(path.join(dir, "evals", "authored.jsonl"));
    if (authored !== null) {
      sources["authored samples"] += lines(authored);
      add(jsonlRuns("authored.jsonl", authored), "an authored sample");
    }
    const negatives = readIfThere(path.join(dir, "voice_negatives.jsonl"));
    if (negatives !== null) {
      sources["voice negatives"] += lines(negatives);
      add(jsonlRuns("voice_negatives.jsonl", negatives), "a voice negative");
    }
  }
  for (const writer of perWriter) {
    for (const file of markdownFiles(path.join(dataDir(writer, corpusRoot), "posts"))) {
      sources.posts++;
      add(postRuns(fs.readFileSync(file, "utf8")), "post text");
    }
  }
  return Object.values(sources).some((n) => n > 0) ? { runs, sources } : null;
}

function compare(texts: Iterable<Text>, runs: RunSet, allowances: Record<string, LeakAllowance>): Pick<Extract<LeakCheckResult, { status: "done" }>, "files" | "hits" | "allowed"> {
  const hits: LeakHit[] = [];
  const allowed: LeakAllowed[] = [];
  let files = 0;
  for (const { file, blob, text } of texts) {
    files++;
    const found = findRuns(file, text, runs).map((hit) => (blob ? { ...hit, blob } : hit));
    if (found.length === 0) continue;
    const words = found.reduce((n, hit) => n + hit.words, 0);
    const allowance = Object.hasOwn(allowances, file) ? allowances[file] : undefined;
    if (allowance && words <= allowance.maxWords) allowed.push({ file, ...(blob && { blob }), words, reason: allowance.reason });
    else hits.push(...found);
  }
  return { files, hits, allowed };
}

const SKIPPED = "no posts, atlas, voice negatives or authored samples in the private data";

/** Check every tracked file of `repoRoot` against the private text of every writer: posts, atlas quotes and statements, voice negatives and authored samples. */
export function leakCheck(repoRoot: string, corpusRoot: string = CORPUS_DIR, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): LeakCheckResult {
  const found = privateRuns(corpusRoot);
  if (!found) return { status: "skipped", reason: SKIPPED };
  return { status: "done", sources: found.sources, ...compare(trackedTexts(repoRoot), found.runs, allowances) };
}

/**
 * The same comparison for every text blob reachable from any ref, not only the files checked out. A
 * blob is judged by its own path's allowance, so an old version of an allowed page is held to the same cap.
 * This reports; it does not rewrite history.
 */
export function leakCheckHistory(repoRoot: string, corpusRoot: string = CORPUS_DIR, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): LeakCheckResult {
  const found = privateRuns(corpusRoot);
  if (!found) return { status: "skipped", reason: SKIPPED };
  return { status: "done", sources: found.sources, ...compare(historyTexts(repoRoot), found.runs, allowances) };
}
