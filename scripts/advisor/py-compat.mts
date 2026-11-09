// Python behaviour the advisor pipeline depends on, in one place.
//
// The pipeline was ported from Python, and these are the places where a line-by-line port would
// silently change results: cache keys that stop matching (a miss costs money), rounding that moves
// a holdout, a `corpus_meta.yaml` that is rewritten differently. Each is pinned by
// tests/advisor-py-compat.test.mts against goldens generated from the Python code.

import fs from "node:fs";
import { Scalar, parseDocument, visit, type CollectionTag, type ScalarTag } from "yaml";

// ---- Strings -----------------------------------------------------------------------------

/** `len(s)`: code points, where `s.length` counts UTF-16 units. */
export function pyLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Python's string order (by code point). `<` on JavaScript strings orders astral characters wrongly. */
export function codePointCompare(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** The characters `\s` and `str.isspace()` accept. JavaScript's `\s` lacks U+001C–1F and U+0085, and adds U+FEFF. */
export const PY_SPACE = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** The characters `\w` accepts in a str pattern; use with the `u` flag. JavaScript's `\w` is ASCII even with `/u`. */
export const PY_WORD = "\\p{L}\\p{N}_";
/** `\b` in a str pattern; use with the `u` flag. JavaScript's `\b` is ASCII even with `/u`. */
export const PY_BOUNDARY = `(?:(?<=[${PY_WORD}])(?![${PY_WORD}])|(?<![${PY_WORD}])(?=[${PY_WORD}]))`;

const SPACE_RUN = new RegExp(`[${PY_SPACE}]+`, "g");
const LEADING_SPACE = new RegExp(`^[${PY_SPACE}]+`);
const TRAILING_SPACE = new RegExp(`[${PY_SPACE}]+$`);

/** `s.strip()`. */
export function pyStrip(s: string): string {
  return s.replace(LEADING_SPACE, "").replace(TRAILING_SPACE, "");
}

/** `s.split()`: runs of whitespace separate, and there are no empty fields. */
export function pySplit(s: string): string[] {
  const stripped = pyStrip(s);
  return stripped === "" ? [] : stripped.split(SPACE_RUN);
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

/** `s.splitlines(keepends)`. Unlike `split("\n")`, it also breaks at U+2028 and friends, and leaves no trailing "". */
export function pySplitLines(s: string, keepEnds = false): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of s.matchAll(LINE_BREAK)) {
    const end = m.index + m[0].length;
    out.push(s.slice(start, keepEnds ? end : m.index));
    start = end;
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

/** `Path.read_text()`: universal newlines, so `\r\n` and `\r` read as `\n`. */
export function pyReadText(file: string): string {
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

/** `repr(s)`, for messages that must read the same as the Python tool's. */
export function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + quote;
}

// ---- Numbers -----------------------------------------------------------------------------

/** A float that must stay a float in text. JavaScript has one number type, so `1.0` needs marking to print as `1.0`. */
export class PyFloat {
  readonly value: number;
  constructor(value: number) { this.value = value; }
}

/** `repr(x)` for a float: `1.0`, `-0.0`, `1e+16`, `1e-05`, `inf`, `nan`. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  // toExponential() with no argument gives the same shortest round-tripping digits as repr.
  const [mantissa, exponent] = x.toExponential().split("e");
  const exp = Number(exponent);
  const negative = mantissa.startsWith("-");
  const digits = mantissa.replace("-", "").replace(".", "");
  const sign = negative ? "-" : "";
  if (exp >= 16 || exp < -4) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const e = Math.abs(exp);
    return `${sign}${m}e${exp < 0 ? "-" : "+"}${e < 10 ? "0" : ""}${e}`;
  }
  if (exp < 0) return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
  const whole = digits.padEnd(exp + 1, "0");
  const fraction = digits.slice(exp + 1);
  return `${sign}${whole.slice(0, exp + 1)}.${fraction || "0"}`;
}

/** The double `x` as exactly mantissa × 2^exponent. */
function exactParts(x: number): { mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  return biased === 0 ? { mantissa: fraction, exponent: -1074 } : { mantissa: fraction | (1n << 52n), exponent: biased - 1075 };
}

/**
 * `round(x, ndigits)`: half-even on the double's exact value, as Python's correctly rounded
 * conversion does. So `round(2.5) == 2`, and `round(2.675, 2) == 2.67` because 2.675 is really
 * slightly less. `ndigits` must be at least 0; 0 means Python's `round(x)`, which returns an int.
 */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const { mantissa, exponent } = exactParts(x);
  // x·10^n as an exact fraction: numerator / denominator.
  let numerator = mantissa * 10n ** BigInt(ndigits);
  let denominator = 1n;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  let quotient = numerator / denominator;
  const twice = (numerator % denominator) * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) quotient += 1n;
  const text = ndigits === 0 ? quotient.toString() : `${quotient}e-${ndigits}`;
  const result = Number(text);
  // With no ndigits Python returns an int, which has no -0.
  if (ndigits === 0 && result === 0) return 0;
  return x < 0 ? -result : result;
}

