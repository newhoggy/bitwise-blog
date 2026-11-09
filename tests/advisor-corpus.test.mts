// The corpus layer and the `npm run advisor` commands, against a made-up writer. The expected values
// in goldens.json came from the Python code; see tests/fixtures/advisor/README.md.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { main, type Output } from "../scripts/advisor.mts";
import {
  CORPUS_DIR, EARLY_ERA, LATE_ERA, atlasEligible, atlasPosts, dataDir, eraOf, evalPosts, inAtlas, isEval, loadMeta, loadPosts, markdownFiles, parsePost, parsePostText,
  privateDir, renderMeta, validate, writeMeta,
} from "../scripts/advisor/corpus.mts";
import { applyHoldout, computeHoldout } from "../scripts/advisor/holdout.mts";
import { buildIndexes, renderLibraryIndex, renderThoughtsIndex, renderWriterIndex, writers } from "../scripts/advisor/index.mts";
import { PyDate, PyFloat, pyYamlDump } from "../scripts/advisor/py-compat.mts";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(ROOT, "fixtures", "advisor");
const goldens = JSON.parse(fs.readFileSync(path.join(FIXTURES, "goldens.json"), "utf8"));
const WREN = "wren-talavera";

function tmp(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-advisor-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** A writable copy of the made-up corpus; returns its corpusRoot. */
function copyOfFixtures(t: TestContext): string {
  const root = tmp(t);
  fs.cpSync(path.join(FIXTURES, "private"), privateDir(root), { recursive: true });
  return root;
}
const sink = () => {
  const lines: string[] = [], errors: string[] = [];
  const out: Output = { log: (...a) => lines.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) };
  return { out, lines, errors };
};
function untag(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(untag);
  if (value !== null && typeof value === "object") {
    const map = value as Record<string, unknown>;
    if (typeof map.$float === "string") return new PyFloat(Number(map.$float));
    if (typeof map.$date === "string") return new PyDate(map.$date);
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, untag(v)]));
  }
  return value;
}
const scriptName = (text: string) => text.replaceAll("`scripts/build_index.py`", "`npm run advisor -- index`");

// ---- dataDir --------------------------------------------------------------------------

test("dataDir: everything derived from a writer's text is under corpus/private", () => {
  assert.equal(dataDir("someone"), path.join(CORPUS_DIR, "private", "someone"));
  assert.equal(dataDir("someone", "/x"), path.join("/x", "private", "someone"));
});

// ---- posts ----------------------------------------------------------------------------

test("eraOf: the boundary, and what Python's int() accepts", () => {
  assert.equal(eraOf("2023-12-31"), EARLY_ERA);
  assert.equal(eraOf("2024-01-01"), LATE_ERA);
  for (const { published, era } of goldens.era_of) assert.equal(eraOf(published), era, published);
  assert.ok(goldens.era_of_bad.length >= 3);
  for (const { published, problem } of goldens.era_of_bad) assert.throws(() => eraOf(published), { message: problem });
});

test("parsePostText reads frontmatter as parse_post does", () => {
  assert.ok(goldens.parse_post.length >= 17);
  for (const { text, fm, body, raises } of goldens.parse_post) {
    if (raises) {
      // These crash the Python tool (a KeyError or AttributeError on odd frontmatter). Reading them is an improvement.
      assert.doesNotThrow(() => parsePostText(text), JSON.stringify(text));
      continue;
    }
    assert.deepEqual(parsePostText(text), [untag(fm), body], JSON.stringify(text));
  }
});

test("parsePost reads text with universal newlines", (t) => {
  const file = path.join(tmp(t), "crlf.md");
  fs.writeFileSync(file, "---\r\ntitle: Crlf\r\n---\r\nB\r\nC\rD\n");
  assert.deepEqual(parsePost(file), [goldens.parse_post_crlf.fm, goldens.parse_post_crlf.body]);
});

