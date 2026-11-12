import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).homepage;
const ROOT_FILES = ["feed.xml", "sitemap.xml", "robots.txt", "404.html"];

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-sitemap-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", ...ROOT_FILES]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const bh = (...args: string[]) => spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), ...args], { cwd: root, env, encoding: "utf8" });
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
  const edit = (rel: string, from: string | RegExp, to: string) => {
    const text = read(rel), next = text.replace(from, to);
    assert.notEqual(next, text, `the injection into ${rel} changed nothing: ${String(from)}`);
    fs.writeFileSync(path.join(root, rel), next);
  };
  return { root, bh, read, edit };
}
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const metaOf = (html: string, name: string) => (html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [])[1] || "";

test("the committed sitemap lists the home page and every surfaced page, and check accepts all three files", (t) => {
  const f = fixture(t);
  const pages = fs.readdirSync(path.join(source, "docs")).filter((n) => n.endsWith(".html")).map((n) => ({ n, html: fs.readFileSync(path.join(source, "docs", n), "utf8") }))
    .filter(({ html }) => !/name="bh:sealed"/.test(html) && metaOf(html, "bh:example") !== "true" && metaOf(html, "bh:unlisted") !== "true");
  assert.ok(pages.length >= 1);
  const listed = locs(f.read("sitemap.xml"));
  assert.equal(listed[0], SITE, "the home page comes first");
  assert.deepEqual(listed.slice(1).sort(), pages.map(({ n }) => `${SITE}docs/${n}`).sort());
  // A reference page is a real page, unlike in the feed.
  assert.ok(listed.includes(`${SITE}docs/glossary.html`));
  for (const n of fs.readdirSync(path.join(source, "docs")).filter((n) => n.endsWith(".html") && /name="bh:sealed"/.test(fs.readFileSync(path.join(source, "docs", n), "utf8")))) {
    assert.ok(!f.read("sitemap.xml").includes(n), `${n} is sealed and must not be in the sitemap`);
  }
  assert.match(f.read("sitemap.xml"), /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(f.read("sitemap.xml"), /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const check = f.bh("check");
  assert.equal(check.status, 0, check.stdout);
  assert.match(check.stdout, /sitemap\.xml, robots\.txt and 404\.html/);
  const before = ROOT_FILES.map(f.read);
  assert.equal(f.bh("index").status, 0);
  assert.deepEqual(ROOT_FILES.map(f.read), before, "index is idempotent");
});

test("index keeps example and unlisted pages out of the sitemap and robots.txt, and dates the entries", (t) => {
  const f = fixture(t);
  const make = (slug: string, flags: string[] = []) => assert.equal(f.bh("new", ...flags, "explainer", slug, `Title of ${slug}`).status, 0);
  make("a-post");
  make("an-example", ["--example"]);
  make("a-quiet-page", ["--unlisted"]);
  make("bad-date");
  f.edit("docs/a-post.html", /name="bh:date" content="[^"]*"/, 'name="bh:date" content="2099-01-02"');
  f.edit("docs/bad-date.html", /name="bh:date" content="[^"]*"/, 'name="bh:date" content="2026-13-45"');
  assert.equal(f.bh("index").status, 0);
  const xml = f.read("sitemap.xml");
  assert.match(xml, new RegExp(`<url><loc>${SITE}docs/a-post\\.html</loc><lastmod>2099-01-02</lastmod></url>`));
  assert.match(xml, new RegExp(`<url><loc>${SITE}</loc><lastmod>2099-01-02</lastmod></url>`), "the home page is as new as the newest page");
  assert.match(xml, new RegExp(`<url><loc>${SITE}docs/bad-date\\.html</loc></url>`), "an impossible date is left off, not written");
  assert.ok(!xml.includes("2026-13-45"));
  for (const slug of ["an-example", "a-quiet-page"]) assert.ok(!xml.includes(slug), `${slug} must not be in the sitemap`);
  assert.ok(!f.read("robots.txt").includes("a-quiet-page"), "robots.txt must not name an unlisted page");
  // The new pages still hold template placeholders, so check has other complaints; none may be about the root files.
  assert.doesNotMatch(f.bh("check").stdout, /✗ sitemap\.xml|sitemap\.xml (?:is|lists)|robots\.txt is|404\.html is/);
});

test("robots.txt allows everything and names the sitemap by its absolute URL", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.read("robots.txt").split("\n").filter((l) => l && !l.startsWith("#")), ["User-agent: *", "Allow: /", `Sitemap: ${SITE}sitemap.xml`]);
  const g = fixture(t);
  g.edit("package.json", /"homepage": "[^"]*"/, '"homepage": "https://example.org/blog/"');
  assert.equal(g.bh("index").status, 0);
  assert.match(g.read("robots.txt"), /^Sitemap: https:\/\/example\.org\/blog\/sitemap\.xml$/m);
  assert.match(g.read("sitemap.xml"), /<loc>https:\/\/example\.org\/blog\/<\/loc>/);
  // A project site is not at the domain root: the 404 page's assets follow the path.
  assert.match(g.read("404.html"), /<link rel="stylesheet" href="\/blog\/theme\/bh\.css">/);
});