/** `bisect.bisect_left` over an ascending array. */
export function bisectLeft(sorted: ArrayLike<number>, x: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `np.argsort(-scores, kind="stable")`: indices by descending score, ties in index order. */
export function stableArgsortDesc(scores: ArrayLike<number>): number[] {
  const order = Array.from({ length: scores.length }, (_, i) => i);
  return order.sort((a, b) => scores[b] - scores[a] || a - b);
}

/** Python's truth test. `[]` and `{}` are falsy there and truthy here. */
export function pyTruthy(value: unknown): boolean {
  if (value instanceof PyFloat) return value.value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === "object" && !(value instanceof PyDate)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/** `str(value)` for what YAML can produce. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (value instanceof PyFloat) return floatRepr(value.value);
  if (value instanceof PyDate) return value.text;
  return String(value);
}

// ---- Canonical JSON ----------------------------------------------------------------------

/**
 * `json.dumps(value, sort_keys=True, ensure_ascii=False)`, whose separators are `, ` and `: `.
 * Cache keys are hashes of this text, so any difference misses every cached judgment. Mark floats
 * that have no fractional part with `PyFloat`; a plain integer-valued number prints as an int.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof PyFloat) return jsonFloat(value.value);
  if (typeof value === "number") return Number.isInteger(value) && !Object.is(value, -0) ? bigOrPlain(value) : jsonFloat(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => codePointCompare(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${canonicalJson(v)}`).join(", ")}}`;
  }
  throw new TypeError(`canonicalJson: cannot serialise a ${typeof value}`);
}

function jsonFloat(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  return floatRepr(x);
}

/** Integers print in full however large: `String(1e21)` would be `1e+21`. */
function bigOrPlain(x: number): string {
  return BigInt(x).toString();
}

// ---- YAML --------------------------------------------------------------------------------

/**
 * A `date` or `datetime` as PyYAML reads it. `text` is its `str()`, which is all the pipeline uses.
 * Holding the text avoids JavaScript's Date, which can't tell `2021-01-01` from midnight on that day.
 */
export class PyDate {
  readonly text: string;
  constructor(text: string) { this.text = text; }
}

// The implicit resolvers of PyYAML's `resolver.py`, which is YAML 1.1 with its own choices: `y`, `n`
// and `1e3` are strings there, though the `yaml` library's 1.1 schema reads them otherwise.
const RESOLVE_BOOL = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const RESOLVE_FLOAT = /^(?:[-+]?[0-9][0-9_]*\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
const RESOLVE_INT = /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
const RESOLVE_NULL = /^(?:~|null|Null|NULL|)$/;
const RESOLVE_TIMESTAMP = /^(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:[Tt]|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)$/;
const RESOLVE_OTHER = /^(?:<<|=)$/;

/** True if PyYAML reads `s`, written plain, as something other than a string. */
function resolvesToNonString(s: string): boolean {
  return RESOLVE_NULL.test(s) || RESOLVE_BOOL.test(s) || RESOLVE_INT.test(s) || RESOLVE_FLOAT.test(s) || RESOLVE_TIMESTAMP.test(s) || RESOLVE_OTHER.test(s);
}

function sexagesimal(digits: string): number {
  return digits.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function constructInt(text: string): number {
  let value = text.replaceAll("_", "");
  let sign = 1;
  if (value[0] === "-") sign = -1;
  if (value[0] === "-" || value[0] === "+") value = value.slice(1);
  if (value === "0") return 0;
  if (value.startsWith("0b")) return sign * parseInt(value.slice(2), 2);
  if (value.startsWith("0x")) return sign * parseInt(value.slice(2), 16);
  if (value[0] === "0") return sign * parseInt(value, 8);
  if (value.includes(":")) return sign * sexagesimal(value);
  return sign * Number(value);
}

function constructFloat(text: string): PyFloat {
  let value = text.toLowerCase().replaceAll("_", "");
  let sign = 1;
  if (value[0] === "-") sign = -1;
  if (value[0] === "-" || value[0] === "+") value = value.slice(1);
  if (value === ".inf") return new PyFloat(sign * Infinity);
  if (value === ".nan") return new PyFloat(NaN);
  if (value.includes(":")) return new PyFloat(sign * sexagesimal(value));
  return new PyFloat(sign * Number(value));
}

/** The `str()` of the date or datetime PyYAML builds. Throws on an impossible date, as PyYAML does. */
function constructTimestamp(text: string): PyDate {
  const m = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:[Tt]|[ \t]+)([0-9]{1,2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]*))?(?:[ \t]*(Z|([-+])([0-9]{1,2})(?::([0-9]{2}))?))?)?$/.exec(text);
  if (!m) throw new Error(`bad timestamp ${text}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) throw new Error(`bad date ${text}`);
  const pad = (n: string | number, width = 2) => String(n).padStart(width, "0");
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  if (m[4] === undefined) return new PyDate(date);
  let out = `${date} ${pad(m[4])}:${m[5]}:${m[6]}`;
  if (m[7]) {
    const micro = m[7].slice(0, 6).padEnd(6, "0");
    if (Number(micro) !== 0) out += `.${micro}`;
  }
  if (m[8] === "Z") out += "+00:00";
  else if (m[8]) out += `${m[9]}${pad(m[10])}:${pad(m[11] ?? "0")}`;
  return new PyDate(out);
}

const PYYAML_TAGS: (ScalarTag | CollectionTag)[] = [
  { tag: "tag:yaml.org,2002:null", default: true, test: RESOLVE_NULL, resolve: () => null } as ScalarTag,
  { tag: "tag:yaml.org,2002:bool", default: true, test: RESOLVE_BOOL, resolve: (s: string) => /^(?:yes|true|on)$/i.test(s) } as ScalarTag,
  { tag: "tag:yaml.org,2002:int", default: true, test: RESOLVE_INT, resolve: constructInt } as ScalarTag,
  { tag: "tag:yaml.org,2002:float", default: true, test: RESOLVE_FLOAT, resolve: constructFloat } as unknown as ScalarTag,
  {
    tag: "tag:yaml.org,2002:timestamp", default: true, test: RESOLVE_TIMESTAMP,
    resolve(s: string, onError: (message: string) => void) {
      try { return constructTimestamp(s); }
      catch (e) { onError(String(e)); return s; }
    },
  } as unknown as ScalarTag,
  // `=` and `<<` resolve to tags that safe_load refuses as plain values.
  {
    tag: "tag:yaml.org,2002:value", default: true, test: RESOLVE_OTHER,
    resolve(s: string, onError: (message: string) => void) { onError(`cannot construct ${s}`); return s; },
  } as ScalarTag,
];

/** Raised for what `yaml.YAMLError` covers: text PyYAML's `safe_load` refuses. */
export class YamlError extends Error {}

// In a plain scalar PyYAML stops at a tab, which then can't start a token, and takes U+0085, U+2028
// and U+2029 for line breaks, so the next "line" is usually a key with no colon. The library reads
// all of them as ordinary characters.
const NOT_PLAIN_IN_PYYAML = /[\t\x85\u2028\u2029]/;

/**
 * `yaml.safe_load(text)`. Dates come back as `PyDate`, floats as `PyFloat`. Throws `YamlError`.
 * One known difference: a raw U+0085, U+2028 or U+2029 inside a quoted scalar stays as written here,
 * where PyYAML folds around it. `yamlScalar` and `safe_dump` both escape or avoid those, so no
 * frontmatter or sidecar written by these tools has one.
 */
export function pyYamlLoad(text: string): unknown {
  try {
    const doc = parseDocument(text, { version: "1.1", schema: "failsafe", customTags: PYYAML_TAGS, uniqueKeys: false, logLevel: "silent" });
    // An unknown tag is only a warning in the library, and an error from safe_load.
    const problem = doc.errors[0] ?? doc.warnings[0];
    if (problem) throw new YamlError(problem.message);
    if (NOT_PLAIN_IN_PYYAML.test(text)) {
      visit(doc, {
        Scalar(_, node) {
          if (node.type === Scalar.PLAIN && NOT_PLAIN_IN_PYYAML.test(node.source ?? "")) throw new YamlError("tab or line break in a plain scalar");
        },
      });
    }
    return doc.toJS(); // Throws on an alias with no anchor.
  } catch (e) {
    throw e instanceof YamlError ? e : new YamlError(String(e));
  }
}

const WIDE_SPACE = "\0 \t\r\n\x85\u2028\u2029";
const BREAKS = "\n\x85\u2028\u2029";

interface ScalarAnalysis { empty: boolean; multiline: boolean; allowBlockPlain: boolean; allowSingleQuoted: boolean }

/** PyYAML's `Emitter.analyze_scalar`, with `allow_unicode=True` and block context. */
function analyzeScalar(scalar: string): ScalarAnalysis {
  if (!scalar) return { empty: true, multiline: false, allowBlockPlain: true, allowSingleQuoted: true };
  const chars = Array.from(scalar);
  let blockIndicators = scalar.startsWith("---") || scalar.startsWith("...");
  let lineBreaks = false, special = false;
  let leadingSpace = false, leadingBreak = false, trailingSpace = false, trailingBreak = false, breakSpace = false, spaceBreak = false;
  let precededByWhitespace = true;
  let followedByWhitespace = chars.length === 1 || WIDE_SPACE.includes(chars[1]);
  let previousSpace = false, previousBreak = false;
  chars.forEach((ch, index) => {
    if (index === 0) {
      if ("#,[]{}&*!|>'\"%@`".includes(ch)) blockIndicators = true;
      if ("?:".includes(ch) && followedByWhitespace) blockIndicators = true;
      if (ch === "-" && followedByWhitespace) blockIndicators = true;
    } else {
      if (ch === ":" && followedByWhitespace) blockIndicators = true;
      if (ch === "#" && precededByWhitespace) blockIndicators = true;
    }
    if (BREAKS.includes(ch)) lineBreaks = true;
    const cp = ch.codePointAt(0)!;
    if (!(ch === "\n" || (cp >= 0x20 && cp <= 0x7e))) {
      const allowed = cp === 0x85 || (cp >= 0xa0 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp < 0x10ffff);
      if (!allowed || cp === 0xfeff) special = true;
    }
    if (ch === " ") {
      if (index === 0) leadingSpace = true;
      if (index === chars.length - 1) trailingSpace = true;
      if (previousBreak) breakSpace = true;
      previousSpace = true;
      previousBreak = false;
    } else if (BREAKS.includes(ch)) {
      if (index === 0) leadingBreak = true;
      if (index === chars.length - 1) trailingBreak = true;
      if (previousSpace) spaceBreak = true;
      previousSpace = false;
      previousBreak = true;
    } else {
      previousSpace = false;
      previousBreak = false;
    }
    precededByWhitespace = WIDE_SPACE.includes(ch);
    followedByWhitespace = index + 2 >= chars.length || WIDE_SPACE.includes(chars[index + 2]);
  });
  let allowBlockPlain = true, allowSingleQuoted = true;
  if (leadingSpace || leadingBreak || trailingSpace || trailingBreak) allowBlockPlain = false;
  if (breakSpace) allowBlockPlain = allowSingleQuoted = false;
  if (spaceBreak || special) allowBlockPlain = allowSingleQuoted = false;
  if (lineBreaks) allowBlockPlain = false;
  if (blockIndicators) allowBlockPlain = false;
  return { empty: false, multiline: lineBreaks, allowBlockPlain, allowSingleQuoted };
}

