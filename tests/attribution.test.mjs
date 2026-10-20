import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).homepage;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-feed-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const bh = (...args) => spawnSync(process.execPath, [path.join(root, "scripts/bh.mjs"), ...args], { cwd: root, env, encoding: "utf8" });
  const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
  const edit = (rel, from, to) => {
    const text = read(rel), next = text.replace(from, to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${String(from)}`);
    fs.writeFileSync(path.join(root, rel), next);
  };
  const feed = () => read("feed.xml");
  return { root, bh, read, edit, feed };
}
const SPAN = '<span data-attribution>From <a href="https://bitwise.john-ky.io/">Bitwise Engineering</a> · <a href="https://github.com/newhoggy/bitwise-blog">source</a></span>';

test("every public page, the home page and every template carry the attribution, and check accepts it", (t) => {
  const f = fixture(t);
  for (const rel of ["index.html", "docs/glossary.html", "docs/how-deflate-works.html", "templates/explainer.html", "templates/adr.html"]) {
    assert.equal(f.read(rel).split(SPAN).length - 1, 1, rel);
  }
  const check = f.bh("check");
  assert.equal(check.status === 0 || !/attribution/.test(check.stdout), true, check.stdout);
});

test("check fails on a missing, duplicated or altered attribution", (t) => {
  for (const [rel, from, to] of [
    ["docs/glossary.html", SPAN, ""],
    ["docs/glossary.html", SPAN, SPAN + SPAN],
    ["docs/glossary.html", "github.com/newhoggy/bitwise-blog", "github.com/elsewhere/blog"],
    ["templates/adr.html", SPAN, ""],
    ["index.html", SPAN, ""],
  ]) {
    const f = fixture(t);
    f.edit(rel, from, to);
    const out = f.bh("check");
    assert.notEqual(out.status, 0, rel);
    assert.match(out.stdout, /needs exactly this attribution link/, rel);
  }
});

test("index writes and repairs the attribution", (t) => {
  const f = fixture(t);
  const before = f.read("docs/glossary.html");
  f.edit("docs/glossary.html", "      " + SPAN + "\n", "");
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.read("docs/glossary.html"), before);
  f.edit("docs/glossary.html", "github.com/newhoggy/bitwise-blog", "github.com/elsewhere/blog");
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.read("docs/glossary.html"), before);
});

test("a fork sets bh.repoUrl and index rewrites every footer", (t) => {
  const f = fixture(t);
  const pkg = JSON.parse(f.read("package.json"));
  pkg.bh.repoUrl = "https://github.com/fork/blog/";
  fs.writeFileSync(path.join(f.root, "package.json"), JSON.stringify(pkg, null, 2));
  assert.equal(f.bh("index").status, 0);
  assert.match(f.read("docs/glossary.html"), /<a href="https:\/\/github\.com\/fork\/blog">source<\/a>/);
  assert.match(f.read("templates/adr.html"), /<a href="https:\/\/github\.com\/fork\/blog">source<\/a>/);
});

test("a bundled page keeps the attribution, since it names the site and repo by absolute URL", (t) => {
  const f = fixture(t);
  assert.equal(f.bh("bundle", "docs/how-deflate-works.html").status, 0);
  assert.ok(f.read("dist/how-deflate-works.html").includes(SPAN));
});
