// JSON-LD (schema.org) structured data: `index` writes one block into the social block of every
// post (a TechArticle) and of the home page (a WebSite); `check` fails when it is missing, stale or
// written by hand; `bundle` drops the page's own url and image.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { load } from "cheerio";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).homepage;

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-json-ld-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  // BH_SITE_URL and friends change the generated blocks, so they are dropped.
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];
  const bh = (...args: string[]) => spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), ...args], { cwd: root, env, encoding: "utf8" });
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const edit = (rel: string, from: string | RegExp, to: string) => {
    const text = read(rel), next = text.replace(from, () => to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${String(from)}`);
    fs.writeFileSync(path.join(root, rel), next);
  };
  return { root, bh, read, edit };
}

const LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
/** The raw text of every JSON-LD script in `html`. */
const ldTexts = (html: string) => [...html.matchAll(LD)].map((m) => m[1]!);
/** The social block of `html`, or "". */
const socialOf = (html: string) => (html.match(/<!-- bh:social:start\b[\s\S]*?<!-- bh:social:end -->/) || [""])[0];
/** The JSON-LD an HTML parser sees in `html`: the text of each ld+json script, parsed. */
const parsedLd = (html: string): Record<string, any>[] => {
  const $ = load(html);
  return $('script[type="application/ld+json"]').toArray().map((el) => JSON.parse($(el).text()));
};
const metaOf = (html: string, name: string) => (html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || "";
const propOf = (html: string, name: string) => (html.match(new RegExp(`<meta property="${name}" content="([^"]*)"`)) || [])[1] || "";
/** check's messages for one file, without colour codes. */
const messagesFor = (out: string, rel: string) => {
  const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const i = lines.findIndex((l) => /^[✓✗!] /.test(l) && l.slice(2).split(" ")[0] === rel);
  assert.ok(i >= 0, `check printed no heading for ${rel}:\n${out}`);
  const end = lines.findIndex((l, j) => j > i && (/^[✓✗!] /.test(l) || /^\d+ files/.test(l)));
  return lines.slice(i + 1, end).map((l) => l.trim()).filter(Boolean);
};

test("every committed post carries one TechArticle in its social block, and nothing else does", () => {
  let posts = 0;
  for (const name of fs.readdirSync(path.join(source, "docs")).filter((n) => n.endsWith(".html") && !n.endsWith(".private.html"))) {
    const html = fs.readFileSync(path.join(source, "docs", name), "utf8");
    if (/name="bh:sealed"/.test(html)) {
      assert.equal(ldTexts(html).length, 0, `${name} is a sealed shell and must carry no JSON-LD`);
      continue;
    }
    const post = metaOf(html, "bh:example") !== "true" && metaOf(html, "bh:unlisted") !== "true" && metaOf(html, "bh:kind") !== "reference";
    if (!post) {
      assert.equal(ldTexts(html).length, 0, `${name} is not a post and must carry no JSON-LD`);
      continue;
    }
    posts++;
    assert.equal(ldTexts(html).length, 1, `${name} must carry exactly one JSON-LD block`);
    assert.equal(ldTexts(socialOf(html)).length, 1, `${name}: the block lives inside the generated social block`);
    const [ld] = parsedLd(html);
    assert.equal(ld!["@context"], "https://schema.org");
    assert.equal(ld!["@type"], "TechArticle");
    assert.equal(ld!.url, `${SITE}docs/${name}`);
    assert.equal(ld!.image, propOf(html, "og:image"), "the image is the page's social card");
    assert.equal(ld!.datePublished, metaOf(html, "bh:date"));
    assert.equal(ld!.publisher["@type"], "Organization");
    assert.equal(ld!.publisher.url, SITE);
    assert.ok(typeof ld!.headline === "string" && ld!.headline.length > 0);
    assert.ok(typeof ld!.description === "string" && ld!.description.length > 0);
    assert.ok(Array.isArray(ld!.author) && ld!.author.every((a: Record<string, unknown>) => a["@type"] === "Person" && typeof a.name === "string"));
  }
  assert.ok(posts >= 1, "the repo has at least one post");
  const home = fs.readFileSync(path.join(source, "index.html"), "utf8");
  const [site, ...rest] = parsedLd(home);
  assert.equal(rest.length, 0);
  assert.equal(site!["@type"], "WebSite");
  assert.equal(site!.url, SITE);
  assert.equal(ldTexts(socialOf(home)).length, 1, "the home page's block lives inside its social block");
  for (const name of fs.readdirSync(path.join(source, "templates"))) {
    assert.equal(ldTexts(fs.readFileSync(path.join(source, "templates", name), "utf8")).length, 0, `the template ${name} keeps its social markers empty`);
  }
  assert.equal(ldTexts(fs.readFileSync(path.join(source, "404.html"), "utf8")).length, 0, "the 404 page carries none");
});

