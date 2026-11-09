// WordPress ingester.
//
// Strategy: enumerate posts via `wp-sitemap.xml` (or a configured sitemap entry), walk any
// sitemap-index entries to find post sub-sitemaps, then scrape each post URL for title, date,
// author and body.
//
// Works across WordPress themes by trying a prioritised list of common CSS selectors. For sites
// with custom themes (slatestarcodex.com uses a `pjgm-*` theme), pass `body_selectors` /
// `title_selectors` to override.
//
// Config:
//     - platform: wordpress
//       url: https://slatestarcodex.com
//       # optional overrides:
//       sitemap: /wp-sitemap.xml            # default; also tries /sitemap.xml
//       sitemap_filter: wp-sitemap-posts-post  # substring that identifies post sub-sitemaps
//       title_selectors: [h1.pjgm-posttitle, h1.entry-title, article h1]
//       body_selectors: [div.pjgm-postcontent, article .entry-content, .entry-content]
//       author: "Scott Alexander"           # fallback if not parseable from HTML
//       exclude_url_patterns: ['/open-thread-', '/ot-', '/links-']
//       max_posts: 2000

import { Ingester, htmlToMarkdown, type IngesterOptions, type PostMetadata, type SourceConfig } from "./base.mts";
import { BROWSER_USER_AGENT, loadHtml, loadXml, metaContent, newestFirst, selectFirst, sitemapUrls, stripAll, strippedText } from "./html.mts";
import type { CheerioAPI } from "cheerio";

const REQUEST_DELAY_MS = 500;

const DEFAULT_TITLE_SELECTORS = ["h1.pjgm-posttitle", "h1.entry-title", "article h1", "h1.post-title"];
const DEFAULT_BODY_SELECTORS = [
  "div.pjgm-postcontent",
  "article .entry-content",
  ".entry-content",
  "article .post-content",
  "#content .entry-content",
];
const BODY_STRIP_SELECTORS = [
  ".sharedaddy",
  ".jp-relatedposts",
  "#jp-post-flair",
  ".sd-sharing-enabled",
  ".sd-like",
  ".comments-link",
  "#comments",
  "script",
  "style",
  "noscript",
  ".wp-block-buttons",
];

function stringList(config: SourceConfig, key: string): string[] | undefined {
  const v = config[key];
  if (v == null) return undefined;
  if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) throw new Error(`${key} must be a list of strings`);
  return v.length ? v : undefined;
}

export class WordPressIngester extends Ingester {
  readonly platform: string = "wordpress";
  readonly baseUrl: string;
  readonly sitemapPath: string;
  readonly sitemapFilter: string;
  readonly titleSelectors: string[];
  readonly bodySelectors: string[];
  readonly authorDefault: string;
  readonly excludeUrlPatterns: string[];
  readonly maxPosts: number | undefined;

  constructor(corpusDir: string, config: SourceConfig, options?: IngesterOptions) {
    super(corpusDir, config, options);
    if (!config.url) throw new Error("wordpress source requires 'url'");
    this.baseUrl = String(config.url).replace(/\/+$/, "");

    this.sitemapPath = config.sitemap ?? "/wp-sitemap.xml";
    this.sitemapFilter = config.sitemap_filter ?? "wp-sitemap-posts-post";
    this.titleSelectors = stringList(config, "title_selectors") ?? DEFAULT_TITLE_SELECTORS;
    this.bodySelectors = stringList(config, "body_selectors") ?? DEFAULT_BODY_SELECTORS;
    this.authorDefault = config.author ?? "";
    this.excludeUrlPatterns = stringList(config, "exclude_url_patterns") ?? [];

    const maxPosts = config.max_posts;
    if (maxPosts != null && (!Number.isInteger(maxPosts) || maxPosts <= 0)) {
      throw new Error("wordpress max_posts must be a positive integer");
    }
    this.maxPosts = maxPosts ?? undefined;
  }

