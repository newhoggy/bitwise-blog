# Teaching moves, with examples

Each move has the rule, how it looks on a page of this blog, and a verbatim line
showing it done: from a 3Blue1Brown video (by YouTube id), or from another source,
named (details and links in [sources.md](sources.md)). Headings match SKILL.md.
Search with `grep -n "^### " references/moves.md`.

Sentence-level moves are in [sentences.md](sentences.md); figure and interactive design
is in [figures-and-interactives.md](figures-and-interactives.md).

## Contents

- The core loop
- Promises
- Opening
- Ordering and pacing
- Examples and numbers
- Formulas, notation and names
- Misconceptions and surprise
- Visuals
- Checks for the reader
- Endings
- Voice

## The core loop

### Concrete to abstract
Several instances first, so the formula names a pattern the reader already half-holds.
- Page: two or three worked blocks, then the general rule as a sentence, then the symbol.
- "try very hard to structure your explanation to go from the concrete to the abstract. I think almost always when you understand something the natural inclination is to go the other way around." (ojjzXyQCzso)
- "it arrives only once it's articulating something that already exists at least loosely in the viewer's mind, making it much easier to parse." (cDofhN-RJqg)

### Sources of the naive attempt
The reader's guess, the textbook story, a rule of thumb, an estimate, or your own simplified model.
- Textbook story: "So that is the standard explanation, and it's not wrong per se, it's just that all of the key components are handed down from on high." (KTzGBJPuJwM)
- Your own simplified model: "often the best route to making it understandable is to start off by being a little bit wrong" (Agbh95KyWxY)
- Rule of thumb that works in one regime, then a change of units makes it exact: "This rule of thumb turns into a precise mathematical fact as long as we shift away from talking about probabilities to instead talking about odds." (lG4VkPoG3ko)
- Page: for Huffman, the naive attempt is a flat fixed-width code; for rank, scanning and counting.

### A crack that points at the fix
Show where the attempt loses, so the fix is guessable.
- "this framing feels a little bit more productive because you can see a little bit more clearly where it's inefficient." (Nbwv5wHQoj0)
- "As a first pass let me show you an idea that's wrong but in the right direction." (jBsC34PxzoM)
- Page: one figure highlighting the cases the attempt misses, reused for the fix (`<bh-versions>` or a stepper).

### Discovery fiction where the design looks arbitrary
- "This genre of discovery fiction, I think works especially well when you have topics that seem like they have a lot of arbitrary or unexpected choices along the way." (6a1fLEToyvU)
- "This parable does not actually portray the historical trajectory of discoveries" (XFDM1ip5HdU)
- Page: DEFLATE's length codes plus extra bits, rebuilt as attempts that each fix the last one's waste.

### Hard way before the slick way
Show (or sketch) the computation a clever trick avoids, or the trick is under-appreciated.
- "it's easy to underappreciate her result unless we dig into the details of what it is that she manages to avoid" (ltLUadnCyi0)
- Page: the O(n) rank scan before the rank directory; brute-force numbers in a `.metrics` tile.

### Label the naive attempt where it appears
A reader who skims sees the naive version and may never reach the crack. Mark it as
provisional in its heading, caption and version label, not only in the paragraph that breaks it.
- An unrefuted wrong model feels just as well understood: viewers of a video presenting
  misconceptions as correct "developed an equal belief of understanding, but more
  misconceptions and fewer scientifically correct conceptions" (Kulgemeyer & Wittwer, 2022).
- Julia Evans lists "explaining the 'wrong' way without saying it's wrong" among her patterns
  of confusing explanations (paraphrased).
- Page: `h2` "A first try: scan and count"; caption "naive version: this breaks at 2^20 bits".

### Abstraction from aligned instances
Set two or three near-identical instances side by side, mark what varies, turn each varying
slot into a parameter, then rebuild every original from the abstraction.
- HtDP 15.1: "We start from two concrete definitions; we compare them; we mark the
  differences; and then we abstract."
- *Haskell Programming from First Principles*: from `(1 + 2) * 3`, `(4 + 5) * 3` and
  `(10 + 5) * 3`, "The common pattern is the * 3 bit. The part that varies is the addition
  expression before it, so we will make that a variable."
- SICP 1.3.1 writes the template between the instances and the abstraction:
  `sum-integers`, `sum-cubes` and `pi-sum`, then a pattern with `<term>` and `<next>` slots.
- Page: `rank` over three block sizes in a `<bh-codewalk>` with the varying constant marked;
  a fold from `sum`, `product` and `length`.

