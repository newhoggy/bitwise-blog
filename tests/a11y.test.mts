import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { findChrome, launchChrome, serveStatic, sleep } from "../scripts/chrome.mts";
import { REVIEW_FIXTURE_PAGE, reviewFixtureRoutes } from "../scripts/a11y-review-fixture.mts";
import { DIFF_LIVE_PAGE, DIFF_LIVE_QUERY, DIFF_STANDALONE_PAGE, diffFixtureRoutes } from "../scripts/a11y-diff-fixture.mts";
import { applyAllowlist, FIXTURE_QUERIES, fixtureRoutes as allFixtureRoutes, loadAllowlist, normalizeTarget, publicPages, scan, SCHEMES, STATES, VIEWPORTS, type A11yResult, type A11yViolation, type State, type StateResult } from "../scripts/a11y.mts";

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

// ---- A page with a published review thread (#229) ------------------------------------------------------------------
// No public page has a thread, so the run scans a fixture that does (scripts/a11y-review-fixture.mts). These tests keep
// it honest: it must be clean, it must contain what the rules need, and each rule must fire when its fix is taken out.

const theme = (file: string) => fs.readFileSync(path.join(root, "theme", file), "utf8");
/** `text` with `from` replaced by `to`; fails when `from` is not there, so a stale mutation cannot pass as "nothing found". */
const mutate = (text: string, from: string, to: string) => { assert.ok(text.includes(from), `the injection matched nothing: ${from}`); return text.replace(from, to); };
const fixtureRoutes = (edits: Record<string, string> = {}) => {
  const routes = reviewFixtureRoutes();
  for (const [file, body] of Object.entries(edits)) routes.set(`/theme/${file}`, { type: file.endsWith(".css") ? "text/css" : "text/javascript", body });
  return routes;
};
const fixtureRules = async (t: Parameters<typeof withChrome>[0], edits: Record<string, string> = {}) => {
  const { chrome, base, axeSource } = await withChrome(t, fixtureRoutes(edits));
  const rules = new Set<string>();
  const errors: string[] = [];
  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      for (const r of await scan(chrome.send, `${base}/${REVIEW_FIXTURE_PAGE}`, { scheme, axeSource, blockFonts: true, viewport, states: STATES, requireSite: true })) {
        for (const v of r.violations) rules.add(v.id);
        if (r.error) errors.push(`${viewport.name} ${scheme} ${r.state}: ${r.error}`);
      }
    }
  }
  return { rules, errors };
};

test("the review fixture page has pins to check: stacked, with a count, beside a figure", { skip, timeout: 120000 }, async (t) => {
  const { chrome, base } = await withChrome(t, fixtureRoutes());
  for (const viewport of VIEWPORTS) {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m: string, p?: object) => chrome.send(m, p, sessionId);
    try {
      await s("Page.enable");
      // A background tab may not get animation frames; match scan and the diff-fixture probe.
      await s("Page.bringToFront");
      await s("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
      await s("Page.navigate", { url: `${base}/${REVIEW_FIXTURE_PAGE}` });
      // Poll from Node so navigation can replace the document without losing an in-page timer.
      const deadline = Date.now() + 20000;
      for (;;) {
        const ready = await s("Runtime.evaluate", {
          returnByValue: true,
          expression: 'location.href !== "about:blank" && document.readyState === "complete" && document.documentElement.hasAttribute("data-bh-ready") && !!document.querySelector(".bh-review-pin")',
        }).catch(() => null);
        if (ready?.result?.value === true) break;
        if (Date.now() > deadline) throw new Error(`${viewport.name}: review pins never became ready`);
        await sleep(100);
      }
      const r = await s("Runtime.evaluate", {
        returnByValue: true,
        expression: `JSON.stringify({
          pins: [...document.querySelectorAll(".bh-review-pin")].map((p) => { const r = p.getBoundingClientRect(); return [p.dataset.thread, p.dataset.count || "", Math.round(r.height * 10) / 10, r.top + scrollY]; }),
          badge: !!document.querySelector(".bh-review-count:not([hidden])"),
          resolved: document.querySelectorAll(".bh-review-pin.is-resolved").length
        })`,
      });
      assert.equal(typeof r.result.value, "string", `${viewport.name}: expected a serialized review fixture result`);
      const got = JSON.parse(r.result.value) as { pins: [string, string, number, number][]; badge: boolean };
    assert.ok(got.pins.length >= 6, `${viewport.name}: ${got.pins.length} pins`);
    assert.ok(got.pins.some((p) => p[1] !== ""), `${viewport.name}: a pin with a message count`);
    assert.ok(got.badge, `${viewport.name}: the Review button's count badge shows`);
    assert.ok(got.pins.every((p) => p[2] >= 24), `${viewport.name}: every pin is at least 24px tall: ${got.pins.map((p) => p[2])}`);
    const tops = got.pins.map((p) => p[3]).sort((a, b) => a - b);
    const closest = Math.min(...tops.slice(1).map((v, i) => v - tops[i]));
    assert.ok(closest >= 24 && closest < 30, `${viewport.name}: the closest pins are ${closest}px apart, a line apart but not overlapping`);
    } finally { await chrome.send("Target.closeTarget", { targetId }); }
  }
});

