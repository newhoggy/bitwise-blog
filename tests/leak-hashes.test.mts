// CI's leak check: the blobs a change adds, compared with a committed list of keyed hashes of the private runs.
// See corpus/README.md and docs/leak-check-in-ci.html. All text here is invented, and so is every key: never put
// real corpus text, or a hash of it, in a test.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { main, type Output } from "../scripts/advisor.mts";
import { dataDir, privateDir } from "../scripts/advisor/corpus.mts";
import { findRuns, leakCheckPushed, privateRuns, runsDigest } from "../scripts/advisor/guards.mts";
import {
  LEAK_KEY_ITEM, MIN_ENTRIES, hashListStatus, hashedRuns, leakCheckHashed, leakHashesPath, leakKey, leakStampPath, paddedSize, parseHashList,
  renderHashList, resolveLeakKey, runHash, writeLeakHashes,
} from "../scripts/advisor/leak-hashes.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

// Invented keys, long enough to be accepted.
const KEY = "test-key-0123456789abcdefghijklmnopqrstuvwxyz";
const OTHER_KEY = "another-test-key-zyxwvutsrqponmlkjihgfedcba9876";
// Small lists keep the tests fast; the real floor is MIN_ENTRIES.
const MIN = 64;

// Invented sentences, one per private source.
const QUOTE = "a harbour pilot reads the water before the chart every single morning";
const APOSTROPHE = "the keeper's daughter never trusted a barometer that agreed with her";
const ELIDED = "seven lanterns hung above the quay ... and the ferry left without its bell";
const POST = "the lighthouse keeper counted seven gulls before noon and wrote none of them down";
const LINKED = "she mended [the nets](https://example.com/nets) every evening while the radio played old shipping forecasts";
const STATEMENT = "an honest ledger lists the debts that nobody asked about this quarter";
const NEGATIVE = "marmalade should always be spread thickly because moderation is a form of cowardice";
const AUTHORED = "every bridge in this town was built by someone who never crossed it";
const FIXTURE_WORDS = ["harbour", "barometer", "lanterns", "lighthouse", "radio", "ledger", "marmalade", "bridge"];

const sink = () => {
  const lines: string[] = [], errors: string[] = [];
  const out: Output = { log: (...a) => lines.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) };
  return { out, lines, errors, all: () => [...lines, ...errors].join("\n") };
};

/** A git repo with a corpus holding every kind of private source, and a clean first commit. */
function fixture(t: TestContext) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bh-leak-hashes-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const corpusRoot = path.join(repoRoot, "corpus");
  git(repoRoot, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "test@example.com"], ["user.name", "Test"], ["commit.gpgsign", "false"]]) git(repoRoot, "config", k, v);
  const dir = dataDir("someone", corpusRoot);
  fs.mkdirSync(path.join(dir, "posts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "evals"));
  fs.writeFileSync(path.join(dir, "posts", "blog-day.md"), `---\ntitle: Day\n---\nOpening line.\n\n${POST}.\n\n${LINKED}.\n`);
  fs.writeFileSync(path.join(dir, "ATLAS.jsonl"), [QUOTE, APOSTROPHE, ELIDED].map((quote, i) => JSON.stringify({ id: `q${i}`, statement: i ? "s" : STATEMENT, quote })).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "voice_negatives.jsonl"), JSON.stringify({ id: "n1", text: NEGATIVE }) + "\n");
  fs.writeFileSync(path.join(dir, "evals", "authored.jsonl"), JSON.stringify({ kind: "x", text: AUTHORED }) + "\n");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "corpus/private\nnode_modules\n");
  fs.writeFileSync(path.join(repoRoot, "clean.md"), "Nothing from the private data is in this file.\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-qm", "clean");
  const commit = (files: Record<string, string>, message: string) => {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repoRoot, name)), { recursive: true });
      fs.writeFileSync(path.join(repoRoot, name), text);
      assert.equal(fs.readFileSync(path.join(repoRoot, name), "utf8"), text, "the fault was injected");
    }
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "-qm", message);
    return git(repoRoot, "rev-parse", "HEAD");
  };
  /** CI has no private data: move it out of the checkout, keeping it for the local check. */
  const hidePrivate = () => {
    const away = path.join(repoRoot, "..", `${path.basename(repoRoot)}-private`);
    fs.renameSync(privateDir(corpusRoot), away);
    t.after(() => fs.rmSync(away, { recursive: true, force: true }));
    return away;
  };
  return { repoRoot, corpusRoot, commit, hidePrivate };
}

