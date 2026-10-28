# Sources

Where each rule in this skill comes from, how it was checked, and what is still unverified.
The research was done on 2026-10-22 against Claude Code 2.1.300, and extended on 2026-10-28
against 2.1.310 (see the rows marked with that date). Read this when a rule needs
its evidence, or before changing a rule that came from a source.

## Contents

- Status words
- Sources
- Claims the issue marked as synthesis or not yet researched
- Corrections to the issue
- Not verified

## Status words

- **Read**: the page was fetched and its text read. Where a fetch tool summarised the page
  (all of the `code.claude.com` pages and the API skills guide, which are long), the quotes
  below are the tool's extraction of the page, not a line-by-line read of the raw HTML.
- **Run**: checked by running the installed tool.
- **Synthesis**: the author's own reading across sources, labelled so it is not mistaken for
  a documented rule.

## Sources

| Source | Status | What it supports |
| --- | --- | --- |
| [Skills](https://code.claude.com/docs/en/skills.md) (Claude Code docs) | Read, through a fetch summary of the whole page | Frontmatter fields; `description` + `when_to_use` truncated at 1,536 characters in the listing; listing budget of 1% of the context window with the least-used descriptions dropped first; compaction keeps the first 5,000 tokens of each invoked skill within a shared 25,000; `${CLAUDE_SKILL_DIR}`; `` !`cmd` `` and its abort-on-failure; `allowed-tools` does not restrict; `disable-model-invocation`, `user-invocable`, `paths`; `context: fork` does not see the conversation; troubleshooting for not firing, firing too often and ceasing to be followed; `claude plugin validate .claude/skills`; `/doctor`, `/context`, `/skill-doctor` |
| [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Read in full | Concise beats complete; degrees of freedom; third-person descriptions; 500-line body; references one level deep; contents list over 100 lines; "old patterns"; evaluation-driven development (baseline, three scenarios, minimal instructions); Claude A / Claude B; test on Haiku, Sonnet and Opus; scripts that solve rather than defer; "run" versus "read"; the checklist. Also: "You don't need … a 'writing skills' skill" to get a valid SKILL.md |
| [Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills) (agentskills.io) | Read in full | `evals/evals.json` shape; run every case with and without the skill; start with 2 to 3 cases; assertions after the first run; grade with scripts where mechanical; remove assertions that pass in both arms; read transcripts; keep the skill lean; explain the why |
| [Plugin evals](https://code.claude.com/docs/en/plugin-evals.md) | Read, the reference parts in detail | Case layout, `prompt.md` and `case.yaml` fields, grader types, ablation and `scored: false` for `tool_used: Skill`, scaffolds, `--allow-tools`, CI flags and exit codes, the empty sandbox |
| `claude plugin eval --help`, 2.1.300 | Run | The flags above exist; a bare skills directory resolves as a plugin; `flags: i` rather than `(?i)` |
| [Using Skills with the API](https://platform.claude.com/docs/en/build-with-claude/skills-guide) | Read the first 100,000 of 145,000 characters, through a summary | Up to 20 skills per request; `name` at most 64 characters, `description` at most 1,024, no XML tags, reserved words `anthropic` and `claude`; upload under 30 MB; only `name` and `description` specified |
| [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference.md) | Read, through a summary | Reserved plugin names; `experimental.evals`; skills directory layout |
| [Best practices for skill creators](https://agentskills.io/skill-creation/best-practices) and [Optimizing skill descriptions](https://agentskills.io/skill-creation/optimizing-descriptions) (agentskills.io), read 2026-10-28 | Read in full | Gotchas sections kept in `SKILL.md`; a script when the agent keeps reinventing the same logic; about 20 trigger queries, 8 to 10 each way; near-miss negatives; 3 runs and a 0.5 threshold; the 60/40 train and validation split, choosing the best iteration by validation score, and generalising from failures instead of copying keywords; about five iterations; comparing against a snapshot of the previous version. Written for any agent, not for Claude alone |
| [Skill troubleshooting](https://code.claude.com/docs/en/skills) (Claude Code docs), second part, read 2026-10-28 | Read, through a fetch summary | Malformed frontmatter loads the body with empty metadata; `claude plugin validate` finds unparseable `SKILL.md` files (2.1.233 or later); the listing budget (`skillListingBudgetFraction`, `SLASH_COMMAND_TOOL_CHAR_BUDGET`) and the 1,536 cap (`skillListingMaxDescChars`); `skillOverrides` values; a `tool_used: Skill` eval as the way to measure triggering |
| skill-creator (`claude-plugins-official`) | Run and partly read: `run_eval.py`, `run_loop.py` and `quick_validate.py` were read, and `run_eval.py` was run; `SKILL.md`, `agents/` and `eval-viewer/` were not | Trigger-eval runner and loop flags; the command-file proxy and its first-tool-call detection; the allowed-property list in `quick_validate.py` |

## Claims the issue marked as synthesis or not yet researched

| Claim | Now |
| --- | --- |
| Skill versus CLAUDE.md, hook, subagent, MCP (the table in `SKILL.md`) | **Synthesis**, partly supported. The docs say a skill is right when "a section of CLAUDE.md has grown into a procedure rather than a fact", and that a rule that must hold every time belongs in a hook. The rest of the table is the author's reading. |
| When to use `context: fork` | **Synthesis.** The docs state what it does (a subagent that does not see the conversation, running in the background by default); "noisy exploration whose output the parent doesn't need" is inferred. |
| API skills guide | **Read** (first two-thirds). Nothing in it changes the rules; it confirms the 1,024 and 64 limits and the reserved words. |
| agentskills.io evaluation guide | **Read.** It describes the `evals.json` + with/without + `benchmark.json` pattern that skill-creator implements. |
| `claude plugin eval` against `.claude/skills/pedagogical-writing` | **Run.** Works with no `plugin.json`; see [evals](evals.md). |
| skill-creator scripts in this repo | **Run**, `run_eval.py` only. It scored 0 of 12 should-trigger queries here (proxy loses to the real skill, first-tool-call detection, 30 s timeout), so the repo measures triggers with `scripts/run-trigger-evals.mjs` instead; see [measurements](measurements.md). `run_loop.py` and the grader and viewer parts were not run. |
| `/skill-doctor` output format | **Run** with `claude -p "/skill-doctor"`: a table of skill, source, `context` (tokens of the listing entry, a dash when not in the listing), `7d tokens`, `uses` and `last used`, with "never" for unused skills. In an interactive session it opens in the `/plugin` manager's Stats tab. |
| How pi runs or ignores the eval files | **Not verified.** pi is not installed here. `evals/` is plain files with no `SKILL.md` frontmatter involvement, so it should be ignored, but that is inference. |
| Whether `.claude/skills/<name>` resolves directly | **Run: yes.** |

## Corrections to the issue

- `pedagogical-writing/evals/evals.json` held **6** prompts, not 7 (22 trigger queries, 12
  should and 10 shouldn't, as stated).
- The issue says compaction "keeps only the start of an invoked skill". Exactly: the first
  5,000 tokens of each, within a shared 25,000-token budget, most recent skill first.
- The issue says `/context` shows the cost. It shows the Skills row, the listing after the
  budget is applied (accurate since v2.1.196). `/doctor` estimates the listing's cost and
  biggest contributors.
- skill-creator's trigger runner does not test the skill folder: it writes a temporary
  command file carrying the description and runs `claude -p` in the project.

## Not verified

- **An unquoted `: ` in a `description`.** A third-party mirror of a Claude Code issue
  (v2.1.211, a plugin skill, closed "not planned") says the skill is silently dropped from the
  list. **Run on 2.1.310:** a project skill with such a description loaded with its full text,
  quoted or not, and `claude plugin validate` accepts this repo's skills. So the claim does not
  hold for project skills in that version, and the repo quotes the description only as a hedge
  for strict YAML parsers elsewhere (pi, a claude.ai upload), which were not tested.
- The community material read on 2026-10-28 (a pitfalls post arguing for 30 to 55 word
  descriptions, a post on reviewing skills by a calendar, tools such as evolveguard and
  SkillCI) is not Claude-specific, comes from single authors or vendors, and nothing in the
  rules rests on it. The measured trigger results contradict the short-description advice.
- Behaviour in pi and claude.ai of the Claude Code-only frontmatter fields (the docs say other
  hosts reject unknown fields; not tested).
- `claude plugin eval` cases that grant `Bash` cannot run on a machine where `~/.aws/credentials`
  is a symbolic link: the OS sandbox refuses ("a Bash-granting evaluation cannot run here").
  Tried here; the suites in this repo therefore grant no `Bash`.
- The Anthropic engineering post on equipping agents with skills, the `anthropics/skills`
  repository and the hooks documentation were linked from the issue and not read for this
  skill.
