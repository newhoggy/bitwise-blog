# Skills

Read this before touching `.claude/skills/`.

The agent skills in `.claude/skills/` have their own house rules. The `skill-authoring` skill
holds them, with the reasons; this is the short form.

- **Layout:** `SKILL.md` (at most 500 lines), `references/`, `scripts/`, `evals/`. Reference
  bundled files relative to the skill directory, never by a `.claude/skills/<name>/…` path.
- **Frontmatter:** `name` (at most 64 characters, matches the directory, no `claude` or
  `anthropic`) and `description` (at most 1,024 characters, third person, says what and when,
  names what it is not for). Add Claude Code-only fields only when they earn their place.
- **Evals:** both kinds run through `claude plugin eval`. Trigger queries live in
  `evals/trigger-evals.json` (skill-creator's format) and are measured with
  `npm run trigger-evals -- <skill>` (set about 40% of the queries aside as `"heldout": true`
  before tuning a description); output cases are `evals/<case>/` directories, which also give
  the with/without delta. A skill's rules come from a measured gap against the no-skill baseline.
- **Check:** `npm run lint-skills` must report 0 errors, and `claude plugin validate .claude/skills`
  must pass (it parses the frontmatter, which the lint does not). Re-run the evals when a skill changes.
- **Scheduled run:** `.github/workflows/skill-evals.yml` runs every skill's evals monthly and fails
  when a pass rate falls (`npm run skill-evals`; off until `SKILL_EVALS_ENABLED` is `true`). It costs
  money: see `skill-authoring/references/maintenance.md`.
