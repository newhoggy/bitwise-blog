import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { parse as parseYaml } from "yaml";
import { htmlToMarkdown, renderPost, retryDelayMs, yamlScalar, type FetchFn, type PostMetadata } from "../scripts/ingest/base.mts";
import { getIngester } from "../scripts/ingest/index.mts";
import { dataDir } from "../scripts/advisor/corpus.mts";
import { main, syncAll, syncWriter, type Output } from "../scripts/sync-posts.mts";

// ---- helpers ------------------------------------------------------------------------

type Route = string | { status?: number; body: string; type?: string } | ((url: string, init?: RequestInit) => string);

/** A `fetch` that answers from a table of URL → body, records every request, and 404s the rest. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (route === undefined) return new Response("not found", { status: 404 });
    if (typeof route === "function") return new Response(route(url, init));
    if (typeof route === "string") return new Response(route);
    return new Response(route.body, { status: route.status ?? 200 });
  };
  return { fetchFn, calls };
}

function tmp(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-sync-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const post = (dir: string, file: string) => fs.readFileSync(path.join(dir, "posts", file), "utf8");
const posts = (dir: string) => fs.readdirSync(path.join(dir, "posts")).sort();
const frontmatter = (text: string) => parseYaml(text.split("\n---\n")[0].slice(4), { version: "1.1", logLevel: "error" });
const sink = () => {
  const lines: string[] = [], errors: string[] = [];
  const out: Output = { log: (...a) => lines.push(a.join(" ")), error: (...a) => errors.push(a.join(" ")) };
  return { out, lines, errors };
};
async function collect(it: AsyncGenerator<PostMetadata>) {
  const all: PostMetadata[] = [];
  for await (const m of it) all.push(m);
  return all;
}

// ---- frontmatter --------------------------------------------------------------------

const AWKWARD = [
  "[Crosspost] On Hreha", "{braces} first", ", comma first", "Yes", "null", "1984", "3.14", "Plain title",
  "Colon: inside", "It's quoted", " leading space", "- dash first", "The Demiurge’s Older Brother", "2024-01-20",
  "line separator", "carriage\rreturn", "nel\x85char", "nul\x00bell\x07", "tab\there", "~", "!!str", ".inf",
  "0x1A", 'He said "hi"', "back\\slash", "emoji 🎉", "no emoji 🎉", "line\nbreak", "del\x7fchar", "",
];

test("a title survives the round trip through frontmatter, whatever is in it", () => {
  for (const value of AWKWARD) {
    const read = parseYaml(`title: ${yamlScalar(value)}`, { version: "1.1", logLevel: "error" });
    assert.deepEqual(read, { title: value }, JSON.stringify(value));
  }
});

test("plain values stay unquoted, and a date is only written plain where one is expected", () => {
  assert.equal(yamlScalar("Plain title"), "Plain title");
  assert.equal(yamlScalar("2024-01-20", true), "2024-01-20");
  assert.equal(yamlScalar("2024-01-20"), '"2024-01-20"');
  assert.equal(yamlScalar(""), '""');
});

test("non-printable text is escaped to ASCII, printable text keeps its characters", () => {
  assert.equal(yamlScalar("a b é"), '"a\\u2028b \\u00e9"');
  assert.equal(yamlScalar("a 🎉"), '"a\\u2028\\U0001f389"');
  assert.equal(yamlScalar("it's é"), '"it\'s é"');
});

test("renderPost writes frontmatter that parses, the body, and the source line", () => {
  const meta: PostMetadata = { title: "[Link] A Thing", url: "https://x/y", slug: "2024-01-20", published: "2024-01-20", author: "Yes", extra: {} };
  const text = renderPost(meta, "Body\n\n", "substack");
  const fm = frontmatter(text);
  assert.equal(fm.title, "[Link] A Thing");
  assert.equal(fm.author, "Yes");
  assert.equal(fm.slug, "2024-01-20");
  assert.ok(fm.published instanceof Date);
  assert.ok(text.endsWith("\nBody\n\n---\nSource: https://x/y\n"), text);
});

test("htmlToMarkdown writes what the Python ingesters wrote: ATX headings, '- ' bullets, '---' rules, one-line image links", () => {
  assert.equal(htmlToMarkdown("<h2>Head</h2><p>a<hr>b</p>"), "## Head\n\na\n\n---\n\nb");
  assert.equal(htmlToMarkdown("<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol start=\"3\"><li>x</li><li>y</li></ol>"), "- one\n  - nested\n- two\n\n3. x\n4. y");
  assert.equal(htmlToMarkdown("<p>Do [X], not non-X; 2*3 and snake_case, <em>em</em> <strong>strong</strong></p>"), "Do [X], not non-X; 2\\*3 and snake\\_case, *em* **strong**");
  assert.equal(
    htmlToMarkdown('<a href="https://x/y_(1)"><div><img src="https://i/a.png" alt="pic"></div></a>'),
    "[![pic](https://i/a.png)](https://x/y_\\(1\\))",
  );
  assert.equal(htmlToMarkdown("<p>line one<br>line two &nbsp;</p>"), "line one\nline two");
});

// ---- Substack -----------------------------------------------------------------------

const BASE = "https://writer.substack.com";
const sitemap = (...entries: [string, string][]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries
    .map(([loc, lastmod]) => `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("")}</urlset>`;
const substackPage = (title: string, body: string, extra = "") => `<html><head>
  <meta property="og:title" content="og ${title}"><meta name="author" content="Writer W">
  <meta property="article:published_time" content="2026-05-04T10:00:00Z"></head>
  <body><article><h1 class="post-title published">${title}</h1>
  <div class="available-content"><div class="body markup">${body}
  <div class="subscription-widget-wrap">Subscribe now</div><div class="button-wrapper">Share</div></div></div>${extra}</article></body></html>`;

test("substack: lists newest first from the sitemap, fetches each body, strips the widgets", async (t) => {
  const dir = tmp(t);
  const { fetchFn, calls } = fakeFetch({
    [`${BASE}/sitemap.xml`]: sitemap([`${BASE}/p/old`, "2026-01-01"], [`${BASE}/about`, "2026-06-01"], [`${BASE}/p/new`, "2026-05-04"]),
    [`${BASE}/p/new`]: substackPage("Banter", "<p>I run into <em>a lot</em> of people.</p><h2>Part</h2><ul><li>one</li><li>two</li></ul>"),
    [`${BASE}/p/old`]: substackPage("Older", "<p>Old text.</p>"),
  });
  const ing = getIngester({ platform: "substack", url: `${BASE}/` }, dir, { fetch: fetchFn, delayMs: 0 });
  const report = await ing.run();
  assert.deepEqual(report.new, ["new", "old"]);
  assert.equal(report.errors.length, 0);
  const text = post(dir, "substack-new.md");
  assert.deepEqual(
    { ...frontmatter(text), published: undefined },
    { title: "Banter", author: "Writer W", source: `${BASE}/p/new`, published: undefined, platform: "substack", slug: "new" },
  );
  assert.match(text, /I run into \*a lot\* of people\./);
  assert.match(text, /\n## Part\n/);
  assert.match(text, /\n- one\n- two\n/);
  assert.doesNotMatch(text, /Subscribe now|Share/);
  assert.ok(calls.every((c) => (c.init?.headers as Record<string, string>)["User-Agent"].includes("shoulder-advisors")));
});

test("substack: a paywalled post is an error, not a file, and the rest still sync", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = fakeFetch({
    [`${BASE}/sitemap.xml`]: sitemap([`${BASE}/p/paid`, "2026-02-01"], [`${BASE}/p/free`, "2026-01-01"]),
    [`${BASE}/p/paid`]: substackPage("Paid", "<p>teaser</p>", '<div class="paywall"></div>'),
    [`${BASE}/p/free`]: substackPage("Free", "<p>text</p>"),
  });
  const report = await getIngester({ platform: "substack", url: BASE }, dir, { fetch: fetchFn, delayMs: 0 }).run();
  assert.deepEqual(report.new, ["free"]);
  assert.deepEqual(report.errors, [["paid", "Error: paywalled"]]);
  assert.deepEqual(posts(dir), ["substack-free.md"]);
});

test("early exit: stops after five already-ingested posts in a row; full goes on", async (t) => {
  const dir = tmp(t);
  const slugs = Array.from({ length: 8 }, (_, i) => `p${i}`); // p0 is the newest
  const routes: Record<string, Route> = {
    [`${BASE}/sitemap.xml`]: sitemap(...slugs.map((s, i): [string, string] => [`${BASE}/p/${s}`, `2026-01-0${8 - i}`])),
  };
  for (const s of slugs) routes[`${BASE}/p/${s}`] = substackPage(s, `<p>${s}</p>`);
  const { fetchFn, calls } = fakeFetch(routes);
  const make = () => getIngester({ platform: "substack", url: BASE }, dir, { fetch: fetchFn, delayMs: 0 });

  // Seed the first five (newest) as already on disk, so the walk should stop right after them.
  fs.mkdirSync(path.join(dir, "posts"), { recursive: true });
  for (const s of slugs.slice(0, 5)) fs.writeFileSync(path.join(dir, "posts", `substack-${s}.md`), "old");
  const early = await make().run();
  assert.deepEqual([early.new, early.skipped], [[], 5]);
  assert.equal(calls.filter((c) => c.url.includes("/p/")).length, 0, "no post page was requested");

  const full = await make().run(Infinity);
  assert.deepEqual(full.new, ["p5", "p6", "p7"]);
  assert.equal(full.skipped, 5);

  const again = await make().run(Infinity);
  assert.deepEqual([again.new, again.skipped], [[], 8], "a second run adds nothing");
});

test("a slug that could leave posts/ is refused", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = fakeFetch({});
  const ing = getIngester({ platform: "substack", url: BASE }, dir, { fetch: fetchFn, delayMs: 0 });
  assert.throws(() => ing.postPath({ slug: "../../x", title: "", url: "", published: "", author: "", extra: {} }), /unsafe slug/);
});

test("a 429 or 503 is retried and then succeeds; other errors, and too many 429s, are not retried", async (t) => {
  const dir = tmp(t);
  const statuses: Record<string, number[]> = { "/p/flaky": [429, 503, 200], "/p/dead": [404], "/p/limited": [429, 429, 429, 429, 429, 200] };
  const seen: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    if (url.endsWith("/sitemap.xml")) return new Response(sitemap([`${BASE}/p/flaky`, "2026-03-01"], [`${BASE}/p/dead`, "2026-02-01"], [`${BASE}/p/limited`, "2026-01-01"]));
    const key = new URL(url).pathname;
    seen.push(key);
    const status = statuses[key].shift()!;
    return status === 200 ? new Response(substackPage("T", "<p>text</p>")) : new Response("", { status, headers: status === 429 ? { "Retry-After": "0" } : {} });
  };
  const report = await getIngester({ platform: "substack", url: BASE }, dir, { fetch: fetchFn, delayMs: 0 }).run();
  assert.deepEqual(report.new, ["flaky"]);
  assert.deepEqual(report.errors, [["dead", `Error: HTTP 404 for ${BASE}/p/dead`], ["limited", `Error: HTTP 429 for ${BASE}/p/limited`]]);
  assert.deepEqual(seen.filter((p) => p === "/p/flaky").length, 3);
  assert.equal(seen.filter((p) => p === "/p/dead").length, 1);
  assert.equal(seen.filter((p) => p === "/p/limited").length, 5, "the first try and four retries");
});

test("retryDelayMs: Retry-After in seconds or as a date, else doubling from 2s, never over a minute", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  assert.equal(retryDelayMs("7", 0, now), 7000);
  assert.equal(retryDelayMs("Sat, 07 Nov 2026 00:00:12 GMT", 3, now), 12_000);
  assert.equal(retryDelayMs("Fri, 06 Nov 2026 00:00:00 GMT", 0, now), 0, "a date in the past is no wait");
  assert.equal(retryDelayMs("86400", 0, now), 60_000);
  assert.deepEqual([null, "", "soon"].map((h) => retryDelayMs(h, 2, now)), [8000, 8000, 8000]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(null, n, now)), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
});

// ---- LessWrong ----------------------------------------------------------------------

const GQL = "https://www.lesswrong.com/graphql";
/** A LessWrong GraphQL server with `n` posts (id p0 newest), answering by the query's shape. */
function lessWrongServer(n: number, opts: { emptyBody?: string[] } = {}) {
  const requests: any[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    assert.equal(url, GQL);
    const { query, variables } = JSON.parse(String(init?.body));
    requests.push({ query, variables });
    let data: any;
    if (query.includes("user(input")) {
      data = { user: { result: variables.slug === "ghost-user" ? null : { _id: "u1", displayName: "Duncan Sabien (Inactive)", slug: variables.slug } } };
    } else if (query.includes("posts(input")) {
      const all = Array.from({ length: n }, (_, i) => ({
        _id: `p${i}`, slug: `post-${i}`, title: `Post ${i}`, postedAt: `2022-12-${String(28 - (i % 28)).padStart(2, "0")}T12:00:00.000Z`,
        pageUrl: `https://www.lesswrong.com/posts/p${i}/post-${i}`, baseScore: 100 - i,
      }));
      data = { posts: { results: all.slice(variables.offset, variables.offset + variables.limit) } };
    } else {
      const id: string = variables.id;
      data = { post: { result: { htmlBody: opts.emptyBody?.includes(id) ? "  " : `<h2>Heading ${id}</h2><p>Text of ${id}.</p>` } } };
    }
    return new Response(JSON.stringify({ data }));
  };
  return { fetchFn, requests };
}

