// Runs the skill evals (trigger and output-quality) for every skill in .claude/skills, records the
// pass rates and compares them with the previous record, so a model or Claude Code update that
// changes how a skill behaves shows up without anyone running the evals by hand (#122, proposal 20).
//
//   node scripts/skill-evals.mts [--skills a,b] [--kind trigger|output|both] [--out DIR]
//        [--previous record.json] [--model ID] [--judge-model ID] [--max-cost-usd N] [--tolerance 0.1]
//
// It runs the two existing tools and reads their JSON; it measures nothing itself:
//   trigger evals  .claude/skills/skill-authoring/scripts/run-trigger-evals.mjs <skill> --json
//   output evals   claude plugin eval .claude/skills/<skill> --json   (with and without the skill)
// and writes <out>/record.json (format bh-skill-evals/1) and <out>/summary.md, which it also appends to
// $GITHUB_STEP_SUMMARY when that is set. When the run covered every skill and both kinds without an error it
// also writes <out>/baseline.json (the same record): the file the next run should compare with. A subset run
// or one that errored is a fine record but a bad baseline, so it never writes one.
// The scheduled workflow is .github/workflows/skill-evals.yml.
//
// Exit codes: 0 clean, 1 a regression against the previous record, 2 an error (a case that failed to
// load, a run that errored, a result that is partial or missing). An error wins over a regression: a
// setup problem is not a score, and nothing can be concluded from a run that did not measure.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const FORMAT = "bh-skill-evals/1";
/** Agent and judge models, pinned as `evals.md` says so that a model rollout is not mistaken for a regression. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_JUDGE_MODEL = "claude-haiku-5-5";
/**
 * A skill regresses when its trigger pass rate, or its mean output score with the skill, falls by more than
 * this. The suites are small (three runs per case; a single case has moved by 0.4 with no change to the skill),
 * so single flips are listed but never fail a run. A starting value: tune it from a few months of records.
 */
export const DEFAULT_TOLERANCE = 0.1;
/** Hard ceiling on the cost of one whole run, in US dollars. */
export const DEFAULT_MAX_COST_USD = 75;
/**
 * Ceilings for one step. Measured on 2026-11-12: a trigger suite costs about $0.27 a query ($7 for anatomy's 26,
 * so about $10 for the largest suite, pedagogical-writing's 38), and an output suite a few dollars (`measurements.md`).
 * A suite that hits its ceiling is cut short, so these leave room above the measured cost.
 */
const TRIGGER_STEP_CAP_USD = 20;
const OUTPUT_STEP_CAP_USD = 15;
/** The one retry of the queries that errored (an API error or a timeout): a handful of queries, not a suite. */
const TRIGGER_RETRY_CAP_USD = 5;
/** Below this much budget left a step is not started. */
const MIN_BUDGET_USD = 0.5;
/** Cases whose with-skill score moved by at least this much are listed (not failed) in the summary. */
const CASE_CHANGE = 0.3;

export type Kind = "trigger" | "output" | "both";

export interface Counts { passed: number; total: number; errored: number }
export interface TriggerQuery { position: number; query: string; status: string; shouldTrigger: boolean; heldout: boolean }
export interface TriggerRecord {
  counts: { all: Counts; shouldFire: Counts; shouldStayQuiet: Counts; heldout: Counts | null };
  queries: TriggerQuery[];
  costUsd: number | null;
}
export interface OutputCase { name: string; withSkill: number | null; withoutSkill: number | null; delta: number | null }
export interface OutputRecord {
  cases: OutputCase[];
  meanWith: number | null;
  meanWithout: number | null;
  meanDelta: number | null;
  costUsd: number | null;
}
export interface SkillRecord { trigger?: TriggerRecord; output?: OutputRecord; errors: string[] }
export interface EvalRecord {
  format: typeof FORMAT;
  date: string;
  commit: string | null;
  claudeVersion: string | null;
  models: { agent: string; judge: string };
  costUsd: number;
  skills: Record<string, SkillRecord>;
}
export interface Comparison {
  /** Skills that fell by more than the tolerance. These fail the run. */
  regressions: string[];
  /** Everything else worth reading: version changes, flipped queries, moved cases, new and removed skills. */
  changes: string[];
}

// ---------------------------------------------------------------------------------------------------
// Reading the two tools' JSON. Both come from outside this file, so they are `unknown` until narrowed.

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** The turn cap ends most trigger runs with an error after the skill was or was not called: not a failure. */
const TURN_CAP = /maximum number of turns/i;

