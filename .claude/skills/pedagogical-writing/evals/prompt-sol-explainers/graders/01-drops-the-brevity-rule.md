---
type: llm
---

PASS if this holds of the answer: It tells the user to remove or replace the "Be concise" instruction (or says brevity rules make this model compress further), and the custom instructions it proposes contain no instruction to be concise, brief or short.
FAIL if the proposed instructions still ask for concision or brevity, or the answer never addresses the existing "Be concise" line.