/** The hashed check, run as CI runs it (no private data). */
async function ci(repoRoot: string, corpusRoot: string, args: string[], env: NodeJS.ProcessEnv) {
  const s = sink();
  const code = await main(["leak-check", "--hashed", ...args], { repoRoot, corpusRoot, env, out: s.out });
  return { code, ...s };
}

test("CI fails on a pull request that adds a run of 8 or more corpus words, and passes on 7", async (t) => {
  const { repoRoot, corpusRoot, commit, hidePrivate } = fixture(t);
  writeLeakHashes(KEY, corpusRoot, MIN);
  const base = commit({}, "the list");
  hidePrivate();
  assert.equal(fs.existsSync(privateDir(corpusRoot)), false, "the check below has no private data, as in CI");
  const env = { BH_LEAK_KEY: KEY };

  const words = QUOTE.split(" ");
  const seven = commit({ "near.html": `<p>intro</p>\n<p>${words.slice(0, 7).join(" ")}</p>\n` }, "seven words");
  const passed = await ci(repoRoot, corpusRoot, ["--head", seven, "--base", base], env);
  assert.equal(passed.code, 0, passed.all());
  assert.match(passed.lines.at(-1)!, /^leak-check --hashed passed: 1 blobs, against corpus\/leak-hashes\.txt$/);

  const eight = commit({ "edge.html": `<p>${words.slice(0, 8).join(" ")}</p>\n` }, "eight words");
  const atEdge = await ci(repoRoot, corpusRoot, ["--head", eight, "--base", seven], env);
  assert.equal(atEdge.code, 1, "eight words is a run");
  assert.match(atEdge.errors[0], /^edge\.html@[0-9a-f]{7}:1: 8-word run from the private data$/);

  const leaky = commit({ "leak.html": `<p>intro</p>\n<p>${QUOTE}</p>\n` }, "leaky");
  const head = commit({ "later.md": "nothing here\n" }, "later");
  const caught = await ci(repoRoot, corpusRoot, ["--head", head, "--base", eight], env);
  assert.equal(caught.code, 1);
  assert.match(caught.errors[0], /^leak\.html@[0-9a-f]{7}:2: 12-word run from the private data$/);
  assert.match(caught.errors.at(-1)!, /^leak-check --hashed FAILED: 1 run\(s\) of 8\+ words in the blobs these commits add\./);
  for (const word of FIXTURE_WORDS) assert.equal(caught.all().toLowerCase().includes(word), false, `printed "${word}"`);

  assert.equal((await ci(repoRoot, corpusRoot, ["--head", head, "--base", leaky], env)).code, 0, "a base that has the leak is not shown it again");
  assert.equal((await ci(repoRoot, corpusRoot, ["--head", head], env)).code, 1, "no base: everything reachable is read");
  assert.equal((await ci(repoRoot, corpusRoot, ["--head", head, "--base", "0".repeat(40)], env)).code, 1, "a zero base (a new branch) reads everything");
  const unknown = await ci(repoRoot, corpusRoot, ["--head", head, "--base", "c".repeat(40)], env);
  assert.equal(unknown.code, 1, "a base this clone doesn't have (a force push) reads everything: more, never less");
  assert.match(unknown.lines[0], /^note: the base is not a commit in this clone/);

  // Under GitHub Actions, each hit is an error annotation on the file, still without the words.
  const annotated = await ci(repoRoot, corpusRoot, ["--head", head, "--base", eight], { ...env, GITHUB_ACTIONS: "true" });
  assert.match(annotated.errors[0], /^::error file=leak\.html,line=2::leak\.html@[0-9a-f]{7}:2: 12-word run from the private data$/);
});

