# Measurements

Run on 2026-10-22 and 23 with Claude Code 2.1.300. Agent `claude-sonnet-5-5`, judge
`claude-haiku-5-5`, three runs per case per arm, `-j 4`. Each case is graded as the fraction of
its graders that passed, averaged over runs; `Δ` is with-skill minus without.

**These are small samples.** Three runs move a case in steps of a third, and re-running
`pedagogical-writing` after fixing two of its graders moved single cases by up to 0.4 (the
`revise-directory-paragraph` Δ went from +0.17 to −0.17, with no change to the skill). Read the
mean across cases, and the sign across cases, not any one number.

## Contents

- `skill-authoring` output evals, three agent models
- `pedagogical-writing` output evals
- Trigger evals

### `skill-authoring` output evals (5 cases, three agent models)

Judge `claude-haiku-5-5` throughout. The suite was revised after a self-review against its own
rules, which said a case that scores the same with and without the skill should be dropped:
`skill-or-claude-md` (Δ 0.00) and `design-user-only-skill` (Δ +0.06) were deleted, a
`portable-frontmatter` case added in the same revision was deleted after its first run (Δ −0.07:
Claude already knows which fields are Claude Code only), and `needs-a-script` and
`merge-overlapping-skills` were added. Two graders were changed after seeing 0 of 3 in both arms:
`runs-loop` (the skill no longer recommends `run_loop.py`) became `run-trigger-evals`, and
`reruns-output-evals` became an `llm` rubric. Section 1 of `SKILL.md` (a generic skill-versus-
`CLAUDE.md` table) was cut to the repo-specific parts for the same reason.

| Case | Sonnet with / without | Haiku with / without | Opus with / without |
| --- | --- | --- | --- |
| add-evals | 1.00 / 0.14 (+0.86) | 1.00 / 0.19 (+0.81) | 1.00 / 0.14 (+0.86) |
| merge-overlapping-skills | 1.00 / 0.40 (+0.60) | 0.73 / 0.07 (+0.67) | 1.00 / 0.20 (+0.80) |
| review-flawed-skill | 1.00 / 0.67 (+0.33) | 0.62 / 0.42 (+0.21) | 0.92 / 0.83 (+0.08) |
| needs-a-script | 1.00 / 0.73 (+0.27) | 0.80 / 0.73 (+0.07) | 0.93 / 0.80 (+0.13) |
| fix-not-firing | 1.00 / 0.80 (+0.20) | 1.00 / 0.73 (+0.27) | 1.00 / 0.73 (+0.27) |
| **Mean** | **1.00 / 0.55 (+0.45)** | **0.83 / 0.43 (+0.40)** | **0.97 / 0.54 (+0.43)** |
| Cost, time | $1.89, 3.0 min | $0.16, 2.9 min | $4.08, 4.1 min |

How to read it:

- **The cases are tuned to this skill.** Sonnet's 1.00 on every case is a ceiling reached after
  iterating on these cases and this text, so it shows the skill delivers what it teaches, not that
  it generalises. The honest comparison is Δ, and a Δ near zero on a case means Claude already does
  it: `fix-not-firing` (+0.07 to +0.27 across runs) and `needs-a-script` (+0.07 to +0.27) are the
  weakest.
- **Haiku gets less from the skill where the task is judgment.** The review case scores 0.62 with
  the skill (+0.21), and `needs-a-script` +0.07, against 1.00 for Sonnet. This is the gap the best-
  practices guide warns of: a skill that is clear enough for Sonnet is thinner for Haiku. Not
  fixed here.
- **Opus loses most of the review gain** (+0.08): without the skill it already finds most of the
  flaws in the fixture. The unaided gaps are the description limit and missing `evals/`.
- Earlier runs of the previous five-case suite on Sonnet gave a mean Δ of +0.26 and +0.30, which
  is the size of the run-to-run movement to expect.

### `pedagogical-writing` output evals (6 cases, converted from `evals.json`)

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| rewrite-token-bucket | 1.00 | 0.47 | +0.53 |
| design-rank-interactive | 0.81 | 0.38 | +0.43 |
| outline-bloom-filters | 0.58 | 0.33 | +0.25 |
| review-deflate-page | 0.94 | 0.83 | +0.11 |
| plan-rank-select-series | 0.62 | 0.52 | +0.10 |
| revise-directory-paragraph | 0.56 | 0.72 | −0.17 |
| **Mean** | **0.75** | **0.54** | **+0.21** |

Cost $4.34, 10.5 minutes. An earlier run of the same suite, before two grader fixes and a longer
timeout for the review case, gave a mean Δ of +0.25, with `review-deflate-page` at −0.28 because
one with-skill run hit the 300 s limit. Observations:

- The skill helps most where it supplies a method the prompt does not mention (the token-bucket
  rewrite, the interactive design) and least where the task is mechanical (the paragraph
  revision) or the output is long and judged strictly (series planning).
- Two graders failed in both arms in both runs: the "each page teaches one concept and the plan
  says what the reader can do" check of `plan-rank-select-series`, and the "each section introduces
  exactly one new idea" check of `outline-bloom-filters`. By the agentskills.io guidance such
  graders are broken or too strict, not evidence about the skill. They are kept as converted so the
  conversion is faithful, and are listed in the PR as follow-up work on that skill's evals.
  (A third, "each finding gives a location, the missing beat and a fix" in `review-deflate-page`,
  failed in the first run and passed in 2 of 3 with-skill and 1 of 3 baseline runs in the second.)
- `review-deflate-page` cannot run the skill's `page-stats.mjs` audit: running it needs `Bash`
  and the sandbox refuses `Bash` here (see above), and the skill names the script by a repo-root
  path that does not exist in the sandbox anyway (#77).
- A `not_contains` grader on "obviously" failed for both arms because the answers quote the word
  while explaining what changed; it was changed to an `llm` grader.

### Trigger evals (`scripts/run-trigger-evals.mjs`)

| Skill | Description | Should fire | Should stay quiet | Cost |
| --- | --- | --- | --- | --- |
| `skill-authoring`, first draft | 842 characters | 7 of 12 | 10 of 10 | $4.80 |
| `skill-authoring`, after one edit | 986 characters | 11 of 12 (12 of 12 once one query was reworded, see below) | 10 of 10 | $7.54 |
| `skill-authoring`, 6 held-out queries | as above | 3 of 3 | 3 of 3 | (in the row above) |
| `pedagogical-writing` | 817 characters | 11 of 12 | 10 of 10 | $3.97 |

The edit named what the five missed queries were about (frontmatter fields and limits, user-only
invocation, `claude plugin eval`, linting) in the description. Four of the five then fired in all
three runs. The fifth ("my pedagogical-writing skill didn't fire when I asked Claude to review the
deflate page") kept missing, because the prompt reads as a request about the page, which another
skill owns; it was reworded to "my pedagogical-writing skill never seems to load when I ask for a
page review. how do I find out why?", which fires 3 of 3. That is a change to the query after
seeing it fail, not to the description, and is recorded so it is not mistaken for a result. The
held-out queries were written before tuning and not looked at until the end, but the set is small:
this shows no over-fit, not that there is none. Nothing stole prompts: the should-quiet half stayed at 0
triggers in every run. Its one miss for `pedagogical-writing` is "is this ADR's context section
clear enough for someone joining the team next month", which `pedagogical-writing` does not claim.