test("lesswrong: resolves the user, pages through the posts, fills in author and date", async (t) => {
  const dir = tmp(t);
  const { fetchFn, requests } = lessWrongServer(120);
  const ing = getIngester({ platform: "lesswrong", user: "duncan-sabien-inactive" }, dir, { fetch: fetchFn, delayMs: 0 });
  const metas = await collect(ing.listPosts());
  assert.equal(metas.length, 120);
  assert.deepEqual(requests.filter((r) => r.variables.offset !== undefined).map((r) => r.variables.offset), [0, 50, 100]);
  assert.deepEqual(metas[0], {
    slug: "post-0", title: "Post 0", url: "https://www.lesswrong.com/posts/p0/post-0", published: "2022-12-28",
    author: "Duncan Sabien (Inactive)", extra: { id: "p0", baseScore: 100 },
  });
});

test("lesswrong: writes the post, and reports an empty body as an error", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = lessWrongServer(3, { emptyBody: ["p1"] });
  const report = await getIngester({ platform: "lesswrong", user: "someone" }, dir, { fetch: fetchFn, delayMs: 0 }).run();
  assert.deepEqual(report.new, ["post-0", "post-2"]);
  assert.deepEqual(report.errors, [["post-1", "Error: empty htmlBody (possibly draft or deleted)"]]);
  assert.match(post(dir, "lesswrong-post-0.md"), /\n## Heading p0\n\nText of p0\.\n/);
});