/** The counts of a record, derived from its queries so that a retry can replace some of them. */
export function triggerRecord(queries: TriggerQuery[], costUsd: number | null): TriggerRecord {
  const count = (list: TriggerQuery[]): Counts => ({
    passed: list.filter(q => q.status === "PASS").length, total: list.length, errored: list.filter(q => q.status === "ERROR").length,
  });
  const heldout = queries.filter(q => q.heldout);
  return {
    counts: { all: count(queries), shouldFire: count(queries.filter(q => q.shouldTrigger)), shouldStayQuiet: count(queries.filter(q => !q.shouldTrigger)), heldout: heldout.length ? count(heldout) : null },
    queries, costUsd,
  };
}

/** Reads what `run-trigger-evals.mjs --json` wrote. Null when it is not that. */
export function triggerFromJson(j: unknown): TriggerRecord | null {
  if (!isObj(j) || !Array.isArray(j.queries)) return null;
  const queries: TriggerQuery[] = [];
  for (const q of j.queries) {
    if (!isObj(q) || typeof q.query !== "string" || typeof q.status !== "string" || typeof q.position !== "number") return null;
    queries.push({ position: q.position, query: q.query, status: q.status, shouldTrigger: q.shouldTrigger === true, heldout: q.heldout === true });
  }
  return triggerRecord(queries, num(j.costUsd));
}

/** `first` with each ERROR query replaced by the same query from `retry`, when the retry did not error too. */
export function mergeRetry(first: TriggerRecord, retry: TriggerRecord): TriggerRecord {
  const again = new Map(retry.queries.map(q => [q.position, q]));
  const queries = first.queries.map(q => {
    const r = again.get(q.position);
    return q.status === "ERROR" && r && r.query === q.query && r.status !== "ERROR" ? r : q;
  });
  const cost = first.costUsd === null && retry.costUsd === null ? null : (first.costUsd ?? 0) + (retry.costUsd ?? 0);
  return triggerRecord(queries, cost);
}

/** Reads the errors of a trigger result: queries that errored, and cases that failed to load. */
export function triggerErrors(j: unknown, r: TriggerRecord): string[] {
  const out: string[] = [];
  if (r.counts.all.errored) out.push(`${r.counts.all.errored} trigger queries errored (an API error or a timeout), so the pass rate is not a measurement`);
  const missing = isObj(j) ? num(j.missing) : null;
  if (missing) {
    out.push(isObj(j) && j.partial === true
      ? `the trigger evals stopped early (the cost ceiling was hit or the run was aborted): ${missing} queries were not run`
      : `${missing} trigger cases failed to load and are not in the result`);
  }
  return out;
}

/**
 * Reads the JSON `claude plugin eval --json` wrote for a skill's output cases. `caseDirs` are the case
 * directories on disk: a case that failed to load is absent from the result and would otherwise lower nothing.
 */
export function outputFromResult(result: unknown, caseDirs: string[]): { record: OutputRecord; errors: string[] } {
  const errors = new Set<string>();
  const cases: OutputCase[] = [];
  let costUsd: number | null = null;
  if (!isObj(result) || !Array.isArray(result.cases)) {
    errors.add("the output eval wrote no cases");
  } else {
    costUsd = num(result.costUsd);
    if (result.partial === true) errors.add("the output eval stopped early (cost ceiling or abort), so its results are partial");
    const seen = new Set<string>();
    for (const c of result.cases) {
      if (!isObj(c)) continue;
      const name = path.basename(str(c.dir) ?? str(c.name) ?? "?");
      seen.add(name);
      const arms = isObj(c.arms) ? c.arms : {};
      // A run that errored, other than at the turn cap, measured nothing. A `scaffold failed` row is one.
      const armScore = (arm: unknown): number | null => {
        const kept: number[] = [];
        for (const run of Array.isArray(arm) ? arm : []) {
          if (!isObj(run)) continue;
          if (run.error && !TURN_CAP.test(String(run.error))) {
            errors.add(`${name}: ${String(run.error).replace(/\s+/g, " ").slice(0, 200)}`);
            continue;
          }
          const s = num(run.score);
          if (s !== null) kept.push(s);
        }
        return mean(kept);
      };
      const withSkill = armScore(arms.with), withoutSkill = armScore(arms.without);
      cases.push({ name, withSkill, withoutSkill, delta: withSkill !== null && withoutSkill !== null ? withSkill - withoutSkill : null });
    }
    for (const d of caseDirs) if (!seen.has(d)) errors.add(`${d}: the case failed to load (it is not in the result)`);
  }
  const col = (f: (c: OutputCase) => number | null) => mean(cases.map(f).filter((x): x is number => x !== null));
  const record: OutputRecord = { cases, meanWith: col(c => c.withSkill), meanWithout: col(c => c.withoutSkill), meanDelta: col(c => c.delta), costUsd };
  return { record, errors: [...errors] };
}

