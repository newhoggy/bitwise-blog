# Figures and interactives

How to design the figures, steppers, codewalks and playgrounds that carry a page. The
rules come from people who build interactive explanations (Bret Victor, Nicky Case, Amit
Patel, Bartosz Ciechanowski, Sam Rose, Steven Wittens, Jay Alammar, Michael Nielsen),
from video educators (Welch Labs, Freya Holmér, Ben Eater, Josh Starmer, Steve Mould,
Derek Muller), from Tufte and Knuth, and from multimedia-learning research (Mayer,
Sweller). See [sources.md](sources.md). Search with
`grep -n "^### " references/figures-and-interactives.md`.

The house rules in CLAUDE.md still apply: one centrepiece interactive per page, the page
reads correctly without JavaScript, and the diagram, colour and motion rules.

## Contents

- Earn it
- The default state
- Guiding the reader through an interactive
- Centrepieces that teach
- Steppers and persistent figures
- Words in and around figures
- Codewalks
- The sandbox goes last
- In this repo

## Earn it

### Name the failure of the plain text it fixes
Write the explanation as prose first. List where a reader would have to hold too much in
their head, cannot see the state, or has no stake. Add a figure or interactive only
against one of those named failures.
- Nielsen: "identify a series of very specific shortcomings in the bare-bones written
  explanation. And for each of those shortcomings we'll find a natural way of addressing it
  using non-traditional media forms". "Visualization is a means, not an end".
- Hohman et al.: "not everything needs to be interactive … In the worst case, interactivity
  may be distracting to readers or the functionality may go unused".
- Alammar, on his own blog: interactives took "quite a bit of time … But what really worked
  the most are these, graphical conceptual explanations."

### Pick the form from the content
Text for abstract ideas, a static figure for structure and relationships, a stepper for a
process, a playground for a system whose behaviour depends on parameters.
- Case's workshop notes: "Text: Best at describing very abstract concepts. Graphs: Best at
  showing broad relationships at a glance. Animations: Best at showing temporal
  relationships. Interactives: Best at showing processes, systems, models."
- Muller: animations "are fleeting … since the parts are animated for you you don't have to
  mentally envision how the parts are moving … sometimes static graphics perform better than
  animations." A stepper the reader only watches is close to an animation.

### Make the controls the principle's own operations
The best centrepiece is an object the idea lives in, which the reader can keep thinking
with: its controls are the operations the principle talks about. Build it as a small world
in which one idea is exact and everything it needs is defined inside it.
- Nielsen: "any deep principle is an opportunity to create powerful interface ideas … What
  new objects and new operations does a principle suggest?"
- Papert's microworld criteria include "all needed concepts can be defined within the
  experience of that world."
- Page: a 64-bit vector whose rank directory updates as the reader flips bits; a byte stream
  the reader types into and watches LZ77 parse. Test: could the reader ask this object their
  own next question?

### A small toy, priced at real scale
Some toys cannot keep the hard part hard at their own size: at 64 bits, a rank directory's
counts cost as much as the data. Then split the frame. The toy shows the mechanism, and a
second panel computes the cost for a realistic size (2^32 bits). The caption says which panel
to read costs from.

## The default state

### The first frame already teaches
Start every interactive in a state that makes the point with no interaction. This serves
skimmers, print, Present mode and readers without JavaScript.
- Patel: "I try to start all my interactive diagrams in a state where it's informative
  without interaction." For a process diagram, the informative initial state may be the
  solution.
- Victor: "the filter description works as a static explanation -- it can be read like
  normal text." The interaction is for the reader who wants to go deeper.

### Show all the variants when the reader must compare
Comparing from memory is a memory test. When the reader must compare states (before and
after an insert, three encodings of one string), show them side by side in one fixed frame.
Use a stepper when the reader must follow a process.
- Patel: "It's often better to show all the variants than to ask the reader to interact with
  the diagram to see the variants." His order of preference: "show all > show interactivity
  > show less".
- Tufte: "constancy of design puts the emphasis on changes in data, not changes in data
  frames" (secondary quote).
