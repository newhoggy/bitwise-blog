# Writing the description

The description is the only part of a skill that is always in context, and Claude uses it
alone to decide whether to load the rest. A wrong description fails silently: the skill
just never runs, or runs on the wrong task.

## Contents

- Rules
- Drafting procedure
- The skill does not fire
- The skill fires too often
- Limits and cost

## Rules

- **Third person, and both halves.** "Guidelines for X. Use when Y." Not "I help you with
  X" or "You can use this for X". Say what the skill does *and* when to use it.
- **Use the words people type.** Name the phrasings of the task ("review this page",
  "this skill isn't firing"), not only the name of the topic.
- **Lean pushy where the skill is under-used.** skill-creator's guidance is that Claude
  under-triggers, so add "even if the request doesn't say X" and name adjacent phrasings.
  Skip capitals and "ALWAYS/MUST": the evaluation guidance finds reasons work better than
  shouting, and nothing here shows shouting helps triggering.
- **Name the near misses.** End with "Not for …", naming the neighbouring skill or tool
  that owns each, so the two descriptions divide the territory between them.
- **At most 1,024 characters** (the cross-surface limit, and pi's). Claude Code accepts
  `description` plus `when_to_use` up to 1,536 characters combined, but a skill meant to
  load in pi or the API stays within 1,024. Put the key use case first.
- **No angle brackets** (XML tags are rejected on the API), no reserved words in the name
  (`claude`, `anthropic`), and no first person.
- A user-only skill (`disable-model-invocation: true`) has its description removed from
  context, so it can be short; still write it for the person scanning `/` completions.

## Drafting procedure

1. List five to ten real prompts that should load the skill, in different registers
   (terse, chatty, precise).
2. List five to ten that look similar but belong to another skill or to plain Claude. Take
   them from the neighbours' own descriptions.
3. Draft the description from step 1's words, then add "Not for …" from step 2.
4. Write `evals/trigger-evals.json`: about twenty queries, roughly half should-trigger and
   half should-not, with the near misses the hard half. Set about 40% of them aside as
   `"heldout": true` before you tune ([evals](evals.md#trigger-evals)).
5. Run `npm run trigger-evals -- <skill-name>`, edit the description against the failing
   *train* queries only, and run it again. Generalise from a failure (the category of
   prompt it stands for) instead of copying its keywords into the description. Keep the
   description that scores best on the held-out queries, not on the ones it was tuned on.
6. Check the near misses against **every other skill in the repo and in the user's
   configuration**, not only the one beside it. A new description can steal prompts from an
   old skill.

## The skill does not fire

Work down the list; stop at the first cause you find.

1. **Frontmatter does not parse.** Claude Code then loads the body with empty metadata:
   `/skill-name` works but the description is never matched. Run
   `claude plugin validate .claude/skills` and `claude --debug`.
2. **The description was dropped.** Past the listing budget (1% of the context window)
   Claude Code drops the descriptions of the least-used skills first. `/context` shows the
   Skills row; `/skill-doctor` shows listing cost and use.
3. **The prompt does not look like the description.** Compare the words. Add the user's
   phrasing and "even if …".
4. **A neighbour is taking it.** Two descriptions that overlap split the prompts. Sharpen
   both "Not for" clauses.
5. **`paths:` excludes the files** Claude is working on (it only matches inside the working
   directory, so not a sibling worktree).
6. **It fired, but Claude did not follow it.** That is a body problem, not a description
   problem: see [maintenance](maintenance.md#claude-stops-following-a-skill).

Then measure: add the failing prompt to `trigger-evals.json` and re-run, so the fix is
shown rather than felt. A fix that passes the one prompt and breaks others shows up only in
the full set.

## The skill fires too often

Make the description more specific, add the false positives to `trigger-evals.json` as
should-not queries, and add the neighbour's name to "Not for". If the skill has side
effects, set `disable-model-invocation: true` instead.

## Limits and cost

Every skill's name and description are in context in every session. Check
`/context` after adding a skill. Raise the budget with `skillListingBudgetFraction`, or
trim descriptions: a description that is longer than it needs to be costs every other
skill's visibility.