test("loadPosts gives the same posts in the same order as load_posts", () => {
  const posts = loadPosts(WREN, FIXTURES);
  assert.equal(posts.length, 14);
  assert.deepEqual(
    posts.map((p) => ({
      stem: p.stem, title: p.title, author: p.author, source: p.source, published: p.published, platform: p.platform, body: p.body, meta: p.meta,
      era: eraOf(p.published), atlas_eligible: atlasEligible(p), is_eval: isEval(p), in_atlas: inAtlas(p),
    })),
    goldens.posts,
  );
  assert.deepEqual(
    loadPosts("ash-mercer", FIXTURES).map((p) => ({ stem: p.stem, title: p.title, published: p.published, meta: p.meta, in_atlas: inAtlas(p) })),
    goldens.no_sidecar_posts,
    "with no sidecar, every post defaults to the atlas",
  );
});

test("markdownFiles sorts by name with its suffix, not by stem", (t) => {
  const dir = tmp(t);
  for (const name of ["a.md", "a-b.md", "notes.txt"]) fs.writeFileSync(path.join(dir, name), "");
  assert.deepEqual(markdownFiles(dir).map((f) => path.basename(f)), ["a-b.md", "a.md"], "'-' sorts before '.'");
  assert.deepEqual(markdownFiles(path.join(dir, "nope")), []);
});

test("loadPosts of a writer with nothing on disk is empty", (t) => {
  assert.deepEqual(loadPosts("nobody", tmp(t)), []);
  assert.deepEqual(validate("nobody", tmp(t)), []);
});

// ---- metadata -------------------------------------------------------------------------

test("validate reports what the Python code reports", (t) => {
  assert.ok(goldens.validate.length >= 14);
  const root = copyOfFixtures(t);
  const base = loadMeta(WREN, root);
  const write = (posts: Record<string, unknown>) => fs.writeFileSync(path.join(dataDir(WREN, root), "corpus_meta.yaml"), pyYamlDump({ posts }));
  assert.deepEqual(validate(WREN, root), [], "the fixture itself is consistent");
  let flagged = 0;
  for (const { entry, problems } of goldens.validate) {
    write({ ...base, "substack-pilot-boats": entry });
    assert.deepEqual(validate(WREN, root), problems, JSON.stringify(entry));
    if (problems.length) flagged++;
  }
  assert.ok(flagged >= 10, "the cases exercise real problems");
  const { "substack-pilot-boats": _dropped, ...rest } = base;
  write({ ...rest, ghost: { atlas: "include" } });
  assert.deepEqual(validate(WREN, root), goldens.validate_orphans);
});

test("renderMeta keeps the header, and the file round-trips", (t) => {
  const root = copyOfFixtures(t);
  const file = path.join(dataDir(WREN, root), "corpus_meta.yaml");
  const before = fs.readFileSync(file, "utf8");
  writeMeta(WREN, loadMeta(WREN, root), root);
  assert.equal(fs.readFileSync(file, "utf8"), before, "byte-stable");
  assert.ok(before.startsWith("# Corpus metadata"), "the fixture has a header to keep");
  assert.equal(renderMeta({ p: { atlas: "include" } }, "# one\n\n# two\nposts: {}\n"), "# one\n\n# two\nposts:\n  p:\n    atlas: include\n");
  assert.equal(renderMeta({ p: {} }, "# only header"), "# only header\nposts:\n  p: {}\n");
  assert.equal(renderMeta({ p: {} }, "posts: {}\n"), "posts:\n  p: {}\n");
  assert.equal(renderMeta({ p: {} }, null), "posts:\n  p: {}\n");
});

// ---- holdout --------------------------------------------------------------------------

test("computeHoldout picks the same stems as compute_holdout", () => {
  const posts = loadPosts(WREN, FIXTURES);
  assert.ok(goldens.holdout.length >= 7);
  assert.ok(new Set(goldens.holdout.map((h: { chosen: string[] }) => h.chosen.join())).size >= 4, "the cases aren't all the same selection");
  for (const { fraction, seed, chosen } of goldens.holdout) {
    assert.deepEqual([...computeHoldout(posts, fraction, seed)].sort(), [...chosen].sort(), `fraction ${fraction}, seed ${seed}`);
  }
});

