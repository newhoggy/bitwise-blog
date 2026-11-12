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

interface Job { needs?: string | string[]; if?: string; steps?: Array<{ uses?: string; run?: string }> }
interface Workflow { on: Record<string, unknown>; jobs: Record<string, Job> }

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
  const condition = load("ci.yml").jobs["deploy"]?.if ?? "";
  assert.match(condition, /github\.event_name != 'pull_request'/);
  assert.match(condition, /github\.ref == 'refs\/heads\/main'/);
});

test("only the deploy job publishes, and no other workflow can", () => {
  const publishes = (job: Job) => (job.steps ?? []).some((s) => s.uses?.startsWith("actions/deploy-pages") || s.uses?.startsWith("actions/upload-pages-artifact"));
  for (const file of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      assert.equal(publishes(job), file === "ci.yml" && name === "deploy", `${file}: job \`${name}\` ${publishes(job) ? "publishes" : "does not publish"}`);
    }
  }
});