// ---------------------------------------------------------------------------------------------------
// Comparing two records.

const rate = (c: Counts): number | null => (c.total ? c.passed / c.total : null);

const isCounts = (x: unknown): boolean => isObj(x) && typeof x.passed === "number" && typeof x.total === "number" && typeof x.errored === "number";
const isNumOrNull = (x: unknown): boolean => x === null || typeof x === "number";

/** Whether a stored skill has the shape `compare` reads, so an artifact edited by hand or by an older version can't make it throw. */
function isSkillRecord(x: unknown): boolean {
  if (!isObj(x) || !Array.isArray(x.errors)) return false;
  if (x.trigger !== undefined) {
    const t = x.trigger;
    if (!isObj(t) || !isObj(t.counts) || !isCounts(t.counts.all) || !Array.isArray(t.queries)) return false;
    if (!t.queries.every(q => isObj(q) && typeof q.query === "string" && typeof q.status === "string")) return false;
  }
  if (x.output !== undefined) {
    const o = x.output;
    if (!isObj(o) || !isNumOrNull(o.meanWith) || !Array.isArray(o.cases)) return false;
    if (!o.cases.every(c => isObj(c) && typeof c.name === "string" && isNumOrNull(c.withSkill))) return false;
  }
  return true;
}

/** A record from a file, or null when it is not one (a corrupt artifact must not block every later run). */
export function parseRecord(text: string): EvalRecord | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (!isObj(j) || j.format !== FORMAT || !isObj(j.skills) || !isObj(j.models)) return null;
  if (typeof j.models.agent !== "string" || typeof j.models.judge !== "string") return null;
  return Object.values(j.skills).every(isSkillRecord) ? (j as unknown as EvalRecord) : null;
}

export function compare(prev: EvalRecord, cur: EvalRecord, tolerance: number): Comparison {
  const regressions: string[] = [], changes: string[] = [];
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  // More than the tolerance, with a margin for floating point (two of twenty queries is exactly 0.1).
  const fell = (a: number | null, b: number | null) => a !== null && b !== null && a - b > tolerance + 1e-9;

  if (prev.claudeVersion !== cur.claudeVersion) changes.push(`Claude Code ${prev.claudeVersion ?? "unknown"} → ${cur.claudeVersion ?? "unknown"}`);
  if (prev.models.agent !== cur.models.agent) changes.push(`agent model ${prev.models.agent} → ${cur.models.agent}`);
  if (prev.models.judge !== cur.models.judge) changes.push(`judge model ${prev.models.judge} → ${cur.models.judge}`);

  for (const name of Object.keys(cur.skills).sort()) {
    const now = cur.skills[name], before = prev.skills[name];
    if (!before) { changes.push(`${name}: new since the previous record`); continue; }

    if (now.trigger && before.trigger) {
      const a = rate(before.trigger.counts.all), b = rate(now.trigger.counts.all);
      if (fell(a, b)) regressions.push(`${name}: trigger pass rate fell from ${pc(a!)} to ${pc(b!)} (${before.trigger.counts.all.passed}/${before.trigger.counts.all.total} to ${now.trigger.counts.all.passed}/${now.trigger.counts.all.total} queries)`);
      const was = new Map(before.trigger.queries.map(q => [q.query, q.status]));
      for (const q of now.trigger.queries) {
        const w = was.get(q.query);
        if (w && w !== q.status) changes.push(`${name}: trigger query "${q.query.slice(0, 70)}" ${w} → ${q.status} (expected to ${q.shouldTrigger ? "fire" : "stay quiet"})`);
      }
    }
    if (now.output && before.output) {
      if (fell(before.output.meanWith, now.output.meanWith)) regressions.push(`${name}: mean output score with the skill fell from ${before.output.meanWith!.toFixed(2)} to ${now.output.meanWith!.toFixed(2)}`);
      const was = new Map(before.output.cases.map(c => [c.name, c.withSkill]));
      for (const c of now.output.cases) {
        const w = was.get(c.name);
        if (w != null && c.withSkill !== null && Math.abs(w - c.withSkill) >= CASE_CHANGE - 1e-9) changes.push(`${name}: output case ${c.name} ${w.toFixed(2)} → ${c.withSkill.toFixed(2)}`);
      }
    }
  }
  for (const name of Object.keys(prev.skills).sort()) if (!cur.skills[name]) changes.push(`${name}: in the previous record, not in this run`);
  return { regressions, changes };
}