test("computeHoldout never holds out an excluded post", () => {
  const posts = loadPosts(WREN, FIXTURES);
  const excluded = posts.filter((p) => !atlasEligible(p)).map((p) => p.stem);
  assert.ok(excluded.length >= 2);
  const chosen = computeHoldout(posts, 0.9, 4);
  for (const stem of excluded) assert.equal(chosen.has(stem), false, stem);
});

test("applyHoldout sets split on exactly the chosen stems", () => {
  const meta = { a: { atlas: "include", split: "eval" }, b: { atlas: "include" }, c: null };
  assert.deepEqual(applyHoldout(meta, new Set(["b"])), { a: { atlas: "include" }, b: { atlas: "include", split: "eval" }, c: {} });
});

test("holdout: refuses bad input, writes, then checks; output matches make_holdout's file", async (t) => {
  const corpusRoot = copyOfFixtures(t);
  const run = async (...argv: string[]) => {
    const s = sink();
    return { code: await main(argv, { corpusRoot, out: s.out }), ...s };
  };
  const stale = await run("holdout", WREN, "--check", "--fraction", "0.34", "--seed", "1");
  assert.equal(stale.code, 1);
  assert.match(stale.errors[0], /holdout is stale/);

  const written = await run("holdout", WREN, "--fraction", "0.34", "--seed", "1");
  assert.equal(written.code, 0);
  assert.deepEqual(written.lines, [`${WREN}: 4 of 12 atlas-eligible posts held out for eval`]);
  assert.equal(fs.readFileSync(path.join(dataDir(WREN, corpusRoot), "corpus_meta.yaml"), "utf8"), goldens.written_meta, "byte for byte");
  assert.deepEqual(evalPosts(WREN, corpusRoot).map((p) => p.stem), goldens.after_holdout.eval);
  assert.deepEqual(atlasPosts(WREN, corpusRoot).map((p) => p.stem), goldens.after_holdout.atlas);

  const current = await run("holdout", WREN, "--check", "--fraction", "0.34", "--seed", "1");
  assert.equal(current.code, 0);
  assert.deepEqual(current.lines, [`${WREN}: holdout up to date (4 eval posts)`]);

  for (const fraction of ["0", "-0.1", "1", "1.5", "abc"]) assert.equal((await run("holdout", WREN, "--fraction", fraction)).code, 2, fraction);
  assert.equal((await run("holdout", WREN, "--seed", "x")).code, 2);
  assert.equal((await run("holdout")).code, 2);

  const missing = await run("holdout", "ash-mercer");
  assert.equal(missing.code, 1);
  assert.match(missing.errors[0], /no corpus_meta\.yaml for ash-mercer/);

  fs.appendFileSync(path.join(dataDir(WREN, corpusRoot), "corpus_meta.yaml"), "  ghost:\n    atlas: include\n");
  const inconsistent = await run("holdout", WREN);
  assert.equal(inconsistent.code, 1);
  assert.match(inconsistent.errors[0], /inconsistent:\n {2}ghost: metadata entry has no post/);
});

// ---- index ----------------------------------------------------------------------------

test("the rendered indexes match build_index.py, apart from the script name", (t) => {
  // The goldens were taken with this holdout in place, so the Corpus column has every kind of cell.
  const root = copyOfFixtures(t);
  const posts = loadPosts(WREN, root);
  writeMeta(WREN, applyHoldout(loadMeta(WREN, root), computeHoldout(posts, 0.34, 1)), root);
  assert.equal(renderWriterIndex(WREN, root), scriptName(goldens.index["wren-talavera"]));
  assert.equal(renderWriterIndex("ash-mercer", FIXTURES), scriptName(goldens.index["ash-mercer"]));
  assert.equal(renderThoughtsIndex(FIXTURES), scriptName(goldens.index.thoughts));
  assert.equal(renderLibraryIndex(FIXTURES), scriptName(goldens.index.library));
  assert.equal(renderWriterIndex("nobody", FIXTURES), null);
});

