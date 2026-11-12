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

interface Job { needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps?: Array<{ uses?: string; run?: string }> }
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