test("CI and the local check read text the same way: equal hits for case, quotes, markup, escapes, elisions and links", async (t) => {
  const { repoRoot, corpusRoot, commit, hidePrivate } = fixture(t);
  writeLeakHashes(KEY, corpusRoot, MIN);
  const base = commit({}, "the list");
  const tricky: Record<string, string> = {
    "case.html": `<h2>A HARBOUR Pilot</h2>\n<p>reads <em>the</em> <a href="#x">water</a>\nbefore the chart every single morning</p>\n`,
    "curly.html": `<p>The keeper’s daughter never trusted a barometer that agreed with her.</p>\n`,
    "entities.html": `<p>the&nbsp;lighthouse keeper counted&#32;seven gulls before noon and wrote none of them&#x20;down</p>\n`,
    "attribute.html": `<img alt="Every bridge in this town was built by someone who never crossed it" src="x.png">\n`,
    "data.json": JSON.stringify({ t: "an honest ledger lists the debts\nthat nobody asked about this quarter", u: "marmalade should always be spread thickly because moderation is a form of cowardice" }) + "\n",
    "escaped.js": `window.X = "the keeper\\u2019s daughter never trusted a barometer that agreed with her";\n`,
    "elided.md": "seven lanterns hung above the quay and the ferry left without its bell\n",
    "linked.md": "She mended the nets every evening while the radio played old shipping forecasts.\n",
    "allowed.html": `<blockquote>${QUOTE}</blockquote>\n`,
    "short.md": "a harbour pilot reads the water before\n",
  };
  const head = commit(tricky, "tricky");
  const allowances = { "allowed.html": { maxWords: 12, reason: "quoted on purpose" } };
  const local = leakCheckPushed(repoRoot, [{ localRef: "refs/heads/x", localSha: head, remoteRef: "refs/heads/x", remoteSha: base }], "origin", corpusRoot, allowances);
  assert.equal(local.status, "done");
  hidePrivate();
  const hashed = leakCheckHashed(repoRoot, head, base, KEY, corpusRoot, allowances);
  assert.equal(hashed.status, "done");
  if (local.status !== "done" || hashed.status !== "done") return;
  const places = (hits: typeof local.hits) => hits.map(({ file, line, words, blob }) => ({ file, line, words, blob })).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  assert.deepEqual(places(hashed.hits), places(local.hits));
  assert.deepEqual(hashed.allowed, local.allowed);
  assert.equal(hashed.files, local.files);
  // The comparison above is only worth something if the local check found the hard cases.
  const found = new Set(local.hits.map((h) => h.file));
  for (const file of ["case.html", "curly.html", "entities.html", "attribute.html", "data.json", "escaped.js", "linked.md"]) assert.ok(found.has(file), `the local check finds ${file}`);
  for (const file of ["elided.md", "short.md", "allowed.html"]) assert.equal(found.has(file), false, `${file} is not a hit`);
  assert.deepEqual(local.allowed.map((a) => a.file), ["allowed.html"]);
  const over = leakCheckHashed(repoRoot, head, base, KEY, corpusRoot, { "allowed.html": { maxWords: 11, reason: "quoted on purpose" } });
  assert.ok(over.status === "done" && over.hits.some((h) => h.file === "allowed.html"), "quoting more than the cap fails in CI too");
});

test("the hashed lookup holds exactly the private runs: the same strings findRuns builds", (t) => {
  const { corpusRoot } = fixture(t);
  const found = privateRuns(corpusRoot)!;
  const key = leakKey(KEY);
  const runs = hashedRuns(parseHashList(renderHashList(found.runs.keys(), key, MIN)), key);
  for (const run of found.runs.keys()) assert.ok(runs.has(run), "every private run is listed");
  const hits = findRuns("x.html", `<p>${POST}</p>`, runs);
  assert.deepEqual(hits.map((h) => [h.line, h.words]), [[1, 14]]);
  assert.equal(runs.has("words that are not in the private data at all"), false);
});

