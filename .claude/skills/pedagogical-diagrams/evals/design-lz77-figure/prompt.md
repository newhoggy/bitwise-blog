---
max_turns: 8
runs: 3
tags: [pedagogical-diagrams]
allowed_tools: [Read, Glob, Grep, Skill]
---

I'm writing the section of a DEFLATE explainer on LZ77 copies, for a page in our blog's repo (it has stepper, versions and sequence components, and prose can point at diagram parts). A copy token says "go back 12 bytes, copy 23", and because 23 is longer than 12 the copy overlaps itself. The readers know what a byte is and have not met LZ77. Design the figure for this section: what form it takes, what is in it and what you leave out, how it is stepped, and what the caption says.
