// The summary a pull request's render job shows, and when `npm run visual` fails (scripts/visual-report.mts).

import assert from "node:assert/strict";
import { test } from "node:test";
import { changeText, exitCode, summaryMarkdown, type RenderInfo, type Result, type Status, type SummaryContext } from "../scripts/visual-report.mts";

const light = { name: "light", width: 1280, height: 900, scheme: "light", mobile: false };
const phone = { name: "phone", width: 390, height: 844, scheme: "light", mobile: true };
const result = (status: Status, extra: Partial<Result> = {}): Result => ({ name: "gallery--light", file: "docs/component-gallery.html", v: light, status, ...extra });
const info = (commit: string | null, chrome: string | null = "HeadlessChrome/131.0.6778.85"): RenderInfo => ({ commit, chrome, run: commit ? "https://github.com/o/r/actions/runs/1" : null });
const MAIN = "5c3a774c670d363e46463a009ad3968c0abb2436";
const ctx = (extra: Partial<SummaryContext> = {}): SummaryContext => ({ baseline: info(MAIN), current: info(null), base: MAIN, reportOnly: true, ...extra });

test("a render error fails the run even in report-only mode; a difference fails it only without", () => {
  assert.equal(exitCode([result("same"), result("new")], false), 0);
  assert.equal(exitCode([result("changed")], true), 0);
  assert.equal(exitCode([result("changed")], false), 1);
  assert.equal(exitCode([result("error", { error: "boom" })], true), 1);
  assert.equal(exitCode([], true), 0);
});

test("with no baseline the summary says so, and counts only the renders that worked", () => {
  const md = summaryMarkdown([result("new"), result("new", { name: "gallery--phone", v: phone }), result("error", { name: "index--light", error: "never signalled data-bh-ready" })], ctx({ baseline: null }));
  assert.match(md, /^## Visual regression\n/);
  assert.match(md, /\*\*No baseline yet\*\*, so 2 renders were not compared/);
  assert.doesNotMatch(md, /\| Page \|/);
  assert.match(md, /\*\*1 render failed\*\* \(this fails the job\):\n\n- index--light: never signalled data-bh-ready/);
  // Nothing was compared, so there is no note about which commit or Chrome it was compared with.
  assert.doesNotMatch(md, /^> /m);
});

test("no changes names the commit compared with, and links its run", () => {
  const md = summaryMarkdown([result("same"), result("same")], ctx());
  assert.match(md, /\*\*No visual changes\*\* in 2 renders compared with main at `5c3a774` \(\[run\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)\)\./);
  assert.doesNotMatch(md, /Differences are reported/);
});

test("changed renders are listed with their layout, file and size of change", () => {
  const md = summaryMarkdown([
    result("same"),
    result("changed", { changed: 1234, ratio: 0.0012 }),
    result("changed", { name: "gallery--phone", v: phone, sizeChanged: true, changed: Infinity, ratio: 1 }),
  ], ctx());
  assert.match(md, /\*\*2 of 3 renders changed\*\* compared with main at `5c3a774`/);
  assert.match(md, /Differences are reported, not failed/);
  assert.match(md, /\| Page \| Layout \| File \| Change \|\n\| --- \| --- \| --- \| --- \|\n\| gallery \| light \| docs\/component-gallery\.html \| 1,234 px \(0\.120%\) \|\n\| gallery \| phone \| docs\/component-gallery\.html \| page size changed \|/);
  assert.match(md, /`report\.html` in the `renders` artifact/);
  assert.doesNotMatch(summaryMarkdown([result("changed", { changed: 20, ratio: 0 })], ctx({ reportOnly: false })), /Differences are reported/);
});

test("a render without a baseline is named when others were compared", () => {
  const md = summaryMarkdown([result("same"), result("new", { name: "new-page--light" })], ctx());
  assert.match(md, /\*\*No visual changes\*\* in 1 render compared/);
  assert.match(md, /1 render has no baseline yet: new-page--light\./);
});

test("it notes a baseline from another commit than the base, and a Chrome update", () => {
  const md = summaryMarkdown([result("changed", { changed: 99, ratio: 0.0001 })], ctx({ base: "abcdef0123456789", current: info(null, "HeadlessChrome/132.0.1") }));
  assert.match(md, /^> The baseline is main at `5c3a774`, but this pull request is based on `abcdef0`: changes merged to main in between also show here\.$/m);
  assert.match(md, /^> Chrome changed between the two builds \(baseline HeadlessChrome\/131\.0\.6778\.85, this run HeadlessChrome\/132\.0\.1\)/m);
  // The same commit (abbreviated or not) and the same Chrome need no note.
  assert.doesNotMatch(summaryMarkdown([result("same")], ctx({ base: MAIN.slice(0, 12) })), /^> /m);
  // A baseline saved locally has no render.json, so nothing is claimed about it.
  const local = summaryMarkdown([result("changed", { changed: 99, ratio: 0 })], ctx({ baseline: null, base: null }));
  assert.match(local, /compared with the saved baselines\./);
  assert.doesNotMatch(local, /^> /m);
});

test("text from an error message cannot break the markdown", () => {
  const md = summaryMarkdown([result("error", { error: "bad | pipe\n<img src=x> `tick` [link](x) *bold*" })], ctx());
  assert.match(md, /- gallery--light: bad \\\| pipe \\<img src=x\\> \\`tick\\` \\\[link\\\]\(x\) \\\*bold\\\*$/m);
});

test("changeText describes the size of a change", () => {
  assert.equal(changeText(result("changed", { changed: 17, ratio: 0.00001 })), "17 px (0.001%)");
  assert.equal(changeText(result("changed", { sizeChanged: true, changed: Infinity, ratio: 1 })), "page size changed");
  assert.equal(changeText(result("changed")), "changed");
});