test("CI skips with a visible notice when there is no key, warns when there is no list, and fails on a wrong key or a broken list", async (t) => {
  const { repoRoot, corpusRoot, commit, hidePrivate } = fixture(t);
  const head = git(repoRoot, "rev-parse", "HEAD");
  hidePrivate();

  for (const env of [{}, { BH_LEAK_KEY: "" }, { BH_LEAK_KEY: "  " }]) {
    const skipped = await ci(repoRoot, corpusRoot, ["--head", head], { ...env, GITHUB_ACTIONS: "true" });
    assert.equal(skipped.code, 0, "a fork's pull request has no secrets, and must not fail for it");
    assert.match(skipped.lines[0], /^::notice::leak-check --hashed skipped: no BH_LEAK_KEY secret .*nothing was compared/);
  }
  const plain = await ci(repoRoot, corpusRoot, ["--head", head], {});
  assert.match(plain.lines[0], /^leak-check --hashed skipped: /, "outside Actions it is a plain line");

  const noList = await ci(repoRoot, corpusRoot, ["--head", head], { BH_LEAK_KEY: KEY, GITHUB_ACTIONS: "true" });
  assert.equal(noList.code, 0);
  assert.match(noList.lines[0], /^::warning::leak-check --hashed skipped: BH_LEAK_KEY is set but corpus\/leak-hashes\.txt is not committed/);

  fs.writeFileSync(leakHashesPath(corpusRoot), renderHashList(["one two three four five six seven eight"], leakKey(KEY), MIN));
  const later = commit({}, "the list");
  const wrong = await ci(repoRoot, corpusRoot, ["--head", later], { BH_LEAK_KEY: OTHER_KEY });
  assert.equal(wrong.code, 1, "a key the list wasn't made with would pass everything, so it fails");
  assert.match(wrong.errors[0], /^error: the leak-check key does not match leak-hashes\.txt/);
  const short = await ci(repoRoot, corpusRoot, ["--head", later], { BH_LEAK_KEY: "too-short" });
  assert.equal(short.code, 1);
  assert.match(short.errors[0], /shorter than 32 characters/);
  assert.equal(short.all().includes("too-short"), false, "the key is never printed");
  const badHead = await ci(repoRoot, corpusRoot, ["--head", "no-such-rev"], { BH_LEAK_KEY: KEY });
  assert.equal(badHead.code, 1);
  assert.match(badHead.errors[0], /^error: the head to check is not a commit/);

  fs.appendFileSync(leakHashesPath(corpusRoot), "not a hash at all\n");
  const broken = await ci(repoRoot, corpusRoot, ["--head", later], { BH_LEAK_KEY: KEY });
  assert.equal(broken.code, 1);
  assert.match(broken.errors[0], /^error: leak-hashes\.txt line \d+ is neither a hash nor the key check$/);
});

test("the list: a power of two at least the floor, padded from the key, sorted, and the same each time", () => {
  assert.deepEqual([0, 1, 64, 65, 4096, 4097].map((n) => paddedSize(n, 64)), [64, 64, 64, 128, 4096, 8192]);
  assert.equal(paddedSize(10), MIN_ENTRIES);
  const key = leakKey(KEY);
  const runs = Array.from({ length: 70 }, (_, i) => `run number ${i} of the made up private text here`);
  const text = renderHashList(runs, key, MIN);
  assert.equal(renderHashList([...runs].reverse(), key, MIN), text, "deterministic, whatever the order");
  const list = parseHashList(text);
  assert.equal(list.hashes.size, 128);
  const hashes = text.split("\n").filter((l) => /^[0-9a-f]{16}$/.test(l));
  assert.deepEqual(hashes, [...hashes].sort(), "sorted, so real entries and padding are interleaved");
  for (const run of runs) assert.ok(list.hashes.has(runHash(key, run)));
  assert.notEqual(renderHashList(runs, leakKey(OTHER_KEY), MIN), text, "another key gives another list");
  const body = text.split("\n").filter((l) => !l.startsWith("#"));
  for (const word of ["run", "number", "private"]) assert.equal(body.some((l) => l.includes(word)), false, "no text in the list");
  // One more run changes two lines (the run in, one pad out), not the whole file.
  const grown = new Set(renderHashList([...runs, "one more made up run of eight words"], key, MIN).split("\n"));
  assert.equal(text.split("\n").filter((l) => !grown.has(l)).length, 1);
  for (const bad of ["", "something else\n", "bh-leak-hashes/1\n0123456789abcdef\n"]) assert.throws(() => parseHashList(bad), (e: Error) => !e.message.includes("0123456789abcdef"));
});