### Back down the ladder
After an abstract claim, come back down to a concrete instance: "in our example, …". Every
point on an abstract chart should open the instance behind it.
- Victor: "In real life, you would never use a ladder that only let you go up. Likewise, when
  creating abstractions, stepping down is as important as stepping up."
- Olah, *Understanding LSTM Networks*, after each gate: "In the example of our language model,
  we'd want to add the gender of the new subject to the cell state".

### Discovery fiction for a type
A type signature can be built like a design: start from the type that captures the idea,
and give each added component one concrete need. Generalise last.
- Hutton, *Functional Parsing*: `String -> Tree` is "not sufficient to program with";
  chaining needs the rest of the input (`String -> (Tree, String)`); failure needs a list
  (`String -> [(Tree, String)]`); then `Tree` becomes `a`.

## Promises

### Flag a simplification, bound it, return to it
- "Kind of, this is a little bit of a lie, but it's in the direction of truth." (spUNpyF58BY)
- "You should know there is that added bit of complexity that I'm postponing, but this is 90% of the right idea." (RQWpF2Gb-gU)
- Return: "Okay, I need to confess that what I've said so far is not quite right." (Ip3X9LOh2dk)
- Name the consequence: "Without it, this whole explanation would seem to imply that light always passes through every material" (KTzGBJPuJwM)
- Page: "for now, read codes most-significant bit first; [the real order](#bit-order) comes later." Give a simplified construct its own name ("the almost-Fourier transform") so the real name stays free.

### Admit an unguessable step, then pay it back
- "Who ordered another dimension? And I'll admit, it's not terribly motivated right now, other than to say, watch what happens when we just try it." (cy8r7WSuT1I)
- "what can look like genius is usually the residue of experience. Insights don't come from nowhere." (Nbwv5wHQoj0)
- Either prime the leap with a warm-up that shares its insight, or admit it and, after the payoff, show what experience would suggest it.

### Plant early, call back by name
- "another principle, implicit, is that the seeds for dramatic action should be planted early." (IQqtsm-bBRU)
- "That's a fact I'd like you to tuck away, we'll return to it later." (EK32jo7i5LQ)
- Page: give the planted fact an `id` (a `data-linkable` callout or a caption sentence); at the payoff, restate it in a clause and `data-ref` back.

### Defer out loud
- "You might naturally wonder where on earth does this grid come from, but I actually want to postpone that question and skip ahead to step three" (ldxFjLJ3rVY)
- Page: one sentence in the prose plus a forward link, or "not covered here" with the search term.

### Black-box by contract
- "I won't go into the details of how exactly both these functions work, but the idea is that it should be completely infeasible to find a valid signature if you don't know the secret key." (bBC-nXj3Ng4)
- "I don't think it would add much clarity, in the same way that knowing the logic gates that implement addition don't really teach you much about how to add two numbers." (Dlsa9EBKDGI)
- Page: on a DEFLATE-format page, black-box match finding: "the encoder found length 7 at distance 12".

### A model is a rung, retired by running it
Say what the current model is for (thinking, not implementation), that more models will
follow, and which feature will break it. When it breaks, run it on the case and show the
wrong answer, then quote the old rule before replacing it.
- SICP 1.1.5: "The purpose of the substitution is to help us think about procedure
  application, not to provide a description of how the interpreter really works … we will
  present a sequence of increasingly elaborate models".
- SICP 3.1.3 runs the substitution model on `make-simplified-withdraw`: "This gets the wrong
  answer." 3.2 opens by quoting the 1.1.5 rule verbatim before replacing it.
- Page: "for now, think of rank as a scan; this model breaks when we ask for it a million times".

### Where each claim stands
Tell the reader the status of every non-obvious statement: shown here, shown later (a
promise), referenced, asserted without support, or unknown.
- Halmos: "Whenever you tell him something, tell him where it stands: this has been proved,
  that hasn't, this will be proved, that won't." "Complete honesty makes for greatest clarity."
- Page: "We won't prove the o(n) bound; [the paper](…) does. The constant we measure below."

### Use it before you build it
Write with the operations you wish you had, so the reader sees why the interface is shaped as
it is, then implement them.
- SICP 2.1.1: "Let us begin by assuming that we already have a way of constructing a rational
  number … We are using here a powerful strategy of synthesis: wishful thinking."
- Page: "Assume `rank1(i)` exists. Here is `select` built from it. Now: how do we make
  `rank1` O(1)?"

