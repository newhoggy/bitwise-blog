# The ladder: how much machinery a skill needs

Every rung adds context, files, or something to keep in sync. Start at rung 1. Climb to a
rung only when you can point at an eval result or a transcript that shows the need, and
write that signal in the commit message. Claude does not need a "writing skills" skill to
produce a valid `SKILL.md`; the rungs below are about *when to add more than that*.

## Contents

- The twelve rungs
- Degrees of freedom
- Which rungs the repo's skills use
- Rungs that are Claude Code only

## The twelve rungs

| # | Rung | Adds | Climb when (the signal) | Do not use it for |
| --- | --- | --- | --- | --- |
| 1 | Instructions only | One `SKILL.md` | Claude lacks guidance it needs. The baseline run fails where the skill would help. | Anything past about 500 lines |
| 2 | References | `references/*.md`, each linked from `SKILL.md` with *when* to read it | The body nears 500 lines, or parts of it matter only for some tasks or variants | Content every run needs: it costs a read each time, and the read may be skipped |
| 3 | Scripts | `scripts/`, which are **run**; only the output enters context | Transcripts show Claude writing the same helper in several runs, or a step is deterministic or fragile | Judgment calls |
| 4 | Templates and assets | `assets/` with an exact template, or input and output example pairs | Output whose shape must be exact, or a style easier to show than describe | Output that is mostly judgment |
| 5 | Arguments | `$ARGUMENTS`, `$0`, named `arguments:`, `argument-hint` | A user-driven workflow, such as `/new-page explainer foo` | A skill meant to fire on its own from context |
| 6 | Dynamic context | `` !`cmd` `` runs before the skill is sent and inlines its output | The skill always needs `git status`, a diff or `npm run check` output first | Slow, flaky or side-effecting commands. A non-zero exit aborts the whole invocation, so add `\|\| true` where failure is fine |
| 7 | Tool policy | `allowed-tools` (pre-approves; does not restrict) and `disallowed-tools` (removes tools for the turn). `Bash(${CLAUDE_SKILL_DIR}/scripts/x.sh *)` runs a bundled script without a prompt | A bundled script should run without a prompt, or a review skill should be read-only | A security boundary: `allowed-tools` does not limit what else Claude may use |
| 8 | Invocation control | `disable-model-invocation: true` (user-only; the description leaves context), `user-invocable: false` (Claude-only), `paths:` globs | The skill has side effects (publish, seal, deploy), or matters only for certain files | A skill that should fire from context |
| 9 | Execution context | `context: fork`, `agent:`, `model:`, `effort:` | Noisy exploration whose intermediate output the parent does not need, or work that needs another model or budget | A skill that needs the conversation so far: a forked subagent does not see it |
| 10 | Skill-scoped hooks | `hooks:` in frontmatter, active from invocation to the end of the session | A rule must hold *every* time and transcripts show Claude skipping it | Advice and preferences |
| 11 | Packaging | `<plugin>/skills/<name>/`, distributed through a marketplace and namespaced `plugin:skill` | Several repos or people need the skill | A skill still changing weekly |
| 12 | Eval-driven development | Baseline first, evals before instructions, iterate against the delta | Whenever the output can be checked, which is almost always | Not applicable |

Rung 12 is not a step up: it is how you decide whether to take any of the others.

## Degrees of freedom

Match how tightly you constrain Claude to how fragile the task is.

- **High freedom (prose):** several approaches are valid and context decides. A review.
- **Medium (a template or parameterised script):** a preferred pattern exists, some
  variation is fine. A page from a template.
- **Low (an exact command):** the operation is fragile or order matters. "Run exactly
  this." A migration, a seal.

## Which rungs the repo's skills use

| Skill | Rungs | Why those |
| --- | --- | --- |
| `pedagogical-writing` | 1, 2, 3 | Guidance (1) split by task into references (2), with a stats script that is run (3) |
| `skill-authoring` | 1, 2, 3 | Same shape; the script is the lint |

Neither uses arguments, dynamic context, hooks, forking or packaging: no eval has shown a
need. Record a new skill's rungs in this table when it ships.

## Rungs that are Claude Code only

Rungs 5 to 10 use frontmatter or syntax that pi and claude.ai do not read (the `!` syntax
is body text, but other hosts will not run it). A skill that must load everywhere stays on
rungs 1 to 4 and `allowed-tools`, or it keeps the Claude Code-only part small and says so
in `compatibility`. The lint warns on each Claude Code-only field.
