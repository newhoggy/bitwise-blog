import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  parseCsv, parseHits, countViews, toHref, sitePath, readCatalogue, joinViews, formatReport,
  resolveToken, fetchExport, main, OP_TOKEN_ITEM,
} from "../scripts/stats.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_CSV = path.join(ROOT, "tests/support/goatcounter-export.csv");
const csv = fs.readFileSync(FIXTURE_CSV, "utf8");

const page = ({ title, kind = "explainer", tags = "", extra = "" }) => `<!doctype html>
<html><head><title>${title}</title>
  <meta name="description" content="d">
  <meta name="bh:kind" content="${kind}">
  <meta name="bh:tags" content="${tags}">
  ${extra}
</head><body></body></html>`;

/** A repo with a public post, an unlisted one, a sealed one, a plaintext private source and a page with no views. */
function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-stats-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ homepage: "https://example.test/" }));
  const w = (name, html) => fs.writeFileSync(path.join(root, "docs", name), html);
  w("how-deflate-works.html", page({ title: "How DEFLATE works", tags: "compression, deflate" }));
  w("announcing-patchcov.html", page({ title: "Announcing patchcov &amp; friends", tags: "tools", kind: "explainer" }));
  w("quiet-draft.html", page({ title: "Quiet draft", tags: "misc", extra: '<meta name="bh:unlisted" content="true">' }));
  w("unread.html", page({ title: "Nobody\n    read   this", kind: "decision" }));
  w("secret-notes.html", '<!doctype html><html><head><title>Private page</title><meta name="bh:sealed" content="1"></head><body><script id="sealed-payload"></script></body></html>');
  w("secret-two.html", '<!doctype html><html><head><title>Private page</title><meta name="bh:sealed" content="1"></head><body><script id="sealed-payload"></script></body></html>');
  w("secret-notes.private.html", page({ title: "Launch plan SECRET-TITLE" }));
  return root;
}

// ---- CSV ----------------------------------------------------------------------------

test("parseCsv handles quotes, doubled quotes, embedded newlines and CRLF", () => {
  assert.deepEqual(parseCsv('a,"b,c","say ""hi"""\r\n\r\n"x\ny",,z\n'), [["a", "b,c", 'say "hi"'], ["x\ny", "", "z"]]);
  assert.deepEqual(parseCsv("a,b"), [["a", "b"]]);
  assert.throws(() => parseCsv('a,"open'), /quoted field/);
});

test("parseHits reads the fixture by column name and rejects unknown versions", () => {
  const { version, hits } = parseHits(csv);
  assert.equal(version, "2");
  assert.equal(hits.length, 13);
  assert.equal(hits[6].title, 'Announcing patchcov, a "gateable" answer\nto what a change left untested');
  assert.equal(hits[10].bot, true);
  assert.equal(hits[12].event, true);
  assert.throws(() => parseHits("9Path,Event,Bot,Session,Date\n"), /version 9 is not supported/);
  assert.throws(() => parseHits("Path,Event\n"), /unrecognised export header/);
  assert.throws(() => parseHits("2Path,Event\n"), /no "Bot" column/);
  assert.throws(() => parseHits(""), /empty/);
  // version 1 puts the columns in another order; names still work
  assert.equal(parseHits("1Path,Title,Event,Bot,Session,FirstVisit,Referrer,Referrer scheme,Browser,Screen size,Location,Date\n/a.html,A,false,0,s,t,,,,,,2026-01-01T00:00:00Z\n").hits[0].path, "/a.html");
});

test("countViews leaves out bots and events and counts distinct sessions", () => {
  const counts = countViews(parseHits(csv).hits);
  assert.equal(counts.bots, 2);
  assert.equal(counts.events, 1);
  assert.equal(counts.byPath.get("/docs/how-deflate-works.html").views, 2);
  assert.equal(counts.byPath.get("/docs/how-deflate-works.html").sessions.size, 1);
  assert.equal(counts.from, "2026-10-09T05:00:00Z");
  assert.equal(counts.to, "2026-10-13T10:00:00Z");
});

