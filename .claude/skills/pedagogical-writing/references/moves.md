# Teaching moves, with examples

Each move has the rule, how it looks on a page of this blog, and a verbatim line
from a 3Blue1Brown video (by YouTube id) showing it done. Headings match
SKILL.md. Search with `grep -n "^### " references/moves.md`.

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
