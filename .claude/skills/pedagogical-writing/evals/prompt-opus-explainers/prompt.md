---
max_turns: 8
runs: 3
tags: [pedagogical-writing]
allowed_tools: [Read, Glob, Grep, Skill]
---

I draft the explainers for my blog with Claude Opus 5.5 through the API. The sentences read fine, but my editor says every section takes forever to reach its point, and the drafts keep saying things like "This matters." or "This is the key insight." without showing why. I've tried asking it to critique its own draft and then revise, and the revisions don't fix it. My system prompt is Anthropic's suggested one from the Opus 5 guide, which includes "when asked to explain something, give a high-level summary unless an in-depth one is specifically requested." What should I change?
