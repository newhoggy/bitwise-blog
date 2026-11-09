// Medium ingester (via RSS feed).
//
// Medium's public feed at /feed/@<user> returns up to ~10 most recent posts with full HTML body.
// That is the v1 scope: Medium does not expose deeper pagination publicly. For authors who
// haven't posted recently, this returns their most recent 10 posts regardless of age.
//
// Config:
//     - platform: medium
//       user: ThingMaker

import { Ingester, htmlToMarkdown, type IngesterOptions, type PostMetadata, type SourceConfig } from "./base.mts";
import { PLAIN_USER_AGENT, loadXml, type Selection } from "./html.mts";
import type { CheerioAPI } from "cheerio";

export class MediumIngester extends Ingester {
  readonly platform: string = "medium";
  readonly user: string;
  private feed: { $: CheerioAPI; items: Selection[] } | null = null;

  constructor(corpusDir: string, config: SourceConfig, options?: IngesterOptions) {
    super(corpusDir, config, options);
    if (!config.user) throw new Error("medium source requires 'user'");
    this.user = String(config.user).replace(/^@+/, "");
  }

  private async loadFeed(): Promise<{ $: CheerioAPI; items: Selection[] }> {
    if (this.feed) return this.feed;
    const r = await this.request(`https://medium.com/feed/@${this.user}`, { headers: { "User-Agent": PLAIN_USER_AGENT } });
    const $ = loadXml(await r.text());
    return (this.feed = { $, items: $("item").toArray().map((el) => $(el)) });
  }

  async *listPosts(): AsyncGenerator<PostMetadata> {
    const { items } = await this.loadFeed();
    for (const item of items) {
      const link = childText(item, "link");
      if (!link) continue;
      const title = childText(item, "title") || "Untitled";
      const author = childText(item, "dc\\:creator", false) || this.user;
      const slug = (link.replace(/\/+$/, "").split("/").at(-1)!.split("?")[0]) || "untitled";
      const when = new Date(childText(item, "pubDate", false));
      yield {
        slug,
        title,
        url: link,
        published: Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10),
        author,
        extra: {},
      };
    }
  }

  async fetchPostBody(meta: PostMetadata): Promise<string> {
    const { items } = await this.loadFeed();
    for (const item of items) {
      if (childText(item, "link") !== meta.url) continue;
      const html = childText(item, "content\\:encoded", false);
      if (!html.trim()) throw new Error("no content:encoded in RSS item");
      const md = htmlToMarkdown(html);
      if (!md) throw new Error("empty body after conversion");
      return md;
    }
    throw new Error("item not found in feed");
  }
}

/** Text of an item's direct child element (`selector` is a cheerio selector, `:` escaped). */
function childText(item: Selection, selector: string, trim = true): string {
  const text = item.children(selector).first().text();
  return trim ? text.trim() : text;
}
