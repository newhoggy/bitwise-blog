# Reviewing a teaching page

Use this when asked to review a page for clarity, to say why a page is hard to
follow, or as the last step of drafting.

## Contents

- Procedure
- The cold read
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
- [ ] 2. Cold read: a reader with no context reads the page and reports where it stalls
- [ ] 3. Read the whole page once yourself as the target reader, noting where you would stop
- [ ] 4. Section map: one new idea per section, and what makes it guessable
- [ ] 5. Promise and claim audit
- [ ] 6. Term and formula audit
- [ ] 7. Example and figure audit
- [ ] 8. Interactive audit
- [ ] 9. Check audit
- [ ] 10. Sentence audit, on the sections the cold read or your own read flagged
- [ ] 11. Opening and ending audit
- [ ] 12. Rank the findings and write the review
```

Step 1:

```bash
node .claude/skills/pedagogical-writing/scripts/page-stats.mjs docs/<slug>.html
```

It prints words per section, voice rates against the 3Blue1Brown medians, the
number of `details.predict` folds, and every promise phrase with its section.
It also lists the words that claim something is obvious, signposts that talk
about the document, and empty verbs hiding an action ("performs a lookup").
Tables, term lists (`dl`), code and SVG are left out of the counts. The numbers
point at where to look; they are not findings on their own, and the promise
list is a starting point, not the whole ledger.

If the user's reader (say, "new to compression") differs from the reader the
page assumes, review for the user's reader and say so in one line.

For a page past ~3,000 words or part of a series, also read
long-pages-and-series.md: missing routes, checkpoints and skip labels are
common findings there. The audits below are self-contained: open sentences.md
and figures-and-interactives.md only to look up a rule while auditing a flagged
section or a specific interactive, not to read in full before starting.

For a page shown as a reviewer saw it, use `git show <commit>:docs/<slug>.html`.

## The cold read

Reading the page "as the target reader" is the step that fails most: the author,
or an agent that has just read the source material, cannot forget what it knows.
Pinker: "we're not very good at figuring out what other people are thinking, even
when we try really, really hard". So get a reader who does not know.

**Minimum: a fresh-context reader.** Start a subagent with no conversation
history, and wait for it: run it in the foreground, or start it first and do not
rank findings (the last step) until it has returned. Give it the page file's path
and tell it to read only that file (the HTML is fine: it holds the figure labels
and fold text too), not the source material or this skill. Give it the target
reader's prerequisites, and ask it to read as that reader and report, in order:
- the first sentence where it stalled, and why;
- every term, symbol or coined label it could not place;
- every number whose origin it could not trace ("where does that number come
  from?");
- every figure or interactive it would have scrolled past, and what it thought
  the figure was for;
- its answer to each `details.predict` from the summary alone. A file read shows
  the fold's answer too, so treat these guesses as weak evidence: they show
  whether the question is answerable from the text above it, not what a reader
  would guess.

Ask it to report where it stalled, not what it thinks of the page. Its stalls are
findings; its opinions are not. Where its first stall differs from yours, prefer
its: it is the evidence. If the cold read could not run or did not return, say so
in the first line of the review, so the reader knows the biggest leap rests on
your own read alone.

**Better: a real reader.** If the user can get one or two newcomers to read the
page, the method from Sam Rose: watch them read it silently on a screen share,
camera and microphone off, and do not answer questions. One or two people per
round, at most three rounds. The typical finding is a reader scrolling straight
past an interactive the author thought was obvious. An expert reader catches a
different fault: the missing key fact without which the page does not make sense
(Julia Evans).

**Fold back what recurs.** Questions that keep coming back in a page's review
threads are missing sentences in the page, not only replies.

## The audits

### Section map
For each `h2`, write one line: *new idea*, *what in the previous section makes
it guessable*, and which of need / naive attempt / crack / fix are present. A
section with two new ideas, or with no predecessor, is a leap. A leap that is
flagged and paid back later (see promises) is not a defect.

Also flag a section over ~800 words: it usually holds two ideas or reference
material. Then four quick tests:
- **Title test**: can the section get a short title without "and", and is its
  `h2` that title? A generic heading ("Details", "More on X") means two ideas or
  none.
- **Join test**: does each section follow from the last by "but" or
  "therefore"? "And then" means a list.
- **Point test**: does the section's opening say where it is going, even if its
  point lands at the end?
- **Load test**: list what the reader must hold at once in the hardest
  paragraph. Above about four interacting parts, split the section or introduce
  some of the parts earlier.

### Promise and claim audit
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

Then the claims. For each load-bearing statement that is not shown on the page,
the page should say where it stands: shown later (a promise, above), referenced
(a link), asserted, or unknown. An unmarked one is a finding. For each
"obviously", "clearly" and "trivially" in the script's list, ask whether a
newcomer would agree and whether it is true; if not, the fix is to show it or say
where it stands. Hedges that state a scope or a magnitude are fine; reflexive
softeners are not.

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
- Does any concept go by two names (in prose, code, figure labels or glossary)?
  Does the page use a label the author coined without introducing it?
- Is an early name a handle the prose uses often? If not, it should wait for the
  need.

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
- For each figure, what is its one purpose? A figure serving two purposes is two
  figures. Is there an explanatory paragraph with no figure where one would
  help, or a figure no paragraph talks about?
- Are labels in the figure, not in a legend? Does each arrow style mean one thing?
  Where the reader must compare states, are they side by side?
- Does stepper and caption text say what a step means, or only what moved?
- Is the naive version labelled as provisional where it appears?
- Do analogies lead towards the quantitative step, or only decorate it? Is the
  centrepiece analogy the author's own aha, with the details that earn it removed?
- What else does each example make the reader learn (a domain, a puzzle)? Could
  the reader already solve it a better way?

### Interactive audit

For each playground, stepper or other interactive (see
figures-and-interactives.md):
- What failure of the plain text does it fix? If none can be named, a static
  figure would do.
- Does its default state already make the page's point, with JavaScript off?
- Does the sentence before it say what to do and what to look for?
- Is each control introduced, with its meaning and unit, before the reader is
  asked to move it? Would the reader need a tooltip?
- Is the state space limited (one control unlocked at a time), or is the reader
  dropped into a sandbox before the end?
- Does the final playground have a question to answer, and say what it ignores?

### Check audit
- Does each `details.predict` ask for a concrete answer, and is it aimed at the
  key step rather than a side detail?
- Would the nearest plausible wrong model give a different answer? If both give
  the same one, the question confirms nothing.
- Does the reveal give the reasoning and the insight, not only the answer?
- Is there at least one question with a checkable answer before the end, so a
  reader who has not understood can find out? Smooth reading is not evidence of
  learning.
- Where a mechanism is shown more than once, does the support fade?

### Sentence audit
Run it on the sections the cold read flagged, using the diagnostics in
sentences.md: list the first words of each sentence (one consistent story?),
circle the intended stress (is it before the full stop?), underline the first six
words (has the verb arrived?), name each join, and find each paragraph's point
sentence. Report a sentence-level problem only with its rewrite.

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

Two numbers from outside 3Blue1Brown set the bar for checks. In Muller's
physics study, a "clear, concise" exposition moved scores from 6.0 to 6.3 out of
26 and made students more confident, while a version that voiced and refuted the
misconception nearly doubled them. In a meta-analysis of prequestions, guessing
gave g = 0.65 and only reading the question g = 0.22. A page that reads smoothly
and asks nothing is not yet shown to teach.

## Output format

1. **The biggest leap**: the earliest section where the target reader is most
   likely to give up. Prefer the earliest severe leap over a worse later one: a
   reader who stops there never reaches the later problems.
   Its location (heading and `#id`), what the reader needs there that is
   missing, and a concrete fix, ideally with the new wording or the order of
   the new steps.
2. **The other findings, ranked by impact**, in the same form. Give the top
   seven or so in full; list the rest in one line each.
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
