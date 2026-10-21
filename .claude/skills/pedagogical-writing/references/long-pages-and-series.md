# Long pages and series

Read this when a page runs past ~3,000 words, has more than about five `h2`
sections, or is one page of a multi-page series. 3Blue1Brown's 25–60 minute
videos and its multi-chapter series (Essence of Linear Algebra, Deep Learning,
Differential Equations) use the moves below consistently; short pieces mostly
don't need them.

## Contents

- Keeping the reader oriented on a long page
- Depth and skipping
- Series: structure
- Series: each page
- Series: across pages

## Keeping the reader oriented on a long page

### State the route, and why each part is there
After the hook, give the phases in two or three sentences, with each part's job.
This is not a table of contents: it says why.
- "The structure here will be to start by imagining teaching complex numbers to someone who only understands one dimension, then describing 3D rotations to someone who only understands two dimensions" (d4EgbgTm0Bg)
- "The first puzzle is just going to give us a sense of the meaning of what we're about to do because it runs the risk of feeling pretty abstract." (fsLh-NYhOoU)
- Repeat a mini-route where a second storyline begins.

### Keep a numbered ledger of open questions
List the questions the page must answer, numbered and phrased as questions.
Open later sections with the number they answer, and say when an answer is
partial.
- "let me show you the overall structure for the explanation of what's going on here, and along the way record various questions that we still need to answer." (QCX62YJCmGk)
- "I'll call this a partial answer to our question number one" (aXRTczANuIs)
- On a page: the ledger is an `ol` in the first `h2`; later headings or first sentences cite "Question 2". It also makes good slides.

### Outline a proof before its steps, then re-anchor
Give the shape (two lemmas, a detour and its return), then restate the goal in
one sentence whenever the detail goes deep.
- "Deep in the weeds like this, it's sometimes easy to forget why we're doing this." (GNcFjFmqEc8)
- "The point is that everything has now boiled down to this one conjecture." (Nbwv5wHQoj0)
- On a page: put the one remaining claim in a callout with an `id`.

### Announce a detour, then close it
Say that it is a detour, why, and roughly how long. Close it by restating the
goal and the chain back to it, often working backwards from the goal.
- "let's take a brief sidestep into a mini-lesson so that I don't have to rob you of that joy." (EmKQsSDlaa4)
- "So that's the packaged lesson about diffraction gratings, but now let's zoom out and remember why we were doing this." (EmKQsSDlaa4)
- A detour the next step depends on stays in the main line. One that only answers "why" goes in a `details.disclosure`.

### Consolidate at each phase boundary
Before turning to the next phase, restate the finished one in two to four
sentences, then pose the next question.
- "And that's it! That is the basic operation. Translate to this bizarre looking log space, rotate and scale to realign things, and then translate back with an exponential." (ldxFjLJ3rVY)
- "That is a lot of different moving parts, so let's step back and summarize what we have so far." (spUNpyF58BY)
- Before a hard step: "By the way, I do think that this process right here is the most complicated part of the video." (NaL_Cb42WyY)

### Give the reader room to digest
- "Before just jumping right into it, we have been kind of covering a lot, so it might be worth giving some space to let this digest." (ldxFjLJ3rVY)
- On a page: a short plain paragraph or a figure replay, not a new idea.

### Close with the compressed version
End a long argument with the whole thing as one would write it down, so the
reader sees that the long walk was scaffolding around something short.
- "it's very pleasing that this entire complicated process can be boiled down to so few symbols on the page, but I do think this risks kind of obscuring what's actually going on." (ldxFjLJ3rVY)
- On a page: an `ol.steps` restating the argument in five lines, after the payoff.

## Depth and skipping

### Label the tier in the prose
Say which level a passage is at, and give explicit permission to skip it.
- "Although what follows is very firmly in the territory of more than you need to know to drive the car" (j0wJBEZdwLs)
- "It's okay if you don't understand these particular equations, I'm just throwing them up for those of you who are curious" (rB83DpBJQsE)

### Say what the skipper keeps
Before any optional part, state the minimum the reader needs, then say they may
skip. The minimum sentence goes in the main text before the fold, never inside it.
- "That's all you really need to know. But if you're curious, the way it works is" (wjZofJX0v4M)
- "Arguably, it falls outside the essence of linear algebra. The important part here is to know what that cross product vector geometrically represents. So, if you want to skip that next video, feel free." (eu6i7WJeinw)

