# Sources

Where each rule comes from, how much of the source was actually read, and what was left out
because it could not be checked. Read this when a rule needs its evidence, or before adding a
claim to the skill.

Checked on 2026-11-10 by extracting the text of the primary PDFs and searching it. A claim
that could not be matched to a source's own text was dropped, not kept from memory.

## Contents

- How much to trust each kind of source
- Research read in full
- Research read in part
- Practitioners
- Author's synthesis
- Checked and dropped
- Looked at and left out

## How much to trust each kind of source

- **Experiments** say what worked on average under the conditions tested: short lessons, mostly
  novices, mostly immediate tests, often one topic. Most of the studies below use one mechanism
  (a flush cistern, car brakes, soldering, a TV stand). Treat the rules as defaults to test on a
  page, not laws.
- **Statements in an introduction** are the authors' summary of earlier work. They are cited as
  "stated in the introduction", not as that study's finding.
- **Practitioners' advice** is their account of their own method.
- The per-principle effect sizes of Mayer's lab are likely high: `pedagogical-writing`'s
  [sources](../../pedagogical-writing/references/sources.md) notes an independent meta-analysis
  that pooled g = 0.37 across the multimedia principles.

## Research read in full

Text extracted from the PDF and read.

| Source | What the rules take from it | Caveat |
| --- | --- | --- |
| Tversky, Morrison & Bétrancourt (2002), "Animation: can it facilitate?", *Int. J. Human-Computer Studies* 57, 247–262 | **Congruence Principle**: "the structure and content of the external representation should correspond to the desired structure and content of the internal representation". **Apprehension Principle**: it "should be readily and accurately perceived and comprehended". Where animation beats a static graphic, "the animated graphics convey more information or involve interactivity". Animations "should lean toward the schematic and away from the realistic", with arrows or highlighting to direct attention. "Judicious use of interactivity may overcome both these disadvantages." | A review, not an experiment. It does not say animation never helps: "may be more effective … for real time reorientations in time and space". |
| Larkin & Simon (1987), "Why a Diagram is (Sometimes) Worth Ten Thousand Words", *Cognitive Science* 11, 65–99 | In a diagram "information is organized by location, and often much of the information needed to make an inference is present and explicit at a single location"; cues to the next step may sit at an adjacent location, so the work is "a smooth traversal of the diagram" with little search. Informationally equivalent representations differ in computational efficiency. | Their models are production systems on physics and mathematics problems (pulleys, geometry), not students. Read from a scanned PDF; its OCR text layer is noisy, so quotes were taken from the abstract. |
| Heiser, Phan, Agrawala, Tversky & Hanrahan (2004), "Identification and Validation of Cognitive Design Principles for Automated Generation of Assembly Instructions", *AVI '04* | The list of principles (see [process-diagrams.md](process-diagrams.md)): one diagram per major step with none omitted; explicit order; parts added visible; mode of attachment not occluded; action diagrams rather than structural; consistent arrows and guidelines; avoid changing viewpoints; stable orientations. Instructions made from them cut assembly time by 35% on average and error by 50% against factory instructions. | **One task**: assembling a TV stand. The paper says "7 principles" and lists eight bullets. The step to "other kinds of visualizations, particularly those that show processes over time" is the authors' belief, not a test. |
| Kalyuga, Chandler & Sweller (1999), "Managing Split-attention and Redundancy in Multimedia Instruction", *Applied Cognitive Psychology* 13, 351–371 | Integration of text into the diagram "is required if these sources of information are unintelligible in isolation". If the text is "merely redescribing" what a self-contained diagram shows, integrating it adds load and "elimination, rather than integration, of redundant sources of information is beneficial". Experiment 2: colour coding between text and diagram parts reduced the search for referents. | Experiment 1's redundancy was the **same text** in audio and visual form. The diagram-and-text redundancy claim is the authors' summary of earlier studies. 34 first-year trade apprentices, soldering. The expertise-reversal finding is **not in this paper**. |
| Hegarty, "Capacity Limits in Mechanical Reasoning" (QR 2001 workshop paper), from the Northwestern QRG archive | "Mental animation is conceptualized as occurring in a limited-capacity spatial working memory system." People "do not mentally animate the motion of all components of a mechanical system in parallel". Low-spatial-ability people made more errors on mental animation, not slower. | A simulation plus reviewed studies, not a new experiment; pulley systems. It does **not** study expertise, and says nothing about misconceptions from static versus animated displays. |

## Research read in part

