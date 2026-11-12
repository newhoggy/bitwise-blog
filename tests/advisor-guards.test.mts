// The rule that nothing derived from a writer's text is committed or published, as tests. It must
// hold every time, so a person remembering it isn't enough. See corpus/README.md.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { main, type Output } from "../scripts/advisor.mts";
import { dataDir } from "../scripts/advisor/corpus.mts";
import { LEAK_RUN_WORDS, describeSources, findRuns, jsonlRuns, leakCheck, leakCheckHistory, leakCheckPushed, parsePushUpdates, postRuns, quoteRuns } from "../scripts/advisor/guards.mts";
import { preparePublishedSite } from "../scripts/publish.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

function tmp(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-advisor-guards-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const sink = () => {
  const lines: string[] = [], errors: string[] = [];
  const out: Output = { log: (...a) => lines.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) };
  return { out, lines, errors };
};

/** Paths under `dir`, relative to it. */
function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

// ---- what git tracks ------------------------------------------------------------------

const ALLOWED_CORPUS_FILE = /^corpus\/(?:README\.md|[^/]+\/(?:sources\.yaml|voice_model\.json|stance_model\.json))$/;

test("git tracks nothing under corpus/ except the README, sources.yaml and the two model files", () => {
  const tracked = git(ROOT, "ls-files", "corpus").split("\n").filter(Boolean);
  assert.ok(tracked.includes("corpus/README.md"), "the check is looking in the right place");
  assert.deepEqual(tracked.filter((f) => !ALLOWED_CORPUS_FILE.test(f)), []);
});

test("the allowed-file pattern rejects what must stay private", () => {
  for (const bad of [
    "corpus/private", "corpus/private/x/ATLAS.jsonl", "corpus/x/posts/a.md", "corpus/x/ATLAS.jsonl", "corpus/x/PROFILE.md", "corpus/x/INDEX.md",
    "corpus/x/corpus_meta.yaml", "corpus/x/items.jsonl", "corpus/x/y/sources.yaml", "corpus/sources.yaml",
  ]) assert.equal(ALLOWED_CORPUS_FILE.test(bad), false, bad);
  for (const good of ["corpus/README.md", "corpus/x/sources.yaml", "corpus/x/voice_model.json", "corpus/x/stance_model.json"]) {
    assert.equal(ALLOWED_CORPUS_FILE.test(good), true, good);
  }
});

