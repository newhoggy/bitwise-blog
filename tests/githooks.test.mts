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
  assert.match(blocked.text, /leak\.html:2: 12-word run from an atlas quote/);
  assert.match(blocked.text, /leak-check failed, so the push is blocked/);
  for (const word of ["harbour", "pilot", "chart", "morning"]) assert.equal(blocked.text.toLowerCase().includes(word), false, `printed "${word}"`);
  assert.equal(pushed(remote), false, "nothing reached the remote");

  ok(repo, "rm", "-q", "leak.html");
  ok(repo, "commit", "-q", "-m", "remove it");
  const passed = git(repo, "push", "origin", "main");
  assert.equal(passed.code, 0, passed.text);
  assert.match(passed.text, /leak-check passed/);
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
  assert.match(r.text, /leak-check skipped: .*Nothing was checked; `npm run advisor -- link <path>`/);
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
  assert.match(blocked.text, /leak\.html:1: 12-word run/);
  assert.equal(git(remote, "rev-parse", "--verify", "-q", "feature").code === 0, false);
});
