#!/usr/bin/env node
// Usage: node run-trigger-evals.mjs <skill-name> [--runs N] [--model ID] [--max-cost USD] [--keep]
//
// Measures how often a skill loads on evals/trigger-evals.json. Run it from inside the repo.
//
// It turns each query into a `claude plugin eval` case with a `tool_used: Skill` grader and
// runs them against a temporary plugin that holds every skill in .claude/skills, so near
// misses meet the neighbours that would answer them. A query counts as a trigger when the
// skill is called at any point in the run. It does not use skill-creator's run_eval.py
// because that runner (a) counts a trigger only when the skill is Claude's FIRST tool call,
// so a run that looks at the repo first scores as a miss, (b) tests a proxy copy of the
// description, which loses to the real skill if it is installed, and (c) times out at 30
// seconds. All three scored every query 0 on this repo's first trial.
//
// A query passes when at least half of its runs behave as labelled. The sandbox loads no
// user settings, CLAUDE.md or user-level skills, so a prompt that only a user-level skill
// would catch is not tested here. The query list is evals/trigger-evals.json
// (skill-creator's format, so run_loop.py can still read it). No dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i < 0 ? dflt : argv[i + 1]; };
const name = argv[0];
if (!name || name.startsWith("--")) {
  console.error("usage: node run-trigger-evals.mjs <skill-name> [--runs N] [--model ID] [--max-cost USD] [--keep]");
  process.exit(2);
}
const runs = Number(flag("--runs", 3));
const model = flag("--model", "claude-sonnet-5-5");
const maxCost = flag("--max-cost", "10");

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const skillsDir = path.join(repo, ".claude", "skills");
const evalFile = path.join(skillsDir, name, "evals", "trigger-evals.json");
if (!fs.existsSync(evalFile)) { console.error(`no ${path.relative(repo, evalFile)}`); process.exit(2); }
const queries = JSON.parse(fs.readFileSync(evalFile, "utf8"));

// Temporary plugin: every skill without its evals, plus one case per query.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-evals-"));
const plugin = path.join(tmp, "repo-skills");
for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  fs.cpSync(path.join(skillsDir, d.name), path.join(plugin, "skills", d.name), {
    recursive: true,
    filter: src => !src.includes(`${path.sep}evals`),
  });
}
// A skills/ directory is only loaded as a plugin when it has a manifest (a lone SKILL.md does not need one).
fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
fs.writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "repo-skills", description: "temporary plugin for trigger evals" }));
const pad = n => String(n + 1).padStart(2, "0");
queries.forEach((q, i) => {
  const dir = path.join(plugin, "evals", `q${pad(i)}-${q.should_trigger ? "should" : "shouldnt"}`);
  fs.mkdirSync(path.join(dir, "graders"), { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), `---\nmax_turns: 3\nruns: ${runs}\nallowed_tools: [Read, Glob, Grep, Skill]\n---\n\n${q.query}\n`);
  const bounds = q.should_trigger ? "min: 1" : "min: 0\nmax: 0\narm: both";
  fs.writeFileSync(path.join(dir, "graders", "skill-fired.md"),
    `---\ntype: tool_used\ntool: Skill\ninput_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?${name}"'\n${bounds}\n---\n`);
});

const out = path.join(tmp, "result.json");
const res = spawnSync("claude", ["plugin", "eval", plugin, "--trust-plugin", "--ablation", "none", "--model", model,
  "--no-publish", "-j", "5", "--max-cost-usd", maxCost, "--json", out], { stdio: ["ignore", "ignore", "inherit"] });
if (!fs.existsSync(out)) { console.error(`claude plugin eval wrote no result (exit ${res.status})`); process.exit(2); }
const result = JSON.parse(fs.readFileSync(out, "utf8"));

let failed = 0;
const rows = [];
for (const c of result.cases) {
  const i = Number(c.name.slice(1, 3)) - 1;
  const arm = c.arms.with ?? [];
  // The turn cap ends most runs with an error after the skill has been called (or not), which is fine:
  // the grader still saw the whole trace. Only other errors (API, timeout) make a run unreliable.
  const ok = arm.filter(r => r.graders[0]?.passed).length;
  const n = arm.length;
  const errors = arm.filter(r => r.error && !/maximum number of turns/i.test(r.error)).length;
  const pass = n > 0 && ok / n >= 0.5;
  if (!pass) failed++;
  rows.push({ i, pass, ok, n, errors, should: queries[i].should_trigger, query: queries[i].query });
}
rows.sort((a, b) => a.i - b.i);
for (const r of rows) {
  const fired = r.should ? r.ok : r.n - r.ok;
  console.log(`${r.pass ? "PASS" : "FAIL"} fired ${fired}/${r.n} expected=${r.should ? "fire" : "quiet"}${r.errors ? ` (${r.errors} errored)` : ""}  ${r.query.slice(0, 90)}`);
}
const should = rows.filter(r => r.should), shouldnt = rows.filter(r => !r.should);
console.log(`\n${rows.length - failed}/${rows.length} queries passed ` +
  `(should-fire ${should.filter(r => r.pass).length}/${should.length}, should-stay-quiet ${shouldnt.filter(r => r.pass).length}/${shouldnt.length}); ` +
  `model ${model}, ${runs} runs each, cost $${result.costUsd?.toFixed(2)}`);
if (!argv.includes("--keep")) fs.rmSync(tmp, { recursive: true, force: true });
else console.log(`kept ${tmp}`);
process.exit(failed ? 1 : 0);
