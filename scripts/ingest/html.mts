// Small helpers over cheerio that the HTML-scraping ingesters share.

import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";

// cheerio does not re-export domhandler's node type, so take it from a function that accepts one.
type AnyNode = Parameters<typeof cheerio.contains>[0];

export type Selection = Cheerio<AnyNode>;

/** A browser-like User-Agent with a comment naming the tool: Cloudflare lets that through politely. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 " +
  "shoulder-advisors/0.1 (personal advisor corpus ingester)";

export const PLAIN_USER_AGENT = "shoulder-advisors/0.1 (personal advisor corpus ingester)";

export function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html);
}

export function loadXml(xml: string): CheerioAPI {
  return cheerio.load(xml, { xmlMode: true });
}

/** The first element matching the first selector (in the order given) that matches anything. */
export function selectFirst($: CheerioAPI, selectors: string[]): Selection | null {
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) return el;
  }
  return null;
}

/** Text of an element with each text node trimmed and the pieces joined without a separator. */
export function strippedText($: CheerioAPI, el: Selection): string {
  const parts: string[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") parts.push(node.data.trim());
      else if ("children" in node) walk(node.children);
    }
  };
  walk(el.toArray());
  return parts.join("");
}

/** `content` of the first `<meta>` matching `selector`, trimmed; "" if there is none. */
export function metaContent($: CheerioAPI, selector: string): string {
  return ($(selector).first().attr("content") ?? "").trim();
}

/** Remove everything under `root` that matches any of the selectors. */
export function stripAll(root: Selection, selectors: string[]): void {
  for (const sel of selectors) root.find(sel).remove();
}

/** `(loc, lastmod)` of each `<url>` of a sitemap `urlset`, in document order. */
export function sitemapUrls($: CheerioAPI): { loc: string; lastmod: string }[] {
  return $("url")
    .toArray()
    .map((el) => ({
      loc: $(el).children("loc").first().text().trim(),
      lastmod: $(el).children("lastmod").first().text().trim(),
    }));
}

/** Newest first by `lastmod` (a string compare, as the dates are ISO). Stable for equal dates. */
export function newestFirst<T extends { lastmod: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.lastmod < b.lastmod ? 1 : a.lastmod > b.lastmod ? -1 : 0));
}
