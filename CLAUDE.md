# Bitwise Engineering: house style

This repo is the source of Bitwise Engineering, a software engineering blog on functional
programming, succinct data structures and AI workflows. It produces technical documents as
HTML pages that share one theme (the theme and toolkit keep the name **beautiful-html**, and
the `bh` prefixes). These rules apply to every page, whether a person or an agent writes
it. The live reference for every component is `docs/component-gallery.html`. Copy markup
from it rather than inventing new markup.

## Workflow

1. `npm run new -- <template> <slug> "<Title>" "<one-sentence description>"`
   - Templates: `explainer`, `design-doc`, `adr`, `incident`, `review`
   - Add `--example` for a page that only demonstrates the theme (see [Example pages](contracts/example-pages.md))
   - Add `--unlisted` for a page that is published but not surfaced (see [Unlisted pages](contracts/unlisted-pages.md))
   - This creates `docs/<slug>.html` and refreshes `index.html`
2. Replace every placeholder section. Delete sections that don't earn their place.
3. `npm run check`. It must report 0 errors. Fix the warnings unless there is a reason not to.
4. Open the page in a browser and check both themes and a narrow (phone) width.
   A clean `check` says nothing about rendering, so never skip this step. See
   [Verifying changes](#verifying-changes).
5. `npm run cards` renders the page's social card (needs Chrome). Look at the PNG, then commit
   it with the page. See [Social cards](contracts/social-cards.md).
6. For sharing outside the repo, run `npm run bundle -- docs/<slug>.html` and send `dist/<slug>.html`.

Once per clone, run `npm run hooks`: it points `core.hooksPath` at the tracked `.githooks/`, whose
`pre-push` runs `leak-check --pushed`, which scans the blobs the pushed commits add (not the working tree) and
blocks the push when one holds a run of 8+ words from the private corpus (see `corpus/README.md`). A checkout with no private data is not blocked: the
hook says the check did not run, and `npm run advisor -- link <path>` fixes that (git worktrees don't share
ignored files, so link each one). It is a local guard: `git push --no-verify` and merges made elsewhere skip it.

Run `npm run index` after **any** change to a document. It regenerates the catalogue, the
social meta block and feed autodiscovery link in every page's `<head>`, `feed.xml`, `sitemap.xml`,
`robots.txt`, `404.html`, `theme/glossary.js`, `theme/site.js` (backlinks),
`theme/search-index.js`, `theme/unlisted-pages.js`, `theme/unlisted-slugs.js` and
`theme/unlisted-reviews.js`. `check` fails while any of these are stale. Never edit the
generated files by hand. `theme/private-cards.js` is generated too, but by `npm run seal`, not
`index` (it needs the keys; see [Private pages](contracts/private-pages.md)).

`check` also compares two lists in `README.md`, fenced by `<!-- bh:deps -->` and `<!-- bh:examples -->`
comments, with `package.json` and the `bh:example` markers. Edit the fenced list when either changes
(`scripts/docs-drift.mts`).

Run `npm run cards` after changing a page's title, kind, date, or its first diagram or image
(or the card layout, or the theme tokens): it re-renders every card that `check` calls stale.

## Feature contracts

Each feature's full contract is a file in `contracts/` (outside `docs/`, so it is never published).
Read it before you change the feature; `check` fails if a file named here is missing.

- Editing `scripts/`, `tests/` or `.github/workflows/` (TypeScript rules, job and test timeouts)? Read [`contracts/tooling.md`](contracts/tooling.md).
- The logo, favicon, touch icon, `theme/logo/` or `LOGO_SVG`? Read [`contracts/brand-assets.md`](contracts/brand-assets.md).
- The social meta block, `bh:image`, `npm run cards` or `docs/assets/og/`? Read [`contracts/social-cards.md`](contracts/social-cards.md).
- Sealing, `seal`, `unseal`, `bh:group`, `*.private.html` or `theme/private-cards.js`? Read [`contracts/private-pages.md`](contracts/private-pages.md).
- `bh:example`, `?examples` or `theme/examples.js`? Read [`contracts/example-pages.md`](contracts/example-pages.md).
- `bh:unlisted`, `#unlisted=true`, `theme/unlisted.js` or the page fragment (`#k=…&…`)? Read [`contracts/unlisted-pages.md`](contracts/unlisted-pages.md).
- `feed.xml`, its autodiscovery link or the footer's Subscribe link? Read [`contracts/feed.md`](contracts/feed.md).
- `sitemap.xml`, `robots.txt` or `404.html`? Read [`contracts/sitemap-robots-404.md`](contracts/sitemap-robots-404.md).
- The footer's attribution link, `homepage`, `bh.siteName` or `bh.repoUrl`? Read [`contracts/attribution.md`](contracts/attribution.md).
- External links, `npm run links`, `links-allowlist.json` or the weekly link-check issue? Read [`contracts/external-links.md`](contracts/external-links.md).
- GoatCounter, `GOATCOUNTER_CODE` or `npm run stats`? Read [`contracts/page-views.md`](contracts/page-views.md).
- Defining a term, `docs/glossary.html`, or the glossary popup in `bh.js`? Read [`contracts/glossary.md`](contracts/glossary.md).
- Applying or answering a review file, `reviews/`, or the Review panel? Read [`contracts/reviews.md`](contracts/reviews.md).
- An `npm run a11y` failure, `scripts/a11y.mts` or `a11y-allowlist.json`? Read [`contracts/a11y.md`](contracts/a11y.md).
- Anything in `.claude/skills/`? Read [`contracts/skills.md`](contracts/skills.md), then load the `skill-authoring` skill.

## Page contract

- Pages are flat files in `docs/` and link `../theme/bh.css` and `../theme/bh.js`. Don't add a build step (the Node tooling is type-stripped TypeScript; see [Tooling](contracts/tooling.md)).
- Keep the `<head>` from the template:
  - `title` and `description`
  - `bh:kind`, `bh:status`, `bh:date` (YYYY-MM-DD), `bh:authors`, `bh:tags`
  - optionally `bh:image` (which picture the social card shows; see [Social cards](contracts/social-cards.md))
  - optionally `bh:example` (`true` for an example page; see [Example pages](contracts/example-pages.md))
  - optionally `bh:unlisted` (`true` for an unlisted page; see [Unlisted pages](contracts/unlisted-pages.md))
  - the synchronous `<script src="…/theme/examples.js">` after the theme script, then
    `<script src="…/theme/unlisted.js">` (the `bh:unlisted` marker must come before it)
  - the generated social meta block between its two `bh:social` markers: leave it alone
  - the feed autodiscovery `<link rel="alternate" type="application/atom+xml">` after the icon
    links, and the "Subscribe" link in the footer (both in the templates; see [Atom feed](contracts/feed.md))
  - the inline theme script that prevents a flash of the wrong theme
- Use exactly one `<h1>`, inside `.bh-hero`.
- Content lives as **direct children** of `<article class="bh-article">`. Don't wrap
  sections in `<section>` or `<div>`. The TOC, eyebrows and breakout grid all rely on this.
- **Everything a reader might want to share must be linkable.** That means each of these
  gets an explicit, stable, kebab-case `id` (`a-z`, `0-9`, hyphens):
  - every section heading (`h2`, `h3` and `h4` placed directly in `.bh-article`)
  - every `<figure>`, which includes every diagram
  - every glossary `<dt>`
  - any other block you'd want to point at (a table, a playground, a callout): add
    `data-linkable` and an `id`.
  - every stepper step, automatically: `<bh-stepper for="figure-id">` makes each step
    linkable as `#figure-id-step-N`. A stepper must therefore have `for` (or an `id`).
  - `npm run check` fails when one of these is missing an id or uses a non-kebab id.
    Headings inside components (cards, options) are not sections and are exempt.
- The theme provides the "copy link" controls, so never hand-roll them:
  - Headings and glossary entries show `#` on hover.
  - Figures and `data-linkable` blocks show a link button in the corner.
  - Clicking either copies the full URL, puts `#id` in the address bar, and confirms with
    a toast. Arriving at `#id` opens any `<details>`, tab or stepper step that hides the
    target, scrolls to it and briefly highlights it.
- **Decisions are never deleted, only superseded.** Link a replacement both ways in
  the `<head>`: `bh:supersedes` on the new ADR, and `bh:superseded-by` plus
  `bh:status` "superseded" on the old one. The old page then shows a banner, and the
  index marks it with a dashed border and a struck-through title. `check` fails if the links don't agree.
- **Ids are permanent once published.** Pick ids that name the concept, not the wording:
  `#rollout`, not `#how-we-plan-to-roll-this-out`. If you must rename one, keep the old
  id working with an empty `<span id="old-id"></span>` placed right before the target.
- Width: the default is the reading column. Use `.wide` for figures, tables,
  comparisons and playgrounds. Use `.full` rarely.
- Put page-specific CSS in one `<style>` in `<head>`, scoped by id. Put
  page-specific JS in one `<script>` before `</body>` that runs on `DOMContentLoaded`.
  Never edit the theme to serve a single page.

## Writing

- **Every page doubles as a slide deck** (Present button or `?present`): the title and
  TL;DR form slide 1, and each `h2` section is one slide. So keep sections short enough to
  present, and give a stepper or `data-ref` a figure id. A figure that lives on another
  slide is shown alongside automatically. Opt a page out with `<body data-present="off">`.

- Order the content: **orientation → mental model → mechanism → hands-on → details → edge cases → further reading.**
- Open with a `.tldr` of no more than 3 bullets: the answer, why it matters, and the common mistake.
- Explain *why* at every step, not only *what*. Use real numbers, units and names.
- Put asides in `.sidenote`, not in parentheses. A sidenote opens in the glossary popup from its
  number, so keep it to a sentence or two. Put depth for the curious in `details.disclosure`.
- Use `details.predict` once or twice per page. Asking the reader to predict before
  revealing the answer is the cheapest form of active learning.

## Choose the form from the content

| Content                           | Use                                                        |
| --------------------------------- | ---------------------------------------------------------- |
| Options / trade-offs              | `.compare` with `.option` (mark the pick `.chosen`) + `.pros`/`.cons` |
| A decision                        | `.decision` (one sentence: "We will … because …")          |
| A choice that hinges on priorities | `<bh-matrix id>` table: Criterion, Weight (0–5), then one score column per option (0–5) |
| A process the reader performs     | `ol.steps`                                                 |
| A process a system performs       | SVG diagram + `<bh-stepper for>`                           |
| Messages between parties over time | `<bh-sequence>` in a `figure.diagram` (+ `<bh-stepper for>`) |
| Events in time                    | `ol.timeline` (`.danger` / `.warn` / `.ok` on items)       |
| Numbers that matter               | `.metrics` tiles; tables for anything with more than one dimension |
| A trend over time, or a comparison across categories | `<bh-chart type="line|bar">` around a table, in a `figure` with an id |
| Parallel variants (languages, APIs) | `<bh-tabs>`                                              |
| How an implementation works, step by step | `<bh-codewalk id>`: one `pre>code` + `bh-cw-step lines="3-8"` |
| A relationship between parameters | `<bh-playground>` with `data-expr` / `data-bind`           |
| Facts about a thing               | `dl.kv`                                                    |
| A change to a system (before/after) | `<bh-versions>` with one `figure` per version (`data-label`), parts marked `data-change` |

**One centrepiece interactive per page.** One interaction that changes understanding
beats five decorative ones.

## Diagrams

- Draw inline SVG with theme classes, never hard-coded colours:
  - `<g class="node cN" data-id="…">` wrapping a shape plus `<text>`
  - `<path class="edge" data-id="…">`, which gets an arrowhead automatically
  - `.zone` with `.zone-label` for boundaries; `.label` for annotations
- Give colour a meaning and keep it fixed across the repo:
  - `c1` our system
  - `c2` data and storage
  - `c3` external
  - `c4` failure
  - `c5` network
  - `c6` infrastructure
- **The line stops where the arrowhead begins.** It meets the centre of the head's base at
  a right angle, and it never runs under the head: a stroke reaching the tip blunts the point.
  - The head is 10 units long. Its base sits on the path's end point and it points along
    the path's final direction, so this holds automatically, even for a path ending in a curve.
  - So **end every arrowed path 10 units short of where the tip should land**, which is
    11 short of the target's outline (the tip touches the node's stroke). For example, to
    point right at a node whose left edge is `x=600`, end the path at `x=589`. A curve can
    flow straight into the head: `M550 105 C570 105 570 54 589 54`.
  - `.edge.both` follows the same rule at its start as well.
  - `npm run check` enforces this. It projects each arrow tip and fails when a tip pokes into
    a node, or stops more than 2 units short of the node it points at. Tips aimed at
    non-rectangular shapes can't be verified, so check those by eye.
