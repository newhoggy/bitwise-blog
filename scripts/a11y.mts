#!/usr/bin/env node
// Accessibility pass with axe-core, in the Chrome that scripts/visual.mts already drives.
//
//   node scripts/a11y.mts                    every public page, desktop and phone, light and dark
//   node scripts/a11y.mts --only deflate     pages whose path contains "deflate"
//   node scripts/a11y.mts --json             print the full result as JSON on stdout
//
// Each page is opened with the system fonts (the theme's font files blocked), reduced motion, in both colour schemes
// and at two sizes (desktop 1280px, phone 390px), and waited on until <html data-bh-ready>. It must have
// rendered (one h1, a main landmark, the top bar bh.js builds), or the scan is an error rather than a pass.
// axe-core (a pinned devDependency) is injected and run against the whole document with the WCAG 2.0/2.1/2.2
// A and AA rules plus axe's best-practice rules, and again after each STATE below puts hidden content on
// screen: inactive tabs, later stepper steps, open details, the glossary and sidenote popups, the search
// dialog, the review panel and slide mode.
// Findings that are known and tracked live in a11y-allowlist.json, as a rule on a page with the number of
// distinct elements it covers. Anything else fails the run, and so does an entry whose rule fires on
// fewer elements than listed (or none), so the list can only shrink.
// Sealed pages are skipped: their shell is a generic notice and the page is encrypted.
//
// The rules are also checked by `npm run check` (contrast tokens, alt text, svg names). This
// pass is for what only a rendered page shows: computed contrast, names of controls that
// components build at run time, landmarks, duplicate ids after components expand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { findChrome, launchChrome, serveStatic, sleep, FONT_FILES, type ChromeHandle } from "./chrome.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
export const SCHEMES = ["light", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];
/** The two layouts that differ: `npm run visual` also renders 390px, and CLAUDE.md asks for a 375px check. */
export const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
] as const;
export type Viewport = (typeof VIEWPORTS)[number];
export type ViewportName = Viewport["name"];

/** One element axe flagged. */
export interface A11yNode { target: string; html: string; summary: string }
/** One rule that failed on one page in one scheme. */
export interface A11yViolation { id: string; impact: string | null; help: string; helpUrl: string; nodes: A11yNode[] }
/** What axe found on one page, at one size, in one scheme, in one state ("page" is as loaded), or why it could not run. */
export interface A11yResult { page: string; viewport: ViewportName; scheme: Scheme; state: string; violations: A11yViolation[]; error?: string }
/** What one state of one page found. */
export interface StateResult { state: string; violations: A11yViolation[]; error?: string }
/** An allowlisted finding: a rule on a page (any size, scheme or state), the number of distinct elements it covers, and why it is tolerated. */
export interface AllowEntry { page: string; rule: string; nodes: number; reason: string }

/** The pages to scan: the home page and every public doc, as paths relative to the repo root. */
export function publicPages(root: string): string[] {
  const docs = fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).sort();
  const open = docs.filter((f) => !fs.readFileSync(path.join(root, "docs", f), "utf8").includes('id="sealed-payload"'));
  return ["index.html", ...open.map((f) => `docs/${f}`)];
}

/**
 * An axe target with what varies from run to run replaced, so the same element has one name in every run: the
 * random ids <bh-tabs> generates, the state classes components toggle, and the elements inside the search dialog's hits. Which hits the dialog shows,
 * how many words each highlights, and how axe words the selector for them (it picks whatever is unique) follow the
 * site's content, not the markup, so a hit is named by its last step alone.
 */
