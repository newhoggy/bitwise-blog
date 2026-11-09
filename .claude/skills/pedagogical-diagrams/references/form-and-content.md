# Form and content

What the picture shows and how it is laid out: the form, what to leave out, hierarchy,
position, and several pictures of one idea. Sources and their strength are in
[sources.md](sources.md). Page examples are figure ids in `docs/how-deflate-works.html`.

## Contents

- Choose the form from the structure of the idea
- Name the one point, then remove the rest
- Hierarchy: what dominates
- Position carries meaning
- Several pictures of one idea

## Choose the form from the structure of the idea

Ask what shape the idea has, then draw that shape. The **Congruence Principle** (Tversky,
Morrison & Bétrancourt 2002) says the structure of the graphic should correspond to the
structure of the idea in the reader's head. Larkin & Simon (1987) give the mechanism: a
diagram helps when things used together sit at one location, so an inference is a glance and
not a search. A diagram that does not do this is no better than the sentences.

| The idea has the shape of | Draw | What it makes obvious | In this repo |
| --- | --- | --- | --- |
| containment, a hierarchy | nesting, or a tree | what is inside what; a leaf is an endpoint | `huffman-tree`: no code is the start of another, because every letter is a leaf |
| a sequence | a row read left to right, or a column top to bottom | order, and what a step consumes | `<bh-stepper>` over one figure |
| layout in memory or in a stream | a strip of cells, to scale | adjacency, offsets, how much is where | `window`, `bit-output` |
| messages between parties | `<bh-sequence>` | who talks to whom, in what order | `<bh-sequence>` in a `figure.diagram` |
| states and transitions | a state chart | which moves are possible from here | |
| a quantity split into parts | a bar divided into parts, to scale | which part is most of the whole | `tree-cost`: "how little of the tree is tree" |
| a value that depends on parameters | a plot or a playground | how it changes as one input moves | `<bh-playground>` |
| A before and after | two frames in one fixed layout | what changed | `<bh-versions>` |

Two pictures of one operation can make different properties obvious. Show both and say what
each shows (`window` and `join` are two pictures of the same tokens: positions and copies, then symbols).

**Test.** Say the idea's shape in one phrase ("a tree whose leaves are letters"). If the
figure does not have that shape, either the figure or the phrase is wrong.

**Counter-case.** Congruence is not realism. Tversky et al. note that people hold angles and
lengths in gross categories, so finer distinctions "will not be accurately apprehended": a
route is drawn as turns, not as exact road geometry.

## Name the one point, then remove the rest

Before drawing, write the point as one sentence that the caption can start from ("the two
savings are independent"). Every element must serve that sentence. Heiser & Tversky (2005)
state in their introduction that effective diagrams "abstract the essential information, and
omit information that is irrelevant to the problem or task at hand"; Mayer's coherence
principle found that learners did better when extra material was removed (23 of 23 tests, the
chapter abstract's median effect size 0.86).

- **Cut by asking what the reader loses.** Remove an element; if the point survives, leave
  it out. Realism, decoration and a second idea are the usual cuts. Tversky et al. say
  animations should "lean toward the schematic and away from the realistic", and the same
  holds for a still.
- **Keep the hard part.** What is cut must not be what makes the idea hard. A figure that
  makes the difficulty look already solved teaches a wrong model (see "Simple, but not too
  simple" in `pedagogical-writing`).
- **A real instance, not a symbol.** Draw one concrete case with real values (the example
  string, the 35 bytes), while the prose speaks generally.
- **Say what was simplified**, in the caption: "each block is drawn as wide as the bits it
  costs", "four boxes stand for 512 numbers". This is the figure half of "what not to read
  into a figure". Why each liberty is taken belongs with it
  ([text-and-labels.md](text-and-labels.md)).
- **Seductive detail has a price.** A pretty extra costs working memory that the point needed
  (the meta-analysis behind this is listed in `pedagogical-writing`'s sources, read via a summary).
  Keep it out of the figure; put it in a `.sidenote` or a fold.

## Hierarchy: what dominates

The subject of the current point should dominate; context should recede. Reliably visible,
smallest effective difference: weight, size or an outline on the subject; context in the
neutral grey of the theme, not another hue.

- **Spend one emphasis per frame.** If everything is bold, nothing is. In a stepper, light
  only what the current step teaches and dim the rest (Mayer's signalling principle: 24 of 28
  tests, median 0.41).
- **Order by importance, not by data.** The thing the reader must read first goes where
  reading starts (top-left in a left-to-right page), and is the biggest.
- **The Apprehension Principle is the limit.** Differences the eye cannot tell apart at the
  size the figure is shown carry nothing. A label of 5px on a phone is not apprehended: check
  the figure at phone width (`CLAUDE.md`, "Verifying changes").
- Colour is a meaning, not an ornament: see "One colour vocabulary" in
  [text-and-labels.md](text-and-labels.md), and `CLAUDE.md` → Diagrams for `c1`–`c6`.

## Position carries meaning

Place things so that position itself says something, and keep that mapping stable.

- **Things used together go together** (Larkin & Simon). If the reader must compare two
  values, put them next to each other in one frame, not on two figures a screen apart.
- **Align what corresponds.** When two rows describe the same items (symbols and their
  codes), give them the same x so the correspondence is a vertical line the eye follows.
  `decode-table` aligns code lengths, canonical codes and table entries.
- **Keep the layout fixed across the figures of a page.** The same row for the same kind of
  thing each time (input on top, output below) means the reader learns the layout once.
  Change a layout only to mark a change in what is being shown, and say so.
- **Scale is a position too.** When the length of a mark is the quantity, draw it to scale
  and say so (`tree-cost`: "each block is drawn as wide as the bits it costs"), and put an
  anchor mark beside it (the example's 41 bits of data).
- **Side by side for comparison.** Several states in one fixed frame, not a toggle: comparing
  from memory is a memory test (Patel's "show all > show interactivity > show less", moved
  here from `pedagogical-writing`; see [process-diagrams.md](process-diagrams.md)).

## Several pictures of one idea

Two or more pictures of one idea (a tree and a table of the same code) are worth their space
only if each has a stated job. Ainsworth's DeFT framework (2006) is about the design,
functions and tasks of multiple representations; its abstract is the only part read (see
[sources.md](sources.md)), so the rules here are the skill's own.

- **Say what each is for**, in the prose or the caption: "the tree shows why no code is a
  prefix of another; the table is what the decoder actually reads".
- **Make the correspondence visible.** Shared colour for the same thing across pictures
  (Kalyuga et al.'s second experiment: colour coding between text and diagram parts reduced
  the search for referents), aligned layout, and `data-ref` from the prose.
- **The reader pays to relate them.** Each extra picture is work. Start with one, add the
  second when the first has a named limit, and say what it fixes.
- **Never two pictures that say the same thing** with no stated difference.