// ---------------------------------------------------------------------------------------------------
// The summary.

const frac = (c: Counts | undefined): string => (c && c.total ? `${c.passed}/${c.total} (${Math.round((c.passed / c.total) * 100)}%)` : "n/a");
const score = (x: number | null | undefined): string => (x == null ? "n/a" : x.toFixed(2));
const signed = (x: number | null | undefined): string => (x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`);

export function renderSummary(cur: EvalRecord, prev: EvalRecord | null, cmp: Comparison | null, errors: string[]): string {
  const out: string[] = [];
  out.push(`# Skill evals, ${cur.date.slice(0, 10)}`, "");
  out.push(`Claude Code ${cur.claudeVersion ?? "unknown"}, agent \`${cur.models.agent}\`, judge \`${cur.models.judge}\`, ` +
    `cost $${cur.costUsd.toFixed(2)}${cur.commit ? `, commit \`${cur.commit.slice(0, 7)}\`` : ""}.`, "");
  out.push("| Skill | Trigger pass rate | Previous | Output score with skill | Previous | Δ vs no skill |", "| --- | --- | --- | --- | --- | --- |");
  for (const name of Object.keys(cur.skills).sort()) {
    const s = cur.skills[name], p = prev?.skills[name];
    out.push(`| ${name} | ${frac(s.trigger?.counts.all)} | ${p ? frac(p.trigger?.counts.all) : "n/a"} | ${score(s.output?.meanWith)} | ${p ? score(p.output?.meanWith) : "n/a"} | ${signed(s.output?.meanDelta)} |`);
  }
  out.push("");
  if (errors.length) out.push("## Errors", "", "These runs measured nothing, so no pass rate below is a result for them. Fix the setup and re-run.", "", ...errors.map(e => `- ${e}`), "");
  if (cmp?.regressions.length) out.push("## Regressions", "", ...cmp.regressions.map(r => `- ${r}`), "");
  if (cmp?.changes.length) out.push("## Changes since the previous run", "", ...cmp.changes.map(c => `- ${c}`), "");
  if (!prev) out.push("There is no previous record, so this run is the baseline: it can't regress.", "");
  else if (cmp && !cmp.regressions.length && !errors.length) out.push(`No skill fell by more than the tolerance (previous record: ${prev.date.slice(0, 10)}).`, "");
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------
// Running.

interface Options {
  skills: string[] | null;
  kind: Kind;
  out: string;
  previous: string | null;
  model: string;
  judgeModel: string;
  maxCostUsd: number;
  tolerance: number;
  triggerRunner: string | null;
}

const KNOWN_FLAGS = ["--skills", "--kind", "--out", "--previous", "--model", "--judge-model", "--max-cost-usd", "--tolerance", "--trigger-runner"];

function parseArgs(argv: string[]): Options {
  // Every flag takes a value. A paid command refuses what it does not know: `--skill x` must not mean "every skill".
  for (let i = 0; i < argv.length; i++) {
    if (!KNOWN_FLAGS.includes(argv[i])) throw new Error(`unknown argument ${argv[i]} (flags: ${KNOWN_FLAGS.join(", ")})`);
    i++;
  }
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} takes a value`);
    return v;
  };
  const number = (name: string, dflt: number, min: number): number => {
    const v = flag(name);
    if (v === null) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) throw new Error(`${name} takes a number of at least ${min}`);
    return n;
  };
  const kind = flag("--kind") ?? "both";
  if (kind !== "trigger" && kind !== "output" && kind !== "both") throw new Error("--kind is trigger, output or both");
  return {
    skills: flag("--skills")?.split(",").map(s => s.trim()).filter(Boolean) ?? null,
    kind,
    out: flag("--out") ?? "skill-evals",
    previous: flag("--previous"),
    model: flag("--model") ?? DEFAULT_MODEL,
    judgeModel: flag("--judge-model") ?? DEFAULT_JUDGE_MODEL,
    maxCostUsd: number("--max-cost-usd", DEFAULT_MAX_COST_USD, 0),
    tolerance: number("--tolerance", DEFAULT_TOLERANCE, 0),
    triggerRunner: flag("--trigger-runner"),
  };
}

