// The external-link check (scripts/links.mts). Every request goes to a stub server on 127.0.0.1 or to a stubbed
// fetch: `npm test` never touches the real network.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  extractLinks, externalUrl, publishedPages, collectLinks, siteBase, allowlistProblems, loadAllowlist, allowMatches, tolerates,
  checkUrl, checkAll, classify, movedTo, buildReport, formatConsole, formatMarkdown, digest, digestOf, syncIssue, retryAfterMs, main,
  USER_AGENT, ISSUE_LABEL, ISSUE_TITLE,
  type AllowEntry, type CheckOptions, type FetchLike, type Gh, type LinkPage, type LinkReport, type LinkUse, type Output, type Probe,
} from "../scripts/links.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- The stub server -----------------------------------------------------------------

interface Seen { method: string; path: string; ua: string }
interface Stub { base: string; seen: Seen[]; close: () => Promise<void> }

/** A server whose routes play every kind of site the check meets. */
async function stub(t: TestContext): Promise<Stub> {
  const seen: Seen[] = [];
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const p = req.url ?? "/";
    seen.push({ method: req.method ?? "", path: p, ua: String(req.headers["user-agent"] ?? "") });
    const n = (hits.get(p) ?? 0) + 1;
    hits.set(p, n);
    const send = (status: number, headers: Record<string, string> = {}) => { res.writeHead(status, headers); res.end(req.method === "HEAD" ? undefined : "body"); };
    switch (p) {
      case "/ok": return send(200);
      case "/head-405": return send(req.method === "HEAD" ? 405 : 200);
      case "/head-404": return send(req.method === "HEAD" ? 404 : 200);
      case "/moved": return send(301, { Location: "/ok" });
      case "/moved-308": return send(308, { Location: "/ok" });
      case "/moved-relative": return send(301, { Location: "ok" });
      case "/moved-twice": return send(301, { Location: "/moved" });
      case "/temp": return send(302, { Location: "/ok" });
      case "/temp-then-moved": return send(302, { Location: "/moved" });
      case "/moved-then-temp": return send(301, { Location: "/temp" });
      case "/moved-to-gone": return send(301, { Location: "/gone" });
      case "/loop": return send(302, { Location: "/loop" });
      case "/gone": return send(404);
      case "/410": return send(410);
      case "/flaky": return send(n <= 1 ? 503 : 200);
      case "/busy": return send(n <= 1 ? 429 : 200, { "Retry-After": "2" });
      case "/down": return send(503);
      case "/down-once": return send(503);
      case "/hang": return; // never answers
      default: return send(404);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const close = async () => { server.closeAllConnections(); server.close(); await once(server, "close").catch(() => {}); };
  t.after(close);
  return { base: `http://127.0.0.1:${address.port}`, seen, close };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const s = http.createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const address = s.address();
  assert.ok(address && typeof address !== "string");
  s.close();
  await once(s, "close");
  return address.port;
}

/** Fast options: a short timeout and a sleep that records instead of waiting. */
function fast(waits: number[] = []): CheckOptions {
  return { timeoutMs: 500, sleep: async (ms: number) => { waits.push(ms); } };
}

// ---- Parsing --------------------------------------------------------------------------

test("extractLinks reads href and src of real markup, decoded, de-duplicated, without fragments", () => {
  const html = `<!doctype html><html><head>
    <link rel="canonical" href="https://site.test/docs/a.html">
    <link rel="preconnect" href="https://fonts.gstatic.com">
    <link rel="stylesheet" href="https://cdn.test/style.css">
    <script src="https://cdn.test/lib.js"></script>
    <script>const s = '<a href="https://in-script.test/">';</script>
    <style>a::after { content: '<img src="https://in-style.test/x.png">'; }</style>
  </head><body>
    <!-- <a href="https://in-comment.test/">old</a> -->
    <a href="https://example.test/page?a=1&amp;b=2#section">one</a>
    <a class="x" href='https://example.test/page?a=1&b=2#other'>same page, other fragment</a>
    <a href=https://unquoted.test/path>unquoted</a>
    <a href="//protocol-relative.test/x">protocol-relative</a>
    <a href="../docs/glossary.html">relative</a>
    <a href="#local">fragment</a>
    <a href="mailto:someone@example.test">mail</a>
    <a data-href="https://data-attribute.test/">not an href</a>
    <img src="https://img.test/a.png" alt="">
    <template id="t"><a href="https://in-template.test/">shown later</a></template>
    <code>&lt;a href="https://escaped.test/"&gt;</code>
    <a href="https://site.test/">home</a>
    <a href="https://site.test">home, no slash</a>
  </body></html>`;
  assert.deepEqual(extractLinks(html, "https://site.test/"), [
    "https://cdn.test/style.css",
    "https://cdn.test/lib.js",
    "https://example.test/page?a=1&b=2",
    "https://unquoted.test/path",
    "https://protocol-relative.test/x",
    "https://img.test/a.png",
    "https://in-template.test/",
  ]);
});

test("an out-of-range character reference is left as written, not a crash", () => {
  assert.deepEqual(extractLinks(`<a href="https://a.test/&#x110000;">x</a> <a href="https://b.test/&#99999999;">y</a> <a href="https://c.test/&#x41;">z</a>`), [
    "https://a.test/&",
    "https://b.test/&",
    "https://c.test/A",
  ]);
});

test("externalUrl keeps only absolute http(s) URLs off the site, and is not fooled by a lookalike host", () => {
  assert.equal(externalUrl("HTTPS://Example.TEST/a#b"), "https://example.test/a");
  assert.equal(externalUrl("javascript:alert(1)"), null);
  assert.equal(externalUrl("https://"), null);
  assert.equal(externalUrl("https://site.test/docs/x.html", "https://site.test/"), null);
  assert.equal(externalUrl("https://site.test.evil.test/", "https://site.test/"), "https://site.test.evil.test/");
  // A site under a sub-path owns only that path.
  assert.equal(externalUrl("https://user.github.io/other/", "https://user.github.io/blog/"), "https://user.github.io/other/");
  assert.equal(externalUrl("https://user.github.io/blog", "https://user.github.io/blog/"), null);
});

/** A repo in a temporary directory: `pages` maps a root-relative path to its HTML. */
function repo(t: TestContext, pages: Record<string, string>, homepage = "https://site.test/"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-links-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ homepage }));
  for (const [file, html] of Object.entries(pages)) fs.writeFileSync(path.join(root, file), html);
  return root;
}

