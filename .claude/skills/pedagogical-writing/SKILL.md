---
name: pedagogical-writing
description: Guidelines for writing and revising explanations whose purpose is teaching, distilled from 3Blue1Brown's scripts. Covers ordering ideas, pacing, example choice, vocabulary, voice, and scoping a page, a series, or a video. Use when drafting, outlining, restructuring or reviewing an explainer, tutorial, lesson, or technical blog page, or when asked why a page is hard to follow, even if the request doesn't say "pedagogy". Triggers on requests like "write an explainer", "teach", "tutorial", "make this easier to understand", "the reader gets lost here", "3blue1brown style", "review this page for clarity". Not for explaining code, errors or command output in conversation.
---

# Pedagogical writing

The aim is a reader who could have **invented the idea themselves** by the end,
not one who has been told it. Everything below serves that aim.

The rules come from 245 3Blue1Brown videos (118 long-form explainers, ~420k
words), including Grant Sanderson's own talks and postmortems on what makes an
explanation work. They are teaching moves, not prose style, so they apply to
written and interactive pages as much as to video.

Read the reference file the task needs:

- [references/moves.md](references/moves.md): every move below, with how it
  looks on a page and a verbatim example. Read it when drafting or restructuring.
- [references/long-pages-and-series.md](references/long-pages-and-series.md):
  keeping the reader oriented past ~3,000 words, and multi-page series.
- [references/review.md](references/review.md): the review procedure, its audits
  and calibration numbers. Read it before reviewing a page.

## The core loop

Every idea goes through four beats. Where a section skips one, readers get lost.

1. **Need.** Make the reader want the idea: a puzzle, a goal, a failure.
2. **Naive attempt.** Try the obvious approach, concretely. It can be the
   reader's first guess, the textbook or popular explanation, a rule of thumb
   that works in one regime, a quick estimate, or your own deliberately
   simplified model.
3. **Crack.** Show where it breaks, and *where*: which cases, which term. The
   location of the failure should point at the fix, so name the property the
   fix must have, and reuse that phrase when the fix arrives.
4. **Fix, then name.** Give the fix, and only now its technical name, with the
   plain meaning attached.

A formula, definition or name should put into words what several examples have
already planted. First drafts put the abstraction first; reorder them.

Run the loop hardest where a design looks arbitrary (format fields, magic
constants, an odd encoding): rebuild it as successive attempts, each fixing the
last one's flaw, and say the story is a reconstruction, not history.

## Promises

A simplification, a step you cannot make guessable yet, a deferred "why", a fact
that matters later: each is a promise. Promises are fine; unflagged or unpaid
ones are defects.

- **Flag it where you make it**: "for now", "this is 90% right", "this will
  look arbitrary until we reach …". Say roughly how wrong a simplification is.
- **Pay it off by name**: return, quote the earlier claim, correct it, and say
  what the simple version would have wrongly predicted.
- **Plant what the payoff needs**: say "remember this" once, then restate the
  fact in a clause when it fires.
- **Defer out loud**: name the tempting question, say where (or whether) it is
  answered, and give the one takeaway needed to carry on.
- **Black-box by contract**: when the internals would not help, state the
  inputs, outputs and guarantees the argument needs; keep the conclusion in the
  main line and put the proof in a fold.

## Opening

- **Open on something concrete**: a puzzle, a surprising number, a failure, a
  preview of the finished result, or the popular wrong answer. Keep it short;
  save "why this matters" for the end.
- **Spoil the what, protect the why.** Stating the result, or naming a strange
  destination ("this ends with a Klein bottle"), creates the need. The
  mechanism is what the page earns, so keep it out of the opening.
- **Make the promise a specific question**, with numbers where possible, and
  answer exactly that question at the end.
- **Gloss the title's term at once** in plain words. Delay only the terms the
  reader will have to reason with.
- **Decide who the page is for** and what it assumes. Leaving out fundamentals
  that reader already has is correct, not careless.
- In a series, open by restating the one earlier idea this page needs.

## Ordering and pacing

- **One new idea per step**, reachable from the previous one by something the
  reader can nearly guess. A section that needs a second mechanism is two
  sections.
- **Build a ladder, not a list.** State in one phrase how each rung follows
  from the last.
- **Raise the problem, then the fix.** After a scheme seems complete, name its
  remaining flaw before the reader does. Dead ends get a sentence each; show in
  full only the attempt whose crack teaches.
- **Reformulations need defending.** When the key move restates the problem (a
  code as a tree, rank as counting), voice "haven't we just moved the
  problem?", answer with what the new form makes possible, then restate the new
  problem on its own.
- **Mark the key step** as the key step, once per page, and say how much remains.
- **Name the one thing to hold** at each dense point, and say which details do
  not matter and why ("it's just some constant").
