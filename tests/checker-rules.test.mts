// `npm run check` is the repo's main guard, so its rules need tests of their own: a rule that
// silently stopped firing would let every page through. Each case here breaks (or, for a
// control, leaves alone) one thing in a throwaway copy of the site, runs the real `check`, and
// asserts the exact messages it prints for that page, no more and no fewer.
//
// A page case is a fragment in tests/fixtures/checker-rules/. Its leading comments say what
// `check` must report for the page the fragment is injected into, one per message:
//   <!-- expect error: <message> -->     <!-- expect warn: <message> -->     <!-- expect clean -->
// Rules about the theme (contrast, stylesheet imports) edit a theme file instead; see THEME_CASES.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(source, "tests/fixtures/checker-rules");

// The host page: any public page whose first visual comes before the fragment, so injecting a
// figure at the end of the article cannot change which visual its social card shows.
const HOST = "docs/" + fs.readdirSync(path.join(source, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).find((f) => {
  const html = fs.readFileSync(path.join(source, "docs", f), "utf8");
  return f !== "glossary.html" && !html.includes('id="sealed-payload"') && html.includes("</article>") && /<figure\b[\s\S]*?<svg\b/.test(html);
});

/** What `check` printed under one heading: the messages, as "error: …" and "warn: …". */
function messagesUnder(out: string, heading: string): string[] {
  const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const start = lines.findIndex((l) => /^[✓✗!] /.test(l) && l.slice(2).startsWith(heading));
  assert.ok(start >= 0, `check printed no heading "${heading}":\n${out}`);
  const found: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^[✓✗!] /.test(l) || /^\d+ files/.test(l)) break;
    const m = l.match(/^ {2}(error|warn) +(.*)$/);
    if (m) found.push(`${m[1]}: ${m[2]}`);
  }
  return found;
}

function site(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-rules-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml"]) {
    fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
  }
  // `check` asks 1Password for a private page's key; make that fail at once instead.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
  const check = () => {
    const r = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "check"], { cwd: root, env, encoding: "utf8" });
    return (r.stdout || "") + (r.stderr || "");
  };
  /** Rewrite one file for the duration of `fn`; the replacement must change something. */
  const edited = <T,>(rel: string, edit: (text: string) => string, fn: () => T): T => {
    const file = path.join(root, rel), before = fs.readFileSync(file, "utf8"), after = edit(before);
    assert.notEqual(after, before, `the edit to ${rel} changed nothing`);
    fs.writeFileSync(file, after);
    try { return fn(); } finally { fs.writeFileSync(file, before); }
  };
  const inject = (fragment: string) => edited(HOST, (html) => html.replace("</article>", () => `${fragment}</article>`), check);
  return { check, edited, inject };
}

test("the host page is clean before anything is injected", (t) => {
  const out = site(t).check();
  assert.match(out, /\d+ files · 0 errors/, out);
  assert.deepEqual(messagesUnder(out, HOST), []);
});

const cases = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".html")).sort();
test("there are page cases to run", () => assert.ok(cases.length > 20, `only ${cases.length} fixtures found`));

for (const name of cases) {
  test(`page rule: ${name.replace(/\.html$/, "")}`, (t) => {
    const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
    const expected = [...text.matchAll(/^<!-- expect (error|warn): (.*) -->$/gm)].map((m) => `${m[1]}: ${m[2]}`);
    const clean = /^<!-- expect clean -->$/m.test(text);
    assert.ok(clean !== (expected.length > 0), `${name} must say either "expect clean" or at least one "expect error|warn"`);
    const fragment = text.replace(/^<!-- expect .* -->\n/gm, "");
    assert.ok(!fragment.includes("expect "), `${name} has a malformed expect line`);
    assert.deepEqual(messagesUnder(site(t).inject(fragment), HOST), expected);
  });
}

// Theme rules: each case edits one theme file and names the heading `check` prints the messages under.
const THEME_CASES: { name: string; file: string; find: string | RegExp; replace: string; expected: string[] }[] = [
  {
    name: "light-mode text too faint on every surface",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#a9adb5, #e7e9ee)",
    expected: [
      "error: tokens.css: --text on --bg is 2.10:1 in light mode (needs 4.5:1)",
      "error: tokens.css: --text on --surface is 2.25:1 in light mode (needs 4.5:1)",
      "error: tokens.css: --text on --surface-2 is 1.97:1 in light mode (needs 4.5:1)",
      "error: tokens.css: --text on --code-bg is 2.03:1 in light mode (needs 4.5:1)",
    ],
  },
  {
    name: "dark-mode failure is reported as dark",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#15181e, #1d2129)",
    expected: [
      "error: tokens.css: --text on --bg is 1.20:1 in dark mode (needs 4.5:1)",
      "error: tokens.css: --text on --surface is 1.11:1 in dark mode (needs 4.5:1)",
      "error: tokens.css: --text on --surface-2 is 1.02:1 in dark mode (needs 4.5:1)",
      "error: tokens.css: --text on --code-bg is 1.15:1 in dark mode (needs 4.5:1)",
    ],
  },
  {
    name: "an equally readable text colour passes",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#101318, #f0f2f6)",
    expected: [],
  },
  {
    name: "a token that is no longer a light-dark() pair",
    file: "theme/tokens.css", find: /--c6: light-dark\(#475569, #a0aec0\);/, replace: "--c6: #475569;",
    // Reported once per theme mode.
    expected: Array(2).fill("error: tokens.css: --c6 or --surface is not a light-dark() hex pair"),
  },
  {
    name: "@import after another rule",
    file: "theme/bh.css", find: '@import url("tokens.css") layer(tokens);', replace: 'body { margin: 0; }\n@import url("tokens.css") layer(tokens);',
    expected: [
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("tokens.css") layer(tokens);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("base.css") layer(base);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("layout.css") layer(layout);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("components.css") layer(components);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("diagrams.css") layer(diagrams);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("glossary.css") layer(components);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("review.css") layer(components);',
      'error: theme/bh.css: @import after other rules is ignored by browsers: @import url("print.css") layer(print);',
    ],
  },
  {
    name: "@import of a stylesheet that does not exist",
    file: "theme/bh.css", find: '@import url("print.css")', replace: '@import url("nope.css")',
    expected: ["error: theme/bh.css: @import of missing file nope.css"],
  },
];

for (const c of THEME_CASES) {
  test(`theme rule: ${c.name}`, (t) => {
    const s = site(t);
    const edit = (text: string) => (typeof c.find === "string" ? (assert.ok(text.includes(c.find), `"${c.find}" is not in ${c.file}`), text.replace(c.find, () => c.replace)) : text.replace(c.find, () => c.replace));
    assert.deepEqual(messagesUnder(s.edited(c.file, edit, s.check), "theme"), c.expected);
  });
}
