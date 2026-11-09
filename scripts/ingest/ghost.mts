// Ghost CMS ingester.
//
// Ghost-powered blogs (mindingourway.com, for one) expose a sitemap index at `/sitemap.xml` with
// sub-sitemaps `/sitemap-posts.xml`, `/sitemap-pages.xml`, etc. The post HTML uses Ghost's
// standard theme classes (`h1.post-title`, `section.post-content`, `time[datetime]`).
//
// Mechanically identical to the WordPress ingester (sitemap enumeration plus a themeable HTML
// scrape), so this subclass only swaps the defaults. The platform string is kept as "ghost", so
// posts are saved as `ghost-<slug>.md` rather than `wordpress-<slug>.md`, which keeps
// cross-source slug dedup honest.
//
// Config:
//     - platform: ghost
//       url: https://mindingourway.com
//       author: "Nate Soares"            # fallback if the HTML doesn't expose one
//       # optional overrides:
//       sitemap: /sitemap.xml            # default
//       sitemap_filter: sitemap-posts    # default; substring identifying post sub-sitemaps
//       title_selectors: [...]
//       body_selectors: [...]
//       exclude_url_patterns: [...]
//       max_posts: <int>

import type { IngesterOptions, SourceConfig } from "./base.mts";
import { WordPressIngester } from "./wordpress.mts";

const DEFAULT_TITLE_SELECTORS = ["h1.post-title", "h1.post-full-title", "article h1", "h1"];
const DEFAULT_BODY_SELECTORS = ["section.post-content", "article .post-content", ".post-full-content", ".gh-content", "article"];

export class GhostIngester extends WordPressIngester {
  override readonly platform: string = "ghost";

  constructor(corpusDir: string, config: SourceConfig, options?: IngesterOptions) {
    super(
      corpusDir,
      {
        sitemap: "/sitemap.xml",
        sitemap_filter: "sitemap-posts",
        title_selectors: DEFAULT_TITLE_SELECTORS,
        body_selectors: DEFAULT_BODY_SELECTORS,
        ...config,
      },
      options,
    );
  }
}
