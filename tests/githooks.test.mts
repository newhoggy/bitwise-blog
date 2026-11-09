// The pre-push hook that runs leak-check, exercised with real pushes. See corpus/README.md.
// All text here is invented; never put real corpus text in a test.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { dataDir } from "../scripts/advisor/corpus.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUOTE = "a harbour pilot reads the water before the chart every single morning";

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { code: r.status, text: `${r.stdout}${r.stderr}`, stdout: r.stdout };
}
function ok(cwd: string, ...args: string[]): string {
  const r = git(cwd, ...args);
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.text}`);
  return r.stdout;
}

/** A throwaway checkout with the real hook and tooling, a bare remote, and `npm run hooks` applied. */
function setup(t: TestContext, { withData }: { withData: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-githooks-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo"), remote = path.join(dir, "remote.git");
  fs.mkdirSync(repo);
  fs.cpSync(path.join(ROOT, ".githooks"), path.join(repo, ".githooks"), { recursive: true });
  fs.cpSync(path.join(ROOT, "scripts"), path.join(repo, "scripts"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(repo, "package.json"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(repo, "node_modules"));
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules\ncorpus/private\n");
  fs.writeFileSync(path.join(repo, "page.html"), "<p>Harbours are full of words, none of them copied here.</p>\n");
  if (withData) {
    const data = dataDir("someone", path.join(repo, "corpus"));
    fs.mkdirSync(path.join(data, "posts"), { recursive: true });
    fs.writeFileSync(path.join(data, "ATLAS.jsonl"), JSON.stringify({ id: "q0", statement: "s", quote: QUOTE }) + "\n");
  }
  ok(dir, "init", "-q", "--bare", "-b", "main", remote);
  ok(repo, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "test@example.com"], ["user.name", "Test"], ["commit.gpgsign", "false"]]) ok(repo, "config", k, v);
  ok(repo, "remote", "add", "origin", remote);
  ok(repo, "add", "-A");
  ok(repo, "commit", "-q", "-m", "first");
  // What `npm run hooks` runs.
  const script = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).scripts.hooks as string;
  assert.equal(script, "git config core.hooksPath .githooks");
  ok(repo, ...script.split(" ").slice(1));
  return { repo, remote, dir };
}

const pushed = (remote: string) => git(remote, "rev-parse", "--verify", "-q", "main").code === 0;

test("the hook is executable in the index and `npm run hooks` enables it", () => {
  const mode = ok(ROOT, "ls-files", "-s", ".githooks/pre-push");
  assert.match(mode, /^100755 /, "git must record the hook as executable, or it silently never runs");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts.hooks, "git config core.hooksPath .githooks");
});

test("pre-push: a push with an injected run is rejected without printing its words, and passes once it is removed", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  fs.writeFileSync(path.join(repo, "leak.html"), `<p>intro</p>\n<p>${QUOTE}</p>\n`);
  assert.ok(fs.readFileSync(path.join(repo, "leak.html"), "utf8").includes(QUOTE), "the fault was injected");
  ok(repo, "add", "leak.html");
  ok(repo, "commit", "-q", "-m", "leaky");

  const blocked = git(repo, "push", "origin", "main");
  assert.notEqual(blocked.code, 0, blocked.text);
  assert.match(blocked.text, /leak\.html@[0-9a-f]{7}:2: 12-word run from an atlas quote/);
  assert.match(blocked.text, /leak-check failed, so the push is blocked/);
  for (const word of ["harbour", "pilot", "chart", "morning"]) assert.equal(blocked.text.toLowerCase().includes(word), false, `printed "${word}"`);
  assert.equal(pushed(remote), false, "nothing reached the remote");

  // Deleting the file in a later commit would not help: the leaky commit would still be pushed. Drop that commit.
  ok(repo, "rm", "-q", "leak.html");
  ok(repo, "commit", "-q", "-m", "remove it");
  const stillBlocked = git(repo, "push", "origin", "main");
  assert.notEqual(stillBlocked.code, 0, "the history still holds the run");
  assert.equal(pushed(remote), false);
  ok(repo, "reset", "-q", "--hard", "HEAD~2");
  const passed = git(repo, "push", "origin", "main");
  assert.equal(passed.code, 0, passed.text);
  assert.match(passed.text, /leak-check --pushed passed/);
  assert.equal(pushed(remote), true);
});

test("pre-push: --no-verify is the documented way round", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  fs.writeFileSync(path.join(repo, "leak.html"), `<p>${QUOTE}</p>\n`);
  ok(repo, "add", "leak.html");
  ok(repo, "commit", "-q", "-m", "leaky");
  assert.equal(git(repo, "push", "--no-verify", "origin", "main").code, 0);
  assert.equal(pushed(remote), true);
});

test("pre-push: a checkout with no private data is not blocked and is told the check did not run", (t) => {
  const { repo, remote } = setup(t, { withData: false });
  fs.writeFileSync(path.join(repo, "leak.html"), `<p>${QUOTE}</p>\n`);
  ok(repo, "add", "leak.html");
  ok(repo, "commit", "-q", "-m", "would leak, if there were data to know it");
  const r = git(repo, "push", "origin", "main");
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /leak-check --pushed skipped: .*Nothing was checked; `npm run advisor -- link <path>`/);
  assert.equal(pushed(remote), true);
});

test("pre-push: a linked worktree shares the setting and runs the hook against its own files", (t) => {
  const { repo, remote, dir } = setup(t, { withData: true });
  const wt = path.join(dir, "wt");
  ok(repo, "worktree", "add", "-q", "-b", "feature", wt);
  // Worktrees don't share ignored files, so link the data and node_modules as a person would.
  fs.mkdirSync(path.join(wt, "corpus"), { recursive: true });
  fs.symlinkSync(path.join(repo, "corpus", "private"), path.join(wt, "corpus", "private"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(wt, "node_modules"));
  assert.equal(ok(wt, "config", "core.hooksPath").trim(), ".githooks");

  fs.writeFileSync(path.join(wt, "leak.html"), `<p>${QUOTE}</p>\n`);
  ok(wt, "add", "leak.html");
  ok(wt, "commit", "-q", "-m", "leaky");
  const blocked = git(wt, "push", "origin", "feature");
  assert.notEqual(blocked.code, 0, blocked.text);
  assert.match(blocked.text, /leak\.html@[0-9a-f]{7}:1: 12-word run/);
  assert.equal(git(remote, "rev-parse", "--verify", "-q", "feature").code === 0, false);
});

const branchPushed = (remote: string, branch: string) => git(remote, "rev-parse", "--verify", "-q", branch).code === 0;

/** Commit a file holding the quote on a new branch, leaving `back` checked out. Returns the file's blob id. */
function leakyBranch(repo: string, branch: string, back: string): string {
  ok(repo, "switch", "-q", "-c", branch);
  fs.writeFileSync(path.join(repo, "leak.html"), `<p>intro</p>\n<p>${QUOTE}</p>\n`);
  assert.ok(fs.readFileSync(path.join(repo, "leak.html"), "utf8").includes(QUOTE), "the fault was injected");
  ok(repo, "add", "leak.html");
  ok(repo, "commit", "-q", "-m", "leaky");
  ok(repo, "switch", "-q", back);
  return ok(repo, "rev-parse", "--short=7", `${branch}:leak.html`).trim();
}

test("pre-push: a branch that is not checked out is scanned, and rejected while a clean branch is open", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  const blob = leakyBranch(repo, "leaky", "main");
  assert.equal(fs.existsSync(path.join(repo, "leak.html")), false, "the working tree is clean");

  const blocked = git(repo, "push", "origin", "leaky");
  assert.notEqual(blocked.code, 0, blocked.text);
  assert.match(blocked.text, new RegExp(`leak\\.html@${blob}:2: 12-word run from an atlas quote`));
  for (const word of ["harbour", "pilot", "chart", "morning"]) assert.equal(blocked.text.toLowerCase().includes(word), false, `printed "${word}"`);
  assert.equal(branchPushed(remote, "leaky"), false, "nothing reached the remote");
});

test("pre-push: a leaky file in the working tree does not block pushing a clean branch", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  leakyBranch(repo, "leaky", "leaky");
  assert.ok(fs.readFileSync(path.join(repo, "leak.html"), "utf8").includes(QUOTE), "the leaky file is checked out");
  const r = git(repo, "push", "origin", "main");
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /leak-check --pushed passed/);
  assert.equal(branchPushed(remote, "main"), true);
  assert.equal(branchPushed(remote, "leaky"), false);
});

test("pre-push: a delete, and a ref with nothing new, are not blocked by a leaky checkout", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  assert.equal(git(repo, "push", "origin", "main").code, 0);
  leakyBranch(repo, "leaky", "leaky");
  const dup = git(repo, "push", "origin", "main:copy");
  assert.equal(dup.code, 0, dup.text);
  assert.equal(branchPushed(remote, "copy"), true, "a new ref at a commit the remote has");
  const deleted = git(repo, "push", "origin", "--delete", "copy");
  assert.equal(deleted.code, 0, deleted.text);
  assert.equal(branchPushed(remote, "copy"), false);
  assert.equal(git(repo, "push", "origin", "main").code, 0, "up to date");
});

test("pre-push: only what the push adds is read, so text the remote already has does not block a clean follow-up", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  leakyBranch(repo, "leaky", "main");
  ok(repo, "switch", "-q", "leaky");
  assert.equal(git(repo, "push", "--no-verify", "origin", "leaky").code, 0);
  fs.writeFileSync(path.join(repo, "other.html"), "<p>Nothing from the corpus.</p>\n");
  ok(repo, "add", "other.html");
  ok(repo, "commit", "-q", "-m", "clean follow-up");
  const r = git(repo, "push", "origin", "leaky");
  assert.equal(r.code, 0, r.text);
  assert.equal(git(remote, "log", "--format=%s", "-1", "leaky").stdout.trim(), "clean follow-up");

  // A new branch from that point is still judged by what it adds over the remote's refs.
  ok(repo, "switch", "-q", "-c", "more");
  fs.writeFileSync(path.join(repo, "copy.html"), `<p>${QUOTE}</p>\n`);
  ok(repo, "add", "copy.html");
  ok(repo, "commit", "-q", "-m", "a second copy");
  const blocked = git(repo, "push", "origin", "more");
  assert.notEqual(blocked.code, 0, blocked.text);
  assert.match(blocked.text, /copy\.html@[0-9a-f]{7}:1: 12-word run/);
  assert.doesNotMatch(blocked.text, /leak\.html/);
});

test("pre-push: every ref in one push is scanned, and a merge's own blobs are", (t) => {
  const { repo, remote } = setup(t, { withData: true });
  assert.equal(git(repo, "push", "origin", "main").code, 0);
  ok(repo, "switch", "-q", "-c", "left");
  fs.writeFileSync(path.join(repo, "a.html"), "<p>clean</p>\n");
  ok(repo, "add", "a.html");
  ok(repo, "commit", "-q", "-m", "left");
  ok(repo, "switch", "-q", "main");
  leakyBranch(repo, "right", "main");
  const both = git(repo, "push", "origin", "left", "right");
  assert.notEqual(both.code, 0, both.text);
  assert.equal(branchPushed(remote, "left"), false, "the push is refused as a whole");
  assert.equal(git(repo, "push", "origin", "left").code, 0);

  // Merging the clean branch into the leaky one leaves the leak on the pushed side only.
  ok(repo, "switch", "-q", "right");
  ok(repo, "merge", "-q", "--no-edit", "left");
  const merged = git(repo, "push", "origin", "right");
  assert.notEqual(merged.code, 0, merged.text);
  assert.match(merged.text, /leak\.html@[0-9a-f]{7}:2: 12-word run/);
  assert.doesNotMatch(merged.text, /a\.html/, "the clean branch's blob was already on the remote");
});
