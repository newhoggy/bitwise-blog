---
max_turns: 8
runs: 3
tags: [pedagogical-writing]
allowed_tools: [Read, Glob, Grep, Skill]
---

We run Claude Sonnet 5.5 through the API with thinking set to between_tools to keep latency down, and in one call per section we have it turn our engineers' rough notes into tutorial sections. No tools are attached to the request. The output reads fine but feels flat, and it often skips steps a newcomer needs. What should we change, in the API settings and in the prompt?
