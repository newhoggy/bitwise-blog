---
max_turns: 8
runs: 3
tags: [pedagogical-writing]
allowed_tools: [Read, Glob, Grep, Skill]
---

This passage is from a draft explainer for this blog, written for programmers who have never thought about how a CPU runs their code. Review it for clarity: where will the reader be misled or get lost?

> ## Why the CPU doesn't wait
>
> Most programmers picture the CPU running an `if` like this: compute the condition, wait for the answer, then fetch whichever side won. That picture is wrong. A modern CPU doesn't wait. It guesses which way the branch will go and starts running that side straight away, often 15 or 20 instructions ahead.
>
> The guess comes from the branch predictor, a small table that remembers what each branch did the last few times. For a loop that runs a million times, the predictor is right on all but the last iteration, so the loop's `if` costs almost nothing.
>
> When the guess is wrong, the CPU throws away the work it did on the wrong side, flushes the pipeline, and waits about 15 cycles while it refills from the right address. On a branch that goes each way at random, that happens half the time, which is why sorting an array first can make a loop over it six times faster.
>
> The same trick shows up all over the CPU. When you walk an array, the branch predictor sees the pattern of addresses and starts loading the next cache lines before you ask for them, so your loop rarely waits for memory. That is why arrays beat linked lists: the predictor can't guess where the next node lives.
>
> Speculation like this is also why Spectre was possible.