test("a page with a published review thread has no axe violations, with the panel open too", { skip, timeout: 240000 }, async (t) => {
  const { rules, errors } = await fixtureRules(t);
  assert.deepEqual(errors, []);
  assert.deepEqual([...rules], []);
});

test("the review fixture fails axe again when the pin's 24px button is taken out", { skip, timeout: 240000 }, async (t) => {
  // The button is 24px because --pin-hit is; and stacked pins are kept apart by the script, so undo both.
  const css = mutate(theme("review.css"), "--pin-hit: max(var(--pin), 24px);", "--pin-hit: var(--pin);");
  const js = mutate(theme("modules/review.js"), "Math.abs(v - top) < 24", "Math.abs(v - top) < 22");
  const { rules, errors } = await fixtureRules(t, { "review.css": css, "modules/review.js": js });
  assert.deepEqual(errors, []);
  assert.ok(rules.has("target-size"), `target-size in ${[...rules]}`);
});

test("the review fixture fails axe again when the Review button and the pins stop naming their counts", { skip, timeout: 240000 }, async (t) => {
  let js = mutate(theme("modules/review.js"), 'badge.hidden ? "Review: comment on this page" : `Review: comment on this page, ${text}`', '"Review: comment on this page"');
  js = mutate(js, "if (n > 1) pin.dataset.count = String(n);", 'if (n > 1) pin.append(el("span", { class: "bh-review-pin-count", text: String(n) }));');
  const { rules, errors } = await fixtureRules(t, { "modules/review.js": js });
  assert.deepEqual(errors, []);
  assert.ok(rules.has("label-content-name-mismatch"), `label-content-name-mismatch in ${[...rules]}`);
});

// ---- Pages that show a page diff (#341) ------------------------------------------------------------------------------
// No public page carries the diff UI, so the run scans two fixtures made with the real diff code
// (scripts/a11y-diff-fixture.mts). These tests keep them honest: each has what the rules need, each is clean, and a
// rule fires on each when a fix is taken out (or a fault put in), so a scan that silently saw nothing cannot pass.

const diffRoutes = (edits: Record<string, string> = {}) => {
  const routes = diffFixtureRoutes();
  for (const [file, body] of Object.entries(edits)) routes.set(`/theme/${file}`, { type: file.endsWith(".css") ? "text/css" : "text/javascript", body });
  return routes;
};
const diffUrl = (base: string, page: string) => `${base}/${page}${FIXTURE_QUERIES.get(page) ? "?" + FIXTURE_QUERIES.get(page) : ""}`;
const diffRules = async (t: Parameters<typeof withChrome>[0], edits: Record<string, string> = {}) => {
  const { chrome, base, axeSource } = await withChrome(t, diffRoutes(edits));
  const found = new Map<string, Set<string>>();
  const errors: string[] = [];
  for (const page of [DIFF_LIVE_PAGE, DIFF_STANDALONE_PAGE]) {
    for (const viewport of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        for (const r of await scan(chrome.send, diffUrl(base, page), { scheme, axeSource, blockFonts: true, viewport, states: STATES, requireSite: true })) {
          for (const v of r.violations) (found.get(page) ?? found.set(page, new Set()).get(page)!).add(v.id);
          if (r.error) errors.push(`${page} ${viewport.name} ${scheme} ${r.state}: ${r.error}`);
        }
      }
    }
  }
  return { found, errors };
};