- **Labels never touch a line or arrowhead.** Place each label in open space beside its edge,
  not on the edge's path. Whenever you move an edge, re-check every label near it: moved
  curves have run straight through labels that used to be clear.
  - `npm run check` estimates label boxes from the theme (about 0.58em per character) and
    fails when a free label touches an edge, an arrowhead, a node or another label, or
    when a node's text is wider than its box.
  - For a deliberate exception, add `data-overlap-ok` to that `<text>`.
- Pad the `viewBox` by at least 16 (`viewBox="-16 -16 W+32 H+32"`) so strokes and labels never clip.
- Every diagram's `<svg>` gets `role="img"` and an `aria-label` describing what it shows.
- **Point at diagram parts from the prose.** When the text names a part of a diagram,
  wrap the phrase: `<span data-ref="figure-id:part-id [part-id…]">the gateway</span>`.
  - Hover or focus lights those parts; click brings the diagram into view.
  - Include the edges that make the point, not just the nodes.
  - `npm run check` fails when the figure or a part id doesn't exist.
- A figcaption says what to *notice*, not what the picture is.
- For message exchanges, use `<bh-sequence>` (actors, `bh-msg from/to [reply]`,
  `bh-note over`), not Mermaid. Give every part a `data-id` that a stepper or a
  `data-ref` can use. It renders at natural size (1 unit = 1px), so keep labels short.