const ESCAPES = new Map<string, string>([
  ["\0", "0"], ["\x07", "a"], ["\x08", "b"], ["\t", "t"], ["\n", "n"], ["\v", "v"], ["\f", "f"], ["\r", "r"], ["\x1b", "e"],
  ['"', '"'], ["\\", "\\"], ["\x85", "N"], ["\xa0", "_"], ["\u2028", "L"], ["\u2029", "P"],
]);

/** The block-style subset of PyYAML's `Emitter`: what `safe_dump(value, sort_keys=True, allow_unicode=True, width=…)` writes. */
class YamlEmitter {
  private out = "";
  private column = 0;
  private indent = 0;
  private whitespace = true;
  private indention = true;
  private readonly width: number;
  constructor(width: number) { this.width = width; }

  result(): string { return this.out; }

  private write(data: string): void {
    this.out += data;
    this.column += pyLen(data);
  }

  private lineBreak(data = "\n"): void {
    this.whitespace = true;
    this.indention = true;
    this.out += data;
    this.column = 0;
  }

  private writeIndent(): void {
    if (!this.indention || this.column > this.indent || (this.column === this.indent && !this.whitespace)) this.lineBreak();
    if (this.column < this.indent) {
      this.whitespace = true;
      this.write(" ".repeat(this.indent - this.column));
    }
  }

