# Vendored: Anatomy

| | |
|---|---|
| Upstream | https://github.com/wheresryan22/anatomy |
| Commit | `1482e8469b0a9e0d8cc18ea2740a01423d29ae80` ("Printable sheets: A4 and Letter PDFs from any figure (#126)", 2026-10-18) |
| Licence | MIT, Copyright (c) 2026 Ryan: see `LICENSE`, which must stay with the code |
| Vendored | 2026-10-22 |

## What is here

Upstream's `SKILL.md`, `LICENSE`, `references/`, `kit/`, `scripts/` and the **source** of every
example. The skill is self-contained: it uses relative imports and Node's built-in modules only,
and needs Node 20.10+ and a local Chrome or Chromium for `capture.mjs`, `drive.mjs` and the line check.

## What was left out

- Built example pages and PDFs (`examples/*/*.html`, `*.pdf`, about 24 MB). Rebuild one with
  `node examples/<name>/build.mjs`; the output is git-ignored here.
- Upstream's tests (`scripts/*.test.mjs`, `tests/`), CI, community files, README and images,
  `agents/openai.yaml` and the `evals/` set.
- The community-gallery publisher: `scripts/publish.mjs`, `fingerprint.mjs`, `session.mjs` and
  `references/publish.md`. They push to a third party's repository, which this repo has no use for.

## Local changes

1. `SKILL.md`: removed the gallery-publishing text; added the blog pointers (description, the
   path list, the `embed.mjs` row of the scripts table, the `references/bitwise-blog.md` entry).
   The description also has a "Not for" clause naming `pedagogical-writing` (teaching prose, page
   structure, what a page should show) and `dataviz` (charts of data), added for #92 because
   `anatomy` had no clause and its claim on "an explanatory diagram or figure for docs" overlapped
   `pedagogical-writing`. To stay under 1,024 characters it drops "highly detailed", the "cabinet of
   drawers" example, "title, hint and" from the card, "realistic" before WebGL, the "(TypeScript/JS
   that writes SVG and HTML)" gloss, "(poster, drawing or handout)", and says "Use when" for
   "Use this whenever". Re-apply all of this when updating.
2. Added `references/bitwise-blog.md` and `scripts/embed.mjs`.
3. Added `evals/trigger-evals.json`: trigger queries for this repo's measurements (#92). Upstream's
   `evals/evals.json` is still left out: its five cases are build prompts, not trigger queries.
4. Added this file.

Everything else is byte-identical to the upstream commit above.

## Updating

```sh
git clone --depth 1 https://github.com/wheresryan22/anatomy /tmp/anatomy-upstream
cd /tmp/anatomy-upstream
D=<repo>/.claude/skills/anatomy
# copy SKILL.md, LICENSE, references/ (minus publish.md), kit/, scripts/*.mjs (minus *.test.mjs,
# publish, fingerprint, session) and the non-.html, non-.pdf files under examples/, then diff
# SKILL.md against the version here and re-apply local change 1.
```

Update the commit and date above, and check that `embed.mjs` still works on a built example: it
depends on the markup `pageHtml` writes (`<main class="iso-page">`, the module script after it).
