# Evals

A skill ships with two kinds of eval, because they answer different questions. Both run
through `claude plugin eval`; they differ in what a case asks.

| Question | Eval kind | Source of the cases | Run with |
| --- | --- | --- | --- |
| Does the skill load on the right prompts, and stay quiet on the wrong ones? | Trigger | `evals/trigger-evals.json` (skill-creator's format) | `scripts/run-trigger-evals.mjs <skill>` |
| Is the answer better with the skill than without it? | Output quality | `evals/<case>/prompt.md` + `graders/` | `claude plugin eval .claude/skills/<skill>` |

## Contents

- The decision
- Trigger evals
- Output-quality evals
- Writing cases and graders
- Fixtures: the sandbox is empty
- Running, and reading the result
- Models, cost and thresholds
- Converting skill-creator's `evals.json`
- What has been measured here

## The decision

**Output-quality evals use `claude plugin eval` cases. `evals.json` (skill-creator's output
format) is retired.** Reasons:

- `claude plugin eval` has graders that cost nothing (`regex`, `tool_used`, `tool_order`,
  `file_exists`), runs each case with and without the skill, and reports the difference
  (`Δ`). skill-creator's `evals.json` holds expectation *text* for a person or a grader
  agent to apply; nothing runs it unattended.
- It pins models, takes a `--threshold`, a cost ceiling and exit codes, so it can gate CI
  later without a second format.
- It runs on a bare `.claude/skills/<name>` directory: no `plugin.json` is needed.

**Trigger evals keep skill-creator's file format but not its runner.** The query list stays
`evals/trigger-evals.json` (`{"query", "should_trigger"}`), so skill-creator's tools can still
read it. It is *measured* by `scripts/run-trigger-evals.mjs`, which turns each query into a
`claude plugin eval` case with a `tool_used: Skill` grader. The reason is that skill-creator's
`run_eval.py` / `run_loop.py` measured 0 of 12 should-trigger queries on this repo's first
trial, for three reasons that the wrapper avoids ([below](#trigger-evals)). Use `run_loop.py`
only to *propose* description rewrites, and confirm every candidate with the script.

The two output-eval formats do not read each other's files. They coexist in `evals/`: a
directory is a `claude plugin eval` case only if it holds `prompt.md` or `case.yaml`, so
`trigger-evals.json` is ignored by it.

Keep using skill-creator, outside the repo's formats, for what it does well and this tooling
does not: the interactive viewer for reading outputs side by side, blind A/B comparison of two
skill versions, and the description rewriting step.

## Trigger evals

`evals/trigger-evals.json` is a list of `{"query": "...", "should_trigger": true|false}`
(an optional `"heldout": true` marks queries you did not tune the description against).

- About twenty queries, roughly half each way. The should-not half is the hard half: near
  misses that share vocabulary with the skill but belong to another skill or to plain
  Claude, not obviously unrelated prompts. Take them from the neighbours' own descriptions.
- Realistic prompts: file names, context, casual phrasing, typos.
- Write a few extra queries before you start tuning, mark them `heldout`, and look at them
  only at the end.

Measure with the bundled script (`scripts/run-trigger-evals.mjs`), from the repo root:

```bash
npm run trigger-evals -- <skill-name> [--runs N] [--only 1,5,9] [--keep]
```

`--only` re-runs chosen queries (1-based positions in the file) after an edit; the output lists
each query with its position. It exits 1 if any query fails or any case failed to load.

It builds a temporary plugin holding **every** skill in `.claude/skills` (so near misses meet
the neighbours that would answer them), one `claude plugin eval` case per query with
`tool_used: Skill` (`min: 0, max: 0` for should-not), three runs each, `--ablation none`. A
query passes when at least half its runs behave as labelled. Cost: about $4 to $8 per skill
with Sonnet.

Why not skill-creator's `run_eval.py`? On this repo's first trial it scored 0 of 12
should-trigger queries, for three reasons, any of which makes a measurement worthless:

1. It adds a *proxy* copy of the description as a command and counts a trigger only when
   Claude picks the proxy. If the real skill is installed in the project, Claude picks that.
2. It counts a trigger only if the **first** tool call is the skill, so a run that looks at the
   repo first scores as a miss even though the skill loads on the next call.
3. Its 30-second timeout is too short with a full Claude Code configuration.

Limits of the script: the sandbox loads no user settings, `CLAUDE.md` or user-level skills, so a
prompt that only a user-level skill would catch is not tested. A temporary plugin needs a
`plugin.json` for its `skills/` directory to load (a lone `SKILL.md` does not): without one,
every query scores 0 because no skill is loaded. If every query fails, check that first.

To search for a better description, edit by hand against the failing queries, or let
skill-creator's `run_loop.py` propose rewrites (it needs `PYTHONPATH` set to skill-creator's
directory, `--model`, and `--report none` to stop it opening a browser), then confirm any
candidate with the script. Keep the description that does best on the held-out queries, not on
the ones it was tuned on. Then check the near misses against **every other skill in the repo
and in the user's configuration**.

## Output-quality evals

One directory per case under `evals/`:

```text
evals/<case>/
├── prompt.md          frontmatter (limits, tools, tags) + the prompt, phrased as a user would type it
├── graders/<name>.md  one check each: frontmatter (type, options) + a rubric body for llm
├── case.yaml          only when the case needs fixtures (context.scaffold_script)
└── fixture.sh         the scaffold script, if any
```

Scaffold with `claude plugin eval init --bare <case>` from the skill directory, or write the
files by hand. `evals/results/` is written by each run; it is git-ignored.

Choose cases from the gaps the baseline run showed, not from what the skill says. At least
three, with realistic prompts, at least one a boundary case (an ambiguous request, or a
prompt where the skill should *not* change the answer). Delete or rewrite a case that
scores the same with and without the skill: it measures nothing about the skill.

## Writing cases and graders

- **Prefer graders that cost nothing.** `regex` (`pattern`, `flags: i`, `match:
  not_contains` or `count:N`, `target`), `tool_used` (`tool`, `input_match`, `min`/`max`),
  `tool_order`, `file_exists`. Use `llm` only for judgment, and write the rubric as concrete
  PASS and FAIL conditions. An `llm` grader votes 2 of 3 and is noisier on long text.
- **`flags: i`, never `(?i)`.** JavaScript regex has no inline flags and the grader throws.
- **One grader on the result, one on the steps.** For a skill: a content check plus
  `tool_used` with `tool: Skill` and `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?<name>"'`.
  In a two-arm run the `Skill` check is only an indicator and is excluded from the score
  (it can never pass without the skill).
- **Check what is mechanical mechanically.** "The answer cites the 1,024 limit" is a regex;
  "the review leads with the worst problem" needs a rubric.
- **Do not grade the exact wording.** Match the fact, with alternatives (`1,?024`).
- **Negative checks need care.** A `not_contains` regex fails when the answer quotes the
  forbidden phrase to advise against it. Use an `llm` grader for those.
- A case where the skill must not fire: `tool_used` with `min: 0`, `max: 0`, `arm: both`.
- Quote single-quoted YAML patterns carefully: in YAML a `\n` inside a shell heredoc may
  become a real newline. Write grader files with a tool that does not expand escapes.

## Fixtures: the sandbox is empty

Each run starts in an empty temporary workspace with a temporary home. User settings,
`CLAUDE.md`, MCP servers and other skills and plugins do **not** load, so:

- A case that depends on repo files copies them in with `context.scaffold_script`
  (`case.yaml`), which runs as you and only with `--scaffold`. Keep such scripts to
  copying files, and copy from the repo rather than keeping a second copy that drifts.
  The script is invoked by its path, so `"$(dirname "$0")"` finds the repo.
- A case that depends on the repo's `CLAUDE.md` rules scaffolds them in, or states them in
  the prompt; the rules are not there otherwise.
- `Bash`, `Write`, `Edit`, `WebFetch` and `WebSearch` are removed unless granted at run
  time with `--allow-tools "Bash(node *)"`. The grant applies to the whole run. Granting
  `Bash` turns on the OS sandbox, which refuses to run on a machine where
  `~/.aws/credentials` is a symbolic link (the error says so). The suites in this repo grant
  no `Bash` for that reason, so a case cannot run a skill's bundled script.
- `@file` mentions in a prompt are not expanded.
- The skill's own script paths must resolve from where the skill is loaded. A skill that
  names `.claude/skills/<name>/scripts/x.mjs` cannot run it in the sandbox: that is the
  portability bug #77 describes, and an eval will show it.

## Running, and reading the result

```bash
claude plugin eval .claude/skills/<name> \
  --scaffold --trust-plugin --allow-tools "Bash(node *)" \
  --model claude-sonnet-5-5 --judge-model claude-haiku-5-5 \
  -j 4 --max-cost-usd 15 --no-publish --json /tmp/<name>.json
```

- Add `--case '<glob>'` or `--tag <tag>` to run part of the suite, `--runs N` to change the
  runs per arm, `--ablation none` to skip the baseline while tuning graders (halves cost),
  `--keep-temp` to look at what a run left behind. Put the target before `--tag` and
  `--allow-tools`.
- Results: a table with `WITH`, `W/OUT` and `Δ` per case, `evals/results/<timestamp>/
  aggregate-result.json` and `report.html` (or where `--output-dir` points).
- **Reading Δ.**
  - `Δ` near zero with a high score: Claude did it unaided; the case tests nothing about
    the skill. Make it harder or delete it.
  - `Δ` near zero with a low score in both arms: the grader or the case is broken, or the
    skill does not teach it. Read a transcript.
  - Positive `Δ` that comes from one grader: that grader is where the skill earns its
    place. Check that it is the one you meant to teach.
  - Negative `Δ`: suspect the judge before the skill (re-run with `--judge-model sonnet`),
    then the rubric, then the skill.
  - With three runs a case moves in steps of a third. Treat a difference under about 0.2 on
    one case as noise; look for the same sign across cases.
- Always open one with-skill and one baseline transcript (`tracePath` in the JSON). The
  score says whether; the transcript says why.
- **Exit codes:** 0 pass; 1 a case below `--threshold` (default 1.0), a case that failed to
  load, or an API error; 2 the cost ceiling was hit. Cases that fail to load are listed at
  the top of the output: read it, because a skipped case does not lower the score.

## Models, cost and thresholds

- Pin the agent model (`--model`) and the judge (`--judge-model`) so a model rollout is not
  mistaken for a regression. This repo uses `claude-sonnet-5-5` for the agent and
  `claude-haiku-5-5` for the judge. Re-run on the other models a skill will run under
  (Haiku needs more explicit guidance, Opus tolerates less over-explanation).
- Cost: cases × runs × 2 arms agent runs, plus three judge calls per `llm` grader per run.
  A five-case, three-run suite with Sonnet costs on the order of one to two US dollars and
  a few minutes at `-j 4`. Always pass `--max-cost-usd`.
- Threshold: the default 1.0 is too strict for judged graders. Use 0.8 once a suite is
  stable, and watch the trend in `Δ` rather than the absolute score.

## Converting skill-creator's `evals.json`

Each entry becomes a case directory:

- `prompt` becomes `prompt.md` (the body). `files` become a scaffold that copies them in.
- `expectations[]` become graders: a `regex` or `tool_used` where the check is mechanical,
  else an `llm` grader whose body is "PASS if …. FAIL if …". Keep one expectation per
  grader so a failure names the claim.
- `expected_output` is for people: put it in `description:` in `prompt.md`.
- Add the `tool_used: Skill` indicator.
- Delete `evals.json` in the same change, so there is one source of truth.

`pedagogical-writing`'s six cases were converted this way.

## What has been measured here

Run on 2026-10-22 and 23 with Claude Code 2.1.300. Agent `claude-sonnet-5-5`, judge
`claude-haiku-5-5`, three runs per case per arm, `-j 4`. Each case is graded as the fraction of
its graders that passed, averaged over runs; `Δ` is with-skill minus without.

**These are small samples.** Three runs move a case in steps of a third, and re-running
`pedagogical-writing` after fixing two of its graders moved single cases by up to 0.4 (the
`revise-directory-paragraph` Δ went from +0.17 to −0.17, with no change to the skill). Read the
mean across cases, and the sign across cases, not any one number.

### `skill-authoring` output evals (5 cases)

Written before the skill body, from the gaps a stub-only baseline showed, then tuned once: the
reserved-word check in `SKILL.md` was added after a with-skill transcript showed the review
missing it. The cases are written around what the skill teaches, so a positive Δ here shows the
skill delivers its content, not that the content is what users need most.

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| add-evals | 0.86 | 0.14 | +0.71 |
| review-flawed-skill | 0.96 | 0.71 | +0.25 |
| fix-not-firing | 1.00 | 0.73 | +0.27 |
| design-user-only-skill | 0.89 | 0.83 | +0.06 |
| skill-or-claude-md | 1.00 | 1.00 | 0.00 |
| **Mean** | **0.94** | **0.68** | **+0.26** |

This is the run on the final text of the skill. An earlier run on the same cases, before the
description was reworked for triggering, gave a mean Δ of +0.30 (with 0.96, without 0.66): the same
skill moves by about 0.04 between runs of three.

Cost $1.77, 2.9 minutes. `skill-or-claude-md` is a guard: Claude already answers it well, and
the skill did not fire on it (0 of 3), which is the right outcome. `design-user-only-skill`
still fails its `portability` grader in two of three runs with the skill: Claude recommends
`disable-model-invocation` without saying it is Claude Code only, even though the skill says
so. That is the remaining gap.

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
