# Drafting with another model

How to get teaching prose from a model that drafts or revises it: the prompt to give it, what
each current model gets wrong, and the checks that catch what the prompt misses. Read it when
an author asks for a prompt, a system prompt, custom instructions or an `AGENTS.md` block that
makes GPT or Claude write explanations, or asks why a model's drafts are hard to follow.

The model findings are dated 2026-11-13. They come from vendor guides, a few independent
reviews and forum reports, not controlled tests on explanatory prose (see
[Sources](#sources)). Re-check them when a model changes, and treat each as a hypothesis to test
on the author's own passages.

## Contents

- The workflow
- The base prompt
- What each model gets wrong
- Settings
- Reasoning versus explanation
- Sources

## The workflow

1. **Remove conflicting rules before you add new ones.** Search the system prompt, custom
   instructions, `AGENTS.md` and any skill file the model reads for "concise", "brief", "short"
   and "high-level summary". GPT-6.1 Sol and both Claude 5.5 models follow instructions
   literally, so a leftover brevity line wins over a later request for depth. When UNICEF's
   adt-studio moved 43 prompts to Sol, adding a guidance paragraph changed nothing measurable;
   rewriting the conflicting rule where it sat fixed the regression. Edit in place, and state
   each rule once: repeating a rule to be safe makes Sol's results worse.
2. **Give the base prompt**, plus the lines for the model in use.
3. **Draft.**
4. **Review in a separate call.** A rule in the drafting prompt only pushes so far (the LearnLM
   team found the same for pedagogy in general), so make the cold read its own request: "Reread
   this as a newcomer who has read it once and taken no notes. List every place they would
   stop to work out the meaning. Then rewrite only those places." This is the cold read from
   [review.md](review.md), done by the model.
5. **Check precision.** List every claim, condition, exception and reason in the source or the
   earlier draft, then confirm the rewrite keeps all four kinds. Two failures are common:
   untranslated (the jargon stays and the reader follows along without learning) and hollowed
   out (a precise term becomes a vague one, and the reader leaves confident and wrong).
6. **Measure on the author's own passages**, before and after, rather than trusting this file.

## The base prompt

Each line restates a rule from this skill as a requirement the model can check. Fill in the
reader and the goal; a prompt that names no reader gets prose for no one. The block has no
length rule on purpose: it says what to leave out, not how long to be, so it does not
conflict with the per-model lines below (a literal model obeys both halves of a conflict).

```text
Reader: <who they are; what they already know; what they don't>.
Goal: after one read, the reader can <do X / predict Y> without help.

Write to be understood on the first read. An explanation the reader has to reread or decode
has failed. Leave out what this reader does not need, but never compress what they do need
into fragments, abbreviations or jargon.

Every explanation contains:
- the question or problem it answers, before the answer;
- one example with real numbers, worked step by step for the reader, before the general rule;
- the reason for each step ("because ..."), not only the step;
- the conditions under which each claim holds, and its exceptions.

Put each section's point in its first one or two sentences, then the example and the reasons
that support it.

Define each technical term in plain words when it first appears, after the reader has seen
what it names; then use the same term for that thing throughout. Do not coin labels or
hyphenated compounds. No arrows or shorthand in prose. Write paragraphs; use a list only for
parallel items or steps the reader performs. Name the relation between sentences: "because",
"so", "but".

Precision: simplify the wording and the order of ideas, never the claim. Keep every number,
condition, exception and qualifier. If a simplification is only approximately true, say so
and say how far off it is.
```

## What each model gets wrong

### GPT-6.1 Sol: it compresses

Forum users report answers about half as long as GPT-5.6 Sol's, with the context, reasons and
examples cut, and say custom instructions asking for depth did not bring them back. Sol also
does exactly what the prompt says, so a conflicting rule is obeyed rather than reconciled.
OpenAI's GPT-6 guide warns that "Be concise" can make answers too brief, and that the family
invents compound labels ("exact-head checks"). Add to the base prompt:

```text
Length is not a constraint here. Do not compress. Do not refer to reasoning the reader has
not seen; restate it.
```

### GPT-6 Astra: it fragments

OpenAI's guide, written from Astra's behaviour, says it "tends to use lists, tables and Markdown
to make responses scannable" and "may use recurring phrases across sessions". Reviewers find its
sentences built on abstract nouns, explanations repeated after the reader already has them, and
rule-of-three and "not this but that" moves; it can underdeliver unless pushed. It is easy to
steer once a pattern is named, and it was the strongest editor of first sentences and idea
order in Every's test. Conflicting guidance in a skill file can make it stop early, so the
first workflow step matters most here. Add:

```text
Never break an explanation into bullets: the links between ideas are the explanation. Make
the actors the subjects of your sentences and the actions their verbs ("the encoder stores
each length in four bits", not "storage of lengths occurs at a four-bit width"). After a term
is defined, use it without explaining it again. Do not stop at a summary of the idea. Avoid
groups of three when there are not three things, and "X, not Y" contrasts nobody asked about.
```

### Claude Opus 5.5: it pads and buries the point

Its sentences are the most readable measured so far (Flesch-Kincaid grade 6.95, Every), but it
"still buries the point": it took 37 to 39 sentences where the reviewer used 21. Arize found its
stock phrases halved against Opus 5, with salience flags ("This matters.") still the most common,
bold lead-in bullets up about 2.5 times and three-part lists up 35%. It can diagnose what a
paragraph needs and then write a revision that ignores the diagnosis, so do not rely on it to
apply its own critique: have it list the problems, then rewrite in a second request with the
list in hand, or edit the order yourself. Anthropic's guide says the Opus 5 patterns remain a
starting point; remove the Opus 5 conciseness line ("give a high-level summary unless an
in-depth one is specifically requested") from any teaching prompt. Add:

```text
When something matters, show why through its consequence, with a number or a case, instead
of saying that it matters. No bold lead-ins on list items. Say what you mean literally: when
a literal phrase exists ("a parameter worth varying"), do not use a figure of speech ("a dial
worth turning").
```

The last line is the short form of Anthropic's "mannered prose" instruction, measured on Fable
5.1, where style instructions held better in the first user turn than in the system prompt.

### Claude Sonnet 5.5: it is literal, and better at revising

There is little evidence on its explanatory prose; the reviews are mostly about fiction. They
find it a better reviser than drafter, close to constraints but stilted under strict ones, and
weaker at open-ended judgment. Anthropic's Sonnet 5 guidance, which the 5.5 guide keeps as the
starting point, says it does not infer requests that were not made and that style lines such as
"be concise" may now be applied too strictly. Give it scoped tasks with an example of the
target style, for example a revision pass over an Opus 5.5 draft: "Move each section's point
to its first two sentences; change nothing else." That pairing has not been tested on
explanatory prose.

## Settings

- **Opus 5.5:** effort defaults to `medium`; draft at `high` or above, where reviewers saw less
  padding. Thinking cannot be turned off.
- **Sonnet 5.5:** effort defaults to `high`. Do not draft with `thinking: {type: "between_tools"}`:
  in a request with no tools it answers without thinking first.
- **Sol and Astra:** use high reasoning effort for drafting; neither accepts `none`. OpenAI's
  current GPT-6 guide does not document a verbosity parameter, so check the API reference before
  relying on one. The guide recommends GPT-6.1 Terra for writing; it is not assessed here.

## Reasoning versus explanation

On both Claude 5.5 models, a prompt that asks the model to write its own reasoning into the
answer ("show your thinking step by step in the response") can be declined with the
`reasoning_extraction` refusal category. A worked example for the reader is not that: ask for
the example to be "worked for the reader", or for "an explanation of each step", never for the
model's reasoning.

## Sources

Read in full unless marked. Reviews are single outlets with their own prompt sets.

| Source | What it supports |
| --- | --- |
| [OpenAI: Using GPT-6](https://developers.openai.com/api/docs/guides/prompt-guidance) | Astra's formatting and recurring phrases, the writing and anti-slop blocks, brevity warning, skill-file sensitivity, Terra for writing |
| [OpenAI forum: preserve the depth of 5.6 Sol](https://community.openai.com/t/preserve-the-depth-of-5-6-sol-in-future-models-astra-6-6-1-sol-fails-in-this-aspect/1404941) | Sol and Astra answers about half as long, prompting did not restore depth (user reports) |
| [UNICEF adt-studio #954](https://github.com/unicef/adt-studio/issues/954) | Sol's literal following; appended guidance had no effect, in-place rewrites did |
| [Thomas Wiegold: GPT-6.1 Sol review](https://thomas-wiegold.com/blog/gpt-6-1-sol-review/) | "does what you write, which isn't always what you mean" |
| [Anthropic: Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5), [Sonnet 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5), [best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | Effort defaults, `between_tools`, `reasoning_extraction`, Opus 5 patterns as the starting point |
| Anthropic: Prompting Claude Opus 5, Sonnet 5 and Fable 5.1 (via Anthropic's API skill, summarised) | The Opus 5 conciseness line and "readable versus concise" block, Sonnet 5's literalness, mannered prose and first-turn placement |
| [Every: Vibe Check on Opus 5.5](https://every.to/vibe-check/vibe-check-opus-5-5-is-pulling-our-codex-converts-back-to-claude) (summarised) | Grade 6.95, 37–39 versus 21 sentences, weak self-editing, Astra as the stronger editor |
| [Arize: Anthropic says it fixed Claude's writing](https://arize.com/blog/anthropic-says-it-fixed-claudes-writing/) (summarised) | Stock-phrase counts per 1,000 words, Opus 5 versus 5.5 |
| [Novelmage: Sonnet 5.5 for creative writing](https://novelmage.com/blog/claude-sonnet-55-for-creative-writing-reviser-not-muse) (summarised) | Reviser rather than drafter, literal, weaker open-ended judgment |
| [Intellectual Lead: Astra writing review](https://intellectualead.com/chatgpt-writing-review/), [Forward Future: Astra review](https://signals.forwardfuture.com/astra-review/), [Yiannis Antoniou on Astra](https://yiannisantoniou.substack.com/p/gpt-6-astra-is-excellent-but-way) (summarised) | Abstract nouns, sentence lengths, rule of three, steerability, repetition, underdelivery |
| [arjunprabhulal: plain-language skill](https://www.skills.sh/arjunprabhulal/agent-skills/plain-language) (opening only) | Untranslated versus hollowed out |
| [LearnLM technical paper, via a summary](https://garyliang.substack.com/p/google-learnlm-technical-paper) | Prompting alone moves pedagogical behaviour only so far |

The claim-condition-exception-reason check comes from a Medium post seen only as a search
snippet (Maya Bennett, "GPT-6 Sol Says Less"); the separate review pass and the base prompt are
this skill's synthesis.
