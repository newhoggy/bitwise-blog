---
type: llm
---

PASS if the answer says that `disable-model-invocation` (or any other field outside name/description/license/compatibility/metadata/allowed-tools) is read only by Claude Code, so the skill may not load or may be rejected in other hosts such as pi or claude.ai, and either accepts that trade-off knowingly or offers an alternative.
FAIL if it recommends the field without any mention of portability.
