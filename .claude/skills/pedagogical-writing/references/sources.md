# Sources

Where the rules beyond 3Blue1Brown come from, so a quote can be traced and weighed. Each
source was checked for two things, kept apart: advice the person states, and patterns
visible in their own work. Read this when a rule needs its evidence, or when two sources
seem to disagree.

## Contents

- How much to trust each kind of source
- Interactive explanations
- Writing about explanation
- Style and mathematical writing
- Learning research
- Video educators
- Programming and functional programming
- Tensions with the 3Blue1Brown rules, and how the skill resolves them
- Looked at and left out

## How much to trust each kind of source

- **Experiments** (Mayer, Sweller, the prequestion and refutation studies) say what works on
  average, under the conditions tested: short lessons, mostly novices, mostly immediate
  tests. Mayer's per-principle effect sizes come largely from his own lab; an independent
  meta-analysis of that body of work finds a pooled g = 0.37, so read any single principle's
  number as an upper bound.
- **Stated advice** from practitioners is their account of their own method. It is
  strongest where several practitioners reached it independently.
- **Observed patterns** are inferences from their work. They are labelled as such in the
  research and should not be quoted as advice the person gave.
- Quotes in the reference files are verbatim unless marked as paraphrase or "via" a
  secondary source.

## Interactive explanations