// ---- Joining -------------------------------------------------------------------------

test("toHref normalises GoatCounter paths", () => {
  assert.equal(toHref("/"), "index.html");
  assert.equal(toHref("/index.html"), "index.html");
  assert.equal(toHref("/docs/x.html#s"), "docs/x.html");
  assert.equal(toHref("/docs/x?utm=1"), "docs/x.html");
  assert.equal(toHref("/blog/docs/x.html", "/blog/"), "docs/x.html");
  assert.equal(toHref("/blog/", "/blog/"), "index.html");
  assert.equal(toHref("/blog", "/blog/"), "index.html");
  assert.equal(toHref("/blogger/docs/x.html", "/blog/"), "blogger/docs/x.html");
});

test("sitePath comes from homepage, BH_SITE_URL overrides it", (t) => {
  const root = repo(t);
  assert.equal(sitePath(root, {}), "/");
  assert.equal(sitePath(root, { BH_SITE_URL: "https://example.test/blog" }), "/blog/");
});

test("readCatalogue reads titles, kinds, tags and flags; sealed pages carry no title; private sources are skipped", (t) => {
  const cat = readCatalogue(repo(t));
  assert.deepEqual(cat.get("docs/announcing-patchcov.html").title, "Announcing patchcov & friends");
  assert.deepEqual(cat.get("docs/how-deflate-works.html").tags, ["compression", "deflate"]);
  assert.deepEqual(cat.get("docs/quiet-draft.html").notes, ["unlisted"]);
  assert.equal(cat.get("docs/secret-notes.html").title, "(private page) docs/secret-notes.html");
  assert.ok(!cat.has("docs/secret-notes.private.html"));
  assert.ok(cat.has("index.html"));
});

test("joinViews sorts by views, folds path variants, lists unread pages and tolerates unknown paths", (t) => {
  const counts = countViews(parseHits(csv).hits);
  const { rows, unmatched, sealedOmitted } = joinViews(counts, readCatalogue(repo(t)));
  const by = Object.fromEntries(rows.map((r) => [r.href, r]));
  assert.equal(by["docs/how-deflate-works.html"].views, 4); // plain, #fragment and extensionless paths fold together
  assert.equal(by["docs/how-deflate-works.html"].visitors, 3);
  assert.equal(by["index.html"].views, 2);
  assert.equal(by["docs/unread.html"].views, 0);
  assert.deepEqual(rows.map((r) => r.views), [...rows.map((r) => r.views)].sort((a, b) => b - a));
  assert.equal(rows[0].href, "docs/how-deflate-works.html");
  assert.equal(by["docs/secret-notes.html"].views, 1);
  assert.deepEqual(unmatched.map((u) => [u.title, u.views, u.notes]), [["/docs/removed-post.html  A post that was deleted", 1, ["not in the repo"]]]);
  assert.ok(!by["docs/secret-two.html"]); // sealed and never hit: left out, not shown as 0
  assert.equal(sealedOmitted, 1);
});

test("formatReport prints a table with titles, tags and notes, and never a private page's title", (t) => {
  const counts = countViews(parseHits(csv).hits);
  const text = formatReport(joinViews(counts, readCatalogue(repo(t))), counts);
  const lines = text.split("\n");
  assert.match(lines[0], /^Views\s+Visitors\s+Kind\s+Title\s+Tags\s+Notes$/);
  assert.match(lines[2], /^\s*4\s+3\s+explainer\s+How DEFLATE works\s+compression, deflate$/);
  assert.match(text, /Quiet draft\s+misc\s+unlisted/);
  assert.match(text, /\(private page\) docs\/secret-notes\.html\s+private/);
  assert.match(text, /\/docs\/removed-post\.html  A post that was deleted\s+not in the repo/);
  assert.match(text, /1 sealed page is not listed/);
  assert.doesNotMatch(text, /secret-two/);
  assert.match(text, /Nobody read this/); // a title wrapped over source lines stays on one row
  assert.match(text, /10 pageviews, 2026-10-09 to 2026-10-13\. Left out: 2 bot hits, 1 events\. 1 path matched no page in the repo\./);
  assert.doesNotMatch(text, /SECRET-TITLE/);
  assert.match(text, /Do not paste it/);
});