- Page: `<bh-versions>` in Compare mode, or small multiples with identical layouts.
- Tie-break with "the reader is the mechanism" (below): when the point is that the reader
  should try and fail, let them try first, then show every variant in the reveal. When there
  is nothing to try by hand, the table of variants is the whole job and no interactive is
  needed.

### One centrepiece, staged across sections
The house allows one centrepiece, but a page may need it in several sections. Keep it where
the core idea is. Unlock its later controls when the page reaches them, and give the later
sections a small static copy of the state they discuss (or a link back that lands on the
figure), so the reader never has to scroll up to compare. Present mode already shows a
figure from another slide alongside.

## Guiding the reader through an interactive

### Say what to do and what to look for
The sentence before an interactive names one manipulation and what the reader will see.
After it, "notice" points at the consequence, which often becomes the crack.
- Ciechanowski, *Mechanical Watch*: "In the demonstration below, we're holding the barrel
  tight, and you can turn the arbor by dragging the slider:" then "Notice that as soon as you
  let go of the arbor by releasing the slider, the mainspring will turn the arbor right back.
  This is less than desired…"
- Patel, A*: "Try opening a hole in the wall in various places. You'll find that when Greedy
  Best-First Search finds the right answer, A* finds it too".

### A control only once its meaning is known
Introduce each control in prose, with its meaning and unit, before asking the reader to
move it. A label that says what a number means is not help text; it is a label.
- Victor: "I have always proposed adjustable numbers in a context where the adjuster already
  understands the meaning of the number." And: "It's tempting to think of this as 'inline
  help', but it's not help -- it's simply labeling."
- Ben Eater (on game design): "If you need a tool tip, you failed."

### Limit the state space
The author knows how to drive the interactive; the reader does not. Lock every control but
one, at values known to be good, and unlock the others as the page reaches them. Teach two
mechanics separately before combining them.
- Patel: "the state space is vast, and you the writer know how to navigate … but the reader
  does not". "Main solution is to limit state space". "Also give instructions".
- Starmer, *Gradient Descent, Step-by-Step*: "for now, let's just plug in the Least Squares
  estimate for the slope, 0.64", then free the intercept alone.
- Case: "teach [mechanics] in isolation first before combining them": A alone, B alone, then
  A+B.

### Point first, then the sweep
Trace one input through the whole mechanism, then let the reader sweep the input and draw
the curve. Turn a sudden event (a button) into a continuous control (a slider), to expose
where the behaviour changes.
- Starmer traces dosage 0 through every weight of a small network to one output point, then
  "plug in dosage values all the way to 1" to draw the curve.
- Mould, *The Spring Paradox*: instead of cutting the rope, "If I were to slowly extend the
  blue rope", which shows the weight go down, then up, as the ropes go taut.

### An extreme preset
After the reader has seen a property hold on ordinary input, offer one preset that pushes
it to the extreme, where a hidden flaw becomes obvious.
- Holmér, on arc length: "pushing it to the extreme the differences in point spacing will
  become very apparent".

## Centrepieces that teach

### The reader is the mechanism, then the page automates it
State the constraints the system must satisfy. Give the reader the control to satisfy them
by hand, with a target. Then show that the real system turns that control itself, and how.
- Ciechanowski, *Airfoil*: after two stated principles, "I created an artificial pressure
  field in that frontal region, you can control it using the slider". Then "in nature this
  process happens on its own … This mechanism is self-balancing."
- Alammar: "Can you get an error value below 799?", then "Congratulations on manually
  training your first neural network! Let's look at how to automate this".
- Case & Hart, *Parable of the Polygons*: "drag & drop unhappy polygons until nobody is
  unhappy", then "unhappy shapes automatically move".
- Page: let the reader choose the superblock size against a space and time budget, then show
  the standard choice and why it falls out.

### Ablation: switch one part off
Give the reader a switch that removes one component of the real algorithm and shows what
breaks. A good toy reproduces the real system's failure under the same switch.
- Welch Labs: "if we remove the line of code that adds noise at each step of the generation
  process, we end up with a tiny sad blurry tree." The 2-D toy then fails the same way: "In
  the space of images, averages look blurry."
