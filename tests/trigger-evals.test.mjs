import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/skills/skill-authoring/scripts/run-trigger-evals.mjs");

// A stand-in for `claude plugin eval`: for each case in the plugin it writes one trace per run in a
// scratch directory named e-*, as the real one does, and a result JSON. Each run's behaviour comes
// from FAKE_RUNS, keyed by query text. Without --keep-temp it deletes the scratch directories; with
// it, it leaves them read-only with a mode-000 sealed/ inside, as the real one does.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const plugin = args[2], out = args[args.indexOf("--json") + 1], keepTemp = args.includes("--keep-temp");
const plan = JSON.parse(process.env.FAKE_RUNS);
const log = { args, maxTurns: [] };
const cases = [];
for (const name of fs.readdirSync(path.join(plugin, "evals")).sort()) {
  const md = fs.readFileSync(path.join(plugin, "evals", name, "prompt.md"), "utf8");
  log.maxTurns.push(Number(/max_turns: (\\d+)/.exec(md)[1]));
  const query = md.split("---\\n\\n")[1].trim(), should = name.endsWith("-should");
  const runs = plan[query].map(r => {
    const scratch = fs.mkdtempSync(path.join(process.env.FAKE_TMP, "e-"));
    fs.mkdirSync(path.join(scratch, "out"));
    const tracePath = path.join(scratch, "out", "trace.jsonl");
    const tools = [...(r.tools ?? []), ...(r.fire ? [{ name: "Skill", input: { skill: "repo-skills:demo" } }] : [])];
    const lines = [{ type: "system", subtype: "init" }];
    tools.forEach((t, k) => {
      lines.push({ type: "assistant", message: { content: [{ type: "tool_use", id: "t" + k, name: t.name, input: t.input ?? {} }] } });
      lines.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t" + k, content: "x", ...(t.error ? { is_error: true } : {}) }] } });
    });
    lines.push({ type: "result", subtype: r.end ?? "success" });
    fs.writeFileSync(tracePath, lines.map(l => JSON.stringify(l)).join("\\n") + "\\n");
    if (keepTemp) {
      fs.mkdirSync(path.join(scratch, "sealed", "home"), { recursive: true });
      fs.chmodSync(path.join(scratch, "sealed"), 0o000);
      fs.chmodSync(scratch, 0o500);
    } else fs.rmSync(scratch, { recursive: true });
    return { error: r.error ?? null, tracePath, graders: [{ passed: should ? !!r.fire : !r.fire }] };
  });
  cases.push({ name, arms: { with: runs } });
}
fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify(log));
fs.writeFileSync(out, JSON.stringify({ costUsd: 0.12, cases }));
`;

const SHOULD = "explain this to a newcomer";
const QUIET = "rebase my branch";

function setup(plan) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-evals-test-"));
  const repo = path.join(root, "repo");
  const evals = path.join(repo, ".claude", "skills", "demo", "evals");
  fs.mkdirSync(evals, { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude", "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\n");
  fs.writeFileSync(path.join(evals, "trigger-evals.json"), JSON.stringify([
    { query: SHOULD, should_trigger: true },
    { query: QUIET, should_trigger: false, heldout: true },
  ]));
  execFileSync("git", ["init", "-q", repo]);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), FAKE_CLAUDE, { mode: 0o755 });
  for (const d of ["scratch", "tmp"]) fs.mkdirSync(path.join(root, d));
  const env = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TMPDIR: path.join(root, "tmp"),
    FAKE_RUNS: JSON.stringify(plan), FAKE_TMP: path.join(root, "scratch"), FAKE_LOG: path.join(root, "log.json"),
  };
  const run = (...flags) => {
    const res = spawnSync(process.execPath, [runner, "demo", ...flags], { cwd: repo, env, encoding: "utf8" });
    return { ...res, log: JSON.parse(fs.readFileSync(env.FAKE_LOG, "utf8")), scratch: fs.readdirSync(env.FAKE_TMP) };
  };
  return { root, run };
}

test("prints the text of every counted error, but not of the turn cap", (t) => {
  const { root, run } = setup({
    [SHOULD]: [{ fire: true }, { fire: true }, {}],
    [QUIET]: [{ error: "exit 1: API Error: 529 overloaded" }, {}, { error: "exit 1: Reached maximum number of turns (3)", end: "error_max_turns" }],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const res = run("--max-turns", "7");
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /PASS #2 held-out fired 0\/3 expected=quiet \(1 errored\)/);
  assert.match(res.stdout, /^ {4}run 1 error: exit 1: API Error: 529 overloaded$/m);
  assert.doesNotMatch(res.stdout, /maximum number of turns/);
  // No --keep: no traces, no tool lines, and nothing left behind.
  assert.doesNotMatch(res.stdout, /tools:|kept /);
  assert.ok(!res.log.args.includes("--keep-temp"));
  assert.deepEqual(res.scratch, []);
  assert.deepEqual(fs.readdirSync(path.join(root, "tmp")), []);
  assert.deepEqual(res.log.maxTurns, [7, 7]);
});

test("--keep copies every trace, removes the scratch directories and lists a miss's tool calls", (t) => {
  const tools = [{ name: "Grep" }, { name: "Glob", error: true }];
  const { root, run } = setup({
    [SHOULD]: [{ tools, end: "error_max_turns", error: "exit 1: Reached maximum number of turns (3)" }, { tools }, { tools, fire: true }],
    [QUIET]: [{}, {}, {}],
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const res = run("--keep");
  assert.equal(res.status, 1, res.stderr);
  assert.ok(res.log.args.includes("--keep-temp"));
  assert.deepEqual(res.log.maxTurns, [3, 3]);
  assert.deepEqual(res.scratch, [], "a read-only scratch directory was left behind");

  const kept = /^kept (\S+)/m.exec(res.stdout)[1];
  assert.deepEqual(fs.readdirSync(path.join(kept, "traces")).sort(),
    ["q1-run1.jsonl", "q1-run2.jsonl", "q1-run3.jsonl", "q2-run1.jsonl", "q2-run2.jsonl", "q2-run3.jsonl"]);
  assert.match(res.stdout, /FAIL #1 fired 1\/3 expected=fire/);
  assert.match(res.stdout, /^ {4}run 1 tools: Grep, Glob \(error\); turn cap  traces\/q1-run1\.jsonl$/m);
  assert.match(res.stdout, /^ {4}run 3 tools: Grep, Glob \(error\), Skill repo-skills:demo; success  traces\/q1-run3\.jsonl$/m);
  // A passing query with no errors prints no tool lines.
  assert.doesNotMatch(res.stdout, /q2-run/);
});