test("the diff fixtures are opened as the real ones are, and the live page's data is served for the commit it names", () => {
  assert.equal(FIXTURE_QUERIES.get(DIFF_LIVE_PAGE), DIFF_LIVE_QUERY);
  const routes = allFixtureRoutes();
  for (const page of [DIFF_LIVE_PAGE, DIFF_STANDALONE_PAGE, REVIEW_FIXTURE_PAGE]) assert.ok(routes.has(`/${page}`), `${page} is served`);
  const commit = DIFF_LIVE_QUERY.replace("diff=", "");
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.ok(routes.has(`/theme/diffs/a11y-diff-live.${commit}.js`), "the data file the ?diff= link loads");
});

test("the diff fixture pages have the diff UI to check: marks of every kind, the change bar, copies that scroll at phone width", { skip, timeout: 120000 }, async (t) => {
  const { chrome, base } = await withChrome(t, diffRoutes());
  const probe = async (page: string, viewport: (typeof VIEWPORTS)[number], expression: string, ready: string) => {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m: string, p?: object) => chrome.send(m, p, sessionId);
    try {
      await s("Page.enable");
      // In front, as `scan` opens a page: a tab behind another may never get a frame, and a wait on one never ends (#347).
      await s("Page.bringToFront");
      await s("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
      await s("Page.navigate", { url: diffUrl(base, page) });
      // Polled from here, not awaited in the page: an evaluation begun in the document the navigation replaces is lost,
      // and with it any timeout it holds. One that fails mid-navigation only means "not yet".
      const deadline = Date.now() + 20000;
      for (;;) {
        const r = await s("Runtime.evaluate", { returnByValue: true, expression: `location.href !== "about:blank" && document.readyState === "complete" && document.documentElement.hasAttribute("data-bh-ready") && !!(${ready})` }).catch(() => null);
        if (r?.result?.value === true) break;
        if (Date.now() > deadline) throw new Error(`${page} at ${viewport.name} never became ready (data-bh-ready and its diff UI)`);
        await sleep(100);
      }
      // `frames` settles after two frames, or after half a second if none comes.
      const r = await s("Runtime.evaluate", { returnByValue: true, awaitPromise: true, expression: `(async () => {
        const frames = () => new Promise((r) => { const t = setTimeout(r, 500); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); })); });
        await new Promise((r) => setTimeout(r, 300));
        try { return JSON.stringify(await (async () => { ${expression} })()); } catch (e) { return JSON.stringify("error: " + e.message); }
      })()` });
      return JSON.parse(r.result.value);
    } finally { await chrome.send("Target.closeTarget", { targetId }); }
  };
  // What the scan puts on screen: the marks, whether they start closed, the bar, and which copies are scroll regions.
  const state = `const marks = [...document.querySelectorAll(".bh-diff-mark")];
    const scrolling = () => [...document.querySelectorAll(".bh-diff-old, .bh-diff-copy")].filter((e) => e.getAttribute("tabindex") === "0" && e.getAttribute("role") === "group").map((e) => e.getAttribute("aria-label"));
    return { marks: marks.length, closed: marks.filter((m) => m.localName === "details" && !m.open).length, wasHere: marks.filter((m) => m.localName === "p").length,
      status: [...new Set([...document.querySelectorAll("[data-diff]")].map((e) => e.getAttribute("data-diff")))].sort(), ins: document.querySelectorAll("ins").length, del: document.querySelectorAll("del").length,
      bar: !!document.querySelector(".bh-diff-bar [data-expand]"), summary: !!document.querySelector(".bh-diff-summary"), trees: [...document.querySelectorAll(".bh-diff-shadow")].filter((h) => h.shadowRoot).length,
      scrolling: scrolling() };`;
  for (const viewport of VIEWPORTS) {
    const live = await probe(DIFF_LIVE_PAGE, viewport, `const before = (() => { ${state} })();
      document.querySelector(".bh-diff-bar [data-expand]").click(); await frames(); await new Promise((r) => setTimeout(r, 300));
      return { before, afterExpand: (() => { ${state} })() };`, `document.querySelector(".bh-diff-bar")`);
    assert.ok(live.before.marks >= 6, `${viewport.name}: live marks ${live.before.marks}`);
    assert.equal(live.before.closed, live.before.marks - live.before.wasHere, `${viewport.name}: the live page's marks start closed (the "was here" mark is a paragraph)`);
    assert.ok(live.before.wasHere >= 1, `${viewport.name}: a moved block has its "was here" mark`);
    assert.ok(live.before.bar, `${viewport.name}: the change bar has Expand all`);
    assert.ok(live.before.trees >= 1, `${viewport.name}: a copy drawn in a shadow tree`);
    assert.equal(live.afterExpand.closed, 0, `${viewport.name}: Expand all opens every mark`);
    if (viewport.mobile) assert.deepEqual(["Old version", "What changed"].filter((n) => live.afterExpand.scrolling.includes(n)), ["Old version", "What changed"], `${viewport.name}: wide copies are named scroll regions: ${live.afterExpand.scrolling}`);
    const page = await probe(DIFF_STANDALONE_PAGE, viewport, state, `document.querySelector(".bh-diff-summary") && document.querySelector(".bh-diff-shadow")`);
    assert.ok(page.summary && !page.bar, `${viewport.name}: the diff page has the list of changes and no bar`);
    assert.ok(page.ins > 0 && page.del > 0, `${viewport.name}: a word diff in the page: ${page.ins} ins, ${page.del} del`);
    assert.equal(page.closed, 0, `${viewport.name}: the diff page's marks are open`);
    assert.ok(page.trees >= 1, `${viewport.name}: a shadow-tree copy on the diff page`);
    assert.deepEqual(page.status, ["added", "changed", "moved", "removed"], `${viewport.name}: a block of every kind`);
    if (viewport.mobile) assert.ok(page.scrolling.includes("Old version"), `${viewport.name}: a copy on the diff page scrolls and is a named region: ${page.scrolling}`);
  }
});

