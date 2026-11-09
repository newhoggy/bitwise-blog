// Base class for syncing a writer's posts from an external platform into corpus/<name>/posts/.
//
// A subclass implements `listPosts` (yields metadata newest-first, lazily) and `fetchPostBody`
// (returns one post's body as markdown). `run` here does the rest: it skips posts already on
// disk, stops once it has seen N already-ingested posts in a row, and renders each new post with
// standard frontmatter. A port of the Python ingesters in the shoulder-advisors repo.

import fs from "node:fs";
import path from "node:path";
import TurndownService from "turndown";
import { parse as parseYaml } from "yaml";

/** One entry of `sources.yaml`: a `platform` plus that platform's own keys. */
export type SourceConfig = Record<string, any>;

/** The `fetch` the ingesters use; tests pass a stub. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface IngesterOptions {
  /** Replaces the global `fetch` (tests). */
  fetch?: FetchFn;
  /** Replaces each ingester's politeness delay between requests, in ms (tests pass 0). */
  delayMs?: number;
}

export interface PostMetadata {
  slug: string;
  title: string;
  url: string;
  /** YYYY-MM-DD, or "" when unknown. */
  published: string;
  author: string;
  extra: Record<string, any>;
}

export interface IngestReport {
  platform: string;
  new: string[];
  skipped: number;
  errors: [slug: string, message: string][];
}

export function reportSummary(r: IngestReport): string {
  return `${r.platform}: +${r.new.length} new, ${r.skipped} skipped, ${r.errors.length} errors`;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 4;
const MAX_RETRY_WAIT_MS = 60_000;

/** How long to wait before retry number `attempt` (0-based): `Retry-After` (seconds or a date) if sent, else 2s doubling. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  let ms = 2000 * 2 ** attempt;
  if (retryAfter !== null && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(seconds)) ms = seconds * 1000;
    else if (!Number.isNaN(at)) ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_WAIT_MS);
}

export abstract class Ingester {
  abstract readonly platform: string;
  readonly postsDir: string;
  /**
   * Subclasses that do not iterate chronologically (for example a karma sort) set this to false,
   * so `run` walks the whole list instead of stopping at the first run of seen posts.
   */
  supportsEarlyExit = true;
  protected readonly config: SourceConfig;
  protected readonly fetchFn: FetchFn;
  protected readonly delayMs: number | undefined;

  constructor(corpusDir: string, config: SourceConfig, options: IngesterOptions = {}) {
    this.config = config;
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.delayMs = options.delayMs;
    this.postsDir = path.join(corpusDir, "posts");
    fs.mkdirSync(this.postsDir, { recursive: true });
  }

  /** Yield post metadata newest-first. Must be lazy, so early exit saves requests. */
  abstract listPosts(): AsyncGenerator<PostMetadata>;

  /** Return the post body as markdown (no frontmatter, no trailing source link). */
  abstract fetchPostBody(meta: PostMetadata): Promise<string>;

  async run(earlyExitAfter = 5): Promise<IngestReport> {
    if (!this.supportsEarlyExit) earlyExitAfter = Infinity;
    const report: IngestReport = { platform: this.platform, new: [], skipped: 0, errors: [] };
    let consecutiveSeen = 0;
    for await (const meta of this.listPosts()) {
      try {
        const file = this.postPath(meta);
        if (fs.existsSync(file)) {
          report.skipped++;
          if (++consecutiveSeen >= earlyExitAfter) break;
          continue;
        }
        consecutiveSeen = 0;
        const body = await this.fetchPostBody(meta);
        fs.writeFileSync(file, renderPost(meta, body, this.platform));
        report.new.push(meta.slug);
      } catch (e) {
        report.errors.push([meta.slug, describeError(e)]);
      }
    }
    return report;
  }

  postPath(meta: PostMetadata): string {
    // The slug comes off the network; it must not be able to leave posts/.
    if (/[\\/\0]/.test(meta.slug)) throw new Error(`unsafe slug ${JSON.stringify(meta.slug)}`);
    return path.join(this.postsDir, `${this.platform}-${meta.slug}.md`);
  }

  /**
   * GET or POST with a timeout; a non-2xx status throws. A 429 or 503 is retried (up to
   * `MAX_RETRIES` times) after the server's `Retry-After`, or 2s, 4s, 8s... if it gave none.
   */
  protected async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const r = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (r.ok) return r;
      if ((r.status === 429 || r.status === 503) && attempt < MAX_RETRIES) {
        await this.pause(retryDelayMs(r.headers.get("retry-after"), attempt));
        continue;
      }
      throw new Error(`HTTP ${r.status} for ${url}`);
    }
  }

  /** Pause between requests; `fallbackMs` is the ingester's own politeness delay. */
  protected async pause(fallbackMs: number): Promise<void> {
    const ms = this.delayMs ?? fallbackMs;
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// ---- Markdown ----------------------------------------------------------------------------

// The options and rules below make turndown write what Python's markdownify wrote in the
// shoulder-advisors repo (ATX headings, "- " bullets, "---" rules, only `*` and `_` escaped, a
// link on one line), so a corpus synced by either side reads the same.
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "*",
  codeBlockStyle: "fenced",
  hr: "---",
  br: "",
});