  private indicator(text: string, needWhitespace: boolean, whitespace = false, indention = false): void {
    this.write(this.whitespace || !needWhitespace ? text : ` ${text}`);
    this.whitespace = whitespace;
    this.indention = this.indention && indention;
  }

  private plain(text: string, split: boolean): void {
    if (!text) return;
    if (!this.whitespace) this.write(" ");
    this.whitespace = false;
    this.indention = false;
    const chars = Array.from(text);
    let spaces = false, start = 0;
    for (let end = 0; end <= chars.length; end++) {
      const ch = chars[end];
      if (spaces) {
        if (ch !== " ") {
          if (start + 1 === end && this.column > this.width && split) {
            this.writeIndent();
            this.whitespace = false;
            this.indention = false;
          } else this.write(chars.slice(start, end).join(""));
          start = end;
        }
      } else if (ch === undefined || ch === " ") {
        this.write(chars.slice(start, end).join(""));
        start = end;
      }
      if (ch !== undefined) spaces = ch === " ";
    }
  }

  private singleQuoted(text: string, split: boolean): void {
    this.indicator("'", true);
    const chars = Array.from(text);
    let spaces = false, breaks = false, start = 0;
    for (let end = 0; end <= chars.length; end++) {
      const ch = chars[end];
      if (spaces) {
        if (ch === undefined || ch !== " ") {
          if (start + 1 === end && this.column > this.width && split && start !== 0 && end !== chars.length) this.writeIndent();
          else this.write(chars.slice(start, end).join(""));
          start = end;
        }
      } else if (breaks) {
        if (ch === undefined || !BREAKS.includes(ch)) {
          if (chars[start] === "\n") this.lineBreak();
          for (const br of chars.slice(start, end)) this.lineBreak(br);
          this.writeIndent();
          start = end;
        }
      } else if (ch === undefined || " \n\x85\u2028\u2029'".includes(ch)) {
        if (start < end) {
          this.write(chars.slice(start, end).join(""));
          start = end;
        }
      }
      if (ch === "'") {
        this.write("''");
        start = end + 1;
      }
      if (ch !== undefined) {
        spaces = ch === " ";
        breaks = BREAKS.includes(ch);
      }
    }
    this.indicator("'", false);
  }

