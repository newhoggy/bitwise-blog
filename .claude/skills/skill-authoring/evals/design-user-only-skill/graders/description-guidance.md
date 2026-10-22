---
type: llm
---

PASS if the answer says how the description should be handled given the skill must only run on request (for example that with model invocation disabled the description is not in context, or that it should still say what the skill does and name the user phrases).
FAIL if it ignores the description or advises writing a long "pushy" description for a skill Claude must never trigger on its own.
