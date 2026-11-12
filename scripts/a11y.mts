#!/usr/bin/env node
// Accessibility pass with axe-core, in the Chrome that scripts/visual.mts already drives.
//
//   node scripts/a11y.mts                    every public page, light and dark
//   node scripts/a11y.mts --only deflate     pages whose path contains "deflate"
//   node scripts/a11y.mts --system-fonts     block Google Fonts (offline / hermetic runs)
//   node scripts/a11y.mts --json             print the full result as JSON on stdout
//
// Each page is opened with reduced motion, in both colour schemes, and waited on until
// <html data-bh-ready>. axe-core (a pinned devDependency) is injected and run against the
// whole document with the WCAG 2.0/2.1 A and AA rules plus axe's best-practice rules.
// Findings that are known and tracked live in a11y-allowlist.json; anything else fails the
// run, and so does an allowlist entry that no longer matches (so the list can only shrink).
// Sealed pages are skipped: their shell is a generic notice and the page is encrypted.
//
// The rules are also checked by `npm run check` (contrast tokens, alt text, svg names). This
// pass is for what only a rendered page shows: computed contrast, names of controls that
// components build at run time, landmarks, duplicate ids after components expand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { launchChrome, serveStatic, sleep, type ChromeHandle } from "./chrome.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];
export const SCHEMES = ["light", "dark"] as const;
export type Scheme = (typeof SCHEMES)[number];

/** One element axe flagged. */
export interface A11yNode { target: string; html: string; summary: string }
/** One rule that failed on one page in one scheme. */
export interface A11yViolation { id: string; impact: string | null; help: string; helpUrl: string; nodes: A11yNode[] }
/** Everything axe found on one page in one scheme, or why it could not run. */
export interface A11yResult { page: string; scheme: Scheme; violations: A11yViolation[]; error?: string }
/** An allowlisted finding: a rule on a page (any scheme), with the reason it is tolerated. */
export interface AllowEntry { page: string; rule: string; reason: string }