## Opening

### A concrete hook, significance at the end
- "Motivation is critical, but it doesn't have to take long, and often what actually keeps the viewer engaged is to get right to the point and leave any commentary about broader themes and connections to the end." (cDofhN-RJqg)
- "If you can, motivate using clear examples, not sweeping statements or promises of what is to come." (cDofhN-RJqg)
- Forms that work: a puzzle; a surprising number; a preview of the finished result ("this right here is what we're going to build to"); the popular wrong answer stated and broken.

### Spoil the what, protect the why
- "spoiler alert, the derivative is in fact the cosine of theta, but aren't you a little curious about why it's precisely cosine of theta?" (S0_qX4VJhMQ)
- "before I do, I want to lead with a spoiler, which is the fact that the way we're going to solve this involves the use of complex numbers." (bOXCLR3Wric)
- "Often in math you should view the definition not as a starting point, but as a target." (O85OWBJ2ayo)

### A specific promise, answered at the end
- "For example, here's the kind of question I want you to be able to answer by the end of this video." (zeJD6dqJ5lo)
- Page: a TL;DR bullet poses it ("by the end you can price a rank directory in bits"); the last `h2` answers it with the page's own numbers.

### Gloss the title term at once
- "So first of all, this word holomorphic might seem a little weird." (LqbZpur38nw)
- Delay only the terms the reader will reason with; decorative jargon can be named early as "the fancy name".

### Name the reader
- "to be fair, omitting certain fundamentals is the correct choice for the target audience." (6a1fLEToyvU)

## Ordering and pacing

### Reformulate, then defend it
- "You might complain that this all feels like stating the same question just in more complicated language, but where it really starts to feel qualitatively different" (IQqtsm-bBRU)
- "Now I can hear some of you complaining, haven't we just replaced one tricky setup with another?" (brU5yLm9DZM)
- Page: the reformulation gets its own `h2`, a two-panel figure with matching parts linked by `data-ref`, then a `.callout` restating the new problem on its own.

### Signpost the key step
- "Alright, hang with me now, because this is the key observation of the whole video." (yuVqxCSsE7c)
- Once per page. Readers cannot otherwise tell the load-bearing step from bookkeeping.

### The one thing to hold; what doesn't matter
- "If this feels a little bit confusing, that's totally okay. There are kind of a lot of layers at play here. Just remember, each pixel on the right corresponds to a unique polynomial" (LqbZpur38nw)
- "Now the details don't matter too much, the one thing I want you to notice is that this is not a linear relationship." (VYQVlVoWoPY)
- "But you almost don't really care. The point is that it's just some number." (d_qvLDhkg00)
- Page: name the dropped constant `c` in the text and put its value in a `.sidenote`. Header bits, padding and off-by-ones bury the point on bit-level pages.

### Recap the facet you need
- "even if you are familiar with binary, I want to explain it with a focus on the rhythm of counting, which you may or may not have thought about before." (2SUvWfNJSsM)
- Page: recap binary as "how much of the code space a length uses up", not as place value.

### Conventions justified by the failure they prevent
- "You wouldn't want to run into the ambiguity where you don't know which pivot to switch to." (M64HUIJFTZM)

### Dead ends in one sentence
- "If I was going to give you an honest portrayal of the problem solving journey, that would have me showing you all of those dead ends. It would also make this something like a 9-hour video." (Nbwv5wHQoj0)

### Declare the boundary between idea and engineering
Tell the reader which part is the idea and which is only there for speed.
- Karpathy, on micrograd: "these 100 lines of Python, are everything you need to understand
  how neural networks train. Everything else is just efficiency."
- Page: "Everything after this section changes how fast rank runs, not what it returns."

### Re-view earlier sections from the new concept
When a new concept arrives, re-run the earlier sections' examples through it and recompute
their numbers. That is stronger than a recap, which only restates.
- Halmos: "review Section 1, as nearly completely as possible, from the point of view of
  Section 2 … It works, it works like a charm."
- Page: when `select` arrives, run the bit vector from the `rank` section through it.

### Keep interesting extras out of the mechanism
Anecdotes, history as colour and fun facts cost the most for beginners. Move them to a
`.sidenote` or after the payoff. History that explains why a design looks the way it does is
part of the mechanism; history as colour is not.
- Seductive details: g = −0.33 over 68 effects, worse for learners with no prior knowledge
  (Sundararajan & Adesope, 2020, via a summary).
- Muller's study added "interesting information" to an exposition; it did not help.

## Examples and numbers

