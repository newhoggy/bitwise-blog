---
max_turns: 8
runs: 3
tags: [pedagogical-writing]
allowed_tools: [Read, Glob, Grep, Skill]
---

Revise this paragraph from a succinct data structures page so it reads more easily, without changing what it says:

The directory, which for a bit vector of n bits with superblocks of 2^16 bits and blocks of 512 bits stores one 64-bit absolute count per superblock and one 16-bit relative count per block, enables rank queries in constant time. A query performs a lookup of the superblock count, then the computation of the block count is done, and a popcount over the remaining word chunk finishes it. Obviously the space overhead is small.
