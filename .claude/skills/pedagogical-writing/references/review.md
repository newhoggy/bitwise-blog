# Reviewing a teaching page

Use this when asked to review a page for clarity, to say why a page is hard to
follow, or as the last step of drafting.

## Contents

- Procedure
- The audits
- Calibration numbers
- Output format
- A good finding and a weak one

## Procedure

Copy this checklist and work through it:

```
Review progress:
- [ ] 0. Fix the target reader: the one the user names, else the one the page assumes
- [ ] 1. Run scripts/page-stats.mjs on the page
- [ ] 2. Read the whole page once as the target reader, noting where you would stop
- [ ] 3. Section map: one new idea per section, and what makes it guessable
- [ ] 4. Promise audit
- [ ] 5. Term and formula audit
- [ ] 6. Example and figure audit
- [ ] 7. Opening and ending audit
- [ ] 8. Rank the findings and write the review
```

Step 1:

```bash
node .claude/skills/pedagogical-writing/scripts/page-stats.mjs docs/<slug>.html
```

It prints words per section, voice rates against the 3Blue1Brown medians, the
number of `details.predict` folds, and every promise phrase with its section.
Tables, term lists (`dl`), code and SVG are left out of the counts. The numbers
point at where to look; they are not findings on their own, and the promise
list is a starting point, not the whole ledger.

If the user's reader (say, "new to compression") differs from the reader the
page assumes, review for the user's reader and say so in one line.

For a page past ~3,000 words or part of a series, also read
long-pages-and-series.md: missing routes, checkpoints and skip labels are
common findings there.

For a page shown as a reviewer saw it, use `git show <commit>:docs/<slug>.html`.

## The audits

### Section map
For each `h2`, write one line: *new idea*, *what in the previous section makes
it guessable*, and which of need / naive attempt / crack / fix are present. A
section with two new ideas, or with no predecessor, is a leap. A leap that is
flagged and paid back later (see promises) is not a defect.

Also flag a section over ~800 words: it usually holds two ideas or reference
material.

### Promise audit
Start from the script's promise list and add silent promises you noticed while
reading: a simplification never flagged, a step that looks arbitrary with no
comment, a fact used at a payoff that was never planted.

Make a ledger:

| Promise | Where made | Where paid | Status |
|---|---|---|---|
| "for now, read codes MSB-first" | `#first-code` | `#bit-order`, quotes the claim | paid |
| tree drawn with the answer path lit | `#decode` | — | silent |

Status is *paid*, *paid silently* (corrected without pointing back to the claim),
*unpaid*, or *silent* (never flagged). The last three are findings.

### Term and formula audit
- Count new technical terms and identifiers in the first 500 words, and per
  1,000 words overall. The 3Blue1Brown rate is about one explicit naming per
  1,000 words (`called / known as` measures 0.6). Several times that is a finding.
- For each term: is the problem it solves shown first? Is the plain meaning
  attached? Does it match the glossary's name?
- For each formula: which examples above it show the same pattern? Is it read
  aloud, with bookkeeping separated from the factor that matters? Do its terms
  point at the figure?
- Does the notation change silently anywhere, or differ from the literature
  without a bridge?

### Example and figure audit
- Is there one running example per concept, with clean numbers first?
- **The false-model test**: what would a literal reader infer from the toy? If
  it makes the hard part look already solved, that is the finding, ahead of any
  missing detail.
- Are the big numbers made felt, and is each improvement measured on the same
  benchmark?
- For each figure: does the caption say what to notice? Does the page say what
  the figure does not show (a privileged view, exaggerated scale, slowed time)?
  Are labels told apart from data?
- Do analogies lead towards the quantitative step, or only decorate it?

### Opening and ending audit
- Does the opening create a need before naming anything? Is the hook concrete
  and short?
- Does the TL;DR spoil only the *what*, and is its first bullet the takeaway?
- Does the page promise a specific question, and answer that question at the end?
- Does the ending pay off, generalise, and say when to reach for the idea?

## Calibration numbers

Medians over 118 long-form 3Blue1Brown explainers (5+ minutes; live lectures,
Q&As, guest videos and announcements excluded), with the interquartile range:

| Measure | Median | IQR |
|---|---|---|
| Words per video | 3,143 | 2,145–4,426 |
| Minutes | 18 | 13–25 |
| Words per sentence | 24.7 | 23.0–26.9 |
| "you" per 1,000 words | 21.8 | 17.9–25.6 |
| "we / let's / us" per 1,000 | 11.5 | 8.4–16.2 |
| "I / me / my" per 1,000 | 8.5 | 6.2–10.6 |
| Questions per 1,000 | 2.2 | 1.3–3.0 |
| "called / known as" per 1,000 | 0.6 | 0.1–0.9 |
| Explicit pause or predict prompts per video | 2 | 1–4 |

91 of the 118 ask the viewer to pause or predict at least once. New notation
rarely lands in the first 10% of a video unless it is a recap, or the formula
itself is the mystery. In the paradox and probability videos it waits until a
worked count or simulation is done, 36–57% of the way through.

Read the numbers as direction. A page with almost no "you" or "we" and no
questions is written as a specification, not a lesson. That is a finding when
the page means to teach. Short sentences are not a goal.

## Output format

1. **The biggest leap**: the earliest section where the target reader is most
   likely to give up. Prefer the earliest severe leap over a worse later one: a
   reader who stops there never reaches the later problems.
   Its location (heading and `#id`), what the reader needs there that is
   missing, and a concrete fix, ideally with the new wording or the order of
   the new steps.
2. **The other findings, ranked by impact**, in the same form.
3. **The promise ledger**: only the rows that are not *paid*.
4. **What works**, so revisions keep it: name the sections, figures and moves.
5. **Scope**: if the page is more than one concept, where the series
   boundaries would go.

Keep the house rules (CLAUDE.md) in every suggested fix. Under a length limit,
shorten parts 4 and 3 first, then 5; never drop the biggest leap or its fix.

## A good finding and a weak one

Weak: "The section on code lengths is confusing. Consider adding more explanation."

Good (for an illustrative Huffman page): "`#canonical-codes` is the biggest
leap. It opens with 'send only the code lengths', but nothing above shows that
sending the tree is expensive, so the reader has no need for the fix. The
material for the need is already in `#build-tree`, where the tree is drawn.
Count its cost there in bits, open `#canonical-codes` with that number ('that
tree just cost us N bits; can the receiver rebuild it from less?'), add a
`details.predict` asking what the minimum is, then give lengths as the answer."

The good one names the location, the missing beat (need), where the material
for it already is, and the fix in the page's own terms.
