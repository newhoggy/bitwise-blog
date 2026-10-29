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
- Re-run on 2026-10-28, after the quoting and held-out edits
- 2026-10-29: the two always-failing graders, and what limits `review-deflate-page` needs
- 2026-10-29: `pedagogical-writing`'s ADR query relabelled and its neighbours named
- 2026-10-30: #25's misses read from traces, and the #17 errors
- 2026-10-30: `pedagogical-writing`'s must-hold sections moved ahead of the catalogue (#85)
- 2026-10-30: errored trigger-eval runs no longer score (#94)
- 2026-10-30: why Haiku got little from `skill-authoring`, and the description change (#86)

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
  practices guide warns of: a skill that is clear enough for Sonnet is thinner for Haiku. The
  cause was not the body: Haiku did not load the skill on those cases (fixed on 2026-10-30, last
  section).
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
  (Both were replaced on 2026-10-29; see the last section.)
  (A third, "each finding gives a location, the missing beat and a fix" in `review-deflate-page`,
  failed in the first run and passed in 2 of 3 with-skill and 1 of 3 baseline runs in the second.)
- `review-deflate-page` cannot run the skill's `page-stats.mjs` audit: running it needs `Bash`
  and the sandbox refuses `Bash` here (see above), and the skill names the script by a repo-root
  path that does not exist in the sandbox anyway (#77).
- A `not_contains` grader on "obviously" failed for both arms because the answers quote the word
  while explaining what changed; it was changed to an `llm` grader.

### Trigger evals (`scripts/run-trigger-evals.mjs`)

Every trigger result above the 2026-10-30 section on errored runs (#94) counted errored runs in
the score; they are not rescored.

| Skill | Description | Should fire | Should stay quiet | Cost |
| --- | --- | --- | --- | --- |
| `skill-authoring`, first draft | 842 characters | 7 of 12 | 10 of 10 | $4.80 |
| `skill-authoring`, after one edit | 986 characters | 11 of 12 (12 of 12 once one query was reworded, see below) | 10 of 10 | $7.54 |
| `skill-authoring`, 6 held-out queries | as above | 3 of 3 | 3 of 3 | (in the row above) |
| `pedagogical-writing` | 817 characters | 11 of 12 | 10 of 10 | $3.97 |
| `pedagogical-writing`, 6 held-out queries (added 2026-10-28, Claude Code 2.1.310) | as above | 2 of 3 | 3 of 3 | $0.88 |

The edit named what the five missed queries were about (frontmatter fields and limits, user-only
invocation, `claude plugin eval`, linting) in the description. Four of the five then fired in all
three runs. The fifth ("my pedagogical-writing skill didn't fire when I asked Claude to review the
deflate page") kept missing, because the prompt reads as a request about the page, which another
skill owns; it was reworded to "my pedagogical-writing skill never seems to load when I ask for a
page review. how do I find out why?", which fires 3 of 3. That is a change to the query after
seeing it fail, not to the description, and is recorded so it is not mistaken for a result. The
held-out queries were written before tuning and not looked at until the end, but the set is small:
this shows no over-fit, not that there is none. Nothing stole prompts: the should-quiet half stayed at 0
triggers in every run. The six `pedagogical-writing` held-out queries were written after its
description was final. One of them ("give me a better running example for the arithmetic
coding explainer, the numbers I picked don't come out clean") fired in 1 of 3 runs the first
time and 2 of 3 in the re-run below: one query moves by that much between runs, so a single
3-run result is not a miss or a pass. The description was not tuned against it. Its one miss on the
original 22 queries is "is this ADR's context section clear enough for someone joining the team next month", which `pedagogical-writing` does not claim.

### Re-run on 2026-10-28, after the quoting and held-out edits

Claude Code 2.1.310, the same models (agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`), three runs per
arm per case, `-j 4`. It follows the edit that quoted `skill-authoring`'s description and added six
held-out queries to `pedagogical-writing`.

| Suite | Result | Earlier | Cost |
| --- | --- | --- | --- |
| `skill-authoring` trigger evals (28 queries: 22 train, 6 held-out) | 28 of 28 (train 22 of 22, held-out 6 of 6) | 22 of 22 | $7.52 |
| `pedagogical-writing` trigger evals (28 queries: 22 train, 6 held-out) | 27 of 28 (train 21 of 22, held-out 6 of 6); the miss is the ADR-context query, 0 of 3 | 21 of 22 | $4.92 |
| `skill-authoring` output evals (5 cases) | mean Δ +0.48; with-skill 0.92 to 1.00 | +0.45 | $1.93 |
| `pedagogical-writing` output evals (6 cases, one since deleted) | mean Δ +0.21; `revise-directory-paragraph` Δ 0.00 | +0.21 | $4.95 |

Nothing regressed. Per case, `skill-authoring`: add-evals +0.90, merge-overlapping-skills +0.60,
fix-not-firing +0.33, review-flawed-skill +0.29, needs-a-script +0.27. `pedagogical-writing`:
plan-rank-select-series +0.48, outline-bloom-filters +0.21, rewrite-token-bucket +0.20,
design-rank-interactive +0.19, review-deflate-page +0.17, revise-directory-paragraph 0.00. The
graders that failed in both arms last time still do (`plan-rank-select-series` "each page teaches one
concept", `outline-bloom-filters` "exactly one new idea"), so they remained follow-up work on that
skill's evals (closed on 2026-10-29; see the last section). The `review-deflate-page` case cost $2.62 of the $4.95; it is the one that runs long.

`revise-directory-paragraph` was deleted after this run (Δ 0.00 here, −0.17 and +0.17 in earlier
runs, so the skill does not earn its context on a mechanical rewrite). The tables above keep it
because they record what was run. Over the remaining five cases the same run's mean Δ is +0.25.
The 2026-10-28 `review-deflate-page` case kept its 25 turns and 900 s limit: an earlier with-skill
run hit a shorter limit, so lowering them to save cost would need its own measurement.

### 2026-10-29: the two always-failing graders, and the `review-deflate-page` limits (#83)

Claude Code 2.1.310, the same models, three runs per arm unless stated. I read the final answer of
every run of the two cases first (`aggregate-result.json` keeps it in each grader's `evidence`; the
trace files are deleted after the run unless `--keep-temp` is passed).

**What was wrong with the graders.** Both bundled a claim a judge cannot decide with one it can.

- `plan-rank-select-series` "each page teaches one concept, and the plan says what the reader can
  do after each page". Page 1 of every plan holds rank, a naive scan, a stored-answer table, block
  counts, a popcount and the word "succinct": whether that is one concept is not decidable from a
  plan. The second half is decidable, and it split the arms for a reason unrelated to the skill: the
  only run of six that passed was a baseline plan with a `Goal: The reader can ...` line per page,
  while the with-skill plans describe each page by its need, naive attempt, crack, fix and teaser.
- `outline-bloom-filters` "each section introduces exactly one new idea that follows from the one
  before" failed 0 of 6. "Exactly one" is a count an outline does not support (a with-skill outline's
  section 3 names the filter, the bit array and the hash functions together). "Follows from the one
  before" is checkable, and is what the skill teaches ("a ladder, not a list").

**Replacements**, worded before they were run and not changed afterwards. Rule: keep one if the
with-skill arm passes at least two more of five runs than the baseline, otherwise delete it.

| Grader | With | Without | Result |
| --- | --- | --- | --- |
| plan 01: each page has a sentence saying what the reader will understand or be able to do | 2 of 5 | 0 of 5 | kept, at the threshold; no gap in the later suite run (below) |
| outline 04: for at least three steps the outline says why the next section follows | 5 of 5 | 0 of 5 | kept |

The "one concept per page" and "exactly one new idea" halves are dropped, not reworded: I did
not find a phrasing a judge could decide from a plan or an outline. The plan grader is the weak result. In the full-suite run that
followed (3 runs per arm) it passed 1 of 3 with the skill and 1 of 3 without, so over the eight runs
of each arm it is 3 against 1. Treat it as unproven. The outline grader passed 3 of 3 against 0 of 3 again.

**`review-deflate-page` limits.** Measured on the unchanged case (`max_turns: 25`,
`timeout_seconds: 900`), two sets of three runs per arm:

| Arm | Turns | Seconds | Cost per run |
| --- | --- | --- | --- |
| with-skill | 13, 9, 9 then 11, 13, 9 | 122, 191, 149 then 102, 124, 157 | $0.33 to $0.73 |
| baseline | 13, 7, 10 then 6, 12, 11 | 115, 88, 66 then 115, 84, 95 | $0.22 to $0.63 |

No run came within 12 turns or 700 seconds of its limit, and cost follows the turns taken, not the
limit, so lowering the limits would change none of these runs and only cap a tail that has not
appeared. The cost varies between runs by a factor of two or more at the same turn count. The likely
driver is the 260 KB fixture page re-read on every turn plus the skill's own reads (not measured). The
limits stay as they are; a smaller fixture would cut the cost but would change what the case tests.
Its with-skill score was 0.94 on 2026-10-28 and 0.78 in both sets today with nothing changed, which
is the size of the run-to-run movement for this case (its Δ was +0.17, +0.00 and +0.17).

**Full suite, 5 cases, $4.86, 9.0 minutes.** Mean Δ +0.28 (+0.25 over the same five cases on
2026-10-28). Per case: rewrite-token-bucket +0.40, design-rank-interactive +0.38,
plan-rank-select-series +0.24, outline-bloom-filters +0.21, review-deflate-page +0.17. Every case is
positive, but as the note at the top says, read the mean and the sign across cases, not one
number: review-deflate-page's +0.17 is within the run-to-run movement.

Not done here: two more graders now score 0 in both arms, and were neither read nor reworded.
`outline-bloom-filters` "the crack is located" (03) failed 0 of 6 in the first run today and 0 of 3
in both arms of the full-suite run. `plan-rank-select-series` "prerequisites are named by title"
(03) was 0 of 3 in both arms of the full-suite run. They are the next candidates for the same
treatment.

### 2026-10-29: `pedagogical-writing`'s ADR query relabelled and its neighbours named (#84)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, three runs per query unless stated. These are the
first trigger runs with `anatomy` in `.claude/skills`: the 2026-10-28 runs were made on a tree that
held only `pedagogical-writing` and `skill-authoring`.

**What changed, in order.**

1. The ADR query ("is this ADR's context section clear enough for someone joining the team next
   month…", #9, train) is now should-stay-quiet. It missed in every run since it was written with
   the skill (2026-10-20), and no version of the description has claimed ADRs: the label was a hope,
   not a scope. Most of the skill (need, naive attempt, crack, fix; predictions; a companion voice)
   is wrong for a record whose Context section Nygard calls "value-neutral … simply describing
   facts", and the skill that would take the prompt in practice, `review-adr`, is user-level, so
   the sandbox cannot measure an overlap with it. It stays as a near miss. This is a change to a
   label after seeing it fail, so the 28-query score below rises because of the label, not the
   description.
2. "Not for" names the neighbours: `review-adr`, `dataviz`, `anatomy`, `skill-authoring` and
   `update-config`. `pedagogical-diagrams` (#80) is left to that skill's own change.
3. Two should-stay-quiet held-out queries, written before any run: an isometric figure (#29,
   `anatomy`) and a bar chart (#30, `dataviz`).
4. After run 1, one edit against the train failure #7: "rewriting" and "or a passage of one" in
   "Use when", the category #7 stands for (a passage-level rewrite), not its words. The description
   is 1,009 characters, so a further neighbour needs words taken out elsewhere.

| Run | Description | Result | Cost |
| --- | --- | --- | --- |
| 1 | steps 1 to 3 | 28 of 30 (train 21 of 22, held-out 7 of 8); misses #7 (1 of 3) and #25 (0 of 3) | $5.40 |
| 2 | step 4 added | 29 of 30 (train 22 of 22, held-out 7 of 8); miss #25 (0 of 3); #7 2 of 3 | $5.39 |
| 2, re-run | the five queries with errored runs (#17, #18, #28, #29, #30) | 5 of 5 quiet; #17 and #18 errored again (both clean at 0 of 3 in run 1) | $0.66 |

Every should-stay-quiet query stayed at 0 triggers in every run, the ADR query and both new near
misses included. Errors here are other than the turn cap (the runner does not count that one); a
run that errors cannot fire, so a quiet pass on errored runs counts only with a clean run behind it.

**Was the drop in #7 and #25 the new description?** No. Both queries re-run on their own:

| Query | Old description, with `anatomy` | Step 1 to 3 description, with `anatomy` | Same, without `anatomy` | 2026-10-28, old, without `anatomy` |
| --- | --- | --- | --- | --- |
| #7, rewrite the Elias-Fano intro (train) | 0 of 6 | 5 of 12 | 5 of 6 | passed |
| #25, a better running example (held-out) | 0 of 6 | 0 of 12 | 1 of 6 | 1 of 3, then 2 of 3 |

`anatomy`'s presence is what lowered #7 (5 of 6 without it, 5 of 12 with it); the new description
did no worse than the old with `anatomy` present. In the missed #7 runs Claude answered in one turn
with no tool call: it rewrote the sentence itself. #25 was borderline before and is now a miss; its
runs used four or five turns, one hitting the 3-turn cap, so Claude was most likely looking for the
explainer (absent from the empty sandbox) before choosing a skill. The traces were not kept, so
that is a reading of the turn counts, not of the transcripts. #25 is held-out and the description
was not tuned against it. It is the open miss, and the next thing to try is the harness (a larger
turn cap, or the page in a fixture), not the description. The traces, read on 2026-10-30 (below), rule
out the turn cap.

### 2026-10-30: #25's misses read from traces, and the #17 errors (#91)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, the description and query file of 1132adc. The
runner now keeps each run's trace with `--keep` and prints the text of every error it counts.

| Run | Queries and runs | Result | Cost |
| --- | --- | --- | --- |
| 1 | #25, 6 runs | 0 of 6; every run ended on its own | $0.29 |
| 2 | #25, 6 runs, `--max-turns 10` | 0 of 6; every run ended on its own | $0.29 |
| 3 | #17 and #18, 3 runs | quiet, no errors | $0.21 |
| 4 | the five queries that errored on 2026-10-29 (#17, #18, #28, #29, #30) | quiet, no errors | $0.79 |
| 5 | all 30, 3 runs | 29 of 30 (train 22 of 22, held-out 7 of 8); miss #25 (0 of 3); no errors | $5.49 |
| 6 | #17 and #18, 10 runs | quiet, no errors | $0.71 |

**#25 misses because the sandbox is empty, not because of the turn cap.** Every trace has the same
start: Grep for "arithmetic coding" and Glob for `*arithmetic*` in the working directory, then a
wider Grep or Glob (in some runs one outside the working directory, which is denied, or a Bash
call, which the case does not grant). All come back empty. Claude then says so and writes an
example itself ("I couldn't find the explainer anywhere in the repo, so I don't know which numbers
you picked. Here is a replacement example that works out exactly…"), or asks for the path. No run
called a skill. At the 3-turn cap, 2 of 10 runs (rows 1 and 5 above, and one by hand) ended at the
cap and 8 ended on their own; at 10 turns, all 10 (six above, four by hand) ended on their own in 4
to 6 turns. So more turns would not help. Putting the explainer in a fixture needs a
`scaffold_script`, which `claude plugin eval` runs only with `--scaffold` (author bash, run as the
user), and a per-query fixture does not fit `trigger-evals.json`; it is not done. #25 stays
held-out and unchanged (rewording it now would make it a train query), and is a known miss of the
harness: the held-out bar for `pedagogical-writing` is 7 of 8 with #25 the miss, and the rule for
writing such queries is in `evals.md` ("The working directory is empty").

**The #17 errors did not come back.** None of 19 runs of #17, or of 19 of #18, errored, including
a full-suite run at the same concurrency (`-j 5`) as on 2026-10-29. #17 answers in one turn with no
tool call, in 9 to 13 seconds against a 300-second limit, so a timeout or the sandbox does not fit;
#18 takes 4 or 5 turns in 7 to 15 seconds. The 2026-10-29 error text cannot be recovered: the runner
did not print it, and the result files were in its deleted temporary directory. **So the cause is
not known.** A failure outside the query (the API, for example) fits what is left, but nothing
shows it. The runner now prints the text under the query, so the next one will name its source.

### 2026-10-30: `pedagogical-writing`'s must-hold sections moved ahead of the catalogue (#85)

Claude Code 2.1.310, agent `claude-sonnet-5-5`, judge `claude-haiku-5-5`, three runs per case,
`--ablation none` (with-skill arm only), `-j 4`, comparing `WITH` scores as `evals.md` prescribes.
"Before" is a `git archive` snapshot of `f9d2835`; "after" is `fd68146`, whose skill files are the same as at the commit that records this (it
changes only this file). Both used
`--scaffold --trust-plugin`, with the snapshot given a copy of `docs/how-deflate-works.html`.

| Case | Before | After | Change |
| --- | --- | --- | --- |
| design-rank-interactive | 0.96 | 0.92 | −0.04 |
| outline-bloom-filters | 0.78 | 0.81 | +0.03 |
| plan-rank-select-series | 0.71 | 0.63 | −0.08 |
| review-deflate-page | 0.81 | 0.90 | +0.09 |
| rewrite-token-bucket | 0.89 | 0.94 | +0.05 |
| **Mean** | **0.83** | **0.84** | **+0.01** |

Every change is inside the 0.2 that counts as noise, the signs are mixed, and the skill fired in
all 15 after-runs and all 15 before-runs. Cost: before $1.42 (four cases) plus $1.77
(`review-deflate-page`, run again, see below), after $2.37.

- **The first before-run scored `review-deflate-page` 0.00 at $0.00.** The snapshot held only the
  skill, so the scaffold's `cp docs/how-deflate-works.html` failed. That is a setup error, not a
  score; the case was run again with the page in the snapshot, and only that re-run is in the table.
- **What this does and does not show.** The evals never compact the conversation, so they show that
  the new order does not cost an uncompacted run more than the noise (three runs, one arm, steps of
  a third per case, so a small loss would not show). They do not show that the move helps after a
  compaction, and no transcript has shown a skipped step from the cut (the issue says the same).
- **Where the cut falls.** By byte offset the sections that govern every use (the core loop,
  Promises, In this repo, Drafting workflow, Reviewing, Caveats) now end at 12,389 bytes; the
  20,000-byte mark falls in Misconceptions and surprise instead of Voice (Opening, Ordering and
  pacing, Examples and numbers, and Formulas, notation and names stay inside it). The 5,000-token limit and the
  4-bytes-per-token ratio are the issue's estimates, not measured here: no tokenizer was available.
- The top-listed failing grader of three cases is the same before and after: `outline` 03 and
  `review` 03 failed in all three runs both times, and `plan` 01 failed in two of three before and
  three of three after. They were failing before this change and are not touched by it.

### 2026-10-30: errored trigger-eval runs no longer score (#94)

From this change on, `run-trigger-evals.mjs` leaves out of the score every run that errored
(other than at the turn cap) before calling the skill: such a run is not in `fired x/n` and is
counted beside it. A run that called the skill and then errored is scored. A query whose left-out
runs could tip the at-least-half rule either way (always when fewer than half its runs are scored)
is `ERROR`, which counts as not passed and makes the run exit 1 (`evals.md` has the rule). Before,
an errored run counted as a pass for a should-stay-quiet query and as a miss for a should-fire one.

Results recorded above this section used the old rule and are not rescored. The known case it
changes: #17 of `pedagogical-writing` errored in 3 of 3 runs in run 2 and in its re-run on
2026-10-29, and passed both times. Under this rule it would have been `ERROR` both times, so it
was measured that day only by run 1 (clean, 0 of 3). #18 also errored in those two runs; how many
of its runs did was not recorded. Two checks after the change, before and after its review fixes
(Claude Code 2.1.310, `claude-sonnet-5-5`, #17 and #18, two runs each), passed both queries with
no errors, for $0.14 each. No real run has errored since, so the `ERROR` path is tested only
against the fake `claude` in `tests/trigger-evals.test.mjs`.

### 2026-10-30: why Haiku got little from `skill-authoring`, and the description change (#86)

Claude Code 2.1.310, judge `claude-haiku-5-5`, three runs per arm unless stated.

**The issue's hypothesis was wrong.** It guessed that Haiku skips the ranking and "lowest rung"
steps because the body states them as principles. The transcripts of the two weak cases show
Haiku never read the body: in 3 of 3 with-skill runs of each case it did not call `Skill`. The
`skill-fired` grader is `with-only, not scored`, so those runs scored as the baseline and the Δ was
just noise around zero. The review runs `Glob` and `Read` the fixture and answer from general
knowledge; the script runs answer in one turn with no tool call. The three cases where Haiku scored
well (add-evals, merge-overlapping-skills, fix-not-firing) loaded the skill in 9 of 9 runs.

| Haiku, 5 cases, before the change (re-run 2026-10-30) | review-flawed-skill | needs-a-script | mean Δ of 5 |
| --- | --- | --- | --- |
| with / without (Δ) | 0.54 / 0.58 (−0.04) | 0.80 / 0.80 (0.00) | +0.39 |
| runs that called `Skill` | 0 of 3 | 0 of 3 | |

The 2026-10-22 table above gave the same two cases 0.62 / +0.21 and 0.80 / +0.07; the re-run's
−0.04 and 0.00 are the same kind of number, with a load rate of 0 of 3 behind them (the 2026-10-22
traces were not kept, so that run's load rate is not known).

The trigger evals say the same. With Haiku as the agent (`--model claude-haiku-5-5`) the 28
original queries gave should-fire 5 of 15 (train 13 of 22, held-out 5 of 6) and should-stay-quiet
13 of 13; Sonnet scores 28 of 28 on the file. Six queries added before tuning (two worded like the
failing cases, with a held-out share and two near misses) gave Haiku 0 of 4 should-fire and Sonnet
3 of 4 (the miss, #33, "is a skill the right home for this checklist, or a script, or a hook",
passes 3 of 3 with the new description).

**What moved Haiku.** Candidate descriptions, each run on all 34 queries with Haiku (train 25,
held-out 9, so the held-out miss counts are of 9):

| Description | Should-fire | Train / held-out passed | Should-stay-quiet |
| --- | --- | --- | --- |
| Old (986 characters; topics first, "Use when creating, reviewing…") | 5 of 15 on the original 28 | 13 of 22 / 5 of 6 | 13 of 13 |
| v1: short "what", then "Use whenever the request is about a skill" and a long topic list | 2 of 19 | 13 of 25 / 4 of 9 | 15 of 15 |
| Probe, not a candidate: "You MUST invoke this skill FIRST, before answering…" | 16 of 19 | 22 of 25 / 9 of 9 | 15 of 15 |
| v2: v1's topics, shorter, plus "Load it before answering or reading any file" | 17 of 19 | 23 of 25 / 9 of 9 | 15 of 15 |
| v3: v2 with the machinery list put back | 13 of 19 | 21 of 25 / 7 of 9 | 15 of 15 |
| v2b: v2 reworded to "Use whenever…" for the lint (it still wanted a literal "use when") | 16 of 19 | 24 of 25 / 7 of 9 | 15 of 15 |
| **Final**: "Use when the request is about a skill: … Load it before answering or reading any file." (721 characters) | 17 of 19, then 15 of 19 | 24 of 25 / 8 of 9, then 23 of 25 / 7 of 9 | 15 of 15, both runs |

- A longer list of topics did not help (v1, v3). A plain instruction to load the skill before
  answering did (v2, final). The repo's own rule says capitals and MUST do nothing for triggering;
  the probe shows the instruction matters for Haiku, and v2 shows capitals are not needed. The
  probe was run to learn whether the description could move Haiku at all, and was reverted.
- Held-out: v2 scored 9 of 9 and the final description 8 of 9 and 7 of 9. That is a one or two
  query difference between runs of one description (the final one, run twice), so the choice of
  the final wording over v2 rests on the lint's "Use when" rule, not on a held-out gap. The queries
  that still miss on Haiku are #8 ("is it worth putting this in a forked subagent…", 0 of 3 in
  every run since v1) and, in some runs, #32, #25 and #6. #8 is a train query: the category it stands for
  (how much machinery a skill needs) went back in as v3 and made things worse, so it stays a known miss.
- **Errored runs.** The candidate runs above used the runner before #94's clean-run rule, and
  only their result lines were read, so an errored run in them counts as the old rule counted it
  (a pass for a quiet query). The final description was run again after rebasing onto that rule:
  31 of 34 (should-fire 16 of 19, train 23 of 25, held-out 8 of 9, should-stay-quiet 15 of 15),
  with no errored run and no `ERROR` result. The Sonnet logs, read in full, show no errors.
- **The held-out numbers are optimistic.** The six added queries were written after the failing
  shape had been seen in the output cases, three of them are held out, and the held-out score
  was read when choosing between candidates. They show that Haiku fires on prompts worded
  differently from the two cases, not a clean test of generalisation.
- **`skill-creator` is not measured.** The old description said it adds the repo's rules on top of
  `skill-creator`; the final one does not say it (the body still does), and the sandbox holds no
  `skill-creator`, so a prompt it would take instead cannot be tested here.
- Nothing was stolen: every should-stay-quiet query stayed at 0 triggers in every Haiku run
  and both Sonnet runs, and `pedagogical-writing`'s own trigger evals on Sonnet are unchanged
  (29 of 30: train 22 of 22, held-out 7 of 8, the miss still #25).

**Output evals with the final description.** All five cases, three runs per arm, `-j 4`, no
`--allow-tools` (see `evals.md`: a `Bash` grant makes every run error on this machine).

| Case | Haiku, pass 1 | Haiku, pass 2 | Sonnet | Opus |
| --- | --- | --- | --- | --- |
| add-evals | 1.00 / 0.19 (+0.81) | 1.00 / 0.19 (+0.81) | 1.00 / 0.14 (+0.86) | 1.00 / 0.14 (+0.86) |
| merge-overlapping-skills | 1.00 / 0.07 (+0.93) | 1.00 / 0.33 (+0.67) | 1.00 / 0.27 (+0.73) | 1.00 / 0.27 (+0.73) |
| review-flawed-skill | 0.92 / 0.42 (+0.50) | 0.96 / 0.46 (+0.50) | 0.83 / 0.63 (+0.21) | 0.92 / 0.75 (+0.17) |
| needs-a-script | 0.93 / 0.80 (+0.13) | 1.00 / 0.80 (+0.20) | 0.93 / 0.73 (+0.20) | 1.00 / 0.80 (+0.20) |
| fix-not-firing | 0.93 / 0.73 (+0.20) | 0.93 / 0.80 (+0.13) | 1.00 / 0.73 (+0.27) | 0.93 / 0.87 (+0.07) |
| **Mean Δ** | **+0.52** | **+0.46** | **+0.45** | **+0.40** |
| Cost | $0.20 | $0.21 | $1.96 | $4.35 |

- **Haiku**, over both passes (six runs per arm): review-flawed-skill with-skill 0.54 → 0.94
  (Δ −0.04 → +0.50), needs-a-script 0.80 → 0.97 (Δ 0.00 → +0.17). Haiku called `Skill` in all 15
  with-skill runs of pass 1. The review gain is well above the 0.2 noise. The script case's Δ
  is capped near 0.2 because its baseline is 0.73 to 0.80, so its with-skill rise (0.80 to 0.97)
  is the number to read, and its Δ stays inside the noise.
- **Why no step was added to the body.** With the skill loaded, the with-skill Haiku answers
  find the reserved name, the over-limit first-person description, the repo-root path, the nested
  reference and the missing evals, point at the existing `lint-skills`, say to run the script, and
  lead with what stops loading. The misses left are a judge voting FAIL three to none on a ranked
  answer and a regex ("repo-relative" is not in `finds-hardcoded-path`'s pattern): grader noise,
  not a skipped step.
- **Sonnet and Opus.** With-skill scores are within a notch of 2026-10-22 and 2026-10-28
  (in the table's case order, Sonnet 1.00 / 1.00 / 0.83 / 0.93 / 1.00 now against 1.00 on every case
  before; Opus 1.00 / 1.00 / 0.92 / 0.93 / 1.00 before and 1.00 / 1.00 / 0.92 / 1.00 / 0.93 now). Sonnet
  called `Skill` in all 15 runs, so a firing change is not what moved it. Sonnet's
  review (0.83) and script (0.93) cases are the two that fall below the earlier 1.00, so they were
  re-run with the old description (a `git archive` of the commit before this change) against the new,
  six with-skill runs each, `--ablation none`: review 0.96 old, 0.94 new; script 0.97 old, 0.92
  new. Differences of 0.02 and 0.05 are noise at this sample (the script case's `lowest-rung` judge
  fails 3 votes to 0 in both versions), and different graders miss in different runs. This shows no
  drop larger than the noise; it does not show none.
- **Cost.** About $31 in all: Haiku trigger runs about $7.50, Sonnet trigger runs $14.96
  (this skill, its six new queries before the change, and `pedagogical-writing`), output evals
  about $6.90 (Haiku $0.57 over the before run and both passes, Sonnet $1.96, Opus $4.35), and the
  head-to-head $1.96 (equal to Sonnet's pass by coincidence: $0.67 + $0.30 + $0.69 + $0.30).
  The description is 265 characters shorter (986 to 721), which also saves context in every session.