- Page: a DEFLATE playground with "lazy matching" or "Huffman stage" toggles, each showing
  the output size change.

### Diagnostic views: show the defect before naming it
Give the reader an instrument that makes an invisible defect visible before the theory
names it. Show raw observations before interpreting them.
- Holmér, *The Continuity of Splines*: the joins look smooth, but "if we change the
  background to these dots, it becomes even clearer" that there is a seam in the reflection.
  Curvature comes after.
- Ben Eater wires an Arduino to the address and data lines, prints one line per clock pulse,
  says "honestly i'm not really sure what's going on here", and only then decodes it.
- Page: show the raw bitstream first, let the reader stare at it, then decode it.

### Measure the real thing; the gap is content
Run the real implementation against the theoretical number and explain the difference.
- Mould: the siphon breaks at 10.07 m, not the textbook 10.33 m; the gap is the vapour
  pressure of water.
- Page: the real compressor's output size beside the entropy bound, with the residue
  accounted for.

## Steppers and persistent figures

### The graphics have slides in them
Within one subject, keep one figure and step it through its states, rather than swapping
in a new figure. Drive it from the real model, so every frame in between is a valid state.
Change one thing per step.
- Wittens: "the slides shouldn't have graphics in them, rather, the graphics should have
  slides in them. The diagnosis of PowerPoint syndrome is then the constant trashing of
  context from one slide to the next."
- Wittens: animating "the actual models themselves, instead of doing a visual morph from A to
  B. Each animation became a continuous stream of valid examples".
- Split a compound operation into visible sub-steps. Wittens's Julia page: "First we square
  each number…", "Next, we reset the grid back to neutral", "Now we add c to each point".

### Leave a trace of earlier states
When a stepper advances, the state the next step depends on must not vanish: grey out the
previous position, keep a running table of outputs, show consumed bits as consumed. Allow
stepping back.
- Victor: "she's peeking through a pinhole, only seeing a single point in time at any
  instant." His fix: "all frames are lightly overlaid, in order to give context to the active
  frame."
- Sweller (transient information): information that disappears forces the reader to hold it
  in working memory.

### Remove scaffolding out loud
A step may remove construction lines that have done their job, and its text says so.
- Holmér: "for clarity let's just remove the middle line it's getting in the way".

### Crack the picture, not only the idea
When the current picture hides the mechanism, say so and switch pictures, or run the
process backwards.
- Wittens: "by picturing numbers as points, it's not clear how they act upon each other … A
  better solution is to represent our numbers using arrows instead". And: "it's very hard to
  see what's going on while iterating forwards … So we're going to go backwards instead."

## Words in and around figures

### Labels in the figure, text with the state
Put each label next to its part, not in a legend. Put a step's text with the state it
describes, in the same step. When prose explains a figure part by part, keep the figure on
screen with that prose, repeating a cropped copy if needed.
- Mayer: "People learn better when corresponding words and pictures are presented near
  rather than far from each other". An independent meta-analysis finds g = 0.63. The effect
  is largest when neither picture nor text makes sense alone.
- Tufte: figures "are usually not substantively separate from the text; so they need not be
  divorced from the text".

### Step text presents meaning; it does not narrate motion
A caption or step says what the step means for the argument and where the reader now
stands, not what moved. Give each step its reason.
- Thomas & Turner: the classic writer is not "a videocamera, a conduit passing salient and
  canonical features of what he perceives".
- Knuth on literate programs: "A play-by-play account of an algorithm, a simple stepping
  through of the process, does not qualify. We are trying to convey an intuition."
- Hutton annotates every step of a calculation: `double 3` → `{ applying double }` → `3 + 3`.
- Page: not "the pointer moves to index 3; the counter increments", but "the counter now holds
  rank(3), so only one word is left to scan (by the block count)".

### One colour vocabulary, spent on one concept per step
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

