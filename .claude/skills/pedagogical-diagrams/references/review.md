# Reviewing a diagram for teaching

`npm run check` already answers whether a diagram is drawn correctly: arrow tips, label
clearance, ids, `viewBox` padding, accessible names. This review answers whether the diagram
teaches. Do not repeat what `check` reports; run it first and leave those findings to it.

## Contents

- Procedure
- The questions
- What to report
- Calibration

## Procedure

1. List the page's figures (`grep -n '<figure' docs/<slug>.html`) with each id and caption.
   Skip a figure with no `<svg>`, `<bh-sequence>`, `<bh-chart>` or `<img>`.
2. For each figure, **cover the prose** and read only the picture and its caption. Write down
   the one point you take from it, before looking at what the page says it is.
3. Then read the prose around it and compare. Where the two differ, the figure is not making
   the point the page needs.
4. Look at the figure at its real size: in a browser, light and dark, and at 375px wide
   (`CLAUDE.md`, "Verifying changes"). Whether it is legible is part of the review.
5. Run the questions below on every figure; write up only the ones that fail.

## The questions

1. **The point.** Can a reader state the figure's one point from the picture and caption
   alone? (Step 2.) If the stated point is not the page's, which element misleads?
2. **The form.** Does the figure have the shape of the idea (a tree for a hierarchy, a strip
   for a layout, one frame per step)? What would a different form make obvious?
   ([form-and-content.md](form-and-content.md))
3. **The cut.** Which element could be removed without loss? What was left in because it was
   easy to draw? Is anything essential missing, so that the reader must already know the idea
   to read the picture?
4. **The hierarchy.** What does the eye land on first, and is that the subject of the current
   point? Is anything emphasised that is only context?
5. **The position.** Are things used together next to each other? Is the layout the same in
   every figure of the page? Is anything drawn to scale without saying so?
6. **The frames** (a process): one frame per step, none missing; the order explicit; what
   changed in each step visible; the join not hidden; the same viewpoint throughout; arrows
   with one meaning each. ([process-diagrams.md](process-diagrams.md))
7. **The words.** Is every label next to its part? Is text that only restates the picture
   cut, and text the picture cannot do without put into it? Does the caption say what to
   notice, and what not to read into the figure (scale, simplification, a liberty)?
   ([text-and-labels.md](text-and-labels.md))
8. **The misreading.** What would a novice misread? Take each arrow, each colour and each
   position and ask what a reader who did not know the idea would take it to mean. A reader
   infers motion piecemeal and may infer the wrong cause (Hegarty; Tufte on arrows).
9. **The vocabulary.** Does each colour and arrow style mean one thing across the page's
   figures, and is it said once?
10. **The pairing.** For a figure with several pictures of one idea: is each one's job stated,
    and is the correspondence visible (shared colour, alignment, `data-ref`)?
11. **The reader.** Is the figure written for a novice (parts and steps) or for a reader who
    has the parts already (compact)? Does a later figure assume what an earlier one taught?

## What to report

Lead with the figure where the target reader most likely stops understanding, then the rest by
impact. For each finding:

- the figure (id), and the caption or element it concerns;
- the question it fails, in one phrase;
- what the reader would take from it, against what the page needs;
- a concrete change (cut this element, draw it as a strip, number the frames, move this label
  into the figure), small enough to act on.

Say what already works, so a later edit keeps it. A review that finds nothing in a figure says
so for that figure; it does not manufacture a finding.

Out of scope for the review: redrawing the figure (a follow-up), and any finding that
`npm run check` would report. For prose, pacing and the interactive around the figure, use
`pedagogical-writing`.

## Calibration

- The research behind each question is mostly short lessons on one mechanism with novices.
  A finding is a hypothesis about this page's reader, not a verdict. Say how confident it is.
- A figure that is correct and clear but not needed is a finding about the page
  (`pedagogical-writing`'s "earn it"), not about the picture.
