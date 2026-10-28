# Maintaining a skill

A shipped skill goes stale in four ways: the models change, the files it describes change,
a neighbouring skill changes, or it stops earning its context. Check each on a schedule
instead of waiting for someone to notice.

## Contents

- Re-run on every change
- Read transcripts after real use
- Claude stops following a skill
- Context cost
- Portability
- Retire, merge or split
- Old patterns

## Re-run on every change

- Any edit to `SKILL.md`, a reference or a script: run the lint, the output evals and, if
  the description or a neighbour's description changed, the trigger evals.
- A new skill in the repo or in the user's configuration: re-run the trigger evals of the
  skills closest to it, since a new description can take their prompts.
- A new model: re-run both suites on it. A rule written for a weaker model may now be dead
  weight, and a case that scored `Δ ≈ 0` may now be one the skill no longer needs.
- Record the date, models, command and scores in the PR or the commit. A score without those
  cannot be compared next time.
- To show that an edit helped, and not only that the skill helps, compare against the
  previous version of the skill, not just the no-skill baseline
  ([evals](evals.md#comparing-with-the-previous-version)).

## Read transcripts after real use

Scores say whether; transcripts say why. After a skill has been used for real work, read
two or three runs for:

- steps skipped, or done in a different order from the skill's;
- references never opened (unneeded, or badly signposted), or the same one opened every run
  (move it into `SKILL.md`);
- a helper script written again and again (bundle it);
- the user's corrections, which name rules the skill lacks.

Turn each finding into an eval case first, then change the skill.

## Claude stops following a skill

Three different causes, three different fixes (from the Claude Code docs):

- **A rule that must hold every time was skipped.** Prose cannot guarantee it: move it to a
  hook or a repo check.
- **Guidance that needs judgment was skipped.** Word it so it covers the whole task ("run the
  tests after every edit", not "run the tests"). The skill's text is added to the
  conversation once, when it is invoked; it is not re-read on later turns.
- **After compaction.** Claude Code re-attaches the most recent invocation of each skill,
  keeping the first 5,000 tokens of each, within a shared 25,000-token budget filled from the
  most recently invoked skill. Older skills can be dropped. Put the rules that must survive at
  the top; invoke the skill again to restore it.

## Context cost

Every skill's name and description are always in context.

- The listing is capped by a budget of 1% of the context window; when it overflows, the
  descriptions of the least-used skills are dropped first, which removes the keywords that
  let them match. The budget is the `skillListingBudgetFraction` setting.
- `/context` shows the Skills row (the listing after the budget); `/doctor` estimates the
  listing's cost and biggest contributors; `/skill-doctor` reports each skill's cost, its
  recent use, and skills that have never been invoked. `/skill-doctor` is a usage report, not
  a linter. `claude plugin validate <path>` checks structure.
- Each entry's `description` + `when_to_use` is truncated at 1,536 characters in the listing
  (the cap is the `skillListingMaxDescChars` setting). Trim a description that is longer
  than the triggering needs, and put the key use case first.
- To keep a rarely used skill listed without paying for its description, set it to
  `"name-only"` in `skillOverrides` (settings); `"off"` hides it and `"user-invocable-only"`
  keeps it for `/skill-name` alone. This changes how the skill triggers, so re-run its trigger
  evals if it stays enabled for Claude.

## Portability

Check on each change, and when adopting a new host:

- the lint's cross-surface warnings;
- paths relative to the skill directory, not the repo root;
- the 1,024-character description limit, which pi enforces;
- the API: no network, no runtime package installs, `name` and `description` only;
- that evals do not depend on Claude Code: `evals/` is plain files, and pi ignores it. This
  has **not** been tested in pi ([sources](sources.md)).

## Retire, merge or split

- **Retire** a skill that `/skill-doctor` shows never invoked over a month, or whose cases
  all score `Δ ≈ 0` on the current model: Claude does it unaided.
- **Merge** two skills whose trigger evals keep stealing each other's prompts, or that are
  always loaded together.
- **Split** a skill whose body has two audiences: a reference file that only half of the
  tasks read is a separate skill waiting to happen. Do it when the trigger evals can tell
  the two halves apart.
- When retiring, say so in the commit and remove the skill's name from neighbours' "Not for"
  lists.

## Old patterns

Do not date guidance inline ("before August 2026, use X"). Keep the current method in the
main text and put the superseded one in a collapsed section so the history stays without
costing attention:

```markdown
## Old patterns

<details>
<summary>The v1 method (superseded 2026-10)</summary>
…
</details>
```
