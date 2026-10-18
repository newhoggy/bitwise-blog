#!/usr/bin/env node
// Views per post, from GoatCounter's CSV export, joined with each page's title, kind and tags.
//
//   npm run stats                       export from GoatCounter (needs GOATCOUNTER_CODE and a token)
//   npm run stats -- --file export.csv  read a CSV you already have; no token, no network
//
// Zero dependencies, Node ≥ 20. Nothing is written to disk. The token comes from the environment
// (GOATCOUNTER_TOKEN) or from 1Password, is only ever sent as a Bearer header, and is never printed.
// See "Page-view counting" in CLAUDE.md. The output names unlisted pages: keep it private.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODE_RE = /^[a-z0-9-]+$/; // the same rule as GOATCOUNTER_CODE in scripts/publish.mjs
const OP_VAULT = process.env.BH_OP_VAULT || "Private";
export const OP_TOKEN_ITEM = "beautiful-html goatcounter token";
const SUPPORTED_EXPORT_VERSIONS = new Set(["1", "2"]);

// ---- CSV ----------------------------------------------------------------------------

/** RFC 4180 rows: quoted fields, "" for a quote, newlines inside quotes, \n or \r\n, blank lines skipped. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, started = false;
  const endField = () => { row.push(field); field = ""; started = false; };
  const endRow = () => { endField(); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && !started) { quoted = true; started = true; }
    else if (ch === ",") endField();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { /* part of \r\n */ }
    else { field += ch; started = true; }
  }
  if (quoted) throw new Error("the CSV ends inside a quoted field");
  if (field !== "" || row.length) endRow();
  return rows;
}

/** The hits of an export as { version, hits: [{ path, title, event, bot, session, date }] }. Columns are found by header name. */
export function parseHits(text) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) throw new Error("the export is empty (no header line)");
  const header = rows[0].map((h) => h.trim());
  const first = /^(\d+)(\D.*)$/.exec(header[0]);
  if (!first) throw new Error(`unrecognised export header "${header[0]}": expected the export version before "Path" (for example "2Path")`);
  const [, version, firstName] = first;
  if (!SUPPORTED_EXPORT_VERSIONS.has(version)) {
    throw new Error(`GoatCounter export version ${version} is not supported (this script reads versions ${[...SUPPORTED_EXPORT_VERSIONS].join(" and ")}): check https://www.goatcounter.com/help/export`);
  }
  header[0] = firstName;
  const col = (name) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`the export has no "${name}" column`);
    return i;
  };
  const iPath = col("Path"), iEvent = col("Event"), iBot = col("Bot"), iSession = col("Session"), iDate = col("Date");
  const iTitle = header.findIndex((h) => h.toLowerCase() === "title");
  const hits = rows.slice(1).map((r) => ({
    path: r[iPath] ?? "",
    title: iTitle < 0 ? "" : r[iTitle] ?? "",
    event: /^true$/i.test((r[iEvent] ?? "").trim()),
    bot: (r[iBot] ?? "0").trim() !== "0" && (r[iBot] ?? "").trim() !== "",
    session: r[iSession] ?? "",
    date: r[iDate] ?? "",
  }));
  return { version, hits };
}

// ---- Counting and joining ------------------------------------------------------------

/** Views per path, ignoring events and bots. Visitors are distinct sessions. */
export function countViews(hits) {
  const byPath = new Map();
  let bots = 0, events = 0, from = "", to = "";
  for (const h of hits) {
    if (h.event) { events++; continue; }
    if (h.bot) { bots++; continue; }
    const entry = byPath.get(h.path) || { views: 0, sessions: new Set() };
    entry.views++;
    if (h.session) entry.sessions.add(h.session);
    byPath.set(h.path, entry);
    const t = Date.parse(h.date);
    if (!Number.isNaN(t)) {
      if (!from || t < Date.parse(from)) from = h.date;
      if (!to || t > Date.parse(to)) to = h.date;
    }
  }
  return { byPath, bots, events, from, to };
}

/** The site's own sub-path ("/" for a root site, "/beautiful-html/" for a project page), from `homepage` or BH_SITE_URL. */
export function sitePath(root = ROOT, env = process.env) {
  let url = env.BH_SITE_URL;
  if (!url) {
    try { url = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).homepage; } catch { /* no package.json */ }
  }
  try {
    const p = new URL(url).pathname;
    return p.endsWith("/") ? p : p + "/";
  } catch { return "/"; }
}