const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test("publishedPages reads the home page and readable docs, not sealed shells, private sources or examples", (t) => {
  const root = repo(t, {
    "index.html": page("", `<a href="https://home.test/">x</a>`),
    "docs/post.html": page(`<meta name="bh:kind" content="explainer">`, `<a href="https://post.test/">x</a>`),
    "docs/hidden.html": page(`<meta name="bh:unlisted" content="true">`, `<a href="https://shared.test/">x</a>`),
    "docs/example.html": page(`<meta name="bh:example" content="true">`, `<a href="https://example-only.test/">x</a>`),
    "docs/sealed.html": page(`<meta name="robots" content="noindex">`, `<script id="sealed-payload" type="application/octet-stream">AAAA</script><a href="https://sealed.test/">x</a>`),
    "docs/draft.private.html": page("", `<a href="https://private.test/">x</a>`),
    "docs/commented.html": page(`<!-- <meta name="bh:example" content="true"> -->`, `<a href="https://shared.test/">x</a>`),
    "docs/sealed-meta.html": page(`<meta name="bh:sealed" content="1">`, `<a href="https://sealed.test/">x</a>`),
    "docs/quotes-marker.html": page("", `<pre><code>&lt;meta name="bh:example" content="true"&gt;</code></pre><meta name="bh:example" content="true">`),
  });
  assert.deepEqual(publishedPages(root), [
    { href: "index.html", unlisted: false },
    { href: "docs/commented.html", unlisted: false },
    { href: "docs/hidden.html", unlisted: true },
    { href: "docs/post.html", unlisted: false },
    { href: "docs/quotes-marker.html", unlisted: false },
  ]);
  assert.deepEqual(collectLinks(root, {}).uses, [
    { url: "https://home.test/", pages: ["index.html"] },
    { url: "https://post.test/", pages: ["docs/post.html"] },
    { url: "https://shared.test/", pages: ["docs/commented.html", "docs/hidden.html"] },
  ]);
});

test("siteBase comes from BH_SITE_URL, else homepage, and always ends in a slash", (t) => {
  const root = repo(t, {}, "https://site.test/blog");
  assert.equal(siteBase(root, {}), "https://site.test/blog/");
  assert.equal(siteBase(root, { BH_SITE_URL: "https://fork.test/" }), "https://fork.test/");
  assert.equal(siteBase(repo(t, {}, "not a url"), {}), "");
});

