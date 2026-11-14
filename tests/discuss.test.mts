// The "Discuss this post" block: written by `npm run index` before the footer of every post the site
// surfaces, and nowhere else; `check` fails on a missing, stale, misplaced or out-of-place one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-discuss-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];
  const bh = (...args: string[]) => spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), ...args], { cwd: root, env, encoding: "utf8" });
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const write = (rel: string, text: string) => fs.writeFileSync(path.join(root, rel), text);
  const edit = (rel: string, from: string | RegExp, to: string) => {
    const text = read(rel), next = text.replace(from, to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${String(from)}`);
    write(rel, next);
  };
  const pkg = (change: (bh: Record<string, unknown>) => void) => {
    const p = JSON.parse(read("package.json"));
    change(p.bh);
    write("package.json", JSON.stringify(p, null, 2));
  };
  /** check's output, colours removed. */
  const check = () => bh("check").stdout.replace(/\x1b\[[0-9;]*m/g, "");
  return { root, bh, read, write, edit, pkg, check };
}

const BLOCK_RE = /^[ \t]*<aside\b[^>]*\sdata-discuss(?=[\s>=])[^>]*>[\s\S]*?<\/aside>\n\n/gm;
const blocks = (html: string) => [...html.matchAll(BLOCK_RE)].map((m) => m[0]);
const POST = "docs/how-deflate-works.html";
const DISCUSS_MSG = /Discuss this post|bh:discuss/;
/** The messages check printed under `rel`. */
function messages(out: string, rel: string): string[] {
  const lines = out.split("\n");
  const start = lines.findIndex((l) => l.slice(2) === rel || l.slice(2).startsWith(rel + " "));
  if (start < 0) return [];
  const found: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!/^ {2}(error|warn) /.test(l)) break;
    found.push(l.trim());
  }
  return found;
}

test("every post ends with one block just before its footer; no other page has one", (t) => {
  const f = fixture(t);
  for (const rel of ["docs/how-deflate-works.html", "docs/token-bucket-rate-limiting.html", "docs/announcing-patchcov.html"]) {
    const html = f.read(rel), found = blocks(html);
    assert.equal(found.length, 1, rel);
    assert.match(html, /<\/aside>\n\n[ \t]*<footer class="bh-footer"/, rel);
  }
  for (const rel of ["index.html", "docs/glossary.html", "docs/component-gallery.html", "docs/deflate-format-reference.html",
    "docs/adr-001-rate-limit-in-each-service.html", "docs/edge-rate-limiting-design.html", "templates/explainer.html", "templates/adr.html", "404.html"]) {
    assert.equal(blocks(f.read(rel)).length, 0, rel);
  }
  assert.doesNotMatch(f.check(), DISCUSS_MSG);
});

test("the block finds the thread by the canonical URL, prefills a new one that carries it, and keeps the Review link", (t) => {
  const f = fixture(t);
  const [block] = blocks(f.read(POST));
  const hrefs = [...block.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const canonical = "https://bitwise.john-ky.io/docs/how-deflate-works.html";
  const search = new URL(hrefs[0]);
  assert.equal(search.origin + search.pathname, "https://github.com/search");
  assert.equal(search.searchParams.get("type"), "discussions");
  assert.equal(search.searchParams.get("q"), `repo:newhoggy/bitwise-blog "${canonical}"`);
  const start = new URL(hrefs[1]);
  assert.equal(start.origin + start.pathname, "https://github.com/newhoggy/bitwise-blog/discussions/new");
  assert.equal(start.searchParams.get("category"), "general");
  assert.equal(start.searchParams.get("title"), "How DEFLATE works");
  assert.ok(start.searchParams.get("body")!.includes(canonical));
  assert.equal(hrefs[2], "?review");
  assert.match(block, /class="callout no-glossary" id="discuss" data-linkable data-discuss/);
});

test("the block is not search text", (t) => {
  const f = fixture(t);
  assert.doesNotMatch(f.read("theme/search-index.js"), /Find this post|Discuss this post/);
});

test("check fails on a missing, hand-edited, duplicated or misplaced block, and index repairs each", (t) => {
  const f = fixture(t);
  const good = f.read(POST), [block] = blocks(good);
  for (const [name, broken, msg] of [
    ["missing", good.replace(block, ""), /missing the "Discuss this post" block: run `npm run index`/],
    ["hand-edited", good.replace("Questions, corrections", "Questions and corrections"), /"Discuss this post" block is stale or edited by hand/],
    ["duplicated", good.replace(block, block + block), /has 2 "Discuss this post" blocks/],
    ["misplaced", good.replace(block, "").replace("  </article>", block + "  </article>"), /must sit just before the <footer class="bh-footer">/],
  ] as const) {
    assert.notEqual(broken, good, name);
    f.write(POST, broken);
    const out = f.check();
    assert.match(messages(out, POST).join("\n"), msg, `${name}:\n${out}`);
    assert.equal(f.bh("index").status, 0, name);
    assert.equal(f.read(POST), good, `index did not repair the ${name} block`);
  }
});

test("an unlisted page must not carry one, and index removes it", (t) => {
  const f = fixture(t);
  f.edit(POST, /^(  <meta name="bh:tags" content="[^"]*">\n)/m, '$1  <meta name="bh:unlisted" content="true">\n');
  assert.match(messages(f.check(), POST).join("\n"), /must not carry a "Discuss this post" block: it is an unlisted page/);
  assert.equal(f.bh("index").status, 0);
  assert.equal(blocks(f.read(POST)).length, 0);
  assert.doesNotMatch(messages(f.check(), POST).join("\n"), DISCUSS_MSG);
});

test("an example page must not carry one", (t) => {
  const f = fixture(t);
  const [block] = blocks(f.read(POST));
  const ex = "docs/adr-001-rate-limit-in-each-service.html";
  f.edit(ex, /^([ \t]*)<footer class="bh-footer"/m, block + "$1<footer class=\"bh-footer\"");
  assert.match(messages(f.check(), ex).join("\n"), /must not carry a "Discuss this post" block: it is an example page; run `npm run index`/);
});

test("a private page must not carry one, and the message says to delete it", (t) => {
  const f = fixture(t);
  f.write("docs/secret-notes.private.html", f.read(POST));
  const out = messages(f.check(), "docs/secret-notes.private.html").join("\n");
  assert.match(out, /must not carry a "Discuss this post" block: it is a private page, which must not point at a public thread; delete it/);
  // index leaves private sources alone: editing one would make its seal stale.
  assert.equal(f.bh("index").status, 0);
  assert.equal(blocks(f.read("docs/secret-notes.private.html")).length, 1);
});

test("bh:discuss off removes the block; a thread URL pins it; anything else is an error", (t) => {
  const f = fixture(t);
  const head = /^(  <meta name="bh:tags" content="[^"]*">\n)/m;
  f.edit(POST, head, '$1  <meta name="bh:discuss" content="off">\n');
  assert.match(messages(f.check(), POST).join("\n"), /must not carry a "Discuss this post" block: it sets <meta name="bh:discuss" content="off">/);
  assert.equal(f.bh("index").status, 0);
  assert.equal(blocks(f.read(POST)).length, 0);
  assert.doesNotMatch(messages(f.check(), POST).join("\n"), DISCUSS_MSG);

  f.edit(POST, 'content="off"', 'content="https://github.com/newhoggy/bitwise-blog/discussions/42"');
  assert.equal(f.bh("index").status, 0);
  const [block] = blocks(f.read(POST));
  assert.match(block, /<a href="https:\/\/github\.com\/newhoggy\/bitwise-blog\/discussions\/42">join the discussion on GitHub<\/a>/);
  assert.doesNotMatch(block, /github\.com\/search|discussions\/new/);
  assert.doesNotMatch(messages(f.check(), POST).join("\n"), DISCUSS_MSG);

  f.edit(POST, "discussions/42", "issues/42");
  assert.match(messages(f.check(), POST).join("\n"), /bh:discuss must be "off" or the URL of this post's thread/);
});

test("a page with the Review panel off gets no Review link", (t) => {
  const f = fixture(t);
  f.edit(POST, /<body\b/, '<body data-review="off"');
  assert.equal(f.bh("index").status, 0);
  const [block] = blocks(f.read(POST));
  assert.doesNotMatch(block, /\?review/);
});

test("a fork's bh.repoUrl moves every thread; an empty bh.discussionsUrl switches the block off", (t) => {
  const f = fixture(t);
  f.pkg((bh) => { bh.repoUrl = "https://github.com/fork/blog"; });
  assert.equal(f.bh("index").status, 0);
  const [block] = blocks(f.read(POST));
  assert.match(block, /github\.com\/fork\/blog\/discussions\/new\?/);
  assert.match(block, /q=repo%3Afork%2Fblog\+/);

  f.pkg((bh) => { bh.discussionsUrl = ""; });
  assert.equal(f.bh("index").status, 0);
  assert.equal(blocks(f.read(POST)).length, 0);
  assert.doesNotMatch(f.check(), DISCUSS_MSG);

  f.pkg((bh) => { bh.discussionsUrl = "https://gitlab.com/fork/blog/discussions"; });
  assert.match(f.check(), /bh\.discussionsUrl must be https:\/\/github\.com\/OWNER\/REPO\/discussions/);
});

test("a bundle has no block: a standalone file has no thread of its own", (t) => {
  const f = fixture(t);
  assert.equal(f.bh("bundle", POST).status, 0);
  assert.doesNotMatch(f.read("dist/how-deflate-works.html"), /data-discuss/);
});
