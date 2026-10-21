# Sentences and paragraphs

SKILL.md orders ideas across sections and pages. This file covers what happens inside
them: how each sentence hands the reader to the next, and how each paragraph states
its point. The rules come from Gopen & Swan, Joseph Williams, Steven Pinker, Donald
Knuth and Paul Halmos (see [sources.md](sources.md)). Each has the rule, how it looks on a
page of this blog, and a line from the source. Search with `grep -n "^### " references/sentences.md`.

These are reader expectations, not laws. Gopen & Swan: "Our best stylists turn out to
be our most skillful violators; but … they must fulfill expectations most of the time."

## Contents

- Why this level matters
- Order inside the sentence
- Grammar that carries the reader
- Names and terms
- Joins between sentences
- Paragraphs and sections
- Formulas and code in sentences
- Signposts and hedges
- Diagnostics

## Why this level matters

### The structure of the prose is the structure of the argument
Rewriting sentences for flow keeps exposing missing steps, because a sentence with
no old information forces the reader to build the link alone.
- Gopen & Swan: "When old information does not appear at all in a sentence … readers are
  left to construct the logical linkage by themselves." And: "the structure of the prose
  becomes the structure of the scientific argument."
- Page: when a sentence about the rank directory opens on something new, ask what the
  missing sentence would say. Usually it is the step the author skipped.

### The curse of knowledge lives here
Experts drop connectives, use their private labels and name things by their function.
None of that is visible to the writer.
- Pinker: "The curse of knowledge is the single best explanation I know of why good people
  write bad prose": "the difficulty in imagining what it is like for someone else not to
  know something that you know."
- So the checks in this file are mechanical on purpose. Rereading as the author does not
  find these faults (see review.md, the cold read).

## Order inside the sentence

### Old information first, new information last
Open each sentence with what the reader already has, which links it back. End it on the
new thing you want stressed. Readers stress what comes just before the full stop.
- Gopen & Swan: "Put in the topic position the old information that links backward; put in
  the stress position the new information you want the reader to emphasize." The
  misplacement of old and new is "the No. 1 problem in American professional writing
  today".
- Pinker: "Human comprehension demands topic before comment and given before new."
- Page: after a sentence introducing the table, write "Rank is then one table lookup plus a
  popcount", not "One table lookup plus a popcount, using the table above, gives rank."

### Chain the stress into the next topic
The new thing at the end of one sentence becomes the old thing at the start of the next.
When two revisions are both clear, pick the one whose ending the next sentence picks up.
- Gopen (2022) chooses "The backbone of first–line chemotherapy for pancreatic cancer ought
  to be the use of platinum agents" over its alternatives, "because the next sentence
  begins, 'These agents target cancer cells …'"
- Page: "Each block stores a count of the ones before it. Those counts are what make rank
  fast." The second sentence starts where the first ended.

### Whose story is it?
Readers take a sentence to be about whatever comes first. Keep the same character at the
start of the sentences in a passage, even if that needs a passive.
- Gopen & Swan, on "Bees disperse pollen" and "Pollen is dispersed by bees": the second "is
  the superior sentence if it appears in a paragraph that intends to tell us a continuing
  story about pollen."
- Williams: "A cohesive paragraph has consistent topic strings."
- Page: a paragraph about the decoder keeps "the decoder" (or "it") as the subject, rather
  than switching to "the bit", "the table" and "the next code" in turn.

## Grammar that carries the reader

### Get to the verb quickly
Material between the subject and its verb reads as an interruption, and the reader holds
the subject in memory the whole time. Move sizes, complexities and citations into their
own clause or sentence.
- Gopen & Swan: "Anything of length that intervenes between subject and verb is read as an
  interruption, and therefore as something of lesser importance."
- Williams's test: underline the first six or seven words. If you have not reached the verb,
  and the subject is not one of your characters, "take a hard look at that sentence".
- Page: not "The decoder, which after the 5-bit HLIT, 5-bit HDIST and 4-bit HCLEN fields
  knows how many code lengths follow, reads the code-length codes next." Write "The decoder
  first reads three counts: HLIT, HDIST and HCLEN, 14 bits in all. With them it knows how
  many code lengths follow, so it reads the code-length codes next."

