#!/usr/bin/env node
// External link check: every absolute http(s) link the published pages carry, requested once each.
//
//   npm run links                         check, print every URL with its status, exit 1 if any is broken
//   npm run links -- --quiet              print only the URLs that need attention
//   npm run links -- --markdown <file>    also write the findings as Markdown (the issue body)
//   npm run links -- --json <file>        also write every result as JSON
//   npm run links -- --issue              report through the one `link-check` issue (the weekly workflow)
//
// It is not part of `check` or of PR CI on purpose: a slow or bot-hostile third-party site must never turn
// a PR red. `.github/workflows/links.yml` runs it weekly. Zero dependencies (Node's fetch). See
// "External links" in CLAUDE.md.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Generic on purpose: no project, person or contact details reach the sites we link to. */
export const USER_AGENT = "Mozilla/5.0 (compatible; link-check/1.0)";
export const ISSUE_LABEL = "link-check";
export const ISSUE_TITLE = "External links need attention";
const MARKER = "<!-- bh:link-check";
const MAX_REDIRECTS = 10;
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const PERMANENT_REDIRECT = new Set([301, 308]);

/** A page the check reads, by repo-relative path. An unlisted page is named in the console but not in the public issue. */
export interface LinkPage { href: string; unlisted: boolean }

/** One external URL (fragment removed) and the pages that use it, sorted. */
export interface LinkUse { url: string; pages: string[] }

/** What `collectLinks` found. */
export interface Collected { pages: LinkPage[]; uses: LinkUse[] }

/** One response in a redirect chain. */
export interface Hop { url: string; status: number }

/** Requesting one URL, following redirects by hand. `status` is 0 when no final response arrived (`error` says why). */
export interface Probe {
  status: number;
  /** The 3xx responses on the way, in order. */
  redirects: Hop[];
  /** The URL that gave the final response (the URL itself when nothing redirected). */
  final: string;
  error?: string;
  method: "HEAD" | "GET";
  attempts: number;
}

/** What an allowlist entry tolerates: a final status code, a timeout, any other request failure, or a permanent redirect. */
export type Accept = number | "timeout" | "error" | "redirect";

/** A URL (or a prefix ending in `*`) whose listed outcomes are known and accepted, and why. */
export interface AllowEntry { url: string; accept: Accept[]; reason: string }

export type Outcome = "broken" | "moved" | "ok";

/** One checked URL. `movedTo` is where a moved link should now point; `allowed` is the entry that tolerates a broken or moved outcome. */
export interface UrlResult extends Probe { url: string; pages: string[]; outcome: Outcome; movedTo?: string; allowed?: AllowEntry }

/** Everything a run found. */
export interface LinkReport { results: UrlResult[]; pages: LinkPage[]; unused: AllowEntry[]; date: string; siteBase: string }

/** The parts of `fetch` the check uses, so tests can stub it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** How URLs are requested. Every field has a default; tests shorten the timeout and stub `sleep`. */
export interface CheckOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
  /** Attempts in all, for transient outcomes (network errors, timeouts, 429, 5xx). */
  attempts?: number;
  /** The wait before the second, third, … attempt. */
  backoffMs?: number[];
  /** The most a `Retry-After` header can make us wait. */
  maxRetryAfterMs?: number;
  concurrency?: number;
  perHost?: number;
}

/** Runs `gh` with arguments and optional stdin, returning stdout; throws when it fails. Injectable for tests. */
export type Gh = (args: string[], input?: string) => string;

/** The two output streams `main` writes to (the console, or a test's sink). */
export interface Output { log: (...args: any[]) => void; error: (...args: any[]) => void }

export type Env = Record<string, string | undefined>;

// ---- Pages and links ------------------------------------------------------------------

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
const metaTrue = (html: string, name: string) => new RegExp(`<meta\\s+name="${name.replace(":", "\\:")}"\\s+content="true"`, "i").test(html);

/**
 * The pages whose links readers can follow: the home page and every `docs/*.html` that is published and readable.
 * Left out: private sources (never published), sealed shells (their links are ciphertext) and example pages
 * (`publish.mts` removes them from the deployed site, so no reader sees their links).
 */
