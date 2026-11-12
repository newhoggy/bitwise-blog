import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { findChrome, launchChrome, serveStatic } from "../scripts/chrome.mts";
import { applyAllowlist, loadAllowlist, normalizeTarget, publicPages, scan, SCHEMES, STATES, VIEWPORTS, type A11yResult, type A11yViolation, type State, type StateResult } from "../scripts/a11y.mts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

const violation = (id: string, ...targets: string[]): A11yViolation => ({
  id, impact: "serious", help: id, helpUrl: "",
  nodes: targets.map((target) => ({ target, html: `<x data-t="${target}">`, summary: "" })),
});
const result = (page: string, scheme: "light" | "dark", ...ids: string[]): A11yResult => ({ page, viewport: "desktop", scheme, state: "page", violations: ids.map((id) => violation(id, "#a")) });
const found = (page: string, state: string, v: A11yViolation, viewport: "desktop" | "phone" = "desktop"): A11yResult => ({ page, viewport, scheme: "light", state, violations: [v] });
const entry = (page: string, rule: string, nodes = 1) => ({ page, rule, nodes, reason: "tracked" });

test("an allowlisted rule on its page is not a failure, in either scheme", () => {
  const { failures, grown, shrunk, unused } = applyAllowlist(
    [result("a.html", "light", "color-contrast"), result("a.html", "dark", "color-contrast")],
    [entry("a.html", "color-contrast")],
  );
  assert.deepEqual([failures, grown, shrunk, unused], [[], [], [], []]);
});

test("a rule that is not allowlisted, or is allowlisted for another page, fails", () => {
  const { failures } = applyAllowlist(
    [result("a.html", "light", "color-contrast", "image-alt"), result("b.html", "light", "color-contrast")],
    [entry("a.html", "color-contrast")],
  );
  assert.deepEqual(failures.map((f) => [f.page, f.violations.map((v) => v.id)]), [["a.html", ["image-alt"]], ["b.html", ["color-contrast"]]]);
});

test("a new element breaking an allowlisted rule on the same page fails, whichever state shows it", () => {
  const { failures, grown } = applyAllowlist(
    [found("a.html", "page", violation("color-contrast", "#old")), found("a.html", "tab 2", violation("color-contrast", "#old", "#new"), "phone")],
    [entry("a.html", "color-contrast")],
  );
  assert.deepEqual(failures, []);
  assert.equal(grown.length, 1);
  assert.deepEqual(grown[0].found, ["#new", "#old"]);
});

test("the same element seen in several sizes, schemes and states counts once", () => {
  const { grown, shrunk } = applyAllowlist(
    [found("a.html", "page", violation("list", "ul.x")), found("a.html", "step 2", violation("list", "ul.x"), "phone"), result("a.html", "dark")],
    [entry("a.html", "list")],
  );
  assert.deepEqual([grown, shrunk], [[], []]);
});

test("fewer elements than the entry lists is a failure, so the count only goes down", () => {
  const { shrunk, unused } = applyAllowlist([found("a.html", "page", violation("list", "ul.x"))], [entry("a.html", "list", 3)]);
  assert.deepEqual(shrunk.map((s) => [s.entry.rule, s.found]), [["list", 1]]);
  assert.deepEqual(unused, []);
});

test("targets are named the same in every run", () => {
  assert.equal(normalizeTarget("bh-tabs#tabs-k3j9x0-p1 > img"), normalizeTarget("bh-tabs#tabs-ab12cd-p1 > img"));
  assert.equal(normalizeTarget("#bh-sr-1-0 > a > .bh-search-snippet > mark:nth-child(2)"), normalizeTarget(".bh-search-section > mark"));
  assert.equal(normalizeTarget(".node.is-lit > text"), normalizeTarget(".node > text"), "state classes are not part of an element's name");
  assert.equal(normalizeTarget("#bh-sr-1-0"), normalizeTarget(".bh-search-hit"));
  assert.equal(normalizeTarget(".bh-search-btn"), ".bh-search-btn", "the top-bar button is not a hit");
  assert.notEqual(normalizeTarget("ul:nth-child(2)"), normalizeTarget("ul:nth-child(3)"), "positions elsewhere still tell elements apart");
});

test("an allowlist entry that no longer fires is reported, but only for pages that were scanned", () => {
  const { failures, unused } = applyAllowlist([result("a.html", "light"), result("a.html", "dark")], [entry("a.html", "list"), entry("not-scanned.html", "list")]);
  assert.deepEqual(failures, []);
  assert.deepEqual(unused.map((u) => u.page), ["a.html"]);
});

test("a scan error is a failure, and does not make its allowlist entries look unused or short", () => {
  const { failures, unused, shrunk } = applyAllowlist(
    [{ page: "a.html", viewport: "phone", scheme: "light", state: "page", violations: [], error: "boom" }, found("a.html", "page", violation("list", "ul.x"))],
    [entry("a.html", "list", 2), entry("a.html", "region")],
  );
  assert.equal(failures.length, 1);
  assert.deepEqual([unused, shrunk], [[], []]);
});