### Concrete values, finite first
- "I always think that it's helpful to think of x as starting at some actual concrete number, maybe 1.5 in this case." (YG15m2VwSjA)
- Page: run the rule on one real 16-bit block before stating it; a playground starts at a visibly coarse setting the reader refines.

### Counts beat rates
- "somehow phrases like 40 out of 100 kick our intuitions into gear much more effectively than 40%, much less 0.4" (HZGCoVF3YvM)
- Derive the formula from the counts and show the population size cancelling: "that was just an arbitrary choice made for the sake of illustration." (HZGCoVF3YvM)

### A toy that teaches a false model
The Grover postmortem: viewers concluded the oracle already knew the answer, because the toy made it look that way.
- "I suspect the real cause of confusion originates not from a lack of low-level detail, but from how I had framed the entire setup." (Dlsa9EBKDGI)
- "this is almost certainly exacerbated by me briefly flashing an example function that just checks if the input is 12" (Dlsa9EBKDGI)
- Fix the toy (he moved to a Sudoku verifier), not the detail level. Ask what a literal reader would infer from it.

### Representative before flashy
- "It's very tempting to open up with the image processing examples, since they're visually the most intriguing, but there are a couple bits of finickiness that make the image processing case less representative" (KuXjwB4LzSA)
- Page: LZ77 on plain text with repeats, not PNG data.

### The reader's input as the running example
- "The content of the article is centered around the particular sequence that you, the reader, created" (cDofhN-RJqg)
- Grant notes this is nearly impossible in video. It is a web page's unique advantage: the reader's own text to compress, their own bit string to rank.

### Size ladder, and one more step
- "let's knock things down to the simplest case that we can that still has any kind of meaning to it" (wTJI_WuZSwE)
- "Alright, you might see where this is going, but I want to walk through this for just one more step" (d-o3eB9sfls)
- Scaling back up: "But honestly, not that much changes when we give the layers multiple neurons, really it's just a few more indices to keep track of." (tIeHLnjs5U8)

### Big numbers, felt
- "What's nice about that split is that 2 to the 32 is 4 billion, which is at least a number we can think about." (S9JGmA5_unY)
- "it's sort of like it's saying there's as much variation and uncertainty in what's about to happen as if there were 64 equally likely outcomes." (v68zYyaEmEA)
- Page: next to any entropy H, show "≈ 2^H equally likely choices"; turn "o(n) extra bits" into a real overhead for a billion-bit vector.

### One benchmark, every version
- "By the end of the simulation, the average score works out to be about 4.124" (v68zYyaEmEA), then 3.6 for version two, with a bound below which no algorithm can go.
- Page: one file through raw bytes → fixed Huffman → dynamic Huffman → LZ77 + Huffman → entropy bound, as a `.metrics` row or a `<bh-chart type="bar">` that grows section by section.

### Arithmetic that remembers where it came from
- "don't collapse things too soon. Try to let your notation have a memory for where things came from because sometimes that helps see overall patterns." (QvuQH4_05LI)

### Invented examples, labelled
- "To be clear, I'm making up this example of adjectives updating nouns just to illustrate the type of behavior that you could imagine an attention head doing." (eMlx5fFNoYc)
- Page: caption a toy schedule "illustrative" so it is not read as a measurement.

### What else the example costs
Count what else the example makes the reader learn: a domain, a puzzle, some maths. Reject
it if that competes with the concept, or if the reader already solves it better another way.
- HtDP's authors on SICP: students "must spend a considerable effort on the domain knowledge
  and often end up confusing domain knowledge and program design knowledge."
- Krishnamurthi on Towers of Hanoi: "if you don't tell students the (recursive) solution …
  you haven't given them a programming problem: you've given them a puzzle." On factorial,
  students who already wrote loops ask "Why should I do this again?"
- A toy that shows only the *shape* of a process is fine if labelled as one. SICP 1.2: "Their
  role is like that played by test patterns in photography". It must not serve as the need.

### Name the simplification you decline
List the simplifications you make, and the tempting one you refuse because it would remove
the essential difficulty.
- Hutton, *The Countdown Problem*: "we do not abstract from the non-zero naturals to a richer
  numeric domain such as the integers or the rationals, as this would fundamentally change the
  computational complexity of the problem."

### Real data before cooked data
Prefer a real sentence, a real file's bytes, a real codebase's case to an invented sample. It
carries quirks a cooked toy hides.
- Knuth: "it is better to use 'real' data than 'sample data' that have in fact been cooked up
  solely to use as an example."
