import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { PAGE_ERROR_BYTES, PAGE_WARN_BYTES, pageSizeFinding, pageWeight } from "../scripts/page-size.mts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmp(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-size-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Incompressible text, so its gzip size is close to its length. */
const noise = (bytes: number): string => crypto.randomBytes(Math.ceil((bytes * 3) / 4)).toString("base64").slice(0, bytes);

test("a page is measured gzipped, not by its raw bytes", (t) => {
  const dir = tmp(t), file = path.join(dir, "p.html");
  fs.writeFileSync(file, "<p>" + "a".repeat(300_000) + "</p>");
  const w = pageWeight(file);
  assert.ok(w.total < 2_000, `300 KB of one letter should gzip to almost nothing, got ${w.total}`);
  assert.equal(pageSizeFinding(w), undefined);
});

test("local images are counted once each; data:, remote and missing images are not", (t) => {
  const dir = tmp(t), file = path.join(dir, "p.html");
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "a.png"), crypto.randomBytes(5_000));
  fs.writeFileSync(file, [
    '<img src="assets/a.png" alt="">', '<img alt="" src="assets/a.png?v=2">',
    '<img src="data:image/png;base64,AAAA" alt="">', '<img src="https://example.com/x.png" alt="">',
    '<img src="//example.com/x.png" alt="">', '<img src="assets/missing.png" alt="">',
  ].join("\n"));
  const w = pageWeight(file);
  assert.deepEqual(w.parts.map((p) => p.path), ["p.html", path.join("assets", "a.png")]);
  assert.ok(w.parts[1].bytes > 5_000, "random bytes do not compress");
  assert.equal(w.total, w.parts[0].bytes + w.parts[1].bytes);
});

test("the thresholds are exclusive at the boundary and name the heaviest part", () => {
  const w = (total: number) => ({ total, parts: [{ path: "p.html", bytes: total - 10 }, { path: "assets/a.png", bytes: 10 }] });
  assert.equal(pageSizeFinding(w(PAGE_WARN_BYTES)), undefined);
  const warn = pageSizeFinding(w(PAGE_WARN_BYTES + 1));
  assert.equal(warn?.level, "warn");
  assert.match(warn!.message, /over the 75\.0 KB budget; the heaviest part is p\.html/);
  assert.equal(pageSizeFinding(w(PAGE_ERROR_BYTES))?.level, "warn");
  const error = pageSizeFinding(w(PAGE_ERROR_BYTES + 1));
  assert.equal(error?.level, "error");
  assert.match(error!.message, /over the 200\.0 KB limit/);
});

test("the published pages are inside the budget", () => {
  const docs = path.join(source, "docs");
  for (const f of fs.readdirSync(docs).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html"))) {
    assert.equal(pageSizeFinding(pageWeight(path.join(docs, f))), undefined, f);
  }
});

function fixture(t: TestContext) {
  const root = tmp(t);
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const page = path.join(root, "docs", "adr-001-rate-limit-in-each-service.html");
  // Grow the page until it gzips to `target` bytes plus a margin (base64 noise gzips to roughly 3/4 of its length, so this overshoots a little).
  const bloat = (target: number) => {
    const html = fs.readFileSync(page, "utf8"), next = html.replace("</main>", `<!-- ${noise(Math.ceil((target + 5_000) / 0.7))} --></main>`);
    assert.notEqual(next, html, "the injection changed nothing");
    fs.writeFileSync(page, next);
    assert.ok(pageWeight(page).total > target, "the page did not reach the target weight");
  };
  const check = () => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "check"], { cwd: root, env, encoding: "utf8" });
    return { status: r.status, stdout: r.stdout.replace(/\x1b\[[0-9;]*m/g, "") };
  };
  return { bloat, check };
}

test("check warns on a page over the budget and still passes", (t) => {
  const f = fixture(t);
  f.bloat(PAGE_WARN_BYTES);
  const r = f.check();
  assert.match(r.stdout, /adr-001-rate-limit-in-each-service\.html[\s\S]*?warn\s+page weighs \d+\.\d KB gzipped[^\n]*budget/);
  assert.match(r.stdout, /0 errors · \S*1 warning/);
  assert.equal(r.status, 0);
});

test("check fails on a page over the limit", (t) => {
  const f = fixture(t);
  f.bloat(PAGE_ERROR_BYTES);
  const r = f.check();
  assert.match(r.stdout, /error\s+page weighs \d+\.\d KB gzipped[^\n]*limit/);
  assert.notEqual(r.status, 0);
});