/** A GoatCounter path as a repo-relative href ("docs/x.html", "index.html"), or the path as it came if it is outside the site. */
export function toHref(goatPath, base = "/") {
  let p = String(goatPath).split(/[?#]/)[0];
  if (!p.startsWith("/")) p = "/" + p;
  if (base !== "/" && p.startsWith(base)) p = "/" + p.slice(base.length);
  p = p.replace(/^\/+/, "");
  if (p === "" || p === "index.html") return "index.html";
  if (p.endsWith("/")) p += "index.html";
  if (p.startsWith("docs/") && !path.posix.extname(p)) p += ".html";
  return p;
}

const meta = (head, name) => (head.match(new RegExp(`<meta\\s+name="${name.replace(":", "\\:")}"\\s+content="([^"]*)"`, "i")) || [])[1]?.trim() ?? "";
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/**
 * Every published page in docs/ by href, with what the repo knows about it. Sealed pages carry no title
 * (it is inside the ciphertext), and plaintext private sources are skipped: they are not published.
 */
export function readCatalogue(root = ROOT) {
  const pages = new Map([["index.html", { href: "index.html", title: "Home page", kind: "", tags: [], notes: [] }]]);
  const dir = path.join(root, "docs");
  if (!fs.existsSync(dir)) return pages;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).sort()) {
    const html = fs.readFileSync(path.join(dir, file), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "";
    const href = `docs/${file}`;
    if (/<meta\s+name="bh:sealed"/i.test(head) || /\bid="sealed-payload"/i.test(html)) {
      pages.set(href, { href, title: `(private page) ${href}`, kind: "", tags: [], notes: ["private"] });
      continue;
    }
    const notes = [];
    if (meta(head, "bh:unlisted") === "true") notes.push("unlisted");
    if (meta(head, "bh:example") === "true") notes.push("example");
    pages.set(href, {
      href,
      title: unescape((head.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim() ?? file),
      kind: meta(head, "bh:kind") || "explainer",
      tags: meta(head, "bh:tags").split(",").map((t) => t.trim()).filter(Boolean),
      notes,
    });
  }
  return pages;
}

/** Rows for the report: one per repo page (0 views if unseen), then one per path that matches no page. Sorted by views. */
export function joinViews(counts, catalogue, base = "/") {
  const merged = new Map(); // href -> { views, sessions, paths }
  for (const [goatPath, entry] of counts.byPath) {
    const href = toHref(goatPath, base);
    const m = merged.get(href) || { views: 0, sessions: new Set(), paths: [] };
    m.views += entry.views;
    for (const s of entry.sessions) m.sessions.add(s);
    m.paths.push(goatPath);
    merged.set(href, m);
  }
  const rows = [];
  for (const page of catalogue.values()) {
    const m = merged.get(page.href);
    rows.push({ ...page, views: m?.views ?? 0, visitors: m?.sessions.size ?? 0 });
  }
  const unmatched = [];
  for (const [href, m] of merged) {
    if (catalogue.has(href)) continue;
    unmatched.push({ href, title: m.paths[0], kind: "", tags: [], notes: ["not in the repo"], views: m.views, visitors: m.sessions.size });
  }
  const order = (a, b) => b.views - a.views || a.title.localeCompare(b.title);
  return { rows: rows.sort(order), unmatched: unmatched.sort(order) };
}

// ---- Report --------------------------------------------------------------------------

const day = (iso) => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toISOString().slice(0, 10));

export function formatReport({ rows, unmatched }, counts) {
  const all = [...rows, ...unmatched];
  const cells = all.map((r) => [String(r.views), String(r.visitors), r.kind, r.title, r.tags.join(", "), r.notes.join(", ")]);
  const head = ["Views", "Visitors", "Kind", "Title", "Tags", "Notes"];
  const width = head.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));
  const line = (r) => r.map((v, i) => (i < 2 ? v.padStart(width[i]) : v.padEnd(width[i]))).join("  ").trimEnd();
  const total = all.reduce((n, r) => n + r.views, 0);
  const range = counts.from ? `${day(counts.from)} to ${day(counts.to)}` : "no pageviews";
  return [
    line(head),
    line(width.map((w) => "-".repeat(w))),
    ...cells.map(line),
    "",
    `${total} pageviews, ${range}. Left out: ${counts.bots} bot hits, ${counts.events} events.` + (unmatched.length ? ` ${unmatched.length} path${unmatched.length === 1 ? "" : "s"} matched no page in the repo.` : ""),
    "Private data: this output names unlisted pages. Do not paste it into a commit, issue, PR or any public place.",
  ].join("\n");
}

// ---- Token ---------------------------------------------------------------------------

const noToken = (why) => `No GoatCounter API token found.${why ? ` (${why})` : ""}
Set it in the environment:        export GOATCOUNTER_TOKEN=<token>
or store it in 1Password as a Password item titled "${OP_TOKEN_ITEM}" in the vault "${OP_VAULT}" (BH_OP_VAULT changes the vault).
Create a token in GoatCounter under Username → API, with the "export" permission. Never commit it.`;

