# Page diffs

Read this before touching `npm run diff`, `scripts/page-diff.mts`, `scripts/page-history.mts`,
`theme/diffs/`, `theme/modules/diff.js`, `theme/diff.css`, `?diff=`, or the Review panel's "changes since".

A page's history is in git. This feature shows what changed between two versions of a page as a
reader would see it, in three places that share one function, `diffPages` (`scripts/page-diff.mts`).

## How two versions are compared

- **Blocks first.** A block is a direct child of `<article class="bh-article">`. Blocks are matched by
  id, else by identical text; unmatched neighbours that share half their words are paired as
  *changed*; a block that turns up elsewhere (same id, same text, or 80% of the same words) is *moved*,
  not removed and added. So the page contract's rules (content as direct children, permanent ids) are
  what make a diff readable: renaming an id turns a change into a removal and an addition.
- **Then words.** Inside a changed block the prose is diffed word by word and written into the *new*
  version's markup as `<ins>`/`<del>`, only inside text that may hold them (never between table rows
  or list items), so the result always nests properly. An entity is one word.
- **Rows and items before words.** Inside a changed block, table rows and list items (`tr`, `li`, `dt`,
  `dd`) are aligned like blocks are, a row by its first cell. A row that stayed is compared only with
  itself, cell by cell when both versions have the same number of cells, and nested lists the same way
  in turn. A row that is gone is written back where it was as a row of its own, struck through and
  marked `data-diff="removed"`. A reordered row shows as gone in one place and added in another.
