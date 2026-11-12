import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { findChrome, launchChrome, serveStatic } from "../scripts/chrome.mts";
import { applyAllowlist, loadAllowlist, publicPages, scan, SCHEMES, type A11yResult, type A11yViolation } from "../scripts/a11y.mts";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome and Node >= 22" : false;

const violation = (id: string): A11yViolation => ({ id, impact: "serious", help: id, helpUrl: "", nodes: [] });
const result = (page: string, scheme: "light" | "dark", ...ids: string[]): A11yResult => ({ page, scheme, violations: ids.map(violation) });

test("an allowlisted rule on its page is not a failure, in either scheme", () => {
  const { failures, unused } = applyAllowlist(
    [result("a.html", "light", "color-contrast"), result("a.html", "dark", "color-contrast")],
    [{ page: "a.html", rule: "color-contrast", reason: "tracked" }],
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(unused, []);
});

test("a rule that is not allowlisted, or is allowlisted for another page, fails", () => {
  const { failures } = applyAllowlist(
    [result("a.html", "light", "color-contrast", "image-alt"), result("b.html", "light", "color-contrast")],
    [{ page: "a.html", rule: "color-contrast", reason: "tracked" }],
  );
  assert.deepEqual(failures.map((f) => [f.page, f.violations.map((v) => v.id)]), [["a.html", ["image-alt"]], ["b.html", ["color-contrast"]]]);
});

test("an allowlist entry that no longer fires is reported, but only for pages that were scanned", () => {
  const entry = (page: string) => ({ page, rule: "list", reason: "tracked" });
  const { failures, unused } = applyAllowlist([result("a.html", "light"), result("a.html", "dark")], [entry("a.html"), entry("not-scanned.html")]);
  assert.deepEqual(failures, []);
  assert.deepEqual(unused.map((u) => u.page), ["a.html"]);
});

test("a scan error is a failure, and does not make its allowlist entries look unused", () => {
  const { failures, unused } = applyAllowlist([{ page: "a.html", scheme: "light", violations: [], error: "boom" }], [{ page: "a.html", rule: "list", reason: "tracked" }]);
  assert.equal(failures.length, 1);
  assert.deepEqual(unused, []);
});

test("the committed allowlist is valid and names only pages that exist", () => {
  const allow = loadAllowlist(path.join(root, "a11y-allowlist.json"));
  const pages = new Set(publicPages(root));
  for (const a of allow) assert.ok(pages.has(a.page), `${a.page} is not a scanned page`);
  assert.equal(new Set(allow.map((a) => `${a.page}|${a.rule}`)).size, allow.length, "no duplicate entries");
});

test("an allowlist entry without a reason is rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-a11y-"));
  try {
    const file = path.join(dir, "allow.json");
    fs.writeFileSync(file, JSON.stringify([{ page: "a.html", rule: "list", reason: "  " }]));
    assert.throws(() => loadAllowlist(file), /non-empty "reason"/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("publicPages leaves out sealed shells and private sources", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-a11y-"));
  try {
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "open.html"), "<html></html>");
    fs.writeFileSync(path.join(dir, "docs", "sealed.html"), '<script id="sealed-payload">abc</script>');
    fs.writeFileSync(path.join(dir, "docs", "draft.private.html"), "<html></html>");
    assert.deepEqual(publicPages(dir), ["index.html", "docs/open.html"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("axe flags a real violation in both schemes and passes a clean page", { skip, timeout: 120000 }, async (t) => {
  const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fixture</title>
<script>document.documentElement.setAttribute("data-bh-ready", "")</script></head><body><main><h1>Fixture</h1>${body}</main></body></html>`;
  const routes = new Map([
    ["/bad.html", { type: "text/html", body: page('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button></button>') }],
    ["/good.html", { type: "text/html", body: page("<p>Nothing wrong here.</p>") }],
  ]);
  const server = await serveStatic(root, routes);
  const chrome = await launchChrome();
  t.after(async () => { await chrome.close(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const axeSource = fs.readFileSync(path.join(root, "node_modules", "axe-core", "axe.min.js"), "utf8");
  for (const scheme of SCHEMES) {
    const bad = (await scan(chrome.send, `${base}/bad.html`, scheme, axeSource, true)).map((v) => v.id);
    assert.ok(bad.includes("image-alt"), `${scheme}: image-alt in ${bad}`);
    assert.ok(bad.includes("button-name"), `${scheme}: button-name in ${bad}`);
    assert.deepEqual(await scan(chrome.send, `${base}/good.html`, scheme, axeSource, true), [], `${scheme}: clean page`);
  }
});
