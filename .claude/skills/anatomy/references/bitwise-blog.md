# Using Anatomy in the Bitwise Engineering blog

This file is a local addition (not upstream; see `VENDORED.md`). The skill builds a figure as a
standalone page. A blog page is not that: it has its own theme, its own checks and one `<style>`
and one `<script>`. `scripts/embed.mjs` does the fitting, so a figure goes into a page the same
way each time. Read the repo's `CLAUDE.md` for the page rules; this file only covers the figure.

## 1. Build the figure outside the skill

Never build inside `.claude/skills/anatomy/`: the examples write their pages next to their
`build.mjs`, and the skill directory is vendored code, not a workspace.

- Make `figures/<slug>/` at the repo root. Copy the closest example's `build.mjs` (and its
  `live.js`, `model.mjs`, `*.css`, if it has them) into it.
- Point its imports at the vendored kit. In the example they read `../../kit/iso-kit.mjs` and
  `../../scripts/inline-kit.mjs`; from `figures/<slug>/` they become
  `../../.claude/skills/anatomy/kit/iso-kit.mjs` and `../../.claude/skills/anatomy/scripts/inline-kit.mjs`
  (the same for `lathe`, `tube`, `audit`, `gl` and the rest).
- `node figures/<slug>/build.mjs` writes `figures/<slug>/<name>.html`. These pages are git-ignored:
  they are an intermediate, and the page in `docs/` is the published copy.
- Do all the skill's own checks on that standalone page (`capture.mjs`, `lines.mjs`, `--audit`):
  they are written for it. A figure that is embedded is not checked by them again.

## 2. Embed it

```sh
node .claude/skills/anatomy/scripts/embed.mjs figures/<slug>/<name>.html docs/<page>.html \
  --id <figure-id> --before <element-id>
```

- `--id` is the figure's permanent id (kebab-case; it is a section-like anchor readers can link).
- `--before` names an element already in the page (a heading's id): the figure goes in front of it,
  as a direct child of the article. It is needed the first time only. Re-run without it after a
  rebuild and the figure, its CSS and its script are replaced where they are. Do not edit the
  parts between the `anatomy:` markers by hand.
- One figure per built page. For several figures on one page, build each and embed each with its own id.

What it does, and why:

| It does | Because |
|---|---|
| Drops the kit's page CSS (`html`, `body`, `*`, `.iso-page`) and keeps the rest | That CSS sets `html{color-scheme:dark}` and repaints the body, which would break every other part of the page. |
| Puts `iso wide no-glossary` and the id on the figure (or on its wrapper, with the inner `<figure>` getting `<id>-figure`) | The kit styles everything under `.iso`; the house rules want an id on every figure and `wide` for figures. `no-glossary` keeps the glossary from underlining words in the card's title and legend; `data-vr-mask` keeps the always-moving figure out of the `npm run visual` diffs. |
| Starts the script with a theme bridge | The kit themes from `data-theme` on its own wrapper and ignores `prefers-color-scheme`. Without the bridge the figure stays dark in a light page. The bridge copies the blog's choice (the toggle on `<html>`, else the system setting) onto the wrapper and follows changes. |
| Sets the muted text to `#8e8e8e` (dark) and `#6b6b70` (light) | The kit's own values are about 3.6:1 and 3.3:1; the house bar is 4.5:1. |
| Moves the plate's title 36px in from the right | The blog's copy-link button sits in the figure's top-right corner and would cover it. |
| Removes the `Figure N —` prefix on the kit's legend | The blog's `figcaption` counter would put it in front of the legend; the plate already carries `Fig N`. |

## 3. Then, as for any page

1. `npm run index`, `npm run check` (0 errors), `npm run cards`. Look at the card PNG: the first
   `<figure>` with an `<svg>` is the picture, so a figure placed first is the card. Set
   `bh:image` if another visual should be.
2. Open the page in both themes and at 375px. Hover or press the keys the figure's hint names.
3. Set the plate's `Fig N` label in the build script to the figure's position on the page.

## 4. Limits to know

- **Weight.** The markup and script are inlined, so a figure is part of the page's size: about
  90 KB for the dial indicator and 410 KB for the ripple tank. A dense Hero (the Raptor, the
  arcade cabinet) is several MB; do not put one in a page unless the page is about that figure.
- **Palette.** The kit has its own `--anatomy-*` colours, not the blog's tokens, and they stay
  inside the figure. Do not mix them with `var(--text)` and the like in the figure's markup.
- **Shaders.** A WebGL figure pauses while it is offscreen (by design), so to capture one lower
  on a page, give the capture a tall viewport: `capture.mjs … --height 4500`. The shipped shader
  figures read the theme once at load, so after the theme toggle changes while the page is open,
  the shader may need a reload to repaint; the SVG follows at once.
- **Not wired to the blog's interactions.** `data-ref` text links, `bh-stepper` and the
  present-mode slides know nothing about the kit's parts. If a page needs those, use a
  blog diagram for that part and keep the Anatomy figure as the one centrepiece.
- **Not run.** The 3D mode (`references/3d.md`) has not been tried inside a blog page.
- **One centrepiece.** The house rule is one interactive per page; Anatomy figures are heavy and
  loud, so one per page is the norm.