test("index: unparseable frontmatter falls back to the stem, as build_index.py's parser does", () => {
  assert.match(renderWriterIndex(WREN, FIXTURES)!, /\[substack-unquoted-colon\]\(posts\/substack-unquoted-colon\.md\)/);
  assert.equal(loadPosts(WREN, FIXTURES).find((p) => p.stem === "substack-unquoted-colon")!.title, "Tides: the short version", "parse_post's fallback does better");
});

test("index: empty thoughts and library name the commands that fill them", (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(privateDir(root), "thoughts"), { recursive: true });
  fs.mkdirSync(path.join(privateDir(root), "library"));
  assert.match(renderThoughtsIndex(root)!, /_0 topic\(s\)[\s\S]*npm run advisor -- thought/);
  assert.match(renderLibraryIndex(root)!, /_0 source\(s\)[\s\S]*npm run advisor -- source/);
});

test("index: writes each catalogue, or one writer's; fails when there is nothing to index", async (t) => {
  const corpusRoot = copyOfFixtures(t);
  assert.deepEqual(writers(corpusRoot), ["ash-mercer", WREN]);
  const one = sink();
  assert.equal(await main(["index", WREN], { corpusRoot, out: one.out }), 0);
  assert.deepEqual(one.lines, [`${WREN}: INDEX.md written`]);
  assert.equal(fs.existsSync(path.join(dataDir("ash-mercer", corpusRoot), "INDEX.md")), false);

  const all = sink();
  assert.equal(await main(["index"], { corpusRoot, out: all.out }), 0);
  assert.equal(all.lines.length, 4);
  assert.equal(fs.readFileSync(path.join(privateDir(corpusRoot), "library", "INDEX.md"), "utf8"), scriptName(goldens.index.library));
  assert.deepEqual(buildIndexes("nobody", corpusRoot), []);

  const none = sink();
  assert.equal(await main(["index"], { corpusRoot: tmp(t), out: none.out }), 1);
  assert.match(none.errors[0], /is corpus\/private linked/);
  assert.equal(await main(["index", "nobody"], { corpusRoot, out: sink().out }), 1);
  assert.equal(await main(["index", "a", "b"], { corpusRoot, out: sink().out }), 2);
});

// ---- link -----------------------------------------------------------------------------

test("link: makes the symlink, is idempotent, and refuses what it could lose", async (t) => {
  const repoRoot = tmp(t);
  const corpusRoot = path.join(repoRoot, "corpus");
  const data = copyOfFixtures(t);
  const other = tmp(t);
  const run = async (...argv: string[]) => {
    const s = sink();
    return { code: await main(["link", ...argv], { corpusRoot, repoRoot, out: s.out }), ...s };
  };
  const target = privateDir(data);
  const made = await run(target);
  assert.equal(made.code, 0);
  assert.match(made.lines[0], /writers: ash-mercer, wren-talavera/);
  assert.ok(fs.lstatSync(privateDir(corpusRoot)).isSymbolicLink());
  assert.equal(loadPosts(WREN, corpusRoot).length, 14, "tools read through the link");

  const again = await run(target);
  assert.equal(again.code, 0);
  assert.match(again.lines[0], /already points at/);

  const elsewhere = await run(other);
  assert.equal(elsewhere.code, 1);
  assert.match(elsewhere.errors[0], /--force/);
  assert.equal(fs.realpathSync(privateDir(corpusRoot)), fs.realpathSync(target), "still linked to the first");
  assert.equal((await run(other, "--force")).code, 0);
  assert.equal(fs.realpathSync(privateDir(corpusRoot)), fs.realpathSync(other));

  assert.match((await run(path.join(other, "nope"))).errors[0], /not a directory/);
  fs.mkdirSync(path.join(repoRoot, "inside"));
  assert.match((await run(path.join(repoRoot, "inside"))).errors[0], /inside this repository/);
  assert.equal((await run()).code, 2);

  fs.unlinkSync(privateDir(corpusRoot));
  fs.mkdirSync(path.join(privateDir(corpusRoot), "someone", "posts"), { recursive: true });
  const occupied = await run(target);
  assert.equal(occupied.code, 1);
  assert.match(occupied.errors[0], /not an empty directory/);
  assert.ok(fs.existsSync(path.join(privateDir(corpusRoot), "someone", "posts")), "what was there is untouched");

  fs.rmSync(path.join(privateDir(corpusRoot), "someone"), { recursive: true });
  assert.equal((await run(target)).code, 0, "an empty directory is replaced");
  assert.ok(fs.lstatSync(privateDir(corpusRoot)).isSymbolicLink());
});