test("the 404 page is noindex, has a root-relative theme, a way home and no social block or canonical", (t) => {
  const f = fixture(t);
  const page = f.read("404.html");
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /<link rel="stylesheet" href="\/theme\/bh\.css">/);
  assert.match(page, /<script src="\/theme\/bh\.js" defer><\/script>/);
  assert.match(page, /<h1>Page not found<\/h1>/);
  assert.match(page, /<a href="\/">Back to all posts<\/a>/);
  assert.doesNotMatch(page, /rel="canonical"|og:|twitter:|bh:social/);
  assert.equal((page.match(/<h1>/g) || []).length, 1);
  // Every asset it names exists in the repo.
  for (const m of page.matchAll(/(?:href|src)="\/([^"]+)"/g)) if (!m[1].endsWith("/")) assert.ok(fs.existsSync(path.join(source, m[1])), `${m[1]} must exist`);
});

test("check fails on a missing or stale file, and on a sitemap that lists a page the site keeps off its listings", (t) => {
  for (const name of ["sitemap.xml", "robots.txt", "404.html"]) {
    const f = fixture(t);
    fs.rmSync(path.join(f.root, name));
    const out = f.bh("check");
    assert.notEqual(out.status, 0, name);
    assert.match(out.stdout, new RegExp(`${name.replace(".", "\\.")} is missing: run \`npm run index\``));
  }
  const stale = fixture(t);
  stale.edit("robots.txt", "Allow: /", "Disallow: /");
  assert.match(stale.bh("check").stdout, /robots\.txt is stale: run `npm run index`/);
  const edited = fixture(t);
  edited.edit("404.html", "<h1>Page not found</h1>", "<h1>Gone</h1>");
  assert.match(edited.bh("check").stdout, /404\.html is stale/);

  const g = fixture(t);
  g.bh("new", "--example", "explainer", "an-example", "An example page");
  g.edit("sitemap.xml", `${SITE}docs/glossary.html`, `${SITE}docs/an-example.html`);
  const out = g.bh("check");
  assert.match(out.stdout, /sitemap\.xml lists https:\/\/bitwise\.john-ky\.io\/docs\/an-example\.html, which is private, unlisted, an example or not a page/);
  assert.match(out.stdout, /sitemap\.xml is stale/);

  const dup = fixture(t);
  dup.edit("sitemap.xml", "</urlset>", `  <url><loc>${SITE}</loc></url>\n</urlset>`);
  assert.match(dup.bh("check").stdout, new RegExp(`sitemap\\.xml lists ${SITE.replace(/[.]/g, "\\.")} twice`));
});

test("serve answers a missing path with the 404 page, rebased onto the local root when homepage has a sub-path", async (t) => {
  const f = fixture(t);
  f.edit("package.json", /"homepage": "[^"]*"/, '"homepage": "https://example.org/blog/"');
  assert.equal(f.bh("index").status, 0);
  assert.match(f.read("404.html"), /href="\/blog\/theme\/bh\.css"/);
  const port = await new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, [path.join(f.root, "scripts/bh.mts"), "serve", String(port)], { cwd: f.root, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { child.kill(); });
  await new Promise<void>((resolve, reject) => { child.stdout.on("data", (d) => { if (String(d).includes("Serving ")) resolve(); }); child.once("exit", () => reject(new Error("serve exited"))); });
  const res = await new Promise<{ status?: number; body: string }>((resolve, reject) => http.get({ hostname: "127.0.0.1", port, path: "/no/such/page" }, (r) => {
    let body = ""; r.setEncoding("utf8"); r.on("data", (d) => { body += d; }); r.on("end", () => resolve({ status: r.statusCode, body }));
  }).on("error", reject));
  assert.equal(res.status, 404);
  assert.match(res.body, /<h1>Page not found<\/h1>/);
  assert.match(res.body, /href="\/theme\/bh\.css"/);
  assert.doesNotMatch(res.body, /href="\/blog\//, "no root-relative link may keep the sub-path");
  assert.match(res.body, /<a href="\/">Back to all posts<\/a>/);
});