test("leak-hashes writes the list and a stamp in the private data, and leak-check says when the list is stale", async (t) => {
  const { repoRoot, corpusRoot } = fixture(t);
  const found = privateRuns(corpusRoot)!;
  const digest = () => runsDigest(privateRuns(corpusRoot)!.runs.keys());
  assert.equal(hashListStatus(digest, corpusRoot), "absent");

  const run = async (args: string[], context: { env?: NodeJS.ProcessEnv; readItem?: (title: string, vault: string) => string } = {}) => {
    const s = sink();
    return { code: await main(args, { repoRoot, corpusRoot, out: s.out, env: {}, ...context }), ...s };
  };
  const noKey = await run(["leak-hashes"], { readItem: () => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); } });
  assert.equal(noKey.code, 1);
  assert.match(noKey.errors[0], /^error: no leak-check key: set BH_LEAK_KEY, or store the key in 1Password as a Password item titled "beautiful-html leak-check key"/);
  let asked = "";
  const fromOp = await run(["leak-hashes"], { readItem: (title, vault) => { asked = `${title}|${vault}`; return `${KEY}\n`; } });
  assert.equal(fromOp.code, 0, fromOp.all());
  assert.equal(asked, `${LEAK_KEY_ITEM}|Private`);
  const made = await run(["leak-hashes"], { env: { BH_LEAK_KEY: KEY } });
  assert.equal(made.code, 0, made.all());
  assert.match(made.lines[0], /^corpus\/leak-hashes\.txt: 4096 entries/);
  const list = fs.readFileSync(leakHashesPath(corpusRoot), "utf8");
  for (const word of FIXTURE_WORDS) assert.equal(list.includes(word), false, `the list holds "${word}"`);
  assert.ok(leakStampPath(corpusRoot).startsWith(privateDir(corpusRoot) + path.sep), "the stamp is in the private data, which git ignores");
  assert.equal(git(repoRoot, "check-ignore", "-q", path.relative(repoRoot, leakStampPath(corpusRoot))), "");
  assert.equal(hashListStatus(digest, corpusRoot), "current");
  assert.ok(parseHashList(list).hashes.size >= found.runs.size);

  git(repoRoot, "add", "corpus/leak-hashes.txt");
  const current = await run(["leak-check"]);
  assert.equal(current.code, 0, current.all());
  assert.equal(current.lines.some((l) => l.startsWith("note:")), false, "a current list gets no note");

  // A new post: the list no longer covers the corpus. Not a failure, a note.
  fs.writeFileSync(path.join(dataDir("someone", corpusRoot), "posts", "blog-new.md"), "---\ntitle: New\n---\nthe tide tables were printed in a font nobody could read at dusk\n");
  assert.equal(hashListStatus(digest, corpusRoot), "stale");
  const stale = await run(["leak-check"]);
  assert.equal(stale.code, 0, stale.all());
  assert.match(stale.lines.at(-1)!, /^note: corpus\/leak-hashes\.txt is stale .*`npm run advisor -- leak-hashes`/);
  await run(["leak-hashes"], { env: { BH_LEAK_KEY: KEY } });
  assert.equal(hashListStatus(digest, corpusRoot), "current");

  // A list that isn't the one the stamp records (another branch's, or edited) is stale too.
  fs.appendFileSync(leakHashesPath(corpusRoot), "0123456789abcdef\n");
  assert.equal(hashListStatus(digest, corpusRoot), "stale");
  fs.rmSync(leakStampPath(corpusRoot));
  assert.equal(hashListStatus(digest, corpusRoot), "unknown");
  assert.match((await run(["leak-check"])).lines.at(-1)!, /^note: can't tell whether corpus\/leak-hashes\.txt is current/);
});

test("the key comes from the environment first, then 1Password, and an error never holds it", () => {
  assert.deepEqual(resolveLeakKey({ env: { BH_LEAK_KEY: ` ${KEY} ` }, readItem: () => assert.fail("not asked") }), { key: KEY });
  assert.deepEqual(resolveLeakKey({ env: { BH_OP_VAULT: "Vault" }, readItem: (_, vault) => (vault === "Vault" ? KEY : "") }), { key: KEY });
  const empty = resolveLeakKey({ env: {}, readItem: () => "" });
  assert.match(empty.error ?? "", /the 1Password item is empty/);
  const locked = resolveLeakKey({ env: {}, readItem: () => { throw Object.assign(new Error("x"), { stderr: "[ERROR] account is locked\nmore" }); } });
  assert.match(locked.error ?? "", /\(1Password: \[ERROR\] account is locked\)/);
});