  private async fetchSitemap(url: string): Promise<CheerioAPI> {
    const r = await this.request(url, { headers: { "User-Agent": BROWSER_USER_AGENT } });
    return loadXml(await r.text());
  }

  /** The post sub-sitemaps: the root's `<sitemap>` entries that pass the filter, or the root itself if it is a flat list. */
  private async resolvePostSitemaps(): Promise<{ urls: string[]; roots: Map<string, CheerioAPI> }> {
    let rootUrl = `${this.baseUrl}${this.sitemapPath}`;
    let root: CheerioAPI;
    try {
      root = await this.fetchSitemap(rootUrl);
    } catch {
      rootUrl = `${this.baseUrl}/sitemap.xml`;
      root = await this.fetchSitemap(rootUrl);
    }
    if (root("sitemapindex").length) {
      const urls = root("sitemapindex > sitemap > loc")
        .toArray()
        .map((el) => root(el).text().trim())
        .filter((loc) => loc && loc.includes(this.sitemapFilter));
      return { urls, roots: new Map() };
    }
    // Already a flat urlset: no sub-sitemaps, so reuse what was fetched.
    return { urls: [rootUrl], roots: new Map([[rootUrl, root]]) };
  }

  /** (loc, lastmod) from every post sitemap, newest first. */
  private async urlEntries(): Promise<{ loc: string; lastmod: string }[]> {
    const { urls, roots } = await this.resolvePostSitemaps();
    const entries: { loc: string; lastmod: string }[] = [];
    for (const url of urls) {
      const doc = roots.get(url) ?? (await this.fetchSitemap(url));
      entries.push(...sitemapUrls(doc).filter((e) => e.loc));
    }
    return newestFirst(entries);
  }

  async *listPosts(): AsyncGenerator<PostMetadata> {
    let yielded = 0;
    for (const { loc, lastmod } of await this.urlEntries()) {
      if (this.maxPosts !== undefined && yielded >= this.maxPosts) return;
      if (this.excludeUrlPatterns.some((p) => loc.includes(p))) continue;
      const slug = loc.replace(/\/+$/, "").split("/").at(-1)!;
      yield { slug, title: slug, url: loc, published: lastmod.slice(0, 10), author: this.authorDefault, extra: {} };
      yielded++;
    }
  }

  async fetchPostBody(meta: PostMetadata): Promise<string> {
    await this.pause(REQUEST_DELAY_MS);
    const r = await this.request(meta.url, { headers: { "User-Agent": BROWSER_USER_AGENT } });
    const $ = loadHtml(await r.text());

    const body = selectFirst($, this.bodySelectors);
    if (!body) throw new Error("post body not found in HTML");

    stripAll(body, BODY_STRIP_SELECTORS);

    meta.title = extractTitle($, this.titleSelectors) || meta.title;
    meta.published = extractPublished($) || meta.published;
    meta.author = extractAuthor($) || meta.author || this.authorDefault;

    const md = htmlToMarkdown($.html(body));
    if (!md) throw new Error("empty body after conversion");
    return md;
  }
}

function extractTitle($: CheerioAPI, selectors: string[]): string {
  for (const sel of selectors) {
    const h = $(sel).first();
    if (h.length) return strippedText($, h);
  }
  return metaContent($, 'meta[property="og:title"]');
}

function extractPublished($: CheerioAPI): string {
  const meta = metaContent($, 'meta[property="article:published_time"]');
  if (meta) return meta.slice(0, 10);
  return ($("time.entry-date, time[datetime]").first().attr("datetime") ?? "").slice(0, 10);
}

function extractAuthor($: CheerioAPI): string {
  const candidates = [
    metaContent($, 'meta[name="author"]'),
    metaContent($, 'meta[property="article:author"]'),
    strippedText($, $("a[rel=author], .byline a, .author-meta a, .entry-author a").first()),
  ];
  return candidates.find((c) => c && !looksLikeUrl(c)) ?? "";
}

function looksLikeUrl(s: string): boolean {
  return /^(https?:\/\/|\/\/|www\.)/.test(s);
}
