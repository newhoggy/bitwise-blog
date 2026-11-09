# corpus/

Writers' posts and everything derived from them, used to read, search and quote locally and to run the
advisor tools.

```
corpus/README.md                committed: this file
corpus/<writer>/sources.yaml    committed: where to fetch this writer's posts from
corpus/<writer>/voice_model.json, stance_model.json   committed (once built): numbers only
corpus/private                  NOT committed: everything else; a symlink to a clone of a private data repo
```

## The rule: nothing derived from a writer's text is committed

This repository and its site are public. The posts are other people's writing, and what is derived from
them can misrepresent them: paraphrases, imitations of a voice, even imitations arguing against the
writer's own views. So all of it stays in the private data, and only URLs and numbers are public.

| Artifact | Holds | Where |
| --- | --- | --- |
| `sources.yaml` | URLs | Public |
| `voice_model.json`, `stance_model.json` | Numbers only | Public |
| Code, prompts, schemas | No corpus text | Public |
| `posts/` | Full text | Private |
| `ATLAS.jsonl` | Verbatim quotes and close paraphrase | Private |
| `PROFILE.md`, `INDEX.md`, `corpus_meta.yaml` | Characterisation, titles, curation judgments | Private |
| `evals/items.jsonl`, `authored.jsonl`, `voice_negatives.jsonl` | Paragraphs, rewrites, imitations of a voice | Private; the last two must never be public |
| `evals/*_cache.jsonl`, `evals/samples/` | Paraphrasing judgments, generated advice | Private |
| `contrast/`, `general_prose.jsonl` | Other authors' paragraphs | Private |

Guards, because a rule that must hold every time belongs in a check:

- `tests/advisor-guards.test.mts` fails if git tracks anything under `corpus/` but the files listed above, if the
  published site holds any `corpus/` path or text from the private data, or if `.gitignore` stops covering
  `corpus/private` (as a symlink or a directory). They run in CI, with no private data.
- `npm run advisor -- leak-check` runs locally when the private data is present. It fails if a run of 8 or more
  words from the private text is in a tracked file. That text is every post, the atlas quotes and statements,
  `voice_negatives.jsonl` and `evals/authored.jsonl`. It prints file names, lines, lengths and which of those the
  run came from, never the words. A page that quotes on purpose needs an entry in `LEAK_ALLOWED` in
  `scripts/advisor/guards.mts`, with a reason and a cap on the shared words, so quoting more still fails.
- `.githooks/pre-push` runs `leak-check --pushed` before every push, so it runs without anyone remembering. Enable it
  once per clone with `npm run hooks` (`git config core.hooksPath .githooks`; worktrees share the setting). With no
  private data in the checkout it does not block the push: it says nothing was checked and how to `link`.
  It checks what is being pushed, not what is checked out: it reads the lines git gives a pre-push hook and scans
  the blobs those commits add, meaning the objects reachable from the pushed refs but not from the remote's
  remote-tracking refs or its current value for each ref. So pushing a branch that is not checked out is checked,
  a leaky file in the working tree blocks nothing, and a deleted ref or a ref with nothing new adds no blobs. A
  blob is held to its path's `LEAK_ALLOWED` cap, as in `--history`, and since only new blobs are read, text already
  in older history does not block a push that doesn't add it. A leak removed by a later commit is still in the
  pushed history, so it is still caught: drop or rewrite the commit. When the remote is given as a URL rather than
  a remote name there are no tracking refs, so everything reachable from the pushed refs is read.
  It is local and per clone: `git push --no-verify`, a clone that never ran `npm run hooks`, and merges made on
  GitHub skip it. CI can't do better without committing something derived from the private text (hashes of 8-word
  runs are guessable), which this repo's rule forbids; `tests/githooks.test.mts` pins the hook with real pushes.
- `npm run advisor -- leak-check --history` does the same for every text blob reachable from any ref, so it finds
  text that was committed once and later removed. A blob is held to its own path's `LEAK_ALLOWED` cap. It only
  reports: removing text from history means rewriting it, which is the owner's decision, and it keeps failing
  until then. Hits are named `path@<blob id>:line`.
- Advisor output is never published as the writer's words, and a reviewed draft is never written to disk.

## The private data

`corpus/private` is git-ignored. Tools find it through one function, `dataDir(slug)` in
`scripts/advisor/corpus.mts`. Its layout:

```
<writer>/posts/*.md             the fetched posts
<writer>/corpus_meta.yaml       per-post judgments: category, atlas, split, provenance
<writer>/INDEX.md               catalogue of the posts (generated)
<writer>/PROFILE.md, ATLAS.jsonl, agent.md, voice_negatives.jsonl
<writer>/evals/, retrieval/, atlas_build/, contrast/, parity/
general_prose.jsonl, thoughts/, library/
```

Clone the private data repo anywhere outside this repository, then point each worktree at it (git worktrees
don't share ignored files, so this is once per worktree):

```
npm run advisor -- link <path-to-clone>
```

With no clone, `npm run sync-posts` makes `corpus/private` a plain directory. That works, but it belongs to that
one checkout: it goes when a worktree is removed, and `link` won't replace it while it has anything in it.

## Commands

```
npm run advisor -- link <path> [--force]         point corpus/private at a clone
npm run advisor -- index [<writer>]              regenerate the INDEX.md catalogues
npm run advisor -- holdout <writer> [--check]    choose the eval holdout, or check it is current
npm run advisor -- leak-check [--history]        see above
npm run advisor -- parity                        compare with the Python reference; skips without private data
```

`holdout` holds out 15% of the atlas-eligible posts (`split: eval` in `corpus_meta.yaml`), stratified by category
and era and ordered by a seeded hash, so the same corpus always gives the same holdout. Posts the atlas reads and
posts the evals read are therefore disjoint.

The code is a TypeScript port of the shoulder-advisors repo, tracked in issue #110. Where Python's behaviour
matters (cache keys, rounding, YAML, whitespace), it goes through `scripts/advisor/py-compat.mts`, which is
pinned by `tests/fixtures/advisor/goldens.json`, generated from the Python code. Those fixtures use made-up
writers only; never add real corpus text to them.

## Sync

```
npm run sync-posts -- duncan-sabien           # new posts only
npm run sync-posts -- --all                   # every writer that has a sources.yaml
npm run sync-posts -- duncan-sabien --full    # try every post, however many are already on disk
```

Posts go to `corpus/private/<writer>/posts/`. Idempotent: a post already on disk (`<platform>-<slug>.md`) is skipped, and each source stops
after five already-fetched posts in a row, so a routine run makes few requests. Use `--full`
after adding a source, to retry posts that were paywalled before, or when you suspect a gap.
Exit code: 0 on success, 1 if the writer has no `sources.yaml` or still has posts in the old place
(`corpus/<writer>/posts/`: move them to the private data), 2 if any source or post failed
(the rest still sync).

Each post is `---` frontmatter (`title`, `author`, `source`, `published`, `platform`, `slug`),
the body as markdown, then `---` and `Source: <url>`.

The code is in `scripts/sync-posts.mts` and `scripts/ingest/`. It is a TypeScript port of
`update_advisor.py` and `lib/ingest_*.py` from the shoulder-advisors repo, and writes the same file
names and frontmatter, so a corpus can be copied between the two. The bodies differ slightly (markdown
converters disagree on blank lines and spacing), and eval ids carry paragraph indexes, so **never delete
posts and re-fetch them**: an imported post is the copy of record, and sync only adds new ones.

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