export function normalizeTarget(target: string): string {
  // Classes that components toggle as a reader moves through a page: axe may or may not name them in the selector.
  const t = target.replace(/\btabs-[a-z0-9]{6}\b/g, "tabs-*").replace(/\.(?:is-lit|is-dim|is-active|reveal-pending|reveal-in)\b/g, "");
  if (!/#bh-sr-\d|\.bh-search-(?:hit|snippet|section|title)\b/.test(t)) return t;
  const last = t.split(" > ").pop()!.replace(/#bh-sr-\d+-\d+/, ".bh-search-hit").replace(/:nth-child\(\d+\)/g, "");
  return `dialog.bh-search ${last}`;
}

/** The outcome of holding a run's results against the allowlist. */
export interface AllowReport {
  /** Violations of rules the page does not allowlist, and scans that errored. */
  failures: A11yResult[];
  /** Allowlisted rules that now hit more elements than the entry lists: a new element broke the rule. */
  grown: { entry: AllowEntry; found: string[] }[];
  /** Allowlisted rules that hit fewer (but some) elements: lower `nodes`, so the list only shrinks. */
  shrunk: { entry: AllowEntry; found: number }[];
  /** Entries whose rule no longer fires on a page that was scanned completely. */
  unused: AllowEntry[];
}

/**
 * Hold results against the allowlist. An entry covers a rule on a page and says how many distinct elements
 * (axe targets, taken as a union over every size, scheme and state) it covers; more is a failure, and so is fewer.
 */
export function applyAllowlist(results: A11yResult[], allow: AllowEntry[]): AllowReport {
  const failures: A11yResult[] = [];
  const found = new Map<AllowEntry, Set<string>>();
  for (const r of results) {
    const violations = r.violations.filter((v) => {
      const hit = allow.find((a) => a.page === r.page && a.rule === v.id);
      if (!hit) return true;
      const set = found.get(hit) ?? new Set<string>();
      for (const n of v.nodes) set.add(normalizeTarget(n.target));
      // A violation that carries no nodes still proves the rule fired.
      if (!v.nodes.length) set.add("(element not reported)");
      found.set(hit, set);
      return false;
    });
    if (violations.length || r.error) failures.push({ ...r, violations });
  }
  // Counts are only trustworthy for a page every scan of which ran.
  const incomplete = new Set(results.filter((r) => r.error).map((r) => r.page));
  const scanned = new Set(results.map((r) => r.page));
  const grown: AllowReport["grown"] = [], shrunk: AllowReport["shrunk"] = [], unused: AllowEntry[] = [];
  for (const a of allow) {
    const set = found.get(a);
    if (set && set.size > a.nodes) grown.push({ entry: a, found: [...set].sort() });
    else if (incomplete.has(a.page) || !scanned.has(a.page)) continue;
    else if (!set) unused.push(a);
    else if (set.size < a.nodes) shrunk.push({ entry: a, found: set.size });
  }
  return { failures, grown, shrunk, unused };
}

type TabSend = (method: string, params?: object) => Promise<any>;

/**
 * A step that puts hidden content on screen, as a script run in the page. `apply` is an async function
 * body (given `k`, the round) returning "ok" (scan now), "skip" (nothing changed this round) or "na"
 * (nothing of this kind on the page, or no more rounds); it throws when the trigger exists but did not
 * work, so a broken component is an error and not a silent pass. `undo` puts the page back.
 */
export interface State { name: string; apply: string; undo?: string; /** Repeat with k = from, from+1, … until "na". */ rounds?: { from: number } }

const PRELUDE = `const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const until = async (f, ms = 5000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };
  // Scroll a trigger to the middle. The sticky top bar hides part of whatever straddles its lower edge, and where
  // that falls depends on how the fonts wrap (so on the machine), so nudge the page until no link or button does.
  const show = (e) => {
    e.scrollIntoView({ block: "center", behavior: "instant" });
    const bar = document.querySelector(".bh-topbar");
    if (!bar) return;
    for (let i = 0; i < 20; i++) {
      const edge = bar.getBoundingClientRect().bottom;
      const hit = [...document.querySelectorAll("a[href], button")].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.top < edge && r.bottom > edge && !bar.contains(x); });
      if (!hit) return;
      const before = hit.getBoundingClientRect().top;
      window.scrollBy({ top: hit.getBoundingClientRect().bottom - edge + 1, behavior: "instant" });
      if (hit.getBoundingClientRect().top === before) return;
    }
  };
  const tabButtons = (t) => [...t.querySelectorAll(":scope > .bh-tablist > [role=tab]")];`;

/** Everything reachable by interaction that axe cannot see on load, in the order scanned. Selectors are the theme's (theme/bh.js and theme/modules). */
export const STATES: State[] = [
  { name: "details",
    apply: `const d = [...document.querySelectorAll("details:not([open])")];
      if (!d.length) return "na";
      d.forEach((x) => { x.open = true; x.setAttribute("data-a11y-opened", ""); });
      await frames(); return "ok";`,
    undo: `document.querySelectorAll("[data-a11y-opened]").forEach((x) => { x.open = false; x.removeAttribute("data-a11y-opened"); });` },
  { name: "tab", rounds: { from: 0 },
    apply: `const g = [...document.querySelectorAll("bh-tabs")].map((t) => [t, tabButtons(t)]).filter(([, b]) => b.length > k);
      if (!g.length) return "na";
      let changed = false;
      for (const [t, b] of g) {
        if (!t.hasAttribute("data-a11y-tab")) t.setAttribute("data-a11y-tab", String(b.findIndex((x) => x.getAttribute("aria-selected") === "true")));
        if (b[k].getAttribute("aria-selected") !== "true") { b[k].click(); changed = true; }
      }
      if (!changed) return "skip";
      await frames(); return "ok";`,
    undo: `document.querySelectorAll("bh-tabs[data-a11y-tab]").forEach((t) => { const b = tabButtons(t)[Number(t.getAttribute("data-a11y-tab"))]; if (b) b.click(); t.removeAttribute("data-a11y-tab"); });` },
  { name: "step", rounds: { from: 1 },
    apply: `const s = [...document.querySelectorAll("bh-stepper")].filter((x) => typeof x.go === "function" && x.steps && x.steps.length > k);
      if (!s.length) return "na";
      s.forEach((x) => x.go(k));
      await frames(); return "ok";`,
    undo: `document.querySelectorAll("bh-stepper").forEach((x) => { if (typeof x.go === "function") x.go(0); });` },
  { name: "glossary-popup",
    apply: `const t = document.querySelector(".bh-article .term");
      if (!t) return "na";
      show(t); t.click();
      const pop = document.getElementById("bh-gloss-pop");
      if (!await until(() => pop && !pop.hidden)) throw new Error("the glossary popup did not open");
      await frames(); return "ok";`,
    undo: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const p = document.getElementById("bh-gloss-pop"); if (p) p.hidden = true;` },
  { name: "sidenote-popup",
    apply: `const t = document.querySelector(".sidenote-ref");
      if (!t) return "na";
      show(t); t.click();
      const pop = document.getElementById("bh-gloss-pop");
      if (!await until(() => pop && !pop.hidden)) throw new Error("the sidenote popup did not open");
      await frames(); return "ok";`,
    undo: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      const p = document.getElementById("bh-gloss-pop"); if (p) p.hidden = true;` },
  { name: "search-dialog",
    apply: `const b = document.querySelector(".bh-search-btn");
      if (!b) return "na";
      b.click();
      const d = () => document.querySelector("dialog.bh-search");
      if (!await until(() => d() && d().open)) throw new Error("the search dialog did not open");
      const i = d().querySelector("input");
      i.value = "the"; i.dispatchEvent(new Event("input", { bubbles: true }));
      if (!await until(() => d().querySelectorAll("[role=option]").length > 0, 10000)) throw new Error("the search dialog showed no results for 'the'");
      await frames(); return "ok";`,
    undo: `if (window.bh && window.bh.search) window.bh.search.close();` },
  { name: "review-panel",
    apply: `const b = document.querySelector(".bh-review-btn");
      if (!b) return "na";
      b.click();
      if (!await until(() => document.documentElement.classList.contains("bh-reviewing") && document.querySelector(".bh-review-panel:not([hidden])"))) throw new Error("the review panel did not open");
      await frames(); return "ok";`,
    undo: `if (document.documentElement.classList.contains("bh-reviewing")) document.querySelector(".bh-review-btn").click();` },
  { name: "slides",
    apply: `const b = document.querySelector('button[aria-label="Present as slides"]');
      if (!b) return "na";
      b.click();
      if (!await until(() => document.documentElement.classList.contains("bh-presenting"))) throw new Error("slide mode did not start");
      await frames(); return "ok";`,
    undo: `if (window.bh && window.bh.present) window.bh.present.exit();` },
];

/** Options for `scan`. */
export interface ScanOptions {
  scheme: Scheme;
  axeSource: string;
  /** Block the theme's font files, so the page is laid out with the system fonts (the allowlist is counted that way). */
  blockFonts: boolean;
  /** Defaults to desktop. */
  viewport?: Viewport;
  /** Interaction states to scan after the page as loaded. Defaults to none. */
  states?: State[];
  /** Require what a real site page has once bh.js has run (the top bar), not only an h1 and a main landmark. */
  requireSite?: boolean;
}

const evalIn = async (s: TabSend, expression: string) => {
  const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0].replace(/^Error: /, "") || r.exceptionDetails.text);
  return r.result.value;
};