- Julia Evans found her sorting example by searching her own code for `sort.+key`: most sorts
  were by time (paraphrased from "Write good examples by starting with real code").

### Varied cases once the model holds
One running example builds the model. Once it holds, two or three deliberately different
worked cases help it transfer. Varying earlier adds load (the variability effect, Sweller).
- Page: after the running bit vector, a sparse one and a dense one, each a short worked case.

### Specialised types first
For FP pages, type generality is one more abstraction to delay: `length :: [a] -> Int` before
`Foldable t => t a -> Int`, and `map` defined by hand before the library's.
- Hutton, *Programming in Haskell* preface: "in the beginning most of the functions that are
  used are specialised to simple types, and later on we see how many functions can be
  generalised to larger classes of types".

### "You've already been using it"
Show that something the reader knows is an instance of the new concept. It produces
recognition, and lowers the threat of an abstract name.
- Milewski, *Functors*: "We've seen examples of such mappings, maybe without realizing that
  they were just that."

## Formulas, notation and names

### Notation as shorthand, with commentary
- "So while this equation is a theorem for real numbers, it's a definition for more exotic inputs. Cynically, you could call this a blatant abuse of notation." (O85OWBJ2ayo)
- "What we write as e to the t is a bit of notational disaster, giving the number e and the idea of repeated multiplication way more emphasis than they deserve." (v0YEaeIClKY)

### Decode the memorised formula against a picture
- "Now out of context, presented as a rule to remember, I think this would feel pretty strange, don't you? But when you actually think of this adjustable box, you can see what each of those terms represents." (YG15m2VwSjA)
- "each one of the terms has a very clear meaning that you can just point to on the diagram." (3d6DsjIBzJ4)
- Page: wrap each term in a `data-ref` to its region of the figure.

### Read the formula, triaged
- "a common way to write it involves this pile of constants that you don't really need to worry about. The important factor I want you to notice" (aXRTczANuIs)

### A formula is a design
- "Now when people think about math and formulas, they don't often think of it as a design process." (lG4VkPoG3ko)
- Page: rank as a block count plus a popcount; a DEFLATE length as a base plus extra bits. Use `.compare` for two forms and say which the page uses from here on.

### Clearest names, then a bridge to the convention
- "This is not the conventional naming, but I'm going to call this the value down matrix." (eMlx5fFNoYc)
- "It's one of those details that runs the risk of distracting from the main conceptual points, but I do want to call it out just so that you know if you read about this in other sources." (eMlx5fFNoYc)

### When the formula is the mystery
- "don't worry, in a moment we're gonna unpack and visualize what each one is really saying" (851U557j6HE)

### Name late, except a handle
Hold the idea's name until the reader has the idea. Name early only what the prose will use
often: a part the mechanism keeps referring to. Introduce that handle with its plain meaning,
ideally on a labelled figure. A part that is itself the fix is not a handle: on a rank page
the superblock answers the crack, so it waits.
- Mayer's pre-training principle (median d = 0.75) concerns exactly such parts: learners do
  better on a complex mechanism "when they know the names and characteristics of the main
  concepts".
- A famous name can also give away a prediction. Case renamed Tit For Tat to Copycat because
  "a lot of the public have already heard about Tit For Tat, so if I used that name, players
  might just place their bets on this character".
- Page: "word", "popcount" and "block" early, on the layout figure; "superblock" and "rank
  directory" only after one level of counts has cracked.

### Several notations, one reading
When the reader knows the idea in other notations, bridge to all of them at once, flag the
one that runs in a different direction, and give a phrase for reading it aloud.
- Milewski shows composition as Unix pipes, F# `>>`, `g∘f` ("read g∘f as 'g after f'") and
  Haskell `g . f`: "Notice the right to left order of composition. For some people this is
  confusing."

## Misconceptions and surprise

### Diagnose the misconception
- "We might call this a veridical paradox, which refers to facts that are provably true, but which nevertheless can feel false when phrased a certain way." (lG4VkPoG3ko)
- "I think it's healthiest for you to think of this slope not as some instantaneous rate of change, but instead as the best constant approximation for a rate of change around a point." (9vKqVkMQHKk)
- Confusion is the right reaction: "If that feels strange and paradoxical, good! You're grappling with the same conflicts that the fathers of calculus did." (9vKqVkMQHKk)

### Expectation before surprise
- "You can't just randomly modify an integral like this and expect nothing to change." (851U557j6HE)
- "Naturally, you can guess what might come next, but would you bet your life on it?" (YtkIWDE36qU)