  private doubleQuoted(text: string, split: boolean): void {
    this.indicator('"', true);
    const chars = Array.from(text);
    let start = 0;
    for (let end = 0; end <= chars.length; end++) {
      const ch = chars[end];
      const cp = ch?.codePointAt(0) ?? 0;
      const printable = (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd);
      if (ch === undefined || '"\\\x85\u2028\u2029\ufeff'.includes(ch) || !printable) {
        if (start < end) {
          this.write(chars.slice(start, end).join(""));
          start = end;
        }
        if (ch !== undefined) {
          const escape = ESCAPES.get(ch);
          const hex = cp.toString(16).toUpperCase();
          if (escape !== undefined) this.write(`\\${escape}`);
          else if (cp <= 0xff) this.write(`\\x${hex.padStart(2, "0")}`);
          else if (cp <= 0xffff) this.write(`\\u${hex.padStart(4, "0")}`);
          else this.write(`\\U${hex.padStart(8, "0")}`);
          start = end + 1;
        }
      }
      if (end > 0 && end < chars.length - 1 && (ch === " " || start >= end) && this.column + (end - start) > this.width && split) {
        const data = `${chars.slice(start, end).join("")}\\`;
        if (start < end) start = end;
        this.write(data);
        this.writeIndent();
        this.whitespace = false;
        this.indention = false;
        if (chars[start] === " ") this.write("\\");
      }
    }
    this.indicator('"', false);
  }

