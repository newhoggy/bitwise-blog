---
name: pedagogical-diagrams
description: "Guidelines for designing a diagram or figure whose purpose is teaching: choosing its form from the structure of the idea, what to show and leave out, hierarchy, layout, splitting a process into frames, labels, arrows, and reviewing a page's figures for whether they teach. Use when asked to draw or design a diagram for a post ('draw a diagram for this', 'how should I visualise this', 'which kind of picture'), when a figure is confusing, or to review a page's figures, even if the request does not say pedagogy. Load it before answering or sketching. Not for charts of data (dataviz), isometric machine illustrations (anatomy), explainer prose, the wording of step captions, pacing or interactive design (pedagogical-writing), or diagram drawing errors and npm run check failures (CLAUDE.md)."
---

# Pedagogical diagrams

A teaching diagram has one job: let the reader see the idea's structure at a glance, so the
inference is a look and not a search. It is not a picture of the topic. Everything below serves
that, and each rule says where it comes from; [references/sources.md](references/sources.md)
says how much of each source was actually read, and which claims were dropped because they could
not be checked.

The line between this skill and `pedagogical-writing`: **this skill is the picture** (its form,
what is in it, its layout, its frames, the words and colour inside it); `pedagogical-writing` is
the text, the interaction and the pacing around it, including whether a figure or an interactive
earns its place at all. The drawing mechanics (colour classes `c1`–`c6`, arrowhead geometry,
label clearance, `viewBox` padding, `role="img"`, `data-ref`) are in `CLAUDE.md` → Diagrams and
enforced by `npm run check`; this skill does not restate them. Where this skill and `CLAUDE.md`
differ, `CLAUDE.md` wins.

## The rules

Read the reference file the task needs; each has the rule's source, a page example and the
detail.

1. **Choose the form from the structure of the idea.** Containment is nesting or a tree, a
   sequence is a row or a column, memory layout is a strip of cells, a before and after is two
   frames in one layout. The graphic's structure should correspond to the idea's (Tversky et al.
   2002; Larkin & Simon 1987).
   → [form-and-content.md](references/form-and-content.md)
2. **Name the one point, then remove everything that does not serve it.** Keep the hard part;
   draw a real instance; say in the caption what was simplified (Heiser & Tversky 2005; Mayer's
   coherence principle).
   → [form-and-content.md](references/form-and-content.md)
3. **Let the subject of the current point dominate, and context recede.** Use the smallest
   difference the eye reliably sees; spend one emphasis per frame (Mayer's signalling principle;
   Tversky et al.'s apprehension principle).
   → [form-and-content.md](references/form-and-content.md)
4. **Make position carry meaning.** Things used together go together; corresponding things are
   aligned; the layout stays fixed across the page's figures; a quantity drawn as length is
   drawn to scale (Larkin & Simon).
   → [form-and-content.md](references/form-and-content.md)
5. **Split a process into frames.** One frame per step with none missing, an explicit order, the
   new thing visible, the join not hidden, one viewpoint, one meaning per arrow (Heiser et al.
   2004, from one furniture task). Map them onto `<bh-stepper>`, `<bh-versions>` and
   `<bh-sequence>`.
   → [process-diagrams.md](references/process-diagrams.md)
6. **For a mechanism prefer steps to animation, and draw the motion and cause** instead of
   leaving the reader to infer them: mental animation is piecemeal and limited (Hegarty); where
   animation beat a still, it usually carried more information or interactivity (Tversky et al.).
   → [process-diagrams.md](references/process-diagrams.md)
7. **Put words in the figure, or leave them out.** If the diagram cannot be read without the
   text, integrate the text into it; if it can, cut the text that only restates it (Kalyuga et al.
   1999). Prose carries the why, the conditions and the quantities.
   → [text-and-labels.md](references/text-and-labels.md)
8. **Keep one colour vocabulary and one meaning per arrow style**, said once.
   → [text-and-labels.md](references/text-and-labels.md)
9. **With several pictures of one idea, say what each is for and make the correspondence
   visible** (shared colour, alignment, `data-ref`). This one is the skill's own synthesis; the
   DeFT paper is a pointer only.
   → [form-and-content.md](references/form-and-content.md)
10. **Write the first figures of a topic for novices (parts and steps) and later ones compact.**
    The evidence is one study, reported secondhand.
    → [text-and-labels.md](references/text-and-labels.md)

## In this repo

| Task | Use |
| --- | --- |
| A process a system performs | one SVG diagram plus `<bh-stepper for="figure-id">`, one change per step |
| Messages between parties over time | `<bh-sequence>` in a `figure.diagram` |
| A change to a system, before and after | `<bh-versions>`, changed parts marked `data-change` |
| A relationship between parameters | `<bh-playground>`: whether it earns its place is `pedagogical-writing`'s question |
| Pointing from the prose to a part | `<span data-ref="figure-id:part-id">`, include the edges |
| The caption | what to notice and what not to read into it; one sentence per arrow style |

A figure id must be permanent and kebab-case (`CLAUDE.md`, "Page contract"). Give the figure's
caption the point you named in rule 2.

## Drawing a new diagram

Copy this checklist:

```
Diagram progress:
- [ ] 1. The one point, as one sentence, and who the reader is (novice or has the parts)
- [ ] 2. The idea's shape in a phrase, and the form that has that shape
- [ ] 3. One real instance, with real values; list the elements and cut each that does not serve the point
- [ ] 4. Layout: what goes together, what is aligned, what is to scale, and what stays fixed across frames
- [ ] 5. For a process: the frames, one change each, in order, with the new thing and the join visible
- [ ] 6. Labels in the figure, one colour vocabulary, one meaning per arrow style
- [ ] 7. The caption: what to notice, and what not to read into the figure
- [ ] 8. Draw it with the repo's theme classes (CLAUDE.md → Diagrams), then npm run check
- [ ] 9. Cover the prose and read only picture and caption: is the point you wrote in step 1 what you take from it?
- [ ] 10. Look at it in the browser, light and dark, at 375px
```

A new diagram gets the same page checks as any other: it needs an id, an `aria-label` and a
`figcaption`, and `npm run check` must report 0 errors.

## Reviewing figures

Read [references/review.md](references/review.md). Run `npm run check` first; this review is for
what lint cannot see: whether the reader gets the point, would misread something, or is paying
for an element that does nothing. Lead with the figure where the reader most likely stops
understanding, give each finding a concrete change, and say what already works.

## Caveats

- The research is mostly short lessons with novices on one mechanism (a flush cistern, car
  brakes, a TV stand, soldering). Treat each rule as a default to test on the page, not a law.
- Mayer's effect sizes come largely from his own lab and are probably high
  (`pedagogical-writing`'s sources note an independent pooled g = 0.37).
- A rule marked as the skill's synthesis has no direct study behind it.

## Reference files

- [references/form-and-content.md](references/form-and-content.md): the form, what to cut,
  hierarchy, position, several pictures of one idea. Read it when choosing or revising a figure.
- [references/process-diagrams.md](references/process-diagrams.md): frames for a process, still
  versus stepper versus animation, traces, scaffolding. Read it for a stepper or any process.
- [references/text-and-labels.md](references/text-and-labels.md): words, colour and arrows in
  and around a figure; novices and experts. Read it when labelling or captioning.
- [references/review.md](references/review.md): the review questions and what to report.
- [references/sources.md](references/sources.md): sources, how much was read, and what was dropped.

Related skills: `pedagogical-writing` for the prose, pacing and interactives around a figure;
`dataviz` for charts of data; `anatomy` for isometric machine figures.