- **Pictures are compared whole.** An inline `<svg>`, a `<bh-sequence>`, a Mermaid sketch, a `<canvas>`
  and any `<script>` are never word-diffed. When one changes, the old and new figures are shown as a
  `<bh-versions>` pair, and each part with a `data-id` is marked `data-change` (removed, added, changed)
  unless the author marked it already. Those marks obey the page's change-highlight switch (the top
  bar's button, off when a page opens), so a diff turns it on: a diff page (`<html data-bh-diff>`) starts with
  it on (the rule is `bhChanges.startsOn()` in `theme/unlisted.js`, see [Unlisted pages](unlisted-pages.md#change-highlights-before-first-paint)), and `diff.js` calls `bh.showChanges()` when it places a changed diagram. A copy drawn in a
  shadow tree cannot see the switch on its ancestors, so `bh.mirrorChanges()` writes `data-changes="off"`
  onto the tree's content whenever an ancestor has it; `upgrade` calls it for a new tree.
- **A page that marks nothing gets the switch while a diff's marks are on it.** The top bar has the
  button only when the page has a `data-change` part at load. So when `bh.showChanges()` finds none, it
  builds the button then, on, in its usual place, and a `bh-diff` listener takes it out again once
  nothing on the page is marked (the diff was closed) and puts it back for the next diff. Decided in
  #262: the pair's own "Show changes" button already covered that case, but a reader who knows the page's
  switch from other pages would find it missing only here, and building it late is a few lines in
  `showChanges`. The button never appears on a page with no marks and no diff. Taking the button out
  also turns the switch on, through the button's own state, so the page is never left with
  `data-changes="off"` and no control (a part marked later would be drawn plain, and leaving the slides
  would not switch it off again); and if the button had focus, focus moves to the control beside it.
- **How the source is wrapped or indented is not a change.** Comments are ignored.
- Each difference says what differs: `text`, `figure` (a picture), or `markup` (attributes or structure only).

## Copies of the old version are inert

Two versions in one document would repeat ids and run the page's script twice. So wherever the old
version is shown beside the live page, it is a copy with: no ids (ids inside a picture are prefixed,
with their `url(#…)` and `href="#…"` references), links turned into plain spans, no scripts, no event
handlers, controls disabled, no `language-*` class (a highlighter would erase its `<ins>`/`<del>`), headings turned into styled paragraphs, and custom elements turned into
`<div data-was="…">` so their scripts never run on the copy (`<bh-sequence>` is kept: it only draws itself).

**A copy styled by id gets a shadow tree.** Page CSS is scoped by id (`#my-figure .part`), and a copy
without ids would lose it. So where a version's page CSS names an id inside a block (`styledById`), the
mark carries a second copy with its ids kept, in a `<template>` inside `.bh-diff-shadow`, and
`bh.diff.upgrade` (`theme/modules/diff.js`) moves it into a shadow tree holding the theme, that version's
page CSS (the old version's travels in the data file as `oldStyle`, and on the diff page as a JSON script)
and the arrow markers. Ids in a shadow tree collide with nothing, and the old CSS styles nothing else. The
plain copy stays as the fallback until then, and without script. Three limits:

- A figure that the page's *script* draws (a canvas, SVG built at load) is still not drawn in a copy:
  nothing runs there.
- The theme reaches a shadow tree through one shared constructed stylesheet. Where its rules cannot be read
  (a page opened from `file://`), each tree gets its own copy of the theme's `<link>` or `<style>` instead.
  `bundle` marks the inlined theme `<style data-bh-theme>` so the page's own CSS can be told from it.
- A version's page CSS reaches its copy only as far as the block itself. A selector that starts outside the
  block (`:root`, `html`, `body`, `[data-theme="dark"] #my-figure`) matches nothing in a shadow tree, and a
  custom property the old CSS declared on `:root` is not set there: the copy inherits the live page's value.
  So scope page CSS by the block's id, and declare its custom properties on the block.

**A copy that scrolls is reachable by keyboard, like the page's own.** `setupScrollRegions` in `bh.js` gives a
scrolling table, code block, diagram figure, copy container (`.bh-diff-old`, `.bh-diff-copy`) or
`data-scroll-region` element a `tabindex` only while it scrolls, and it looks in the shadow trees too. It cannot see a tree being drawn, so `upgrade` calls `bh.scrollRegions()` when it has
drawn one and when the mark around one opens (where a closed `<details>` is not laid out, a copy in it has no
size until then). Below 640px a diagram scrolls in its figure, in a copy as on the page; such a figure keeps its own role and its
caption as its name (#331). The plain copies in a mark are in the article, so they are covered the same way. `tests/page-diff-browser.test.mts` opens a mark
on a wide table and on a diagram at phone width, focuses the copy, scrolls it with a key, and makes it fit again.

**A copy is not one of the page's figures.** It shows no "Figure N" and does not count towards it, in the
mark (`theme/diff.css`) and in a shadow tree (`SHADOW_CSS` in `diff.js`: a counter crosses into a shadow tree).
Otherwise an open mark renumbers every figure after it.

**Nor is a copy's sidenote one of the page's notes.** A copy is made from the page's source, so its
`<span class="sidenote">` has no ref. On the live page the marks arrive after `bh.js` has numbered the notes; on
a diff page they are there first, so `buildSidenotes` leaves out a note inside `.bh-diff-mark`: numbered, it took
an id and a number, and every note after it moved up one (#322). A copy's note has no ref to open it, so
`theme/diff.css` shows it where it stands (in a shadow tree it is shown already: `.js .sidenote` does not match there).
The theme numbers nothing else across blocks: `.bh-article` resets a `table` counter that no rule increments.
`tests/page-diff-browser.test.mts` reads the number the page's last note is drawn with, with the marks closed and
open, on the live page and on a diff page.

**No other pass of `bh.js` takes a copy for the page's own either** (#335). On a diff page the marks and the list
of changes (`.bh-diff-summary`) are in the article when `bh.js` runs, so each pass that walks it leaves them out
(`DIFF_COPY` in `bh.js`), and on the live page the same rules hold for marks that arrive later:

- **Glossary terms** (`GLOSSARY_SKIP`, and `[data-term]`): a term in a copy is not made a control, and does not take
  the page's first use of that term, which is the one that is marked.
- **Code blocks**: a copy's `<pre>` gets no header or Copy button, and with no `language-*` class no highlighter
  matches it (Prism highlights every matching element in the document, on its own as well as when `bh.js` asks).
- **Figure numbers** in a link's toast and a `data-ref`'s title (`linkLabel`) count only the page's own figures.
- **Reading time** (`buildMeta`) counts only the page's words. A diff page builds the hero's list in the
  browser: `diffPages` leaves the generated list and the "Superseded" banner out of both versions
  (`withoutHeroMeta`, `scripts/hero-meta.mts`), since they restate the metas, a version from before #298
  has none, and the reading time would mark the hero changed on most edits. The Review panel's data
  counts blocks without the banner, as `diff.js` skips it (`INJECTED`).
- The rest are harmless there: headings, the table of contents, link buttons, deep links and `data-ref` all need
  an id or an attribute a copy does not keep; reveal-on-scroll only fades in; and Mermaid draws the old sketch in
  the copy, under ids of its own. A scrolling copy joining the tab order is deliberate (above).

`tests/page-diff-browser.test.mts` compares the page's own (terms, figure numbers, reading time, code blocks) on a
diff page, on the same page with its marks taken out and on the live page, and checks that nothing in a copy is
made live.

The word diff replaces a block *in place* only on the standalone diff page, and only when no custom
element is inside it: a component's script reads its content (a chart's table, a code walk's lines), and
an `<ins>` there would change what it computes. Such a block is left alone and its word diff is an inert
copy beside it. A changed code block loses its `language-*` class in place, because the highlighter would
erase the marks.

## The three places

1. **`npm run diff -- docs/<slug>.html [base] [head]`** writes `dist/diff/<slug>.html`: the new version,
   bundled into one file, with a mark before each block that differs and a list of the changes after the
   hero. `base` defaults to `HEAD`, `head` to the working tree. `dist/` is git-ignored.
   `npm run diff -- --changed <base> [--out <dir>] [--summary <file.md>]` does it for every page that
   differs from `<base>`.
2. **CI** (`render` job, pull requests only) runs the `--changed` form against the base commit: the diff
   pages go into the `renders` artifact under `diff/`, and the changed sections of each page into the job
   summary. It only reports. Both the `render` and `package` jobs check out the full history (`fetch-depth: 0`).
3. **The Review panel.** A thread whose first message was written on another commit has a "Changes since
   this comment" button, the panel has "Show changes since", and `?diff=<commit>` does the same from a
   link. `theme/modules/diff.js` loads `theme/diffs/<slug>.<commit>.js` and puts one mark before each live
   block that differs (a `<details>` holding the inert copy) and a change bar on the block. The page's own
   content is never rewritten, so comments stay anchored. For an outdated thread it opens the change whose
   old text holds the quote.
   The live block is found by id, else by its position among the article's children (`find`). `bh.js` wraps a
   code block, so there the article's child is `div.code-block` and the block is the `<pre>` inside it: the
   mark and the change bar go on the wrapper. A block that the *page's script* moved into another block (in
   `how-deflate-compresses`, a figure put inside the code walk) is found by its id, and its mark and change bar
   go on the article's child that holds it now, never inside that block: a component's layout has no room for a
   mark. The bar's counts are the data's, and they count changes, not marks: a moved block is one change with two
   marks, one before the block where it is now and a "was here" mark where it was, linking to it (the diff
   page's list names the move once). So "Previous" and "Next" visit changed + added + removed + 2 × moved marks. A change whose block is nowhere in the article (the script took it
   out, or the page is not the build the data was made for) has no mark, so the bar names it:
   "1 changed (1 not marked here: “…”)". The browser test covers both cases.

## Where the data comes from

`theme/diffs/` is **generated, never committed**, and nothing lists its files:

- `npm run serve` computes `theme/diffs/<slug>.<commit>.js` on request, for any commit, against the
  working tree.
- The deploy (`preparePublishedSite` → `writeReviewDiffs`) writes one file per page and commit that a
  merged review file names, against the staged page. A commit the clone lacks, or a page that did not
  exist then, is skipped with a warning.
- A bundle has none: "changes since" says there is no record.

So on the published site only versions that a review thread refers to can be compared. To compare
anything else, use `npm run diff`.

## Rules that guard what is published

- **A commit id from a review file or a URL is untrusted.** It reaches git only if it matches
  `COMMIT_RE` (7 to 40 hex digits), and a page path only if it matches `PAGE_RE`. Git is run without a shell.
- **No diff of a sealed page**, now or at the old commit, and none for a review whose `document` is
  private (`reviewDiffScript`, `reviewCommits`). A private page's plaintext has no git history anyway.
- **No diff of a page the site does not publish**: the deploy reads the staged pages, after example pages
  are removed.
- **An unlisted page's diff data** is named by its slug and requested only by that page. Do not add a
  manifest or index of `theme/diffs/`: it would list unlisted slugs with their history.
- **Published diff data re-publishes text that was since deleted.** It is in the public history either
  way; `docs/visibility-threat-model.html` records it. Rewriting history to remove text does not remove
  it from an already-deployed site until the next deploy.
- **A copy hides what the page hides.** The theme draws an element marked `data-unlisted` or `data-example` only
  while `<html>` has that switch on (`data-unlisted="on"`, `data-examples="on"`; see [Unlisted pages](unlisted-pages.md)
  and [Example pages](example-pages.md)). A copy keeps those attributes, so in the page the same rule covers it.
  A rule keyed on `<html>` matches nothing in a shadow tree, so `diff.js` repeats the two rules there (`HIDDEN_CSS`),
  keyed on the tree's content, and `mirrorSwitches` writes the switches onto it: when a tree is drawn, and whenever
  either attribute on `<html>` changes. It fails closed:

  - The rule hides unless the tree's content says `on`, so a tree that was never written to shows no such element.
  - It is important and in a layer of its own, in the tree's first `<style>`. An important rule in the first layer
    beats every later one, so the version's page CSS cannot show the element (on the page itself, such CSS can).
  - It is a rule and not a removal (the other design considered: take the elements out of the copy before it is
    attached), because the switch can change after a copy is drawn, both ways, and a rule follows it. `:host-context()`
    would read the switch without mirroring, but only Chrome supports it. Neither design withholds anything: the
    element's text is in the page's HTML and in the diff data, and the switch only decides what is drawn.

  `docs/visibility-threat-model.html` has a row for each switch, and names the test (in
  `tests/page-diff-browser.test.mts`). Adding another rule to the theme that hides content
  by an attribute on `<html>` means adding it here too.

## Changing it

- The core is pure and imports no installed package: `publish.mts` uses it, and the package job installs nothing.
- Status tags reuse the theme's badge tones, and `<ins>`/`<del>` sit on `--ok-soft`/`--danger-soft`; both
  are in `CONTRAST_PAIRS`. Colour is never alone: a mark carries a word, insertions are underlined,
  deletions struck through.
- `theme/modules/review.js` leaves `.bh-diff-ui` out of the text it anchors comments to. Anything the diff
  module adds to the page must carry that class.
- Tests: `tests/page-diff.test.mts` (alignment, the word diff's nesting, inert copies, the data file, the
  git helpers and the published file set on a throwaway repository).
  `tests/page-diff-browser.test.mts` runs `theme/modules/diff.js` in Chrome on a small page: where each
  mark lands (a wrapped code block and a component that redrew its text included), the shadow-tree copies
  (each version's CSS, the shared theme sheet with its layers, no figure number), the outdated-thread jump,
  the Review panel, and phone width (the page is not widened, each copy is inside the screen and its diagram
  scrolls in its figure). It also covers the
  change-highlight switch, by the computed style of each marked part rather than its attribute: off to on
  for `?diff=` on a page with marks of its own, the late-built button on a page with none, and a diff page
  written by the real `bh diff` command, which opens with the highlights on, also when its scripts arrive late; and a bundle
  that arrives slowly, which never paints its highlights before the off state. It is skipped without Chrome.
- `npm run a11y` scans the diff UI: a diff page and a live page opened with `?diff=`, with the marks closed and open
  (the change bar's "Expand all" is a state of the run), at both widths and in both schemes, built with the real code
  from one pair of versions (`scripts/a11y-diff-fixture.mts`; see [The accessibility run](a11y.md)). A new part of the
  diff UI is covered by adding it to that pair. `details.bh-diff-mark > summary` is a 24px target (`target-size`).
- The component gallery's "Diff marks" section is the visual regression sample.