### Each arrow style means one thing
Arrows can mean data flow, a pointer, "becomes", "calls" or "is followed by". Use one meaning
per line style in a figure, and say in the caption what an arrow means.
- Tufte: links and arrows "bring with them many implicit but powerful assumptions".

### Say what a schematic's scale is
When a figure draws 512 numbers as four boxes, say so.
- Alammar: "the embedding vector (512, or 4 boxes in the figure)".

### Say what you changed in the figure, and why
When a figure takes a liberty (a transparent rim, a rotated map), name it and its purpose.
This complements saying what the figure does not show.
- Ciechanowski, *Bicycle*: "I made the rim semitransparent, so that you can see how these parts
  interact."

## Codewalks

### Knuth's rules for walking code
- About a dozen lines per step: "A dozen lines of code is about the right length for a
  module."
- Steps in the order the designer decided things, not file order: "use the same order in
  which the creator of the program found himself making decisions about them."
- The normal case first; edge and error handling as their own step.
- Prose names equal the code's identifiers: "The words used in the documentation should match
  the words used in the formal program."
- Step text gives the intuition and the goal state, never a line-by-line narration.

### Show the data each line computes
Next to each walked line, show the value it produced on the running example.
- Victor: "If a line of code computes a thing, that thing should be immediately visible."
  And: "It is not enough to just show the data. We must show comparisons."

### Shape before code
Show the data's shape (a type, a diagram of the layout) before the code that processes it.
Then the code's structure follows the data's shape, clause by clause.
- HtDP: "we should let data drive the syllabus". Krishnamurthi: "recursive data suggest
  recursive solutions".

### The naive version stays as the oracle
Keep the slow, obvious version. Show every faster version agreeing with it, ideally live on
the reader's input.
- Karpathy computes one quantity three ways (a loop, a matrix multiply, a masked softmax) and
  shows them equal; in micrograd, every derived gradient is checked by nudging the input.
- Hutton's Countdown keeps the brute-force program and proves the fast one equal to it.
- Page: "same answer, 14% of the work".

## The sandbox goes last

### Guided pieces first, the open playground at the end
Before the end, every interactive answers the page's question. An open playground with
every control comes last, built from parts the page has already introduced one at a time,
with an honest note on what the simulation ignores.
- Victor: "Most interactive widgets dump the user in a sandbox and say 'figure it out for
  yourself'. Those are not explanations."
- Case: "put the full 'sandbox mode' at the end of the explorable, and everything leading up to
  that just introduces bits and pieces of the sandbox." Of a sandbox shown first: "for me,
  it's information overload."
- Sam Rose ends *Load Balancing* with: "My simulations here ignore some real life constraints
  (server slow start, network latency) … I leave you with a version of the simulation that
  lets you tweak most of the parameters".

### Give it a question, a goal and suggested experiments
Even the final playground needs a specific question and an answer to compare against:
unassisted discovery loses to explicit instruction, while guided discovery wins. Suggest
values to try, including ones that break things.
- Alfieri et al. (2011): unassisted discovery d = −0.38; enhanced discovery d = +0.30.
- Julia Evans (paraphrased from her integer.exposed and Mess with DNS posts): offer
  tutorial, useful and "weird" experiments, because she learns more from seeing what happens
  when things go wrong.
- Papert: activity in the microworld should matter. A goal ("make the directory smaller than
  10% of the vector") gives it one.

## In this repo

| Component | Rules that apply |
| --- | --- |
| `<bh-playground>` | default state teaches; controls introduced and labelled first; one control unlocked at a time; by hand, then automated; ablation switches; the final open one goes last |
| `<bh-stepper>` | one persistent figure; one change per step; step text presents meaning and reason; trace of earlier states |
| `<bh-versions>` | side-by-side comparison in a fixed frame; naive version labelled as such |
| `<bh-codewalk>` | Knuth's rules; values beside lines; shape before code |
| `data-ref` | the hover link from prose to part; one colour vocabulary is the link that survives print and no-JS |
| `figcaption` | what to notice, what not to read into it, what each arrow means, any liberty taken |
