---
name: pedagogical-writing
description: Guidelines for writing and revising explanations whose purpose is teaching, distilled from 3Blue1Brown's scripts and from other explainers, writing guides and learning research. Covers ordering ideas, pacing, example choice, vocabulary, sentence and paragraph flow, figures and interactives, checks for the reader, voice, and scoping a page, a series, or a video. Use when drafting, outlining, restructuring, rewriting or reviewing an explainer, tutorial, lesson, or technical blog page, or a passage of one, or when asked why a page is hard to follow, even if the request doesn't say "pedagogy". Triggers on requests like "write an explainer", "teach", "tutorial", "make this easier to understand", "the reader gets lost here", "3blue1brown style", "review this page for clarity". Not for explaining code, errors or command output in conversation, ADR or design-doc review (review-adr), charts (dataviz), isometric figures (anatomy), or editing skills, CLAUDE.md or settings (skill-authoring, update-config).
---

# Pedagogical writing

The aim is a reader who could have **invented the idea themselves** by the end,
not one who has been told it. The reinvention is guided: unassisted discovery
teaches less than explicit instruction, while discovery with a scaffold and
feedback teaches more. Everything below serves that aim.

The core comes from 245 3Blue1Brown videos (118 long-form explainers, ~420k
words), including Grant Sanderson's own talks and postmortems on what makes an
explanation work. Other explainers, writing guides and learning research fill in
what video does not teach: sentence-level flow, interactive design, and checks
that show whether the reader learned. These are teaching moves, not prose style,
so they apply to written and interactive pages as much as to video.

Read the reference file the task needs:

- [references/moves.md](references/moves.md): every move below, with how it
  looks on a page and a verbatim example. Read it when drafting or restructuring.
- [references/sentences.md](references/sentences.md): how sentences and
  paragraphs carry the reader, with diagnostics. Read it when revising prose.
- [references/figures-and-interactives.md](references/figures-and-interactives.md):
  designing figures, steppers, codewalks and playgrounds. Read it before
  building or reviewing one.
- [references/long-pages-and-series.md](references/long-pages-and-series.md):
  keeping the reader oriented past ~3,000 words, and multi-page series.
- [references/review.md](references/review.md): the review procedure, its audits
  and calibration numbers. Read it before reviewing a page.
- [references/sources.md](references/sources.md): where each rule comes from, how
  strong the evidence is, and how conflicts between sources are resolved.

## The core loop

Every idea goes through four beats. Where a section skips one, readers get lost.

1. **Need.** Make the reader want the idea: a puzzle, a goal, a failure.
2. **Naive attempt.** Try the obvious approach, concretely. It can be the
   reader's first guess, the textbook or popular explanation, a rule of thumb
   that works in one regime, a quick estimate, or your own deliberately
   simplified model. Label it as provisional where it appears, in its heading
   or caption: a skimmer who never reaches the crack leaves with the wrong
   model and feels they understood it.
3. **Crack.** Show where it breaks, and *where*: which cases, which term. The
   location of the failure should point at the fix, so name the property the
   fix must have, and reuse that phrase when the fix arrives.
4. **Fix, then name.** Give the fix, and only now its technical name, with the
   plain meaning attached. The exception is a handle: a name the prose will use
   often, such as a part the mechanism keeps referring to ("popcount", "word").
   Introduce that one early, with its plain meaning, ideally on a labelled
   figure, unless it is itself the answer to a pending prediction or crack.
   The idea's own name still waits, so it cannot spoil a prediction.

A formula, definition or name should put into words what several examples have
already planted. First drafts put the abstraction first; reorder them. To
abstract, set two or three near-identical instances side by side, mark what
varies, make each varying part a parameter, then rebuild each original from the
result. After an abstract claim, come back down: "in our example, …".

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
- **A model is a rung**: say what a simplified model is for, that a better one
  follows, and which feature will break it. Retire it by running it on that
  case and showing the wrong answer.
- **Say where each claim stands**: shown here, shown later, referenced,
  asserted, or unknown. Check every "obviously" and "clearly": demonstrate it,
  or say where it stands.

## Opening

- **Open on something concrete**: a puzzle, a surprising number, a failure, a
  preview of the finished result, or the popular wrong answer. Keep it short;
  save "why this matters" for the end.
