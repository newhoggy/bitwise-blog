// Each hazard from issue #110, pinned against what the Python code does: tests/fixtures/advisor/goldens.json
// was generated from it. Synthetic inputs only; see tests/fixtures/advisor/README.md.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PY_BOUNDARY, PY_SPACE, PY_WORD, PyDate, PyFloat, YamlError,
  bisectLeft, canonicalJson, codePointCompare, floatRepr, pyLen, pyReadText, pyRound, pySplit, pySplitLines, pyStr, pyStrip, pyTruthy, pyYamlDump, pyYamlLoad,
  stableArgsortDesc, strRepr,
} from "../scripts/advisor/py-compat.mts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "advisor");
const goldens = JSON.parse(fs.readFileSync(path.join(FIXTURES, "goldens.json"), "utf8"));

const number = (text: string) => (text === "inf" ? Infinity : text === "-inf" ? -Infinity : text === "nan" ? NaN : Number(text));

/** Goldens mark what JSON can't hold: `{"$float": "1.0"}` and `{"$date": "2021-01-01"}`. */
function untag(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(untag);
  if (value !== null && typeof value === "object") {
    const map = value as Record<string, unknown>;
    if (typeof map.$float === "string") return new PyFloat(number(map.$float));
    if (typeof map.$date === "string") return new PyDate(map.$date);
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, untag(v)]));
  }
  return value;
}

test("the goldens are from the commit the port targets", () => {
  assert.equal(goldens.commit, "af0b407");
});

test("canonicalJson matches json.dumps(sort_keys=True, ensure_ascii=False)", () => {
  assert.ok(goldens.canonical_json.length >= 8);
  for (const { input, output } of goldens.canonical_json) assert.equal(canonicalJson(untag(input)), output);
});

test("canonicalJson differs from JSON.stringify where a cache key would notice", () => {
  const request = { b: 1, a: [new PyFloat(1), "é"] };
  assert.equal(canonicalJson(request), '{"a": [1.0, "é"], "b": 1}');
  assert.notEqual(canonicalJson({ a: 1 }), JSON.stringify({ a: 1 }));
  assert.equal(canonicalJson({ "\u{1F600}": 1, "\uffff": 2 }), '{"\uffff": 2, "\u{1F600}": 1}');
  assert.throws(() => canonicalJson(() => 0), TypeError);
});

test("pyRound is half-even on the double's exact value", () => {
  for (const { x, n, out } of goldens.py_round) assert.equal(floatRepr(pyRound(Number(x), n)), out, `round(${x}, ${n})`);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(2.675, 2), 2.67, "2.675 is really slightly less");
  assert.equal(Math.round(2.5), 3, "the thing pyRound exists to avoid");
  assert.equal(pyRound(NaN), NaN);
  assert.equal(pyRound(Infinity), Infinity);
});

test("floatRepr writes floats as repr() does", () => {
  for (const { x, out } of goldens.float_repr) assert.equal(floatRepr(number(x)), out, x);
  assert.equal(pyStr(new PyFloat(1)), "1.0", 'prompts embed stance="{stance}"');
  assert.equal(pyStr(new PyFloat(-0)), "-0.0");
});

test("strip, split, splitlines and len use Python's character sets", () => {
  for (const { s, strip, split, splitlines, keepends, len } of goldens.strings) {
    const label = JSON.stringify(s);
    assert.equal(pyStrip(s), strip, `strip ${label}`);
    assert.deepEqual(pySplit(s), split, `split ${label}`);
    assert.deepEqual(pySplitLines(s), splitlines, `splitlines ${label}`);
    assert.deepEqual(pySplitLines(s, true), keepends, `keepends ${label}`);
    assert.equal(pyLen(s), len, `len ${label}`);
  }
  assert.notEqual("a\x85b".trim().split(/\s+/).length, pySplit("a\x85b").length, "JavaScript's \\s lacks U+0085");
});

test("the regex classes match Python's \\w and \\s where JavaScript's don't", () => {
  const word = new RegExp(`^[${PY_WORD}]$`, "u"), space = new RegExp(`^[${PY_SPACE}]$`, "u");
  for (const { ch, word: isWord, space: isSpace } of goldens.char_classes) {
    assert.equal(word.test(ch), isWord, `\\w ${JSON.stringify(ch)}`);
    assert.equal(space.test(ch), isSpace, `\\s ${JSON.stringify(ch)}`);
  }
  assert.equal(/^\w$/u.test("é"), false, "JavaScript's \\w is ASCII even with /u");
});

