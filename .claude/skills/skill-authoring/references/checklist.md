# Review checklist

The skill equivalent of `npm run check`. Run `node scripts/lint-skill.mjs <skill-dir>`
first (from the repo root); it covers the items marked *lint*. The rest need judgment.
Lead a review with what stops the skill loading or triggering, then what wastes context,
then style, and give a fix for each finding.

## Contents

- Loads
- Triggers
- Earns its context
- Portable
- Tested
- Maintained

## Loads

- [ ] *lint* `SKILL.md` exists and starts with parseable frontmatter. Broken YAML makes
  Claude Code load the body with no description.
- [ ] *lint* `name` is at most 64 characters, lowercase letters, digits and hyphens, equals
  the directory name, and has no `claude` or `anthropic` in it.
- [ ] *lint* `description` is present and at most 1,024 characters, with no angle brackets.
- [ ] *lint* every link in `SKILL.md` and the references resolves.

## Triggers

- [ ] *lint* The description is third person and says when to use the skill.
- [ ] The description uses the words people type and names the near misses with the
  neighbour that owns each ("Not for …").
- [ ] `evals/trigger-evals.json` has about twenty queries, half of them near misses, and the
  last run passed on the held-out part ([evals](evals.md#trigger-evals)).
- [ ] Checked against every other skill in the repo and the user's own: no stolen prompts.

## Earns its context

- [ ] *lint* `SKILL.md` is at most 500 lines; detail is in `references/`.
- [ ] *lint* every reference is linked from `SKILL.md`, says when to read it, and files over
  100 lines open with a contents list.
- [ ] The rules that must survive compaction are in the first 5,000 tokens.
- [ ] Every instruction passes "would Claude do this without it?" (the baseline shows it
  would not). Delete the ones that fail.
- [ ] Reasons are given with rules ("do X because Y"), not bare ALWAYS/NEVER.
- [ ] One term per concept throughout.
- [ ] Time-sensitive guidance sits in an "old patterns" section.
- [ ] Scripts solve problems (handle their errors, print specific messages) instead of
  deferring to Claude, and `SKILL.md` says whether to run or read each one.
- [ ] A rung is used only where a signal justified it ([ladder](ladder.md)).

## Portable

- [ ] *lint* no repo-root path (`.claude/skills/<name>/…`) to a bundled file.
- [ ] *lint* only cross-surface frontmatter fields, or each Claude Code-only field earns its
  place (the lint warns).
- [ ] Forward slashes in paths. Dependencies named, and available where the skill runs (the
  API has no network and no runtime installs).

## Tested

- [ ] *lint* `evals/` exists.
- [ ] At least three output cases from the baseline's gaps, each with a result grader and a
  steps grader; none scores the same with and without the skill.
- [ ] Both evals ran on the pinned models, the numbers are in the PR, and one with-skill
  transcript was read.
- [ ] Tried on one real task.

## Maintained

- [ ] `references/sources.md` exists if the skill makes evidence-based claims, and says what
  was read in full, what was summarised, and what is the author's synthesis.
- [ ] The skill names the neighbouring skills and the one it defers to.
- [ ] The next review trigger is stated: a model change, a change to a skill it overlaps, or
  a transcript that shows a miss.