- **Spoil the what, protect the why.** Stating the result, or naming a strange
  destination ("this ends with a Klein bottle"), creates the need. The
  mechanism is what the page earns, so keep it out of the opening.
- **Make the promise a specific question**, with numbers where possible, and
  answer exactly that question at the end.
- **Gloss the title's term at once** in plain words. Delay the names of the
  ideas the page builds; a handle the prose will use often can come early (see
  the core loop).
- **Decide who the page is for** and what it assumes. Leaving out fundamentals
  that reader already has is correct, not careless.
- In a series, open by restating the one earlier idea this page needs.

## Ordering and pacing

- **One new idea per step**, reachable from the previous one by something the
  reader can nearly guess. A section that needs a second mechanism is two
  sections.
- **Build a ladder, not a list.** State in one phrase how each rung follows
  from the last. Sections join with "but" or "therefore", never "and then".
- **Announce the point, even in discovery order.** A section that ends on its
  fix still opens by saying where it is going.
- **Declare the boundary** between the idea and the engineering: "everything
  after this changes how fast it runs, not what it returns".
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
  facet this step uses. When a new concept arrives, re-run an earlier example
  through it and recompute its numbers.
- **Keep interesting extras out of the mechanism.** Anecdotes and history as
  colour hurt beginners most; put them in a `.sidenote` or after the payoff.
- **Give experts a way past the scaffolding**: help that novices need slows
  experts down. Say what to skip, and to where (see long-pages-and-series.md).
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
  teaches a wrong model that no later disclaimer fixes. Name the tempting
  simplification you decline, and why.
- **Count what else the example costs.** Reject one that needs domain knowledge
  competing with the concept, is really a puzzle, or that the reader already
  solves better another way (factorial for recursion). A toy that only shows a
  process's shape is fine if labelled as one, but it is never the need.
- **Real before cooked.** A real sentence, a real file's bytes or a real
  codebase's case carries quirks an invented sample hides.
- **Representative before flashy.** Open with the example whose quirks do not
  hide the idea; bring in the striking one later and name its quirks.
- **One running example per concept.** On a web page, the reader's own input
  (their text, their bit string) is the best running example there is. Once the
  model holds, two or three deliberately different cases help it transfer.
- **Climb a size ladder.** Start at the smallest case that means anything, grow
  one step at a time, show one more iteration than needed before "and so on",
  and when scaling back up, name exactly what changes.
- **Make big numbers felt**: as 2^b equal choices or b yes/no questions, split
  into factors that have names (2^32 ≈ 4 billion), then compared with something
  real.
- **Measure every version on one benchmark**: naive, each improvement, then the
  bound. The gap that remains is the need for the next step. Keep the naive
  version as the oracle every faster one is shown to agree with.
- **Specialised types first** on FP pages: `[a] -> Int` before
  `Foldable t => t a -> Int`; define `map` before using the library's.
- **Keep arithmetic unsimplified** until the pattern shows (8 + 3, not 11).
- **Numbers are expensive in prose.** Keep the ones the reader computes with;
  move the rest into a figure or table.
- **Say when an example is invented**, and keep it apart from measured facts.

## Formulas, notation and names

- **Name sparingly**: about one new term per 1,000 words is the 3Blue1Brown
  rate. Acronyms and field names (`HLIT`, `BTYPE`) wait for the reference section,
  unless the main line reasons with them (a bit walk); then gloss each in plain
  words at first use ("HLIT, the number of literal/length codes"). No sentence
  should lean on two terms the reader met only in the last section.
- **One name per thing**, in prose as well as notation: "block", "chunk" and
  "superblock" never drift into one another, and the prose name matches the
  identifier, the figure label and the glossary. Labels the author coined while
  working ("the fast path") are private until introduced.
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
- **Refute the folk theory first.** Where readers arrive with a wrong model,
  clear exposition teaches almost nothing and raises their confidence. State
  the wrong model in full, as a mechanism, then show the case where it fails.
  Do this only for misconceptions the target reader actually holds.
- **Demote a wrong primary cause** explicitly, build on the right one, then
  bring the demoted factor back in its true role. Rescue the true kernel of a
  popular wrong explanation.
