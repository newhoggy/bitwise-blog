// The rule that nothing derived from a writer's text is committed or published, as tests. It must
// hold every time, so a person remembering it isn't enough. See corpus/README.md.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { main, type Output } from "../scripts/advisor.mts";
import { dataDir } from "../scripts/advisor/corpus.mts";
import { LEAK_RUN_WORDS, findRuns, leakCheck, quoteRuns } from "../scripts/advisor/guards.mts";
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
  for (const entry of ["scripts", "theme", "docs", "reviews", "corpus", "package.json", "index.html", "feed.xml"]) {
    fs.cpSync(path.join(ROOT, entry), path.join(source, entry), { recursive: true, verbatimSymlinks: true, filter: (f) => path.basename(f) !== "private" });
  }
  const privateFile = path.join(source, "corpus", "private", "someone", "ATLAS.jsonl");
  fs.mkdirSync(path.dirname(privateFile), { recursive: true });
  fs.writeFileSync(privateFile, `{"quote": "${SENTINEL}"}\n`);

  // Copy what the workflow copies: its own list, read from the workflow, so changing it fails here.
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  const copied = workflow.match(/^\s*cp -r (.+) _site\/\s*$/m);
  assert.ok(copied, "pages.yml still copies with `cp -r ... _site/`");
  const entries = copied[1].trim().split(/\s+/);
  assert.equal(entries.some((e) => e.startsWith("corpus")), false, `pages.yml copies ${entries.join(" ")}`);
  for (const entry of entries) fs.cpSync(path.join(source, entry), path.join(stage, entry), { recursive: true });

  preparePublishedSite(stage, source);

  const published = walk(stage);
  assert.ok(published.includes("index.html"), "the artifact was built");
  assert.deepEqual(published.filter((f) => /(?:^|[\\/])corpus(?:[\\/]|$)/.test(f) || f.includes("private/")), []);
  assert.equal(published.some((f) => fs.readFileSync(path.join(stage, f)).includes(SENTINEL)), false, "no private text in any published file");
});

// ---- what must not be imported --------------------------------------------------------

test("scripts/bh.mts reaches no advisor code and no installed package: pages.yml runs it with no install", () => {
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
  assert.match(clean.lines[0], /leak-check passed: 1 quotes, 1 tracked files/, "the binary and the symlink aren't read");

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

test("the fixtures hold only made-up writers", () => {
  const readme = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "advisor", "README.md"), "utf8");
  assert.match(readme, /Everything here is invented/);
  const goldens = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "advisor", "goldens.json"), "utf8"));
  assert.ok(goldens.posts.every((p: { author: string }) => p.author === "Wren Talavera"), "the only writer in the goldens is the made-up one");
});