test("text is decoded from HTML and escaped so it cannot end the script", (t) => {
  const f = fixture(t);
  assert.equal(f.bh("new", "explainer", "escape-post", "Placeholder").status, 0);
  f.edit("docs/escape-post.html", /<title>[^<]*<\/title>/, '<title>Ends &lt;/script&gt; &amp; &lt;!-- "q" \\ back</title>');
  f.edit("docs/escape-post.html", /<meta name="description" content="[^"]*">/, '<meta name="description" content="A &lt;/SCRIPT&gt; tag, &quot;quotes&quot; and a \\ backslash">');
  f.edit("docs/escape-post.html", /<meta name="bh:authors" content="[^"]*">/, '<meta name="bh:authors" content="Ada &amp; Co, Ren&eacute;e O&apos;Neil">');
  assert.equal(f.bh("index").status, 0);
  const html = f.read("docs/escape-post.html");
  const [raw, ...more] = ldTexts(socialOf(html));
  assert.equal(more.length, 0);
  assert.ok(!raw!.includes("</"), `no "</" inside the script: ${raw}`);
  assert.ok(!raw!.includes("<!--"), `no "<!--" inside the script: ${raw}`);
  assert.ok(raw!.includes("<\\/script>"), "`</` is written `<\\/`");
  assert.ok(!/&[a-z]+;/i.test(raw!), "entities are decoded, since a script's text is raw");
  // What an HTML parser hands a crawler is the whole block, and it parses back to the page's text.
  const [ld, ...others] = parsedLd(html);
  assert.equal(others.length, 0, "the parser found one block, not a block cut short");
  assert.equal(ld!.headline, 'Ends </script> & <!-- "q" \\ back');
  assert.equal(ld!.description, 'A </SCRIPT> tag, "quotes" and a \\ backslash');
  assert.deepEqual(ld!.author, [{ "@type": "Person", name: "Ada & Co" }, { "@type": "Person", name: "Renée O'Neil" }]);
});

test("example, unlisted and reference pages get no JSON-LD; an ordinary post does", (t) => {
  const f = fixture(t);
  const make = (slug: string, flags: string[] = []) => assert.equal(f.bh("new", ...flags, "explainer", slug, `Title of ${slug}`).status, 0);
  make("a-post");
  make("an-example", ["--example"]);
  make("a-quiet-page", ["--unlisted"]);
  make("a-reference");
  make("a-bad-date");
  f.edit("docs/a-reference.html", /name="bh:kind" content="[^"]*"/, 'name="bh:kind" content="reference"');
  f.edit("docs/a-bad-date.html", /name="bh:date" content="[^"]*"/, 'name="bh:date" content="2026-13-45"');
  assert.equal(f.bh("index").status, 0);
  const ld = (slug: string) => parsedLd(f.read(`docs/${slug}.html`));
  assert.equal(ld("a-post").length, 1);
  assert.equal(ld("a-post")[0]!.headline, "Title of a-post");
  for (const slug of ["an-example", "a-quiet-page", "a-reference"]) {
    assert.equal(ld(slug).length, 0, `${slug} must carry no JSON-LD`);
    assert.match(socialOf(f.read(`docs/${slug}.html`)), /og:title/, `${slug} still has its social block`);
  }
  assert.match(socialOf(f.read("docs/a-quiet-page.html")), /noindex/, "the unlisted page keeps its noindex");
  assert.equal(ld("a-bad-date").length, 1, "an impossible date drops the field, not the block");
  assert.equal(ld("a-bad-date")[0]!.datePublished, undefined);
});