test("the live site has external links to check, the glossary among its pages, and none of its own URLs", () => {
  const { pages, uses } = collectLinks(ROOT, {});
  assert.ok(uses.length > 10, `found ${uses.length} external URLs`);
  assert.ok(pages.some((p) => p.href === "docs/glossary.html"), "the glossary is read");
  for (const u of uses) assert.doesNotMatch(u.url, /^https:\/\/bitwise\.john-ky\.io\//, "the site's own URLs are left to check");
});

// ---- Requests --------------------------------------------------------------------------

test("checkUrl: a working URL takes one HEAD, sent with the generic User-Agent", async (t) => {
  const s = await stub(t);
  const r = await checkUrl(`${s.base}/ok`, fast());
  assert.deepEqual({ status: r.status, method: r.method, attempts: r.attempts, redirects: r.redirects }, { status: 200, method: "HEAD", attempts: 1, redirects: [] });
  assert.deepEqual(s.seen, [{ method: "HEAD", path: "/ok", ua: USER_AGENT }]);
  assert.doesNotMatch(USER_AGENT, /bitwise|john|newhoggy|github|@|https?:/i, "the User-Agent names no project, person or contact");
});

test("checkUrl falls back to GET when HEAD is refused or answers 404", async (t) => {
  const s = await stub(t);
  for (const route of ["/head-405", "/head-404"]) {
    const r = await checkUrl(`${s.base}${route}`, fast());
    assert.equal(r.status, 200, route);
    assert.equal(r.method, "GET", route);
  }
  assert.deepEqual(s.seen.map((x) => `${x.method} ${x.path}`), ["HEAD /head-405", "GET /head-405", "HEAD /head-404", "GET /head-404"]);
});

test("checkUrl follows redirects by hand and records each hop", async (t) => {
  const s = await stub(t);
  const r = await checkUrl(`${s.base}/temp-then-moved`, fast());
  assert.equal(r.status, 200);
  assert.deepEqual(r.redirects, [{ url: `${s.base}/temp-then-moved`, status: 302 }, { url: `${s.base}/moved`, status: 301 }]);
  assert.equal(r.final, `${s.base}/ok`);
  const relative = await checkUrl(`${s.base}/moved-relative`, fast());
  assert.equal(relative.final, `${s.base}/ok`);
});

test("checkUrl reports a redirect loop as an error, without retrying it", async (t) => {
  const s = await stub(t);
  const waits: number[] = [];
  const r = await checkUrl(`${s.base}/loop`, fast(waits));
  assert.equal(r.status, 0);
  assert.equal(r.error, "redirect loop");
  assert.equal(r.attempts, 1);
  assert.deepEqual(waits, []);
});

test("checkUrl retries 5xx and 429 with backoff, honouring a short Retry-After, and waits before the GET", async (t) => {
  const s = await stub(t);
  const waits: number[] = [];
  const methods = (route: string) => s.seen.filter((x) => x.path === route).map((x) => x.method);
  const flaky = await checkUrl(`${s.base}/flaky`, { ...fast(waits), backoffMs: [100, 300] });
  assert.deepEqual({ status: flaky.status, attempts: flaky.attempts, method: flaky.method }, { status: 200, attempts: 2, method: "GET" });
  // A 503 to HEAD asks us to slow down: the GET comes after the backoff, not straight away.
  assert.deepEqual(methods("/flaky"), ["HEAD", "GET"]);
  const busy = await checkUrl(`${s.base}/busy`, { ...fast(waits), backoffMs: [100, 300] });
  assert.deepEqual({ status: busy.status, attempts: busy.attempts }, { status: 200, attempts: 2 });
  assert.deepEqual(waits, [100, 2000], "the backoff, then Retry-After: 2");
  const down = await checkUrl(`${s.base}/down`, { ...fast(waits), attempts: 3, backoffMs: [100, 300] });
  assert.deepEqual({ status: down.status, attempts: down.attempts }, { status: 503, attempts: 3 });
  assert.deepEqual(waits.slice(2), [100, 300]);
  assert.deepEqual(methods("/down"), ["HEAD", "GET", "GET"]);
  // With no attempt left to wait for, the GET goes at once.
  const once = await checkUrl(`${s.base}/down-once`, { ...fast(waits), attempts: 1 });
  assert.deepEqual({ status: once.status, method: once.method }, { status: 503, method: "GET" });
  assert.deepEqual(methods("/down-once"), ["HEAD", "GET"]);
});

test("checkUrl does not retry a 404 or a 410", async (t) => {
  const s = await stub(t);
  for (const [route, status] of [["/gone", 404], ["/410", 410]] as const) {
    const r = await checkUrl(`${s.base}${route}`, fast());
    assert.deepEqual({ status: r.status, attempts: r.attempts, method: r.method }, { status, attempts: 1, method: "GET" });
  }
});

test("checkUrl times out a server that never answers, and names a refused connection", async (t) => {
  const s = await stub(t);
  const hang = await checkUrl(`${s.base}/hang`, { ...fast(), timeoutMs: 200, attempts: 2 });
  assert.equal(hang.status, 0);
  assert.equal(hang.error, "timeout after 0.2s");
  assert.equal(hang.attempts, 2);
  const port = await closedPort();
  const refused = await checkUrl(`http://127.0.0.1:${port}/`, { ...fast(), attempts: 1 });
  assert.equal(refused.status, 0);
  assert.match(refused.error ?? "", /ECONNREFUSED/);
});

test("checkUrl never throws, even when fetch itself does", async () => {
  const fetch: FetchLike = async () => { throw new Error("boom"); };
  const r = await checkUrl("https://x.test/", { fetch, attempts: 1 });
  assert.deepEqual({ status: r.status, error: r.error }, { status: 0, error: "boom" });
});

test("retryAfterMs reads seconds and HTTP dates", () => {
  assert.equal(retryAfterMs("5"), 5000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(retryAfterMs("soon"), undefined);
  assert.equal(retryAfterMs(null), undefined);
});

test("checkAll keeps to the concurrency limit and to the per-host limit", async () => {
  let inFlight = 0, most = 0;
  const perHost = new Map<string, number>(), mostPerHost = new Map<string, number>();
  const fetch: FetchLike = async (url) => {
    const host = new URL(url).host;
    inFlight++; most = Math.max(most, inFlight);
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    mostPerHost.set(host, Math.max(mostPerHost.get(host) ?? 0, perHost.get(host)!));
    await new Promise((r) => setTimeout(r, 5));
    inFlight--; perHost.set(host, perHost.get(host)! - 1);
    return new Response(null, { status: 200 });
  };
  const uses: LinkUse[] = [];
  for (let i = 0; i < 12; i++) uses.push({ url: `https://busy.test/${i}`, pages: ["docs/a.html"] });
  for (let i = 0; i < 6; i++) uses.push({ url: `https://h${i}.test/`, pages: ["docs/a.html"] });
  const results = await checkAll(uses, { fetch, concurrency: 4, perHost: 2 });
  assert.equal(results.size, uses.length);
  assert.ok(most <= 4, `at most 4 at once (saw ${most})`);
  assert.equal(most, 4, "the pool is used");
  assert.ok([...mostPerHost.values()].every((n) => n <= 2), "at most 2 on one host");
});

// ---- Classification and the allowlist ------------------------------------------------------

const hop = (status: number, url = "https://a.test/") => ({ url, status });

test("classify: broken is no response or >= 400; moved needs the link's own first hop to be permanent", () => {
  assert.equal(classify({ status: 0, redirects: [] }), "broken");
  assert.equal(classify({ status: 404, redirects: [] }), "broken");
  assert.equal(classify({ status: 200, redirects: [hop(301)] }), "moved");
  assert.equal(classify({ status: 200, redirects: [hop(308)] }), "moved");
  assert.equal(classify({ status: 200, redirects: [hop(302)] }), "ok");
  assert.equal(classify({ status: 200, redirects: [hop(302), hop(301)] }), "ok", "a DOI's 302, then the publisher's own move");
  assert.equal(classify({ status: 404, redirects: [hop(301)] }), "broken");
  assert.equal(movedTo({ redirects: [hop(301, "https://a.test/"), hop(301, "https://b.test/")], final: "https://c.test/" }), "https://c.test/");
  assert.equal(movedTo({ redirects: [hop(301, "https://a.test/"), hop(302, "https://b.test/")], final: "https://c.test/" }), "https://b.test/");
});

test("allowlistProblems accepts a valid list and names each mistake", () => {
  assert.deepEqual(allowlistProblems([]), []);
  assert.deepEqual(allowlistProblems([{ url: "https://a.test/*", accept: [403, "timeout", "error", "redirect"], reason: "bot wall" }]), []);
  assert.deepEqual(allowlistProblems({}), ["the allowlist must be a JSON array of { url, accept, reason } entries"]);
  const problems = allowlistProblems([
    "x",
    { url: "ftp://a.test/", accept: [403], reason: "r" },
    { url: "https://a.test/*/b", accept: [403], reason: "r" },
    { url: "https://a.test/", accept: [], reason: "r" },
    { url: "https://a.test/", accept: [99, "sometimes"], reason: "r" },
    { url: "https://a.test/", accept: [403], reason: " " },
    { url: "https://a.test/", accept: [403], reason: "r", note: "extra" },
  ]);
  assert.equal(problems.length, 8, problems.join("\n"));
  assert.match(problems.join("\n"), /entry 1 is not an object/);
  assert.match(problems.join("\n"), /entry 7 has an unknown field "note"/);
});

test("the committed links-allowlist.json is valid, and every entry has a reason", () => {
  const entries = loadAllowlist(path.join(ROOT, "links-allowlist.json"));
  for (const e of entries) assert.ok(e.reason.length > 20, `${e.url}: say why`);
});

test("loadAllowlist: a missing file is an empty list; a malformed one throws", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-links-allow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(loadAllowlist(path.join(dir, "none.json")), []);
  fs.writeFileSync(path.join(dir, "bad.json"), "[{");
  assert.throws(() => loadAllowlist(path.join(dir, "bad.json")), /not valid JSON/);
  fs.writeFileSync(path.join(dir, "wrong.json"), JSON.stringify([{ url: "https://a.test/" }]));
  assert.throws(() => loadAllowlist(path.join(dir, "wrong.json")), /accept/);
});

test("loadAllowlist writes entry URLs as checked URLs are written, so they match", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-links-allow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "allow.json");
  fs.writeFileSync(file, JSON.stringify([
    { url: "https://Example.TEST", accept: [403], reason: "r" },
    { url: "https://Other.test/Path/*", accept: [403], reason: "r" },
  ]));
  const [exact, prefix] = loadAllowlist(file);
  assert.equal(exact!.url, "https://example.test/");
  assert.ok(allowMatches(exact!, externalUrl("https://example.test")!));
  assert.equal(prefix!.url, "https://other.test/Path/*");
  assert.deepEqual(allowlistProblems([{ url: "https://a.test/#frag", accept: [403], reason: "r" }]).length, 1, "a fragment is never part of a checked URL");
});

