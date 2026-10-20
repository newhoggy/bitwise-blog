---
name: pedagogical-writing
description: Guidelines for writing and revising explanations whose purpose is teaching, distilled from 3Blue1Brown's scripts. Covers ordering ideas, pacing, example choice, vocabulary, voice, and scoping a page or video. Use when drafting, outlining, restructuring or reviewing an explainer, tutorial, lesson, or technical blog page, or when asked why a page is hard to follow. Triggers on terms like "explain", "explainer", "teach", "tutorial", "make this easier to understand", "pedagogy", "3blue1brown style", "review this page for clarity".
---

# Pedagogical writing

The aim is a reader who could have **invented the idea themselves** by the end,
not one who has been told it. Everything below serves that aim.

The guidelines come from analysing 111 scripted 3Blue1Brown explainers
(~388k words) and comparing them with a dense technical page. They describe
teaching moves, not prose style: they apply to written and interactive pages as
much as to video.

## The core loop

Every idea in a lesson goes through the same four beats. If a section skips one,
that is where readers get lost.

1. **Need.** Make the reader want the idea: a puzzle, a goal, a failure.
2. **Naive attempt.** Let the obvious approach be tried, concretely.
3. **Crack.** Show where the naive attempt breaks ("well, almost…"). Raise the
   problem *before* the fix.
4. **Fix, then name.** Give the fix, and only now give it its technical name,
   with the plain meaning attached ("known in the business as a prefix code").

A definition given before the need is felt reads as arbitrary. Delay formulas
and names until the reader would have asked for them: "doing so too early would
spoil a good story."

## Ordering and pacing

- **One new idea per step.** Each step must be reachable from the previous one by
  something the reader can nearly guess. Never introduce two mechanisms in the
  same section; if a section needs a second, it is two sections.
- **Build a ladder, not a list.** Parity bit → parity of a subset → two checks pin
  the column → two more pin the row → binary counting. State in one phrase how
  each rung follows from the last.
- **Raise the problem, then the fix.** After a scheme seems complete, name its
  remaining flaw before the reader does.
- **Pause for the reader.** Before a reveal, ask them to predict or work it out
  ("pause and try before I tell you"). Then reveal. Use sparingly and at real
  decision points.
- **Recap in words, not links.** When an earlier idea is needed, restate it in
  one clause ("remember, positions that are powers of 2 are reserved for
  checks"). Do not make the reader jump back to a section.
- **Stage the conventions.** A convention the reader must apply (bit order, sign
  rules, indexing from zero) is introduced with a tiny example *at the point of
  first use*, not stated once up front and relied on later.
- **Reference material is not narrative.** Full tables, edge cases, glossaries
  and format specs go after the story, or in a separate reference page, never in
  the middle of it.

## Scoping

- **Teach one concept per page or video.** 3Blue1Brown's median script is ~3.2k
  words (about 18 minutes spoken); big topics are split into a series (Hamming
  codes: 2 parts; compression: 3; neural nets: 4+). If a draft is about three
  times that, or has more than one "and then there's also…", split it.
- **Open with the need, not the summary.** Start from a concrete situation, a
  puzzle, or a stated goal ("The goal here is simple…"), plus a promise of what
  the reader will be able to do. If the document template wants a TL;DR, put it
  after the hook or make it collapsible.
- **Open by recalling the last chapter** in a series, then say what this one adds.
- **End on the payoff and the next question**, not on reference tables.

## Choosing examples

- **Start with a toy whose numbers come out clean.** Probabilities 1/2, 1/4, 1/8,
  1/8, so bits-per-symbol is exactly 1.75. Say it is contrived: "it's meant to
  be a simple example."
- **"Simple, but not too simple."** The toy must still contain the essential
  difficulty (a block of 16 bits, not 4).
- **One running example per concept.** Do not alternate between two or three
  datasets whose numbers the reader has to keep apart.
- **Then step up on purpose.** Introduce the realistic case explicitly as the
  next level ("the probabilities were overly clean; real language isn't"), after
  the idea is secure.
- **A real example that defeats the lesson is a bad first example.** Realism
  earns its place only once the reader has the idea.

## Vocabulary and labels

- **Prefer everyday words and images** ("bump on the rug", "20 questions",
  "chop in half") to carry the idea; the technical term comes after.
- **Labels must carry their meaning.** Use up / down / left / right, not 00 / 01.
  If a diagram labels things `258`, `270`, `d5`, the reader must keep a lookup in
  their head. Label with the meaning ("copy 4", "back 7–8") and put the
  identifier in small print.
- **Name sparingly.** About one new technical term per 1,000 words is the
  3Blue1Brown rate. Count the terms in a draft; if it is several times that,
  defer, merge, or drop some.
- **Avoid identifier clutter.** Acronyms and symbols (`HLIT`, `BTYPE`) belong in a
  reference section unless the reader must use them right now.
- **Numbers are expensive.** Prose with many numerals per sentence is hard to
  follow. Keep the numbers the reader must compute with; push the rest into a
  figure or table.

## Voice

- **Write to one person, as a companion.** "You and I", "let's", "I'd guess you
  are wondering". Be present in the text; do not issue impersonal instructions.
- **Voice the reader's objection** before they raise it: "But how does the
  receiver know where one code ends?", "You might complain that… and you would
  be right."
- **Admit difficulty and uncertainty.** Hedges ("roughly", "kind of", "a bit
  contrived") and honesty about limits build trust; flat authority does not.
- **Show some delight.** "Neat", "elegant", "isn't that clever" mark where the
  payoff is. Use them where the payoff is real.
- **Sentence length is not the lever.** Spoken 3Blue1Brown sentences average ~26
  words, longer than many dense technical pages. Clarity comes from one idea
  per sentence and a clear referent, not from chopping.

## Visuals

- A figure should show the **mechanism**, and its caption should say what to
  notice ("Notice that the middle row is all the coder ever sees").
- Put the best intuition in the main line, not in a fold or "go deeper" box.
  If one picture explains several later facts (for example, "each code uses up
  a share of a fixed space"), introduce it early and reuse it.
- Keep colours and shapes consistent so a reader never re-learns the legend.

## Review checklist

Run this on a draft, and report each failure with its location:

1. Does the opening create a need before it names anything?
2. In the first 500 words, how many new terms? (aim: very few)
3. For each section: what is the single new idea, and what in the previous
   section makes it guessable? Any section with two ideas or no predecessor is a
   leap.
4. Is every technical term preceded by the problem it solves?
5. Is each "fix" preceded by the visible crack in the naive attempt?
6. Do the examples use clean numbers first, one running example per concept?
7. Do labels carry meaning, or does the reader need a lookup table?
8. Are conventions introduced where first used, with a mini example?
9. Is the voice a companion (you / we / I, objections, hedges), or only
   commands?
10. Are earlier ideas restated in words where needed?
11. Is reference material kept out of the narrative?
12. Is the scope one concept? If not, where would the series boundaries be?

## Output when asked to review

Lead with the biggest leap (the section where a reader is most likely to give
up), then the rest ranked by impact. For each: where it is, what the reader
needs that is missing, a concrete fix. Say what already works, so it is
preserved.

## Caveats

- These are tendencies of one author's teaching style, measured with simple text
  proxies. Treat the numbers as direction, not law.
- Do not imitate the voice mechanically; a technical reference page may
  legitimately be terser. Apply the ordering, pacing and example rules even
  there.
