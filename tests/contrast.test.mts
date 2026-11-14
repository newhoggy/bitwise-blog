// Direct unit tests for the token-contrast rule in scripts/check/contrast.mts. It takes the CSS
// text, so each case edits a copy of the real theme in memory. tests/checker-rules.test.mts
// covers the same rule end to end through `check`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CONTRAST_PAIRS, contrastFindings } from "../scripts/check/contrast.mts";

const theme = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "theme");
const TOKENS = fs.readFileSync(path.join(theme, "tokens.css"), "utf8");
const COMPONENTS = fs.readFileSync(path.join(theme, "components.css"), "utf8");

/** The real tokens with one declaration replaced; the replacement must change something. */
const tokensWith = (find: string, replace: string) => {
  assert.ok(TOKENS.includes(find), `"${find}" is not in tokens.css`);
  return TOKENS.replace(find, () => replace);
};
const messages = (tokens: string, components = COMPONENTS) => contrastFindings(tokens, components).map((f) => f.message);

test("the theme as committed passes", () => {
  assert.deepEqual(contrastFindings(TOKENS, COMPONENTS), []);
});

test("a failing pair is an error of the contrast rule, with its ratio, pair and mode", () => {
  // #777777 on white is 4.48:1, just under 4.5.
  const found = contrastFindings(tokensWith("--text:          light-dark(#15181e,", "--text:          light-dark(#777777,"), COMPONENTS);
  assert.ok(found.length > 0);
  assert.ok(found.every((f) => f.rule === "theme/contrast" && f.level === "error"));
  assert.ok(found.some((f) => f.message === "tokens.css: --text on --surface is 4.48:1 in light mode (needs 4.5:1)"), found.map((f) => f.message).join("\n"));
  assert.ok(found.every((f) => / in light mode /.test(f.message)), "a light-mode fault reports light mode only");
});

test("each pair is checked in dark mode as well", () => {
  const found = messages(tokensWith("--text:          light-dark(#15181e, #e7e9ee)", "--text:          light-dark(#15181e, #1d2129)"));
  assert.ok(found.includes("tokens.css: --text on --bg is 1.20:1 in dark mode (needs 4.5:1)"), found.join("\n"));
  assert.ok(found.every((m) => / in dark mode /.test(m)));
});

test("c6 is a non-text stroke: 3:1 is enough", () => {
  assert.deepEqual(CONTRAST_PAIRS.find(([fg]) => fg === "c6"), ["c6", ["surface"], 3]);
});

test("a token that is not a light-dark() hex pair is reported, not skipped", () => {
  const found = messages(tokensWith("--c6: light-dark(#475569, #a0aec0);", "--c6: #475569;"));
  assert.deepEqual([...new Set(found)], ["tokens.css: --c6 or --surface is not a light-dark() hex pair"]);
});

test("badge text is checked on its own 10% tint, not only on the page", () => {
  // #127a48 passes --ok on --ok-soft and --surface, but not as a badge on its tint over --bg.
  const found = messages(tokensWith("--ok:     light-dark(#117142,", "--ok:     light-dark(#127a48,"));
  assert.ok(found.length > 0);
  assert.ok(found.every((m) => /^tokens\.css: a \.badge in --ok on --[\w-]+ is \d+\.\d\d:1 in light mode \(needs 4\.5:1\)$/.test(m)), found.join("\n"));
});

test("badge tones come from the components stylesheet that is passed in", () => {
  // A new badge tone is covered as soon as its rule exists, even before its token does.
  const found = messages(TOKENS, COMPONENTS + "\n.badge.fx { --tone: var(--no-such-token) }\n");
  assert.ok(found.includes("tokens.css: --no-such-token or --bg is not a light-dark() hex pair"), found.join("\n"));
  // With no badge rules, only the plain badge (text-muted) is checked, and it passes.
  assert.deepEqual(messages(TOKENS, ""), []);
});