test("allowMatches takes an exact URL or a prefix ending in *; tolerates matches the outcome", () => {
  const e: AllowEntry = { url: "https://a.test/x/*", accept: [403, "timeout"], reason: "r" };
  assert.ok(allowMatches(e, "https://a.test/x/y"));
  assert.ok(!allowMatches(e, "https://a.test/z"));
  assert.ok(allowMatches({ ...e, url: "https://a.test/x" }, "https://a.test/x"));
  assert.ok(!allowMatches({ ...e, url: "https://a.test/x" }, "https://a.test/x/y"));
  assert.ok(tolerates(e, { outcome: "broken", status: 403 }));
  assert.ok(!tolerates(e, { outcome: "broken", status: 404 }), "a site allowed to refuse bots is still reported when it 404s");
  assert.ok(tolerates(e, { outcome: "broken", status: 0, error: "timeout after 15s" }));
  assert.ok(!tolerates(e, { outcome: "broken", status: 0, error: "ENOTFOUND" }));
  assert.ok(!tolerates(e, { outcome: "moved", status: 200 }));
  assert.ok(tolerates({ ...e, accept: ["redirect"] }, { outcome: "moved", status: 200 }));
});

// ---- Reports ---------------------------------------------------------------------------------

const probe = (p: Partial<Probe>): Probe => ({ status: 200, redirects: [], final: "", method: "HEAD", attempts: 1, ...p });