// ---- Token ---------------------------------------------------------------------------

test("resolveToken prefers the environment, then 1Password, then explains plainly", () => {
  assert.deepEqual(resolveToken({ env: { GOATCOUNTER_TOKEN: " abc " }, readItem: () => assert.fail("op must not run") }), { token: "abc" });
  const asked = [];
  assert.deepEqual(resolveToken({ env: { BH_OP_VAULT: "V" }, readItem: (title, vault) => { asked.push([title, vault]); return "from-op\n"; } }), { token: "from-op" });
  assert.deepEqual(asked, [[OP_TOKEN_ITEM, "V"]]);

  const none = resolveToken({ env: {}, readItem: () => { throw Object.assign(new Error("spawn op ENOENT"), { code: "ENOENT" }); } });
  assert.match(none.error, /No GoatCounter API token found\./);
  assert.match(none.error, /GOATCOUNTER_TOKEN/);
  assert.match(none.error, /beautiful-html goatcounter token/);
  assert.doesNotMatch(none.error, /found\. \(/); // op simply absent: no extra reason
  const missing = resolveToken({ env: {}, readItem: () => { throw Object.assign(new Error("x"), { stderr: '"beautiful-html goatcounter token" isn\'t an item in the "Private" vault' }); } });
  assert.match(missing.error, /No GoatCounter API token found\.\n/);
  const vault = resolveToken({ env: {}, readItem: () => { throw Object.assign(new Error("x"), { stderr: '"Typo" isn\'t a vault in this account: vault not found' }); } });
  assert.match(vault.error, /\(1Password: "Typo" isn't a vault/);
  const locked = resolveToken({ env: {}, readItem: () => { throw Object.assign(new Error("x"), { stderr: "[ERROR] account is locked\nmore" }); } });
  assert.match(locked.error, /\(1Password: \[ERROR\] account is locked\)/);
});

// ---- Export --------------------------------------------------------------------------

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

test("fetchExport starts, polls, downloads and gunzips, sending the token only as a header", async () => {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init = {}) => {
    calls.push([init.method || "GET", url, init.headers?.Authorization, init.body]);
    if (url.endsWith("/export")) return json(202, { id: 7 });
    if (url.endsWith("/export/7")) return json(200, { id: 7, finished_at: ++polls < 3 ? null : "2026-10-18T00:00:00Z" });
    if (url.endsWith("/export/7/download")) { const gz = zlib.gzipSync(csv); return { ok: true, status: 200, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length) }; }
    assert.fail(url);
  };
  const slept = [];
  const out = await fetchExport({ code: "my-site", token: "T0KEN", fetch, sleep: async (ms) => slept.push(ms) });
  assert.equal(out, csv);
  assert.deepEqual(slept, [1000, 1000]);
  assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
    ["POST", "https://my-site.goatcounter.com/api/v0/export"],
    ["GET", "https://my-site.goatcounter.com/api/v0/export/7"],
    ["GET", "https://my-site.goatcounter.com/api/v0/export/7"],
    ["GET", "https://my-site.goatcounter.com/api/v0/export/7"],
    ["GET", "https://my-site.goatcounter.com/api/v0/export/7/download"],
  ]);
  assert.ok(calls.every((c) => c[2] === "Bearer T0KEN"));
  assert.ok(calls.every((c) => !c[1].includes("T0KEN")));
});

