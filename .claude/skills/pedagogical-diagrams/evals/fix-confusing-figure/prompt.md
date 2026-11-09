---
max_turns: 8
runs: 3
tags: [pedagogical-diagrams]
allowed_tools: [Read, Glob, Grep, Skill]
---

A figure on my page about request routing confuses readers. It shows 14 boxes in a grid: client, load balancer, three gateways, two caches, three services, a queue, a database and a logger. There are 9 arrows. Solid arrows sometimes mean "calls" and sometimes "sends data back". Dashed arrows mean "logs to". Five colours, and a legend in the bottom corner explaining them. The paragraph under it then repeats what every box does, one sentence per box. The point of the section is that a cache hit skips the services entirely. How should I fix the figure?