export function publishedPages(root: string = ROOT): LinkPage[] {
  const pages: LinkPage[] = fs.existsSync(path.join(root, "index.html")) ? [{ href: "index.html", unlisted: false }] : [];
  const dir = path.join(root, "docs");
  if (!fs.existsSync(dir)) return pages;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).sort()) {
    const html = stripComments(fs.readFileSync(path.join(dir, file), "utf8"));
    if (/\bid="sealed-payload"/i.test(html) || metaTrue(html, "bh:example")) continue;
    pages.push({ href: `docs/${file}`, unlisted: metaTrue(html, "bh:unlisted") });
  }
  return pages;
}

/** The site's own address from `homepage` (or BH_SITE_URL), ending in "/"; "" when there is none. */
export function siteBase(root: string = ROOT, env: Env = process.env): string {
  let url = env.BH_SITE_URL;
  if (!url) {
    try { url = (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { homepage?: string }).homepage; } catch { /* no package.json */ }
  }
  try { const u = new URL(url ?? ""); u.hash = ""; u.search = ""; return u.href.endsWith("/") ? u.href : `${u.href}/`; } catch { return ""; }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** An attribute value as the URL to check, or null when it is not an external http(s) URL. The fragment is removed. */
export function externalUrl(raw: string, base = ""): string | null {
  let v = decode(raw).trim();
  if (v.startsWith("//")) v = `https:${v}`;
  if (!/^https?:\/\//i.test(v)) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  u.hash = "";
  if (base && (u.href.startsWith(base) || u.href === base.slice(0, -1))) return null; // the site itself: `check`'s job
  return u.href;
}

const TAG = /<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The external URLs in a page's `href` and `src` attributes, de-duplicated, in order of appearance. Comments and
 * the bodies of `<script>` and `<style>` are skipped (code, not links); `<template>` content is markup and counts.
 * `<link rel="preconnect|dns-prefetch">` names an origin, not a document, so it is skipped too.
 */
export function extractLinks(html: string, base = ""): string[] {
  const text = stripComments(html).replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi, "$1$3");
  const found = new Set<string>();
  for (const tag of text.matchAll(TAG)) {
    const attrs = new Map<string, string>();
    for (const a of (tag[2] ?? "").matchAll(ATTR)) attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? "");
    if (tag[1]!.toLowerCase() === "link" && /\b(?:preconnect|dns-prefetch)\b/i.test(attrs.get("rel") ?? "")) continue;
    for (const name of ["href", "src"]) {
      const raw = attrs.get(name);
      const url = raw === undefined ? null : externalUrl(raw, base);
      if (url) found.add(url);
    }
  }
  return [...found];
}

/** Every external URL of the published pages, with the pages that use it. Sorted by URL. */
export function collectLinks(root: string = ROOT, env: Env = process.env): Collected {
  const pages = publishedPages(root);
  const base = siteBase(root, env);
  const byUrl = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const url of extractLinks(fs.readFileSync(path.join(root, page.href), "utf8"), base)) {
      const set = byUrl.get(url) ?? new Set<string>();
      set.add(page.href);
      byUrl.set(url, set);
    }
  }
  const uses = [...byUrl].map(([url, set]) => ({ url, pages: [...set].sort() })).sort((a, b) => a.url.localeCompare(b.url));
  return { pages, uses };
}

// ---- Allowlist ------------------------------------------------------------------------

