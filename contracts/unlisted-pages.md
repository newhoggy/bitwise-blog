# Unlisted pages

Read this before touching `bh:unlisted`, `#unlisted=true`, `theme/unlisted.js`, the unlisted data files or the page fragment.

An unlisted page is published and opens from its direct link, but the site itself does not
surface it. **This is discoverability control, not access control.** The page's HTML, the repo,
its history, the deployed artifact and `theme/unlisted-pages.js` are all public. Use a private
(sealed) page when the content itself must stay secret, and never describe an unlisted page as
private.

| Mechanism             | Direct link works?           | Content hidden? | Listed on the site?        |
| --------------------- | ---------------------------- | --------------- | -------------------------- |
| normal page           | yes                          | no              | yes                        |
| example page          | no on the published site (404) | no            | local only                 |
| private (sealed) page | yes, but shows a notice      | yes (encrypted) | no                         |
| **unlisted page**     | **yes, readable**            | no              | **only with `#unlisted=true`** |

- **Mark one** with `<meta name="bh:unlisted" content="true">` in the `<head>`, or create it with
  `npm run new -- --unlisted <template> <slug> "<Title>"`. The marker is the only thing that
  counts. `check` fails on the `unlisted` tag (reserved), on a marker that is not `true`, and on
  a private source (a private page already stays off the site). A page may be both an example and
  unlisted: the stricter rule (removed from the published site) wins.
- **What stays.** The page is published at its normal address and is checked like any other. It
  keeps a social card, so a pasted link unfurls well. The build adds
  `<meta name="robots" content="noindex, nofollow">` to its generated social block; write nothing.
  `noindex` stops compliant crawlers, not anyone who has the URL.
- **What is left out** unless the flag is on: the home page's cards (`cmdIndex` does not write them
  into `index.html`), header search (`theme/search-index.js`), backlinks and "Referenced by"
  (`theme/site.js`), review summaries, and `bundle --all` (naming a page still bundles it).
  Links to an unlisted page are inert text (no `href`, not focusable, `aria-disabled`).
- **The flag** is `#unlisted=true` (also `on`, `1`, `yes`) in the fragment of any page. It is kept
  for the tab session in `sessionStorage["bh-unlisted"]`, so following links keeps it; a new tab
  does not. `#unlisted=false` turns it off and `#unlisted=auto` forgets it. It is not secret, so it
  stays in the address bar; the "copy link" controls still copy only `#id`. **Default is off
  everywhere, local hosts included**, so an author sees what readers see; `npm run serve` prints
  the hint. Pasting a new `#unlisted=…` into an open tab reloads the page.
- **One script decides.** `theme/unlisted.js` is a synchronous script in every page's `<head>`,
  after `examples.js`. It sets `<html data-unlisted="on|off">` (and `data-unlisted-page` on an
  unlisted page) before first paint and owns the fragment parser. `check` fails if a page or
  template lacks it, or if the marker comes after it.
- **Two generated data files, never edited by hand.** `theme/unlisted-pages.js` (`BH_UNLISTED`:
  card data, search text and backlinks of every unlisted page) is fetched **only when the flag is
  on**, so with it off no unlisted title is in any file the page loads. `theme/unlisted-slugs.js`
  holds their paths alone, so `bh.js` can make links to them inert when the flag is off.
  `check` fails when either is stale. An unlisted page's published review threads are in neither
  `site.js` nor `theme/reviews.js` (which every listed page may load): they are in the generated
  `theme/unlisted-reviews.js`, which only the unlisted page itself loads.
- **Cards.** On the home page `theme/modules/unlisted-cards.js` adds one card per unlisted page
  (text only, never `innerHTML`), labelled "Unlisted · <Kind>" in words, before `<bh-filter>`
  re-reads the list (`BhFilter.refresh()`), so chips and the search box cover them.
  `data-bh-ready` waits for it. The card builder is `bh.cards.build`; keep its markup equal to
  `cardHtml` in `scripts/bh.mts` (`tests/unlisted.test.mts` compares them).
- **Links.** A listed page that links to an unlisted one gets a `check` warning: the link is inert
  by default. An unlisted page (and the glossary) may link to one freely; on an unlisted page
  links to other unlisted pages stay live, so a series can be shared as one. Without JavaScript
  every `href` still works: the neutralising is script-only. A decision chain
  (`bh:supersedes` / `bh:superseded-by`) must be all listed or all unlisted.
- **The published site.** `scripts/publish.mts` keeps unlisted pages and their cards, and applies
  the same rules when it rebuilds the index, search, backlinks and the two data files.
- **Prefer a non-guessable slug** (for example a random suffix) for a page meant to be shared by
  link: it is the only protection against guessing.
- **Bundles** show their own content wherever they are opened (`<html data-bundled>`).

## The page fragment

A fragment is a list of `&`-separated tokens, parsed in one place (`parseFragment` in
`theme/unlisted.js`, used through `bh.fragment()`). Reserved: `k=<43-char key>` (a private page's
key, repeatable) and `unlisted=<value>`. The first other token without `=` is a section id to
scroll to, so `#k=<key>&unlisted=true&my-section` works on a sealed page. **Write `k` first**:
the sealed-page shell (frozen, so as not to make every sealed page stale) reads
`#k=<key>[&rest]` and, after decrypting, keeps `rest` (`unlisted=true&my-section`) in the address
bar for `bh.js`; `#unlisted=true&k=<key>` does not open a sealed page.
