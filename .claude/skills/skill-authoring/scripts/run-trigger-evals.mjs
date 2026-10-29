#!/usr/bin/env node
// Usage: node run-trigger-evals.mjs <skill-name> [--runs N] [--model ID] [--max-cost USD] [--only 1,5,9] [--max-turns N] [--keep]
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
// A query passes when at least half of its runs behave as labelled. A run that errored (other than
// at the turn cap) before calling the skill counts neither way; if such runs could tip the result,
// the query is ERROR, which is not a pass. The sandbox loads no user settings, CLAUDE.md or
// user-level skills, so a prompt that only a user-level skill would catch is not tested here. The
// query list is evals/trigger-evals.json (skill-creator's format, so run_loop.py can still read
// it). No dependencies.
//
// Every error other than the turn cap is printed under its query, so an ERROR names its cause.
// --keep keeps the temporary plugin and copies each run's trace into its traces/ directory, and
// lists the tool calls of every run that did not behave as labelled, or errored, so a miss can be
// read rather than guessed from turn counts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i < 0 ? dflt : argv[i + 1]; };
const name = argv[0];
if (!name || name.startsWith("--")) {
  console.error("usage: node run-trigger-evals.mjs <skill-name> [--runs N] [--model ID] [--max-cost USD] [--only 1,5,9] [--max-turns N] [--keep]");
  process.exit(2);
}
const runs = Number(flag("--runs", 3));
const model = flag("--model", "claude-sonnet-5-5");
const maxCost = flag("--max-cost", "10");
// 3 keeps a run cheap; a query that sends Claude looking around first may need more to reach a skill.
const maxTurns = Number(flag("--max-turns", 3));
if (!Number.isInteger(maxTurns) || maxTurns < 1) { console.error("--max-turns takes a whole number of turns, 1 or more"); process.exit(2); }
const keep = argv.includes("--keep");

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const skillsDir = path.join(repo, ".claude", "skills");
const evalFile = path.join(skillsDir, name, "evals", "trigger-evals.json");
if (!fs.existsSync(evalFile)) { console.error(`no ${path.relative(repo, evalFile)}`); process.exit(2); }
const all = JSON.parse(fs.readFileSync(evalFile, "utf8"));
// --only 1,5,9 runs just those queries (1-based positions in the file), to re-check a few after an edit.
const only = flag("--only", "") ? new Set(flag("--only", "").split(",").map(Number)) : null;
const queries = all.filter((_, i) => !only || only.has(i + 1));
const position = all.map((q, i) => [q, i + 1]).filter(([, n]) => !only || only.has(n)).map(([, n]) => n);

// Temporary plugin: every skill without its evals, plus one case per query.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trigger-evals-"));
const plugin = path.join(tmp, "repo-skills");
for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const evalsDir = path.join(skillsDir, d.name, "evals");
  fs.cpSync(path.join(skillsDir, d.name), path.join(plugin, "skills", d.name), {
    recursive: true,
    filter: src => src !== evalsDir,
  });
}
// A skills/ directory is only loaded as a plugin when it has a manifest (a lone SKILL.md does not need one).
fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
fs.writeFileSync(path.join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "repo-skills", description: "temporary plugin for trigger evals" }));
const pad = n => String(n + 1).padStart(3, "0");
queries.forEach((q, i) => {
  const dir = path.join(plugin, "evals", `q${pad(i)}-${q.should_trigger ? "should" : "shouldnt"}`);
  fs.mkdirSync(path.join(dir, "graders"), { recursive: true });
  fs.writeFileSync(path.join(dir, "prompt.md"), `---\nmax_turns: ${maxTurns}\nruns: ${runs}\nallowed_tools: [Read, Glob, Grep, Skill]\n---\n\n${q.query}\n`);
  const bounds = q.should_trigger ? "min: 1" : "min: 0\nmax: 0\narm: both";
  fs.writeFileSync(path.join(dir, "graders", "skill-fired.md"),
    `---\ntype: tool_used\ntool: Skill\ninput_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?${name}"'\n${bounds}\n---\n`);
});

// The turn cap ends most runs with an error after the skill has been called (or not), which is fine:
// the grader still saw the whole trace. Only other errors (API, timeout) make a run unreliable.
const counted = r => r.error && !/maximum number of turns/i.test(String(r.error));
const passed = r => r.graders?.[0]?.passed === true;

// --keep-temp keeps each run's scratch directory (the trace is <dir>/out/trace.jsonl), read-only and
// partly mode 000. The traces are copied into traces/ and the directories removed afterwards, or a
// full suite leaves ~90 of them that a plain rm -rf cannot delete.
function copyTrace(tracePath, dest) {
  if (!tracePath || !fs.existsSync(tracePath)) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(tracePath, dest);
  return dest;
}
function removeScratch(tracePath) {
  const scratch = path.dirname(path.dirname(tracePath));
  if (path.basename(path.dirname(tracePath)) !== "out" || !/^e-/.test(path.basename(scratch)) || !fs.existsSync(scratch)) return;
  const writable = dir => {
    fs.chmodSync(dir, 0o700);
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) writable(path.join(dir, d.name));
  };
  try { writable(scratch); fs.rmSync(scratch, { recursive: true, force: true }); }
  catch (err) { console.error(`could not remove ${scratch}: ${err.message}`); }
}