function sampleReport(extraAllow: AllowEntry[] = []): LinkReport {
  const uses: LinkUse[] = [
    { url: "https://gone.test/", pages: ["docs/a.html", "docs/secret.html"] },
    { url: "https://old.test/", pages: ["index.html"] },
    { url: "https://fine.test/", pages: ["docs/a.html"] },
    { url: "https://wall.test/p", pages: ["docs/a.html"] },
    { url: "https://dns.test/", pages: ["docs/secret.html"] },
  ];
  const probes = new Map<string, Probe>([
    ["https://gone.test/", probe({ status: 404, final: "https://gone.test/", method: "GET" })],
    ["https://old.test/", probe({ redirects: [{ url: "https://old.test/", status: 301 }], final: "https://new.test/" })],
    ["https://fine.test/", probe({ final: "https://fine.test/" })],
    ["https://wall.test/p", probe({ status: 403, final: "https://wall.test/p", method: "GET" })],
    ["https://dns.test/", probe({ status: 0, final: "https://dns.test/", error: "ENOTFOUND", attempts: 3 })],
  ]);
  const pages: LinkPage[] = [{ href: "index.html", unlisted: false }, { href: "docs/a.html", unlisted: false }, { href: "docs/secret.html", unlisted: true }];
  const allow: AllowEntry[] = [{ url: "https://wall.test/*", accept: [403], reason: "refuses automated clients" }, { url: "https://unused.test/", accept: [403], reason: "never seen" }, ...extraAllow];
  return buildReport(uses, probes, allow, pages, { date: "2026-11-16", siteBase: "https://site.test/" });
}