test("git ignores corpus/private as a symlink and as a directory, and everything in a data repo stays out", (t) => {
  const repo = tmp(t), data = tmp(t);
  git(repo, "init", "-q");
  fs.copyFileSync(path.join(ROOT, ".gitignore"), path.join(repo, ".gitignore"));
  fs.mkdirSync(path.join(repo, "corpus", "someone"), { recursive: true });
  fs.writeFileSync(path.join(repo, "corpus", "someone", "sources.yaml"), "sources: []\n");
  fs.writeFileSync(path.join(data, "ATLAS.jsonl"), "{}\n");

  const addable = () => {
    git(repo, "add", "-A");
    const staged = git(repo, "diff", "--cached", "--name-only").split("\n").filter(Boolean);
    git(repo, "reset", "-q");
    return staged;
  };
  fs.symlinkSync(data, path.join(repo, "corpus", "private"), "dir");
  assert.deepEqual(addable(), [".gitignore", "corpus/someone/sources.yaml"], "as a symlink");
  fs.unlinkSync(path.join(repo, "corpus", "private"));
  fs.mkdirSync(path.join(repo, "corpus", "private", "someone", "posts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "corpus", "private", "someone", "posts", "a.md"), "text");
  assert.deepEqual(addable(), [".gitignore", "corpus/someone/sources.yaml"], "as a directory");
});

// ---- what publishing copies -----------------------------------------------------------

test("the published site holds no corpus path and nothing from the private data", (t) => {
  const SENTINEL = "SENTINEL-private-corpus-text-7f3a";
  const temp = tmp(t);
  const source = path.join(temp, "source"), stage = path.join(temp, "stage");
  fs.mkdirSync(source);
  fs.mkdirSync(stage);
  for (const entry of ["scripts", "theme", "docs", "reviews", "corpus", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html"]) {
    fs.cpSync(path.join(ROOT, entry), path.join(source, entry), { recursive: true, verbatimSymlinks: true, filter: (f) => path.basename(f) !== "private" });
  }
  const privateFile = path.join(source, "corpus", "private", "someone", "ATLAS.jsonl");
  fs.mkdirSync(path.dirname(privateFile), { recursive: true });
  fs.writeFileSync(privateFile, `{"quote": "${SENTINEL}"}\n`);

  // Copy what the workflow copies: its own list, read from the workflow, so changing it fails here.
  // (ci.yml also assembles a copy in its `check` job, so read the `deploy` job's.)
  const ci = parse(fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8")) as { jobs: Record<string, { steps?: Array<{ run?: string }> }> };
  const deploy = ci.jobs["deploy"];
  assert.ok(deploy, "ci.yml has a `deploy` job");
  const copied = (deploy.steps ?? []).map((step) => step.run?.match(/^\s*cp -r (.+) _site\/\s*$/m)).find(Boolean);
  assert.ok(copied, "the deploy job still copies with `cp -r ... _site/`");
  const entries = copied[1].trim().split(/\s+/);
  assert.equal(entries.some((e) => e.startsWith("corpus")), false, `the deploy job copies ${entries.join(" ")}`);
  for (const entry of entries) fs.cpSync(path.join(source, entry), path.join(stage, entry), { recursive: true });

  preparePublishedSite(stage, source);

  const published = walk(stage);
  assert.ok(published.includes("index.html"), "the artifact was built");
  assert.deepEqual(published.filter((f) => /(?:^|[\\/])corpus(?:[\\/]|$)/.test(f) || f.includes("private/")), []);
  assert.equal(published.some((f) => fs.readFileSync(path.join(stage, f)).includes(SENTINEL)), false, "no private text in any published file");
});

// ---- what must not be imported --------------------------------------------------------

test("scripts/bh.mts reaches no advisor code and no installed package: the deploy job runs it with no install", () => {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    // `import type` is erased when Node strips types, so it needs nothing at run time.
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^"';]*?from\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) visit(path.resolve(path.dirname(file), spec));
      else packages.add(spec);
    }
  };
  visit(path.join(ROOT, "scripts", "bh.mts"));
  assert.ok(seen.size >= 2, "the walk found bh.mts's local imports");
  assert.deepEqual([...seen].filter((f) => f.includes(`${path.sep}advisor`) || f.includes("sync-posts") || f.includes(`${path.sep}ingest${path.sep}`)), []);
  assert.deepEqual([...packages], []);
});

// ---- leak-check -----------------------------------------------------------------------

// An invented sentence, standing in for a quote.
const QUOTE = "a harbour pilot reads the water before the chart every single morning";
const atlas = (...quotes: string[]) => quotes.map((quote, i) => JSON.stringify({ id: `q${i}`, statement: "s", quote })).join("\n") + "\n";

test("quoteRuns: every run of the leak length, and none across an elision or from a short quote", () => {
  const words = QUOTE.split(" ");
  const runs = quoteRuns(atlas(QUOTE));
  assert.equal(LEAK_RUN_WORDS, 8);
  assert.equal(runs.size, words.length - LEAK_RUN_WORDS + 1);
  assert.ok(runs.has(words.slice(0, 8).join(" ")));
  assert.equal(quoteRuns(atlas(words.slice(0, 7).join(" "))).size, 0, "seven words is not a run");
  for (const elision of ["...", "…", "[...]", "[…]", "[ ... ]"]) {
    const elided = `${words.slice(0, 5).join(" ")} ${elision} ${words.slice(5, 10).join(" ")}`;
    assert.equal(quoteRuns(atlas(elided)).size, 0, `split at ${elision}`);
  }
  assert.equal(quoteRuns("\n\n").size, 0);
  assert.equal(quoteRuns(JSON.stringify({ id: "x" })).size, 0, "an entry with no quote");
});

test("findRuns: catches a copied run through case, curly quotes and markup, and merges overlaps", () => {
  const runs = quoteRuns(atlas("don't read the chart before you read the water"));
  assert.ok(runs.size > 0);
  const hit = (text: string) => findRuns("f", text, runs);
  assert.deepEqual(hit("nothing to see here"), []);
  assert.deepEqual(hit("line one\nDon’t READ the chart before you read the water"), [{ file: "f", line: 2, words: 9 }]);
  assert.equal(hit("<p>don&#39;t <em>read</em> the\nchart before you <strong>read</strong> the&nbsp;water</p>").length, 1);
  assert.deepEqual(hit("don't read the chart before you read"), [], "seven words");
  const twice = hit("don't read the chart before you read the\n\nand then don't read the chart before you read the water");
  assert.deepEqual(twice.map((h) => [h.line, h.words]), [[1, 8], [3, 9]]);
});

test("findRuns: reads attribute values, tags with no prose breaking, and the escapes of JSON and JS", () => {
  const runs = quoteRuns(atlas(QUOTE));
  const words = QUOTE.split(" ").length;
  const hit = (text: string) => findRuns("f", text, runs).map((h) => h.words);
  assert.deepEqual(hit(`<meta name="description" content="${QUOTE}">`), [words], "content=");
  assert.deepEqual(hit(`<img src="x.png" alt="${QUOTE}">`), [words], "alt=");
  assert.deepEqual(hit(`<p>a harbour <a href="https://x.example/y">pilot</a> reads the water before the chart every single morning</p>`), [words], "attributes don't break prose");
  assert.deepEqual(hit(JSON.stringify({ body: QUOTE.replace("before ", "before\n") })), [words], "an escaped line break");
  assert.deepEqual(hit(JSON.stringify({ body: QUOTE }).replaceAll("a", "\\u0061")), [words], "unicode escapes");
  assert.deepEqual(hit(`'${QUOTE.replace("reads", "reads\\'")}'`), [words], "an escaped apostrophe");
  const multiline = findRuns("f", `<p>one</p>\n\n<meta\n content="${QUOTE}">\n`, runs);
  assert.equal(multiline[0].line, 4, "the line of the quote, counting through tags");
});

test("findRuns and quoteRuns survive bad input, and their errors hold no text", () => {
  const runs = quoteRuns(atlas(QUOTE));
  for (const odd of ["&#x110000;", "&#99999999;", "&#xD800;", "&nosuch;", "a < b and c > d", "\\u12", "<"]) assert.deepEqual(findRuns("f", odd, runs), [], odd);
  const secret = "SECRETWORDS here";
  assert.throws(() => quoteRuns(`${secret}\n`), (e: Error) => /line 1 is not valid JSON/.test(e.message) && !e.message.includes("SECRET"));
  assert.throws(() => quoteRuns(`\n${JSON.stringify({ quote: 5 })}\n`), /line 2: quote is not a string/);
});

test("leak-check: skips with no private data; fails on an injected quote; never prints its words", async (t) => {
  const repoRoot = tmp(t);
  const corpusRoot = path.join(repoRoot, "corpus");
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "test@example.com");
  git(repoRoot, "config", "user.name", "Test");
  fs.mkdirSync(corpusRoot);
  fs.writeFileSync(path.join(repoRoot, "clean.md"), "Harbours are full of words, none of them copied here.\n");
  fs.writeFileSync(path.join(repoRoot, "image.bin"), Buffer.from([0, 1, 2, 0]));
  fs.symlinkSync("clean.md", path.join(repoRoot, "alias.md"));
  git(repoRoot, "add", "-A");

  const run = async () => {
    const s = sink();
    return { code: await main(["leak-check"], { corpusRoot, repoRoot, out: s.out }), ...s };
  };
  const skipped = await run();
  assert.equal(skipped.code, 0);
  assert.match(skipped.lines[0], /leak-check skipped/);

  const posts = path.join(dataDir("someone", corpusRoot), "posts");
  fs.mkdirSync(posts, { recursive: true });
  fs.writeFileSync(path.join(dataDir("someone", corpusRoot), "ATLAS.jsonl"), atlas(QUOTE));
  const clean = await run();
  assert.equal(clean.code, 0, clean.errors.join("\n"));
  assert.match(clean.lines[0], /leak-check passed: 1 atlas entries; 1 tracked files/, "the binary and the symlink aren't read");

  const leak = path.join(repoRoot, "leak.html");
  fs.writeFileSync(leak, `<p>intro</p>\n<p>${QUOTE}</p>\n`);
  assert.ok(fs.readFileSync(leak, "utf8").includes(QUOTE), "the fault was injected");

  const untracked = await run();
  assert.equal(untracked.code, 0, "only tracked files count");

  git(repoRoot, "add", "leak.html");
  const caught = await run();
  assert.equal(caught.code, 1);
  assert.match(caught.errors[0], /^leak\.html:2: 12-word run from an atlas quote$/);
  assert.match(caught.errors.at(-1)!, /FAILED: 1 run/);
  const printed = [...caught.lines, ...caught.errors].join("\n");
  for (const word of ["harbour", "pilot", "chart"]) assert.equal(printed.includes(word), false, `printed "${word}"`);

  const result = leakCheck(repoRoot, corpusRoot);
  assert.equal(result.status, "done");
  assert.equal(result.status === "done" && result.hits[0].file, "leak.html");

  // An exception is per file and capped, and a cap of too few words still fails.
  const allowance = { reason: "quoted on purpose" };
  const within = leakCheck(repoRoot, corpusRoot, { "leak.html": { ...allowance, maxWords: 12 } });
  assert.deepEqual(within.status === "done" && [within.hits, within.allowed], [[], [{ file: "leak.html", words: 12, reason: "quoted on purpose" }]]);
  const over = leakCheck(repoRoot, corpusRoot, { "leak.html": { ...allowance, maxWords: 11 } });
  assert.equal(over.status === "done" && over.hits.length, 1, "quoting more than was reviewed fails");
  const other = leakCheck(repoRoot, corpusRoot, { "other.html": { ...allowance, maxWords: 99 } });
  assert.equal(other.status === "done" && other.hits.length, 1, "an exception for one file doesn't cover another");

  // A broken atlas is a failure with a clean message, not a skip or a stack.
  const atlasFile = path.join(dataDir("someone", corpusRoot), "ATLAS.jsonl");
  const goodAtlas = fs.readFileSync(atlasFile, "utf8");
  fs.writeFileSync(atlasFile, "not json at all\n");
  const broken = await run();
  assert.equal(broken.code, 1);
  assert.deepEqual(broken.errors, ["error: ATLAS.jsonl line 1 is not valid JSON"]);
  fs.writeFileSync(atlasFile, goodAtlas);

  // A file in the index but gone from disk is not an error.
  fs.rmSync(leak);
  assert.equal((await run()).code, 0);
});

// ---- leak-check: every private source, and history -------------------------------------

// Invented sentences, one per source, with no word in common beyond the commonest.
const POST = "the lighthouse keeper counted seven gulls before noon and wrote none of them down";
const STATEMENT = "an honest ledger lists the debts that nobody asked about this quarter";
const NEGATIVE = "marmalade should always be spread thickly because moderation is a form of cowardice";
const AUTHORED = "every bridge in this town was built by someone who never crossed it";
const SOURCES: [label: string, text: string][] = [
  ["a post", POST], ["an atlas statement", STATEMENT], ["a voice negative", NEGATIVE], ["an authored sample", AUTHORED],
];
const LABELS: Record<string, string> = { "a post": "post text", "an atlas statement": "an atlas statement", "a voice negative": "a voice negative", "an authored sample": "an authored sample" };

/** A git repo and a corpus, with one invented sentence in each private source. */
function leakFixture(t: TestContext, only: string[] = SOURCES.map(([label]) => label)) {
  const repoRoot = tmp(t);
  const corpusRoot = path.join(repoRoot, "corpus");
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "test@example.com");
  git(repoRoot, "config", "user.name", "Test");
  const dir = dataDir("someone", corpusRoot);
  fs.mkdirSync(path.join(dir, "posts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "evals"));
  if (only.includes("a post")) fs.writeFileSync(path.join(dir, "posts", "blog-day.md"), `---\ntitle: Day\n---\nOpening line.\n\n${POST}.\n`);
  if (only.includes("an atlas statement")) fs.writeFileSync(path.join(dir, "ATLAS.jsonl"), JSON.stringify({ id: "a1", statement: STATEMENT, quote: "short" }) + "\n");
  if (only.includes("a voice negative")) fs.writeFileSync(path.join(dir, "voice_negatives.jsonl"), JSON.stringify({ id: "n1", keep_surface: false, style: "plain", text: NEGATIVE }) + "\n");
  if (only.includes("an authored sample")) fs.writeFileSync(path.join(dir, "evals", "authored.jsonl"), JSON.stringify({ kind: "x", text: AUTHORED, notes: "n" }) + "\n");
  fs.writeFileSync(path.join(repoRoot, "clean.md"), "Nothing from the private data is in this file.\n");
  git(repoRoot, "add", "clean.md");
  const run = async (...args: string[]) => {
    const s = sink();
    return { code: await main(["leak-check", ...args], { corpusRoot, repoRoot, out: s.out }), ...s };
  };
  return { repoRoot, corpusRoot, run };
}

test("leak-check: each private source is compared, a hit names its source, and never prints the words", async (t) => {
  const { repoRoot, corpusRoot, run } = leakFixture(t);
  const clean = await run();
  assert.equal(clean.code, 0, clean.errors.join("\n"));
  assert.match(clean.lines.at(-1)!, /^leak-check passed: 1 atlas entries, 1 voice negatives, 1 authored samples, 1 posts; 1 tracked files$/);

  for (const [label, sentence] of SOURCES) {
    const file = path.join(repoRoot, "copied.html");
    fs.writeFileSync(file, `<p>intro</p>\n<p>${sentence}</p>\n`);
    assert.ok(fs.readFileSync(file, "utf8").includes(sentence), `${label}: the fault was injected`);
    git(repoRoot, "add", "copied.html");
    const caught = await run();
    assert.equal(caught.code, 1, label);
    assert.equal(caught.errors.length, 2, label);
    assert.match(caught.errors[0], new RegExp(`^copied\\.html:2: \\d+-word run from ${LABELS[label]}$`), label);
    const printed = [...caught.lines, ...caught.errors].join("\n");
    for (const word of sentence.split(" ").filter((w) => w.length > 5)) assert.equal(printed.includes(word), false, `${label}: printed "${word}"`);
    assert.equal(leakCheck(repoRoot, corpusRoot).status === "done", true);
    git(repoRoot, "rm", "-qf", "copied.html");
  }
  assert.equal((await run()).code, 0, "clean again once the injected files are gone");
});

test("leak-check: a source can be the only one there, and no sources at all is a skip", async (t) => {
  for (const [label, sentence] of SOURCES) {
    const { repoRoot, run } = leakFixture(t, [label]);
    fs.writeFileSync(path.join(repoRoot, "copied.md"), `${sentence}\n`);
    git(repoRoot, "add", "copied.md");
    assert.equal((await run()).code, 1, `${label} alone is compared`);
  }
  const { run } = leakFixture(t, []);
  const none = await run();
  assert.equal(none.code, 0);
  assert.match(none.lines[0], /^leak-check skipped: no posts, atlas, voice negatives or authored samples/);
});

test("postRuns and jsonlRuns: markdown link targets are not prose, every string counts, errors hold no text", () => {
  const words = POST.split(" ");
  const linked = `${words.slice(0, 4).join(" ")} [${words[4]}](https://x.example/a_(b)/c "t") ${words.slice(5).join(" ")}`;
  assert.deepEqual(postRuns(linked), postRuns(POST), "a link keeps its text and loses its target");
  assert.ok(postRuns(`![alt text](https://x.example/i.png) ${POST}`).has(words.slice(0, 8).join(" ")));
  assert.equal(postRuns("seven words make no run").size, 0);
  assert.deepEqual(postRuns(`don&rsquo;t read the chart before you read the water &amp; more`), postRuns("don't read the chart before you read the water & more"), "entities are decoded as on the page side");

  const nested = JSON.stringify({ a: 1, list: [{ deep: { text: NEGATIVE } }, null, true] });
  assert.equal(jsonlRuns("x.jsonl", nested).size, NEGATIVE.split(" ").length - LEAK_RUN_WORDS + 1, "a string nested in arrays and objects");
  assert.equal(jsonlRuns("x.jsonl", "\n\n").size, 0);
  const secret = "SECRETWORDS here";
  assert.throws(() => jsonlRuns("authored.jsonl", `${secret}\n`), (e: Error) => e.message === "authored.jsonl line 1 is not valid JSON");
  assert.equal(describeSources({ "atlas entries": 3, "voice negatives": 0, "authored samples": 0, posts: 2 }), "3 atlas entries, 2 posts");
});

test("leak-check --history: finds a run in a blob no longer checked out, on any ref, and judges it by its own path", async (t) => {
  const { repoRoot, corpusRoot, run } = leakFixture(t);
  git(repoRoot, "commit", "-qm", "clean");
  const file = path.join(repoRoot, "old.html");
  fs.writeFileSync(file, `<p>intro</p>\n<p>${POST}</p>\n`);
  assert.ok(fs.readFileSync(file, "utf8").includes(POST), "the fault was injected");
  const blob = git(repoRoot, "hash-object", "old.html").trim().slice(0, 7);
  git(repoRoot, "add", "old.html");
  git(repoRoot, "commit", "-qm", "add");
  git(repoRoot, "rm", "-q", "old.html");
  git(repoRoot, "commit", "-qm", "remove");
  assert.equal(fs.existsSync(file), false);

  const tree = await run();
  assert.equal(tree.code, 0, "the current tree is clean");
  const history = await run("--history");
  assert.equal(history.code, 1);
  assert.match(history.errors[0], new RegExp(`^old\\.html@${blob}:2: \\d+-word run from post text$`));
  assert.match(history.errors.at(-1)!, /^leak-check --history FAILED: 1 run\(s\) of 8\+ words in blobs in history$/);
  const printed = [...history.lines, ...history.errors].join("\n");
  for (const word of ["lighthouse", "gulls", "noon"]) assert.equal(printed.includes(word), false, `printed "${word}"`);

  // The blob is judged by its path's allowance, with the same cap as a tracked file.
  const reason = "quoted on purpose";
  const within = leakCheckHistory(repoRoot, corpusRoot, { "old.html": { reason, maxWords: 14 } });
  assert.deepEqual(within.status === "done" && [within.hits, within.allowed], [[], [{ file: "old.html", blob, words: 14, reason }]]);
  const over = leakCheckHistory(repoRoot, corpusRoot, { "old.html": { reason, maxWords: 13 } });
  assert.equal(over.status === "done" && over.hits.length, 1);

  // A blob only on another branch counts too, and a binary doesn't break the scan.
  git(repoRoot, "switch", "-q", "-c", "side");
  fs.writeFileSync(path.join(repoRoot, "side.md"), `${STATEMENT}\n`);
  fs.writeFileSync(path.join(repoRoot, "image.bin"), Buffer.from([0, 1, 2, 0]));
  git(repoRoot, "add", "side.md", "image.bin");
  git(repoRoot, "commit", "-qm", "side");
  git(repoRoot, "switch", "-q", "-");
  assert.equal(fs.existsSync(path.join(repoRoot, "side.md")), false, "the branch is not checked out");
  const other = await run("--history");
  assert.equal(other.code, 1);
  assert.deepEqual(other.errors.slice(0, -1).map((e) => e.replace(/@[0-9a-f]{7}/, "@blob").replace(/\d+-word/, "N-word")).sort(), [
    "old.html@blob:2: N-word run from post text",
    "side.md@blob:1: N-word run from an atlas statement",
  ]);
});

test("leak-check --history: a copy at another path isn't excused by the allowance of the first, and a big blob is counted", async (t) => {
  const { repoRoot, corpusRoot, run } = leakFixture(t);
  const page = `<p>${POST}</p>\n`;
  fs.writeFileSync(path.join(repoRoot, "a-allowed.html"), page);
  fs.writeFileSync(path.join(repoRoot, "z-copy.html"), page);
  assert.ok(fs.readFileSync(path.join(repoRoot, "z-copy.html"), "utf8").includes(POST), "the fault was injected");
  const huge = "x ".repeat(5 * 1024 * 1024) + POST;
  fs.writeFileSync(path.join(repoRoot, "huge.txt"), huge);
  assert.ok(huge.length > 8 * 1024 * 1024 && huge.includes(POST), "the big blob holds the text and is over the limit");
  git(repoRoot, "add", "a-allowed.html", "z-copy.html", "huge.txt");
  git(repoRoot, "commit", "-qm", "two paths");
  git(repoRoot, "rm", "-q", "a-allowed.html", "z-copy.html", "huge.txt");
  git(repoRoot, "commit", "-qm", "remove");
  const reason = "quoted on purpose";
  for (const first of ["a-allowed.html", "z-copy.html"]) {
    const other = first === "a-allowed.html" ? "z-copy.html" : "a-allowed.html";
    const result = leakCheckHistory(repoRoot, corpusRoot, { [first]: { reason, maxWords: 99 } });
    assert.deepEqual(result.status === "done" && result.hits.map((h) => h.file), [other], `only ${first} is allowed`);
    assert.equal(result.status === "done" && result.allowed.length, 1);
    assert.equal(result.status === "done" && result.unread, 1);
  }
  const cli = await run("--history");
  assert.equal(cli.code, 1);
  assert.equal(cli.errors.length, 3, "one line per path, then the summary");
  const allowedBoth = leakCheckHistory(repoRoot, corpusRoot, { "a-allowed.html": { reason, maxWords: 99 }, "z-copy.html": { reason, maxWords: 99 } });
  assert.equal(allowedBoth.status === "done" && allowedBoth.hits.length, 0);
});

test("leak-check: --history belongs to leak-check alone", async () => {
  const s = sink();
  assert.equal(await main(["parity", "--history"], { out: s.out }), 2);
  assert.match(s.errors[0], /--history only applies to leak-check/);
});

test("leak-check --history: passes on a clean history, and skips with no private data", async (t) => {
  const fixture = leakFixture(t);
  git(fixture.repoRoot, "commit", "-qm", "clean");
  const clean = await fixture.run("--history");
  assert.equal(clean.code, 0, clean.errors.join("\n"));
  assert.match(clean.lines.at(-1)!, /^leak-check --history passed: .*; 1 blobs$/);
  const empty = leakFixture(t, []);
  assert.match((await empty.run("--history")).lines[0], /^leak-check --history skipped: /);
});

const SHA = "a".repeat(40), SHA2 = "b".repeat(40), ZERO = "0".repeat(40);

test("parsePushUpdates: reads git's four fields per line and refuses anything else without echoing it", () => {
  assert.deepEqual(parsePushUpdates(`refs/heads/x ${SHA} refs/heads/x ${ZERO}\n\nrefs/heads/y ${ZERO} refs/heads/y ${SHA2}\n`), [
    { localRef: "refs/heads/x", localSha: SHA, remoteRef: "refs/heads/x", remoteSha: ZERO },
    { localRef: "refs/heads/y", localSha: ZERO, remoteRef: "refs/heads/y", remoteSha: SHA2 },
  ]);
  assert.deepEqual(parsePushUpdates(""), []);
  for (const bad of ["refs/heads/x", `refs/heads/x ${SHA} refs/heads/x`, `refs/heads/x nothex refs/heads/x ${ZERO}`]) {
    assert.throws(() => parsePushUpdates(`${bad}\n`), (e: Error) => /^unexpected pre-push input/.test(e.message) && !e.message.includes(bad), bad);
  }
});

test("leak-check --pushed: reads only what the push adds, judges each blob by its path's allowance, and a delete adds nothing", async (t) => {
  const { repoRoot, corpusRoot } = leakFixture(t);
  const head = () => git(repoRoot, "rev-parse", "HEAD").trim();
  git(repoRoot, "commit", "-qm", "clean");
  const base = head();
  fs.writeFileSync(path.join(repoRoot, "old.html"), `<p>${POST}</p>\n`);
  git(repoRoot, "add", "old.html");
  git(repoRoot, "commit", "-qm", "leaky");
  const leaky = head();
  fs.writeFileSync(path.join(repoRoot, "later.md"), "nothing here\n");
  git(repoRoot, "add", "later.md");
  git(repoRoot, "commit", "-qm", "later");
  const tip = head();
  const update = (localSha: string, remoteSha: string) => ({ localRef: "refs/heads/x", localSha, remoteRef: "refs/heads/x", remoteSha });
  const hits = (result: ReturnType<typeof leakCheckPushed>) => (result.status === "done" ? result.hits.map((h) => h.file) : result.status);
  const reason = "quoted on purpose";

  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, base)], "origin", corpusRoot)), ["old.html"], "the range base..tip holds the leak");
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, leaky)], "origin", corpusRoot)), [], "a remote that has the leaky commit is not shown it again");
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, ZERO)], "origin", corpusRoot)), ["old.html"], "a new branch with no tracking refs reads everything reachable");
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(ZERO, tip)], "origin", corpusRoot)), [], "a delete adds nothing");
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [], "origin", corpusRoot)), []);
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, "c".repeat(40))], "origin", corpusRoot)), ["old.html"], "a remote value this clone doesn't have is ignored");
  const allowed = leakCheckPushed(repoRoot, [update(tip, base)], "origin", corpusRoot, { "old.html": { reason, maxWords: 99 } });
  assert.equal(allowed.status === "done" && allowed.hits.length, 0);
  assert.equal(allowed.status === "done" && allowed.allowed.length, 1);

  git(repoRoot, "update-ref", "refs/remotes/origin/main", leaky);
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, ZERO)], "origin", corpusRoot)), [], "the remote's tracking refs are its base");
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, ZERO)], "elsewhere", corpusRoot)), ["old.html"], "another remote's tracking refs are not");
  assert.deepEqual(hits(leakCheckPushed(repoRoot, [update(tip, ZERO)], "*", corpusRoot)), ["old.html"], "a glob is not a remote name");

  const stdin = `refs/heads/x ${tip} refs/heads/x ${base}\n`;
  const s = sink();
  assert.equal(await main(["leak-check", "--pushed", "elsewhere"], { corpusRoot, repoRoot, out: s.out, stdin: () => stdin }), 1);
  assert.match(s.errors[0], /^old\.html@[0-9a-f]{7}:1: \d+-word run from post text$/);
  assert.match(s.errors.at(-1)!, /^leak-check --pushed FAILED: 1 run\(s\) of 8\+ words in blobs this push adds$/);
  const noPrivate = leakFixture(t, []);
  const skipped = sink();
  assert.equal(await main(["leak-check", "--pushed", "origin"], { corpusRoot: path.join(noPrivate.repoRoot, "corpus"), repoRoot: noPrivate.repoRoot, out: skipped.out, stdin: () => "nonsense\n" }), 0, "with no data the input is not even read");
  assert.match(skipped.lines[0], /^leak-check --pushed skipped: /);
  const garbled = sink();
  assert.equal(await main(["leak-check", "--pushed", "origin"], { corpusRoot, repoRoot, out: garbled.out, stdin: () => "nonsense\n" }), 1);
  assert.match(garbled.errors[0], /^error: unexpected pre-push input/);
});

test("leak-check: --pushed belongs to leak-check alone and not with --history", async () => {
  for (const args of [["parity", "--pushed", "origin"], ["leak-check", "--history", "--pushed", "origin"]]) {
    const s = sink();
    assert.equal(await main(args, { out: s.out }), 2, args.join(" "));
  }
});

test("the fixtures hold only made-up writers", () => {
  const readme = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "advisor", "README.md"), "utf8");
  assert.match(readme, /Everything here is invented/);
  const goldens = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "advisor", "goldens.json"), "utf8"));
  assert.ok(goldens.posts.every((p: { author: string }) => p.author === "Wren Talavera"), "the only writer in the goldens is the made-up one");
});