// ---- parity ---------------------------------------------------------------------------

test("parity: skips cleanly with no private data", async (t) => {
  const s = sink();
  assert.equal(await main(["parity"], { corpusRoot: tmp(t), repoRoot: tmp(t), out: s.out }), 0);
  assert.match(s.lines[0], /parity skipped/);
});

test("parity: passes on data that matches the reference, and fails on data that doesn't", async (t) => {
  const corpusRoot = copyOfFixtures(t);
  const repoRoot = tmp(t);
  execFileSync("git", ["init", "-q", repoRoot]);
  const dir = dataDir(WREN, corpusRoot);
  // The reference and the index are the Python code's, from the goldens.
  const { chosen } = goldens.holdout.find((h: { fraction: number; seed: number }) => h.fraction === 0.15 && h.seed === 6);
  fs.mkdirSync(path.join(dir, "parity"));
  fs.writeFileSync(path.join(dir, "parity", "posts.json"), JSON.stringify({
    commit: goldens.commit,
    holdout: chosen,
    posts: goldens.posts.map((p: Record<string, any>) => ({
      stem: p.stem, title: p.title, author: p.author, source: p.source, published: p.published, platform: p.platform,
      meta: chosen.includes(p.stem) ? { ...p.meta, split: "eval" } : p.meta,
      body_sha256: crypto.createHash("sha256").update(p.body).digest("hex"),
    })),
  }));
  writeMeta(WREN, applyHoldout(loadMeta(WREN, corpusRoot), new Set(chosen)), corpusRoot);
  fs.writeFileSync(path.join(dir, "INDEX.md"), renderWriterIndex(WREN, corpusRoot)!.replace("`npm run advisor -- index`", "`scripts/build_index.py`"));

  const run = async () => {
    const s = sink();
    return { code: await main(["parity"], { corpusRoot, repoRoot, out: s.out }), ...s };
  };
  const clean = await run();
  assert.equal(clean.code, 0, clean.lines.join("\n"));
  for (const check of ["Posts", "Holdout", "INDEX.md", "corpus_meta.yaml"]) assert.match(clean.lines.join("\n"), new RegExp(`PASS +${WREN} +${check}`));
  assert.match(clean.lines.join("\n"), /PENDING .*Stance model .*Phase 7/);

  const postFile = path.join(dir, "posts", "lesswrong-fog-signals.md");
  const original = fs.readFileSync(postFile, "utf8");
  const changed = original.replace("harbour pilot", "harbor pilot");
  assert.notEqual(changed, original, "the fault was injected");
  fs.writeFileSync(postFile, changed);
  const drifted = await run();
  assert.equal(drifted.code, 1);
  assert.match(drifted.lines.join("\n"), /FAIL +wren-talavera +Posts .*lesswrong-fog-signals/);
  fs.writeFileSync(postFile, original);

  const indexFile = path.join(dir, "INDEX.md");
  fs.appendFileSync(indexFile, "| extra row |\n");
  assert.match((await run()).lines.join("\n"), /FAIL +wren-talavera +INDEX\.md/);
});

// ---- the command line -----------------------------------------------------------------

test("advisor: unknown or missing commands print usage and exit 2", async () => {
  for (const argv of [[], ["nope"], ["--nope"], ["leak-check", "x"], ["parity", "x"]]) {
    const s = sink();
    assert.equal(await main(argv, { out: s.out }), 2, JSON.stringify(argv));
    assert.match(s.errors.join("\n"), /usage: npm run advisor/);
  }
});
