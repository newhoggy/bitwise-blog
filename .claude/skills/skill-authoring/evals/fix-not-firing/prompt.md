---
max_turns: 12
runs: 3
tags: [debug]
allowed_tools: [Read, Glob, Grep, Skill]
---

My skill `changelog-writer` never fires. Its description is: "Changelog writer. Writes changelogs." When I type things like "can you tidy up the release notes for v2.3" or "summarise what changed since the last tag" Claude just does it without loading the skill. Other skills in this repo are `pedagogical-writing` and `dataviz`. What should I change, and how do I check the fix actually works rather than just feeling better?