test("check fails on a stale or missing block, and index repairs it once", (t) => {
  const f = fixture(t);
  const post = fs.readdirSync(path.join(f.root, "docs"))
    .find((n) => n.endsWith(".html") && ldTexts(f.read(`docs/${n}`)).length === 1);
  assert.ok(post, "a post with a JSON-LD block");
  const rel = `docs/${post}`;
  const stale = "error  social meta block is stale: run `npm run index`";
  const original = f.read(rel);

  // A changed description: the og: tags and the JSON-LD both go stale.
  fs.writeFileSync(path.join(f.root, rel), original.replace(/(<meta name="description" content=")[^"]*"/, '$1A different description"'));
  assert.notEqual(f.read(rel), original);
  assert.ok(messagesFor(f.bh("check").stdout, rel).includes(stale));

  // Only the JSON-LD line removed: the rest of the block is current, and check still fails.
  fs.writeFileSync(path.join(f.root, rel), original.replace(/^[ \t]*<script type="application\/ld\+json">.*<\/script>\n/m, ""));
  assert.equal(ldTexts(f.read(rel)).length, 0, "the injection removed the block");
  assert.ok(messagesFor(f.bh("check").stdout, rel).includes(stale));

  // Only the JSON-LD edited by hand inside the block.
  fs.writeFileSync(path.join(f.root, rel), original.replace(/"@type":"TechArticle"/, '"@type":"BlogPosting"'));
  assert.notEqual(f.read(rel), original);
  assert.ok(messagesFor(f.bh("check").stdout, rel).includes(stale));

  // index puts it back exactly, and running it again changes nothing.
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.read(rel), original);
  assert.deepEqual(messagesFor(f.bh("check").stdout, rel), []);
  const home = f.read("index.html");
  assert.equal(f.bh("index").status, 0);
  assert.equal(f.read(rel), original, "index is idempotent");
  assert.equal(f.read("index.html"), home);
});

test("check fails on JSON-LD written by hand outside the block, on the home page and in a template too", (t) => {
  const f = fixture(t);
  const byHand = "error  JSON-LD written by hand: delete it, `npm run index` generates it";
  f.edit("index.html", "</head>", '  <script type="application/ld+json">{"@type":"Organization"}</script>\n</head>');
  f.edit("templates/explainer.html", "</head>", '  <script data-x type=application/ld+json>{"@type":"Organization"}</script>\n</head>');
  const out = f.bh("check").stdout;
  assert.ok(messagesFor(out, "index.html").includes(byHand), out);
  assert.ok(messagesFor(out, "templates/explainer.html").includes(byHand), out);
});

test("a bundled page keeps its JSON-LD without the page's url and image", (t) => {
  const f = fixture(t);
  const before = parsedLd(f.read("docs/how-deflate-works.html"));
  assert.equal(before.length, 1);
  assert.equal(f.bh("bundle", "docs/how-deflate-works.html").status, 0);
  const html = f.read("dist/how-deflate-works.html");
  const after = parsedLd(html);
  assert.equal(after.length, 1);
  const { url, image, ...rest } = before[0]!;
  assert.ok(url && image, "the source block has both");
  assert.deepEqual(after[0], rest, "only url and image are dropped");
  assert.ok(!ldTexts(html)[0]!.includes("</"), "the re-written block is escaped the same way");
});

test("a bundle drops a JSON-LD block that does not parse, and says so", (t) => {
  const f = fixture(t);
  f.edit("docs/how-deflate-works.html", '"@type":"TechArticle",', '"@type":"TechArticle", broken');
  const r = f.bh("bundle", "docs/how-deflate-works.html");
  assert.equal(r.status, 0);
  assert.match(r.stderr, /dropped a JSON-LD block that is not valid JSON/);
  const html = f.read("dist/how-deflate-works.html");
  assert.equal(ldTexts(html).length, 0, "no block, rather than one that still links to the site");
});