  /** A string: plain when it reads back as a string and the analysis allows it, else single-quoted, else double-quoted. */
  private string(value: string, simpleKey: boolean): void {
    const analysis = analyzeScalar(value);
    const split = !simpleKey;
    const plainAllowed = !resolvesToNonString(value) && !(simpleKey && (analysis.empty || analysis.multiline)) && analysis.allowBlockPlain;
    if (plainAllowed) this.plain(value, split);
    else if (analysis.allowSingleQuoted && !(simpleKey && analysis.multiline)) this.singleQuoted(value, split);
    else this.doubleQuoted(value, split);
  }

  private scalar(value: unknown, simpleKey: boolean): void {
    const saved = this.indent;
    this.indent += 2;
    if (typeof value === "string") this.string(value, simpleKey);
    else this.plain(yamlScalarText(value), !simpleKey);
    this.indent = saved;
  }

  private mapping(value: Record<string, unknown>, parentIndent: number | null): void {
    const saved = this.indent;
    this.indent = parentIndent === null ? 0 : parentIndent + 2;
    for (const key of Object.keys(value).sort(codePointCompare)) {
      if (pyLen(key) >= 128 || key === "" || analyzeScalar(key).multiline) throw new Error(`pyYamlDump: key too complex for a simple key: ${strRepr(key)}`);
      this.writeIndent();
      this.scalar(key, true);
      this.indicator(":", false);
      this.node(value[key], true);
    }
    this.indent = saved;
  }

  private sequence(value: unknown[], inMapping: boolean): void {
    const saved = this.indent;
    // A list under a mapping key is not indented further ("indentless"), unless it follows "- ".
    if (!(inMapping && !this.indention)) this.indent += 2;
    for (const item of value) {
      this.writeIndent();
      this.indicator("-", true, false, true);
      this.node(item, false);
    }
    this.indent = saved;
  }

  node(value: unknown, inMapping: boolean): void {
    if (Array.isArray(value)) {
      if (value.length === 0) this.emptyFlow("[", "]");
      else this.sequence(value, inMapping);
    } else if (value !== null && typeof value === "object" && !(value instanceof PyFloat) && !(value instanceof PyDate)) {
      const map = value as Record<string, unknown>;
      if (Object.keys(map).length === 0) this.emptyFlow("{", "}");
      else this.mapping(map, this.indent);
    } else this.scalar(value, false);
  }

  private emptyFlow(open: string, close: string): void {
    this.indicator(open, true, true);
    this.indicator(close, false);
  }

  document(value: Record<string, unknown>): void {
    if (Object.keys(value).length === 0) {
      this.emptyFlow("{", "}");
    } else this.mapping(value, null);
    this.lineBreak();
  }
}

/** The text PyYAML's representer gives a non-string scalar. */
function yamlScalarText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (value instanceof PyDate) return value.text;
  const x = value instanceof PyFloat ? value.value : (value as number);
  if (typeof x !== "number") throw new TypeError(`pyYamlDump: cannot represent a ${typeof value}`);
  if (!(value instanceof PyFloat) && Number.isInteger(x)) return bigOrPlain(x);
  if (Number.isNaN(x)) return ".nan";
  if (!Number.isFinite(x)) return x > 0 ? ".inf" : "-.inf";
  const text = floatRepr(x);
  return !text.includes(".") && text.includes("e") ? text.replace("e", ".0e") : text;
}

/**
 * `yaml.safe_dump(value, sort_keys=True, allow_unicode=True, width=width)` for a mapping of maps,
 * lists and scalars. The `yaml` library's stringifier quotes by other rules, and `corpus_meta.yaml`
 * must stay byte-stable. Keys must be simple ones (under 128 characters, single line, non-empty).
 */
export function pyYamlDump(value: Record<string, unknown>, width = 1000): string {
  const emitter = new YamlEmitter(width);
  emitter.document(value);
  return emitter.result();
}
