import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  FORMAT, compare, mergeRetry, outputFromResult, parseRecord, renderSummary, triggerErrors, triggerFromJson,
  type EvalRecord, type SkillRecord,
} from "../scripts/skill-evals.mts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "skill-evals.mts");

// ---- fixtures -----------------------------------------------------------------------------------------

interface TriggerOpts { errored?: number; missing?: number; partial?: boolean; cost?: number; claudeVersion?: string }
/** What `run-trigger-evals.mjs --json` writes: `total` queries, the first `passed` of them PASS, the rest FAIL or ERROR. */
function triggerJson(passed: number, total: number, o: TriggerOpts = {}) {
  const errored = o.errored ?? 0;
  const queries = Array.from({ length: total }, (_, i) => ({
    position: i + 1,
    status: i < passed ? "PASS" : i >= total - errored ? "ERROR" : "FAIL",
    shouldTrigger: i % 2 === 0, heldout: i % 5 === 4, fired: 0, scored: 3, errored: 0, query: `query ${i + 1}`,
  }));
  const c = (list: typeof queries) => ({
    passed: list.filter(q => q.status === "PASS").length, total: list.length, errored: list.filter(q => q.status === "ERROR").length,
  });
  return {
    skill: "alpha", model: "m", runs: 3, costUsd: o.cost ?? 1, claudeVersion: o.claudeVersion ?? "2.1.318", missing: o.missing ?? 0, partial: o.partial ?? false,
    totals: { all: c(queries), shouldFire: c(queries.filter(q => q.shouldTrigger)), shouldStayQuiet: c(queries.filter(q => !q.shouldTrigger)), heldout: c(queries.filter(q => q.heldout)) },
    queries,
  };
}

type FakeRun = { score: number; error?: string };
/** The relevant part of `claude plugin eval --json`: the cases by directory, with the runs of each arm. */
function outputJson(cases: Record<string, { with: (number | FakeRun)[]; without?: (number | FakeRun)[] }>, extra: Record<string, unknown> = {}) {
  const runs = (xs: (number | FakeRun)[] | undefined) => (xs ?? []).map(x => (typeof x === "number" ? { score: x } : x));
  return {
    claudeVersion: "2.1.318", costUsd: 2, partial: false, ...extra,
    cases: Object.entries(cases).map(([name, c]) => ({ name, dir: `evals/${name}`, arms: { with: runs(c.with), without: runs(c.without) } })),
  };
}

function record(skills: Record<string, SkillRecord>, over: Partial<EvalRecord> = {}): EvalRecord {
  return {
    format: FORMAT, date: "2026-11-01T06:17:00.000Z", commit: "abcdef0123", claudeVersion: "2.1.318",
    models: { agent: "claude-sonnet-5-5", judge: "claude-haiku-5-5" }, costUsd: 5, skills, ...over,
  };
}
const trig = (passed: number, total: number, o: TriggerOpts = {}): SkillRecord => ({ trigger: triggerFromJson(triggerJson(passed, total, o))!, errors: [] });
const out = (cases: Record<string, number[]>, without = 0.4): SkillRecord => ({
  output: outputFromResult(outputJson(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, { with: v, without: [without] }]))), Object.keys(cases)).record,
  errors: [],
});

// ---- reading the tools' JSON ---------------------------------------------------------------------------

test("triggerFromJson keeps the counts and the per-query status, and rejects anything else", () => {
  const t = triggerFromJson(triggerJson(8, 10))!;
  assert.deepEqual(t.counts.all, { passed: 8, total: 10, errored: 0 });
  assert.equal(t.queries.length, 10);
  assert.equal(t.queries[9].status, "FAIL");
  assert.equal(t.costUsd, 1);
  assert.equal(triggerFromJson(null), null);
  assert.equal(triggerFromJson({ totals: {} }), null);
  assert.equal(triggerFromJson({ queries: [{ query: "q", status: "PASS" }] }), null, "a query needs its position");
  assert.equal(triggerFromJson({ ...triggerJson(1, 2), queries: [{ query: 3 }] }), null);
});

