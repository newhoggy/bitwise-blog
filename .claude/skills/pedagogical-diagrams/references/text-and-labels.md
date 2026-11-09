# Text and labels

How words, colour and arrows work inside and around a figure, and who the figure is for. The
drawing mechanics (the `c1`–`c6` classes, arrowhead geometry, label clearance) are in
`CLAUDE.md` → Diagrams and enforced by `npm run check`; they are not repeated here. Sources
and their strength are in [sources.md](sources.md).

## Contents

- Split attention: put the words in the figure, or leave them out
- Prose and diagram together
- Labels in the figure
- One colour vocabulary, spent on one concept per step
- Each arrow style means one thing
- Say what a schematic's scale is
- Say what you changed in the figure, and why
- Novices and experts

## Split attention: put the words in the figure, or leave them out

Two conditions decide it (Kalyuga, Chandler & Sweller 1999).

1. **The diagram cannot be read without the text.** Then integrate: the text goes into the
   diagram beside the part it describes. Integration "is required if these sources of
   information are unintelligible in isolation". A legend that the reader flips back to, or a
   paragraph a screen away, makes them search and hold; that load is not learning.
2. **The diagram can be read alone.** Then text that only restates it adds load, and the
   authors report that "elimination, rather than integration, of redundant sources of
   information is beneficial". Cut the restatement, not the diagram.

The same paper's Experiment 2 found that colour coding between text and diagram parts reduced
the search for referents. That is what `data-ref` and one colour vocabulary do.

What prose should carry then: the why, the conditions and the quantities, which a picture
holds badly. The caption says what to *notice*, not what the picture is.

## Prose and diagram together

- **Keep the figure on screen with the prose that explains it.** When prose explains a figure
  part by part, repeat a cropped copy beside it if needed. Present mode already shows a figure
  from another slide alongside.
- **Point from the sentence to the part.** `<span data-ref="figure-id:part-id">…</span>` and
  include the edges that make the point (`CLAUDE.md`).
- **Say the claim once.** If the caption says "the two savings are independent" and the
  paragraph says it again in the same words, one of them goes.

## Labels in the figure

Put each label next to its part, not in a legend. Put a step's text with the state it
describes, in the same step. (Moved from `pedagogical-writing`.)
- Mayer: "People learn better when corresponding words and pictures are presented near
  rather than far from each other". An independent meta-analysis finds g = 0.63. The effect
  is largest when neither picture nor text makes sense alone.
- Tufte: figures "are usually not substantively separate from the text; so they need not be
  divorced from the text".
- **Labels carry meaning** ("copy 4", "back 7–8", not `258`, `d5`). Where a figure must show
  a raw number, label it with what it is (`tree-cost`: "a is symbol 97, 001100001. It is
  neither a's code nor the byte it decodes to").
- **Make the encoding unmistakable** when labels and data are both bits: style them
  differently and say which is which.

## One colour vocabulary, spent on one concept per step

Use the same colour for a thing in the prose, the code, the formula, the figure and the
controls, and keep each colour's meaning for the whole page. In any one step, colour only
the concept being taught. Emphasise by the smallest difference that is reliably visible:
dim the rest rather than shouting the part.
- Patel: "In the code, instead of using standard colorizations for strings, keywords, etc., I
  use the same colors that I used in the diagram. I use the same colors in the text." And: "In
  each step, I would use color only for the one concept I am trying to explain."
- Wittens colours formula terms with the diagram's colours for the whole essay (blue operand,
  green multiplier, red result).
- Tufte (via Casselman): "Produce emphasis by using the smallest possible effective
  distinctions."
- Colour is never the only carrier of meaning (CLAUDE.md): pair it with the label.
- The house colours `c1`–`c6` have fixed meanings (our system, data, external…), so in a
  data-structure figure most parts share one colour. Tell parts within a colour apart by
  position, shape and label (a row for superblock counts, a row for block counts), not by
  borrowing another meaning's colour.
- Say it once, early: `overview` ends "These four colours keep the same meaning in every
  figure below."

## Each arrow style means one thing

Arrows can mean data flow, a pointer, "becomes", "calls" or "is followed by". Use one meaning
per line style in a figure, and say in the caption what an arrow means.
- Tufte: links and arrows "bring with them many implicit but powerful assumptions" (secondary
  quote). His own notebook says: "Lines and arrows are, in effect, verbs showing how one noun
  is related to another." Choose the verb.
- Heiser et al.: "consistent use of diagrammatic elements or semiotics to indicate motion or
  direction".
- An arrow of implied causality needs a reason in the text (see
  [process-diagrams.md](process-diagrams.md)).

## Say what a schematic's scale is

When a figure draws 512 numbers as four boxes, say so.
- Alammar: "the embedding vector (512, or 4 boxes in the figure)".

## Say what you changed in the figure, and why

When a figure takes a liberty (a transparent rim, a rotated map), name it and its purpose.
This complements saying what the figure does not show.
- Ciechanowski, *Bicycle*: "I made the rim semitransparent, so that you can see how these parts
  interact."

## Novices and experts

What helps a newcomer can hurt someone who already knows the idea. The evidence here is one
study reported secondhand: Mayer & Gallini (1990), as Jian & Wu (2016) report it, found that
readers with low mechanical knowledge who saw car-brake diagrams with both **parts and steps**
beat the other groups on retention and transfer, and that the difference was not seen for
high-knowledge readers (see [sources.md](sources.md): the original abstract was not
retrievable).

- **First figures of a topic: parts and steps.** Label the parts, number the steps, draw the
  motion.
- **Later figures in a series: compact.** Once the parts are known, drop the labels the reader
  can supply and let a figure show only what is new.
- **Give experts a way past it**: a caption that says what to skip, and a first frame that
  already shows the finished state.
- **Do not rely on prior knowledge the target reader lacks** to read a diagram. Heiser & Tversky
  (2005) state in their introduction that "individuals low in prior knowledge or spatial ability
  often have more difficulty extracting relevant information and making inferences from
  diagrams" (citing earlier work, not tested there).
