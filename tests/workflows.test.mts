// Publishing must wait for the checks. The deploy is a job in ci.yml that `needs` the jobs
// which check and render the site, so a commit that fails one of them is never published.
// A second workflow that deploys on a push to main would bypass that, so it fails here.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

interface Step { name?: string; id?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown> }
interface Job { needs?: string | string[]; if?: string; uses?: string; "timeout-minutes"?: number; permissions?: Record<string, string>; steps?: Step[] }
interface Workflow { on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> }

const load = (file: string): Workflow => parse(fs.readFileSync(path.join(WORKFLOWS, file), "utf8")) as Workflow;
const needs = (job: Job): string[] => [job.needs ?? []].flat();

test("the deploy job needs the check and render jobs of the same workflow", () => {
  const ci = load("ci.yml");
  const deploy = ci.jobs["deploy"];
  assert.ok(deploy, "ci.yml has a `deploy` job");
  for (const gate of ["check", "render"]) {
    assert.ok(ci.jobs[gate], `ci.yml has a \`${gate}\` job`);
    assert.ok(needs(deploy).includes(gate), `deploy needs \`${gate}\` (needs: ${needs(deploy).join(", ") || "nothing"})`);
  }
});

test("the deploy job never runs for a pull request, and only for main", () => {
  const condition = (load("ci.yml").jobs["deploy"]?.if ?? "").replace(/\s+/g, " ").trim();
  assert.equal(condition, "vars.PAGES_ENABLED == 'true' && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'");
});

test("only the deploy job can publish: no other workflow or job has `pages: write`", () => {
  // Publishing to Pages needs the `pages: write` permission, however the job does it.
  for (const file of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const workflow = load(file);
    assert.notEqual(workflow.permissions?.["pages"], "write", `${file} grants \`pages: write\` to every job`);
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.equal(job.permissions?.["pages"] === "write", file === "ci.yml" && name === "deploy", `${file}: job \`${name}\``);
    }
  }
});

test("the deploy job publishes only while its commit is still the head of main", () => {
  const steps = load("ci.yml").jobs["deploy"]?.steps ?? [];
  const publishing = steps.filter((s) => s.uses?.startsWith("actions/deploy-pages") || s.uses?.startsWith("actions/upload-pages-artifact"));
  assert.ok(publishing.length === 2, "the deploy job uploads and deploys the Pages artifact");
  for (const step of publishing) assert.match(JSON.stringify(step), /steps\.fresh\.outputs\.current == 'true'/);
});

// The render job compares a pull request with main's renders (issue #165). It reads another run's artifact,
// so it needs `actions: read`, and nothing that writes: a fork's pull request runs it too.
test("the render job can read other runs' artifacts and write nothing", () => {
  assert.deepEqual(load("ci.yml").jobs["render"]?.permissions, { contents: "read", actions: "read" });
});

test("only a build of main saves the visual baseline, and only a pull request fetches one", () => {
  const steps = load("ci.yml").jobs["render"]?.steps ?? [];
  const save = steps.filter((s) => s.uses?.startsWith("actions/upload-artifact") && s.with?.["name"] === "visual-baseline");
  assert.equal(save.length, 1, "the render job uploads `visual-baseline` once");
  assert.equal(save[0]?.if, "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'");
  assert.equal(save[0]?.with?.["path"], ".visual/system-fonts/current/");
  const fetch = steps.filter((s) => s.run?.includes("scripts/visual-baseline.mts"));
  assert.equal(fetch.length, 1, "the render job fetches the baseline once");
  assert.equal(fetch[0]?.if, "github.event_name == 'pull_request'");
  // The fetch must come before the render that compares with it.
  const render = steps.findIndex((s) => s.run?.includes("npm run visual"));
  assert.ok(steps.indexOf(fetch[0]!) < render, "the baseline is fetched before the pages are rendered");
  assert.match(steps[render]?.run ?? "", /--report-only/);
});

// A job with no `timeout-minutes` runs until GitHub's 360-minute default when a step hangs, keeps the
// PR's checks pending, and its log is unreadable until the run ends (issue #139).
// A job that calls a reusable workflow (`uses:`) cannot carry `timeout-minutes`; the callee's jobs do.
// The ceiling keeps "a few times the normal run" honest: 360 would pass a presence check and still be the default.
const MAX_TIMEOUT_MINUTES = 120; // skill-evals.yml is the longest job, at 120
const jobsWithoutTimeout = (workflow: Workflow): string[] =>
  Object.entries(workflow.jobs)
    .filter(([, job]) => job.uses === undefined)
    .filter(([, job]) => { const m = job["timeout-minutes"]; return !(typeof m === "number" && Number.isInteger(m) && m > 0 && m <= MAX_TIMEOUT_MINUTES); })
    .map(([name]) => name);

test("every job in every workflow sets a timeout-minutes", () => {
  for (const file of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    assert.deepEqual(jobsWithoutTimeout(load(file)), [], `${file}: jobs with no \`timeout-minutes\``);
  }
});

test("the timeout check names a job that lacks one (so it can fail)", () => {
  const ci = load("ci.yml");
  delete ci.jobs["render"]?.["timeout-minutes"];
  assert.deepEqual(jobsWithoutTimeout(ci), ["render"]);
});

test("the timeout check rejects a missing, zero, oversized or non-numeric value, and skips a reusable-workflow job", () => {
  const job = (extra: Partial<Job>): Workflow => ({ on: {}, jobs: { j: { ...extra } } });
  assert.deepEqual(jobsWithoutTimeout(job({ "timeout-minutes": 10 })), []);
  for (const bad of [0, 360, 99999, "${{ vars.T }}" as unknown as number]) assert.deepEqual(jobsWithoutTimeout(job({ "timeout-minutes": bad })), ["j"], String(bad));
  assert.deepEqual(jobsWithoutTimeout(job({ uses: "./.github/workflows/x.yml" })), []);
});

test("the test script bounds each test, so a hung test fails by name", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test"] ?? "", /--test-timeout=\d+/);
});
