---
name: skill-authoring
description: Guidelines for writing, testing and maintaining Agent Skills (SKILL.md folders) in this repo: whether a task needs a skill at all, how much machinery it needs (references, scripts, arguments, user-only invocation, hooks, forked context), SKILL.md frontmatter fields and limits (name, description length, what breaks in pi), writing a description that triggers when it should and stays quiet when it shouldn't, trigger and output evals with a no-skill baseline (`claude plugin eval`), linting a skill, and keeping it healthy after it ships. Use when creating, reviewing, linting, debugging or improving a skill, when a skill isn't firing or fires too often, when adding evals to a skill, or when asked how a skill should be structured, even if the request doesn't say "authoring". Adds the repo's rules on top of skill-creator. Not for writing blog pages (pedagogical-writing), editing CLAUDE.md, settings.json or hooks (update-config), or building an app on the Claude API (claude-api).
---

# Skill authoring

The repo's rules for the skills in `.claude/skills/`. Claude already knows the SKILL.md
format and the generic loop (interview, draft, run, review, iterate): the `skill-creator`
skill runs that loop, so use it for the loop and come back here for the decisions it does
not make. This skill holds only what Claude would not do unprompted: the repo conventions,
how much machinery a skill needs, and which eval tool does which job.

## Rules that must survive compaction

1. **Measure before you write.** Run the task without the skill first, write the evals
   from the gaps, then write the least that closes them. A rule Claude already follows
   without the skill does not belong in it.
2. **Start at a single `SKILL.md` and climb one rung at a time**, only when an eval or a
   transcript shows the need ([ladder](references/ladder.md)).
3. **`name` is at most 64 characters** (lowercase letters, digits, hyphens), **matches the
   directory, and contains neither `claude` nor `anthropic`** (the spec reserves both).
   **`description` is at most 1,024 characters**, third person, says what the skill does
   and when to use it, in the words people type, and names what it is *not* for.
4. **Name bundled files relative to the skill directory**, never by a repo-root path
   (`.claude/skills/<name>/…`), so the skill loads from anywhere (#77).
5. **Keep frontmatter to the cross-surface fields** (`name`, `description`, `license`,
   `compatibility`, `metadata`, `allowed-tools`) unless a Claude Code-only field earns its
   place, so the skill still loads in pi and claude.ai.
6. **Two eval kinds, both run by `claude plugin eval`.** Trigger evals are
   `evals/trigger-evals.json` (skill-creator's format), measured with
   `scripts/run-trigger-evals.mjs`. Output-quality evals are `evals/<case>/` directories, which
   also give the with/without delta. A skill ships with both ([evals](references/evals.md)).
7. **Re-run lint and evals on every change to a skill**, and read a transcript, not just
   the score.

## 1. Do you need a skill?

Pick the lightest home that fits.

| The thing is | Put it in |
| --- | --- |
| A short fact or rule needed in every session (ids are kebab-case) | `CLAUDE.md` |
| A rule that must hold every time, however the model behaves | A hook or a repo check (`npm run check`); prose cannot guarantee it |
| A procedure or body of guidance needed only for some tasks | A skill |
| Noisy exploration whose intermediate output the parent does not need | A subagent, or a skill with `context: fork` |
| Access to an outside system | An MCP server |
| A deterministic step | A script, which a skill may bundle |

This split is a synthesis of the Claude Code docs, which give no single table
([sources](references/sources.md)). Before adding a skill, check whether an existing one
should grow instead: a new skill costs a description in every session's context. A
`CLAUDE.md` section that has grown into a procedure is the usual sign a skill is due.

## 2. How much machinery

[references/ladder.md](references/ladder.md) lists twelve rungs, from a lone `SKILL.md`
to forked context, hooks and plugin packaging, each with the signal that justifies it and
the case where it does not. Match the freedom you give to the fragility of the task:
judgment calls get prose, templated output gets a template, an exact migration gets a
script that is run, not read.

## 3. Repo conventions

- **Layout.** `SKILL.md`, `references/`, `scripts/`, `evals/`. Under `evals/`:
  `trigger-evals.json`, and one directory per output case (`prompt.md`, `graders/`,
  `case.yaml` when it needs fixtures). `evals/results/` is git-ignored.
- **`SKILL.md` stays under 500 lines.** Put detail in `references/`, each linked from
  `SKILL.md` with a note on *when* to read it. References are one level deep, and a file
  over 100 lines opens with a contents list.
- **Neighbouring skills divide territory in their descriptions.** `pedagogical-writing`
  covers teaching prose, and the planned `pedagogical-diagrams` (#80) and the `dataviz`
  skill cover figures and charts. Each names the others as "Not for…".
- **A skill that makes evidence-based claims keeps `references/sources.md`**, marking what
  was read in full, what was only summarised, and what is the author's synthesis.
- **Time-sensitive guidance** goes in a collapsed "old patterns" section, not inline.
- **Critical rules go near the top.** After compaction Claude Code keeps only the first
  5,000 tokens of an invoked skill.

## 4. Writing and testing a skill

1. Run the target tasks without the skill. Note what Claude gets wrong or lacks.
2. Write the trigger evals and at least three output cases from those gaps.
3. Write the minimum `SKILL.md`. Draft the description with
   [references/description.md](references/description.md).
4. Run both evals and compare with the baseline ([references/evals.md](references/evals.md)).
   Δ near zero on a case means the skill is not helping there: cut or rewrite.
5. Read two or three transcripts for skipped steps, unread references and helper code
   written again and again (a candidate script).
6. Run `npm run lint-skills` from the repo root (it runs `scripts/lint-skill.mjs` on every skill;
   add `-- --strict` to fail on warnings) and fix what it reports.
7. Try it on one real task before calling it done.

## 5. Reviewing a skill

Run the lint, then walk [references/checklist.md](references/checklist.md). If you cannot run
commands, check by hand: the name (reserved words, directory match), the description length
and person, the body length, links, repo-root paths, and whether `evals/` exists. Lead with
what stops the skill loading or triggering (name, description, malformed frontmatter), then
what wastes context, then style. For each finding give the fix. Say what already works.

## 6. After it ships

[references/maintenance.md](references/maintenance.md): regressions, context cost, skills that are
never invoked, portability, and when to retire or merge.

## Reference files

- [references/ladder.md](references/ladder.md): the twelve rungs and the signal for each.
  Read it when deciding what a skill needs.
- [references/description.md](references/description.md): the rules, a drafting
  procedure, and fixing a skill that does not fire. Read it when writing or debugging
  a description.
- [references/evals.md](references/evals.md): which tool for which eval, exact commands,
  case layout, fixtures, graders, thresholds and reading Δ. Read it before writing or
  running any eval. Trigger evals run through `scripts/run-trigger-evals.mjs`, as
  `npm run trigger-evals -- <skill-name>` from the repo root.
- [references/checklist.md](references/checklist.md): the review checklist.
- [references/maintenance.md](references/maintenance.md): keeping a skill healthy.
- [references/sources.md](references/sources.md): where each claim comes from, and what
  was read versus summarised.
