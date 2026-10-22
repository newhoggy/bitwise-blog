---
type: llm
---

PASS if the answer proposes a skill that is mostly a single SKILL.md (optionally with a reference or a script) and explicitly says it does not need heavier machinery such as forked context, hooks or plugin packaging, or says why it would climb a level.
FAIL if it proposes forked context, hooks, an MCP server or packaging without a stated reason from the use case, or gives no guidance on what to leave out.
