---
type: llm
---

PASS if this holds of the answer: It says not to rely on the model applying its own critique, and proposes a different way: list the problems and rewrite in a separate request with the list in hand, have another model or a person fix the order, or similar.
FAIL if it recommends the same critique-then-revise loop the user already tried, or does not address why it failed.