test("buildReport sorts broken, moved, allowlisted, ok and finds unused allowlist entries", () => {
  const r = sampleReport();
  assert.deepEqual(r.results.map((x) => [x.url, x.outcome, !!x.allowed]), [
    ["https://dns.test/", "broken", false],
    ["https://gone.test/", "broken", false],
    ["https://wall.test/p", "broken", true],
    ["https://old.test/", "moved", false],
    ["https://fine.test/", "ok", false],
  ]);
  assert.equal(r.results.find((x) => x.url === "https://old.test/")?.movedTo, "https://new.test/");
  assert.deepEqual(r.unused.map((e) => e.url), ["https://unused.test/"]);
});

test("formatConsole gives each URL's status, error, redirect target and pages, and --quiet drops the fine ones", () => {
  const text = formatConsole(sampleReport());
  assert.match(text, /^Checked 5 external URLs from 3 pages: 2 broken, 1 moved permanently, 1 allowlisted, 1 ok\./);
  assert.match(text, /ERR  https:\/\/dns\.test\/\n\s+error: ENOTFOUND\n\s+pages: docs\/secret\.html/);
  assert.match(text, /moved to: https:\/\/new\.test\//);
  assert.match(text, /allowlisted: refuses automated clients/);
  assert.match(text, /OK \(1\)\n\s+200\s+https:\/\/fine\.test\//);
  assert.match(text, /Unused allowlist entries \(1\)/);
  assert.doesNotMatch(formatConsole(sampleReport(), { quiet: true }), /fine\.test/);
  assert.match(text, /docs\/secret\.html/, "a local run names unlisted pages");
  const redacted = formatConsole(sampleReport(), { redactUnlisted: true });
  assert.doesNotMatch(redacted, /secret/);
  assert.match(redacted, /pages: docs\/a\.html, an unlisted page/);
});

test("formatMarkdown cuts a body that would not fit an issue, and keeps its HTML balanced", () => {
  const r = sampleReport();
  const many = Array.from({ length: 600 }, (_, i) => ({ ...r.results[1]!, url: `https://gone.test/${"x".repeat(80)}/${i}`, allowed: undefined }));
  const allowed = Array.from({ length: 300 }, (_, i) => ({ ...r.results[2]!, url: `https://wall.test/${"y".repeat(80)}/${i}` }));
  const md = formatMarkdown({ ...r, results: [...many, ...allowed] });
  assert.ok(md.length < 65_536, `${md.length} characters`);
  assert.match(md, /cut short here/);
  assert.equal((md.match(/<details>/g) ?? []).length, (md.match(/<\/details>/g) ?? []).length);
  assert.match(md, /Fix or remove each broken link/, "the guidance survives the cut");
});

test("formatMarkdown links the pages, never names an unlisted one, and carries a digest", () => {
  const md = formatMarkdown(sampleReport());
  assert.ok(md.startsWith(`<!-- bh:link-check digest=${digest(sampleReport())} -->`));
  assert.match(md, /\| 404 \| https:\/\/gone\.test\/ \|  \| \[docs\/a\.html\]\(https:\/\/site\.test\/docs\/a\.html\), an unlisted page \|/);
  assert.match(md, /\| https:\/\/old\.test\/ \| https:\/\/new\.test\/ \| \[index\.html\]\(https:\/\/site\.test\/\) \|/);
  assert.match(md, /Allowlisted \(1\)/);
  assert.doesNotMatch(md, /secret/);
  assert.doesNotMatch(md, /fine\.test/, "the issue lists only what needs attention");
});

test("the digest changes with the findings, not with the date, the allowlisted or the fine links", () => {
  const a = sampleReport();
  assert.equal(digest(a), digest({ ...a, date: "2027-01-01" }));
  assert.equal(digest(a), digest({ ...a, results: a.results.filter((r) => r.outcome !== "ok" && !r.allowed) }));
  assert.notEqual(digest(a), digest(sampleReport([{ url: "https://gone.test/", accept: [404], reason: "accepted for the test" }])));
  assert.equal(digestOf(formatMarkdown(a)), digest(a));
  assert.equal(digestOf("no marker"), undefined);
});

// ---- The issue ----------------------------------------------------------------------------

interface Call { args: string[]; input?: string }

/** A fake `gh`: `issues` is what `issue list` returns; every call is recorded. */
function fakeGh(issues: Array<{ number: number; state: string; body: string }>, fail?: string): { gh: Gh; calls: Call[]; verbs: () => string[] } {
  const calls: Call[] = [];
  const gh: Gh = (args, input) => {
    calls.push({ args, ...(input === undefined ? {} : { input }) });
    if (fail && args.slice(0, 2).join(" ") === fail) throw new Error(`gh ${fail} failed`);
    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(issues);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/o/r/issues/9\n";
    return "";
  };
  return { gh, calls, verbs: () => calls.map((c) => [c.args[0], c.args[1], ...(c.args[2] && /^\d+$/.test(c.args[2]) ? [c.args[2]] : [])].join(" ")) };
}

const clean = (): LinkReport => { const r = sampleReport(); return { ...r, results: r.results.filter((x) => x.outcome === "ok") }; };

test("syncIssue opens the issue, labelled, when something needs attention and there is none", () => {
  const report = sampleReport(), md = formatMarkdown(report);
  const f = fakeGh([]);
  assert.equal(syncIssue(report, md, f.gh), "opened https://github.com/o/r/issues/9");
  assert.deepEqual(f.verbs(), ["label create", "issue list", "issue create"]);
  const create = f.calls[2]!;
  assert.deepEqual(create.args, ["issue", "create", "--title", ISSUE_TITLE, "--label", ISSUE_LABEL, "--body-file", "-"]);
  assert.equal(create.input, md);
  assert.ok(f.calls[1]!.args.includes("--state") && f.calls[1]!.args.includes("all"), "closed issues are found too, so there is only ever one");
});

test("syncIssue updates the newest issue, and comments only when the findings changed", () => {
  const report = sampleReport(), md = formatMarkdown(report);
  const same = fakeGh([{ number: 3, state: "OPEN", body: "<!-- bh:link-check digest=0000 -->" }, { number: 7, state: "OPEN", body: md }]);
  assert.equal(syncIssue(report, md, same.gh), "updated #7 (same findings as before)");
  assert.deepEqual(same.verbs(), ["label create", "issue list", "issue edit 7"]);
  const changed = fakeGh([{ number: 7, state: "OPEN", body: "<!-- bh:link-check digest=0000 -->" }]);
  assert.equal(syncIssue(report, md, changed.gh), "updated #7 and commented");
  assert.deepEqual(changed.verbs(), ["label create", "issue list", "issue edit 7", "issue comment 7"]);
  assert.match(changed.calls[3]!.input ?? "", /found 2 broken and 1 moved links/);
});

test("syncIssue reopens a closed issue rather than opening a second one", () => {
  const report = sampleReport(), md = formatMarkdown(report);
  const f = fakeGh([{ number: 7, state: "CLOSED", body: md }]);
  assert.equal(syncIssue(report, md, f.gh), "reopened #7 and commented");
  assert.deepEqual(f.verbs(), ["label create", "issue list", "issue reopen 7", "issue edit 7", "issue comment 7"]);
});

test("syncIssue closes the open issue when nothing needs attention, and otherwise does nothing", () => {
  const report = clean(), md = formatMarkdown(report);
  const open = fakeGh([{ number: 7, state: "OPEN", body: "" }]);
  assert.equal(syncIssue(report, md, open.gh), "closed #7");
  assert.deepEqual(open.verbs(), ["label create", "issue list", "issue comment 7", "issue close 7"]);
  for (const issues of [[], [{ number: 7, state: "CLOSED", body: "" }]]) {
    const f = fakeGh(issues);
    assert.equal(syncIssue(report, md, f.gh), "nothing to report");
    assert.deepEqual(f.verbs(), ["label create", "issue list"]);
  }
});

test("syncIssue lets a failing gh call through, so the job fails loudly", () => {
  const report = sampleReport();
  assert.throws(() => syncIssue(report, formatMarkdown(report), fakeGh([], "issue create").gh), /gh issue create failed/);
});

// ---- main ------------------------------------------------------------------------------------

function sink(): Output & { logs: string[]; errors: string[] } {
  const logs: string[] = [], errors: string[] = [];
  return { logs, errors, log: (...a: unknown[]) => logs.push(a.join(" ")), error: (...a: unknown[]) => errors.push(a.join(" ")) };
}

test("main: exit 1 when a link is broken, 0 once it is allowlisted, and the reports are written", async (t) => {
  const s = await stub(t);
  const root = repo(t, {
    "index.html": page("", `<a href="${s.base}/ok">ok</a>`),
    "docs/post.html": page("", `<a href="${s.base}/gone">gone</a> <a href="${s.base}/moved">moved</a> <a href="${s.base}/temp">temp</a>`),
  });
  const md = path.join(root, "report.md"), json = path.join(root, "report.json"), summary = path.join(root, "summary.md");
  const out = sink();
  assert.equal(await main(["--markdown", md, "--json", json], { GITHUB_STEP_SUMMARY: summary }, out, root, { ...fast(), today: "2026-11-16" }), 1);
  const text = out.logs.join("\n");
  assert.match(text, /4 external URLs from 2 pages: 1 broken, 1 moved permanently, 0 allowlisted, 2 ok/);
  assert.match(text, new RegExp(`moved to: ${s.base}/ok`));
  assert.match(fs.readFileSync(md, "utf8"), /### Broken/);
  assert.equal((JSON.parse(fs.readFileSync(json, "utf8")) as LinkReport).results.length, 4);
  assert.match(fs.readFileSync(summary, "utf8"), /^## External links/);

  fs.writeFileSync(path.join(root, "links-allowlist.json"), JSON.stringify([{ url: `${s.base}/gone`, accept: [404], reason: "accepted for the test" }]));
  assert.equal(await main(["--quiet"], {}, sink(), root, fast()), 0);
});

test("main --issue reports through gh and exits 0, or 2 when gh fails", async (t) => {
  const s = await stub(t);
  const root = repo(t, { "docs/post.html": page("", `<a href="${s.base}/gone">gone</a>`) });
  const ok = fakeGh([]);
  const out = sink();
  assert.equal(await main(["--issue", "--quiet"], {}, out, root, { ...fast(), gh: ok.gh }), 0);
  assert.match(out.logs.join("\n"), /Issue: opened/);
  const bad = sink();
  assert.equal(await main(["--issue"], {}, bad, root, { ...fast(), gh: fakeGh([], "label create").gh }), 2);
  assert.match(bad.errors.join("\n"), /reporting through the issue failed/);
});

test("main exits 2 without touching the issue when nearly every URL got no response (our network, not theirs)", async (t) => {
  const port = await closedPort();
  const links = Array.from({ length: 4 }, (_, i) => `<a href="http://127.0.0.1:${port}/${i}">x</a>`).join(" ");
  const root = repo(t, { "docs/post.html": page("", links) });
  const f = fakeGh([]);
  const out = sink();
  assert.equal(await main(["--issue"], {}, out, root, { ...fast(), attempts: 1, gh: f.gh }), 2);
  assert.match(out.errors.join("\n"), /looks like a network problem/);
  assert.deepEqual(f.calls, []);
});

test("main exits 2, not 1, when the check itself crashes", async (t) => {
  const root = repo(t, { "docs/post.html": page("", `<a href="https://x.test/">x</a>`) });
  const out = sink();
  const sleep = () => { throw new Error("injected crash"); };
  const fetch: FetchLike = async () => new Response(null, { status: 503 });
  assert.equal(await main([], {}, out, root, { fetch, sleep }), 2);
  assert.match(out.errors.join("\n"), /the check failed: Error: injected crash/);
});

test("main names unlisted pages locally, but not in a workflow's public log", async (t) => {
  const s = await stub(t);
  const root = repo(t, { "docs/hidden-page.html": page(`<meta name="bh:unlisted" content="true">`, `<a href="${s.base}/gone">gone</a>`) });
  const local = sink(), ci = sink();
  await main([], {}, local, root, fast());
  await main([], { GITHUB_ACTIONS: "true" }, ci, root, fast());
  assert.match(local.logs.join("\n"), /hidden-page/);
  assert.doesNotMatch(ci.logs.join("\n"), /hidden-page/);
});

test("main exits 2 when there is nothing to check, on a bad allowlist and on a bad argument", async (t) => {
  const empty = repo(t, { "docs/post.html": page("", `<a href="glossary.html">internal only</a>`) });
  const out = sink();
  assert.equal(await main([], {}, out, empty, fast()), 2);
  assert.match(out.errors.join("\n"), /no external links found/);
  const bad = repo(t, { "docs/post.html": page("", `<a href="https://x.test/">x</a>`), "links-allowlist.json": "{}" });
  assert.equal(await main([], {}, sink(), bad, fast()), 2);
  assert.equal(await main(["--wat"], {}, sink(), bad, fast()), 2);
  assert.equal(await main(["--markdown"], {}, sink(), bad, fast()), 2);
});

// ---- The workflow --------------------------------------------------------------------------

test("links.yml runs weekly and by hand, never on a PR, with only contents: read and issues: write", () => {
  const wf = parse(fs.readFileSync(path.join(ROOT, ".github/workflows/links.yml"), "utf8")) as {
    on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { permissions?: unknown; steps: Array<{ run?: string }> }>;
  };
  assert.deepEqual(Object.keys(wf.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(wf.permissions, { contents: "read", issues: "write" });
  for (const job of Object.values(wf.jobs)) assert.equal(job.permissions, undefined, "no job widens the permissions");
  assert.ok(Object.values(wf.jobs).some((j) => j.steps.some((s) => /node scripts\/links\.mts --issue\b/.test(s.run ?? ""))), "it reports through the issue");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["links"], "node scripts/links.mts");
});
