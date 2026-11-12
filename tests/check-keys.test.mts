// `check` reads each private page's key from 1Password. Those lookups run concurrently, and
// `--skip-keys` leaves them out, so the edit loop doesn't wait on the app (issue #122, proposal 12).
import assert from "node:assert/strict";
import { test } from "node:test";
import { site, type Site } from "./support/private-site.mts";

const GET = /^start item get /;

/** Four grouped and single pages, sealed, with their plaintext still on disk (as in the author's checkout). */
function sealedSite(t: Parameters<typeof site>[0]): Site {
  const s = site(t);
  s.newPrivate("alpha-plan", "Alpha plan", "kin-circle");
  s.newPrivate("beta-plan", "Beta plan", "kin-circle");
  s.newPrivate("solo-note", "Solo note");
  s.newPrivate("other-note", "Other note");
  assert.equal(s.run(["seal"]).code, 0);
  assert.equal(s.run(["index"]).code, 0);
  return s;
}

test("check looks the keys up concurrently and reports what it always did", { timeout: 120000 }, (t) => {
  const s = sealedSite(t);
  const fresh = s.opCalls().count;
  s.delay(300);
  const r = s.run(["check"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /private pages \(4 sealed\)/);

  const calls = s.opCalls();
  const gets = calls.lines.slice(fresh * 2).filter((l) => GET.test(l));
  // One get per page item (4) plus the group item (1); the loop then reads them from the cache.
  assert.equal(gets.length, 5, calls.lines.join("\n"));
  assert.ok(calls.peak > 1, `the lookups never overlapped (peak ${calls.peak})`);
});

test("a stale seal and an unreadable key are still reported with the lookups ahead of time", { timeout: 120000 }, (t) => {
  const s = sealedSite(t);
  s.setMeta("solo-note", "description", "Changed after sealing");
  let r = s.run(["check"]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /docs\/solo-note\.html is stale: run `npm run seal`/);

  // A lookup that fails for any reason but "no such item" falls back to the serial path and says so.
  r = s.run(["check"], { withOp: false });
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /can't read the key for solo-note from 1Password: the 1Password CLI \(`op`\) is not installed/);
});

test("--skip-keys makes no 1Password call, still checks sealed pages, and says what it skipped", { timeout: 120000 }, (t) => {
  const s = sealedSite(t);
  s.setMeta("solo-note", "description", "Changed after sealing");
  const before = s.opCalls().count;

  const r = s.run(["check", "--skip-keys"], { withOp: false });
  assert.equal(s.opCalls().count, before, "check --skip-keys called op");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /--skip-keys: did not check that 4 private pages are sealed and current/);
  assert.doesNotMatch(r.out, /is stale/);

  // The checks that need no key still run: a damaged sealed payload is an error.
  const sealed = s.read("docs/alpha-plan.html"), broken = sealed.replace(/id="sealed-payload">/, 'id="sealed-payload">!!');
  assert.notEqual(broken, sealed, "the injection changed nothing");
  s.write("docs/alpha-plan.html", broken);
  const bad = s.run(["check", "--skip-keys"], { withOp: false });
  assert.notEqual(bad.code, 0, bad.out);
  assert.match(bad.out, /docs\/alpha-plan\.html/);
});