test("triggerErrors names errored queries and cases that failed to load", () => {
  const j = triggerJson(8, 10, { errored: 2, missing: 1 });
  const errs = triggerErrors(j, triggerFromJson(j)!);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /2 trigger queries errored/);
  assert.match(errs[1], /1 trigger cases failed to load/);
  const clean = triggerJson(8, 10);
  assert.deepEqual(triggerErrors(clean, triggerFromJson(clean)!), []);
  // A run cut short by the cost ceiling says so, rather than calling its unstarted cases broken.
  const cut = triggerJson(8, 8, { missing: 5, partial: true });
  assert.deepEqual(triggerErrors(cut, triggerFromJson(cut)!), ["the trigger evals stopped early (the cost ceiling was hit or the run was aborted): 5 queries were not run"]);
});

test("outputFromResult averages the runs of each arm and reports the delta", () => {
  const { record: r, errors } = outputFromResult(outputJson({ a: { with: [1, 1, 0.5], without: [0.5, 0.5, 0.5] }, b: { with: [1], without: [0.5] } }), ["a", "b"]);
  assert.deepEqual(errors, []);
  assert.equal(r.cases[0].name, "a");
  assert.ok(Math.abs(r.cases[0].withSkill! - 2.5 / 3) < 1e-9);
  assert.equal(r.cases[0].withoutSkill, 0.5);
  assert.ok(Math.abs(r.cases[0].delta! - (2.5 / 3 - 0.5)) < 1e-9);
  assert.ok(Math.abs(r.meanWith! - (2.5 / 3 + 1) / 2) < 1e-9);
  assert.equal(r.meanWithout, 0.5);
  assert.equal(r.costUsd, 2);
});

test("outputFromResult: a case with no without-arm has no delta", () => {
  const { record: r } = outputFromResult(outputJson({ a: { with: [1] } }), ["a"]);
  assert.equal(r.cases[0].withoutSkill, null);
  assert.equal(r.cases[0].delta, null);
  assert.equal(r.meanDelta, null);
});

test("outputFromResult: errored runs are errors and out of the mean; the turn cap is neither", () => {
  const { record: r, errors } = outputFromResult(outputJson({
    a: { with: [1, { score: 0, error: "scaffold failed: fixture.sh exited 1" }, { score: 0.5, error: "exit 1: Reached maximum number of turns (25)" }], without: [0.5] },
  }), ["a"]);
  assert.deepEqual(errors, ["a: scaffold failed: fixture.sh exited 1"]);
  // The scaffold row (0) is out of the mean; the turn-capped run (0.5) is in it.
  assert.equal(r.cases[0].withSkill, 0.75);
});

test("outputFromResult: a case missing from the result, a partial result and an empty one are errors", () => {
  const missing = outputFromResult(outputJson({ a: { with: [1] } }), ["a", "b"]);
  assert.deepEqual(missing.errors, ["b: the case failed to load (it is not in the result)"]);
  const partial = outputFromResult(outputJson({ a: { with: [1] } }, { partial: true }), ["a"]);
  assert.match(partial.errors[0], /partial/);
  assert.match(outputFromResult({}, ["a"]).errors[0], /no cases/);
});

// ---- comparing -----------------------------------------------------------------------------------------

test("a trigger pass rate that falls by more than the tolerance is a regression; exactly the tolerance is not", () => {
  const prev = record({ alpha: trig(18, 20) });
  const exactly = compare(prev, record({ alpha: trig(16, 20) }), 0.1);
  assert.deepEqual(exactly.regressions, []);
  const worse = compare(prev, record({ alpha: trig(15, 20) }), 0.1);
  assert.equal(worse.regressions.length, 1);
  assert.match(worse.regressions[0], /^alpha: trigger pass rate fell from 90% to 75% \(18\/20 to 15\/20 queries\)$/);
  // A rise is not one either, and a different tolerance moves the line.
  assert.deepEqual(compare(prev, record({ alpha: trig(20, 20) }), 0.1).regressions, []);
  assert.equal(compare(prev, record({ alpha: trig(16, 20) }), 0.05).regressions.length, 1);
});

test("a fall in the mean output score with the skill is a regression", () => {
  const prev = record({ beta: out({ x: [1], y: [1] }) });
  assert.deepEqual(compare(prev, record({ beta: out({ x: [1], y: [0.95] }) }), 0.1).regressions, []);
  const r = compare(prev, record({ beta: out({ x: [1], y: [0.5] }) }), 0.1);
  assert.deepEqual(r.regressions, ["beta: mean output score with the skill fell from 1.00 to 0.75"]);
  // The case that moved is listed.
  assert.ok(r.changes.includes("beta: output case y 1.00 → 0.50"));
});

