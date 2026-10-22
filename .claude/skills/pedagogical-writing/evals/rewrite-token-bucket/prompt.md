---
max_turns: 8
runs: 3
tags: [pedagogical-writing]
allowed_tools: [Read, Glob, Grep, Skill]
---

This paragraph is going into an explainer on rate limiting. Rewrite it so a newcomer can follow it:

A token bucket with capacity B and refill rate r admits a request iff tokens >= 1, decrementing on admit; tokens = min(B, tokens + r * dt). This bounds burst size to B and long-run throughput to r, unlike a fixed window counter, which permits 2x bursts at window boundaries.
