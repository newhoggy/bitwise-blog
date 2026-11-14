// Which build of main a pull request's renders are compared with (scripts/visual-baseline.mts). No network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ARTIFACT, isArtifact, pickBaseline, type Artifact } from "../scripts/visual-baseline.mts";

const REPO = 1405081183, FORK = 999;
let next = 1;
const artifact = (sha: string, created: string, extra: { name?: string; expired?: boolean; branch?: string; headRepo?: number } = {}): Artifact => ({
  name: extra.name ?? ARTIFACT,
  expired: extra.expired ?? false,
  created_at: created,
  workflow_run: { id: next++, repository_id: REPO, head_repository_id: extra.headRepo ?? REPO, head_branch: extra.branch ?? "main", head_sha: sha },
});

test("no artifacts, or none usable, means no baseline", () => {
  assert.equal(pickBaseline([], "abc"), null);
  assert.equal(pickBaseline([
    artifact("a", "2026-11-14T00:00:00Z", { expired: true }),
    artifact("b", "2026-11-14T00:00:00Z", { branch: "feature" }),
    artifact("c", "2026-11-14T00:00:00Z", { name: "renders" }),
    // A fork's pull request from its own `main` runs here too and could upload an artifact of that name.
    artifact("d", "2026-11-14T00:00:00Z", { headRepo: FORK }),
  ], null), null);
});

test("the build of the base commit wins, even when a newer build exists", () => {
  const base = artifact("base", "2026-11-10T00:00:00Z"), newer = artifact("newer", "2026-11-14T00:00:00Z");
  assert.deepEqual(pickBaseline([newer, base], "base"), { runId: base.workflow_run.id, sha: "base", exact: true });
});

test("without a build of the base commit, the newest usable one is taken, whatever the listing order", () => {
  const old = artifact("old", "2026-11-01T00:00:00Z"), newest = artifact("newest", "2026-11-14T12:27:29Z"), mid = artifact("mid", "2026-11-14T12:17:42Z");
  const fork = artifact("fork", "2026-11-15T00:00:00Z", { headRepo: FORK });
  assert.deepEqual(pickBaseline([mid, old, fork, newest], "elsewhere"), { runId: newest.workflow_run.id, sha: "newest", exact: false });
  assert.deepEqual(pickBaseline([mid, old], null), { runId: mid.workflow_run.id, sha: "mid", exact: false });
  // The base commit's build is not taken from a fork either.
  assert.equal(pickBaseline([artifact("base", "2026-11-14T00:00:00Z", { headRepo: FORK })], "base"), null);
});

test("malformed records are skipped, not trusted", () => {
  const good = artifact("good", "2026-11-01T00:00:00Z");
  const bad: unknown[] = [null, 7, "x", {}, { ...good, workflow_run: null }, { ...good, expired: "no" }, { ...good, workflow_run: { ...good.workflow_run, id: "1" } }];
  for (const b of bad) assert.equal(isArtifact(b), false, JSON.stringify(b));
  assert.equal(isArtifact(good), true);
  assert.deepEqual(pickBaseline([...bad, good], null), { runId: good.workflow_run.id, sha: "good", exact: false });
});