test("PY_BOUNDARY is Python's \\b", () => {
  assert.ok(goldens.boundaries.length >= 6);
  for (const { s, pattern, matches } of goldens.boundaries) {
    const found = [...s.matchAll(new RegExp(`${PY_BOUNDARY}${pattern}${PY_BOUNDARY}`, "gu"))].map((m) => pyLen(s.slice(0, m.index)));
    assert.deepEqual(found, matches, s);
  }
});

test("codePointCompare sorts as sorted() does, not as localeCompare or UTF-16 units do", () => {
  const { input, sorted } = goldens.sort;
  assert.deepEqual([...input].sort(codePointCompare), sorted);
  assert.notDeepEqual([...input].sort(), sorted, "default sort is by UTF-16 unit");
  assert.notDeepEqual([...input].sort((a, b) => a.localeCompare(b)), sorted);
});

test("bisectLeft and stableArgsortDesc keep their tie behaviour", () => {
  for (const { a, x, out } of goldens.bisect) assert.equal(bisectLeft(a, x), out);
  assert.deepEqual(stableArgsortDesc(goldens.argsort.scores), goldens.argsort.order);
});

test("strRepr writes strings as repr() does", () => {
  for (const { s, out } of goldens.str_repr) assert.equal(strRepr(s), out);
});

test("pyTruthy treats empty collections as false", () => {
  for (const falsy of [null, undefined, "", 0, false, [], {}, new PyFloat(0)]) assert.equal(pyTruthy(falsy), false);
  for (const truthy of ["a", 1, true, [0], { a: 0 }, new PyFloat(0.5), new PyDate("2021-01-01")]) assert.equal(pyTruthy(truthy), true);
});

test("pyYamlLoad reads scalars as PyYAML does, not as other YAML 1.1 readers do", () => {
  assert.ok(goldens.yaml_load.length >= 70);
  for (const { text, value, error } of goldens.yaml_load) {
    // A date that doesn't exist is a ValueError in Python, which would crash the tool. Here it is a
    // parse error, so the caller's fallback handles it: a deliberate difference.
    if (error) assert.throws(() => pyYamlLoad(text), YamlError, `should not parse: ${JSON.stringify(text)}`);
    else assert.deepEqual(pyYamlLoad(text), untag(value) ?? null, JSON.stringify(text));
  }
  assert.deepEqual(pyYamlLoad("a: y\nb: 1e3"), { a: "y", b: "1e3" }, "strings in PyYAML; a boolean and a float in the yaml library's 1.1 schema");
  assert.equal(pyStr((pyYamlLoad("d: 2021-02-03") as { d: unknown }).d), "2021-02-03");
});

test("pyYamlDump writes what safe_dump writes", () => {
  assert.ok(goldens.yaml_dump.length >= 9);
  for (const { value, text } of goldens.yaml_dump) assert.equal(pyYamlDump(untag(value) as Record<string, unknown>), text, JSON.stringify(value).slice(0, 200));
  for (const { value, text } of goldens.yaml_dump_narrow) assert.equal(pyYamlDump(untag(value) as Record<string, unknown>, 40), text);
});

test("pyYamlDump refuses keys it can't write as simple keys, rather than writing something else", () => {
  assert.throws(() => pyYamlDump({ ["k".repeat(128)]: 1 }), /too complex/);
  assert.throws(() => pyYamlDump({ "a\nb": 1 }), /too complex/);
  assert.throws(() => pyYamlDump({ "": 1 }), /too complex/);
});

test("pyYamlDump output reads back to the same value", () => {
  for (const { value } of goldens.yaml_dump) {
    const original = untag(value) as Record<string, any>;
    // pyYamlLoad's documented gap: these two are written raw in a quoted scalar, which it doesn't fold.
    if (original.s) {
      delete original.s.nel;
      delete original.s.ls;
    }
    assert.deepEqual(pyYamlLoad(pyYamlDump(original)) ?? {}, original);
  }
});

test("pyReadText has universal newlines", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-py-compat-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "x");
  fs.writeFileSync(file, "a\r\nb\rc\n");
  assert.equal(pyReadText(file), "a\nb\nc\n");
});