- Mermaid (`<pre class="mermaid">`) is a fallback for quick state or flow sketches only.

## Anatomy figures

For a figure that explains an idea as a real, working machine (an interactive isometric drawing
with a live readout), the vendored `anatomy` skill (`.claude/skills/anatomy/`, see its
`VENDORED.md`) builds it. Its figures are not blog diagrams, so the diagram rules above and the
`check` diagram tests do not apply inside one. Build the figure in `figures/<slug>/` (not in the
skill), then put it in a page with
`node .claude/skills/anatomy/scripts/embed.mjs figures/<slug>/<name>.html docs/<slug>.html --id <figure-id> --before <element-id>`.
Never paste a standalone figure page into `docs/`: its page CSS repaints the whole page and its
colours ignore the theme toggle. Details, and what to check afterwards, are in
`.claude/skills/anatomy/references/bitwise-blog.md`. Use one per page, and only where the machine
is the explanation.

## Charts

- **Pick the form before any colour.** One number → a `.metric` tile, not a chart. A trend
  → `type="line"`. Categories compared → `type="bar"`. When one series is the story, use
  `emphasis="Name"` (accent for it, grey for the rest) rather than many colours.
- **Never two y-axes.** Two measures on different scales get two charts.
- Series colours are the validated `--series-1…6` tokens, assigned by column order, never
  by rank. Don't reuse `--c1…6` (the diagram meanings) or the status colours for series.
