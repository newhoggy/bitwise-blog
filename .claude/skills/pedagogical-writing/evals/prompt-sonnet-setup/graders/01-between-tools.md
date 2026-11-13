---
type: llm
---

PASS if this holds of the answer: It says that with thinking set to between_tools and no tools in the request the model answers without thinking first, and recommends adaptive thinking (or another setting that lets it think) for drafting.
FAIL if it keeps between_tools, or changes only effort or temperature without addressing that the model is not thinking before it writes.