test("fetchExport accepts an uncompressed body and reports failures in words", async () => {
  const plain = async (url) => (url.endsWith("/export") ? json(202, { id: 1 }) : url.endsWith("/download") ? { ok: true, status: 200, arrayBuffer: async () => Buffer.from("a,b\n") } : json(200, { finished_at: "x" }));
  assert.equal(await fetchExport({ code: "s", token: "t", fetch: plain }), "a,b\n");
  await assert.rejects(fetchExport({ code: "s", token: "t", fetch: async () => json(403, { error: "no" }) }), /refused the token.*Individual pageviews/);
  await assert.rejects(fetchExport({ code: "s", token: "t", fetch: async () => json(429, {}) }), /one new export per hour.*--export-id/);
  await assert.rejects(fetchExport({ code: "s", token: "t", fetch: async () => json(400, { error: "exports disabled" }) }), /HTTP 400: exports disabled/);
  await assert.rejects(fetchExport({ code: "Bad Code", token: "t", fetch: plain }), /GOATCOUNTER_CODE must contain only/);
  const never = async (url) => (url.endsWith("/export") ? json(202, { id: 1 }) : json(200, { finished_at: null }));
  await assert.rejects(fetchExport({ code: "s", token: "t", fetch: never, sleep: async () => {}, maxPolls: 2 }), /not ready after/);
  // A failure after the export started names its id, and --export-id resumes it without a POST.
  const dl403 = async (url) => (url.endsWith("/export") ? json(202, { id: 9 }) : url.endsWith("/download") ? json(500, {}) : json(200, { finished_at: "x" }));
  const started = [];
  await assert.rejects(fetchExport({ code: "s", token: "t", fetch: dl403, onStart: (id) => started.push(id) }), /rerun with --export-id 9/);
  assert.deepEqual(started, [9]);
  const methods = [];
  const resume = async (url, init = {}) => { methods.push(init.method || "GET"); return url.endsWith("/download") ? { ok: true, status: 200, arrayBuffer: async () => Buffer.from("x\n") } : json(200, { finished_at: "x" }); };
  assert.equal(await fetchExport({ code: "s", token: "t", exportId: "9", fetch: resume }), "x\n");
  assert.ok(!methods.includes("POST"));
  const broken = async (url) => (url.endsWith("/export") ? json(202, { id: 1 }) : json(200, { error: "disk full" }));
  await assert.rejects(fetchExport({ code: "s", token: "t", fetch: broken }), /disk full/);
});

// ---- main ----------------------------------------------------------------------------

function capture() {
  const out = { log: [], error: [] };
  return { out, sink: { log: (s) => out.log.push(s), error: (s) => out.error.push(s) } };
}

test("main --file prints the report with no token and no network", async (t) => {
  const { out, sink } = capture();
  const code = await main(["--file", FIXTURE_CSV], {}, sink, repo(t));
  assert.equal(code, 0);
  assert.match(out.log.join("\n"), /How DEFLATE works/);
  assert.deepEqual(out.error, []);
});

test("main --file also reads a gzipped export", async (t) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bh-stats-gz-")), "export.csv.gz");
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, zlib.gzipSync(csv));
  const { out, sink } = capture();
  assert.equal(await main(["--file", file], {}, sink, repo(t)), 0);
  assert.match(out.log.join("\n"), /How DEFLATE works/);
});

test("main says plainly when no token is set, and when the site code is missing", async () => {
  // The env has no token; point op at nothing by shadowing PATH so the 1Password fallback cannot answer.
  const { out, sink } = capture();
  const saved = process.env.PATH;
  process.env.PATH = "";
  try { assert.equal(await main([], {}, sink), 1); } finally { process.env.PATH = saved; }
  assert.match(out.error.join("\n"), /No GoatCounter API token found\./);
  assert.deepEqual(out.log, []);

  const b = capture();
  assert.equal(await main([], { GOATCOUNTER_TOKEN: "t" }, b.sink), 1);
  assert.match(b.out.error.join("\n"), /GOATCOUNTER_CODE is not set/);
});

test("main rejects bad arguments and unreadable files", async () => {
  assert.equal(await main(["--wat"], {}, capture().sink), 2);
  assert.equal(await main(["--file"], {}, capture().sink), 2);
  assert.equal(await main(["--export-id", "abc"], {}, capture().sink), 2);
  const { out, sink } = capture();
  assert.equal(await main(["--file", "/nonexistent/x.csv"], {}, sink), 1);
  assert.match(out.error[0], /can't read/);
});