test("flipped queries, version changes, new and removed skills are listed but do not fail", () => {
  const prev = record({ alpha: trig(10, 10), gone: trig(1, 1) });
  const cur = record({ alpha: trig(9, 10), fresh: trig(1, 1) }, { claudeVersion: "2.1.330", models: { agent: "claude-sonnet-5-6", judge: "claude-haiku-5-5" } });
  const r = compare(prev, cur, 0.1);
  assert.deepEqual(r.regressions, []);
  assert.deepEqual(r.changes, [
    "Claude Code 2.1.318 → 2.1.330",
    "agent model claude-sonnet-5-5 → claude-sonnet-5-6",
    'alpha: trigger query "query 10" PASS → FAIL (expected to stay quiet)',
    "fresh: new since the previous record",
    "gone: in the previous record, not in this run",
  ]);
});

test("a skill with trigger evals in only one of the two records is not compared", () => {
  assert.deepEqual(compare(record({ alpha: { errors: [] } }), record({ alpha: trig(0, 10) }), 0.1).regressions, []);
});

test("parseRecord accepts only this format", () => {
  const r = record({ alpha: trig(1, 1) });
  assert.deepEqual(parseRecord(JSON.stringify(r)), r);
  assert.equal(parseRecord("not json"), null);
  assert.equal(parseRecord(JSON.stringify({ ...r, format: "bh-skill-evals/0" })), null);
  assert.equal(parseRecord("[]"), null);
});

test("parseRecord rejects a record whose skills compare would trip over", () => {
  const r = record({ alpha: trig(1, 1) });
  for (const bad of [
    { alpha: { errors: [], trigger: { counts: {}, queries: [] } } },
    { alpha: { errors: [], trigger: { counts: { all: { passed: 1, total: 1, errored: 0 } }, queries: "x" } } },
    { alpha: { errors: [], output: { meanWith: "high", cases: [] } } },
    { alpha: { errors: [], output: { meanWith: 1, cases: [{ withSkill: 1 }] } } },
    { alpha: { trigger: r.skills.alpha.trigger } },
    { alpha: 3 },
  ]) assert.equal(parseRecord(JSON.stringify({ ...r, skills: bad })), null, JSON.stringify(bad).slice(0, 60));
  assert.equal(parseRecord(JSON.stringify({ ...r, models: { agent: 1 } })), null);
});

test("mergeRetry replaces only the ERROR queries the retry decided, and recounts", () => {
  const first = triggerFromJson(triggerJson(6, 10, { errored: 3, cost: 4 }))!;
  assert.deepEqual(first.counts.all, { passed: 6, total: 10, errored: 3 });
  const erroredPositions = first.queries.filter(q => q.status === "ERROR").map(q => q.position);
  assert.deepEqual(erroredPositions, [8, 9, 10]);
  // The retry decides #8 (pass) and #9 (fail) and errors again on #10; it also repeats a query that had passed.
  const retry = triggerFromJson({
    costUsd: 0.5,
    queries: [8, 9, 10, 1].map((position, i) => ({ position, query: `query ${position}`, status: ["PASS", "FAIL", "ERROR", "FAIL"][i], shouldTrigger: true, heldout: false })),
  })!;
  const merged = mergeRetry(first, retry);
  assert.deepEqual(merged.queries.map(q => q.status), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "FAIL", "PASS", "FAIL", "ERROR"]);
  assert.deepEqual(merged.counts.all, { passed: 7, total: 10, errored: 1 }, "a PASS is never replaced");
  assert.equal(merged.costUsd, 4.5);
  // A retry of a different query list (the file was edited meanwhile) changes nothing.
  const other = triggerFromJson({ queries: [{ position: 8, query: "something else", status: "PASS", shouldTrigger: true, heldout: false }] })!;
  assert.deepEqual(mergeRetry(first, other).counts.all, first.counts.all);
});

