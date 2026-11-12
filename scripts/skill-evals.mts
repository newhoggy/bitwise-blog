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
// $GITHUB_STEP_SUMMARY when that is set. The scheduled workflow is .github/workflows/skill-evals.yml.
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
/** Below this much budget left a step is not started. */
const MIN_BUDGET_USD = 0.5;
/** Cases whose with-skill score moved by at least this much are listed (not failed) in the summary. */
const CASE_CHANGE = 0.3;

export type Kind = "trigger" | "output" | "both";

export interface Counts { passed: number; total: number; errored: number }
export interface TriggerQuery { query: string; status: string; shouldTrigger: boolean; heldout: boolean }
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

function counts(x: unknown): Counts | null {
  if (!isObj(x)) return null;
  const { passed, total, errored } = x;
  return typeof passed === "number" && typeof total === "number" && typeof errored === "number" ? { passed, total, errored } : null;
}

/** Reads what `run-trigger-evals.mjs --json` wrote. Null when it is not that. */
export function triggerFromJson(j: unknown): TriggerRecord | null {
  if (!isObj(j) || !isObj(j.totals) || !Array.isArray(j.queries)) return null;
  const all = counts(j.totals.all), shouldFire = counts(j.totals.shouldFire), shouldStayQuiet = counts(j.totals.shouldStayQuiet);
  if (!all || !shouldFire || !shouldStayQuiet) return null;
  const queries: TriggerQuery[] = [];
  for (const q of j.queries) {
    if (!isObj(q) || typeof q.query !== "string" || typeof q.status !== "string") return null;
    queries.push({ query: q.query, status: q.status, shouldTrigger: q.shouldTrigger === true, heldout: q.heldout === true });
  }
  return { counts: { all, shouldFire, shouldStayQuiet, heldout: counts(j.totals.heldout) }, queries, costUsd: num(j.costUsd) };
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

/** A record from a file, or null when it is not one (a corrupt artifact must not block every later run). */
export function parseRecord(text: string): EvalRecord | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  return isObj(j) && j.format === FORMAT && isObj(j.skills) && isObj(j.models) ? (j as unknown as EvalRecord) : null;
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

function parseArgs(argv: string[]): Options {
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

  fs.mkdirSync(opt.out, { recursive: true });
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
        const file = path.join(opt.out, `trigger-${skill}.json`);
        fs.rmSync(file, { force: true });
        // Exit 1 means some query was not a pass, which is a result. Only a missing file means it did not run.
        spawnSync(process.execPath, [triggerRunner, skill, "--json", file, "--model", opt.model, "--max-cost", String(cap)], { cwd: repo, stdio });
        const j = readJson(file);
        const t = triggerFromJson(j);
        if (!t) { spent += cap; fail("trigger evals wrote no usable result"); }
        else {
          rec.trigger = t;
          spent += t.costUsd ?? cap;
          for (const e of triggerErrors(j, t)) fail(e);
          if (isObj(j) && typeof j.claudeVersion === "string") record.claudeVersion ??= j.claudeVersion;
        }
      }
    }

    if (opt.kind !== "trigger" && caseDirs.length) {
      const cap = budget(OUTPUT_STEP_CAP_USD);
      if (cap === null) fail("output evals not run: the cost ceiling was spent");
      else {
        console.log(`\n== ${skill}: output evals, ${caseDirs.length} cases (up to $${cap.toFixed(2)})`);
        const file = path.join(opt.out, `output-${skill}.json`);
        fs.rmSync(file, { force: true });
        spawnSync("claude", ["plugin", "eval", dir, "--scaffold", "--trust-plugin", "--model", opt.model, "--judge-model", opt.judgeModel,
          "-j", "4", "--max-cost-usd", String(cap), "--no-publish", "--json", path.resolve(file)], { cwd: repo, stdio });
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
    if (!fs.existsSync(opt.previous)) console.log(`no previous record at ${opt.previous}: this run is the baseline`);
    else {
      prev = parseRecord(fs.readFileSync(opt.previous, "utf8"));
      if (!prev) console.log(`${opt.previous} is not a ${FORMAT} record: ignored, this run is the baseline`);
    }
  }
  // An errored skill has no measurement to compare, so it is left out of the comparison.
  const comparable: EvalRecord = { ...record, skills: Object.fromEntries(Object.entries(record.skills).filter(([, s]) => !s.errors.length)) };
  const cmp = prev ? compare(prev, comparable, opt.tolerance) : null;

  const summary = renderSummary(record, prev, cmp, errors);
  fs.writeFileSync(path.join(opt.out, "record.json"), JSON.stringify(record, null, 2) + "\n");
  fs.writeFileSync(path.join(opt.out, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  console.log("\n" + summary);

  if (errors.length) { console.error(`${errors.length} errors: nothing can be concluded from the skills that errored`); return 2; }
  if (cmp?.regressions.length) { console.error(`${cmp.regressions.length} regressions`); return 1; }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