/** The pages to scan: the home page and every public doc, as paths relative to the repo root. */
export function publicPages(root: string): string[] {
  const docs = fs.readdirSync(path.join(root, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).sort();
  const open = docs.filter((f) => !fs.readFileSync(path.join(root, "docs", f), "utf8").includes('id="sealed-payload"'));
  return ["index.html", ...open.map((f) => `docs/${f}`)];
}

/** Violations not covered by the allowlist, and allowlist entries that matched nothing. */
export function applyAllowlist(results: A11yResult[], allow: AllowEntry[]): { failures: A11yResult[]; unused: AllowEntry[] } {
  const used = new Set<AllowEntry>();
  const failures: A11yResult[] = [];
  for (const r of results) {
    const violations = r.violations.filter((v) => {
      const hit = allow.find((a) => a.page === r.page && a.rule === v.id);
      if (hit) used.add(hit);
      return !hit;
    });
    if (violations.length || r.error) failures.push({ ...r, violations });
  }
  // An entry is unused only when its page was scanned and the rule did not fire in any scheme.
  const scanned = new Set(results.filter((r) => !r.error).map((r) => r.page));
  return { failures, unused: allow.filter((a) => scanned.has(a.page) && !used.has(a)) };
}

type TabSend = (method: string, params?: object) => Promise<any>;

/** Run axe on one page in one colour scheme. */
export async function scan(send: ChromeHandle["send"], url: string, scheme: Scheme, axeSource: string, blockFonts: boolean): Promise<A11yViolation[]> {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s: TabSend = (m, p) => send(m, p, sessionId);
  try {
    await s("Page.enable");
    await s("Page.bringToFront");
    if (blockFonts) {
      await s("Network.enable");
      await s("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });
    }
    await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    await s("Page.navigate", { url });
    const deadline = Date.now() + 20000;
    for (;;) {
      const r = await s("Runtime.evaluate", { expression: "document.readyState === 'complete' && document.documentElement.hasAttribute('data-bh-ready')", returnByValue: true });
      if (r.result.value) break;
      if (Date.now() > deadline) throw new Error("page never signalled data-bh-ready");
      await sleep(100);
    }
    // Scroll-reveal fades content in; mid-fade colours would read as low contrast.
    // Two frames after clearing it, so styles are computed on what a reader ends up seeing.
    await s("Runtime.evaluate", { expression: `(async () => {
      document.querySelectorAll(".reveal-pending").forEach((e) => e.classList.remove("reveal-pending"));
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    })()`, awaitPromise: true });
    const injected = await s("Runtime.evaluate", { expression: axeSource, returnByValue: true });
    if (injected.exceptionDetails) throw new Error("could not load axe-core: " + (injected.exceptionDetails.exception?.description || injected.exceptionDetails.text));
    const run = await s("Runtime.evaluate", {
      expression: `axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ["violations"] })
        .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl,
          nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 200), summary: (n.failureSummary || "").replace(/\\s+/g, " ").slice(0, 300) })) })))`,
      awaitPromise: true, returnByValue: true,
    });
    if (run.exceptionDetails) throw new Error("axe failed: " + (run.exceptionDetails.exception?.description || run.exceptionDetails.text));
    return run.result.value as A11yViolation[];
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
    return { page: o.page, rule: o.rule, reason: o.reason };
  });
}

async function main() {
  const c = { red: (s: string) => `\x1b[31m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m` };
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const blockFonts = args.includes("--system-fonts");
  const json = args.includes("--json");
  const log = (s: string) => (json ? console.error(s) : console.log(s));

  const axeSource = fs.readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
  const allow = loadAllowlist(path.join(ROOT, "a11y-allowlist.json"));
  const pages = publicPages(ROOT).filter((p) => !only || p.includes(only));
  if (!pages.length) { console.error(`No page matches --only ${only}`); process.exitCode = 1; return; }

  const server = await serveStatic(ROOT);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  let chrome: ChromeHandle | undefined;
  const results: A11yResult[] = [];
  const started = Date.now();
  try {
    chrome = await launchChrome();
    for (const page of pages) {
      for (const scheme of SCHEMES) {
        // ?examples shows example pages; #unlisted=true adds the unlisted cards to the home page.
        const url = `${base}${page}?examples#unlisted=true`;
        try {
          const violations = await scan(chrome.send, url, scheme, axeSource, blockFonts);
          results.push({ page, scheme, violations });
          const tolerated = violations.filter((v) => allow.some((a) => a.page === page && a.rule === v.id)).length;
          const fresh = violations.length - tolerated;
          log((fresh ? c.red("✗ ") : c.green("✓ ")) + `${page} ${scheme}` + c.dim(fresh || tolerated ? ` ${fresh} new, ${tolerated} allowlisted` : ""));
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          results.push({ page, scheme, violations: [], error });
          log(c.red("✗ ") + `${page} ${scheme} ` + c.dim(error));
        }
      }
    }
  } finally {
    try { await chrome?.close(); }
    finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  }

  const { failures, unused } = applyAllowlist(results, allow);
  if (json) console.log(JSON.stringify(results, null, 2));
  for (const f of failures) {
    if (f.error) continue;
    for (const v of f.violations) {
      log(`\n${c.red(v.impact ?? "violation")} ${v.id} on ${f.page} (${f.scheme}): ${v.help}\n  ${c.dim(v.helpUrl)}`);
      for (const n of v.nodes.slice(0, 5)) log(`  ${n.target}\n    ${c.dim(n.html)}\n    ${c.dim(n.summary)}`);
      if (v.nodes.length > 5) log(c.dim(`  … and ${v.nodes.length - 5} more`));
    }
  }
  for (const u of unused) log(c.red(`\nUnused allowlist entry: ${u.rule} on ${u.page} no longer fires. Remove it from a11y-allowlist.json.`));
  const errors = results.filter((r) => r.error).length;
  const count = failures.reduce((n, f) => n + f.violations.length, 0);
  log(`\n${results.length} scans in ${((Date.now() - started) / 1000).toFixed(1)}s · ${count} violation(s) · ${errors} error(s) · ${allow.length} allowlisted`);
  if (count || errors || unused.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
