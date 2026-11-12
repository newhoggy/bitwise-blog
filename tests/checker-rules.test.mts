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
import { after, test } from "node:test";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(source, "tests/fixtures/checker-rules");

// The host page: any public page whose first visual comes before the fragment, so injecting a
// figure at the end of the article cannot change which visual its social card shows.
const hostFile = fs.readdirSync(path.join(source, "docs")).filter((f) => f.endsWith(".html") && !f.endsWith(".private.html")).find((f) => {
  const html = fs.readFileSync(path.join(source, "docs", f), "utf8");
  return f !== "glossary.html" && !html.includes('id="sealed-payload"') && html.includes("</article>") && /<figure\b[^>]*>(?:(?!<\/figure>)[\s\S])*?<svg\b/.test(html);
});
assert.ok(hostFile, "no public page has a figure with an svg to host the fixtures");
const HOST = "docs/" + hostFile;

/**
 * What `check` printed under one heading (a file path, or "theme"), as "error: …" and "warn: …".
 * An indented line that is not a message fails, so a wrapped message cannot hide.
 */
function messagesUnder(out: string, heading: string): string[] {
  const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const start = lines.findIndex((l) => /^[✓✗!] /.test(l) && (l.slice(2) === heading || l.slice(2).startsWith(heading + " ")));
  assert.ok(start >= 0, `check printed no heading "${heading}":\n${out}`);
  const found: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^[✓✗!] /.test(l) || /^\d+ files/.test(l)) break;
    if (!l.trim()) continue;
    const m = l.match(/^ {2}(error|warn) +(.*)$/);
    assert.ok(m, `unrecognised line under "${heading}": ${JSON.stringify(l)}`);
    found.push(`${m[1]}: ${m[2]}`);
  }
  return found;
}

// One throwaway copy of the site serves every case; each case restores what it edited.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bh-rules-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
for (const entry of ["scripts", "theme", "docs", "reviews", "templates", "package.json", "index.html", "feed.xml", "sitemap.xml", "robots.txt", "404.html"]) {
  fs.cpSync(path.join(source, entry), path.join(root, entry), { recursive: true });
}
// `check` asks 1Password for a private page's key; make that fail at once instead.
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "op"), "#!/bin/sh\necho 'op: unavailable in tests' >&2\nexit 1\n", { mode: 0o755 });
// BH_SITE_URL, BH_REPO_URL and friends change the generated social and attribution blocks, so they are dropped.
const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CI: "" };
for (const key of Object.keys(env)) if (key.startsWith("BH_")) delete env[key];

const check = () => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/bh.mts"), "check"], { cwd: root, env, encoding: "utf8" });
  return (r.stdout || "") + (r.stderr || "");
};
/** Rewrite one file for the duration of `fn`; the edit must change something. */
const edited = <T,>(rel: string, edit: (text: string) => string, fn: () => T): T => {
  const file = path.join(root, rel), before = fs.readFileSync(file, "utf8"), after = edit(before);
  assert.notEqual(after, before, `the edit to ${rel} changed nothing`);
  fs.writeFileSync(file, after);
  try { return fn(); } finally { fs.writeFileSync(file, before); }
};
const inject = (fragment: string) => edited(HOST, (html) => html.replace("</article>", () => `${fragment}</article>`), check);

test("the host page is clean before anything is injected", () => {
  const out = check();
  assert.match(out, /\d+ files · 0 errors/, out);
  assert.deepEqual(messagesUnder(out, HOST), []);
});

const cases = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".html")).sort();
test("there are page cases to run", () => assert.ok(cases.length > 0, "no fixtures found"));

for (const name of cases) {
  test(`page rule: ${name.replace(/\.html$/, "")}`, () => {
    const text = fs.readFileSync(path.join(FIXTURES, name), "utf8");
    const EXPECT = /^[ \t]*<!-- expect (error|warn): (.*?) -->[ \t]*\r?\n/gm;
    const expected = [...text.matchAll(EXPECT)].map((m) => `${m[1]}: ${m[2]}`);
    const clean = /^[ \t]*<!-- expect clean -->[ \t]*\r?\n/m.test(text);
    assert.ok(clean !== (expected.length > 0), `${name} must say either "expect clean" or at least one "expect error|warn"`);
    const fragment = text.replace(EXPECT, "").replace(/^[ \t]*<!-- expect clean -->[ \t]*\r?\n/m, "");
    assert.ok(!fragment.includes("<!-- expect"), `${name} has a malformed expect line`);
    assert.deepEqual(messagesUnder(inject(fragment), HOST), expected);
  });
}

