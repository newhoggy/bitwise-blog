import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { contractProblems, readmeDependencyProblems, readmeExampleProblems } from "../scripts/docs-drift.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEPS = [
  "<!-- bh:deps -->",
  "- `typescript` and `@types/node`: `npm run typecheck`.",
  "- `yaml`: reads `config.yaml`.",
  "<!-- /bh:deps -->",
].join("\n");
const PKG = { devDependencies: { typescript: "1", "@types/node": "1", yaml: "1" } };

test("dependencies: a README list that matches package.json is clean", () => {
  assert.deepEqual(readmeDependencyProblems(DEPS, PKG), []);
  // `dependencies` count as well as `devDependencies`.
  assert.deepEqual(readmeDependencyProblems(DEPS, { dependencies: { yaml: "1" }, devDependencies: { typescript: "1", "@types/node": "1" } }), []);
  assert.deepEqual(readmeDependencyProblems(DEPS, { optionalDependencies: { yaml: "1" }, peerDependencies: { typescript: "1" }, devDependencies: { "@types/node": "1" } }), []);
  // An item wrapped over two lines still counts as one, and a numbered or colon-less item claims nothing.
  assert.deepEqual(readmeDependencyProblems("<!-- bh:deps -->\n- `typescript`,\n  `yaml`: both\n<!-- /bh:deps -->", { devDependencies: { typescript: "1", yaml: "1" } }), []);
});

test("dependencies: a package missing from the README, and one the repo lacks, are named", () => {
  const more = { devDependencies: { ...PKG.devDependencies, cheerio: "1" } };
  assert.deepEqual(readmeDependencyProblems(DEPS, more), ["README.md dependency list is missing `cheerio` (add it, or remove it from package.json)"]);
  const fewer = { devDependencies: { typescript: "1", "@types/node": "1" } };
  assert.deepEqual(readmeDependencyProblems(DEPS, fewer), ["README.md dependency list names `yaml`, which package.json does not have"]);
});

test("dependencies: words after the colon are not claims, and the list must exist and be non-empty", () => {
  // `npm run typecheck` and `config.yaml` sit after a colon; a command-looking word before it would count.
  assert.deepEqual(readmeDependencyProblems(DEPS.replace("`yaml`: reads", "`yaml`: reads `sync-posts`,"), PKG), []);
  assert.match(readmeDependencyProblems("no fence here", PKG)[0], /has no <!-- bh:deps -->/);
  assert.deepEqual(readmeDependencyProblems("<!-- bh:deps -->\n<!-- /bh:deps -->", {}), ["README.md dependency list lists nothing"]);
});

test("examples: the README list must equal the pages marked bh:example", () => {
  const readme = "<!-- bh:examples -->\n`docs/a.html` and `docs/b-1.html`.\n<!-- /bh:examples -->";
  assert.deepEqual(readmeExampleProblems(readme, ["docs/b-1.html", "docs/a.html"]), []);
  assert.deepEqual(readmeExampleProblems(readme, ["docs/a.html"]), ["README.md example list names `docs/b-1.html`, which no `bh:example` marker marks"]);
  assert.deepEqual(readmeExampleProblems(readme, ["docs/a.html", "docs/b-1.html", "docs/c.html"]), ["README.md example list is missing `docs/c.html` (add it, or remove its bh:example marker)"]);
  assert.match(readmeExampleProblems("", [])[0], /has no <!-- bh:examples -->/);
});

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-drift-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html", "README.md"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const check = () => spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "check"], { cwd: root, env, encoding: "utf8" });
  const edit = (rel: string, from: string, to: string) => {
    const file = path.join(root, rel), text = fs.readFileSync(file, "utf8"), next = text.replace(from, to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${from}`);
    fs.writeFileSync(file, next);
  };
  return { root, check, edit };
}

test("the committed README matches the repo, and check says so", (t) => {
  const f = fixture(t);
  const r = f.check();
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /README \(dependency and example lists match the repo\)/);
});

test("check fails when the README's dependency list drifts from package.json", (t) => {
  const f = fixture(t);
  f.edit("README.md", "- `yaml`:", "- `yaml-but-not-really`:");
  const r = f.check();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /README\.md dependency list is missing `yaml` /);
  assert.match(r.stdout, /README\.md dependency list names `yaml-but-not-really`, which package\.json does not have/);
});

test("check fails when a page's bh:example marker and the README disagree", (t) => {
  const f = fixture(t);
  // The token-bucket page is a post; marking it an example without telling the README must fail.
  f.edit("docs/token-bucket-rate-limiting.html", '<meta name="bh:kind"', '<meta name="bh:example" content="true">\n  <meta name="bh:kind"');
  const r = f.check();
  assert.match(r.stdout, /README\.md example list is missing `docs\/token-bucket-rate-limiting\.html` /);
});

test("check skips the README rule when there is no README", (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.root, "README.md"));
  const r = f.check();
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /README/);
});

test("contracts: every named contract exists and every contract is named", () => {
  const md = "- Feeds? Read [`contracts/feed.md`](contracts/feed.md).\n- Cards? Read `contracts/social-cards.md`.\n";
  assert.deepEqual(contractProblems(md, ["feed.md", "social-cards.md"]), []);
  // A path under another directory is not a contract pointer.
  assert.deepEqual(contractProblems(md + "See `docs/contracts/old.md` and tests/contracts/x.md.\n", ["feed.md", "social-cards.md"]), []);
});

test("contracts: a missing contract and an unnamed one are both named", () => {
  assert.deepEqual(contractProblems("Read `contracts/feed.md` and `contracts/gone.md`.", ["feed.md", "stray.md"]), [
    "CLAUDE.md names contracts/gone.md, which does not exist",
    'contracts/stray.md is not named in CLAUDE.md: add a pointer line under "Feature contracts", or delete it',
  ]);
  assert.deepEqual(contractProblems("no pointers", []), []);
});