/** Case directories of a skill: the subdirectories of evals/ that hold a prompt.md or a case.yaml. */
function outputCaseDirs(skillDir: string): string[] {
  const evals = path.join(skillDir, "evals");
  if (!fs.existsSync(evals)) return [];
  return fs.readdirSync(evals, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "results" && ["prompt.md", "case.yaml"].some(f => fs.existsSync(path.join(evals, d.name, f))))
    .map(d => d.name).sort();
}

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function git(repo: string, ...args: string[]): string | null {
  try { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

export function main(argv: string[]): number {
  let opt: Options;
  try { opt = parseArgs(argv); } catch (err) { console.error((err as Error).message); return 2; }

  const repo = git(process.cwd(), "rev-parse", "--show-toplevel");
  if (!repo) { console.error("run this from inside the repo"); return 2; }
  const skillsDir = path.join(repo, ".claude", "skills");
  const triggerRunner = opt.triggerRunner ?? path.join(skillsDir, "skill-authoring", "scripts", "run-trigger-evals.mjs");
  const found = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  for (const s of opt.skills ?? []) if (!found.includes(s)) { console.error(`no skill ${s} in .claude/skills`); return 2; }

  // The tools run with the repo as their working directory, so no path handed to them may depend on ours.
  const outDir = path.resolve(opt.out);
  fs.mkdirSync(outDir, { recursive: true });
  const record: EvalRecord = {
    format: FORMAT, date: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? git(repo, "rev-parse", "HEAD"),
    claudeVersion: null, models: { agent: opt.model, judge: opt.judgeModel }, costUsd: 0, skills: {},
  };
  const errors: string[] = [];
  let spent = 0;
  /**
   * The most a step may cost: its own cap, or what is left of the run's ceiling, in whole cents rounded down
   * (so the sum never passes the ceiling, and 3.9000000000000004 is not handed to a CLI). Null when too little is left.
   */
  const budget = (cap: number): number | null => {
    const left = Math.floor((opt.maxCostUsd - spent) * 100 + 1e-6) / 100;
    return left < MIN_BUDGET_USD ? null : Math.min(cap, left);
  };
  const stdio: ["ignore", "inherit", "inherit"] = ["ignore", "inherit", "inherit"];

  for (const skill of found) {
    if (opt.skills && !opt.skills.includes(skill)) continue;
    const dir = path.join(skillsDir, skill);
    const hasTrigger = fs.existsSync(path.join(dir, "evals", "trigger-evals.json"));
    const caseDirs = outputCaseDirs(dir);
    const rec: SkillRecord = { errors: [] };
    const fail = (msg: string) => { rec.errors.push(msg); errors.push(`${skill}: ${msg}`); };

    if (opt.kind !== "output" && hasTrigger) {
      const cap = budget(TRIGGER_STEP_CAP_USD);
      if (cap === null) fail("trigger evals not run: the cost ceiling was spent");
      else {
        console.log(`\n== ${skill}: trigger evals (up to $${cap.toFixed(2)})`);
        const file = path.join(outDir, `trigger-${skill}.json`);
        fs.rmSync(file, { force: true });
        // Exit 1 means some query was not a pass, which is a result. Only a missing file means it did not run.
        spawnSync(process.execPath, [triggerRunner, skill, "--json", file, "--model", opt.model, "--max-cost", String(cap)], { cwd: repo, stdio });
        const j = readJson(file);
        let t = triggerFromJson(j);
        if (!t) { spent += cap; fail("trigger evals wrote no usable result"); }
        else {
          spent += t.costUsd ?? cap;
          if (isObj(j) && typeof j.claudeVersion === "string") record.claudeVersion ??= j.claudeVersion;
          // A query is ERROR when API errors or timeouts left its runs undecided. Run just those once more, so one
          // flaky minute among 122 queries does not cost a whole skill its measurement. A run cut short is not retried.
          const retryCap = t.counts.all.errored && !(isObj(j) && j.partial === true) ? budget(TRIGGER_RETRY_CAP_USD) : null;
          if (retryCap !== null) {
            const only = t.queries.filter(q => q.status === "ERROR").map(q => q.position).join(",");
            console.log(`\n== ${skill}: running the errored trigger queries again (#${only}, up to $${retryCap.toFixed(2)})`);
            const again = path.join(outDir, `trigger-${skill}-retry.json`);
            fs.rmSync(again, { force: true });
            spawnSync(process.execPath, [triggerRunner, skill, "--json", again, "--model", opt.model, "--max-cost", String(retryCap), "--only", only], { cwd: repo, stdio });
            const t2 = triggerFromJson(readJson(again));
            spent += t2 ? (t2.costUsd ?? retryCap) : retryCap;
            if (t2) t = mergeRetry(t, t2);
          }
          rec.trigger = t;
          for (const e of triggerErrors(j, t)) fail(e);
        }
      }
    }

    if (opt.kind !== "trigger" && caseDirs.length) {
      const cap = budget(OUTPUT_STEP_CAP_USD);
      if (cap === null) fail("output evals not run: the cost ceiling was spent");
      else {
        console.log(`\n== ${skill}: output evals, ${caseDirs.length} cases (up to $${cap.toFixed(2)})`);
        const file = path.join(outDir, `output-${skill}.json`);
        fs.rmSync(file, { force: true });
        spawnSync("claude", ["plugin", "eval", dir, "--scaffold", "--trust-plugin", "--model", opt.model, "--judge-model", opt.judgeModel,
          "-j", "4", "--max-cost-usd", String(cap), "--no-publish", "--json", file], { cwd: repo, stdio });
        const result = readJson(file);
        if (result === null) { spent += cap; fail("output evals wrote no result"); }
        else {
          const { record: o, errors: errs } = outputFromResult(result, caseDirs);
          rec.output = o;
          spent += o.costUsd ?? cap;
          for (const e of errs) fail(e);
          if (isObj(result) && typeof result.claudeVersion === "string") record.claudeVersion ??= result.claudeVersion;
        }
      }
    }
    if (rec.trigger || rec.output || rec.errors.length) record.skills[skill] = rec;
  }
  record.costUsd = spent;

  let prev: EvalRecord | null = null;
  if (opt.previous) {
    const file = path.resolve(opt.previous);
    if (!fs.existsSync(file)) console.log(`no previous record at ${opt.previous}: this run is the baseline`);
    else {
      prev = parseRecord(fs.readFileSync(file, "utf8"));
      if (!prev) console.log(`${opt.previous} is not a usable ${FORMAT} record: ignored, this run is the baseline`);
    }
  }
  // Compare what was measured this run with the same skills before. A skill that errored has nothing to compare, and
  // one that was not asked for (--skills) is not "removed", so both are taken out of both sides.
  const measured = (name: string) => !record.skills[name]?.errors.length && (!opt.skills || opt.skills.includes(name));
  const scoped = (r: EvalRecord): EvalRecord => ({ ...r, skills: Object.fromEntries(Object.entries(r.skills).filter(([name]) => measured(name))) });
  const cmp = prev ? compare(scoped(prev), scoped(record), opt.tolerance) : null;

  const summary = renderSummary(record, prev, cmp, errors);
  const json = JSON.stringify(record, null, 2) + "\n";
  fs.writeFileSync(path.join(outDir, "record.json"), json);
  // Only a run of every skill and both kinds, with no error, can be the next run's baseline. A debugging run of one
  // skill would otherwise hide every other skill's regression for a month, and an errored one would lower the bar.
  const baseline = path.join(outDir, "baseline.json");
  fs.rmSync(baseline, { force: true });
  if (!errors.length && !opt.skills && opt.kind === "both") fs.writeFileSync(baseline, json);
  fs.writeFileSync(path.join(outDir, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  console.log("\n" + summary);

  if (errors.length) { console.error(`${errors.length} errors: nothing can be concluded from the skills that errored, and this run is not a baseline`); return 2; }
  if (cmp?.regressions.length) { console.error(`${cmp.regressions.length} regressions`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let code: number;
  // An uncaught error must not look like a regression (exit 1): nothing was concluded.
  try { code = main(process.argv.slice(2)); } catch (err) { console.error(err instanceof Error ? (err.stack ?? err.message) : String(err)); code = 2; }
  process.exit(code);
}