test("pages that show a page diff have no axe violations, with the marks closed and open", { skip, timeout: 300000 }, async (t) => {
  const { found, errors } = await diffRules(t);
  assert.deepEqual(errors, []);
  assert.deepEqual([...found], []);
});

test("the live diff page fails axe again when a mark's summary stops being a 24px target", { skip, timeout: 300000 }, async (t) => {
  const css = mutate(theme("diff.css"), " min-height: 24px; }", " }");
  const { found, errors } = await diffRules(t, { "diff.css": css });
  assert.deepEqual(errors, []);
  assert.ok(found.get(DIFF_LIVE_PAGE)?.has("target-size"), `target-size on the live page in ${[...(found.get(DIFF_LIVE_PAGE) ?? [])]}`);
});

test("the diff page fails axe when its inserted words lose their contrast", { skip, timeout: 300000 }, async (t) => {
  const css = mutate(theme("diff.css"), ".bh-article :is(ins, del) { color: var(--text);", ".bh-article :is(ins, del) { color: var(--bg);");
  const { found, errors } = await diffRules(t, { "diff.css": css });
  assert.deepEqual(errors, []);
  assert.ok(found.get(DIFF_STANDALONE_PAGE)?.has("color-contrast"), `color-contrast on the diff page in ${[...(found.get(DIFF_STANDALONE_PAGE) ?? [])]}`);
});