test("lesswrong: max_posts caps the list; the top view turns early exit off", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = lessWrongServer(120);
  const capped = getIngester({ platform: "lesswrong", user: "u", max_posts: 55 }, dir, { fetch: fetchFn, delayMs: 0 });
  assert.equal((await collect(capped.listPosts())).length, 55);
  assert.equal(capped.supportsEarlyExit, true);
  const top = getIngester({ platform: "lesswrong", user: "u", view: "top" }, dir, { fetch: fetchFn, delayMs: 0 });
  assert.equal(top.supportsEarlyExit, false);
});

test("lesswrong: bad config and an unknown user are errors", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = lessWrongServer(1);
  const opts = { fetch: fetchFn, delayMs: 0 };
  assert.throws(() => getIngester({ platform: "lesswrong" }, dir, opts), /requires 'user'/);
  assert.throws(() => getIngester({ platform: "lesswrong", user: "u", view: "new" }, dir, opts), /view must be one of/);
  for (const bad of [0, -1, 1.5, "7"]) {
    assert.throws(() => getIngester({ platform: "lesswrong", user: "u", max_posts: bad }, dir, opts), /max_posts must be a positive integer/);
  }
  await assert.rejects(collect(getIngester({ platform: "lesswrong", user: "ghost-user" }, dir, opts).listPosts()), /no such lesswrong user: ghost-user/);
});