- **Recap in words, not links.** Restate an earlier idea in one clause, in the
  facet this step uses.
- **Stage conventions at first use** with a tiny example, and justify each one
  by the failure it prevents.
- **Reference material is not narrative.** Full tables, edge cases and format
  specs go after the story, or on a separate reference page.

## Examples and numbers

- **Concrete before abstract, finite before the limit.** Give each parameter a
  value and compute with it before generalising.
- **Counts beat rates.** "40 out of 100" lands; "40%" less so; "0.4" least.
- **Simple, but not too simple, and not falsely simple.** The toy must keep the
  essential difficulty. A toy that makes the hard part look already solved
  teaches a wrong model that no later disclaimer fixes.
- **Representative before flashy.** Open with the example whose quirks do not
  hide the idea; bring in the striking one later and name its quirks.
- **One running example per concept.** On a web page, the reader's own input
  (their text, their bit string) is the best running example there is.
- **Climb a size ladder.** Start at the smallest case that means anything, grow
  one step at a time, show one more iteration than needed before "and so on",
  and when scaling back up, name exactly what changes.
- **Make big numbers felt**: as 2^b equal choices or b yes/no questions, split
  into factors that have names (2^32 ≈ 4 billion), then compared with something
  real.
- **Measure every version on one benchmark**: naive, each improvement, then the
  bound. The gap that remains is the need for the next step.
- **Keep arithmetic unsimplified** until the pattern shows (8 + 3, not 11).
- **Numbers are expensive in prose.** Keep the ones the reader computes with;
  move the rest into a figure or table.
- **Say when an example is invented**, and keep it apart from measured facts.

## Formulas, notation and names

- **Name sparingly**: about one new term per 1,000 words is the 3Blue1Brown
  rate. Acronyms and field names (`HLIT`, `BTYPE`) wait for the reference section.
- **Labels carry meaning**: "copy 4", "back 7–8", not `258`, `d5`.
- **Notation is shorthand for something already computed.** Introduce the symbol
  after the long form, and say what it hides or gets wrong.
- **Read each formula aloud, triaged**: which factors are bookkeeping, which
  one carries the idea. Point each term at its part of the figure.
- **A formula is a design.** If the textbook form hides the structure, use one
  that separates what varies independently, and say which form the page uses.
- **Clearest names first, then a bridge.** Teach with the names that make the
  mechanism clear, then map them explicitly to the conventional notation.
  Never switch notation silently.
- **When to open with the formula**: when the formula *is* the mystery (read
  it in words and ask why), when a series already uses the notation, or when a
  familiar law is the naive attempt that will crack.

## Misconceptions and surprise

- **Diagnose the misconception**: state it in the reader's words, say where it
  comes from, re-express the fact in units where it feels true, and give the
  wording to use from now on.
- **Write down the expected outcome before a surprise**, and rule out the dull
  explanation (a bug, rounding) before giving the real one.
- **When a pattern breaks**, explain both why it held and why it breaks exactly
  there.
