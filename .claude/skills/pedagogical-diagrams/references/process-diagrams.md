# Process diagrams

How to split a process into frames, and when to use a still, a stepper, an animation or an
interactive. Sources and their strength are in [sources.md](sources.md). The words of each
step (what a caption says) belong to `pedagogical-writing`; this file is about the frames.

## Contents

- The frame principles
- Mapping them onto the theme's components
- Still, stepped, animated or interactive
- Leave a trace of earlier states
- Remove scaffolding out loud
- Crack the picture, not only the idea
- Show all the variants when the reader must compare

## The frame principles

Heiser et al. (2004) derived these from what people drew, what they preferred and how fast and
accurately they assembled a TV stand; instructions built from them cut assembly time by 35% on
average and error by 50% against the factory ones. **One task**, so they are defaults for a
page, not laws. The authors say they apply to "other kinds of visualizations, particularly
those that show processes over time": that step is their belief, not a test.

| Principle (the paper's list) | On a page |
| --- | --- |
| Step-by-step, one diagram for each major step, no steps omitted | One frame per step of the mechanism. A step left out is the one the reader stalls on. |
| Clear and explicit order | Number the frames, or place them in reading order. `<bh-stepper>` numbers its steps and makes each linkable as `#figure-id-step-N`. |
| Parts added in each step should be visible | The thing that is new in this step is marked: a `data-change` mark, the lit node, the new row. |
| Mode of attachment should be visible | Where the new thing meets the old is not hidden under it. Do not draw an arrow over the join it explains, and do not let a label cover it. |
| Action diagrams rather than structural | Show what happens (a copy being written, a count rising), not only the state after it. A structural picture is the *before* and *after*; the action is the arrow and the changed part between them. |
| Arrows and guidelines used consistently | One meaning per arrow style: see [text-and-labels.md](text-and-labels.md). |
| Avoid changing viewpoints | The same layout in every frame. If the layout must change, make the transform easy to follow: say so, and keep one anchor in the same place. |
| Show stable orientations | In the paper this is about showing an object in a physically possible pose. The skill's adaptation for a diagram: keep the baseline, the direction of reading and the up/down meaning (the same row for the same kind of thing) unchanged across frames. |

The paper's Stage 3 found differences between instruction conditions at step 1 (orienting
among the parts) and at the step that attaches a shelf, and concluded that occluding the parts
or the point of attachment "may hinder performance". Spend extra care on frame 1 and on the
first frame that joins two things.

## Mapping them onto the theme's components

- **`<bh-stepper for="figure-id">`**: one persistent figure, one change per step. This is
  the default for a process a system performs. Every step is a frame, numbered and linkable.
- **`<bh-versions>`**: a change to a system as before and after in a fixed frame, with the
  changed parts marked `data-change` (the "parts added are visible" principle).
- **`<bh-sequence>`**: messages between parties over time; the vertical order is the order.
- **A row of figures** only when the frames are independent snapshots. Use small multiples
  with identical layouts.

## Still, stepped, animated or interactive

For a mechanism, prefer a stepper over an animation, and a diagram that shows motion
explicitly over one that leaves the reader to infer it.

- **Why not an animation.** The Tversky et al. (2002) review found that where animated
  graphics beat static ones, "the animated graphics convey more information or involve
  interactivity", so the comparison was not equal. Animations fail the **Apprehension
  Principle** when they are "too complex or too fast to be accurately perceived", and many
  continuous events are conceived of as discrete steps, which a stepper shows directly.
- **Why not leave it to the reader.** Hegarty found that mental animation runs in a
  "limited-capacity spatial working memory system" and is piecemeal: people "do not mentally
  animate the motion of all components of a mechanical system in parallel". A still showing
  five parts in motion asks the reader to animate five parts at once. Draw each move.
- **Show motion and causation.** Use an arrow for each movement, a numbered order for each
  step, and a step per cause. Jian & Wu (2016) found that readers of a diagram with numbered
  arrows beat readers of the same diagram without them on a step-by-step test of how a flush
  cistern works (46 non-science undergraduates), though the gap narrowed after the text.
- **Judicious interactivity** may help where animation fails (Tversky et al.). Whether the
  reader needs it is a `pedagogical-writing` question: name the failure of the plain text it
  fixes.
- Animation may still earn its place for a real-time reorientation, which the same review
  sets apart from conveying a complex system.

A caution on the causality an arrow claims. Tufte's notebook says: "It is easy to draw a
linking line or an arrow of implied causality, but very hard to make credible causal
inferences." If the diagram says A causes B, the page owes the reader the reason.

## Leave a trace of earlier states

When a stepper advances, the state the next step depends on must not vanish: grey out the
previous position, keep a running table of outputs, show consumed bits as consumed. Allow
stepping back.
- Victor: "she's peeking through a pinhole, only seeing a single point in time at any
  instant." His fix: "all frames are lightly overlaid, in order to give context to the active
  frame."
- Sweller (transient information): information that disappears forces the reader to hold it
  in working memory.

## Remove scaffolding out loud

A step may remove construction lines that have done their job, and its text says so.
- Holmér: "for clarity let's just remove the middle line it's getting in the way".

## Crack the picture, not only the idea

When the current picture hides the mechanism, say so and switch pictures, or run the
process backwards.
- Wittens: "by picturing numbers as points, it's not clear how they act upon each other … A
  better solution is to represent our numbers using arrows instead". And: "it's very hard to
  see what's going on while iterating forwards … So we're going to go backwards instead."

## Show all the variants when the reader must compare

Comparing from memory is a memory test. When the reader must compare states (before and
after an insert, three encodings of one string), show them side by side in one fixed frame.
Use a stepper when the reader must follow a process.
- Patel: "It's often better to show all the variants than to ask the reader to interact with
  the diagram to see the variants." His order of preference: "show all > show interactivity
  > show less".
- Tufte: "constancy of design puts the emphasis on changes in data, not changes in data
  frames" (secondary quote).
- Page: `<bh-versions>` in Compare mode, or small multiples with identical layouts.
- Tie-break with "the reader is the mechanism" in `pedagogical-writing`: when the point is
  that the reader should try and fail, let them try first, then show every variant in the
  reveal. When there is nothing to try by hand, the table of variants is the whole job and no
  interactive is needed.