/** What is wrong with a parsed allowlist, in words; empty when it is valid. */
export function allowlistProblems(data: unknown): string[] {
  if (!Array.isArray(data)) return ["the allowlist must be a JSON array of { url, accept, reason } entries"];
  const problems: string[] = [];
  data.forEach((e: unknown, i) => {
    const where = `entry ${i + 1}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) { problems.push(`${where} is not an object`); return; }
    const o = e as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!["url", "accept", "reason"].includes(k)) problems.push(`${where} has an unknown field "${k}"`);
    if (typeof o.url !== "string" || !/^https?:\/\/[^\s*]+\*?$/.test(o.url)) problems.push(`${where}: "url" must be an http(s) URL, or a prefix ending in "*"`);
    if (!Array.isArray(o.accept) || !o.accept.length) problems.push(`${where}: "accept" must list what is tolerated (status codes, "timeout", "error", "redirect")`);
    else for (const a of o.accept) if (!(Number.isInteger(a) && (a as number) >= 100 && (a as number) <= 599) && !["timeout", "error", "redirect"].includes(a as string)) problems.push(`${where}: "accept" has ${JSON.stringify(a)}, which is not a status code, "timeout", "error" or "redirect"`);
    if (typeof o.reason !== "string" || !o.reason.trim()) problems.push(`${where}: "reason" must say why the outcome is accepted`);
  });
  return problems;
}

/** The allowlist at `file` (none when the file is missing). Throws on a malformed one. */
export function loadAllowlist(file: string): AllowEntry[] {
  if (!fs.existsSync(file)) return [];
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error(`${file} is not valid JSON: ${(e as Error).message}`); }
  const problems = allowlistProblems(data);
  if (problems.length) throw new Error(`${file}: ${problems.join("; ")}`);
  return data as AllowEntry[];
}

export const allowMatches = (entry: AllowEntry, url: string): boolean => (entry.url.endsWith("*") ? url.startsWith(entry.url.slice(0, -1)) : url === entry.url);

/** Whether `entry` tolerates what happened to `r` (which must be broken or moved). */
export function tolerates(entry: AllowEntry, r: Pick<UrlResult, "outcome" | "status" | "error">): boolean {
  if (r.outcome === "moved") return entry.accept.includes("redirect");
  if (r.status > 0) return entry.accept.includes(r.status);
  return entry.accept.includes(/^timeout\b/.test(r.error ?? "") ? "timeout" : "error");
}

// ---- Requests -------------------------------------------------------------------------

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function describeError(e: unknown, timeoutMs: number): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `timeout after ${timeoutMs / 1000}s`;
  const cause = err?.cause;
  if (cause?.code) return `${cause.code}${cause.message && !cause.message.includes(cause.code) ? `: ${cause.message}` : ""}`;
  return cause?.message || err?.message || String(e);
}

/** Seconds or an HTTP date, as milliseconds from now; undefined when absent or unreadable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

interface Followed { status: number; redirects: Hop[]; final: string; error?: string; transient: boolean; retryAfter?: number }

/** One request, following redirects by hand so every hop's status is known. Bodies are never read. */
async function follow(url: string, method: "HEAD" | "GET", o: Required<Pick<CheckOptions, "fetch" | "timeoutMs">>): Promise<Followed> {
  const redirects: Hop[] = [];
  const seen = new Set<string>([url]);
  let current = url;
  const headers = { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en" };
  for (;;) {
    let res: Response;
    try {
      res = await o.fetch(current, { method, redirect: "manual", headers, signal: AbortSignal.timeout(o.timeoutMs) });
    } catch (e) {
      return { status: 0, redirects, final: current, error: describeError(e, o.timeoutMs), transient: true };
    }
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && res.status !== 304 && location) {
      redirects.push({ url: current, status: res.status });
      let next: string;
      try { next = new URL(location, current).href; } catch { return { status: 0, redirects, final: current, error: `unreadable Location header "${location}"`, transient: false }; }
      if (seen.has(next)) return { status: 0, redirects, final: next, error: "redirect loop", transient: false };
      if (redirects.length >= MAX_REDIRECTS) return { status: 0, redirects, final: next, error: `more than ${MAX_REDIRECTS} redirects`, transient: false };
      seen.add(next);
      current = next;
      continue;
    }
    return { status: res.status, redirects, final: current, transient: TRANSIENT_STATUS.has(res.status), retryAfter: retryAfterMs(res.headers.get("retry-after")) };
  }
}

const failed = (f: Followed) => f.status === 0 || f.status >= 400;

/**
 * Request one URL: HEAD, then GET when HEAD fails or answers >= 400 (many servers mishandle HEAD). Transient
 * outcomes (network errors, timeouts, 429, 5xx) are retried after a backoff, honouring a short `Retry-After`.
 * Never throws.
 */
export async function checkUrl(url: string, options: CheckOptions = {}): Promise<Probe> {
  const o = { fetch: options.fetch ?? (globalThis.fetch as FetchLike), timeoutMs: options.timeoutMs ?? 15_000 };
  const sleep = options.sleep ?? defaultSleep;
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoff = options.backoffMs ?? [1000, 3000];
  const maxRetryAfter = options.maxRetryAfterMs ?? 10_000;
  let useHead = true;
  for (let attempt = 1; ; attempt++) {
    let method: "HEAD" | "GET" = useHead ? "HEAD" : "GET";
    let f: Followed;
    try {
      f = await follow(url, method, o);
      if (method === "HEAD" && failed(f)) { useHead = false; method = "GET"; f = await follow(url, method, o); }
    } catch (e) {
      f = { status: 0, redirects: [], final: url, error: describeError(e, o.timeoutMs), transient: false };
    }
    if (!f.transient || attempt >= attempts) {
      return { status: f.status, redirects: f.redirects, final: f.final, method, attempts: attempt, ...(f.error ? { error: f.error } : {}) };
    }
    const wait = Math.max(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0, Math.min(f.retryAfter ?? 0, maxRetryAfter));
    await sleep(wait);
  }
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** `uses` reordered round-robin by host, so the queue never runs one site's URLs back to back. */
function interleave(uses: LinkUse[]): LinkUse[] {
  const groups = new Map<string, LinkUse[]>();
  for (const u of uses) { const h = hostOf(u.url); groups.set(h, [...(groups.get(h) ?? []), u]); }
  const lists = [...groups.values()], out: LinkUse[] = [];
  for (let i = 0; out.length < uses.length; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

/** Check every URL: at most `concurrency` requests at once, and at most `perHost` on one host. */
export async function checkAll(uses: LinkUse[], options: CheckOptions = {}): Promise<Map<string, Probe>> {
  const concurrency = Math.max(1, options.concurrency ?? 8), perHost = Math.max(1, options.perHost ?? 2);
  const queue = interleave(uses);
  const results = new Map<string, Probe>();
  const active = new Map<string, number>();
  let waiters: Array<() => void> = [];
  const worker = async (): Promise<void> => {
    while (queue.length) {
      const i = queue.findIndex((u) => (active.get(hostOf(u.url)) ?? 0) < perHost);
      if (i < 0) { await new Promise<void>((r) => waiters.push(r)); continue; } // every queued host is busy: a running request will wake us
      const use = queue.splice(i, 1)[0]!;
      const host = hostOf(use.url);
      active.set(host, (active.get(host) ?? 0) + 1);
      try { results.set(use.url, await checkUrl(use.url, options)); } finally {
        active.set(host, active.get(host)! - 1);
        const wake = waiters; waiters = []; for (const w of wake) w();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}

/**
 * broken: no final response, or one >= 400. moved: it works, but the link itself answers with a permanent redirect
 * (301/308). A permanent hop after a temporary one is the target's business, not the link's: `doi.org` answers 302
 * by design, and the publisher's own http → https move behind it is no reason to change a DOI. Otherwise ok.
 */
export function classify(p: Pick<Probe, "status" | "redirects">): Outcome {
  if (p.status === 0 || p.status >= 400) return "broken";
  return p.redirects[0] && PERMANENT_REDIRECT.has(p.redirects[0].status) ? "moved" : "ok";
}

/** Where a moved link should point: the end of its leading run of permanent redirects. */
export function movedTo(p: Pick<Probe, "redirects" | "final">): string {
  const k = p.redirects.findIndex((h) => !PERMANENT_REDIRECT.has(h.status));
  return k < 0 ? p.final : p.redirects[k]!.url;
}

const ORDER: Record<Outcome, number> = { broken: 0, moved: 1, ok: 2 };

/** Results joined with their pages and the allowlist, sorted: broken, moved, ok; then by URL. Also the entries that tolerated nothing. */
export function buildReport(uses: LinkUse[], probes: Map<string, Probe>, allow: AllowEntry[], pages: LinkPage[], extra: { date: string; siteBase: string }): LinkReport {
  const usedEntries = new Set<AllowEntry>();
  const results: UrlResult[] = uses.map((u) => {
    const probe = probes.get(u.url) ?? { status: 0, redirects: [], final: u.url, error: "not checked", method: "HEAD" as const, attempts: 0 };
    const r: UrlResult = { url: u.url, pages: u.pages, ...probe, outcome: classify(probe) };
    if (r.outcome === "moved") r.movedTo = movedTo(probe);
    if (r.outcome !== "ok") {
      const entry = allow.find((e) => allowMatches(e, u.url) && tolerates(e, r));
      if (entry) { r.allowed = entry; usedEntries.add(entry); }
    }
    return r;
  });
  results.sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome] || Number(!!a.allowed) - Number(!!b.allowed) || a.url.localeCompare(b.url));
  return { results, pages, unused: allow.filter((e) => !usedEntries.has(e)), date: extra.date, siteBase: extra.siteBase };
}

// ---- Reports --------------------------------------------------------------------------

const needsAttention = (r: UrlResult) => r.outcome !== "ok" && !r.allowed;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many URLs fall in each group. */
export function counts(report: LinkReport): { broken: number; moved: number; allowed: number; ok: number } {
  const c = { broken: 0, moved: 0, allowed: 0, ok: 0 };
  for (const r of report.results) {
    if (r.allowed) c.allowed++;
    else c[r.outcome]++;
  }
  return c;
}

const statusText = (r: Pick<Probe, "status" | "error">) => (r.status ? String(r.status) : "ERR");
const chain = (r: UrlResult) => [...r.redirects.map((h) => `${h.status} ${h.url}`), `${statusText(r)} ${r.final}`].join(" → ");

/** The console report: a summary, then each group with every URL's status, redirect target and pages. */
export function formatConsole(report: LinkReport, { quiet = false } = {}): string {
  const c = counts(report);
  const lines = [`Checked ${plural(report.results.length, "external URL")} from ${plural(report.pages.length, "page")}: ${c.broken} broken, ${c.moved} moved permanently, ${c.allowed} allowlisted, ${c.ok} ok.`];
  const group = (title: string, rows: UrlResult[]) => {
    if (!rows.length) return;
    lines.push("", `${title} (${rows.length})`);
    for (const r of rows) {
      lines.push(`  ${statusText(r).padEnd(4)} ${r.url}`);
      if (r.movedTo) lines.push(`       moved to: ${r.movedTo}`);
      if (r.redirects.length) lines.push(`       redirects: ${chain(r)}`);
      if (r.error) lines.push(`       error: ${r.error}`);
      if (r.allowed) lines.push(`       allowlisted: ${r.allowed.reason}`);
      lines.push(`       pages: ${r.pages.join(", ")}`);
    }
  };
  group("Broken", report.results.filter((r) => r.outcome === "broken" && !r.allowed));
  group("Moved permanently: update the link", report.results.filter((r) => r.outcome === "moved" && !r.allowed));
  group("Allowlisted", report.results.filter((r) => r.allowed));
  if (!quiet) group("OK", report.results.filter((r) => r.outcome === "ok"));
  if (report.unused.length) {
    lines.push("", `Unused allowlist entries (${report.unused.length}): nothing they accept happened this run. Remove an entry once its site answers reliably.`);
    for (const e of report.unused) lines.push(`  ${e.url}  (${e.accept.join(", ")})`);
  }
  return lines.join("\n");
}

/** A digest of what needs attention, so the issue can tell a changed finding from a repeated one. */
export function digest(report: LinkReport): string {
  const lines = report.results.filter(needsAttention).map((r) => `${r.outcome} ${r.url} ${r.status || "error"} ${r.movedTo ?? ""}`);
  return crypto.createHash("sha256").update(lines.sort().join("\n")).digest("hex").slice(0, 16);
}

export const digestOf = (body: string): string | undefined => new RegExp(`${MARKER} digest=([0-9a-f]+)`).exec(body)?.[1];

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The findings as Markdown, for the public issue. Unlisted pages are not named there: listing them would surface them. */
export function formatMarkdown(report: LinkReport): string {
  const c = counts(report);
  const unlisted = new Set(report.pages.filter((p) => p.unlisted).map((p) => p.href));
  const pageLink = (href: string) => {
    if (unlisted.has(href)) return "an unlisted page";
    return report.siteBase ? `[${href}](${report.siteBase}${href === "index.html" ? "" : href})` : `\`${href}\``;
  };
  const pagesCell = (r: UrlResult) => [...new Set(r.pages.map(pageLink))].join(", ");
  const out = [
    `${MARKER} digest=${digest(report)} -->`,
    `The external-link check (\`npm run links\`, run by \`.github/workflows/links.yml\`) ran on ${report.date}: ` +
      `${plural(report.results.length, "URL")} from ${plural(report.pages.length, "page")}, **${c.broken} broken**, **${c.moved} moved permanently**, ${c.allowed} allowlisted, ${c.ok} ok.`,
  ];
  const broken = report.results.filter((r) => r.outcome === "broken" && !r.allowed);
  if (broken.length) {
    out.push("", "### Broken", "", "| Status | URL | Detail | Pages |", "| --- | --- | --- | --- |");
    for (const r of broken) out.push(`| ${statusText(r)} | ${cell(r.url)} | ${cell([r.error, r.redirects.length ? `after ${chain(r)}` : ""].filter(Boolean).join("; "))} | ${pagesCell(r)} |`);
  }
  const moved = report.results.filter((r) => r.outcome === "moved" && !r.allowed);
  if (moved.length) {
    out.push("", "### Moved permanently", "", "Update these to where they now live.", "", "| URL | Now at | Pages |", "| --- | --- | --- |");
    for (const r of moved) out.push(`| ${cell(r.url)} | ${cell(r.movedTo ?? r.final)} | ${pagesCell(r)} |`);
  }
  const allowed = report.results.filter((r) => r.allowed);
  if (allowed.length) {
    out.push("", `<details><summary>Allowlisted (${allowed.length})</summary>`, "", "| Status | URL | Reason |", "| --- | --- | --- |");
    for (const r of allowed) out.push(`| ${r.outcome === "moved" ? "moved" : statusText(r)} | ${cell(r.url)} | ${cell(r.allowed!.reason)} |`);
    out.push("", "</details>");
  }
  if (report.unused.length) {
    out.push("", `Unused allowlist entries: ${report.unused.map((e) => `\`${e.url}\``).join(", ")}. Nothing they accept happened this run; remove an entry once its site answers reliably.`);
  }
  out.push(
    "",
    "Fix or remove each broken link. A site that works in a browser but refuses automated clients gets an entry in " +
      "`links-allowlist.json`, with the outcome it gives and the reason. The workflow updates this issue on every run, " +
      "and closes it when a run finds nothing that needs attention. See \"External links\" in `CLAUDE.md`.",
  );
  return out.join("\n");
}

// ---- The issue ------------------------------------------------------------------------

interface IssueRow { number: number; state: string; body: string }

/**
 * Report through one issue, found by its label: create it, or reopen and update it, while something needs
 * attention; close it when nothing does. A body edit notifies nobody, so a changed finding also gets a comment.
 * Returns what it did. Throws when a `gh` call fails, so the job goes red instead of failing silently.
 */
export function syncIssue(report: LinkReport, markdown: string, gh: Gh): string {
  gh(["label", "create", ISSUE_LABEL, "--description", "Opened and updated by the weekly external-link check", "--color", "d93f0b", "--force"]);
  const rows = JSON.parse(gh(["issue", "list", "--label", ISSUE_LABEL, "--state", "all", "--limit", "50", "--json", "number,state,body"]) || "[]") as IssueRow[];
  const issue = rows.sort((a, b) => b.number - a.number)[0];
  const c = counts(report);
  const attention = c.broken + c.moved;
  if (attention) {
    if (!issue) {
      const url = gh(["issue", "create", "--title", ISSUE_TITLE, "--label", ISSUE_LABEL, "--body-file", "-"], markdown).trim();
      return `opened ${url || "the issue"}`;
    }
    const n = String(issue.number);
    const reopened = issue.state.toUpperCase() !== "OPEN";
    if (reopened) gh(["issue", "reopen", n]);
    gh(["issue", "edit", n, "--body-file", "-"], markdown);
    if (reopened || digestOf(issue.body ?? "") !== digest(report)) {
      gh(["issue", "comment", n, "--body-file", "-"], `The ${report.date} run found ${c.broken} broken and ${c.moved} moved ${attention === 1 ? "link" : "links"}; the description above is up to date.`);
      return `${reopened ? "reopened" : "updated"} #${n} and commented`;
    }
    return `updated #${n} (same findings as before)`;
  }
  if (issue && issue.state.toUpperCase() === "OPEN") {
    const n = String(issue.number);
    gh(["issue", "comment", n, "--body-file", "-"], `The ${report.date} run found nothing that needs attention (${plural(report.results.length, "URL")}, ${c.allowed} allowlisted). Closing.`);
    gh(["issue", "close", n]);
    return `closed #${n}`;
  }
  return "nothing to report";
}