// Colours mid-transition read as low contrast, and a step or tab that was just switched is mid-transition: wait for
// every finite animation or transition to end (looping ones never do), then two frames so styles are computed.
// A paused or stuck animation must not hang the run, so the wait is capped.
const SETTLE = `(async () => {
  await Promise.race([
    Promise.allSettled(document.getAnimations().filter((a) => a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.finished)),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;

const runAxe = async (s: TabSend): Promise<A11yViolation[]> => {
  await evalIn(s, SETTLE);
  const run = await s("Runtime.evaluate", {
    expression: `axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ["violations"] })
      .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 200), summary: (n.failureSummary || "").replace(/\\s+/g, " ").slice(0, 300) })) })))`,
    awaitPromise: true, returnByValue: true,
  });
  if (run.exceptionDetails) throw new Error("axe failed: " + (run.exceptionDetails.exception?.description || run.exceptionDetails.text));
  return run.result.value as A11yViolation[];
};

/**
 * Run axe on one page at one size in one colour scheme: as loaded ("page"), then in each state that applies.
 * Throws when the page did not load or render; a state that fails is reported on its own result.
 */
export async function scan(send: ChromeHandle["send"], url: string, opts: ScanOptions): Promise<StateResult[]> {
  const { scheme, axeSource, blockFonts, requireSite = false, states = [] } = opts;
  const viewport = opts.viewport ?? VIEWPORTS[0];
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s: TabSend = (m, p) => send(m, p, sessionId);
  try {
    await s("Page.enable");
    await s("Page.bringToFront");
    if (blockFonts) {
      await s("Network.enable");
      await s("Network.setBlockedURLs", { urls: [FONT_FILES] });
    }
    await s("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
    // Scan with no hover at every width: controls that wait for hover to appear (the review "+ Comment" buttons, a
    // stepper's copy-link button) are then on show and checked. A phone has no hover, and CI's headless Chrome
    // reports none at desktop width either, so this also makes a local run see what CI sees.
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await s("Page.navigate", { url });
    const deadline = Date.now() + 20000;
    for (;;) {
      const r = await s("Runtime.evaluate", { expression: "document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", returnByValue: true });
      if (r.result.value) break;
      if (Date.now() > deadline) throw new Error("page never signalled data-bh-ready");
      await sleep(100);
    }
    // A page that failed to build must not pass as an empty shell: it has to show what it is for.
    const missing: string[] = await evalIn(s, `(() => {
      const m = [];
      const h1 = document.querySelectorAll("h1");
      if (h1.length !== 1) m.push(h1.length + " h1 elements (want exactly 1)");
      else if (!h1[0].textContent.trim()) m.push("an empty h1");
      if (!document.querySelector("main, [role=main]")) m.push("no main landmark");
      if (${requireSite} && !document.querySelector(".bh-topbar")) m.push("no top bar (bh.js did not build the page chrome)");
      return m;
    })()`);
    if (missing.length) throw new Error("page did not render as expected: " + missing.join("; "));
    // Scroll-reveal fades content in; mid-fade colours would read as low contrast.
    // Two frames after clearing it, so styles are computed on what a reader ends up seeing.
    await evalIn(s, `(async () => {
      document.querySelectorAll(".reveal-pending").forEach((e) => e.classList.remove("reveal-pending"));
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`);
    const injected = await s("Runtime.evaluate", { expression: axeSource, returnByValue: true });
    if (injected.exceptionDetails) throw new Error("could not load axe-core: " + (injected.exceptionDetails.exception?.description || injected.exceptionDetails.text));

    const out: StateResult[] = [{ state: "page", violations: await runAxe(s) }];
    const call = (st: State, body: string, k: number) => evalIn(s, `(async (k) => { ${PRELUDE}\n${body}\n})(${k})`);
    for (const st of states) {
      try {
        for (let k = st.rounds?.from ?? 0; ; k++) {
          const outcome = await call(st, st.apply, k);
          if (outcome === "na") break;
          if (outcome === "ok") out.push({ state: st.rounds ? `${st.name} ${k + 1}` : st.name, violations: await runAxe(s) });
          if (!st.rounds) break;
        }
      } catch (e) {
        out.push({ state: st.name, violations: [], error: e instanceof Error ? e.message : String(e) });
      } finally {
        // A state left open would taint every scan after it, so a failed undo is reported, not ignored.
        // Nor may it leave the page scrolled: every state starts from the top.
        try {
          if (st.undo) await call(st, st.undo, 0);
          await evalIn(s, `window.scrollTo({ top: 0, behavior: "instant" })`);
        }
        catch (e) { out.push({ state: `${st.name} (undo)`, violations: [], error: e instanceof Error ? e.message : String(e) }); }
      }
    }
    return out;
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

export function loadAllowlist(file: string): AllowEntry[] {
  if (!fs.existsSync(file)) return [];
  const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new Error(`${file}: expected an array`);
  return data.map((e: unknown, i) => {
    const o = e as Partial<AllowEntry> | null;
    if (!o || typeof o.page !== "string" || typeof o.rule !== "string" || typeof o.reason !== "string" || !o.reason.trim()) {
      throw new Error(`${file}: entry ${i} needs "page", "rule" and a non-empty "reason"`);
    }
    if (!Number.isInteger(o.nodes) || (o.nodes as number) < 1) throw new Error(`${file}: entry ${i} (${o.rule} on ${o.page}) needs "nodes", the number of elements it covers (a positive integer)`);
    return { page: o.page, rule: o.rule, nodes: o.nodes as number, reason: o.reason };
  });
}

async function main() {
  const c = { red: (s: string) => `\x1b[31m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m` };
  const args = process.argv.slice(2);
  const onlyAt = args.indexOf("--only");
  const only = onlyAt < 0 ? null : args[onlyAt + 1];
  if (onlyAt >= 0 && (!only || only.startsWith("--"))) { console.error("--only needs a value, for example --only deflate"); process.exitCode = 2; return; }
  // The web fonts are always blocked, as in CI, so the allowlist (counted with the system fonts) means the same thing.
  const blockFonts = true;
  const json = args.includes("--json");
  const log = (s: string) => (json ? console.error(s) : console.log(s));

  const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
  const allow = loadAllowlist(path.join(ROOT, "a11y-allowlist.json"));
  const pages = publicPages(ROOT).filter((p) => !only || p.includes(only));
  if (!pages.length) { console.error(`No page matches --only ${only}`); process.exitCode = 1; return; }

  if (!findChrome()) { console.error("Chrome not found: install it or set CHROME_PATH"); process.exitCode = 2; return; }
  const server = await serveStatic(ROOT);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  let chrome: ChromeHandle | undefined;
  const results: A11yResult[] = [];
  const started = Date.now();
  try {
    chrome = await launchChrome();
    for (const page of pages) {
      for (const viewport of VIEWPORTS) {
        for (const scheme of SCHEMES) {
          // ?examples shows example pages; #unlisted=true adds the unlisted cards to the home page.
          const url = `${base}${page}?examples#unlisted=true`;
          const label = `${page} ${viewport.name} ${scheme}`;
          const mine: A11yResult[] = [];
          try {
            for (const r of await scan(chrome.send, url, { scheme, axeSource, blockFonts, viewport, states: STATES, requireSite: true })) mine.push({ page, viewport: viewport.name, scheme, ...r });
          } catch (e) {
            mine.push({ page, viewport: viewport.name, scheme, state: "page", violations: [], error: e instanceof Error ? e.message : String(e) });
          }
          results.push(...mine);
          const tolerated = (r: A11yResult) => r.violations.filter((v) => allow.some((a) => a.page === page && a.rule === v.id)).length;
          const fresh = mine.reduce((n, r) => n + r.violations.length - tolerated(r), 0);
          const errors = mine.filter((r) => r.error);
          const states = mine.length;
          log((fresh || errors.length ? c.red("✗ ") : c.green("✓ ")) + label + c.dim(` ${states} scan${states === 1 ? "" : "s"}${fresh ? `, ${fresh} new` : ""}`));
          for (const r of errors) log(c.red("    ") + `${r.state}: ` + c.dim(r.error!));
        }
      }
    }
  } finally {
    try { await chrome?.close(); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }

  const { failures, grown, shrunk, unused } = applyAllowlist(results, allow);
  if (json) console.log(JSON.stringify(results, null, 2));
  for (const f of failures) {
    if (f.error) continue;
    for (const v of f.violations) {
      log(`\n${c.red(v.impact ?? "violation")} ${v.id} on ${f.page} (${f.viewport}, ${f.scheme}, ${f.state}): ${v.help}\n  ${c.dim(v.helpUrl)}`);
      for (const n of v.nodes.slice(0, 5)) log(`  ${n.target}\n    ${c.dim(n.html)}\n    ${c.dim(n.summary)}`);
      if (v.nodes.length > 5) log(c.dim(`  … and ${v.nodes.length - 5} more`));
    }
  }
  for (const g of grown) {
    log(`\n${c.red("More elements than allowlisted")}: ${g.entry.rule} on ${g.entry.page} hits ${g.found.length}, the allowlist covers ${g.entry.nodes}. Fix the new element rather than raising "nodes".`);
    // A CI log cannot be re-run with more detail, and the new element is often the last one in the list: print them all there.
    const shown = process.env.CI ? g.found.length : 15;
    for (const t of g.found.slice(0, shown)) log(`  ${t}`);
    if (g.found.length > shown) log(c.dim(`  … and ${g.found.length - shown} more`));
  }
  for (const s of shrunk) log(c.red(`\nFewer elements than allowlisted: ${s.entry.rule} on ${s.entry.page} now hits ${s.found}, the entry says ${s.entry.nodes}. Set "nodes" to ${s.found} in a11y-allowlist.json.`));
  for (const u of unused) log(c.red(`\nUnused allowlist entry: ${u.rule} on ${u.page} no longer fires. Remove it from a11y-allowlist.json.`));
  const errors = results.filter((r) => r.error).length;
  const count = failures.reduce((n, f) => n + f.violations.length, 0);
  log(`\n${results.length} scans in ${((Date.now() - started) / 1000).toFixed(1)}s · ${count} violation(s) · ${grown.length + shrunk.length + unused.length} allowlist problem(s) · ${errors} error(s) · ${allow.length} allowlisted`);
  if (count || errors || grown.length || shrunk.length || unused.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