// What a run did, from its trace: the tool calls in order (a failed or denied one marked), and how it ended.
function toolCalls(trace) {
  const calls = new Map();
  let end = "no result";
  for (const line of fs.readFileSync(trace, "utf8").split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b.type === "tool_use") calls.set(b.id ?? `#${calls.size}`, b.name === "Skill" ? `Skill ${b.input?.skill}` : b.name);
      else if (b.type === "tool_result" && b.is_error && calls.has(b.tool_use_id)) calls.set(b.tool_use_id, `${calls.get(b.tool_use_id)} (error)`);
    }
    if (e.type === "result") end = e.subtype === "error_max_turns" ? "turn cap" : e.subtype ?? "ended";
  }
  return `${[...calls.values()].join(", ") || "no tool calls"}; ${end}`;
}

function run() {
  const out = path.join(tmp, "result.json");
  const res = spawnSync("claude", ["plugin", "eval", plugin, "--trust-plugin", "--ablation", "none", "--model", model,
    "--no-publish", "-j", "5", "--max-cost-usd", maxCost, "--json", out, ...(keep ? ["--keep-temp"] : [])],
    { stdio: ["ignore", "ignore", "inherit"] });
  if (!fs.existsSync(out)) throw new Error(`claude plugin eval wrote no result (exit ${res.status})`);
  const result = JSON.parse(fs.readFileSync(out, "utf8"));
  try {
    return report(result);
  } finally {
    if (keep) for (const c of result.cases ?? []) for (const r of c.arms?.with ?? []) if (r.tracePath) removeScratch(r.tracePath);
  }
}

function report(result) {
  let failed = 0;
  const rows = [];
  for (const c of result.cases) {
    const i = Number(/^q(\d+)-/.exec(c.name)[1]) - 1;
    const arm = c.arms.with ?? [];
    const should = queries[i].should_trigger;
    // A run that errored before it called the skill measured nothing: it would pass a quiet query and
    // fail a firing one, so it is left out. One that called the skill and then errored did fire.
    // (A should-fire grader passes on the call; a should-stay-quiet one fails on it.)
    const scored = arm.filter(r => !counted(r) || r.graders?.[0]?.passed === should);
    const ok = scored.filter(passed).length;
    const n = scored.length;
    const errors = arm.length - n;
    // At least half of all runs must behave as labelled. If the left-out runs could tip that either
    // way (always when fewer than half the runs are scored), nothing was decided.
    const best = (ok + errors) * 2 >= arm.length, worst = ok * 2 >= arm.length;
    const status = n === 0 || best !== worst ? "ERROR" : worst ? "PASS" : "FAIL";
    if (status !== "PASS") failed++;
    const traces = keep ? arm.map((r, k) => copyTrace(r.tracePath, path.join(tmp, "traces", `q${position[i]}-run${k + 1}.jsonl`))) : [];
    rows.push({ i, status, ok, n, errors, arm, traces, should, heldout: queries[i].heldout === true, query: queries[i].query });
  }
  rows.sort((a, b) => a.i - b.i);
  // A case that failed to load is absent from the result, and would otherwise lower nothing.
  const missing = queries.length - rows.length;
  if (missing) { failed += missing; console.error(`${missing} of ${queries.length} cases are missing from the result: they failed to load (read the top of the claude plugin eval output).`); }
  for (const r of rows) {
    const fired = r.should ? r.ok : r.n - r.ok;
    console.log(`${r.status} #${position[r.i]}${r.heldout ? " held-out" : ""} fired ${fired}/${r.n} expected=${r.should ? "fire" : "quiet"}${r.errors ? ` (${r.errors} errored)` : ""}  ${r.query.slice(0, 90)}`);
    r.arm.forEach((run, k) => {
      if (counted(run)) console.log(`    run ${k + 1} error: ${String(run.error).replace(/\s+/g, " ").slice(0, 300)}`);
      const trace = r.traces[k];
      // A run that did not behave as labelled, or errored, is the one worth reading; passing query or not.
      if (trace && (!passed(run) || counted(run))) console.log(`    run ${k + 1} tools: ${toolCalls(trace)}  ${path.relative(tmp, trace)}`);
    });
  }
  // Tune against the train part only; the held-out part says whether a rewrite generalises.
  // An ERROR is not passed, but is named apart so an outage is not read as a miss.
  const tally = p => {
    const errored = p.filter(r => r.status === "ERROR").length;
    return `${p.filter(r => r.status === "PASS").length}/${p.length}${errored ? ` (${errored} errored)` : ""}`;
  };
  const part = hs => { const p = rows.filter(r => r.heldout === hs); return p.length ? tally(p) : "none"; };
  if (rows.some(r => r.heldout)) console.log(`\npassed: train ${part(false)}, held-out ${part(true)}`);
  const should = rows.filter(r => r.should), shouldnt = rows.filter(r => !r.should);
  const errored = rows.filter(r => r.status === "ERROR").length;
  console.log(`\n${rows.length - (failed - missing)}/${queries.length} queries passed ` +
    `(should-fire ${tally(should)}, should-stay-quiet ${tally(shouldnt)})` +
    `${errored ? `, ${errored} errored` : ""}; ` +
    `model ${model}, ${runs} runs each, cost $${result.costUsd?.toFixed(2)}`);
  return failed ? 1 : 0;
}

let code;
try {
  code = run();
} catch (err) {
  console.error(err.message);
  code = 2;
} finally {
  // claude plugin eval printed a "kept /private/tmp/e-…" notice per run; run() removed those directories.
  if (keep) console.log(`kept ${tmp} (each run's trace is in its traces/)`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
