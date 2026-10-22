---
type: llm
---

PASS if any path to a bundled file is relative to the skill directory (or uses ${CLAUDE_SKILL_DIR}), or no path is given.
FAIL if it names the script by a repo-root path such as `.claude/skills/<name>/scripts/x`.