// Turndown escapes every character that could be Markdown (`[`, a leading `-` or `>`, `1.`...).
// That is noisy in prose that has "[X]" and "non-fit" in it; only `*` and `_` need it.
turndown.escape = (text) => text.replace(/[*_]/g, "\\$&");

// Turndown pads a bullet to "-   item" (four columns). The corpus uses "- item", so replace its
// list-item rule with the same logic and a prefix that is just the marker and one space.
/** The part of a DOM element the rules below read (turndown hands over DOM nodes; this config has no DOM types). */
interface DomElement { nodeName: string; getAttribute(name: string): string | null; children: ArrayLike<unknown> }

// An image inside a link (`<a><div><img></div></a>`, as Substack writes it) comes out of
// turndown's own link rule across several lines, which is not a link. Keep the link on one line.
turndown.addRule("link", {
  filter: (node) => node.nodeName === "A" && !!(node as unknown as DomElement).getAttribute("href"),
  replacement(content, node) {
    const el = node as unknown as DomElement;
    const href = (el.getAttribute("href") ?? "").replace(/([()])/g, "\\$1");
    const title = el.getAttribute("title")?.replace(/(\n+\s*)+/g, "\n");
    return `[${content.trim().replace(/\s*\n+\s*/g, " ")}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`;
  },
});

turndown.addRule("listItem", {
  filter: "li",
  replacement(content, node, options) {
    const parent = node.parentNode as unknown as DomElement;
    let prefix = `${options.bulletListMarker} `;
    if (parent.nodeName === "OL") {
      const start = parent.getAttribute("start");
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = `${start ? Number(start) + index : index + 1}. `;
    }
    const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
    return prefix + body + (node.nextSibling && !body.endsWith("\n") ? "\n" : "");
  },
});

/** HTML to markdown, trimmed. Headings are ATX (`##`) and bullets `-`. */
export function htmlToMarkdown(html: string): string {
  // Trailing spaces (and non-breaking spaces, which Substack uses freely) carry nothing here:
  // hard breaks are written as plain newlines (see `br` above).
  return turndown.turndown(html).replace(/[ \t\u00a0]+$/gm, "").trim();
}

// ---- Rendering ---------------------------------------------------------------------------

export function renderPost(meta: PostMetadata, body: string, platform: string): string {
  const fields: [string, string, boolean][] = [
    ["title", meta.title, false],
    ["author", meta.author, false],
    ["source", meta.url, false],
    ["published", meta.published, true],
    ["platform", platform, false],
    ["slug", meta.slug, false],
  ];
  return [
    "---",
    ...fields.map(([k, v, allowDate]) => `${k}: ${yamlScalar(v, allowDate)}`),
    "---",
    "",
    body.trimEnd(),
    "",
    "---",
    `Source: ${meta.url}`,
    "",
  ].join("\n");
}

const PLAIN_START = /^[-?&*!|>%@`]/;
// Python's str.isprintable(): no control, format, surrogate, private-use, unassigned or separator
// characters (other than the ASCII space).
const NOT_PRINTABLE = /[\p{C}\p{Z}]/u;

/**
 * `s` as a YAML scalar that reads back as the same text.
 *
 * Written plain when that round-trips as a `key: value` line (or, with `allowDate`, reads back as
 * a date, for `published`); otherwise as a double-quoted string. The quoted form is JSON's, which
 * YAML reads back exactly. If `s` has any non-printable character, every non-ASCII character is
 * escaped too, so line breaks such as U+2028 and U+0085 can't be taken for YAML line breaks.
 */
export function yamlScalar(s: string, allowDate = false): string {
  const printable = !NOT_PRINTABLE.test(s.replaceAll(" ", ""));
  // Not plain if it has a non-printable character: YAML 1.1 (PyYAML) reads U+0085, U+2028 and
  // U+2029 as line breaks, which the library used for the check below does not.
  if (printable && s !== "" && !/[:#"']/.test(s) && s.trim() === s && !PLAIN_START.test(s) && plainRoundTrips(s, allowDate)) return s;
  const json = JSON.stringify(s);
  if (printable) return json;
  return json.replace(/[^\x20-\x7e]/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    return cp > 0xffff ? `\\U${cp.toString(16).padStart(8, "0")}` : `\\u${cp.toString(16).padStart(4, "0")}`;
  });
}

/**
 * True if `key: s`, unquoted, reads back as `s`. Catches flow indicators like "[Crosspost] …",
 * values YAML reads as another type ("Yes", "null", "1984"), and line breaks. Read as YAML 1.1,
 * which is what the Python side (PyYAML) uses, so "Yes" counts as a boolean there.
 */
function plainRoundTrips(s: string, allowDate: boolean): boolean {
  let parsed: unknown;
  try {
    parsed = parseYaml(`key: ${s}`, { version: "1.1", logLevel: "error" });
  } catch {
    return false;
  }
  const value = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>).key : undefined;
  return value === s || (allowDate && value instanceof Date);
}