### The characters are subjects, the actions are verbs
Name the cast (the encoder, the decoder, the bit vector, the rank directory) and make them
the subjects. Put what they do in verbs, not in nouns.
- Williams: prose reads as clear "when (1) the subjects of the sentences name the cast of
  characters, and (2) the verbs that go with those subjects name the crucial actions those
  characters are part of." His example: "as a walk through the woods was taking place on
  the part of Little Red Riding Hood, the Wolf's jump out from behind a tree occurred,
  causing her fright" becomes "Little Red Riding Hood was walking through the woods, when
  the Wolf jumped out from behind a tree and frightened her."
- Characters can be abstract. On this blog they usually are.

### Wake the zombie nouns
An empty verb plus an action noun hides the action: "performs a computation of the rank",
"carries out a lookup", "there is a need for". Turn the noun back into a verb.
- Williams: "conducted an investigation" → "investigated"; "There is a need for further
  study" → name who must study what.
- Keep a noun when it refers back to the last sentence ("These lookups…") or names a
  concept the page uses often. Those nouns are doing work.
- Pinker also flags metaconcepts, the vague nouns "level", "strategy", "framework",
  "context", "perspective". "Calling the police" turns into "approaching this subject from a
  law-enforcement perspective".

### Say what the thing physically is
Experts name things by their role ("the payload", "the structure", "the lookup"). Readers
need the thing itself: 64 bits, an array of `u16`, two memory reads.
- Pinker's example: a sentence about "the slow and integrative nature of conscious
  perception" turns out to describe taps on the wrist, elbow and shoulder. "Well, why didn't
  they just say that?"

### When a sentence is too long
Length is not the test. A sentence is too long when it has more things that deserve stress
than places to put stress. Colons and semicolons add stress positions; a list announced as
"all that remains" can fill one.
- Gopen & Swan: "A sentence is too long when it has more viable candidates for stress
  positions than there are stress positions available."
- This replaces word limits. 3Blue1Brown averages about 25 words a sentence and reads easily.

## Names and terms

### One term per concept
A new word reads as a new thing. Do not vary the name of a concept for style: "block",
"chunk" and "superblock" must not drift into one another, and the prose name must match
the code identifier, the figure label and the glossary.
- Williams: "Don't strive for 'elegant variation.' When you use two words for one concept,
  you risk making your reader think you mean two concepts." One paragraph he quotes used
  "fourteen different words and phrases for just two concepts".
- Halmos: "Consistency … is a major virtue and its opposite is a cardinal sin in exposition."
- Before drafting, write the page's name table: prose name, identifier, figure label,
  glossary id.