- **Expose a load-bearing assumption** with the nearest case where it fails
  ("this works because the bit vector never changes; insert one bit and every
  rank shifts").
- **Set a wrong argument beside its valid twin** and ask the reader to find
  the difference.

## Visuals

- **Show the mechanism.** The caption says what to notice, and also what not to
  read into the figure: a view that shows what the algorithm cannot know, an
  exaggerated scale, slowed time, a one-dimensional slice.
- **Make the encoding unmistakable** before a figure carries an argument. When
  labels and data are both bits, style them differently and say which is which.
- **Let the figure hold a concrete instance** while the prose speaks generally.
- **Choose the picture from the operation.** When two pictures of one
  operation reveal different properties, show both and say what each makes
  obvious.
- **An analogy earns its place** if it leads towards the quantitative step or
  defuses a named misconception. An analogy that only makes sense once you know
  the answer goes after it.
- **Drive interactive figures from the real algorithm.** Where the code and the
  prose disagree (infinity, boundaries), the gap is content.
- **Put the best intuition in the main line**, not in a fold. Keep colours and
  shapes consistent so the reader never re-learns the legend; stay in 2D unless
  the idea is 3D.

## Checks for the reader

- **Predict before the reveal**, at real decision points. Ask for magnitude, not
  direction ("faster, of course, but how much?"), or a gut guess revisited at
  the end.
- **After a mechanism, check transfer**: ask the reader to deduce something new
  with it.
- **Gut-check results in the open**: on a case the reader already knows, a
  limiting case, a bound, or a simulation whose number the formula then hits.
- **Mark optional exercises as optional**; the main line never depends on them.

## Endings

- **Pay off the opening**: answer its question by name, return to its demo.
- **Generalise**: look back for the arbitrary choice in the argument (½ → p),
  or ask where the argument breaks under a changed premise.
- **Teach the trigger**: the situation that should make the reader reach for
  this idea next time.
- **Calibrate honestly** how much the result matters.
- **The headline is the takeaway.** Readers keep what the title, TL;DR and card
  state, so put the transferable idea there, not an incidental result.

## Voice

- **Write to one person, as a companion**: "you and I", "let's". Be present.
- **Voice the reader's objection** before they raise it.
- **Admit difficulty and uncertainty**; hedges and honesty about limits build
  trust.
- **Let care show at the real payoffs.** Motivation, not clarity, is what
  limits learning, and readers catch interest from an author who visibly has it.
- **Sentence length is not the lever.** 3Blue1Brown averages ~25 words a
  sentence. Clarity comes from one idea per sentence and a clear referent.

## Scoping

- **One concept per page.** The median long-form script is ~3,100 words (about
  18 minutes spoken). At three times that, or with more than one "and then
  there's also…", split it into a series.
- **Pick the genre** (overview, discovery story, worked example) and take
  pacing cues only from pieces of the same genre.
- **Teach recognition, not only mechanism**: what in a problem should make the
  reader reach for this.

## In this repo

CLAUDE.md and the templates are the house rules; where this skill differs, they
win. Apply the moves through the theme's components:

- **TL;DR.** Keep the `.tldr` straight after the hero: it is required, and it is
  slide 1 in Present mode. Its first bullet is the transferable takeaway. It may
  state the result (spoil the what) but not the mechanism. The "common mistake"
  bullet is the misconception the page corrects. The first `h2` then opens with
  the need.
- **Order.** The template's orientation → mental model → mechanism → hands-on →
  details → edge cases is the outer shape; the core loop runs inside it. The
  mental model is the toy example taken through need, naive attempt, crack and
  fix; the mechanism steps up to the realistic case.
- **One idea per `h2`.** Each `h2` is a slide, so the one-idea rule also keeps
  slides presentable.
- **Predictions** use `details.predict`, once or twice per page, at real
  decision points. Transfer checks and optional exercises are plain prose or a
  `details.disclosure` titled as optional.
- **Promises.** Flag a simplification in the prose or a `.sidenote`, and link it
  forward to the section `id` that pays it off.
- **Depth** goes in `details.disclosure`, with the one-line upshot in the main
  text *before* the fold. Asides go in `.sidenote`.
- **Formulas and figures.** Point from formula terms and prose to diagram parts
  with `data-ref`; walk a mechanism with `<bh-stepper>`; build an implementation
  a clause at a time with `<bh-codewalk>`; make the centrepiece a
  `<bh-playground>` on the reader's own input where you can.
- **Terms.** `docs/glossary.html` underlines the first use of every defined
  term automatically. That is a reminder, not an introduction: still delay the
  term until after the need, and reuse the glossary's name for it.

## Drafting workflow

Copy this checklist and work through it:

```
Draft progress:
- [ ] 1. Reader, assumptions, and the one question the page answers
- [ ] 2. Running example: clean, representative, keeps the hard part hard
- [ ] 3. Ladder of steps, each with need → naive → crack → fix
- [ ] 4. Promise list: every simplification, deferral and plant, with its payoff
- [ ] 5. Draft the page; opening and TL;DR last
- [ ] 6. Review it with references/review.md and fix what it finds
```

## Reviewing

Read [references/review.md](references/review.md) first; it has the audits.
For a page past ~3,000 words or part of a series, also read
[references/long-pages-and-series.md](references/long-pages-and-series.md).
Run `node .claude/skills/pedagogical-writing/scripts/page-stats.mjs <page>` for
words per section, voice rates against the 3Blue1Brown medians, and every
promise phrase to match against its payoff. In short, check:

1. Does the opening create a need before it names anything?
2. For each section: what is the one new idea, and what makes it guessable?
3. Is every term, formula and fix preceded by the need and the crack?
4. Is every promise flagged where made and paid off by name?
5. Do examples come before abstractions, clean numbers first, one running example?
6. Do labels and captions carry meaning, including what not to read into a figure?
7. Is the voice a companion's, and is reference material out of the narrative?
8. Is the scope one concept, and does the headline state the takeaway?

Lead with the biggest leap: the earliest point where the target reader most
likely gives up (a reader who stops there never sees the later problems). Then
the rest, ranked by impact. For each: where it is, what the reader needs that is missing,
and a concrete fix. Say what already works, so it is preserved.

## Caveats

- These are one author's tendencies, measured with simple text proxies. Treat
  the numbers as direction, not law.
- Do not imitate the voice mechanically. A reference page may legitimately be
  terser; apply the ordering, promise and example rules even there.