- **Your aha is not their explanation.** The analogy that clicked for you came
  from struggling with details; ship the details and examples, and give the
  analogy at the end as a summary.
- **Write down the expected outcome before a surprise**, and rule out the dull
  explanation (a bug, rounding) before giving the real one.
- **When a pattern breaks**, explain both why it held and why it breaks exactly
  there.
- **Expose a load-bearing assumption** with the nearest case where it fails
  ("this works because the bit vector never changes; insert one bit and every
  rank shifts").
- **Set a wrong argument beside its valid twin** and ask the reader to find
  the difference. Show a non-example that passes the surface check but breaks
  the real rule.

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
- **Labels in the figure, text with the state.** Label parts where they are,
  not in a legend; put a step's words in the same step as the state they
  describe. Use one colour for a thing across prose, code and figure, and
  colour only the concept of the current step.
- **Compare side by side, step a process.** When the reader must compare
  states, show them at once in a fixed frame. Use a stepper for a process: one
  persistent figure, one change per step, a trace of earlier states.
- **Step text presents meaning**, not motion: "the counter now holds rank(3)",
  not "the pointer moves right". Give each step its reason.

**Interactives** (details in
[references/figures-and-interactives.md](references/figures-and-interactives.md)):

- **Earn it.** Name the failure of the plain text it fixes. Otherwise draw a
  static figure; an interactive the reader only watches is close to an
  animation.
- **The default state already teaches**, for skimmers, print and readers
  without JavaScript.
- **Say what to do and what to look for**, in the sentence before it.
  Introduce each control, with its meaning, before asking the reader to move
  it. Unlock one control at a time.
- **The reader is the mechanism first**: they turn the knob by hand against a
  target, then the page shows the system doing it. An **ablation switch**
  (turn one part off and see what breaks) and a **diagnostic view** (the defect
  visible before the theory names it) make strong centrepieces.
- **The open sandbox goes last**, built from parts already introduced, with a
  question to answer and an honest note on what it ignores.

## Checks for the reader

- **Predict before the reveal**, at real decision points. Ask for magnitude, not
  direction ("faster, of course, but how much?"), or a gut guess revisited at
  the end.
- **Make the reader commit.** Ask for a concrete answer (an option, a number, a
  shape) and say a guess is enough. Committed guessing roughly triples the
  benefit of a question only read. The benefit stays with what was asked
  about, so aim it at the key step.
- **Make the question tell models apart.** It teaches only if the nearest
  plausible wrong model gives a different answer. Build each wrong option from
  one named misconception, and follow a likely miss with a near-twin question.
- **Reveal the reasoning and the insight**, not only the answer, and say why
  each plausible guess was reasonable.
- **Fade the worked examples.** For a mechanism shown more than once: fully
  worked, then with the last step left as a prediction, then the reader's own
  turn, with graduated hints (a general question, a specific pointer, the
  answer). After a step the reader watched, ask why it was taken.
- **After a mechanism, check transfer**: ask the reader to deduce something new
  with it, or to produce the next piece (the base case, the input that breaks
  it).
- **Give at least one checkable question before the end.** Smooth reading is
  no evidence of learning.
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
- **Admit difficulty and uncertainty**, specifically: name the hard step and
  why it is hard. Keep the hedges that state a scope or a magnitude ("about 90%
  right"); cut reflexive softeners and apologies for the topic. Call a hard
  idea a small definition with large consequences, never easy.
- **Let care show at the real payoffs.** Motivation, not clarity, is what
  limits learning, and readers catch interest from an author who visibly has it.
  Show it through reasons ("the naive bound was n log n; this is n"), not
  adjectives ("remarkably").
- **Signpost the subject, not the document**: "What makes rank slow?", not
  "This section explains rank."
- **Sentence length is not the lever.** 3Blue1Brown averages ~25 words a
  sentence. Clarity comes from the order inside the sentence: known information
  first, the new point last, the subject close to its verb, the actors as
  subjects and their actions as verbs. See
  [references/sentences.md](references/sentences.md).

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
  decision points. Its `summary` asks for a concrete answer ("seconds, minutes
  or hours? Decide before you open this"); the body gives the answer, the
  reasoning and the misconception behind each wrong option. Graduated hints can
  be nested `details.disclosure` folds inside it; no page does this yet, so check
  how it renders. Transfer checks and optional exercises are plain
  prose or a `details.disclosure` titled as optional.
- **Naive versions** carry their label: in the `h2` ("A first try: scan and
  count"), the caption, and the `data-label` of a `<bh-versions>` figure.
- **Promises.** Flag a simplification in the prose or a `.sidenote`, and link it
  forward to the section `id` that pays it off.
- **Depth** goes in `details.disclosure`, with the one-line upshot in the main
  text *before* the fold. Asides go in `.sidenote`.
- **Formulas and figures.** Point from formula terms and prose to diagram parts
  with `data-ref`; walk a mechanism with `<bh-stepper>`; build an implementation
  a clause at a time with `<bh-codewalk>` (about a dozen lines per step, in the
  order the designer decided things); make the centrepiece a
  `<bh-playground>` on the reader's own input where you can, whose default
  state already makes the point. Compare states with `<bh-versions>`.
- **Terms.** `docs/glossary.html` underlines the first use of every defined
  term automatically. That is a reminder, not an introduction: still delay the
  term until after the need, and reuse the glossary's name for it.

## Drafting workflow

Copy this checklist and work through it:

```
Draft progress:
- [ ] 1. Reader, assumptions, and the one question the page answers
- [ ] 2. Where existing explanations make too big a step, and what the reader likely believes wrongly
- [ ] 3. Running example: clean, representative, keeps the hard part hard
- [ ] 4. Ladder of steps, each with need → naive → crack → fix
- [ ] 5. Name table: one name per thing, across prose, code, figures and glossary
- [ ] 6. Promise list: every simplification, deferral and plant, with its payoff
- [ ] 7. The checks: one or two predictions aimed at the key steps, each with its wrong options
- [ ] 8. Draft the prose; then add each figure or interactive against a named failure of the prose
- [ ] 9. Opening and TL;DR last
- [ ] 10. Review it with references/review.md, including the cold read, and fix what it finds
```

Step 2 comes from reading two or three standard explanations of the topic and
marking where you stalled: that step gets its own section. When drafting
section N+1 makes an earlier section need rewriting, rewrite it rather than
patching sentences.

## Reviewing

Read [references/review.md](references/review.md) first; it has the audits.
For a page past ~3,000 words or part of a series, also read
[references/long-pages-and-series.md](references/long-pages-and-series.md).
Run `node <skill-dir>/scripts/page-stats.mjs <page>` (`<skill-dir>` is the
directory holding this SKILL.md) for
words per section, voice rates against the 3Blue1Brown medians, every promise
phrase to match against its payoff, and the "obviously"s, document signposts
and empty verbs to check. In short, check:

1. Does the opening create a need before it names anything?
2. For each section: what is the one new idea, and what makes it guessable?
3. Is every term, formula and fix preceded by the need and the crack?
4. Is every promise flagged where made and paid off by name?
5. Do examples come before abstractions, clean numbers first, one running example?
6. Do labels and captions carry meaning, including what not to read into a figure?
7. Is the voice a companion's, and is reference material out of the narrative?
8. Is the scope one concept, and does the headline state the takeaway?
9. Do the sentences carry the reader: known before new, one name per thing, a
   stated point in each paragraph?
10. Does each interactive fix a named failure, teach in its default state, and
    say what to do?
11. Does a cold reader with no context stall anywhere? Smooth reading is not a
    pass: is there a checkable question that would show the reader had not
    understood?

Lead with the biggest leap: the earliest point where the target reader most
likely gives up (a reader who stops there never sees the later problems). Then
the rest, ranked by impact. For each: where it is, what the reader needs that is missing,
and a concrete fix. Say what already works, so it is preserved.

## Caveats

- The core is one author's tendencies, measured with simple text proxies. Treat
  the numbers as direction, not law. The other sources are practitioners' stated
  methods, patterns seen in their work, and experiments run mostly on novices
  over short lessons; sources.md says which is which and how strong each is.
- High-affect explanation is not detailed understanding. Grant Sanderson, as
  Matuschak and Nielsen report, doubts that more than a small fraction of
  viewers take away much detailed understanding. That is why the page needs
  checks, not only the moves.
- Do not imitate the voice mechanically. A reference page may legitimately be
  terser; apply the ordering, promise and example rules even there.