- At most 6 series; past that, fold the tail into "Other" or use small multiples. `check`
  enforces the shape of the table and that its values are numbers.
- The table is the accessible twin: keep real headers and units (`unit="ms"`, `y-label`).
- If you change the series palette, re-run the dataviz validator for **both** modes
  against `--surface`, and record the result in `tokens.css`.

## Motion & interaction

- Animation must explain something: flow along an edge, state changing between
  steps, a value responding to input. Never animate for decoration.
- The theme already handles reveal-on-scroll, tab and step transitions, and edge flow.
  Don't add more.
- Everything respects `prefers-reduced-motion`, and every page must still read
  correctly with JavaScript disabled.
- Controls are real `<button>` and `<input>` elements, with visible labels and the keyboard working.
- **Scrolling containers are keyboard-reachable only while they scroll.** `bh.js` gives a `.table-wrap`, a
  code block or a `data-scroll-region="Name"` element `tabindex="0"`, `role="group"` and a name when it
  overflows, and removes them when it fits. Mark a page-specific scroll strip with `data-scroll-region`
  rather than adding `tabindex` by hand.

## Page scripts & simulations

- If a simulation pauses while offscreen (it should, via `IntersectionObserver`), then on
  resume reschedule future events from *now*. Otherwise the events that piled up while
  paused all fire in one frame: a token bucket drained in one burst this way.
- Advance the model's state up to each event's own timestamp before handling that event,
  rather than once per frame. Batch updates give results the real algorithm never would.
- Read inputs from the DOM, or listen for `bh-change` events. Don't assume a component has
  already initialised when your script runs.

## Accessibility & quality bar

- Text contrast is at least 4.5:1 in **both** themes. Use only the theme tokens (`var(--text)`, `var(--c2)`…).
- Never use colour alone to carry meaning: pair it with a label, an icon or a position.
- Every `<img>` has an `alt`, and every `<svg>` diagram has an accessible name.
- Check the page at 375px wide: no horizontal page scroll. Wide tables scroll inside `.table-wrap`.
- **Page size budget.** `check` measures the weight of each public page itself, apart from the
  shared theme: the gzip size (level 9) of its HTML plus every file inside its own folder that it
  loads with `<img src>`. Over 75 KB it warns; over 200 KB it fails (`scripts/page-size.mts`; KB = 1024
  bytes). Gzip is the measure because raw HTML bytes punish repetitive SVG that compresses to almost
  nothing. The largest post is about 65 KB today. When a page trips the warning, cut weight (a
  repeated inline SVG, an unused script, an image that could be SVG) before raising the constants.
  Local files fetched by script, CSS `url()`, the social cards and sealed pages (already
  compressed ciphertext) are not counted, so the budget bounds the page's own HTML and images, not
  everything it could load.
