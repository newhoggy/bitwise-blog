import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = "docs/how-deflate-works.html";

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
  assert.doesNotMatch(f.check(), /duplicate id/);
});