### A broken pattern: both halves
- "it's also not a coincidence that you seemingly randomly hit another power of two a little bit later on the tenth iteration" (YtkIWDE36qU)
- Put the `details.predict` just before the break.

### The nearest case where it fails
- "Does the fact that we're thinking about a square face and not some other shape matter? No, not really. Does the fact that the transformation is linear matter? Yes, absolutely." (ltLUadnCyi0)
- Page: a prefix code beside a non-prefix one; a static bit vector beside one with an insert.

### A wrong argument beside its valid twin
- "This time the result is valid, but why is it not okay to do what we did with the spheres, but somehow it is okay to do this with the pizza slices?" (VYQVlVoWoPY)

### State the wrong model in full, then break it
Where readers arrive with a folk theory, refuting it is the lesson. State the wrong model as
a fluent mechanism, not a one-line "some people think", then show the case where it fails.
- Muller: after a "clear, concise" exposition, scores moved from 6.0 to 6.3 out of 26 and
  confidence rose. A version that voiced the misconception and then refuted it "nearly
  doubled" scores, though viewers called it "confusing".
- In print, a refutation paragraph is enough: refutation text and dialogue both beat
  exposition (d ≈ 0.8; Muller et al. 2008, effect sizes from search snippets).
- Only for misconceptions the target reader actually holds. A myth they don't hold is a
  distraction: Ciechanowski's *Airfoil* builds the right model and leaves the popular lift
  explanations to Further Reading.

### Demote the wrong primary cause
When the folk explanation names the wrong main cause, say so, build on the right one, then
bring the demoted factor back in its true role.
- Mould: "First, forget about atmospheric pressure entirely. We'll bring it back later, but
  it's not foundational to how siphons work … siphons are driven by gravity."

### Rescue the true kernel
A viral wrong explanation usually wraps something real. Say what is wrong, then recover the
genuine structure behind it.
- Mathologer on −1/12: "state clearly what's wrong with it, how to fix it, and how to reconnect
  it to the genuine maths".

### A non-example that passes the surface check
Show something that satisfies the obvious rule but breaks the real one, and ask why.
- Yorgey's Typeclassopedia: an "Evil Functor instance" that "typechecks, but it violates the
  functor laws. Do you see why?"
- Page: a rank directory that type-checks and double-counts the block boundary.

### Your aha is not their explanation
The analogy that finally clicked for the author is the residue of the author's struggle with
details. Handing over the analogy with the details stripped makes learning harder. Ship the
examples that produced the intuition; give the analogy at the end as a summary.
- Yorgey's monad tutorial fallacy: "failing to recognize the critical role that struggling
  through fundamental details plays in the building of intuition." A symptom: "look, it's
  really quite simple".
- Offer several intuitions, say where each fails, and keep returning the reader to the
  definition. Typeclassopedia: "a `Functor` is simply what it is defined to be".

## Visuals

### What the figure does not show
- "in case that left anyone with the impression that part of the algorithm was to choose that slice, let me be very clear, it's not." (Dlsa9EBKDGI)
- "even though that wave is being drawn in two or three dimensions, it's only describing the electric field along a one-dimensional line" (aXRTczANuIs)
- Page: a stepper that highlights the match must separate what the decoder knows at this step from what the figure reveals.

### Make the encoding unmistakable; labels apart from data
- "I really want you to make sure that it's clear what's being plotted, because everything that follows depends on understanding it." (EK32jo7i5LQ)
- "The elegance of having everything we're looking at be described in binary is maybe undercut by the confusion of having everything we're looking at being described in binary." (b3NxrZOu_CE)
- Page: small grey positions over bold data bits, said in the caption. Critical for code lengths that are themselves Huffman-coded.

### Figure concrete, prose general
- "the choice of what to show on screen when making general points is often a great opportunity to offer the viewer a concrete example to hold onto, but without wasting too much time explicitly talking about that example" (cDofhN-RJqg)

### Two pictures of one operation
- "The nice thing about the diagonal slice visualization is that it makes it much more clear that it's a symmetric operation." (IaSGqQa5O-M)
- Page: linked figures that share one control, or `<bh-tabs>` whose captions say what each view reveals.

### Analogies that survive the quantitative step
- "although it's a very visceral and memorable analogy, it's not like light has wheels, and it also tells you nothing about how to be more quantitative and derive the formula describing exactly how much light bends." (Cz4Q4QOuoo8)
- An analogy that needs the answer goes last: "it turned out to be just a terrible idea. The whole thing only really made sense if you already understood Grover's algorithm." (RQWpF2Gb-gU)