| Source | What was read | What the rules take from it |
| --- | --- | --- |
| Heiser & Tversky (2005), "Characterizing diagrams produced by individuals and dyads", *Spatial Cognition IV* | Full text. | The introduction states: "Effective diagrams abstract the essential information, and omit information that is irrelevant to the problem or task at hand", and that "for conveying how to operate systems or how systems operate, diagrams are especially effective". **These are statements in the introduction**, citing other work. The study itself is about assembly instructions: people high in spatial ability drew step-by-step action diagrams, rated higher by others. |
| Jian & Wu (2016), "The function of diagram with numbered arrows and text in helping readers construct kinematic representations", *Computers in Human Behavior* 61, 622–632 | Full text. | Their own study, 46 undergraduates from non-science majors, a flush cistern: the group with numbered arrows beat the group without on the step-by-step test after the diagrams, and the gap narrowed after the illustrated text; the arrow group also did better on troubleshooting. The introduction reports **Mayer & Gallini (1990)**: low-mechanical-knowledge readers of car-brake diagrams with both parts and steps beat the other groups on retention and transfer; the difference was not seen for high-knowledge readers. |
| Mayer & Fiorella, chapter in *The Cambridge Handbook of Multimedia Learning* (2014) | **Abstract only** (paywalled). | Coherence: 23 of 23 tests, median effect size 0.86. Signaling: 24 of 28, 0.41. Redundancy 16 of 16, 0.86. Spatial contiguity 22 of 22, 1.10. Temporal contiguity 9 of 9, 1.22. The abstract says "median effect size", not "d". |
| Ainsworth (2006), "DeFT: A conceptual framework for considering learning with multiple representations", *Learning and Instruction* 16, 183–198 | **Abstract only**, from Semantic Scholar: "Multiple (external) representations can provide unique benefits when people are learning complex new ideas", and the framework has three aspects: the design parameters, the functions the representations serve, and the cognitive tasks a learner must undertake. | The paper's wording of the functions and of the learner's cost of relating representations is **not verified**. Rule 8 is the author's synthesis, with this abstract as the pointer. |
| Mayer & Gallini (1990), "When is an illustration worth ten thousand words?", *J. Educational Psychology* 82, 715–726 | **Not read**: the abstract is withheld by the publisher. | Cited only as reported by Jian & Wu. |

## Practitioners

| Source | Read | Used for |
| --- | --- | --- |
| Bret Victor, [*Learnable Programming*](https://worrydream.com/LearnableProgramming/) (2012) | First 39,947 of 62,893 characters. | "The entire purpose of code is to manipulate data, and we never see the data."; "It is not enough to just show the data. We must show comparisons." His "Show the data" is attributed to Tufte by Victor, so secondhand for Tufte. An essay on programming environments, not diagrams. |
| Nicky Case, [*Explorable Explanations*](https://blog.ncase.me/explorable-explanations/) (2014) | Full post. | "Do & Show & Tell": "Don't try to explain _everything_ with something interactive."; "Start small, build big": mechanics "you should teach in isolation first before combining them". About interactives, not static diagrams. |
| Edward Tufte, [notebook: design of causal diagrams](https://www.edwardtufte.com/notebook/design-of-causal-diagrams-barr-art-chart-lombardi-diagrams-evolutionary-trees-feynman-diagrams-timelines/) (2003; a draft of *Beautiful Evidence*) | Full page. | "Lines and arrows are, in effect, verbs showing how one noun is related to another." Also the caution that "it is easy to draw a linking line or an arrow of implied causality, but very hard to make credible causal inferences." |
| The existing figure rules in `pedagogical-writing` (Patel, Wittens, Holmér, Ciechanowski, Alammar, Mayer on contiguity) | Moved here with their quotes from `pedagogical-writing/references/figures-and-interactives.md`. | Their verification status is in [that skill's sources](../../pedagogical-writing/references/sources.md); the book-level Tufte quotes there are secondhand. |

## Author's synthesis

These are judgments built on the sources, not findings of any one of them:

- Choosing the form from the idea's structure as a list of forms (rule 1). Congruence is the
  principle; the table of forms is the skill's.
- Hierarchy by "the smallest effective difference" (rule 3): the principle comes from
  apprehension and signalling; the phrase is Tufte via Casselman, quoted in
  `pedagogical-writing`.
- Prefer a stepper to an animation for a mechanism (rule 7): follows from the Tversky review's
  conclusions and Hegarty's piecemeal mental animation, but no study compared a `<bh-stepper>`.
- Several representations: state what each one is for (rule 8).
- Mapping the process principles onto `<bh-stepper>`, `<bh-versions>` and `<bh-sequence>`.
- The review checklist.

## Checked and dropped

The issue that started this skill (#80) listed these. They are not in the skill, because the
source could not be matched:

- **Expertise reversal from Kalyuga et al. (1999) and Jian & Wu (2016).** Neither paper has it.
  The rule uses Mayer & Gallini as reported by Jian & Wu, labelled secondhand.
- **Hegarty: misconceptions from static and animated displays alike.** Not in the paper read;
  the DTIC report (ADA426950) returned 403.
- **Ainsworth's three function names** (complement, constrain, construct): not visible in the
  abstract; full text unreachable.
- **Tufte's layering and separation, micro/macro, small multiples, and "show causality" as
  Tufte's principles.** The books were not available. Small multiples already appears in
  `pedagogical-writing` marked secondary. His own site says the opposite about causality:
  arrows need evidence.
- **Tversky, *Mind in Motion* (2019)**: no source reachable.
- **Mayer's effect sizes as "d".** The abstract says "median effect size".

## Looked at and left out

- **Kosslyn**, *Graph Design for the Eye and Mind*; **Cleveland & McGill** and **Bertin** on
  perceptual encoding: these are about charts, and belong to the `dataviz` skill.
- **Lowe** on learning from animation: not reachable in this pass; a candidate for a later one.
- **Holmes and Cairo** on explanation graphics: peripheral to teaching diagrams, and contested.
- **Amit Patel's "Diagram structure"** is about implementation, not teaching design.
