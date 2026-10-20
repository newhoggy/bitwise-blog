// The three-part DEFLATE series: its numbers must stay real (see support/deflate-suite.mjs).
// The suite reads the three pages as one, in series order.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineDeflateTests } from "./support/deflate-suite.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SERIES = ["how-deflate-compresses.html", "how-deflate-sends-its-code.html", "deflate-format-reference.html"];
const pages = SERIES.map((file) => ({ file, html: fs.readFileSync(path.join(ROOT, "docs", file), "utf8") }));
defineDeflateTests({ PAGE: pages.map((p) => p.html).join("\n"), series: true, file: SERIES[0], pages });

// ---- Claims only the series makes ---------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { EXAMPLE, PARAGRAPH, trace } from "../scripts/deflate-example.mjs";

const PART1 = pages[0].html, PART2 = pages[1].html;
const Deflate = vm.runInThisContext(`(() => {${PART1.match(/\/\* deflate-encoder:start \*\/([\s\S]*?)\/\* deflate-encoder:end \*\//)[1]}\nreturn Deflate;\n})`)();
const utf8 = (s) => new TextEncoder().encode(s);
const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([,.:;)])/g, "$1").replace(/\( /g, "(");
const nf = (n) => n.toLocaleString("en");
/** 16 KB of English documentation (a frozen copy of this repository's README), for the join's big-block numbers. */
const ENGLISH = fs.readFileSync(path.join(ROOT, "tests/support/deflate-english-16k.txt"), "utf8").replace(/\n$/, "");
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Bits to describe a code with DEFLATE's method (runs of lengths, then a code for the run symbols), given its counts' widths. */
function describe(lengths, countBits) {
  const rle = [];
  for (let i = 0; i < lengths.length;) {
    const v = lengths[i];
    let run = 1;
    while (i + run < lengths.length && lengths[i + run] === v) run++;
    i += run;
    if (v === 0) {
      while (run >= 11) { const n = Math.min(138, run); rle.push({ sym: 18, extra: 7 }); run -= n; }
      if (run >= 3) { rle.push({ sym: 17, extra: 3 }); run = 0; }
    } else {
      rle.push({ sym: v, extra: 0 });
      run--;
      while (run >= 3) { const n = Math.min(6, run); rle.push({ sym: 16, extra: 2 }); run -= n; }
    }
    while (run-- > 0) rle.push({ sym: v, extra: 0 });
  }
  const freq = new Array(19).fill(0);
  for (const r of rle) freq[r.sym]++;
  const cl = Deflate.codeLengths(freq, 7);
  let hclen = 19;
  while (hclen > 4 && !cl[CL_ORDER[hclen - 1]]) hclen--;
  return countBits + hclen * 3 + rle.reduce((s, r) => s + cl[r.sym] + r.extra, 0);
}
const trim = (ls) => { let n = ls.length; while (n > 1 && !ls[n - 1]) n--; return ls.slice(0, n); };

/** A block's cost two ways: DEFLATE's alphabets, and the obvious one with a symbol for every value. */
function bothAlphabets(text) {
  const r = Deflate.encode(utf8(text));
  // DEFLATE's: the method above must reproduce the encoder's own header, or the comparison means nothing.
  const lit = new Array(286).fill(0), dist = new Array(30).fill(0);
  for (const t of r.tokens) { if (t.lit !== undefined) lit[t.lit]++; else { lit[Deflate.lengthSymbol(t.len).sym]++; dist[Deflate.distanceCode(t.dist).code]++; } }
  lit[256]++;
  const litL = Deflate.codeLengths(lit, 15), distL = Deflate.codeLengths(dist, 15);
  const hlit = Math.max(257, trim(litL).length), hdist = Math.max(1, trim(distL).length);
  assert.equal(describe(litL.slice(0, hlit).concat(distL.slice(0, hdist)), 14), r.headerBits, "the description method matches the encoder's header");
  // The obvious alphabet: bytes 0–255, end 256, lengths 3–258 one each; distances 1–32,768 one each.
  const olit = new Array(513).fill(0), odist = new Array(32768).fill(0);
  for (const t of r.tokens) { if (t.lit !== undefined) olit[t.lit]++; else { olit[257 + t.len - 3]++; odist[t.dist - 1]++; } }
  olit[256]++;
  const oL = Deflate.codeLengths(olit, 15), oD = Deflate.codeLengths(odist, 15);
  const oData = olit.reduce((s, n, i) => s + n * oL[i], 0) + odist.reduce((s, n, i) => s + n * oD[i], 0);
  const oHeader = describe(trim(oL).concat(trim(oD)), 10 + 15 + 4); // counts wide enough for 513 and 32,768 symbols
  const refs = r.tokens.filter((t) => t.lit === undefined);
  const byDist = new Map();
  for (const t of refs) byDist.set(t.dist, (byDist.get(t.dist) || 0) + 1);
  return { r, refs, byDist, oD, deflateTotal: r.bits.dynamic, obviousTotal: 3 + oHeader + oData, oHeader };
}

test("the join: exact distances barely repeat, and naming them costs more than it saves", () => {
  const prose = plain(PART1.match(/<h2 id="joining">[\s\S]*?<bh-playground/)[0]);
  const p = bothAlphabets(PARAGRAPH);
  const once = [...p.byDist.values()].filter((n) => n === 1).length;
  assert.ok(prose.includes(`this page's encoder finds ${p.refs.length} copies at ${p.byDist.size} different distances, and ${once} of those distances turn up exactly once`));
  const byLen = (n) => p.refs.filter((t) => t.len === n).length;
  assert.ok(prose.includes(`length 3 appears ${byLen(3)} times, length 5 nine times`) && byLen(5) === 9);
  const codeBits = [...new Set(p.oD.filter(Boolean))].sort().join(" or ");
  assert.equal(codeBits, "4 or 5");
  assert.ok(prose.includes(`${p.byDist.size} distances used once each still get 4- or 5-bit codes`.replace(`${p.byDist.size} distances used once each`, "29 distances used once each")));
  assert.ok(prose.includes(`describing the obvious code takes ${p.oHeader} bits, against ${p.r.headerBits} for DEFLATE's`));
  assert.ok(prose.includes(`the block comes out ${Math.round((p.obviousTotal / p.deflateTotal - 1) * 100)}% larger`));

  const e = bothAlphabets(ENGLISH);
  assert.equal(utf8(ENGLISH).length, 15879); // about 16 KB
  assert.ok(prose.includes(`at ${nf(e.byDist.size)} different distances, the description takes ${nf(e.oHeader)} bits against ${e.r.headerBits}, and the block comes out ${Math.round((e.obviousTotal / e.deflateTotal - 1) * 100)}% larger`));
  // How far back is skewed; the exact distance within a range is not.
  const perValue = (lo, hi) => e.refs.filter((t) => t.dist >= lo && t.dist <= hi).length / (hi - lo + 1);
  assert.equal(Math.round(perValue(9, 96)), 3);
  assert.equal(Math.round(perValue(4097, 6144) * 10) / 10, 0.1);
  assert.ok(prose.includes("about 3 copies per distance value within 100 bytes back, and about 0.1 per value at 4,000 to 6,000 bytes back"));
});

test("back to the question: every one of the 103 bits", () => {
  const r = Deflate.encode(utf8(EXAMPLE)), tr = trace(Buffer.from(r.streams.fixed));
  const bits = (kinds, from, to) => tr.fields.slice(from, to).filter((f) => kinds.includes(f.kind)).reduce((s, f) => s + f.bits.length + (f.extraBits || "").length, 0);
  // Fields: bfinal, btype, 7 literals, (4,7) as length + distance, the space, (23,12), end of block.
  const kinds = tr.fields.map((f) => f.kind).join(" ");
  assert.equal(kinds, "bfinal btype literal literal literal literal literal literal literal length distance literal length distance end");
  const rows = [
    ["header: last-block bit and block type", bits(["bfinal", "btype"], 0, 2), 0],
    ["7 literals, abracad", bits(["literal"], 2, 9), 56],
    ["(4, 7), a copy of abra", bits(["length", "distance"], 9, 11), 32],
    ["the space, a literal", bits(["literal"], 11, 12), 8],
    ["(23, 12), a copy of 23 bytes", bits(["length", "distance"], 12, 14), 184],
    ["end of block", bits(["end"], 14, 15), 0],
  ];
  const table = plain(PART1.match(/<div class="table-wrap" id="answer-bits"[\s\S]*?<\/table>/)[0]);
  for (const [label, n, raw] of rows) assert.ok(table.includes(`${label} ${n} ${raw}`), `${label}: ${n} bits for ${raw}`);
  assert.equal(rows.reduce((s, x) => s + x[1], 0), 103);
  assert.equal(rows.reduce((s, x) => s + x[2], 0), EXAMPLE.length * 8);
  assert.ok(table.includes("total 103 280"));
  const prose = plain(PART1.match(/<div class="table-wrap" id="answer-bits"[\s\S]*?<h2 id="try-it">/)[0]);
  assert.ok(prose.includes(`two copies stand for 27 of the 35 bytes, in ${rows[2][1] + rows[4][1]} bits`));
  const saved = (r.bits.fixed - 3) - (r.bits.dynamic - 3 - r.headerBits);
  assert.ok(prose.includes(`would save ${saved} bits on the data but cost ${r.headerBits} bits to describe`));
});

test("part 2 states the dynamic block's result before its walk", () => {
  const r = Deflate.encode(utf8(EXAMPLE));
  const intro = plain(PART2.match(/<h2 id="dynamic-block">[\s\S]*?<div class="table-wrap wide" id="dynamic-levels"/)[0]);
  const saved = (r.bits.fixed - 3) - (r.bits.dynamic - 3 - r.headerBits);
  assert.ok(intro.includes(`the dynamic block is ${r.bits.dynamic} bits, against the fixed block's ${r.bits.fixed}. Describing the codes takes ${r.headerBits} bits, and the codes save only ${saved} on the data`));
});