- **`npm run a11y` runs axe-core on every public page, at desktop (1280px) and phone (390px) width, in light and dark** (needs Node ≥ 22 and a local
  Chrome, like `visual`; `--only <text>` limits the pages; web fonts are always blocked, as in CI). Run it
  after a theme, component or page change; CI runs it as the `a11y` job (about two minutes). Sealed pages are skipped.
  What it scans beyond the loaded page, and how `a11y-allowlist.json` counts findings: [`contracts/a11y.md`](contracts/a11y.md).

## Changing the theme

Theme files (`theme/*`) are shared by every page. These rules come from bugs already hit here:

- **In `bh.css`, the `@layer` statement must come before every `@import`.** An `@import`
  that follows any other rule is silently ignored, and the whole theme vanished that way.
  `check` now enforces this order and that imported files exist.
- **Token contrast is checked.** `check` computes WCAG contrast for every
  text/background token pair, from the `light-dark()` values, in both themes
  (`CONTRAST_PAIRS` in `scripts/bh.mts`). Add a pair there whenever a new token is
  used as text on a new background.
- **`!important` reverses inside cascade layers:** an important declaration in an *earlier*
  layer beats one in a later layer. Prefer specificity or layer order; use `!important`
  only to beat the generic article spacing rules.
- **CSS counters skip `display: none` elements.** Anything numbered while hidden (stepper
  steps, tabs) must take its number from a `data-*` attribute that JS sets.
- **Generic article rules leak into components.** `.bh-article li + li` and the flow
  margins apply to every list and child. A component built from lists or grid items must
  reset `margin` on its own items. A missing reset knocked cards out of line.
- **Grids of cards use `auto-fit`, not `auto-fill`.** `auto-fill` leaves empty tracks, so
  a short row doesn't stretch to fill the width.
- **Components must work when `bh.js` runs before the body is parsed.** Bundled pages
  inline the script, so `connectedCallback` must defer to `whenReady()` before reading its
  children.
- **Larger components are on-demand modules** in `theme/modules/*.js`, registered in
  `MODULES` in `bh.js` with the selector that triggers them. A module must be a classic
  script that uses `window.bh` and sets `window.bhModules[file] = true`. `bundle`
  inlines every module.
- **Don't set up state only in observer callbacks.** `IntersectionObserver` and
  `ResizeObserver` fire on rendering frames, which can be throttled. Create observers and
  initial state synchronously during setup, and let callbacks refine them. A walkthrough
  once never created its step detector for exactly this reason.
- **Readiness:** async work (scripts, rendering) must be wrapped in `bh.settle(promise)`,
  so that `<html data-bh-ready>` only appears once the page has truly settled.
  Screenshot tests rely on it.
- **Diagram colour overrides belong in `diagrams.css`.** Layers beat specificity, so a
  stroke rule in `components.css` loses to `.node.cN` in the later diagrams layer.
  `data-change` marks once rendered in the wrong colour for exactly this reason.
- **Keep geometry constants in sync.** The arrowhead size in `bh.js` markers must equal
  `ARROW_LEN` in `scripts/bh.mts`. The popup's `--gap` in `glossary.css` must equal
  `GAP` in `bh.js`.
- **Moving focus fires focus handlers synchronously.** Code that closes a popup and then
  focuses its trigger must stop the trigger's focus handler from reopening it. Esc once
  did nothing for exactly this reason.
- **Resetting a component's margins can remove the article flow spacing.** Reset only the
  sides the flow doesn't own; for example, use `margin-inline: 0`, not `margin: 0`.
- After any theme change, re-check `docs/component-gallery.html`. It is the regression page
  for every component.

## Verifying changes