### Build visuals from the real computation
- "when those mismatch, that's actually what's most interesting, when it's not computationally viable to give a perfect illustration of what I'm describing" (QvuQH4_05LI)
- Show what the computer does: "So when I'm rendering these animations, that's exactly what I'm having the computer do." (r6sGWTCMz2k) Then walk the loop with `<bh-codewalk>`.

### Decode from the receiver's seat
- "really, you just need to look at an example bit stream from the robot's perspective and think it through." (l6DKRf-fAAM)
- Page: a `<bh-stepper>` over a bitstream, one step per bit, the caption listing what is still possible. Then add one bad codeword and show where it breaks. The natural centrepiece for a Huffman or DEFLATE page.

### 2D by default; honest timing
- "pedagogically you want it to feel like a blackboard. Only go up to 3D if you really need to." (rbu7Zu5X1zI)
- Ease animations, except when time in the animation represents real time or data.

## Checks for the reader

### Predict the magnitude
- "It'll spread more quickly, of course, but how much? It's actually very drastic." (gxAaO2rsdIs)
- Set the bar: the reader should reason well enough to reject every option when none is right: "you would be able to confidently come and say like, no, I'm quite positive that the correct answer is nothing that you've shown here" (QvuQH4_05LI)

### Transfer check after the mechanism
- "As a nice way to test whether you understood everything up to this point, see if just by looking at the direction of the diagonal slices on our tube, you can deduce" (aXRTczANuIs)

### Gut-check in the open
- "So always gut check your answer, have like two different perspectives that can give you a reasonability check." (QvuQH4_05LI)
- "any time you see a new formula in math, it's never a bad idea to just try it out on an example you know well." (FE-hM1kRK4Y)

### Simulate, then derive the number
- "A little programming can almost always let you cheat a little and see what the answer is ahead of time by simulating it." (8idr1WZ1A7Q)
- Page: a "sample 1,000" button draws a histogram; the exact curve is overlaid after the derivation.

### Hunch, then numbers
- "whenever you have a vague idea that feels productive, you should of course find a way to be more exact about what you're saying, but preferably put numbers to it, and then see if you can ask questions about those numbers" (M64HUIJFTZM)

### Commit to an answer
A prediction teaches when the reader commits to a concrete answer: an option, a number, a
shape. Word the `summary` so it asks for one and says a guess is enough. Aim it at the key
step, because the benefit stays with the content asked about.
- A preregistered meta-analysis of prequestions: guessing gave g = 0.65, only reading the
  question g = 0.22; the effect on the asked-about content was g = 0.54, on everything else
  g = 0.04 (St. Hilaire, Chan & Ahn, 2024).
- Yorgey: "Just go with your gut. After you have committed to a choice (say, by writing it
  down), then go get a calculator."
- Case on *You Draw It*: "By forcing you to put down your expectations, the real answer comes
  as a bigger shock."
- Page: `<summary>Seconds, minutes or hours: how long does the scan take on 2^32 bits? Decide
  before you open this.</summary>`

### Questions that tell models apart
A worked example or prediction teaches a rule only if the nearest plausible wrong model gives a
different answer on it. Build each wrong option from one named misconception, and say in the
reveal which misconception each option reflects.
- Wrenn & Krishnamurthi found a student test suite that accepted the correct median
  implementations, yet "its assertions are also valid for a different summary statistic:
  mean!"
- Prasad et al.: "We want a small number of mutants that each correspond to common problem
  misconceptions".
- Page: for bit order, a code whose MSB-first and LSB-first readings differ; never a
  palindrome.

### A near-twin after a miss
After the reveal, ask a second question that is the same underneath with surface changes
(names, constants). It checks that the correction transferred, not that the answer was
memorised.
- Lu & Krishnamurthi's SMoL Tutor asks a question "semantically the same as the first, but
  with superficial changes (e.g., variable names, constants, and operators are changed)".

### Answer each plausible guess
In the reveal, say why each likely guess was reasonable before correcting it.
- Case, *The Evolution of Trust*: "Makes sense, Copycat won the tournament last time, why not
  again?…"

### Say the insight, not only the answer
After a check, state the insight it was meant to reveal and give the reasoning, so a reader
who got the number right for the wrong reason finds out.
- Matuschak: "Will readers notice if they solved a problem but missed the insights it was
  supposed to reveal?"
