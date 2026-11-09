// Substack ingester.
//
// Strategy: enumerate posts via `/sitemap.xml` (authoritative; the archive API is capped at
// recent posts only), then scrape each post's HTML page for metadata and body. Skips posts that
// are still paywalled: we rely on Substack's "free after N days" mechanism rather than bypassing
// access controls.
//
// Substack fronts most publications with Cloudflare, which blocks bots that advertise
// themselves. We send a browser-like User-Agent with a comment identifying the tool, which gets
// through politely.
//
// Config:
//     - platform: substack
//       url: https://homosabiens.substack.com

import { Ingester, htmlToMarkdown, type IngesterOptions, type PostMetadata, type SourceConfig } from "./base.mts";
import { BROWSER_USER_AGENT, loadHtml, loadXml, metaContent, newestFirst, sitemapUrls, stripAll, strippedText } from "./html.mts";
import type { CheerioAPI } from "cheerio";

const REQUEST_DELAY_MS = 500;

export class SubstackIngester extends Ingester {
  readonly platform: string = "substack";
  readonly baseUrl: string;

  constructor(corpusDir: string, config: SourceConfig, options?: IngesterOptions) {
    super(corpusDir, config, options);
    if (!config.url) throw new Error("substack source requires 'url'");
    this.baseUrl = String(config.url).replace(/\/+$/, "");
  }

  async *listPosts(): AsyncGenerator<PostMetadata> {
    const r = await this.request(`${this.baseUrl}/sitemap.xml`, { headers: { "User-Agent": BROWSER_USER_AGENT } });
    const entries = newestFirst(sitemapUrls(loadXml(await r.text())).filter((e) => e.loc.includes(`${this.baseUrl}/p/`)));
    for (const { loc, lastmod } of entries) {
      const slug = loc.replace(/\/+$/, "").split("/").at(-1)!;
      yield { slug, title: slug, url: loc, published: lastmod.slice(0, 10), author: "", extra: {} };
    }
  }

  async fetchPostBody(meta: PostMetadata): Promise<string> {
    await this.pause(REQUEST_DELAY_MS);
    const r = await this.request(meta.url, { headers: { "User-Agent": BROWSER_USER_AGENT } });
    const $ = loadHtml(await r.text());

    if ($(".paywall").length || $(".paywall-jump").length) throw new Error("paywalled");

    const body = ["div.available-content", "div.body.markup", "article div.post"]
      .map((sel) => $(sel).first())
      .find((el) => el.length);
    if (!body) throw new Error("post body not found in HTML");

    stripAll(body, [".subscription-widget-wrap", ".subscribe-widget", ".button-wrapper", ".captioned-image-container noscript", "footer"]);

    meta.title = extractTitle($) || meta.title;
    meta.published = extractPublished($) || meta.published;
    meta.author = extractAuthor($) || meta.author;

    const md = htmlToMarkdown($.html(body));
    if (!md) throw new Error("empty body after conversion");
    return md;
  }
}

function extractTitle($: CheerioAPI): string {
  for (const sel of ["h1.post-title", "h1[class*='post-title']", "article h1"]) {
    const h = $(sel).first();
    if (h.length) return strippedText($, h);
  }
  return metaContent($, 'meta[property="og:title"]');
}

function extractPublished($: CheerioAPI): string {
  const meta = metaContent($, 'meta[property="article:published_time"]');
  if (meta) return meta.slice(0, 10);
  return ($("time[datetime]").first().attr("datetime") ?? "").slice(0, 10);
}

function extractAuthor($: CheerioAPI): string {
  return metaContent($, 'meta[name="author"]') || metaContent($, 'meta[property="article:author"]');
}