- **Run `npm run a11y` too** after a theme or component change: it is axe-core on every page in both themes (see [Accessibility & quality bar](#accessibility--quality-bar)).
- **Run `npm run visual` around every theme or component change.** It renders the key
  pages in light, dark and phone layouts and pixel-diffs them against your baselines in
  `.visual/`. If the differences are what you intended, accept them with
  `npm run visual -- --update`; otherwise read `.visual/report.html`. It needs Node ≥ 22
  and a local Chrome (set `CHROME_PATH` if it isn't found). Add `data-vr-mask` to anything
  that animates or is random, such as a live simulation.
- **CI also diffs every pull request against main's renders** (`--system-fonts`, the
  `visual-baseline` artifact each build of main saves). It only reports: read the render job's
  summary for the pages that changed, and the `renders` artifact's `report.html` for the images.
  Only a page that fails to render fails the job. A Chrome update between the two builds can
  show changes you did not make; the summary says when Chrome changed.
- **Screenshot automation must foreground the tab and wait for real frames.** Repeated
  runs once flipped between two renderings, which looked like a font problem and wasn't.
  New tabs could be captured from a stale background frame.

- **Render it.** Lint and syntax checks passed while the page rendered completely unstyled.
  Look at the result in a browser (`npm run serve`) in both themes and at 375px wide.
- **Follow your own links.** Open the page at `#id` for a section and for a figure, and
  confirm each target lands just below the top bar and is visible, not still fading in.
  Click a heading's `#` and a figure's link button: the toast should confirm, the address
  bar should change, and the page should not jump.
- **Zoom in on details.** Problems like a blunted arrow tip, a line hitting an arrowhead off
  centre, or a label crossing a line are invisible at page scale. Use a zoomed screenshot
  of each diagram, in both its normal and its stepper-lit state.
- **Exercise interactions:** step through steppers, switch tabs, move sliders, and leave a
  simulation offscreen and come back.
  - For the glossary popup:
    - Hover a term.
    - Move into the popup, onto its link.
    - Drag-select text and then move away; the popup should stay pinned.
    - Press Esc after the selection.
    - Use the keyboard: Tab to a term, then Enter, Tab and Esc.
    - Hover a term near the bottom-right corner; the popup should flip above it and stay
      inside the window.
- **A checker rule gets a fixture.** `tests/checker-rules.test.mts` runs the real `check` on a
  throwaway copy of the site. Each fragment in `tests/fixtures/checker-rules/` is injected at the end
  of a public page, and the leading `<!-- expect error|warn: … -->` comments (or `expect clean`) must
  equal the messages `check` prints for that page. When you add or change a diagram, link-target or
  theme rule, add the bad case and a clean control beside it (a rule that flags everything also
  passes a bad case). Theme rules (`THEME_CASES` in the test) edit one theme file instead.
- **When testing the checker with injected faults, assert the injection happened.** A
  replacement anchored on stale text matched nothing, and the "test" passed while
  checking nothing.
- **Horizontal overflow zooms a phone page out.** If anything is wider than the screen,
  mobile browsers widen the layout viewport (`innerWidth` grows) and shrink the whole
  page, even though `body { overflow-x: clip }` stops it scrolling. So a `scrollX` that
  stays 0 proves nothing; `npm run visual` fails when a phone render's `innerWidth`
  isn't 390.
- **Absolutely positioned elements escape scroll containers** unless the container is
  positioned. `.visually-hidden` labels in a wide table once widened every page with a
  decision matrix. Scroll containers such as `.table-wrap` get `position: relative`.
- **Check diagrams at phone width for legibility, not just fit.** An SVG that shrinks to
  375px makes its labels about 5px tall. Below 640px, diagrams keep a 520px minimum and
  scroll inside their figure.
- **Screenshots can re-lay out the page.** The screenshot tool may capture at a different
  viewport width than the page sees, which reflows text above the target and moves it.
  Verify scroll positions by sampling `getBoundingClientRect()` inside the page, not from a
  screenshot.
- **Browser automation can mislead.** `requestAnimationFrame` is throttled while a script
  awaits in a background or automated tab, so live readouts can show stale zeros. Smooth
  scrolling may not advance at all, and scroll-reveal fades may never finish. To check
  logic, use `behavior: "instant"` and clear `.reveal-pending`. Confirm the real motion
  by eye in a foreground tab.
- **Look at the social cards** (`docs/assets/og/*.png`) after `npm run cards`: the title is
  not clipped, the visual is the one you expect and is legible at about 500px wide (how a
  chat app shows it). When testing `check` with injected faults, restore the file and assert
  the injection changed it, as above.
- Leave no test state behind: clear a forced theme (`localStorage` key `bh-theme`), close
  test tabs, stop `serve`, and delete throwaway pages, then run `npm run index` and
  `npm run cards` again (the second removes their cards).
