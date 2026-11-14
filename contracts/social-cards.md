# Social cards

Read this before touching the social meta block, `bh:image`, `npm run cards`, `scripts/cards.mts` or `docs/assets/og/`.

Every public page unfurls into a rich preview (Open Graph and Twitter `summary_large_image`)
when its link is pasted into Slack, Discord, iMessage, LinkedIn, X or Mastodon. Authors write
nothing for this; two generated things do the work.

- **The social meta block.** `npm run index` writes it into each page's `<head>`, between
  `<!-- bh:social:start … -->` and `<!-- bh:social:end -->`: `canonical`, `og:type`,
  `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image` (+ type, size, alt),
  `article:published_time`, `article:author`, `article:tag` and `twitter:card`. It is derived
  from the page's own `title`, `description` and `bh:*` metas, so fix a preview by fixing
  those. **Never write `og:`, `article:`, `twitter:` or `canonical` tags by hand**: `check`
  fails on them, and on a missing or stale block. Keep the marker pair in the `<head>`
  (the templates have it). Keep descriptions under about 200 characters, since previews cut
  them off (`check` warns).
- **Structured data.** The block also ends with one `<script type="application/ld+json">` line
  of schema.org data, for search engines: a `TechArticle` on each post (headline, description,
  `datePublished`, authors, keywords, url, card image, publisher) and a `WebSite` on the home
  page. Posts are the feed's: example, unlisted and `reference` pages get none, and sealed
  shells never have a block. The text is decoded from the page's HTML, and `</` and `<!--` are
  JSON-escaped so a title cannot end the script. **Never write JSON-LD by hand**: `check` fails
  on one outside the block, and the block's equality check catches a missing or stale one.
  `bundle` drops its `url` and `image` (the publisher's site link stays, like the footer's
  attribution link); `publish` refuses an unlisted page that carries one.
- **The card image**, `docs/assets/og/<slug>.png`, 1200×630. `npm run cards` renders it in
  the local Chrome (Node ≥ 22; `CHROME_PATH` if it isn't found, and it needs network for the
  web fonts). It frames a **visual taken from the page itself** with the logo, the title, the
  kind and the date, so a bare diagram still says something in a chat unfurl. The visual is
  the first match of:
  1. `<meta name="bh:image" content="#element-id">` (an element on the page) or
     `content="path/to/image.png"` (relative to the page): the author's override, for when
     the automatic pick is wrong;
  2. the first `<figure>` with an `<svg>`, `<img>`, `<bh-sequence>` or `<bh-chart>`;
  3. a standalone `<img>` in the article;
  4. the hero glyph (`bh-hero-mark`);
  5. the logo tile (`theme/logo/mark-tile.svg`).

  The element is screenshot from the real page in the light theme, so diagrams keep their
  theme colours. Because the choice is made from the source, put the diagram that best
  explains the page first, or set `bh:image`.
- **Staleness.** Each PNG records a hash (a `tEXt` chunk named `bh-card`) of the chosen
  visual's source and image files, the title, kind, date, site name, the page's `<style>`,
  `theme/{tokens,base,layout,components,diagrams}.css`, `theme/bh.js`, the logo and
  `scripts/cards.mts` (plus `theme/modules/*.js` when the visual is a `<bh-…>` component).
  So a theme change makes every card stale: re-run `npm run cards` along with
  `npm run visual`. `check` recomputes the hash with no browser and fails on a missing,
  wrong-sized or stale card, and on a card whose page is gone or private. `npm run cards`
  skips cards that are current, deletes orphans, and keeps going when one page can't be drawn
  (it then exits non-zero and names it; a figure hidden in an inactive tab needs `bh:image`).
  Commit the PNGs. They differ slightly from machine to machine; only the hash is compared.
- **No Chrome.** `npm run cards` then replaces each missing or stale card with a copy of the
  shared site card (`theme/logo/og.png`), tagged `fallback`. `check` accepts that locally with
  a warning, so you are not blocked, but **fails under `CI`**: render the card where Chrome
  exists before the PR merges. Rendering needs Node ≥ 22.
- **The home page** uses the shared site card. **Bundles** (`npm run bundle`) keep
  `og:title`, `og:description` and `article:*` but drop `canonical`, `og:url`, `og:image*` and
  `twitter:*`, since a standalone file has no URL or card of its own.
- **Absolute URLs** come from one place: `homepage` in `package.json`
  (`https://bitwise.john-ky.io/`). A fork sets that, or `BH_SITE_URL`. The site
  name is `bh.siteName` in `package.json`. Changing either makes the block and every sealed
  shell stale: run `npm run index`, `npm run cards` and `npm run seal -- --reshell`.
- **Private pages** unfurl as one generic "Private page" card: see [Private pages](private-pages.md).
- Render the cards and look at them when you change `scripts/cards.mts`, the theme tokens or
  a diagram's colours. `docs/assets/og/` holds only cards, one per public page.