test("renderSummary tables the rates and names regressions, errors and the baseline", () => {
  const prev = record({ alpha: trig(18, 20), beta: out({ x: [1] }) });
  const cur = record({ alpha: trig(10, 20), beta: out({ x: [0.5] }, 0.25) });
  const md = renderSummary(cur, prev, compare(prev, cur, 0.1), ["gamma: trigger evals wrote no usable result"]);
  assert.match(md, /^# Skill evals, 2026-11-01$/m);
  assert.match(md, /^\| alpha \| 10\/20 \(50%\) \| 18\/20 \(90%\) \| n\/a \| n\/a \| n\/a \|$/m);
  assert.match(md, /^\| beta \| n\/a \| n\/a \| 0\.50 \| 1\.00 \| \+0\.25 \|$/m);
  assert.match(md, /^## Errors$/m);
  assert.match(md, /^- gamma: trigger evals wrote no usable result$/m);
  assert.match(md, /^## Regressions$/m);
  assert.match(renderSummary(cur, null, null, []), /no previous record, so this run is the baseline/);
  assert.doesNotMatch(renderSummary(prev, prev, compare(prev, prev, 0.1), []), /Regressions|Errors/);
});

// ---- the whole script, against fakes of the two tools ------------------------------------------------

/**
 * A repo with two skills: alpha (trigger evals and two output cases) and beta (trigger evals only), a fake
 * trigger runner and a fake `claude`. Each writes the JSON it is told to by FAKE and logs its arguments.
 */
function setup(fake: { trigger: Record<string, unknown>; output: Record<string, unknown>; retry?: Record<string, unknown> }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-evals-test-"));
  const repo = path.join(dir, "repo");
  const evals = (s: string) => path.join(repo, ".claude", "skills", s, "evals");
  fs.mkdirSync(path.join(evals("alpha"), "case1"), { recursive: true });
  fs.mkdirSync(path.join(evals("alpha"), "case2"), { recursive: true });
  fs.mkdirSync(path.join(evals("alpha"), "results"), { recursive: true });
  fs.mkdirSync(evals("beta"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".claude", "skills", "gamma"), { recursive: true });
  for (const f of ["case1", "case2"]) fs.writeFileSync(path.join(evals("alpha"), f, "prompt.md"), "x\n");
  for (const s of ["alpha", "beta"]) fs.writeFileSync(path.join(evals(s), "trigger-evals.json"), "[]\n");
  execFileSync("git", ["init", "-q", repo]);

  const log = path.join(dir, "calls.log");
  const runner = path.join(dir, "runner.js");
  fs.writeFileSync(runner, `const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, "trigger " + a.join(" ") + "\\n");
const j = JSON.parse(a.includes("--only") ? process.env.FAKE_TRIGGER_RETRY : process.env.FAKE_TRIGGER)[a[0]];
if (j) fs.writeFileSync(a[a.indexOf("--json") + 1], JSON.stringify(j));
process.exit(1);
`);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, "claude " + a.join(" ") + "\\n");
const j = JSON.parse(process.env.FAKE_OUTPUT)[path.basename(a[2])];
if (j) fs.writeFileSync(a[a.indexOf("--json") + 1], JSON.stringify(j));
process.exit(1);
`, { mode: 0o755 });

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_TRIGGER: JSON.stringify(fake.trigger), FAKE_TRIGGER_RETRY: JSON.stringify(fake.retry ?? {}), FAKE_OUTPUT: JSON.stringify(fake.output) };
  delete env.GITHUB_STEP_SUMMARY;
  const run = (...flags: string[]) => runIn(repo, ...flags);
  const runIn = (cwd: string, ...flags: string[]) => {
    const res = spawnSync(process.execPath, [script, "--trigger-runner", runner, ...(flags.includes("--out") ? [] : ["--out", path.join(dir, "out")]), ...flags], { cwd, env, encoding: "utf8" });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
    fs.rmSync(log, { force: true });
    const rec = path.join(dir, "out", "record.json");
    return { ...res, calls, record: fs.existsSync(rec) ? (JSON.parse(fs.readFileSync(rec, "utf8")) as EvalRecord) : null, out: path.join(dir, "out") };
  };
  return { dir, repo, run, runIn };
}

const healthy = () => ({
  trigger: { alpha: triggerJson(9, 10, { cost: 4 }), beta: triggerJson(5, 5, { cost: 3 }) },
  output: { alpha: outputJson({ case1: { with: [1, 1, 1], without: [0.5] }, case2: { with: [1, 1, 0.5], without: [0.5] } }, { costUsd: 1.5 }) },
});

test("a first run records every skill and exits 0 as the baseline", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = run();
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.deepEqual(Object.keys(res.record!.skills), ["alpha", "beta"], "gamma has no evals and is not recorded");
  assert.equal(res.record!.format, FORMAT);
  assert.equal(res.record!.claudeVersion, "2.1.318");
  assert.equal(res.record!.costUsd, 4 + 1.5 + 3);
  assert.equal(res.record!.skills.alpha.trigger!.counts.all.passed, 9);
  assert.equal(res.record!.skills.alpha.output!.cases.length, 2);
  assert.equal(res.record!.skills.beta.output, undefined);
  assert.match(res.stdout, /this run is the baseline/);
  assert.ok(fs.existsSync(path.join(res.out, "summary.md")));
  // The tools were called with the pinned models and a cost ceiling, and a case directory named results/ was not a case.
  const claude = res.calls.find(c => c.startsWith("claude "))!;
  assert.match(claude, /plugin eval \S+\/alpha --scaffold --trust-plugin --model claude-sonnet-5-5 --judge-model claude-haiku-5-5 -j 4 --max-cost-usd 15 --no-publish --json /);
  assert.match(res.calls.find(c => c.startsWith("trigger alpha"))!, /--model claude-sonnet-5-5 --max-cost 20$/);
  assert.equal(res.calls.filter(c => c.startsWith("claude ")).length, 1);
});

test("a second run with the same results exits 0; a fall beyond the tolerance exits 1", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = run();
  assert.equal(first.status, 0);
  const previous = path.join(dir, "previous.json");
  fs.copyFileSync(path.join(first.out, "baseline.json"), previous);

  assert.equal(run("--previous", previous).status, 0);

  const worse = setup({ ...healthy(), trigger: { alpha: triggerJson(5, 10), beta: triggerJson(5, 5) } });
  t.after(() => fs.rmSync(worse.dir, { recursive: true, force: true }));
  const res = worse.run("--previous", previous);
  assert.equal(res.status, 1, res.stderr + res.stdout);
  assert.match(res.stdout, /^## Regressions$/m);
  assert.match(res.stdout, /alpha: trigger pass rate fell from 90% to 50%/);
  assert.match(res.stderr, /1 regressions/);
  // The failing run still wrote its record, so the next run compares with this level.
  assert.equal(res.record!.skills.alpha.trigger!.counts.all.passed, 5);
});

test("an errored run is exit 2, never a regression, and the skill is left out of the comparison", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = run();
  const previous = path.join(dir, "previous.json");
  fs.copyFileSync(path.join(first.out, "baseline.json"), previous);

  const broken = setup({
    trigger: { alpha: triggerJson(0, 10, { errored: 10 }), beta: triggerJson(5, 5) },
    output: { alpha: outputJson({ case1: { with: [{ score: 0, error: "scaffold failed: fixture.sh" }, { score: 0, error: "scaffold failed: fixture.sh" }] } }) },
  });
  t.after(() => fs.rmSync(broken.dir, { recursive: true, force: true }));
  const res = broken.run("--previous", previous);
  assert.equal(res.status, 2, res.stderr + res.stdout);
  assert.doesNotMatch(res.stdout, /^## Regressions$/m);
  assert.match(res.stdout, /^## Errors$/m);
  assert.match(res.stdout, /alpha: 10 trigger queries errored/);
  assert.match(res.stdout, /alpha: case1: scaffold failed: fixture.sh/);
  assert.match(res.stdout, /alpha: case2: the case failed to load/);
  // The skill that errored is not "removed", and this run is not offered as the next baseline.
  assert.doesNotMatch(res.stdout, /not in this run/);
  assert.ok(res.record, "the record is still written, for reading");
  assert.ok(!fs.existsSync(path.join(res.out, "baseline.json")));
});

test("a tool that writes no result is an error", (t) => {
  const { dir, run } = setup({ trigger: {}, output: {} });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = run("--skills", "alpha");
  assert.equal(res.status, 2);
  assert.match(res.stdout, /alpha: trigger evals wrote no usable result/);
  assert.match(res.stdout, /alpha: output evals wrote no result/);
});

test("the cost ceiling caps each step and stops later ones", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // alpha's trigger run costs 4: the step may use 9.4, then 5.4 is left for its output evals (capped at 5.4),
  // which cost 1.5, leaving 3.9 for beta's trigger evals.
  const res = run("--max-cost-usd", "9.4");
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.match(res.calls.find(c => c.startsWith("trigger alpha"))!, /--max-cost 9\.4$/);
  assert.match(res.calls.find(c => c.startsWith("claude "))!, /--max-cost-usd 5\.4 /);
  assert.match(res.calls.find(c => c.startsWith("trigger beta"))!, /--max-cost 3\.9$/);

  const tight = setup(healthy());
  t.after(() => fs.rmSync(tight.dir, { recursive: true, force: true }));
  const spent = tight.run("--max-cost-usd", "4.2");
  assert.equal(spent.status, 2);
  assert.match(spent.stdout, /alpha: output evals not run: the cost ceiling was spent/);
  assert.match(spent.stdout, /beta: trigger evals not run: the cost ceiling was spent/);
  assert.equal(spent.calls.filter(c => c.startsWith("claude ")).length, 0);
});

test("--skills and --kind select what runs, and bad flags are refused", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const only = run("--skills", "beta", "--kind", "trigger");
  assert.equal(only.status, 0, only.stderr);
  assert.deepEqual(only.calls.map(c => c.split(" ").slice(0, 2).join(" ")), ["trigger beta"]);
  const output = run("--skills", "alpha", "--kind", "output");
  assert.deepEqual(output.calls.map(c => c.split(" ")[0]), ["claude"]);
  for (const bad of [["--skills", "nope"], ["--kind", "some"], ["--max-cost-usd", "lots"], ["--tolerance"]]) {
    const res = run(...bad);
    assert.equal(res.status, 2, bad.join(" "));
    assert.equal(res.calls.length, 0);
  }
});

test("an unreadable previous record is ignored, not fatal", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{ truncated");
  const res = run("--previous", bad);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /not a usable bh-skill-evals\/1 record: ignored/);
  const missing = run("--previous", path.join(dir, "absent.json"));
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /no previous record at/);
});

test("only a complete run with no error is written as a baseline", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const full = run();
  assert.equal(full.status, 0);
  const baseline = path.join(full.out, "baseline.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(baseline, "utf8")), full.record);
  // A debugging run of one skill, or of one kind, is a record but not a baseline, and removes the stale one.
  for (const flags of [["--skills", "beta"], ["--kind", "trigger"]]) {
    const res = run(...flags);
    assert.equal(res.status, 0, flags.join(" "));
    assert.ok(fs.existsSync(path.join(res.out, "record.json")));
    assert.ok(!fs.existsSync(baseline), flags.join(" "));
    fs.writeFileSync(baseline, "stale");
  }
});

test("a subset run compares only its skills with the previous record, without calling the others removed", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const previous = path.join(dir, "previous.json");
  fs.copyFileSync(path.join(run().out, "baseline.json"), previous);
  const res = run("--skills", "beta", "--kind", "trigger", "--previous", previous);
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.doesNotMatch(res.stdout, /not in this run/);
  assert.match(res.stdout, /No skill fell by more than the tolerance/);
});

test("errored queries are run once more, and a retry that decides them saves the skill's measurement", (t) => {
  const { dir, run } = setup({
    ...healthy(),
    trigger: { alpha: triggerJson(7, 10, { errored: 2, cost: 4 }), beta: triggerJson(5, 5) },
    retry: { alpha: { costUsd: 0.4, queries: [9, 10].map(position => ({ position, query: `query ${position}`, status: "PASS", shouldTrigger: position % 2 === 1, heldout: false })) } },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = run();
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.deepEqual(res.record!.skills.alpha.trigger!.counts.all, { passed: 9, total: 10, errored: 0 });
  const retry = res.calls.filter(c => c.startsWith("trigger alpha"));
  assert.equal(retry.length, 2);
  assert.match(retry[1], /--max-cost 5 --only 9,10$/);
  assert.equal(res.calls.filter(c => c.startsWith("trigger beta")).length, 1, "a skill with no errors is not run again");
  assert.equal(res.record!.costUsd, 4 + 0.4 + 1 + 1.5);
});

test("queries that error again after the retry still make the skill an error", (t) => {
  const { dir, run } = setup({
    ...healthy(),
    trigger: { alpha: triggerJson(7, 10, { errored: 2 }), beta: triggerJson(5, 5) },
    retry: { alpha: { queries: [9, 10].map(position => ({ position, query: `query ${position}`, status: "ERROR", shouldTrigger: true, heldout: false })) } },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = run();
  assert.equal(res.status, 2);
  assert.match(res.stdout, /alpha: 2 trigger queries errored/);
  assert.equal(res.calls.filter(c => c.startsWith("trigger alpha")).length, 2, "retried once, not in a loop");
});

test("a run cut short by the cost ceiling is not retried", (t) => {
  const { dir, run } = setup({ ...healthy(), trigger: { alpha: triggerJson(4, 5, { missing: 5, partial: true, errored: 1 }), beta: triggerJson(5, 5) } });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const res = run("--skills", "alpha", "--kind", "trigger");
  assert.equal(res.status, 2);
  assert.equal(res.calls.length, 1);
  assert.match(res.stdout, /stopped early/);
});

test("relative paths mean the same thing from a subdirectory of the repo", (t) => {
  const { dir, repo, runIn } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sub = path.join(repo, "docs");
  fs.mkdirSync(sub);
  // The tools run in the repo root; the files they write and the ones we read are still the same files.
  const res = runIn(sub, "--out", "results", "--previous", "none.json");
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.ok(fs.existsSync(path.join(sub, "results", "record.json")));
  assert.ok(fs.existsSync(path.join(sub, "results", "trigger-alpha.json")));
  assert.ok(!fs.existsSync(path.join(repo, "results")));
});

test("an unknown flag or a stray argument is refused before anything is paid for", (t) => {
  const { dir, run } = setup(healthy());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const bad of [["--skill", "anatomy"], ["--maxcost-usd", "5"], ["alpha"], ["--skills", "alpha", "--force"], ["--skills", "--kind", "trigger"]]) {
    const res = run(...bad);
    assert.equal(res.status, 2, bad.join(" "));
    assert.equal(res.calls.length, 0, bad.join(" "));
  }
  assert.match(run("--skill", "x").stderr, /unknown argument --skill /);
});

// ---- the workflow ----------------------------------------------------------------------------------------

test("the workflow is scheduled monthly, opt-in, read-only and hands its inputs over through env", () => {
  const text = fs.readFileSync(path.join(root, ".github", "workflows", "skill-evals.yml"), "utf8");
  const wf = parseYaml(text);
  assert.match(wf.on.schedule[0].cron, /^\d+ \d+ 1 \* \*$/, "monthly, on the 1st");
  assert.ok("workflow_dispatch" in wf.on);
  assert.deepEqual(wf.permissions, { contents: "read", actions: "read" });
  const job = wf.jobs.evals;
  assert.equal(job.if, "vars.SKILL_EVALS_ENABLED == 'true'");
  assert.equal(wf.concurrency["cancel-in-progress"], false);
  const steps: { name?: string; uses?: string; run?: string; env?: Record<string, string>; if?: string; with?: Record<string, unknown> }[] = job.steps;
  // No expression is interpolated into a shell script: untrusted text would run as code.
  for (const s of steps) assert.doesNotMatch(s.run ?? "", /\$\{\{/, s.name);
  const run = steps.find(s => s.name === "Run the evals")!;
  assert.match(run.run!, /node scripts\/skill-evals\.mts /);
  assert.match(run.env!.ANTHROPIC_API_KEY, /secrets\.ANTHROPIC_API_KEY/);
  // The record is uploaded even when the run failed, because the next run compares with it.
  const upload = steps.find(s => s.uses?.startsWith("actions/upload-artifact"))!;
  assert.equal(upload.if, "always()");
  assert.equal(upload.with!.name, "skill-evals-record");
  assert.match(String(upload.with!.path), /skill-evals\/baseline\.json/);
  assert.match(String(upload.with!.path), /skill-evals\/summary\.md/);
  assert.match(steps.find(s => s.name === "Fetch the previous record")!.run!, /--name skill-evals-record/);
  assert.match(run.run!, /--previous previous\/baseline\.json/);
  // Every script and flag it names exists.
  assert.ok(fs.existsSync(path.join(root, "scripts", "skill-evals.mts")));
  for (const flag of ["--out", "--previous", "--skills", "--kind", "--model", "--judge-model", "--max-cost-usd"]) assert.ok(run.run!.includes(flag), flag);
});