// Theme rules: each case edits one theme file and checks the messages under the `theme` heading.
// Ratios print as R and repeats collapse, so a palette retune or a new stylesheet import does not
// break a case; `contains` must all be reported, and every message must match `only`
// (so a light-mode fault cannot also report dark mode).
interface ThemeCase { name: string; file: string; find: string; replace: string; contains: string[]; only: RegExp }
const THEME_CASES: ThemeCase[] = [
  {
    name: "light-mode text too faint",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#a9adb5, #e7e9ee)",
    contains: ["error: tokens.css: --text on --bg is R:1 in light mode (needs 4.5:1)", "error: tokens.css: --text on --surface is R:1 in light mode (needs 4.5:1)"],
    only: /^error: tokens\.css: --text on --[\w-]+ is R:1 in light mode \(needs 4\.5:1\)$/,
  },
  {
    name: "dark-mode failure is reported as dark",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#15181e, #1d2129)",
    contains: ["error: tokens.css: --text on --bg is R:1 in dark mode (needs 4.5:1)", "error: tokens.css: --text on --surface is R:1 in dark mode (needs 4.5:1)"],
    only: /^error: tokens\.css: --text on --[\w-]+ is R:1 in dark mode \(needs 4\.5:1\)$/,
  },
  {
    name: "an equally readable text colour passes",
    file: "theme/tokens.css", find: "--text:          light-dark(#15181e, #e7e9ee)", replace: "--text:          light-dark(#101318, #f0f2f6)",
    contains: [], only: /(?!)/, // nothing may be reported
  },
  {
    // #127a48 passes every token pair (on --ok-soft, --surface) but not as badge text on its own 10% tint.
    name: "badge text too faint on its own tint",
    file: "theme/tokens.css", find: "--ok:     light-dark(#117142,", replace: "--ok:     light-dark(#127a48,",
    contains: ["error: tokens.css: a .badge in --ok on --bg is R:1 in light mode (needs 4.5:1)", "error: tokens.css: a .badge in --ok on --surface-2 is R:1 in light mode (needs 4.5:1)"],
    only: /^error: tokens\.css: a \.badge in --ok on --[\w-]+ is R:1 in light mode \(needs 4\.5:1\)$/,
  },
  {
    name: "a slightly darker badge tone passes",
    file: "theme/tokens.css", find: "--ok:     light-dark(#117142,", replace: "--ok:     light-dark(#106f41,",
    contains: [], only: /(?!)/,
  },
  {
    // The search dialog's matches are --text on --warn-soft; a dark --warn-soft in light mode must fail that pair.
    name: "search-match highlight too dark for its text",
    file: "theme/tokens.css", find: "--warn-soft:   light-dark(#fdf1dc,", replace: "--warn-soft:   light-dark(#3a3a3a,",
    contains: ["error: tokens.css: --text on --warn-soft is R:1 in light mode (needs 4.5:1)"],
    only: /^error: tokens\.css: --[\w-]+ on --warn-soft is R:1 in light mode \(needs 4\.5:1\)$/,
  },
  {
    name: "a token that is no longer a light-dark() pair",
    file: "theme/tokens.css", find: "--c6: light-dark(#475569, #a0aec0);", replace: "--c6: #475569;",
    contains: ["error: tokens.css: --c6 or --surface is not a light-dark() hex pair"],
    only: /^error: tokens\.css: --c6 or --surface is not a light-dark\(\) hex pair$/,
  },
  {
    name: "@import after another rule",
    file: "theme/bh.css", find: '@import url("tokens.css") layer(tokens);', replace: 'body { margin: 0; }\n@import url("tokens.css") layer(tokens);',
    contains: ['error: theme/bh.css: @import after other rules is ignored by browsers: @import url("tokens.css") layer(tokens);'],
    only: /^error: theme\/bh\.css: @import after other rules is ignored by browsers: @import /,
  },
  {
    name: "@import of a stylesheet that does not exist",
    file: "theme/bh.css", find: '@import url("print.css")', replace: '@import url("nope.css")',
    contains: ["error: theme/bh.css: @import of missing file nope.css"],
    only: /^error: theme\/bh\.css: @import of missing file nope\.css$/,
  },
];

for (const c of THEME_CASES) {
  test(`theme rule: ${c.name}`, () => {
    const edit = (text: string) => (assert.ok(text.includes(c.find), `"${c.find}" is not in ${c.file}`), text.replace(c.find, () => c.replace));
    const got = [...new Set(messagesUnder(edited(c.file, edit, check), "theme").map((m) => m.replace(/\d+\.\d\d:1/, "R:1")))];
    for (const m of c.contains) assert.ok(got.includes(m), `missing: ${m}\ngot:\n${got.join("\n")}`);
    for (const m of got) assert.match(m, c.only);
  });
}