const runGh: Gh = (args, input) => execFileSync("gh", args, { input: input ?? "", encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], timeout: 60_000 });

// ---- main -----------------------------------------------------------------------------

const USAGE = `npm run links [-- --quiet] [--markdown <file>] [--json <file>] [--issue]

Requests every external http(s) link of the published pages and reports broken links (no response, or
>= 400) and permanent redirects, with each URL's status, redirect target and the pages that use it.
  --quiet            leave out the URLs that are fine
  --markdown <file>  also write the findings as Markdown
  --json <file>      also write every result as JSON
  --issue            report through the one "${ISSUE_LABEL}" issue with gh (the weekly workflow)
Exit status: 0 nothing broken (or, with --issue, reported), 1 something broken, 2 the check itself failed.`;

/** What `main` can be given instead of the real network, `gh` and clock. */
export interface MainDeps extends CheckOptions { gh?: Gh; today?: string; allowlist?: string }

export async function main(argv: string[] = process.argv.slice(2), env: Env = process.env, out: Output = console, root: string = ROOT, deps: MainDeps = {}): Promise<number> {
  let quiet = false, issue = false, markdownFile = "", jsonFile = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.log(USAGE); return 0; }
    else if (a === "--quiet") quiet = true;
    else if (a === "--issue") issue = true;
    else if (a === "--markdown" || a === "--json") {
      const file = argv[++i] ?? "";
      if (!file) { out.error(`${a} needs a file`); return 2; }
      if (a === "--markdown") markdownFile = file; else jsonFile = file;
    } else { out.error(`unknown argument "${a}"\n${USAGE}`); return 2; }
  }
  let allow: AllowEntry[];
  try { allow = loadAllowlist(deps.allowlist ?? path.join(root, "links-allowlist.json")); } catch (e) { out.error(`links: ${(e as Error).message}`); return 2; }
  const { pages, uses } = collectLinks(root, env);
  if (!uses.length) { out.error(`links: no external links found in ${plural(pages.length, "page")}. That is almost certainly a bug in the collector, not a clean site.`); return 2; }
  out.error(`Checking ${plural(uses.length, "external URL")} from ${plural(pages.length, "page")}…`);
  const probes = await checkAll(uses, deps);
  const report = buildReport(uses, probes, allow, pages, { date: deps.today ?? new Date().toISOString().slice(0, 10), siteBase: siteBase(root, env) });
  out.log(formatConsole(report, { quiet }));
  const markdown = formatMarkdown(report);
  try {
    if (markdownFile) fs.writeFileSync(markdownFile, `${markdown}\n`);
    if (jsonFile) fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## External links\n\n${markdown}\n`);
  } catch (e) { out.error(`links: ${(e as Error).message}`); return 2; }
  if (issue) {
    try { out.log(`\nIssue: ${syncIssue(report, markdown, deps.gh ?? runGh)}`); } catch (e) { out.error(`links: reporting through the issue failed: ${(e as Error).message}`); return 2; }
    return 0;
  }
  return counts(report).broken ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