// ---- Medium -------------------------------------------------------------------------

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Stories</title>
<item><title><![CDATA[Resensitizing]]></title><link>https://medium.com/@ThingMaker/resensitizing-cb24e5e533e9?source=rss-afd4fe84e81b------2</link>
<dc:creator><![CDATA[Duncan A Sabien]]></dc:creator><pubDate>Thu, 24 Sep 2020 17:53:51 GMT</pubDate>
<content:encoded><![CDATA[<p><em>Author’s note:</em> the first plane crash took almost a week.</p><p>Two full planes.</p>]]></content:encoded></item>
<item><title>No content</title><link>https://medium.com/@ThingMaker/empty-1</link><pubDate>not a date</pubDate></item>
<item><title>No link</title></item>
</channel></rss>`;

test("medium: reads the RSS feed, with the slug from the link and the date from pubDate", async (t) => {
  const dir = tmp(t);
  const { fetchFn, calls } = fakeFetch({ "https://medium.com/feed/@ThingMaker": FEED });
  const ing = getIngester({ platform: "medium", user: "@ThingMaker" }, dir, { fetch: fetchFn, delayMs: 0 });
  const report = await ing.run();
  assert.deepEqual(report.new, ["resensitizing-cb24e5e533e9"]);
  assert.deepEqual(report.errors, [["empty-1", "Error: no content:encoded in RSS item"]]);
  assert.equal(calls.length, 1, "the feed is fetched once");
  const text = post(dir, "medium-resensitizing-cb24e5e533e9.md");
  const fm = frontmatter(text);
  assert.equal(fm.title, "Resensitizing");
  assert.equal(fm.author, "Duncan A Sabien");
  assert.equal(fm.source, "https://medium.com/@ThingMaker/resensitizing-cb24e5e533e9?source=rss-afd4fe84e81b------2");
  assert.equal(fm.published.toISOString().slice(0, 10), "2020-09-24");
  assert.match(text, /\*Author’s note:\* the first plane crash took almost a week\.\n\nTwo full planes\./);
  const empty = (await collect(ing.listPosts())).find((m) => m.slug === "empty-1")!;
  assert.deepEqual([empty.published, empty.author], ["", "ThingMaker"], "no date, and the user stands in for a missing creator");
});

// ---- WordPress and Ghost ------------------------------------------------------------

const WP = "https://blog.example";
const sitemapIndex = (...locs: string[]) =>
  `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("")}</sitemapindex>`;
const wpPage = (title: string, body: string) => `<html><head>
  <meta name="author" content="https://blog.example/author/jane"><meta property="article:author" content="Jane Doe"></head>
  <body><h1 class="entry-title">${title}</h1><time class="entry-date" datetime="2020-03-04T00:00:00Z"></time>
  <div class="entry-content">${body}<div class="sharedaddy">Share this</div><script>track()</script><div id="comments">12 comments</div></div></body></html>`;

test("wordpress: walks a sitemap index, filters sub-sitemaps, honours exclusions and max_posts", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = fakeFetch({
    [`${WP}/wp-sitemap.xml`]: sitemapIndex(`${WP}/wp-sitemap-posts-post-1.xml`, `${WP}/wp-sitemap-pages-1.xml`),
    [`${WP}/wp-sitemap-posts-post-1.xml`]: sitemap([`${WP}/a/`, "2020-01-01"], [`${WP}/open-thread-5/`, "2020-03-01"], [`${WP}/b/`, "2020-02-01"], [`${WP}/c/`, "2019-01-01"]),
    [`${WP}/a/`]: wpPage("Post A", "<p>A text</p>"),
    [`${WP}/b/`]: wpPage("Post B", "<p>B text</p>"),
  });
  const config = { platform: "wordpress", url: WP, exclude_url_patterns: ["/open-thread-"], max_posts: 2 };
  const ing = getIngester(config, dir, { fetch: fetchFn, delayMs: 0 });
  assert.deepEqual((await collect(ing.listPosts())).map((m) => m.slug), ["b", "a"]);
  const report = await ing.run();
  assert.deepEqual(report.new, ["b", "a"]);
  const text = post(dir, "wordpress-b.md");
  const fm = frontmatter(text);
  assert.equal(fm.title, "Post B");
  assert.equal(fm.author, "Jane Doe", "the URL-shaped author candidate is passed over");
  assert.match(text, /B text/);
  assert.doesNotMatch(text, /Share this|track\(\)|comments/);
});

test("wordpress: falls back to /sitemap.xml, and reuses a flat urlset it already fetched", async (t) => {
  const dir = tmp(t);
  const { fetchFn, calls } = fakeFetch({
    [`${WP}/sitemap.xml`]: sitemap([`${WP}/only/`, "2020-01-01"]),
    [`${WP}/only/`]: wpPage("Only", "<p>text</p>"),
  });
  const ing = getIngester({ platform: "wordpress", url: WP, author: "Fallback Author" }, dir, { fetch: fetchFn, delayMs: 0 });
  const metas = await collect(ing.listPosts());
  assert.deepEqual(metas.map((m) => [m.slug, m.author]), [["only", "Fallback Author"]]);
  assert.equal(calls.filter((c) => c.url === `${WP}/sitemap.xml`).length, 1, "the flat sitemap is fetched once");
});

test("wordpress: a selector list that is not a list of strings is refused", (t) => {
  const dir = tmp(t);
  assert.throws(() => getIngester({ platform: "wordpress", url: WP, body_selectors: "div.x" }, dir), /body_selectors must be a list of strings/);
  assert.throws(() => getIngester({ platform: "wordpress" }, dir), /requires 'url'/);
});

test("ghost: its own defaults and its own file prefix, over the WordPress machinery", async (t) => {
  const dir = tmp(t);
  const { fetchFn } = fakeFetch({
    "https://ghost.example/sitemap.xml": sitemapIndex("https://ghost.example/sitemap-pages.xml", "https://ghost.example/sitemap-posts.xml"),
    "https://ghost.example/sitemap-posts.xml": sitemap(["https://ghost.example/guilt/", "2016-01-01"]),
    "https://ghost.example/guilt/": `<html><body><h1 class="post-title">Guilt</h1>
      <section class="post-content"><p>Guilt is a <strong>signal</strong>.</p></section><time datetime="2016-01-02T00:00:00Z"></time></body></html>`,
  });
  const ing = getIngester({ platform: "ghost", url: "https://ghost.example", author: "Nate Soares" }, dir, { fetch: fetchFn, delayMs: 0 });
  assert.equal(ing.platform, "ghost");
  assert.deepEqual((await ing.run()).new, ["guilt"]);
  const text = post(dir, "ghost-guilt.md");
  assert.deepEqual([frontmatter(text).platform, frontmatter(text).author, frontmatter(text).title], ["ghost", "Nate Soares", "Guilt"]);
  assert.match(text, /Guilt is a \*\*signal\*\*\./);
});

test("a config naming no platform, or an unknown one, is refused with the known list", (t) => {
  const dir = tmp(t);
  assert.throws(() => getIngester({}, dir), /missing 'platform'/);
  assert.throws(() => getIngester({ platform: "toString" }, dir), /unknown platform "toString"; known: ghost, lesswrong, medium, substack, wordpress/);
});

// ---- the command --------------------------------------------------------------------

function corpus(t: TestContext, writers: Record<string, string | null>) {
  const root = tmp(t);
  for (const [name, sources] of Object.entries(writers)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    if (sources !== null) fs.writeFileSync(path.join(root, name, "sources.yaml"), sources);
  }
  return root;
}
const SUBSTACK_SOURCES = `sources:\n  - platform: substack\n    url: ${BASE}\n`;
const substackSite = () => fakeFetch({
  [`${BASE}/sitemap.xml`]: sitemap([`${BASE}/p/one`, "2026-01-01"]),
  [`${BASE}/p/one`]: substackPage("One", "<p>one</p>"),
});

test("syncWriter: runs every source of the writer's sources.yaml and reports", async (t) => {
  const corpusRoot = corpus(t, { duncan: SUBSTACK_SOURCES });
  const { fetchFn } = substackSite();
  const { out, lines, errors } = sink();
  assert.equal(await syncWriter("duncan", { corpusRoot, out, fetch: fetchFn, delayMs: 0 }), 0);
  assert.deepEqual(lines, ["Syncing: duncan", "  substack: +1 new, 0 skipped, 0 errors"]);
  assert.deepEqual(errors, []);
  assert.deepEqual(posts(dataDir("duncan", corpusRoot)), ["substack-one.md"]);
  assert.equal(fs.existsSync(path.join(corpusRoot, "duncan", "posts")), false, "posts go to the private data, not beside sources.yaml");

  const second = sink();
  assert.equal(await syncWriter("duncan", { corpusRoot, out: second.out, fetch: fetchFn, delayMs: 0, full: true }), 0);
  assert.deepEqual(second.lines, ["Syncing: duncan  (full catch-up)", "  substack: +0 new, 1 skipped, 0 errors"]);
});

test("syncWriter: exit 1 with no sources.yaml, 0 with an empty one, 2 when a source or a post fails", async (t) => {
  const corpusRoot = corpus(t, {
    none: null,
    empty: "sources: []\n",
    odd: `sources:\n  - platform: myspace\n  - platform: substack\n    url: ${BASE}\n`,
    paywalled: SUBSTACK_SOURCES,
  });
  const run = async (name: string, fetchFn: FetchFn = fakeFetch({}).fetchFn) => {
    const s = sink();
    return { code: await syncWriter(name, { corpusRoot, out: s.out, fetch: fetchFn, delayMs: 0 }), ...s };
  };
  const none = await run("none");
  assert.equal(none.code, 1);
  assert.match(none.errors[0], /none[\\/]sources\.yaml not found/);
  const empty = await run("empty");
  assert.equal(empty.code, 0);
  assert.match(empty.lines[0], /warning: no sources configured/);

  const odd = await run("odd");
  assert.equal(odd.code, 2);
  assert.match(odd.lines.join("\n"), /myspace: skipped \(Error: unknown platform "myspace"/);
  assert.match(odd.errors.join("\n"), /substack: FAILED \(Error: HTTP 404 for .*sitemap\.xml\)/);

  const paywall = await run("paywalled", fakeFetch({
    [`${BASE}/sitemap.xml`]: sitemap([`${BASE}/p/paid`, "2026-01-01"]),
    [`${BASE}/p/paid`]: substackPage("Paid", "<p>teaser</p>", '<div class="paywall-jump"></div>'),
  }).fetchFn);
  assert.equal(paywall.code, 2);
  assert.deepEqual(paywall.errors, ["    error: paid: Error: paywalled"]);
});

test("syncAll: syncs each writer that has a sources.yaml, in name order, and ignores the rest", async (t) => {
  const corpusRoot = corpus(t, { b: SUBSTACK_SOURCES, a: SUBSTACK_SOURCES, notes: null });
  fs.writeFileSync(path.join(corpusRoot, "README.md"), "not a writer");
  const { fetchFn } = substackSite();
  const { out, lines } = sink();
  assert.equal(await syncAll({ corpusRoot, out, fetch: fetchFn, delayMs: 0 }), 0);
  assert.deepEqual(lines.filter((l) => l.startsWith("Syncing")), ["Syncing: a", "Syncing: b"]);
  assert.equal(fs.existsSync(dataDir("notes", corpusRoot)), false);

  const missing = sink();
  assert.equal(await syncAll({ corpusRoot: path.join(corpusRoot, "nope"), out: missing.out }), 0);
  assert.deepEqual(missing.lines, ["no corpus/ directory"]);
});

test("main: wants exactly one of a writer or --all", async () => {
  for (const argv of [[], ["a", "b"], ["--all", "a"], ["--nope"]]) {
    const { out, errors } = sink();
    assert.equal(await main(argv, out), 2, JSON.stringify(argv));
    assert.match(errors.join("\n"), /usage: npm run sync-posts/);
  }
});
