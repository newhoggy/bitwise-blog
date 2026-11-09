// The rule from corpus/README.md, as a check: nothing derived from a writer's text is committed.
//
// `tests/advisor-guards.test.mts` holds the guards that run everywhere (what git tracks under corpus/,
// what publishing copies). This file holds the one that needs the private data: whether a tracked
// file contains a run of words from an atlas quote. Its output is meant to be safe to paste: file
// names, line numbers and run lengths, never the matched words.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, dataDir } from "./corpus.mts";
import { writers } from "./index.mts";

/** A shared run this long is taken to be copied text. */
export const LEAK_RUN_WORDS = 8;

/** A tracked file allowed to share text with an atlas quote, on purpose. */
export interface LeakAllowance {
  /** How many words of quoted runs were reviewed. More than this fails: someone has to look again. */
  maxWords: number;
  reason: string;
}

/**
 * Files that quote a writer deliberately. The exception is per file and capped, so quoting more, or
 * quoting anywhere else, still fails. A generated file gets a cap of Infinity only if every word in it
 * comes from pages that are checked themselves.
 */
export const LEAK_ALLOWED: Record<string, LeakAllowance> = {
  "docs/voice-notes-on-trial.html": { maxWords: 292, reason: "a published page: cited quotations, used with the writer's permission" },
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

/**
 * Every run of `LEAK_RUN_WORDS` consecutive words in the quotes of an ATLAS.jsonl. An error names the
 * line only: JSON.parse's own message would repeat the start of the text.
 */
export function quoteRuns(atlasText: string): Set<string> {
  const runs = new Set<string>();
  atlasText.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let quote: unknown;
    try {
      quote = (JSON.parse(line) as { quote?: unknown }).quote;
    } catch {
      throw new Error(`ATLAS.jsonl line ${index + 1} is not valid JSON`);
    }
    if (quote === undefined) return;
    if (typeof quote !== "string") throw new Error(`ATLAS.jsonl line ${index + 1}: quote is not a string`);
    for (const segment of quote.split(ELISION)) {
      const words = wordsOf(segment);
      for (let i = 0; i + LEAK_RUN_WORDS <= words.length; i++) runs.add(words.slice(i, i + LEAK_RUN_WORDS).join(" "));
    }
  });
  return runs;
}

export interface LeakHit {
  file: string;
  line: number;
  /** Length of the shared run, in words. */
  words: number;
}

interface Word { text: string; line: number }

/** The words of consecutive runs found in `words`, merged where they overlap. */
function scan(file: string, words: Word[], runs: Set<string>): LeakHit[] {
  const hits: LeakHit[] = [];
  let current: LeakHit | null = null;
  let currentEnd = -1;
  for (let i = 0; i + LEAK_RUN_WORDS <= words.length; i++) {
    if (!runs.has(words.slice(i, i + LEAK_RUN_WORDS).map((w) => w.text).join(" "))) continue;
    if (current && i <= currentEnd) current.words += i + LEAK_RUN_WORDS - currentEnd;
    else {
      current = { file, line: words[i].line, words: LEAK_RUN_WORDS };
      hits.push(current);
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
export function findRuns(file: string, text: string, runs: Set<string>): LeakHit[] {
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

/** The files git tracks in `repoRoot`, skipping binaries and symlinks, as [relative path, text]. */
function trackedTexts(repoRoot: string): [string, string][] {
  const listed = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out: [string, string][] = [];
  for (const rel of listed.split("\0")) {
    if (!rel) continue;
    const file = path.join(repoRoot, rel);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) continue;
    out.push([rel, bytes.toString("utf8")]);
  }
  return out;
}

export type LeakCheckResult =
  | { status: "skipped"; reason: string }
  | { status: "done"; quotes: number; files: number; hits: LeakHit[]; allowed: { file: string; words: number; reason: string }[] };

/** Check every tracked file of `repoRoot` against the atlas quotes of every writer in the private data. */
export function leakCheck(repoRoot: string, corpusRoot: string = CORPUS_DIR, allowances: Record<string, LeakAllowance> = LEAK_ALLOWED): LeakCheckResult {
  const atlases = writers(corpusRoot).map((w) => path.join(dataDir(w, corpusRoot), "ATLAS.jsonl")).filter((f) => fs.existsSync(f));
  if (atlases.length === 0) return { status: "skipped", reason: "no ATLAS.jsonl in the private data" };
  const runs = new Set<string>();
  let quotes = 0;
  for (const atlas of atlases) {
    const text = fs.readFileSync(atlas, "utf8");
    quotes += text.split("\n").filter((l) => l.trim()).length;
    for (const run of quoteRuns(text)) runs.add(run);
  }
  const files = trackedTexts(repoRoot);
  const hits: LeakHit[] = [];
  const allowed: { file: string; words: number; reason: string }[] = [];
  for (const [rel, text] of files) {
    const found = findRuns(rel, text, runs);
    if (found.length === 0) continue;
    const words = found.reduce((n, hit) => n + hit.words, 0);
    const allowance = Object.hasOwn(allowances, rel) ? allowances[rel] : undefined;
    if (allowance && words <= allowance.maxWords) allowed.push({ file: rel, words, reason: allowance.reason });
    else hits.push(...found);
  }
  return { status: "done", quotes, files: files.length, hits, allowed };
}
