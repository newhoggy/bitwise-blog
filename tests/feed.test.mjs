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
const ids = (xml) => [...xml.matchAll(/<entry>\s*<id>([^<]*)<\/id>/g)].map((m) => m[1]);
const metaOf = (html, name) => (html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || "";

test("the committed feed lists exactly the listed posts, newest first, and check accepts it", (t) => {
  const f = fixture(t);
  const posts = fs.readdirSync(path.join(source, "docs")).filter((n) => n.endsWith(".html")).map((n) => ({ n, html: fs.readFileSync(path.join(source, "docs", n), "utf8") }))
    .filter(({ html }) => !/name="bh:sealed"/.test(html) && metaOf(html, "bh:example") !== "true" && metaOf(html, "bh:unlisted") !== "true" && metaOf(html, "bh:kind") !== "reference")
    .sort((a, b) => metaOf(b.html, "bh:date").localeCompare(metaOf(a.html, "bh:date")) || a.n.localeCompare(b.n));
  assert.ok(posts.length >= 1, "the repo should have at least one post to list");
  assert.deepEqual(ids(f.feed()), posts.map(({ n }) => `${SITE}docs/${n}`));
  assert.match(f.feed(), /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(f.feed(), new RegExp(`<link rel="self" type="application/atom\\+xml" href="${SITE}feed\\.xml"/>`));
  assert.match(f.feed(), new RegExp(`<updated>${metaOf(posts[0].html, "bh:date")}T00:00:00Z</updated>`));
  const check = f.bh("check");
  assert.equal(check.status, 0, check.stdout);
  assert.match(check.stdout, /atom feed/);
  // index is idempotent: nothing changes on a second run.
  const before = f.feed();
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.feed(), before);
});

test("index keeps examples, unlisted, reference and sealed pages out of the feed, and escapes text", (t) => {
  const f = fixture(t);
  const make = (slug, title, flags = []) => assert.equal(f.bh("new", ...flags, "explainer", slug, title, `About ${slug} & <more>`).status, 0);
  make("loud-post", "Fish & <chips>");
  make("an-example", "An example page", ["--example"]);
  make("a-quiet-page", "A quiet page", ["--unlisted"]);
  make("a-reference", "A reference page");
  f.edit("docs/a-reference.html", 'name="bh:kind" content="explainer"', 'name="bh:kind" content="reference"');
  f.edit("docs/loud-post.html", /name="bh:date" content="[^"]*"/, 'name="bh:date" content="2099-01-02"');
  f.edit("docs/loud-post.html", 'name="bh:tags" content=""', 'name="bh:tags" content="a &amp; b, c"');
  assert.equal(f.bh("index").status, 0);
  const xml = f.feed();
  assert.deepEqual(ids(xml).slice(0, 1), [`${SITE}docs/loud-post.html`], "newest first");
  for (const slug of ["an-example", "a-quiet-page", "a-reference"]) assert.ok(!xml.includes(slug), `${slug} must not be in the feed`);
  assert.match(xml, /<title>Fish &amp; &lt;chips&gt;<\/title>/);
  assert.match(xml, /<summary>About loud-post &amp; &lt;more&gt;<\/summary>/);
  assert.match(xml, /<category term="a &amp; b"\/>/);
  assert.match(xml, /<updated>2099-01-02T00:00:00Z<\/updated>/);
  // The feed-level author covers an entry that names none.
  assert.match(xml, /<\/updated>\n  <author><name>Bitwise Engineering<\/name><\/author>/);
});

test("check fails on a stale or hand-edited feed, and on an entry the site keeps off its listings", (t) => {
  const f = fixture(t);
  f.edit("feed.xml", "<generator>beautiful-html</generator>", "<generator>by hand</generator>");
  let out = f.bh("check");
  assert.notEqual(out.status, 0);
  assert.match(out.stdout, /feed\.xml is stale: run `npm run index`/);

  const g = fixture(t);
  g.bh("new", "--example", "explainer", "an-example", "An example page");
  const real = ids(g.feed())[0];
  g.edit("feed.xml", real, `${SITE}docs/an-example.html`);
  out = g.bh("check");
  assert.match(out.stdout, /lists https:\/\/bitwise\.john-ky\.io\/docs\/an-example\.html, which is private, unlisted, an example/);

  const h = fixture(t);
  h.edit("feed.xml", "<summary>", "<summary>Fish & chips ");
  assert.match(h.bh("check").stdout, /feed\.xml contains an unescaped &/);

  const m = fixture(t);
  m.edit("feed.xml", "</feed>", "");
  assert.match(m.bh("check").stdout, /feed\.xml never closes <feed>/);

  const gone = fixture(t);
  fs.rmSync(path.join(gone.root, "feed.xml"));
  assert.match(gone.bh("check").stdout, /feed\.xml is missing/);
});

test("check requires the autodiscovery link and the Subscribe link on every page and template", (t) => {
  const link = '  <link rel="alternate" type="application/atom+xml" title="Bitwise Engineering" href="../feed.xml">\n';
  for (const [rel, from, to, message] of [
    ["docs/glossary.html", link, "", /needs exactly one feed autodiscovery link in <head> \(found 0\)/],
    ["docs/glossary.html", link, link + link, /needs exactly one feed autodiscovery link in <head> \(found 2\)/],
    ["docs/glossary.html", 'title="Bitwise Engineering" href="../feed.xml"', 'title="Elsewhere" href="../feed.xml"', /feed autodiscovery link must be/],
    ["docs/glossary.html", '<span><a href="../feed.xml">Subscribe</a></span>', "", /needs a Subscribe link/],
    ["templates/explainer.html", link, "", /needs exactly one feed autodiscovery link/],
    ["templates/adr.html", '<a href="../feed.xml">Subscribe</a>', "", /needs a Subscribe link/],
    ["index.html", '  <link rel="alternate" type="application/atom+xml" title="Bitwise Engineering" href="feed.xml">\n', "", /needs exactly one feed autodiscovery link/],
    ["index.html", '<span><a href="feed.xml">Subscribe</a></span>', "", /needs a Subscribe link/],
  ]) {
    const f = fixture(t);
    f.edit(rel, from, to);
    const out = f.bh("check");
    assert.notEqual(out.status, 0, rel);
    assert.match(out.stdout, message, rel);
  }
});

test("index writes and repairs the autodiscovery link", (t) => {
  const f = fixture(t);
  const link = '  <link rel="alternate" type="application/atom+xml" title="Bitwise Engineering" href="../feed.xml">\n';
  f.edit("docs/glossary.html", link, '  <link rel="alternate" type="application/atom+xml" title="Old" href="../feed.xml">\n  <link rel="alternate" type="application/atom+xml" title="Old two" href="../other.xml">\n');
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.read("docs/glossary.html").split(link).length - 1, 1);
  assert.ok(!f.read("docs/glossary.html").includes("Old"));
  const previous = f.read("docs/glossary.html");
  f.edit("docs/glossary.html", link, "");
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.read("docs/glossary.html"), previous);
});

test("a bundled page carries no feed link and no Subscribe link", (t) => {
  const f = fixture(t);
  assert.equal(f.bh("bundle", "docs/how-deflate-works.html").status, 0);
  const html = f.read("dist/how-deflate-works.html");
  assert.ok(!/feed\.xml/.test(html), "a standalone file has no feed");
  assert.ok(!/atom\+xml/.test(html));
  assert.ok(!/>Subscribe</.test(html));
  // The rest of the footer is intact.
  assert.match(html, /<footer class="bh-footer">[\s\S]*Updated \d{4}-\d{2}-\d{2}/);
});