| Source | Stated or observed | Main contribution | Where |
| --- | --- | --- | --- |
| Bret Victor | Stated | A sandbox is not an explanation; the text works statically; step down the ladder of abstraction; a control only once its meaning is known; no pinhole views of time | [Explorable Explanations](https://worrydream.com/ExplorableExplanations/), [Ladder of Abstraction](https://worrydream.com/LadderOfAbstraction/), [Learnable Programming](https://worrydream.com/LearnableProgramming/) |
| Nicky Case | Stated | Sandbox last, built from parts taught one at a time; BUT/THEREFORE; names that don't leak the answer; form follows content | [How I make explorable explanations](https://blog.ncase.me/how-i-make-an-explorable-explanation/), [4 more design patterns](https://blog.ncase.me/explorable-explanations-4-more-design-patterns/), [Trust notes](https://ncase.me/trust/notes/) |
| Amit Patel (Red Blob Games) | Stated, rich | The default frame teaches; limit the state space; side by side over toggles; one colour vocabulary, one concept per step | [Thoughts on explorable explanations](https://simblob.blogspot.com/2018/05/thoughts-on-explorable-explanations.html), [Little design elements](https://www.redblobgames.com/making-of/little-things/) |
| Bartosz Ciechanowski | **Observed only**; no stated advice found | The reader acts as the mechanism before it is automated; an instruction sentence before each demo | *Airfoil*, *Mechanical Watch*, *GPS* on [ciechanow.ski](https://ciechanow.ski/) |
| Sam Rose | Stated (interviews) | Watch readers read silently; guided simulations, then a playground with honest limits | [Write That Blog! interview](https://writethatblog.substack.com/p/sam-rose-on-technical-blogging), [Overcommitted ep. 46](https://overcommitted.dev/interactive-computer-science-education-sam-rose-on-visual-learning-developer-teaching/) |
| Steven Wittens | Stated | "The graphics should have slides in them"; animate the real model | [MathBox²](https://acko.net/blog/mathbox2/), [How to Fold a Julia Fractal](https://acko.net/blog/how-to-fold-a-julia-fractal/) |
| Distill (Olah, Carter; Hohman et al.) | Stated | Not everything needs to be interactive; feedback early; "in our example" after each step | [Research Debt](https://distill.pub/2017/research-debt/), [Communicating with Interactive Articles](https://distill.pub/2020/communicating-with-interactive-articles/) |
| Andy Matuschak & Michael Nielsen | Stated | Earn each medium against a named failure; check placement and writing; caveat on high-affect explanation | [How to write good prompts](https://andymatuschak.org/prompts/), [Tools for thought](https://numinous.productions/ttft/), [Reinventing explanation](https://web.archive.org/web/20210125184704/https://michaelnielsen.org/reinventing_explanation/) |
| Jay Alammar | Stated (interviews) and observed | Redraw each figure many times; zoom in from one black box; train by hand, then automate | [Illustrated Transformer](https://jalammar.github.io/illustrated-transformer/), [Bouchard interview](https://www.louisbouchard.ai/jay-alammar/) |

## Writing about explanation

| Source | Stated or observed | Main contribution | Where |
| --- | --- | --- | --- |
| Julia Evans | Stated, rich | Thirteen patterns of confusing explanations; test with a newcomer and an expert; real examples; label the wrong way as wrong | [Patterns in confusing explanations](https://jvns.ca/blog/confusing-explanations/), [Write good examples](https://jvns.ca/blog/2021/07/08/writing-great-examples/). Quotes are close paraphrase. |
| Brent Yorgey | Stated | The monad tutorial fallacy; levels of abstraction; small definition, large consequences; non-examples | [Monad tutorial fallacy](https://byorgey.wordpress.com/2009/01/12/abstraction-intuition-and-the-monad-tutorial-fallacy/), [Teaching abstraction](https://byorgey.wordpress.com/2012/11/25/teaching-abstraction/), Typeclassopedia |
| Gopen & Swan | Stated, rich | Topic and stress positions; old before new; subject near verb; the sentence-length test | "The Science of Scientific Writing" (1990), read in an [authorised reprint](https://human.libretexts.org/Bookshelves/Composition/Technical_Composition/Effective_Technical_Writing_in_the_Information_Age_(Schall)/10%3A_Journal_Articles_about_Writing/10.06%3A_The_Science_of_Scientific_Writing); Gopen (2022) |
| Joseph Williams | Stated, rich | Characters as subjects, actions as verbs; issue then point; the "So what?" test; no elegant variation | *Style* (course-reading excerpts); [*Problems into PROBLEMS*](https://wacclearinghouse.org/docs/comppile/pd/JWilliamsProblemsdw.htm) for motivation |

## Style and mathematical writing

| Source | Stated or observed | Main contribution | Where |
| --- | --- | --- | --- |
| Steven Pinker | Stated | Curse of knowledge; given before new; zombie nouns; signpost the subject; hedges by choice | ["Why Academics Stink at Writing"](https://davidlabaree.com/2021/07/08/pinker-why-academics-stink-at-writing/) (full essay); the book through excerpts |
| Thomas & Turner | Stated | Present, don't narrate; hedges of process, liability and worth | [classicprose.com](https://classicprose.com/csguide.html) (the authors' guide) |
| Donald Knuth | Stated, rich | The "blah" test; state definitions twice; synchronisation clauses; literate-programming rules for walking code | [*Mathematical Writing*](https://cs.stanford.edu/~knuth/klr.html) (1987 notes), "Literate Programming" (1984) |
| Paul Halmos | Stated, rich | Where each claim stands; audit "obviously"; write in spirals; parallel wording; the section-title test | "How to Write Mathematics" (1970), read in full |
| Edward Tufte | Stated, **mostly secondary** | Labels in the figure; smallest effective difference; one meaning per arrow; side by side for comparison | Notebook posts and reviews; the books were not available, so book-level wording is unverified |

## Learning research

| Source | Main finding used | Strength |
| --- | --- | --- |
| Mayer, multimedia learning | Spatial contiguity (independent g = 0.63), temporal contiguity, signalling, coherence, pre-training, generative activity | Many studies; per-principle sizes inflated (see above) |
| Sweller, cognitive load | Worked examples (g = 0.48), completion problems and fading, expertise reversal, transient information, element interactivity | Many studies; effects shrink for experts and simple material |
| Bjork; *Make It Stick* | Desirable difficulties; fluency is not learning | Bjork & Bjork (2011) read in full; the book itself not read |
| St. Hilaire, Chan & Ahn (2024) | Prequestions: g = 0.54 on asked content, 0.04 elsewhere; guessing 0.65 vs reading 0.22 | Preregistered meta-analysis, read from the PDF |
| Alfieri et al. (2011) | Unassisted discovery d = −0.38; enhanced discovery d = +0.30 | Meta-analysis, 580 and 360 comparisons |
| Kulgemeyer & Wittwer (2022) | An unrefuted wrong model feels just as understood | One study, one topic |
| Bisra et al. (2018) | Self-explanation prompts g = 0.55 | Meta-analysis, via the abstract |
| Sundararajan & Adesope (2020) | Seductive details g = −0.33 | Meta-analysis, via a summary |
| George Pólya | Graduated hints; "let them learn guessing", "let them learn proving" | Stated advice; some wording from transcriptions |
| Seymour Papert | Objects to think with; microworlds whose concepts are all defined inside | Stated (*Mindstorms*); his open exploration is the part the evidence above does not back |

## Video educators

| Source | Stated or observed | Main contribution |
| --- | --- | --- |
| Derek Muller (Veritasium) | Stated, from his own experiments | Refutation beats clear exposition; "clear" ratings and confidence rise without learning; fade worked examples. The 2008 effect sizes (d ≈ 0.79, 0.83) come from search snippets of the abstract and are unverified. |
| Andrej Karpathy | Stated | Declare the boundary ("everything else is just efficiency"); never the solution before the guess; collect novices' questions; a numerical oracle after each derivation (observed) |
| Josh Starmer (StatQuest) | Stated | Find the step that is too big in existing explanations; a non-expert reads the draft; one parameter free at a time (observed) |
| Freya Holmér | Observed (fragments stated) | Diagnostic views before the theory; the fix that breaks something else; remove scaffolding out loud |
| Ben Eater | Thin stated; observed | "If you need a tool tip, you failed"; read the primary source beside the explanation; raw observation before interpretation |
| Welch Labs | Thin stated; observed | Ablation: remove one line and show the degradation; the toy fails the same way |
| Steve Mould | **Observed only** | Demote the wrong primary cause; turn a button into a slider; the gap from the textbook number is content |
| Sebastian Lague | **Observed only** | A plausible-range check that lets a wrong value introduce a concept; a failure count as the spine |
| Mathologer | Thin stated; observed | Rescue the true kernel of a viral wrong explanation |

## Programming and functional programming

| Source | Stated or observed | Main contribution | Where |
| --- | --- | --- | --- |
| HtDP; Krishnamurthi | Stated, rich | Abstraction from aligned instances; data shape before code; example cost; discriminating examples; wrong options from named misconceptions; near-twin questions | [htdp.org](https://htdp.org/), [Examplar](https://cs.brown.edu/~sk/Publications/Papers/Published/wk-examplar/), [SMoL Tutor](https://cs.brown.edu/~sk/Publications/Papers/Published/lk-smol-tutor/), ["How Not to Teach Recursion"](https://parentheticallyspeaking.org/articles/) |
| SICP | Stated (prefaces) and observed | A ladder of models, each retired on a case it gets wrong; wishful thinking; toys as test patterns; traces whose shape is the argument | MIT Press full text |
| Graham Hutton | Preface stated; method observed | Specialised types first; each step annotated with its reason; the naive version as oracle; the simplification you decline | *Programming in Haskell* front matter, *The Countdown Problem*, Computerphile |
| Bartosz Milewski | Stated (preface) and observed | Code the reader already writes; "you've already been using it"; several notations, one reading | *Category Theory for Programmers* |
| *Haskell Programming from First Principles*; Gabriella Gonzalez | Stated (book site) and observed | Abstract by asking which part is common and which varies; minimal pairs; let the reader verify with the real tool | haskellbook.com sample; haskellforall.com |

## Tensions with the 3Blue1Brown rules, and how the skill resolves them

| Tension | Resolution in the skill |
| --- | --- |
| "Fix, then name" vs Mayer's pre-training | Name late by default. Name early only a handle the prose will use often (a part the mechanism keeps referring to), with its plain meaning, on a labelled figure. The idea's own name waits until after any prediction it would spoil. |
| Concrete first vs Milewski's definition first | A definition may come first only if it is brief, its concrete reading follows at once, and the reader already knows the instances. |
| "Not falsely simple" vs SICP's toy test patterns | A toy may show a shape, labelled as one; it never serves as the need. |
| One running example vs the variability effect | One example builds the model; two or three different worked cases follow once it holds. |
| "Could have invented it" vs the discovery evidence | The reinvention is guided: every prediction and playground has a question, a scaffold and an answer. |
| Companion voice and signposts vs classic style's ban on metadiscourse | Signpost the subject, not the document; keep hedges that state a scope or a magnitude. |
| Point late (discovery) vs Williams's point early | Keep the discovery order, but each section's opening says where it is going. |
| Diagnose misconceptions vs Ciechanowski's myths in Further Reading | Refute in the main line only what the target reader actually believes. |
| Full scaffolding vs expertise reversal | A visible fast path for experts; scaffolding spent where several parts interact at once. |
| "Let care show" vs seductive details | Relevant enthusiasm stays; trivia and biography go to sidenotes or after the payoff. |
| High-affect explanation (3Blue1Brown) vs detailed understanding | Grant Sanderson, as Matuschak and Nielsen report it, doubts that "more than a small fraction of viewers are taking away much detailed understanding". Pair the moves with checks. |

## Looked at and left out

- Spaced-repetition prompts (Quantum Country): blog readers do not return for review sessions.
- Tufte's data-ink and chartjunk rules: the house chart rules and the `dataviz` skill cover them.
- Pólya's four problem-solving phases as a page structure: they suit problem-solving, not
  explainers. His hints are kept.
- The Distill reviewer worksheet: its limitations and reproducibility checks are covered by
  the claim-status rule.
- Disfluent fonts (Muller mentions the effect): large replications failed.
- Sam Rose's acceptance of JavaScript-only pages: the house rules require pages to read without
  JavaScript.
