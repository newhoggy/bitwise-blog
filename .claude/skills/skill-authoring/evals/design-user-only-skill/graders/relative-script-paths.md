---
type: llm
---

PASS if the answer, when it mentions any bundled script or file path, refers to it relative to the skill directory (or with ${CLAUDE_SKILL_DIR}), or it does not need a script. FAIL if it names a script by a repo-root path such as `.claude/skills/<name>/scripts/x`.
