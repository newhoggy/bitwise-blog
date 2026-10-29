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
- Running, and reading the result (and comparing with the previous version)
- Models, cost and thresholds
- Converting skill-creator's `evals.json`
- Where the measurements are

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
- **Split them before you tune** (the agentskills.io method): about 60% train and 40%
  held-out, each with a proportional mix of should-trigger and should-not, fixed for the
  whole process. Mark the held-out ones `"heldout": true`. Only failures in the train part
  guide a rewrite; the held-out part says whether the rewrite generalises. Do not add a
  keyword copied from a failed query: find the category it stands for. Stop after about
  five iterations, and keep the description with the best held-out score, which may not be
  the last one. Never mark a query held-out after tuning against it: it is then a train
  query. The script reports the two parts separately.

Measure with the bundled script (`scripts/run-trigger-evals.mjs`), from the repo root:

```bash
npm run trigger-evals -- <skill-name> [--runs N] [--only 1,5,9] [--max-turns N] [--keep]
```

`--only` re-runs chosen queries (1-based positions in the file) after an edit; the output lists
each query with its position and its result: `PASS`, `FAIL` or `ERROR`. It exits 1 if any query
is not `PASS` or any case failed to load.

**Only clean runs are scored.** A run that errors (an API error or a timeout, say) never reaches
the skill, so it would pass a should-stay-quiet query and fail a should-fire one while measuring
nothing. Such runs are left out of `fired x/n` and shown beside it (`fired 0/2 … (1 errored)`).
A query with fewer than half its runs clean is `ERROR`: not passed, whichever way it is labelled.
Re-run it (`--only`); don't read it as a result. The turn cap is not an error: a run that hits it
has been graded on everything it did.

Read a miss before you act on it. Any error other than the turn cap is printed under its query
(`run 2 error: …`), so an `ERROR` names its cause. `--keep` keeps the temporary plugin, copies each run's trace into its
`traces/` (`q<position>-run<k>.jsonl`) and, for each run that did not behave as labelled or
errored, prints the tool calls in order and how the run ended
(`run 1 tools: Grep, Glob, Grep (error); turn cap`), so you can see whether Claude went looking
for something before it chose a skill. `--max-turns` (default 3) raises the cap for a query that
needs more turns.

It builds a temporary plugin holding **every** skill in `.claude/skills` (so near misses meet
the neighbours that would answer them), one `claude plugin eval` case per query with
`tool_used: Skill` (`min: 0, max: 0` for should-not), three runs each, `--ablation none`. A
query passes when at least half its clean runs behave as labelled. Cost: about $4 to $8 per skill
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

The working directory is empty. A query that points at a file the user has ("the arithmetic
coding explainer", "my lecture notes") sends Claude looking for it; finding nothing, it answers
or asks for the file, and the skill never loads, whatever the description says. Put the material
in the prompt (quote the passage, give the numbers), or expect a miss that measures the sandbox.
Not every query that names a missing page misses (#1 to #5 of `pedagogical-writing` name pages
the sandbox lacks and fire 3 of 3), so read the trace before blaming the sandbox.

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
three, with realistic prompts, at least one a boundary case (an ambiguous request). Over-triggering is covered by the
should-stay-quiet trigger queries, not by output cases: a case where the skill should not change the
answer scores the same in both arms and measures nothing. Delete or rewrite a case that
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
  -j 4 --max-cost-usd 15 --no-publish
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
- Always open one with-skill and one baseline transcript (`tracePath` in `aggregate-result.json`). The
  score says whether; the transcript says why.
- **Exit codes:** 0 pass; 1 a case below `--threshold` (default 1.0), a case that failed to
  load, or an API error; 2 the cost ceiling was hit. Cases that fail to load are listed at
  the top of the output: read it, because a skipped case does not lower the score.

### Comparing with the previous version

The with/without delta says the skill helps; it does not say that your edit helped. The
only built-in baseline is no skill, so to compare two versions of the same skill run the
suite twice with `--ablation none` and compare the `WITH` scores:

```bash
snap=$(mktemp -d)                                  # the version before your edit
git archive <ref> .claude/skills/<name> | tar -x -C "$snap"
claude plugin eval "$snap/.claude/skills/<name>" --scaffold --trust-plugin --ablation none \
  --model claude-sonnet-5-5 --judge-model claude-haiku-5-5 -j 4 --max-cost-usd 15 --no-publish
```

Then run the same command on `.claude/skills/<name>` and compare case by case, with the
same noise rule as for Δ. Write down the cost and duration that each run reports too: a
skill version that gains 0.1 and doubles the cost is a trade-off, not a win. For a blind
side-by-side read of two outputs, use skill-creator's comparison mode.

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

`pedagogical-writing`'s six cases were converted this way. One of them,
`revise-directory-paragraph`, was deleted afterwards because it scored the same with and without
the skill (Δ 0.00, and −0.17 in an earlier run), which is the rule above applied to its own suite.

The results of the runs made for this repo's skills are in [measurements.md](measurements.md).