- Pólya: "Let them learn proving", alongside "Let them learn guessing".

### Fade the worked examples
For a mechanism shown more than once: the first instance fully worked, the second with its
last step left as a prediction, the third done by the reader.
- Muller: "here's a problem and here's how you solve it. Here's a problem partially done and
  here's one for you to do from start to finish."
- Sweller et al. (2019) on guidance fading: "Past a certain point, studying worked examples
  may be counterproductive."

### Ask why after a worked step
After a step the reader watched, ask why that step was taken, then show the author's answer.
- Self-explanation prompts: g = 0.55 over 69 effects (Bisra et al., 2018, via the abstract).
- Page: after the stepper's match step, "Why does the decoder emit a literal here rather than
  a match?" in a fold.

### Graduated hints
For a harder exercise, nest the help: a general question, then a specific pointer, then the
answer. Each hint names a step the reader could have thought of.
- Pólya: the teacher should help "not too much and not too little", ideally with "a question
  or indicate a step that could have occurred to the student himself".

### Produce the next piece
Besides predicting an outcome, ask the reader to write the next artefact: the base case, the
next clause, the input that makes it fail.
- HtDP's "Stop!" prompts, about one per 2,000 words: "Stop! Make a general example for which
  the answer must be #false."

### Place recall checks by idea density
Put a check where the new ideas would overflow working memory: about ten new items without a
check is too many.
- Matuschak: watch for "a single review area has 10+ questions in it … since 10+ new ideas is
  likely to overload the reader's working memory."

### Classify near-misses
A transfer check can ask the reader to sort everyday candidates, including near-misses,
against the definition.
- Milewski: "Is the world-wide web a category in any sense? Are links morphisms? Is Facebook
  a category, with people as objects and friendships as morphisms?"

## Endings

### Generalise through the arbitrary choice
- "Again, to make things more general, you look for any place where you made an arbitrary choice." (XFDM1ip5HdU)
- Or ask where it breaks: "Where specifically does the line of reasoning that I laid out break down when you're working on a mug?" (VvCytJvd4H0)

### Teach the trigger
- "when you see that the rate at which some value changes is proportional to that value itself, your mind should burn with the thought of an exponential." (ToIXSwZ1pJU)
- "maybe the most important level is being able to recognize when you need to use it" (w-CXIqIjfRI)

### Name the takeaway as the takeaway
- "the ultimate point that evidence should not determine beliefs, but update them, is worth tattooing in your brain." (HZGCoVF3YvM)
- The headline sticks, so make it the lesson: "for a lot of people the one main takeaway was what is the best opener for the game wordle. And I get it, I walked into that because I put it in the thumbnail" (fRed0Xmc2Wg)

### Honest calibration
- "one of my hopes with this whole project is that you now have enough background to maybe see through some of the hyperbole that certain outlets are so fond of." (Dlsa9EBKDGI)

### Name the transferable move
- "ask, what's the simplest possible, non-trivial variant of the problem that you can try to solve?" (ltLUadnCyi0)
- One clause as you use it ("as so often, try a smaller case first"), not a callout box.

## Voice

### Care is the motivator
- "education is not rate limited by the clarity of explanation, it's rate limited by motivation" (LKrwhjOI8Nc)
- "If motivating a lesson determines how much attention and focus the viewer is willing to give you, clarity determines how quickly you burn through that focus." (cDofhN-RJqg)

### Discovered, not handed down
- "If you have a sufficiently high standard for explanations, you want both of these facts to feel discovered, rather than feeling like they were handed down." (KTzGBJPuJwM)
- "the goal here is not to get to the answer as quickly as we can, but hopefully for you to feel like you found the answer yourself" (ltLUadnCyi0)
- That feeling is guided, not unassisted: in a meta-analysis, unassisted discovery lost to
  explicit instruction (d = −0.38), while discovery with feedback, worked examples and
  scaffolding won (d = +0.30) (Alfieri et al., 2011).

### Small definition, large consequences
Never call a hard idea easy. Call it a small definition with large consequences, and keep
returning the reader to the definition.
- Yorgey: they have "very large implications relative to the size of their definition". "if
  someone is really convinced that monads are easy, they are going to be in for a demoralizing
  shock".

### Hedges with content
Keep a qualification that states a scope or a magnitude ("about 90% right", "for blocks up to
2^16 bits"). Cut reflexive softeners. More in [sentences.md](sentences.md).
- Pinker: good writers hedge, but "their hedging is a choice, not a tic".