### Give experts a fast path
Guidance that helps a novice slows an expert down, measurably (the expertise reversal
effect: Kalyuga, Ayres, Chandler & Sweller, 2003). So the skip labels above are not only
courtesy. Spend the scaffolding where the reader must hold several interacting parts at
once, and give the reader who already has them a visible way past it.
- On a page: one line after the TL;DR ("If you know rank and select, skip to
  [the directory](#directory)"); a "skip the build-up" link at the start of a long
  derivation; the compressed version (below) linked from the TL;DR, so an expert finds it
  first.

### Mark the essence checkpoint
Say where a reader could stop and still have the core idea; label what follows
as detail. On a page, this sits at the boundary between the template's
mechanism and details sections.
- "if you understood everything so far, and if you were to stop here, you would come away with the essence of what attention really is." (eMlx5fFNoYc)

### State the rigour contract
Say what is skipped, list the questions a careful reader still has, and point
to where they are answered. Flag visual exaggeration.
- "There are multiple technical nuances that I'm sweeping under the rug here." (r6sGWTCMz2k)
- "keep in mind I'm drawing dx with a fair bit of width here just so we can actually see it" (S0_qX4VJhMQ)
- On a page: a `details.disclosure` titled "What this skips", with links. It holds leftover rigour, never the best intuition.

### Contain the rigour gap with a tiny counterexample
After the intuitive argument lands, name the informal step and show a minimal
case where that kind of step fails. Keep the counterexample in the main text and
the full proof in the fold.
- "we've pulled a little bit of sleight of hand in the informality here" (8GPy_UMV-08)

## Series: structure

### Show the map first
Open the series with the whole pipeline, admittedly glossed. Each page re-shows
the map with its own stage lit.
- "I'm glossing over some details about some normalization steps that happen in between, but this is after all a high-level preview." (wjZofJX0v4M)
- On a page: a hub page holds the pipeline SVG; each page reuses it with its stage lit through `data-ref`.

### Flag the keystone
- "what I view to be the most important video in this series, chapter 3" (P2LTAUO1TdA)

### Split intuition and formalism into sibling pages
Readers can stop after the intuition without guilt. Backpropagation has an
intuition chapter and a calculus chapter; the cross product has a standard
chapter and a duality chapter. Mark the formal page optional in the series index
and say what it adds.

### Give the series a standalone entry page
A short, notation-free overview whose paragraphs stand alone, linking into the
series ("Large Language Models explained briefly" does this for Deep Learning).

## Series: each page

### Recap one named idea, with a boundary and a way back
Open by restating the single earlier idea this page depends on, mark where the
recap ends, and point to the full page for readers who need more.
- "the one idea from the last video that I really want you to hold firmly in your mind right now" (Ilg3GewQ5U)
- "This is worth a quick recap because it's just really important, but of course if this feels like more than just a recap, go back and watch the full video." (XkY2DOUCWMU)
- "Alright, recap over, on to the new stuff." (XkY2DOUCWMU)

### State prerequisites as a contract
Say what is assumed, or say that nothing is. Put a gate at the section that
needs it, not only at the top.
- "The hard assumption here is that you've watched part 3" (tIeHLnjs5U8)
- "For this next part, it's important that you're all comfortable representing transformations with matrices" (P2LTAUO1TdA)
- Diagnose where confusion really comes from: "Confusion about eigenstuffs usually has more to do with a shaky foundation in one of these topics than it does with eigenvectors and eigenvalues themselves." (PFDu9oVAE-g)

### Link prerequisites by title, never by number
Chapters inserted later broke 3Blue1Brown's references ("chapter five… where I
talk about the determinant" now points at the wrong chapter). Link by page
title or slug, and restate the key idea in one clause.

### End with a teaser for the next page
Every chapter in a series ends by posing the question the next one answers.
The last page of the series instead revisits the first page's question.
- "I'd like to revisit a deceptively simple question that I asked in the very first video of this series." (TgKwz5Ikpc8)

## Series: across pages

### Keep provisional simplifications open across pages
A simplification made on one page can be closed on a later one. Keep a list of
open simplifications for the series and close each.
- "Right now when I say neuron all I want you to think about is a thing that holds a number" (aircAruvnKk), closed later in the same video with "Remember how earlier I said these neurons are simply things that hold numbers?"
- A hope planted in chapter 1 is tested in chapter 2: "So is this what our network is actually doing? Well, for this one at least, not at all." (IHZwWFHWa-w)

### Carry a running tally
State the target total, then add each part to a visible running count, page by
page, until it matches.
- "Let's go ahead and add this to a running tally, remembering that by the end we should count up to 175 billion." (wjZofJX0v4M)
- "you do indeed get that grand total of 175 billion as advertised" (9-Jl0dxWQs8)
- On a page: repeat one `.metrics` row or table on every page of the series (bytes or nanoseconds per DEFLATE stage), with the current page's contribution lit.

### Declare the visual encoding once, and explain departures
- "draw a very sharp distinction in your mind between the weights of the model, which I'll always color in blue or red, and the data being processed, which I'll always color in gray." (wjZofJX0v4M)
- "The reason I'm not showing the inputs move over to the outputs like I usually do is not just animation laziness." (v8VSDg_WQlA)
- This repo already fixes diagram colour meanings (`c1`–`c6`); a series adds its own encodings on its first page and keeps them.

### Bridge to the literature's notation
Teach with the clearest names, then add a flagged section mapping them to how
other sources write it, so readers can go on to the papers.
- "This is how you'd see it if you choose to read up more about neural networks." (aircAruvnKk)

### Name what is out of scope, with search terms
- "keywords Gaussian elimination and row echelon form" (uQhTuRlWMxw)
- A later page can reopen an omission and say so.