test("the advisor refuses --hashed, --head and --base out of place", async () => {
  for (const args of [["parity", "--hashed"], ["leak-check", "--hashed", "--history"], ["leak-check", "--hashed", "--pushed", "origin"], ["leak-check", "--head", "HEAD"], ["leak-check", "--base", "HEAD"], ["leak-hashes", "extra"]]) {
    const s = sink();
    assert.equal(await main(args, { out: s.out, env: {} }), 2, args.join(" "));
  }
});

// ---- the workflow ------------------------------------------------------------------------

interface Step { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }
interface Workflow { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, { steps: Step[] }> }
const WORKFLOWS = path.join(ROOT, ".github", "workflows");
const workflow = parse(fs.readFileSync(path.join(WORKFLOWS, "leak-check.yml"), "utf8")) as Workflow;
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const checkStep = steps.find((s) => s.run?.includes("leak-check --hashed"));

test("the workflow runs on pull requests, pushes to main and by hand, reads only, and hands the key to one step", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual((workflow.on["push"] as { branches: string[] }).branches, ["main"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.ok(checkStep, "a step runs leak-check --hashed");
  assert.equal(checkStep.env?.["BH_LEAK_KEY"], "${{ secrets.BH_LEAK_KEY }}");
  assert.deepEqual(steps.filter((s) => JSON.stringify(s).includes("secrets.")), [checkStep], "no other step sees a secret");
  assert.equal(steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["fetch-depth"], 0, "full history, so the base is in the clone");
  // pull_request_target runs with secrets on a fork's code.
  for (const file of fs.readdirSync(WORKFLOWS)) assert.equal(/pull_request_target/.test(fs.readFileSync(path.join(WORKFLOWS, file), "utf8").replace(/#.*$/gm, "")), false, file);
});

/** A copy of the tooling in a fixture repo, so the workflow's own script can run there as CI would. */
function ciCheckout(t: TestContext) {
  const f = fixture(t);
  fs.cpSync(path.join(ROOT, "scripts"), path.join(f.repoRoot, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(f.repoRoot, "package.json"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(f.repoRoot, "node_modules"));
  writeLeakHashes(KEY, f.corpusRoot, MIN);
  const base = f.commit({}, "tooling and the list");
  f.hidePrivate();
  const runStep = (env: Record<string, string>) => spawnSync("sh", ["-c", checkStep!.run!], { cwd: f.repoRoot, encoding: "utf8", env: { PATH: process.env["PATH"], GITHUB_ACTIONS: "true", ...env } });
  return { ...f, base, runStep };
}

test("the workflow's step fails a pull request that adds corpus words, and passes with a notice when the secret is missing", (t) => {
  const { commit, base, runStep } = ciCheckout(t);
  const head = commit({ "docs/leak.html": `<p>intro</p>\n<p>${QUOTE}</p>\n` }, "leaky");
  const pr = { EVENT: "pull_request", PR_HEAD: head, PR_BASE: base, GITHUB_SHA: "unused" };

  const failed = runStep({ ...pr, BH_LEAK_KEY: KEY });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /^::error file=docs\/leak\.html,line=2::docs\/leak\.html@[0-9a-f]{7}:2: 12-word run from the private data$/m);
  assert.match(failed.stderr, /leak-check --hashed FAILED/);
  for (const word of FIXTURE_WORDS) assert.equal((failed.stdout + failed.stderr).toLowerCase().includes(word), false, `printed "${word}"`);

  const fork = runStep({ ...pr, BH_LEAK_KEY: "" });
  assert.equal(fork.status, 0, fork.stdout + fork.stderr);
  assert.match(fork.stdout, /^::notice::leak-check --hashed skipped: no BH_LEAK_KEY secret/m);

  // The push to main that merges it is checked too, from what main had before.
  const push = runStep({ EVENT: "push", GITHUB_SHA: head, BEFORE: base, BH_LEAK_KEY: KEY });
  assert.equal(push.status, 1, push.stdout + push.stderr);
  const first = runStep({ EVENT: "push", GITHUB_SHA: head, BEFORE: "0".repeat(40), BH_LEAK_KEY: KEY });
  assert.equal(first.status, 1, "a first push reads everything");
  const dispatch = runStep({ EVENT: "workflow_dispatch", GITHUB_SHA: base, BH_LEAK_KEY: KEY });
  assert.equal(dispatch.status, 0, dispatch.stdout + dispatch.stderr);
  assert.match(dispatch.stdout, /leak-check --hashed passed: \d+ blobs/);
});