test("a state that errored on a page does not make its allowlist entries look unused", () => {
  const { unused } = applyAllowlist(
    [result("a.html", "light"), { page: "a.html", viewport: "desktop", scheme: "dark", state: "search-dialog", violations: [], error: "timeout" }],
    [entry("a.html", "color-contrast")],
  );
  assert.deepEqual(unused, []);
});

test("the committed allowlist is valid and names only pages that exist", () => {
  const allow = loadAllowlist(path.join(root, "a11y-allowlist.json"));
  const pages = new Set(publicPages(root));
  for (const a of allow) assert.ok(pages.has(a.page), `${a.page} is not a scanned page`);
  assert.equal(new Set(allow.map((a) => `${a.page}|${a.rule}`)).size, allow.length, "no duplicate entries");
});

test("an allowlist entry without a reason, or without an element count, is rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-a11y-"));
  try {
    const file = path.join(dir, "allow.json");
    fs.writeFileSync(file, JSON.stringify([{ page: "a.html", rule: "list", nodes: 1, reason: "  " }]));
    assert.throws(() => loadAllowlist(file), /non-empty "reason"/);
    for (const nodes of [undefined, 0, 1.5, "2"]) {
      fs.writeFileSync(file, JSON.stringify([{ page: "a.html", rule: "list", nodes, reason: "tracked" }]));
      assert.throws(() => loadAllowlist(file), /needs "nodes"/, `nodes ${JSON.stringify(nodes)}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("publicPages leaves out sealed shells and private sources", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-a11y-"));
  try {
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "open.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "docs", "sealed.html"), '<script id="sealed-payload">abc</script>');
    fs.writeFileSync(path.join(dir, "docs", "draft.private.html"), "<html></html>");
    assert.deepEqual(publicPages(dir), ["index.html", "docs/open.html"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const IMG = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"';
const shell = (head: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fixture</title>${head}</head><body>${body}</body></html>`;
const bare = (body: string) => shell('<script>document.documentElement.setAttribute("data-bh-ready", "")</script>', `<main>${body}</main>`);
// A page on the real theme, under /docs/ like the site's pages, so bh.js builds the top bar, tabs, stepper and popups.
const themed = (body: string) => shell(
  '<link rel="stylesheet" href="../theme/bh.css"><style>#phone-img { display: none } @media (max-width: 500px) { #phone-img { display: inline } }</style><script src="../theme/bh.js" defer></script>',
  `<main class="bh-page"><article class="bh-article"><header class="bh-hero"><h1>Fixture</h1></header>${body}</article></main>`);

async function withChrome(t: { after: (f: () => void | Promise<void>) => void }, routes: Map<string, { type: string; body: string }>) {
  const server = await serveStatic(root, routes);
  const chrome = await launchChrome();
  t.after(async () => { await chrome.close(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const axeSource = fs.readFileSync(path.join(root, "node_modules", "axe-core", "axe.min.js"), "utf8");
  return { chrome, base, axeSource };
}

test("axe flags a real violation in both schemes and passes a clean page", { skip, timeout: 120000 }, async (t) => {
  const routes = new Map([
    ["/bad.html", { type: "text/html", body: bare(`<h1>Fixture</h1>${IMG}><button></button>`) }],
    ["/good.html", { type: "text/html", body: bare("<h1>Fixture</h1><p>Nothing wrong here.</p>") }],
  ]);
  const { chrome, base, axeSource } = await withChrome(t, routes);
  const ids = (rs: StateResult[]) => rs.flatMap((r) => r.violations.map((v) => v.id));
  for (const scheme of SCHEMES) {
    const bad = ids(await scan(chrome.send, `${base}/bad.html`, { scheme, axeSource, blockFonts: true }));
    assert.ok(bad.includes("image-alt"), `${scheme}: image-alt in ${bad}`);
    assert.ok(bad.includes("button-name"), `${scheme}: button-name in ${bad}`);
    assert.deepEqual(ids(await scan(chrome.send, `${base}/good.html`, { scheme, axeSource, blockFonts: true })), [], `${scheme}: clean page`);
  }
});

test("a page that did not render is an error, not a pass", { skip, timeout: 120000 }, async (t) => {
  const routes = new Map([
    ["/no-h1.html", { type: "text/html", body: bare("<p>content</p>") }],
    ["/two-h1.html", { type: "text/html", body: bare("<h1>A</h1><h1>B</h1>") }],
    ["/no-main.html", { type: "text/html", body: shell('<script>document.documentElement.setAttribute("data-bh-ready", "")</script>', "<h1>Fixture</h1>") }],
    ["/no-chrome.html", { type: "text/html", body: bare("<h1>Fixture</h1>") }],
  ]);
  const { chrome, base, axeSource } = await withChrome(t, routes);
  const opts = { scheme: "light", axeSource, blockFonts: true } as const;
  await assert.rejects(scan(chrome.send, `${base}/no-h1.html`, opts), /0 h1 elements/);
  await assert.rejects(scan(chrome.send, `${base}/two-h1.html`, opts), /2 h1 elements/);
  await assert.rejects(scan(chrome.send, `${base}/no-main.html`, opts), /no main landmark/);
  await assert.rejects(scan(chrome.send, `${base}/no-chrome.html`, { ...opts, requireSite: true }), /no top bar/);
  assert.equal((await scan(chrome.send, `${base}/no-chrome.html`, opts)).length, 1, "without requireSite the same page is scanned");
});

test("hidden content is scanned: inactive tabs, later steps, closed details, and the phone layout", { skip, timeout: 180000 }, async (t) => {
  const body = `<h2 id="s">Section</h2><p>Plain text.</p>
<bh-tabs id="t"><section data-label="One"><p>first tab</p></section><section data-label="Two">${IMG} id="tab-img"></section></bh-tabs>
<bh-stepper id="st"><bh-step><p>first step</p></bh-step><bh-step>${IMG} id="step-img"></bh-step></bh-stepper>
<details><summary>More</summary>${IMG} id="details-img"></details>
<p>${IMG} id="phone-img"></p>`;
  const { chrome, base, axeSource } = await withChrome(t, new Map([["/docs/a11y-fixture.html", { type: "text/html", body: themed(body) }]]));
  const url = `${base}/docs/a11y-fixture.html`;
  const where = (rs: StateResult[], id: string) => rs.filter((r) => r.violations.some((v) => v.id === "image-alt" && v.nodes.some((n) => n.html.includes(`id="${id}"`)))).map((r) => r.state);
  const desktop = await scan(chrome.send, url, { scheme: "light", axeSource, blockFonts: true, states: STATES, requireSite: true });
  assert.deepEqual(desktop.filter((r) => r.error), []);
  assert.deepEqual(where(desktop, "tab-img"), ["tab 2"], "only the tab scan sees the inactive tab");
  assert.deepEqual(where(desktop, "step-img"), ["step 2"], "only the step scan sees the second step");
  assert.deepEqual(where(desktop, "details-img"), ["details"], "only the details scan sees closed content");
  assert.deepEqual(where(desktop, "phone-img"), [], "the phone-only element is not shown on desktop");
  const phone = await scan(chrome.send, url, { scheme: "dark", axeSource, blockFonts: true, viewport: VIEWPORTS[1], states: STATES, requireSite: true });
  assert.deepEqual(phone.filter((r) => r.error), []);
  assert.ok(where(phone, "phone-img").includes("page"), "the phone layout is scanned");
  assert.deepEqual(where(phone, "tab-img"), ["tab 2"], "states run at phone width too");
  const names = phone.map((r) => r.state);
  for (const want of ["page", "details", "tab 2", "step 2", "search-dialog", "review-panel", "slides"]) assert.ok(names.includes(want), `state ${want} ran: ${names}`);
});

test("popups and dialogs are scanned open", { skip, timeout: 180000 }, async (t) => {
  // "token bucket" is a glossary term, so bh.js marks it and its popup can be opened.
  const body = '<h2 id="s">Section</h2><p>A <span data-term="token-bucket">token bucket</span> refills over time.<span class="sidenote">A note.</span></p>';
  const { chrome, base, axeSource } = await withChrome(t, new Map([["/docs/a11y-popups.html", { type: "text/html", body: themed(body) }]]));
  const rs = await scan(chrome.send, `${base}/docs/a11y-popups.html`, { scheme: "light", axeSource, blockFonts: true, states: STATES, requireSite: true });
  assert.deepEqual(rs.filter((r) => r.error), []);
  const names = rs.map((r) => r.state);
  for (const want of ["glossary-popup", "sidenote-popup", "search-dialog"]) assert.ok(names.includes(want), `state ${want} ran: ${names}`);
});

test("a state whose trigger is missing is skipped, and one that fails to apply is an error, then scanning goes on", { skip, timeout: 120000 }, async (t) => {
  const { chrome, base, axeSource } = await withChrome(t, new Map([["/good.html", { type: "text/html", body: bare("<h1>Fixture</h1>") }]]));
  const states: State[] = [
    { name: "absent", apply: 'return "na";' },
    { name: "broken", apply: 'throw new Error("the widget did not open");' },
    { name: "stuck", apply: 'return "ok";', undo: 'throw new Error("could not close");' },
    { name: "rounds", rounds: { from: 0 }, apply: 'return k < 2 ? "ok" : "na";' },
    { name: "after", apply: 'return "ok";' },
  ];
  const rs = await scan(chrome.send, `${base}/good.html`, { scheme: "light", axeSource, blockFonts: true, states });
  assert.deepEqual(rs.map((r) => [r.state, r.error ?? null]), [["page", null], ["broken", "the widget did not open"], ["stuck", null], ["stuck (undo)", "could not close"], ["rounds 1", null], ["rounds 2", null], ["after", null]]);
});