/** GOATCOUNTER_TOKEN, else the 1Password item. Returns { token } or { error } in words. `readItem` is injectable for tests. */
export function resolveToken({ env = process.env, readItem = readOpItem } = {}) {
  const fromEnv = (env.GOATCOUNTER_TOKEN || "").trim();
  if (fromEnv) return { token: fromEnv };
  let why = "";
  try {
    const fromOp = (readItem(OP_TOKEN_ITEM, env.BH_OP_VAULT || OP_VAULT) || "").trim();
    if (fromOp) return { token: fromOp };
    why = "the 1Password item is empty";
  } catch (e) {
    if (e.code !== "ENOENT" && !/isn't an item|not found/i.test(String(e.stderr || e.message))) why = `1Password: ${String(e.stderr || e.message).trim().split("\n")[0]}`;
  }
  return { error: noToken(why) };
}

/** The password field of a 1Password item. The secret travels on stdout only. */
function readOpItem(title, vault) {
  return execFileSync("op", ["item", "get", title, "--vault", vault, "--fields", "label=password", "--reveal"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// ---- GoatCounter export --------------------------------------------------------------

const hint = "CSV exports need “Individual pageviews” turned on in the GoatCounter site settings, and a token with the export permission.";

/** Why a response failed, in words: GoatCounter reports `error` or `errors` in the JSON body. */
async function failure(res, what) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body.error || (body.errors ? JSON.stringify(body.errors) : "");
  } catch { /* not JSON */ }
  if (res.status === 401 || res.status === 403) return new Error(`GoatCounter refused the token while trying to ${what} (HTTP ${res.status}). ${hint}`);
  if (res.status === 429) return new Error(`GoatCounter is rate limiting exports (HTTP 429); wait a minute and try again.`);
  return new Error(`GoatCounter failed to ${what} (HTTP ${res.status}${detail ? `: ${detail}` : ""}). ${hint}`);
}

/** Run an export and return its CSV text. `fetch` and `sleep` are injectable for tests. */
export async function fetchExport({ code, token, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), intervalMs = 1000, maxPolls = 120 }) {
  if (!CODE_RE.test(code || "")) throw new Error("GOATCOUNTER_CODE must contain only lowercase letters, digits and hyphens (a-z, 0-9, -)");
  const api = `https://${code}.goatcounter.com/api/v0`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  let res = await fetch(`${api}/export`, { method: "POST", headers, body: "{}" });
  if (!res.ok) throw await failure(res, "start an export");
  const started = await res.json();
  if (started.id == null) throw new Error("GoatCounter did not return an export id");
  for (let polls = 0; ; polls++) {
    res = await fetch(`${api}/export/${started.id}`, { headers });
    if (!res.ok) throw await failure(res, "check the export");
    const state = await res.json();
    if (state.error) throw new Error(`GoatCounter could not build the export: ${state.error}`);
    if (state.finished_at) break;
    if (polls >= maxPolls) throw new Error(`the export was not ready after ${Math.round((maxPolls * intervalMs) / 1000)} seconds; run it again later`);
    await sleep(intervalMs);
  }
  res = await fetch(`${api}/export/${started.id}/download`, { headers });
  if (!res.ok) throw await failure(res, "download the export");
  const bytes = Buffer.from(await res.arrayBuffer());
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? zlib.gunzipSync(bytes) : bytes).toString("utf8");
}

// ---- main ----------------------------------------------------------------------------

const USAGE = `npm run stats [-- --file <export.csv>]

Prints views per post (from GoatCounter's CSV export) with each page's title, kind and tags.
  GOATCOUNTER_CODE   the site code (the subdomain of <code>.goatcounter.com)
  GOATCOUNTER_TOKEN  an API token with the export permission (or the 1Password item "${OP_TOKEN_ITEM}")
  --file <csv>       read an export you already have instead of calling GoatCounter`;

export async function main(argv = process.argv.slice(2), env = process.env, out = console) {
  let file = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") { out.log(USAGE); return 0; }
    if (argv[i] === "--file") { file = argv[++i] || ""; if (!file) { out.error("--file needs a path"); return 2; } } else { out.error(`unknown argument "${argv[i]}"\n${USAGE}`); return 2; }
  }
  let csv;
  if (file) {
    try { csv = fs.readFileSync(file, "utf8"); } catch (e) { out.error(`stats: can't read ${file}: ${e.message}`); return 1; }
  } else {
    const { token, error } = resolveToken({ env });
    if (error) { out.error(error); return 1; }
    const code = (env.GOATCOUNTER_CODE || "").trim();
    if (!code) { out.error("GOATCOUNTER_CODE is not set: export it as your GoatCounter site code (the part before .goatcounter.com)."); return 1; }
    try { csv = await fetchExport({ code, token }); } catch (e) { out.error(`stats: ${e.message}`); return 1; }
  }
  let counts;
  try { counts = countViews(parseHits(csv).hits); } catch (e) { out.error(`stats: ${e.message}`); return 1; }
  out.log(formatReport(joinViews(counts, readCatalogue(ROOT), sitePath(ROOT, env)), counts));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
