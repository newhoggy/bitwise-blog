import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Any public page with a <main> to inject into: the test must not depend on one page staying put.
const PAGE = "docs/" + fs.readdirSync(path.join(source, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).find((f) => {
  const html = fs.readFileSync(path.join(source, "docs", f), "utf8");
  return html.includes("</main>") && !html.includes('id="sealed-payload"');
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-dupid-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const check = () => spawnSync(process.execPath, [path.join(root, "scripts/bh.mjs"), "check"], { cwd: root, env, encoding: "utf8" }).stdout;
  const inject = (text) => {
    const file = path.join(root, PAGE), html = fs.readFileSync(file, "utf8"), next = html.replace("</main>", `${text}</main>`);
    assert.notEqual(next, html, "the injection changed nothing");
    fs.writeFileSync(file, next);
  };
  return { check, inject };
}

test("check fails on an id used by two elements", (t) => {
  const f = fixture(t);
  f.inject('<p id="twice">a</p><p id="twice">b</p>');
  assert.match(f.check(), /duplicate id="twice"/);
});

test("check does not read ids out of script text", (t) => {
  // An inlined figure script builds markup in template strings; two figures give two of them.
  const f = fixture(t);
  const script = "<script>const gradient = `<linearGradient id=\"${id}\"></linearGradient>`;</script>";
  f.inject(script + script);
  const out = f.check();
  // `check` must have run to its summary, or the absence below proves nothing.
  assert.match(out, /\d+ files/);
  assert.doesNotMatch(out, /duplicate id/);
});