### Coined labels are private
The labels an author invents while working ("the L1 block", "the popcount trick", "the fast
path") feel shared to the author and are not. They are neither glossary terms nor acronyms,
so a term audit misses them. Introduce each with its plain meaning, or replace it with
the plain description.
- Pinker on chunking: ideas fuse until "each becomes a mental unit which we can bring to mind
  in an instant", and the writer uses the label without unpacking it.

### Parallel wording for parallel ideas
Define variants word for word in parallel, then point at the one difference. When you
restate something, say it is a restatement, so the reader does not hunt for a difference.
- Halmos: "use the same words in the same order for as long as possible, and then, with a
  proper roll of drums, emphasize the difference".
- Page: define rank₀ and rank₁, or the static and dynamic structures, in matching
  sentences, then "the only change is …".
- Knuth: keep unusual words apart, because two uses "will be associated in the reader's mind
  and cause unwarranted connections."

### No sentence leans on two fresh terms
A reader who met two terms in the last section cannot yet use both in one sentence. Let a
term settle before building on it.
- Matuschak & Nielsen: "if you've just been introduced to a zoo of new terms, you probably
  won't absorb much from a sentence which uses many of those terms at once."

## Joins between sentences

### Name the relation at every join
Each pair of adjacent sentences, and each pair of paragraphs, stands in a relation you can
name: because, but, so, for example, then, in general. A join with no nameable relation is
a gap. Newcomers need more explicit connectives than the author's instinct supplies.
- Pinker: "Examples, explanations, violated expectations, elaborations, sequences, causes,
  and effects are arcs of coherence." "The optimal number of connectives depends on the
  expertise of the reader."

### "But" and "therefore", not "and then"
Between sections the same rule applies. A section that follows from the last starts
with "so" or "therefore". A section that answers a problem starts with "but". Sections
joined by "and then" form a list, not a ladder.
- Nicky Case, after Parker and Stone: "this happens, THEREFORE that happens, BUT that
  happens, THEREFORE this happens". In *The Evolution of Trust*: "I tried to connect as many
  points as I could with BUT".

## Paragraphs and sections

### Issue, then point
Readers split every paragraph, section and page into a short issue and a longer
discussion. They look for the themes to come at the end of the issue. State the point
there, or at the end of the unit.
- Williams: "The issue promises; the discussion delivers." A coherent paragraph "will usually
  have a single sentence that clearly articulates its point", found "(1) at the end of its
  issue, or (2) at the end of its discussion."
- Check: can you get the point from the first and last sentences alone?

### A discovery section still announces its point
Need, naive attempt, crack, fix puts the point last, which is right for discovery. The
section's opening must still say where it is going, with its themes near the end of that
opening sentence.
- Williams: "Whether you make your POINT early or late, you must always frame the space that
  your reader is about to enter." He accepts point-last when writers "want their readers to
  work through an argument … to experience a sense of discovery".
- Page: "Scanning works, but its cost grows with every bit; the fix is to count ahead of
  time." The section can then build the scan, break it and fix it.

### Four ways a paragraph goes out of focus
A theme announced but never developed; a theme developed but never announced; one theme
under so many names the reader cannot connect them; themes buried mid-sentence instead
of at the end of the issue.
- Williams: "you may have made a promise but didn't deliver, or you may have delivered on
  promises you didn't make." The fix: the point is usually in the last sentence or two of
  the draft; "move them up to the beginning and rewrite."

### Where's your point?
For each paragraph and section, find the sentence you would send as a telegram if asked
for the point. If no sentence says it, the reader will not find it either.
- Williams: "the better question is not 'What's your point,' but 'Where's your POINT?'" The
  writer's usual defence is "It's obvious."

### Headings test the structure
If you cannot say where the headings go and what words they need, the structure is not
there yet. Take heading words from the stress of each section's point. A section whose
only honest title has "and" in it, or is generic ("Details", "More on X"), has two ideas
or none.
- Halmos: "if you cannot find a title, the reason may be that the section doesn't have a
  single unified subject."
- Here each `h2` is also a slide title, so this test decides how the deck reads too.

## Formulas and code in sentences

### The "blah" test
Read the sentence with every formula and identifier replaced by "blah". It should still
read as a sentence that says something.
- Knuth: "your sentences should flow smoothly when all but the simplest formulas are replaced
  by 'blah' or some other grunting noise."
- Page: "`rank1(i)` = `L1[i>>16]` + `L2[i>>9]` + popcount" fails. "Rank is one coarse count,
  plus one fine count, plus a popcount of the last word: `L1[i>>16] + …`" passes.

### Notation hygiene
Do not start a sentence with a symbol. Separate two formulas with words. Use words, not
∀, ∃ or ⇒, in prose. Never use one notation for two things. Name a subterm that persists
("name and conquer").
- Knuth: "Don't use the same notation for two different things." Halmos: "The best notation
  is no notation."

### State a definition twice, in two kinds
Give what the thing is (its construction) and what it does or is the smallest of (a
property). Each reading reinforces the other.
- Knuth: "Try to state things twice, in complementary ways, especially when giving a
  definition."
- Page: "rank(i) counts the ones before position i; equivalently, it is the position,
  counting only the ones, of the first one at or after bit i."

### Say a derivation's recipe before its steps
Before a chain of equations or a codewalk, one sentence says what the steps will do. Write
the derivation forward, so a constant appears where the reasoning needs it, not as a magic
opening.
- Halmos: replace a chain of equalities with "a recipe for action … 'For the proof, first
  substitute p for q, then collect terms, permute the factors, and, finally, insert and
  cancel a factor r.'" And: "write the proof forward … the forward one is graspable and
  rememberable."

## Signposts and hedges

### Signpost the subject, not the document
A signpost names the next question about the subject, or recalls where "we" have been. It
does not describe the document ("This section explains…", "In the following we present…").
- Pinker: "This chapter discusses the factors that cause names to rise and fall in
  popularity" becomes "What makes a name rise and fall in popularity?"; "The preceding
  paragraph demonstrated that…" becomes "As we have seen, …".
- Knuth's synchronisation clauses are the kind to keep, because they track the argument's
  goals: "therefore only the condition P ⊆ A_n needs to be verified"; "The lemma is half
  proved."
- Wilf's detector, via Knuth: "Whenever I see 'Consider the following . . .' I know the author
  really means to say 'Here comes something from the left field bleachers.'" It marks a
  missing need.

### Keep the hedges that carry content
A qualification that states a scope or a magnitude builds trust: "this holds for blocks up
to 2^16 bits", "about 90% right". Cut hedges of process (the author's doubt leaking in),
liability (insurance against being wrong) and worth (apologising for the topic).
- Pinker: good writers hedge, but "their hedging is a choice, not a tic". Replace a hedge with
  the actual circumstances or magnitude.
- Thomas & Turner's classic style excludes all three kinds; Pinker and the skill keep the
  scoped ones. A staged naive attempt is not a hedge of process: the author knows where it
  breaks.

### Check every "obviously"
For each "obviously", "clearly", "trivially" and "it is easy to see", ask Halmos's
questions: was it still obvious months later, would it survive a live listener, and is it
true? If it fails, show it or say where it stands.
- Halmos: "Did your assurance consist of demonstration or intimidation?" and "make sure that
  the 'obvious' is true."
- `scripts/page-stats.mjs` lists these words with their context.

### Show care through reasons, not adjectives
"Remarkably" and "elegantly" tell the reader what to feel. The reason (the naive bound was
n log n, this is n) shows it.
- Knuth: "let the results speak for themselves or … give reasons why".

## Diagnostics

Run these on a section that reads badly. Each is mechanical, which is the point: the author
cannot find these faults by rereading. `scripts/page-stats.mjs` also takes a plain `.txt`
file, so a single pasted paragraph can be checked for "obviously", document signposts and
empty verbs.

When revising someone else's paragraph to "say the same thing more clearly":
- Only the sentence rules apply; leave the page-level moves (core loop, opening, checks)
  alone unless asked.
- Showing an "obviously" may use only facts already in the text (computing a percentage from
  the sizes it gives is fine). If it needs a new fact, flag it instead of adding it.
- If a term's meaning is unclear (a coined label, a third name for something), do not guess:
  replace it only when the text fixes its meaning, and otherwise flag it.

1. **Gopen's four questions**, of each sentence: "What is happening?", "Whose story is this?",
   "What word or words require more emphasis?", "How does this sentence (or paragraph)
   connect fore and aft to its neighbors?"
2. **List the topics.** Write down the first few words of every sentence in a paragraph. They
   should tell one consistent story. In Gopen & Swan's earthquake paragraph they read
   "Large earthquakes / The rates / Therefore … one / subsequent mainshocks / …", so "the focus
   of the story contains shifts".
3. **Circle the stress.** Circle what you want stressed in each sentence. Gopen: "Note how
   often the circled words do not appear immediately before the period." Judge by eye:
   reading your own prose aloud, you stress the right words whether or not the sentence does.
4. **Underline six words.** If the verb has not arrived and the subject is not a character,
   rewrite (Williams).
5. **Blank the jargon.** Replace the technical terms with [A], [B], [C]. If the paragraph is
   still hard to follow, the problem is structural, not vocabulary (Gopen & Swan's URF
   passage).
6. **Name each join.** Write the connective (because, but, so, for example) between each pair
   of sentences. A pair with none is a gap (Pinker).
7. **Find the point.** For each paragraph, mark the one sentence that states its point
   (Williams). No sentence, no point.
8. **Read with blahs.** Replace formulas and identifiers with "blah" (Knuth).
