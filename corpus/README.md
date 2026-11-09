# corpus/

Writers' posts, pulled from their own sites so they can be read, searched and quoted from locally.

```
corpus/<writer>/sources.yaml    committed: where to fetch this writer's posts from
corpus/<writer>/posts/*.md      NOT committed (git-ignored): the fetched posts
```

**The posts are other people's writing.** This repository and its site are public, so the posts
stay on your machine: `.gitignore` excludes `corpus/*/posts/`, and only `sources.yaml` is
committed. Quote briefly and credit the source when a page uses one.

## Sync

```
npm run sync-posts -- duncan-sabien           # new posts only
npm run sync-posts -- --all                   # every writer that has a sources.yaml
npm run sync-posts -- duncan-sabien --full    # try every post, however many are already on disk
```

Idempotent: a post already on disk (`<platform>-<slug>.md`) is skipped, and each source stops
after five already-fetched posts in a row, so a routine run makes few requests. Use `--full`
after adding a source, to retry posts that were paywalled before, or when you suspect a gap.
Exit code: 0 on success, 1 if the writer has no `sources.yaml`, 2 if any source or post failed
(the rest still sync).

Each post is `---` frontmatter (`title`, `author`, `source`, `published`, `platform`, `slug`),
the body as markdown, then `---` and `Source: <url>`.

The code is in `scripts/sync-posts.mts` and `scripts/ingest/`. It is a TypeScript port of
`update_advisor.py` and `lib/ingest_*.py` from the shoulder-advisors repo, and writes the same file
names and frontmatter, so a corpus can be copied between the two.

## sources.yaml

```yaml
sources:
  # Substack: enumerated from /sitemap.xml, each post's HTML scraped. A paywalled post is
  # reported as an error and skipped; nothing is done to get past a paywall.
  - platform: substack
    url: https://<publication>.substack.com

  # LessWrong: public GraphQL API, no auth.
  - platform: lesswrong
    user: <slug>                   # hyphens, not underscores (usually)
    view: userPosts | top          # optional; userPosts = newest first (default), top = by karma
    max_posts: <int>               # optional; cap the number of posts
                                   # with view: top, early exit is off and every run walks the list

  # Medium: the public RSS feed, which only has the ~10 most recent posts.
  - platform: medium
    user: <username>               # without the leading @

  # WordPress: sitemap, then each post's HTML. Override the selectors for a custom theme.
  - platform: wordpress
    url: https://<domain>
    author: "<Display Name>"       # optional fallback if the HTML doesn't give an author
    sitemap: /wp-sitemap.xml       # optional; falls back to /sitemap.xml
    sitemap_filter: wp-sitemap-posts-post   # optional; substring identifying post sub-sitemaps
    title_selectors: [h1.entry-title]       # optional
    body_selectors: [article .entry-content] # optional
    exclude_url_patterns: [/open-thread-]   # optional; skip URLs containing any of these
    max_posts: <int>               # optional

  # Ghost: like WordPress, with Ghost's default sitemap and selectors.
  - platform: ghost
    url: https://<domain>
    author: "<Display Name>"
```

A writer may have several entries of one platform (three LessWrong accounts, say). Files are
named `<platform>-<slug>.md`, so a post two entries both reach is fetched once.

## Adding a platform

Subclass `Ingester` in `scripts/ingest/`: `listPosts()` yields `PostMetadata` newest first and
lazily, `fetchPostBody()` returns markdown. Register it in `scripts/ingest/index.mts`, and add a
test in `tests/sync-posts.test.mts` that answers its requests from a stub `fetch` (see
`fakeFetch`). Tests never touch the network.
