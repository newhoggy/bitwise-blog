// Diffing two versions of a page: what changed in its article, block by block.
//
// A page's content is the direct children of <article class="bh-article"> (the page contract), and
// headings, figures and other shareable blocks carry permanent ids. So two versions are compared in
// two levels:
//
//   1. blocks are aligned: by id, else by identical text, then similar neighbours are paired, and a
//      block that reappears elsewhere is a move, not a removal and an addition;
//   2. inside a changed block the prose is diffed word by word and written into the NEW version's
//      markup as <ins>/<del>, so the result is always well-formed. A picture (an inline <svg>, a
//      <bh-sequence>) is never word-diffed: the old and new figures are kept whole for a
//      before/after comparison, with the parts that differ marked `data-change`.
//
// Three things read the result (see contracts/page-diff.md):
//   - `npm run diff` writes a standalone diff page (renderDiffPage);
//   - CI lists the changed sections of a pull request (summaryMarkdown);
//   - the Review panel shows "changes since this comment" from a data file (diffData).
//
// Pure and dependency-free (publish.mts imports it, and the package job installs nothing). Regex-based,
// like the rest of the tooling: fine for the pages we author, not a general HTML parser.

import { VOID_TAGS, decodeEntities } from "./html-tree.mts";
import { withoutHeroMeta } from "./hero-meta.mts";

// ---- Tokens ---------------------------------------------------------------------------------

export type TokKind = "open" | "close" | "void" | "text" | "raw";

/** One piece of HTML source. `raw` is a whole <script>, <style> or <template> element. */
export interface Tok {
  kind: TokKind;
  /** Lower-case tag name ("" for text). */
  name: string;
  /** The name as written: SVG has camelCase elements (linearGradient, clipPath). */
  tag: string;
  /** Raw attribute text of a start tag, without a self-closing slash. */
  attrs: string;
  src: string;
  /** Offset in the tokenized string. */
  at: number;
  selfClose: boolean;
  /** Name of the enclosing element ("" at the top of what was structured). */
  parent: string;
  /** Inside (or is) a picture or code that is compared whole: svg, math, canvas, bh-sequence, pre.mermaid, raw. */
  opaque: boolean;
  svg: boolean;
  pre: boolean;
}

const TOKEN_RE = /<!--[\s\S]*?-->|<(script|style|template)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>[\s\S]*?<\/\1\s*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;

/** Split HTML into tags, text and raw elements. Comments are dropped. */
export function tokenize(html: string): Tok[] {
  const toks: Tok[] = [];
  const push = (kind: TokKind, tag: string, attrs: string, src: string, at: number, selfClose = false) =>
    toks.push({ kind, name: tag.toLowerCase(), tag, attrs, src, at, selfClose, parent: "", opaque: false, svg: false, pre: false });
  let last = 0;
  for (const m of html.matchAll(TOKEN_RE)) {
    if (m.index > last) push("text", "", "", html.slice(last, m.index), last);
    last = m.index + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) push("raw", m[1], m[2] ?? "", m[0], m.index);
    else if (m[3]) push("close", m[3], "", m[0], m.index);
    else {
      const attrs = m[5] ?? "", selfClose = /\/\s*$/.test(attrs);
      push(selfClose || VOID_TAGS.has(m[4].toLowerCase()) ? "void" : "open", m[4], selfClose ? attrs.replace(/\/\s*$/, "") : attrs, m[0], m.index, selfClose);
    }
  }
  if (last < html.length) push("text", "", "", html.slice(last), last);
  return toks;
}

// ---- Attributes -----------------------------------------------------------------------------

type Attr = [name: string, value: string | null];

/** A start tag's attributes in order. Values are the source text between the quotes (entities kept). */
export function parseAttrs(attrs: string): Attr[] {
  return [...attrs.matchAll(/([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)].map((m) => [m[1], m[2] ?? m[3] ?? m[4] ?? null]);
}
const buildAttrs = (list: Attr[]) => list.map(([k, v]) => (v === null ? ` ${k}` : v.includes('"') ? ` ${k}='${v}'` : ` ${k}="${v}"`)).join("");
const getAttr = (attrs: string, name: string): string => parseAttrs(attrs).find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
const hasAttr = (attrs: string, name: string): boolean => parseAttrs(attrs).some(([k]) => k.toLowerCase() === name);
const classes = (attrs: string) => getAttr(attrs, "class").split(/\s+/).filter(Boolean);
const startTag = (name: string, list: Attr[], selfClose: boolean) => `<${name}${buildAttrs(list)}${selfClose ? "/" : ""}>`;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// ---- Blocks ---------------------------------------------------------------------------------

/** A direct child of the article. */
export interface Block {
  /** Position among the article's blocks. */
  index: number;
  tag: string;
  id: string;
  toks: Tok[];
  html: string;
  /** Its prose: the text outside pictures and scripts, entities decoded, whitespace collapsed. */
  text: string;
  /** The whole block with insignificant whitespace removed: equal means unchanged. */
  norm: string;
  /** The pictures and scripts in it, normalised: unequal means the visual changed. */
  opaqueSrc: string;
  /** `text` without any whitespace: how the source is wrapped and indented is not a difference. */
  squash: string;
  /** What two versions of the same block share: the id, else the text. */
  key: string;
  /** Holds a custom element, whose script reads its content: never rewritten in place. */
  custom: boolean;
}

// An element that ends a <p> left open before it, and the elements that end one another.
const P_CLOSERS = new Set("address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr main menu nav ol p pre section table ul li dt dd".split(" "));
const SECTION_END = ["tr", "td", "th", "thead", "tbody", "tfoot", "caption", "colgroup"];
const AUTO_CLOSE: Record<string, string[]> = {
  li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], option: ["option"],
  tr: ["tr", "td", "th", "caption", "colgroup"], td: ["td", "th"], th: ["td", "th"],
  thead: SECTION_END, tbody: SECTION_END, tfoot: SECTION_END, caption: SECTION_END, colgroup: SECTION_END,
};
const OPAQUE = new Set(["svg", "math", "canvas", "bh-sequence"]);

interface Frame { name: string; opaque: boolean; svg: boolean; pre: boolean }

/** Give every token its context and split the tokens into top-level elements. Unmatched end tags are dropped. */
export function topLevel(toks: Tok[]): Tok[][] {
  const stack: Frame[] = [], out: Tok[][] = [];
  let cur: Tok[] = [];
  const flush = () => { if (cur.some((t) => t.kind !== "text" || t.src.trim())) out.push(cur); cur = []; };
  const inherit = (t: Tok, f: Frame | undefined) => { t.parent = f ? f.name : ""; t.opaque = !!f && f.opaque; t.svg = !!f && f.svg; t.pre = !!f && f.pre; };
  for (const t of toks) {
    if (t.kind === "open" || t.kind === "void") {
      if (!stack.at(-1)?.svg) {
        while (stack.length && ((stack.at(-1)!.name === "p" && P_CLOSERS.has(t.name)) || AUTO_CLOSE[t.name]?.includes(stack.at(-1)!.name))) stack.pop();
      }
      if (!stack.length) flush();
      inherit(t, stack.at(-1));
      t.svg ||= t.name === "svg";
      t.opaque ||= OPAQUE.has(t.name) || (t.name === "pre" && classes(t.attrs).includes("mermaid"));
      cur.push(t);
      if (t.kind === "open") stack.push({ name: t.name, opaque: t.opaque, svg: t.svg, pre: t.pre || t.name === "pre" });
      else if (!stack.length) flush();
    } else if (t.kind === "close") {
      const i = stack.findLastIndex((f) => f.name === t.name);
      if (i < 0) continue;
      const frame = stack[i];
      stack.length = i;
      inherit(t, stack.at(-1));
      t.opaque ||= frame.opaque;
      t.svg ||= frame.svg;
      cur.push(t);
      if (!stack.length) flush();
    } else {
      inherit(t, stack.at(-1));
      if (t.kind === "raw") t.opaque = true;
      if (!stack.length && t.kind === "text" && !t.src.trim()) continue; // whitespace between blocks
      cur.push(t);
      if (!stack.length) flush();
    }
  }
  flush();
  return out;
}

const isTag = (t: Tok) => t.kind === "open" || t.kind === "void";
const normTok = (t: Tok) => (t.kind === "text" ? (t.pre ? t.src : t.src.replace(/\s+/g, " ")) : t.src.replace(/\s+/g, " "));
const normToks = (toks: Tok[]) => toks.map(normTok).join("").replace(/>\s+</g, "><").trim();
const proseText = (toks: Tok[]) => collapse(decodeEntities(toks.filter((t) => t.kind === "text" && !t.opaque).map((t) => t.src).join("")));

function makeBlock(toks: Tok[], index: number): Block {
  const first = toks.find((t) => t.kind !== "text");
  const tag = first ? first.name : "#text";
  const id = first && isTag(first) ? getAttr(first.attrs, "id") : "";
  const text = proseText(toks);
  const norm = normToks(toks), squash = text.replace(/\s+/g, "");
  return {
    index, tag, id, toks, text, norm, squash,
    html: toks.map((t) => t.src).join("").trim(),
    opaqueSrc: normToks(toks.filter((t) => t.opaque)),
    key: id ? `#${id}` : squash ? `t:${tag}:${squash}` : `h:${norm}`,
    custom: toks.some((t) => isTag(t) && t.name.includes("-") && !t.svg),
  };
}

/** A page split around its article: the HTML before the article's content, the blocks, and the HTML after. Null when the page has no article (a sealed page). */
export function splitPage(html: string): { before: string; after: string; blocks: Block[] } | null {
  const toks = tokenize(html);
  const open = toks.findIndex((t) => t.kind === "open" && t.name === "article" && classes(t.attrs).includes("bh-article"));
  if (open < 0) return null;
  let depth = 0, close = -1;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].name !== "article") continue;
    if (toks[i].kind === "open") depth++;
    else if (toks[i].kind === "close" && --depth === 0) { close = i; break; }
  }
  if (close < 0) return null;
  return {
    before: html.slice(0, toks[open].at + toks[open].src.length),
    after: html.slice(toks[close].at),
    blocks: topLevel(toks.slice(open + 1, close)).map(makeBlock),
  };
}

// ---- Sequence diff (Myers) ------------------------------------------------------------------

export interface Op { op: "eq" | "del" | "ins"; a: number; b: number }

function myers(a: string[], b: string[], maxD: number): Op[] | null {
  const N = a.length, M = b.length, max = Math.min(N + M, maxD), off = max + 1;
  const V = new Int32Array(2 * max + 3), trace: Int32Array[] = [];
  let found = -1;
  search: for (let d = 0; d <= max; d++) {
    trace.push(V.slice(off - d - 1, off + d + 2)); // the state before round d, for k in [-d-1, d+1]
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= N && y >= M) { found = d; break search; }
    }
  }
  if (found < 0) return null;
  const ops: Op[] = [];
  let x = N, y = M;
  for (let d = found; d > 0; d--) {
    const v = trace[d], o = d + 1, k = x - y;
    const prevK = k === -d || (k !== d && v[o + k - 1] < v[o + k + 1]) ? k + 1 : k - 1;
    const prevX = v[o + prevK], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.push({ op: "eq", a: x, b: y }); }
    if (x === prevX) { y--; ops.push({ op: "ins", a: -1, b: y }); } else { x--; ops.push({ op: "del", a: x, b: -1 }); }
  }
  while (x > 0 && y > 0) { x--; y--; ops.push({ op: "eq", a: x, b: y }); }
  return ops.reverse();
}

/** The shortest edit script from `a` to `b`. Past `maxD` edits (two unrelated texts) it gives up and replaces the differing middle whole. */
export function diffSeq(a: string[], b: string[], maxD = 1500): Op[] {
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ op: "eq", a: i, b: i });
  const mid = myers(a.slice(start, endA), b.slice(start, endB), maxD);
  if (mid) for (const o of mid) ops.push({ op: o.op, a: o.a < 0 ? -1 : o.a + start, b: o.b < 0 ? -1 : o.b + start });
  else {
    for (let i = start; i < endA; i++) ops.push({ op: "del", a: i, b: -1 });
    for (let j = start; j < endB; j++) ops.push({ op: "ins", a: -1, b: j });
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push({ op: "eq", a: i, b: j });
  return ops;
}

// ---- Aligning blocks ------------------------------------------------------------------------

export type Status = "same" | "added" | "removed" | "changed" | "moved";

/** One block of the old or new version, and what became of it. */
export interface Entry {
  /** 1, 2, 3… among the differences; 0 for an unchanged block. */
  n: number;
  status: Status;
  old: Block | null;
  new: Block | null;
  /** The new block's index, or for a removed block the index of the new block it sat before. */
  at: number;
  /** The id and text of the heading this falls under in the new version ("" before the first heading). */
  section: string;
  sectionTitle: string;
  label: string;
  /** What differs between `old` and `new`: the prose, a picture, or only the markup. */
  text: boolean;
  visual: boolean;
  markup: boolean;
  /** On a removed block that reappears elsewhere: the `n` of its new place. */
  movedTo: number;
  /** On a moved block: the heading it used to be under. */
  movedFrom: string;
}

export interface DiffStats { changed: number; added: number; removed: number; moved: number }

export interface PageDiff {
  entries: Entry[];
  stats: DiffStats;
  /** Set when the <title> or the description differs. */
  title: { old: string; new: string } | null;
  description: { old: string; new: string } | null;
  /** Each version's page CSS (the <style> elements of its head): what a copy scoped by id is drawn with. */
  oldStyle: string;
  newStyle: string;
  /** The new page around its article. */
  before: string;
  after: string;
  blocks: number;
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];

/** How alike two blocks are, 0 to 1 (see `dice`). Two pictures of the same kind are worth comparing. */
function similarity(a: Block, b: Block): number {
  if (a.tag !== b.tag) return 0;
  return !words(a.text).length && !words(b.text).length ? 0.5 : dice(a.text, b.text);
}
const PAIR_AT = 0.5;
const MOVE_TEXT = 40;
const MOVE_AT = 0.8;

const isHeading = (b: Block) => /^h[2-4]$/.test(b.tag);
function blockLabel(b: Block): string {
  if (b.text) return b.text.length > 64 ? b.text.slice(0, 61).trimEnd() + "…" : b.text;
  return b.id ? `${b.tag} #${b.id}` : b.tag;
}

function alignBlocks(oldB: Block[], newB: Block[]): Entry[] {
  const entry = (status: Status, o: Block | null, n: Block | null): Entry =>
    ({ n: 0, status, old: o, new: n, at: n ? n.index : 0, section: "", sectionTitle: "", label: blockLabel((n ?? o)!), text: false, visual: false, markup: false, movedTo: 0, movedFrom: "" });
  const entries: Entry[] = [];
  let dels: Block[] = [], ins: Block[] = [];
  const closeGap = () => {
    let oi = 0;
    for (const nb of ins) {
      let best = -1, bestSim = PAIR_AT;
      for (let j = oi; j < dels.length; j++) { const s = similarity(dels[j], nb); if (s > bestSim || (s === bestSim && best < 0)) { best = j; bestSim = s; } }
      if (best < 0) { entries.push(entry("added", null, nb)); continue; }
      for (; oi < best; oi++) entries.push(entry("removed", dels[oi], null));
      entries.push(entry("changed", dels[best], nb));
      oi = best + 1;
    }
    for (; oi < dels.length; oi++) entries.push(entry("removed", dels[oi], null));
    dels = []; ins = [];
  };
  for (const op of diffSeq(oldB.map((b) => b.key), newB.map((b) => b.key))) {
    if (op.op === "del") dels.push(oldB[op.a]);
    else if (op.op === "ins") ins.push(newB[op.b]);
    else { closeGap(); entries.push(entry(oldB[op.a].norm === newB[op.b].norm ? "same" : "changed", oldB[op.a], newB[op.b])); }
  }
  closeGap();

  // A removed block whose id (or whole text) turns up among the added ones has moved.
  const movable = (b: Block) => b.id !== "" || b.text.length >= MOVE_TEXT;
  const added = new Map<string, Entry[]>();
  for (const e of entries) if (e.status === "added" && movable(e.new!)) added.set(e.new!.key, [...(added.get(e.new!.key) ?? []), e]);
  const moves: [from: Entry, to: Entry][] = [];
  for (const e of entries) {
    if (e.status !== "removed" || !movable(e.old!)) continue;
    const to = added.get(e.old!.key)?.shift();
    if (to) { to.status = "moved"; to.old = e.old; moves.push([e, to]); }
  }
  // …and so has one that was reworded on the way: no id, but nearly the same words.
  for (const e of entries) {
    if (e.status !== "removed" || e.old!.text.length < MOVE_TEXT || moves.some(([from]) => from === e)) continue;
    let to: Entry | null = null, best = MOVE_AT;
    for (const cand of entries) {
      if (cand.status !== "added") continue;
      const s = similarity(e.old!, cand.new!);
      if (s > best) { best = s; to = cand; }
    }
    if (to) { to.status = "moved"; to.old = e.old; moves.push([e, to]); }
  }

  // Sections follow the new version; a removed block belongs where it used to sit.
  let section = "", sectionTitle = "";
  const oldSection = new Map<Block, string>();
  { let title = ""; for (const b of oldB) { if (isHeading(b)) title = b.text; oldSection.set(b, title); } }
  for (const e of entries) {
    if (e.new && isHeading(e.new)) { section = e.new.id; sectionTitle = e.new.text; }
    e.section = section;
    e.sectionTitle = sectionTitle;
    if (e.old && e.new && e.status !== "same") {
      e.text = e.old.squash !== e.new.squash;
      e.visual = e.old.opaqueSrc !== e.new.opaqueSrc;
      e.markup = !e.text && !e.visual && e.old.norm !== e.new.norm;
    }
  }
  let next = newB.length;
  for (let i = entries.length - 1; i >= 0; i--) { if (entries[i].new) next = entries[i].new!.index; else entries[i].at = next; }
  let n = 0;
  for (const e of entries) if (e.status !== "same") e.n = ++n;
  for (const [from, to] of moves) { from.movedTo = to.n; to.movedFrom = oldSection.get(from.old!) ?? ""; }
  return entries;
}

const headValue = (html: string, re: RegExp) => collapse(decodeEntities((html.replace(/<!--[\s\S]*?-->/g, "").match(re) ?? [])[1] ?? ""));
/** A page's own CSS: the content of every <style> in its head. */
export function pageStyle(html: string): string {
  const head = html.replace(/<!--[\s\S]*?-->/g, "").split(/<body\b/i)[0];
  return [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1].trim()).filter(Boolean).join("\n");
}
const pageTitle = (html: string) => headValue(html, /<title>([^<]*)<\/title>/i);
const pageDescription = (html: string) => headValue(html, /<meta\s+name="description"\s+content="([^"]*)"/i);

/**
 * Compare two versions of a page. Null when either has no article to compare (a sealed page).
 * The hero's generated list and the "Superseded" banner are left out of both (scripts/hero-meta.mts):
 * they restate the page's metas, a version from before they were generated has none, and the reading
 * time would mark the hero changed on most edits. A diff page has them as bh.js builds them, and the
 * Review panel's data counts the live page's blocks without the banner, as diff.js does.
 */
export function diffPages(oldHtml: string, newHtml: string): PageDiff | null {
  oldHtml = withoutHeroMeta(oldHtml);
  newHtml = withoutHeroMeta(newHtml);
  const o = splitPage(oldHtml), n = splitPage(newHtml);
  if (!o || !n) return null;
  const entries = alignBlocks(o.blocks, n.blocks);
  const stats: DiffStats = { changed: 0, added: 0, removed: 0, moved: 0 };
  for (const e of entries) if (e.status !== "same" && !e.movedTo) stats[e.status]++;
  const pair = (a: string, b: string) => (a === b ? null : { old: a, new: b });
  return { entries, stats, title: pair(pageTitle(oldHtml), pageTitle(newHtml)), description: pair(pageDescription(oldHtml), pageDescription(newHtml)), oldStyle: pageStyle(oldHtml), newStyle: pageStyle(newHtml), before: n.before, after: n.after, blocks: n.blocks.length };
}

/** "2 changed, 1 added", or "no changes". */
export function statsLine(stats: DiffStats): string {
  const parts = (["changed", "added", "removed", "moved"] as const).filter((k) => stats[k]).map((k) => `${stats[k]} ${k}`);
  return parts.length ? parts.join(", ") : "no changes";
}

// ---- Word diff, written into the new markup --------------------------------------------------

// Text directly inside these is only whitespace between children: an <ins> or <del> there is invalid
// (and inside a table the parser would move it out of the table).
const NO_PHRASING = new Set(["ul", "ol", "table", "thead", "tbody", "tfoot", "tr", "dl", "colgroup", "select", "optgroup", "option", "textarea", "bh-tabs", "bh-stepper", "bh-versions", "bh-codewalk"]);
const WORD_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]\w*);|\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const isProse = (t: Tok) => t.kind === "text" && !t.opaque && !NO_PHRASING.has(t.parent);

interface Words { words: string[]; keys: string[]; node: number[]; ranges: Map<Tok, [from: number, to: number]> }

function proseWords(toks: Tok[]): Words {
  const out: Words = { words: [], keys: [], node: [], ranges: new Map() };
  for (const t of toks) {
    if (!isProse(t)) continue;
    const from = out.words.length;
    for (const w of t.src.match(WORD_RE) ?? []) { out.words.push(w); out.keys.push(!t.pre && /^\s+$/.test(w) ? " " : w); out.node.push(out.ranges.size); }
    out.ranges.set(t, [from, out.words.length]);
  }
  return out;
}

const isWeak = (key: string) => /^\s+$/.test(key) || /^[^\p{L}\p{N}_&]$/u.test(key);

/**
 * Join changes that a few unchanged words separate. A rewritten sentence shares "the", "of" and its
 * commas with the old one, and a diff that keeps every one of them alternates word by word and cannot
 * be read. An unchanged run is folded into the changes around it when it is only spaces and punctuation,
 * or at most half as long as the change on each side of it (a stricter form of the rule diff-match-patch
 * calls semantic cleanup: "brown fox jumps" → "red fox leaps" keeps its fox).
 */
function mergeShortRuns(ops: Op[], aKeys: string[], bKeys: string[]): Op[] {
  interface Run { eq: boolean; ops: Op[]; del: number; ins: number; size: number; weak: boolean }
  const size = (key: string) => key.trim().length;
  let runs: Run[] = [];
  for (const o of ops) {
    const eq = o.op === "eq";
    let run = runs.at(-1);
    if (!run || run.eq !== eq) { run = { eq, ops: [], del: 0, ins: 0, size: 0, weak: true }; runs.push(run); }
    run.ops.push(o);
    if (o.op === "del") run.del += size(aKeys[o.a]);
    else if (o.op === "ins") run.ins += size(bKeys[o.b]);
    else { run.size += size(bKeys[o.b]); run.weak &&= isWeak(bKeys[o.b]); }
  }
  for (let again = true; again;) {
    again = false;
    for (let i = 1; i < runs.length - 1; i++) {
      const prev = runs[i - 1], run = runs[i], next = runs[i + 1];
      if (!run.eq || prev.eq || next.eq) continue;
      const short = run.size * 2 <= Math.max(prev.del, prev.ins) && run.size * 2 <= Math.max(next.del, next.ins);
      if (!short && !(run.weak && run.ops.length <= 3)) continue;
      const merged: Run = { eq: false, ops: [...prev.ops, ...run.ops.map((o): Op => ({ op: "del", a: o.a, b: -1 })), ...run.ops.map((o): Op => ({ op: "ins", a: -1, b: o.b })), ...next.ops], del: prev.del + run.size + next.del, ins: prev.ins + run.size + next.ins, size: 0, weak: true };
      runs = [...runs.slice(0, i - 1), merged, ...runs.slice(i + 2)];
      again = true;
      break;
    }
  }
  // Within a change, everything removed comes before everything added.
  return runs.flatMap((r) => (r.eq ? r.ops : [...r.ops.filter((o) => o.op === "del"), ...r.ops.filter((o) => o.op === "ins")]));
}

/** How a copy of a block is written: in place (ids kept) or as an inert copy beside the live block. */
interface Emit {
  inert: boolean;
  prefix: string;
  marks?: Map<Tok, string>;
  /** Keep every id as written: for a copy that will live in a shadow tree of its own, where the version's page CSS can find it by id. */
  keepIds?: boolean;
}

// Attributes that tie an element to another by id, or to a script: an inert copy keeps none of them.
const INERT_DROP = new Set(["for", "data-ref", "data-linkable", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "name", "data-bind", "data-expr", "data-label", "autofocus", "tabindex", "contenteditable"]);
const KEEP_LIVE = new Set(["bh-sequence"]);

const inertName = (t: Tok) => (t.svg || t.opaque ? t.tag : /^h[1-6]$/.test(t.name) ? "p" : t.name === "a" ? "span" : t.name.includes("-") && !KEEP_LIVE.has(t.name) ? "div" : t.tag);

function inertTag(t: Tok, emit: Emit, extra: Attr[] = []): string {
  const name = inertName(t), list: Attr[] = [], cls: string[] = [];
  if (name !== t.tag) {
    if (/^h[1-6]$/.test(t.name)) cls.push("bh-diff-h", `bh-diff-${t.name}`);
    else if (t.name === "a") cls.push("bh-diff-link");
    else list.push(["data-was", t.name]);
  }
  for (const [k, value] of parseAttrs(t.attrs)) {
    const key = k.toLowerCase();
    let v = value;
    if (key.startsWith("on") || INERT_DROP.has(key)) continue;
    if (key === "id") {
      if (emit.keepIds) { if (v) list.push(["id", v]); }
      else if (t.svg && t.name !== "svg" && v) list.push(["id", emit.prefix + v]);
      continue;
    }
    if (t.name === "a" && !t.svg && (key === "href" || key === "target" || key === "rel" || key === "download")) continue;
    // No width class (a copy sits in its mark), and no language: a highlighter would match the copy, run on it and
    // erase its <ins>/<del> (on a diff page the copies are there when bh.js loads Prism; #335).
    if (key === "class") { cls.unshift(...(v ?? "").split(/\s+/).filter((c) => c && !/^(?:wide|full|lang(?:uage)?-.*)$/.test(c))); continue; }
    if (t.svg && v && !emit.keepIds) {
      v = v.replace(/url\(\s*#/g, `url(#${emit.prefix}`);
      if ((key === "href" || key === "xlink:href") && v.startsWith("#")) v = `#${emit.prefix}${v.slice(1)}`;
    }
    list.push([k, v]);
  }
  if (cls.length) list.unshift(["class", cls.join(" ")]);
  if (["input", "button", "select", "textarea"].includes(t.name) && !list.some(([k]) => k === "disabled")) list.push(["disabled", null]);
  if (t.name === "details" && !list.some(([k]) => k === "open")) list.push(["open", null]);
  const change = emit.marks?.get(t);
  if (change && !list.some(([k]) => k === "data-change")) list.push(["data-change", change]);
  for (const a of extra) list.push(a);
  return startTag(name, list, t.selfClose);
}

/** One token of a copy. `changed` is true when the block holds <ins>/<del>, which a syntax highlighter would erase. */
function emitTok(t: Tok, emit: Emit, changed: boolean, extra: Attr[] = []): string {
  if (t.kind === "raw") return emit.inert ? "" : t.src;
  if (t.kind === "close") return emit.inert ? `</${inertName(t)}>` : t.src;
  if (t.kind === "text") return t.src;
  if (emit.inert) return inertTag(t, emit, extra);
  const strip = changed && (t.name === "code" || t.name === "pre") && /\blanguage-/.test(t.attrs);
  if (!strip && !extra.length) return t.src;
  const list = parseAttrs(t.attrs).map(([k, v]): Attr => (strip && k.toLowerCase() === "class" ? [k, (v ?? "").split(/\s+/).filter((c) => !c.startsWith("language-")).join(" ")] : [k, v]));
  return startTag(t.tag, [...list, ...extra], t.selfClose);
}

/** `toks` as HTML, with `extra` attributes on the block's own start tag. */
function emitBlock(toks: Tok[], emit: Emit, extra: Attr[] = []): string {
  const first = toks.find(isTag);
  return toks.map((t) => emitTok(t, emit, false, t === first ? extra : [])).join("").trim();
}

// ---- Rows and items: aligned before their words are compared ---------------------------------

const ITEM = new Set(["tr", "li", "dt", "dd"]);
const CELL = new Set(["td", "th"]);

/** A row, an item or a cell: the tokens [start, end), and the index of the token that opens its parent (-1 at the top). */
interface Seg {
  start: number;
  end: number;
  container: number;
  /** Whether its own end tag is written (and is then its last token). */
  closed: boolean;
}

/** The outermost elements named in `names` among toks[from, to), in order: the rows and items of a block, or the cells of one row. */
function segments(toks: Tok[], names: Set<string>, from = 0, to = toks.length): Seg[] {
  const out: Seg[] = [], stack: { name: string; at: number }[] = [];
  let open: Seg | null = null, base = 0;
  const shrink = (length: number, end: number, closed = false) => {
    stack.length = length;
    if (open && length <= base) { open.end = end; open.closed = closed; out.push(open); open = null; }
  };
  for (let i = from; i < to; i++) {
    const t = toks[i];
    if (isTag(t)) {
      if (!t.svg) {
        let n = stack.length;
        while (n && ((stack[n - 1].name === "p" && P_CLOSERS.has(t.name)) || AUTO_CLOSE[t.name]?.includes(stack[n - 1].name))) n--;
        if (n !== stack.length) shrink(n, i);
      }
      if (!open && names.has(t.name) && !t.opaque && t.kind === "open") { open = { start: i, end: to, container: stack.length ? stack.at(-1)!.at : -1, closed: false }; base = stack.length; }
      if (t.kind === "open") stack.push({ name: t.name, at: i });
    } else if (t.kind === "close") {
      const k = stack.findLastIndex((f) => f.name === t.name);
      if (k >= 0) shrink(k, open && k === base ? i + 1 : i, !!open && k === base); // its own end tag is part of it; an ancestor's is not
    }
  }
  if (open) out.push(open);
  return out;
}

/** Pair the items of two lists: equal keys first (in order), then the alike ones left between them. [-1, n] is new, [o, -1] is gone. */
function alignItems(oldKeys: string[], newKeys: string[], alike: (o: number, n: number) => number): [number, number][] {
  const out: [number, number][] = [];
  let dels: number[] = [], ins: number[] = [];
  const closeGap = () => {
    let oi = 0;
    for (const n of ins) {
      let best = -1, bestSim = PAIR_AT;
      // Only the next few candidates: a table rewritten row by row would otherwise cost rows squared.
      for (let j = oi; j < Math.min(dels.length, oi + PAIR_WINDOW); j++) { const sim = alike(dels[j], n); if (sim > bestSim || (sim === bestSim && best < 0)) { best = j; bestSim = sim; } }
      if (best < 0) { out.push([-1, n]); continue; }
      for (; oi < best; oi++) out.push([dels[oi], -1]);
      out.push([dels[best], n]);
      oi = best + 1;
    }
    for (; oi < dels.length; oi++) out.push([dels[oi], -1]);
    dels = []; ins = [];
  };
  for (const op of diffSeq(oldKeys, newKeys)) {
    if (op.op === "del") dels.push(op.a);
    else if (op.op === "ins") ins.push(op.b);
    else { closeGap(); out.push([op.a, op.b]); }
  }
  closeGap();
  return out;
}

const PAIR_WINDOW = 32;

/** How alike two texts are, 0 to 1: the share of words they have in common (Dice). */
const dice = (a: string, b: string): number => diceWords(words(a), words(b));
function diceWords(wa: string[], wb: string[]): number {
  if (!wa.length || !wb.length) return 0;
  const count = new Map<string, number>();
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) { const c = count.get(w) ?? 0; if (c > 0) { common++; count.set(w, c - 1); } }
  return (2 * common) / (wa.length + wb.length);
}

/**
 * The new block's markup with the prose differences marked <ins>/<del>. `count` is the number of marks.
 *
 * Rows and items (tr, li, dt, dd) are aligned before any words are compared, so a row that is gone
 * is shown as a row of its own, struck through, where it used to be, and a row that stayed is compared
 * only with itself, cell by cell when both versions have the same number of cells. Without that, the
 * words of a removed row would be reported as deleted from whichever neighbouring cell came next.
 */
export function inlineDiff(oldToks: Tok[], newToks: Tok[], emit: Emit = { inert: false, prefix: "" }, extra: Attr[] = []): { html: string; count: number } {
  const A = proseWords(oldToks), B = proseWords(newToks);
  const inserted = new Uint8Array(B.words.length);
  // Deleted words (indexes into A), by where they are written: before or after a new word, or around a new token.
  const before = new Map<number, number[]>(), after = new Map<number, number[]>();
  const tokBefore = new Map<Tok, string>(), tokAfter = new Map<Tok, string>();
  let count = 0, tail = "";
  const add = <K,>(map: Map<K, number[]>, key: K, a: number) => { if (!map.has(key)) map.set(key, []); map.get(key)!.push(a); };
  const append = (map: Map<Tok, string>, key: Tok, html: string) => map.set(key, (map.get(key) ?? "") + html);
  /** Deleted words as one <del>. Words from two text nodes (two cells, two items) were never one phrase: they are kept apart. */
  const del = (gone: number[] | undefined): string => {
    if (!gone?.length) return "";
    let text = "";
    gone.forEach((a, i) => {
      if (i && A.node[a] !== A.node[gone[i - 1]] && !/\s$/.test(text) && !/^\s/.test(A.words[a])) text += " ";
      text += A.words[a];
    });
    if (!text.trim()) return "";
    count++;
    return `<del>${text}</del>`;
  };
  const wordsIn = (W: Words, toks: Tok[], seg: Seg): number[] => {
    const out: number[] = [];
    for (let i = seg.start; i < seg.end; i++) { const r = W.ranges.get(toks[i]); if (r) for (let w = r[0]; w < r[1]; w++) out.push(w); }
    return out;
  };
  /** Compare two runs of words. `anchor` is where deletions go when the new side has no word to put them beside. */
  const compare = (aIdx: number[], bIdx: number[], anchor: { tok: Tok; side: "before" | "after" } | null) => {
    const ops = mergeShortRuns(diffSeq(aIdx.map((i) => A.keys[i]), bIdx.map((j) => B.keys[j]))
      .map((o): Op => ({ op: o.op, a: o.a < 0 ? -1 : aIdx[o.a], b: o.b < 0 ? -1 : bIdx[o.b] })), A.keys, B.keys);
    const orphans: number[] = [];
    let k = 0;
    for (const o of ops) {
      if (o.op !== "del") { if (o.op === "ins") inserted[o.b] = 1; k++; }
      else if (k < bIdx.length) add(before, bIdx[k], o.a);
      else if (bIdx.length) add(after, bIdx.at(-1)!, o.a);
      else orphans.push(o.a);
    }
    if (anchor) append(anchor.side === "before" ? tokBefore : tokAfter, anchor.tok, del(orphans)); else tail += del(orphans);
  };
  /** Where a deletion goes when its row, item or cell has no new word to put it beside: just inside the element, at its end if that is written. */
  type Anchor = { tok: Tok; side: "before" | "after" } | null;
  const inside = (toks: Tok[], sg: Seg): Anchor => (sg.closed ? { tok: toks[sg.end - 1], side: "before" } : { tok: toks[sg.start], side: "after" });
  /** The tokens between an element's tags. */
  const inner = (sg: Seg): [number, number] => [sg.start + 1, sg.closed ? sg.end - 1 : sg.end];

  // Words of different text nodes are kept apart, or "Outer" + "inner" would read as one word.
  const textOf = (W: Words, idx: number[]) => collapse(decodeEntities(idx.map((i, k) => (k && W.node[i] !== W.node[idx[k - 1]] ? " " : "") + W.words[i]).join("")));
  const gone = (sg: Seg): string => {
    const inert: Emit = { inert: true, prefix: `${emit.prefix}gone${sg.start}-` };
    let html = "";
    for (let i = sg.start; i < sg.end; i++) {
      const t = oldToks[i];
      if (isProse(t) && t.src.trim()) { count++; html += `<del>${t.src}</del>`; }
      else html += emitTok(t, inert, false, i === sg.start ? [["data-diff", "removed"]] : []);
    }
    return html;
  };

  /** Compare old tokens [oFrom, oTo) with new tokens [nFrom, nTo): their rows and items pairwise (and those items' own, in turn), and the words around them. */
  const region = (oFrom: number, oTo: number, nFrom: number, nTo: number, anchor: Anchor): void => {
    const aAll = wordsIn(A, oldToks, { start: oFrom, end: oTo, container: -1, closed: false }), bAll = wordsIn(B, newToks, { start: nFrom, end: nTo, container: -1, closed: false });
    const oSegs = segments(oldToks, ITEM, oFrom, oTo), nSegs = segments(newToks, ITEM, nFrom, nTo);
    if (!oSegs.length || !nSegs.length) { compare(aAll, bAll, anchor); return; }
    const oWords = oSegs.map((sg) => wordsIn(A, oldToks, sg)), nWords = nSegs.map((sg) => wordsIn(B, newToks, sg));
    const oText = oWords.map((idx) => textOf(A, idx)), nText = nWords.map((idx) => textOf(B, idx));
    const cellsOf = (toks: Tok[], sg: Seg) => (toks[sg.start].name === "tr" ? segments(toks, CELL, ...inner(sg)) : []);
    const oCells = oSegs.map((sg) => cellsOf(oldToks, sg)), nCells = nSegs.map((sg) => cellsOf(newToks, sg));
    // A row is recognised by its first cell (its name) even when every number in it changed.
    const oLead = oCells.map((cells) => (cells.length ? textOf(A, wordsIn(A, oldToks, cells[0])) : "")), nLead = nCells.map((cells) => (cells.length ? textOf(B, wordsIn(B, newToks, cells[0])) : ""));
    const oBag = oText.map(words), nBag = nText.map(words);
    const alike = (o: number, n: number) => {
      if (oldToks[oSegs[o].start].name !== newToks[nSegs[n].start].name) return 0;
      return oLead[o] && oLead[o] === nLead[n] ? 1 : diceWords(oBag[o], nBag[n]);
    };
    const key = (toks: Tok[], sg: Seg, text: string) => `${toks[sg.start].name}:${text.replace(/\s+/g, "")}`;
    const pairs = alignItems(oSegs.map((sg, i) => key(oldToks, sg, oText[i])), nSegs.map((sg, i) => key(newToks, sg, nText[i])), alike);
    const partner = new Map<number, number>();
    for (const [o, n] of pairs) if (o >= 0 && n >= 0) partner.set(o, n);

    // Everything outside the rows and items (a caption, a summary, a lead-in sentence) is one run of its own.
    const outside = (all: number[], lists: number[][]) => { const used = new Set(lists.flat()); return all.filter((w) => !used.has(w)); };
    compare(outside(aAll, oWords), outside(bAll, nWords), anchor);

    // Which new list an old one became: the one a surviving row of it is in now; failing that (every row
    // replaced), the next unclaimed new list of the same kind, in order.
    const kind = (toks: Tok[], container: number) => (container < 0 ? "" : toks[container].name);
    const became = new Map<number, number>();
    for (const [o, n] of partner) if (!became.has(oSegs[o].container)) became.set(oSegs[o].container, nSegs[n].container);
    const claimed = new Set(became.values());
    for (const sg of oSegs) {
      if (became.has(sg.container)) continue;
      const match = nSegs.find((ns) => !claimed.has(ns.container) && kind(newToks, ns.container) === kind(oldToks, sg.container) && newToks[ns.start].name === oldToks[sg.start].name);
      if (match) { became.set(sg.container, match.container); claimed.add(match.container); }
    }

    for (const [o, n] of pairs) {
      if (o < 0) compare([], nWords[n], null);
      else if (n >= 0) {
        const oc = oCells[o], nc = nCells[n];
        if (oc.length && oc.length === nc.length) oc.forEach((cell, i) => region(...inner(cell), ...inner(nc[i]), inside(newToks, nc[i])));
        // A row that gained or lost a cell is compared as one run of words. Nothing may be written
        // between its cells, so a deletion with no word beside it goes into the last cell.
        else if (newToks[nSegs[n].start].name === "tr") compare(oWords[o], nWords[n], nc.length ? inside(newToks, nc.at(-1)!) : null);
        else region(...inner(oSegs[o]), ...inner(nSegs[n]), inside(newToks, nSegs[n]));
      } else {
        // A removed row goes back where it was: after the nearest earlier row of its own list that is
        // still there, else before the nearest later one, else at the start of the list its own became.
        // With no such list (the whole list is gone), only its words can be reported: in the item that
        // held the list, or after the block.
        const same = (x: number) => oSegs[x].container === oSegs[o].container;
        let prev = o - 1, next = o + 1;
        while (prev >= 0 && same(prev) && !partner.has(prev)) prev--;
        while (next < oSegs.length && same(next) && !partner.has(next)) next++;
        const home = became.get(oSegs[o].container);
        const first = home === undefined ? undefined : nSegs.find((ns) => ns.container === home);
        if (prev >= 0 && same(prev)) append(tokAfter, newToks[nSegs[partner.get(prev)!].end - 1], gone(oSegs[o]));
        else if (next < oSegs.length && same(next)) append(tokBefore, newToks[nSegs[partner.get(next)!].start], gone(oSegs[o]));
        else if (first) append(tokBefore, newToks[first.start], gone(oSegs[o]));
        else compare(oWords[o], [], anchor);
      }
    }
  };
  region(0, oldToks.length, 0, newToks.length, null);

  const texts = new Map<Tok, string>();
  for (const t of newToks) {
    const range = B.ranges.get(t);
    if (!range) continue;
    let out = "", run = "";
    const flush = () => { if (run.trim()) { count++; out += `<ins>${run}</ins>`; } else out += run; run = ""; };
    for (let w = range[0]; w < range[1]; w++) {
      if (before.has(w)) { flush(); out += del(before.get(w)); }
      if (inserted[w]) run += B.words[w]; else { flush(); out += B.words[w]; }
      if (after.has(w)) { flush(); out += del(after.get(w)); }
    }
    flush();
    texts.set(t, out);
  }
  const first = newToks.find(isTag);
  // `changed` is known only now, so the marks are counted before any tag is written.
  const html = newToks.map((t) => (tokBefore.get(t) ?? "") + (texts.get(t) ?? emitTok(t, emit, count > 0, t === first ? extra : [])) + (tokAfter.get(t) ?? "")).join("").trim();
  // Nowhere to write a deletion (the new block has no prose): say it after the block.
  return { html: tail ? `${html}\n<p class="bh-diff-tail">${tail}</p>` : html, count };
}

// ---- Pictures: which parts changed -----------------------------------------------------------

function subtreeNorm(toks: Tok[], i: number): string {
  if (toks[i].kind !== "open") return normTok(toks[i]);
  let depth = 0, j = i;
  for (; j < toks.length; j++) {
    if (toks[j].kind === "open") depth++;
    else if (toks[j].kind === "close" && --depth === 0) break;
  }
  return normToks(toks.slice(i, j + 1));
}

/** Mark the `data-id` parts of two versions of a picture: removed (old only), added (new only), changed (both, different). A part the author already marked is left alone. */
export function changeMarks(oldToks: Tok[], newToks: Tok[]): Map<Tok, string> {
  const parts = (toks: Tok[]) => {
    const m = new Map<string, { tok: Tok; src: string }>();
    toks.forEach((t, i) => {
      if (!isTag(t) || !t.opaque) return;
      const id = getAttr(t.attrs, "data-id");
      if (id && !m.has(id)) m.set(id, { tok: t, src: subtreeNorm(toks, i).replace(/\sdata-change="[^"]*"/g, "") });
    });
    return m;
  };
  const marks = new Map<Tok, string>(), o = parts(oldToks), n = parts(newToks);
  if (!o.size || !n.size) return marks;
  for (const [id, part] of o) if (!n.has(id) && !hasAttr(part.tok.attrs, "data-change")) marks.set(part.tok, "removed");
  for (const [id, part] of n) {
    if (hasAttr(part.tok.attrs, "data-change")) continue;
    if (!o.has(id)) marks.set(part.tok, "added");
    else if (o.get(id)!.src !== part.src) marks.set(part.tok, "changed");
  }
  return marks;
}

// ---- Rendering one difference ----------------------------------------------------------------

const STATUS_LABEL: Record<Status, string> = { same: "", added: "Added", removed: "Removed", changed: "Changed", moved: "Moved" };
// The theme's badge tones (theme/components.css), whose contrast `check` already verifies.
const STATUS_TONE: Record<Status, string> = { same: "", added: "ok", removed: "danger", changed: "warn", moved: "info" };
const statusTag = (status: Status, label = STATUS_LABEL[status]) => `<span class="badge plain ${STATUS_TONE[status]} bh-diff-tag">${label}</span>`;
const isPicture = (b: Block) => b.tag === "figure" && b.toks.some((t) => isTag(t) && OPAQUE.has(t.name));

/** What differs, for the mark's label: "text", "figure", "markup". */
export function whatChanged(e: Entry): string[] {
  return [e.text ? "text" : "", e.visual ? "figure" : "", e.markup ? "markup" : ""].filter(Boolean);
}

/** Whether the word diff can replace the block where it stands: no script reads its content, and no picture changed. */
const inPlace = (e: Entry) => !!e.old && !!e.new && e.text && !e.visual && !e.new.custom;

/** Whether a version's page CSS styles this block by id (`#its-id …`): a copy without its ids would lose that. */
export function styledById(b: Block, style: string): boolean {
  if (!style) return false;
  return b.toks.some((t) => {
    const id = isTag(t) ? getAttr(t.attrs, "id") : "";
    return !!id && new RegExp(`#${id.replace(/[^\w-]/g, "\\$&")}(?![\\w-])`).test(style);
  });
}

/**
 * A copy that the browser moves into a shadow tree of its own (theme/modules/diff.js), where it keeps
 * its ids and is drawn with its own version's page CSS. `fallback`, the ordinary inert copy, is what
 * shows until then, and without script.
 */
const shadowed = (fallback: string, styled: string, version: "old" | "new") =>
  `<div class="bh-diff-shadow" data-style="${version}">${fallback}<template>${styled}</template></div>`;

/** What decides how the copies in a mark are written. */
export interface MarkOptions {
  /** Show the details expanded. */
  open: boolean;
  /** Include the word diff as an inert copy (the diff page leaves it out where the diff replaces the block itself). */
  copy: boolean;
  /** Each version's page CSS (see `styledById`). */
  oldStyle?: string;
  newStyle?: string;
}

/**
 * The mark that sits before a changed block: its status, and (in a <details>) what the old version
 * said. Every copy inside is inert: no ids (ids inside a picture are prefixed), no links, no scripts,
 * headings and custom elements turned into plain blocks. A block that its page's CSS styles by id
 * also carries a second copy with its ids kept, for a shadow tree (see `shadowed`).
 */
export function renderMark(e: Entry, { open, copy, oldStyle = "", newStyle = "" }: MarkOptions): string {
  const emit: Emit = { inert: true, prefix: `bh-d${e.n}-` };
  const kept: Emit = { inert: true, prefix: "", keepIds: true };
  const head = statusTag(e.status);
  const attrs = `class="bh-diff-mark" data-diff="${e.status}" id="bh-change-${e.n}"`;
  if (e.status === "added") return `<p ${attrs}>${head}</p>`;
  if (e.status === "removed" && e.movedTo) {
    return `<p ${attrs} data-moved>${statusTag("moved")} <span class="bh-diff-what">“${escapeHtml(e.label)}” was here: <a href="#bh-change-${e.movedTo}">see where it is now</a></span></p>`;
  }
  const oldNeeds = !!e.old && styledById(e.old, oldStyle), newNeeds = !!e.new && styledById(e.new, newStyle);
  const parts: string[] = [];
  let what = whatChanged(e).join(", ");
  if (e.status === "removed") {
    const plain = emitBlock(e.old!.toks, emit);
    parts.push(`<div class="bh-diff-old">${oldNeeds ? shadowed(plain, emitBlock(e.old!.toks, kept), "old") : plain}</div>`);
  } else {
    if (e.status === "moved") what = [e.movedFrom ? `from “${escapeHtml(e.movedFrom)}”` : "from elsewhere", what].filter(Boolean).join("; ");
    if (e.text && copy) {
      const plain = inlineDiff(e.old!.toks, e.new!.toks, emit).html;
      parts.push(`<div class="bh-diff-copy">${newNeeds ? shadowed(plain, inlineDiff(e.old!.toks, e.new!.toks, kept).html, "new") : plain}</div>`);
    }
    if (e.visual) {
      const marks = changeMarks(e.old!.toks, e.new!.toks);
      const pair = isPicture(e.old!) && isPicture(e.new!), styled = oldNeeds || newNeeds;
      // In a pair, a styled figure sits inside a plain one: <bh-versions> wants figures as its children.
      const label = (which: string): Attr[] => (pair && !styled ? [["data-label", which]] : []);
      const side = (b: Block, prefix: string, which: string, version: "old" | "new") => {
        const plain = emitBlock(b.toks, { ...emit, prefix: emit.prefix + prefix, marks }, label(which));
        if (!styled) return plain;
        const both = shadowed(plain, emitBlock(b.toks, { ...kept, marks }), version);
        return pair ? `<figure class="bh-diff-side" data-label="${which}">${both}</figure>` : both;
      };
      const before = side(e.old!, "a-", "Before", "old");
      if (pair) parts.push(`<bh-versions class="bh-diff-versions">\n${before}\n${side(e.new!, "b-", "After", "new")}\n</bh-versions>`);
      else parts.push(`<div class="bh-diff-old"><p class="bh-diff-caption">Before</p>${before}</div>`);
    }
  }
  const summary = `${head}${what ? ` <span class="bh-diff-what">${what}</span>` : ""}`;
  if (!parts.length) return `<p ${attrs}>${summary}</p>`;
  return `<details ${attrs}${open ? " open" : ""}>\n<summary>${summary}</summary>\n${parts.join("\n")}\n</details>`;
}

// ---- The standalone diff page ----------------------------------------------------------------

export interface DiffLabels {
  /** What the two versions are called, e.g. a short commit and "working tree". */
  base: string;
  head: string;
}

function summaryBlock(diff: PageDiff, labels: DiffLabels): string {
  const changes = diff.entries.filter((e) => e.status !== "same" && !e.movedTo);
  const lines = [`<aside class="bh-diff-summary" id="bh-changes" aria-label="Changes">`,
    `<p><strong>Changes</strong> from <code>${escapeHtml(labels.base)}</code> to <code>${escapeHtml(labels.head)}</code>: ${statsLine(diff.stats)}.</p>`];
  for (const [what, pair] of [["Title", diff.title], ["Description", diff.description]] as const) {
    if (pair) lines.push(`<p>${what}: <del>${escapeHtml(pair.old)}</del> <ins>${escapeHtml(pair.new)}</ins></p>`);
  }
  if (changes.length) {
    lines.push("<ol>");
    for (const e of changes) {
      lines.push(`<li><a href="#bh-change-${e.n}">${escapeHtml(e.label)}</a> ${statusTag(e.status)}${e.sectionTitle && e.sectionTitle !== e.label ? ` <span class="bh-diff-what">in ${escapeHtml(e.sectionTitle)}</span>` : ""}</li>`);
    }
    lines.push("</ol>");
  }
  lines.push("</aside>");
  return lines.join("\n");
}

/** The new version of the page with every difference marked in place, as one HTML document (theme links unchanged). */
export function renderDiffPage(diff: PageDiff, labels: DiffLabels): string {
  const out: string[] = [];
  const live: Emit = { inert: false, prefix: "" };
  const styles = { oldStyle: diff.oldStyle, newStyle: diff.newStyle };
  let summarised = false;
  const summarise = () => { if (!summarised) { out.push(summaryBlock(diff, labels)); summarised = true; } };
  for (const e of diff.entries) {
    const hero = !!e.new && e.new.tag === "header";
    if (!hero) summarise();
    if (e.status === "same") out.push(e.new!.html);
    else if (e.status === "removed") out.push(renderMark(e, { open: true, copy: true, ...styles }));
    else {
      const mark: Attr[] = [["data-diff", e.status]];
      out.push(renderMark(e, { open: true, copy: !inPlace(e), ...styles }));
      out.push(inPlace(e) ? inlineDiff(e.old!.toks, e.new!.toks, live, mark).html : emitBlock(e.new!.toks, live, mark));
    }
    if (hero) summarise();
  }
  summarise();
  const before = diff.before
    .replace(/<title>([^<]*)<\/title>/i, (_m, t) => `<title>Diff: ${t}</title>\n  <meta name="robots" content="noindex">`)
    // The marker is on <html>, where a script in <head> can read it (bhChanges.startsOn in theme/unlisted.js).
    .replace(/<html\b/i, "<html data-bh-diff")
    .replace(/<body\b([^>]*)>/i, (_m, attrs) => `<body${String(attrs).replace(/\sdata-(?:present|review)="[^"]*"/g, "")} data-present="off" data-review="off">`);
  const body = out.join("\n\n");
  // The old version's CSS, for the copies that need it (theme/modules/diff.js reads it). JSON in a script: "</" must not end the element.
  const oldCss = body.includes('data-style="old"') ? `\n\n<script type="application/json" id="bh-diff-old-style">${JSON.stringify(diff.oldStyle).replace(/</g, "\\u003c")}</script>` : "";
  return `${before}\n\n${body}\n\n${diff.after.replace(/^<\/article>/i, (m) => m + oldCss)}`;
}

// ---- Data for the Review panel ---------------------------------------------------------------

/** One difference as the browser needs it: where the live block is, and the mark to put before it. */
export interface DiffChange {
  n: number;
  status: Status;
  /** Index of the live block among the article's blocks (for a removed block: the block it sat before). */
  at: number;
  tag: string;
  id: string;
  /** The start of the live block's text, to confirm the index found the right block. */
  probe: string;
  section: string;
  sectionTitle: string;
  label: string;
  /** The text the old version had here, for finding where a comment's quote went. */
  oldText: string;
  /** The mark (see renderMark), collapsed. */
  html: string;
}

export interface DiffData {
  /** The commit the old version is from. */
  base: string;
  stats: DiffStats;
  title: { old: string; new: string } | null;
  /** How many blocks the new version has: the live page must agree, or the indexes mean nothing. */
  blocks: number;
  /** The old version's page CSS, when a copy needs it (one styled by id). */
  oldStyle?: string;
  changes: DiffChange[];
}

/** The start of a block's text as the browser will see it: cut before any entity this tooling does not decode. */
function probe(b: Block): string {
  const cut = b.text.search(/&[#\w]+;/);
  return (cut < 0 ? b.text : b.text.slice(0, cut)).slice(0, 48).trimEnd();
}

export function diffData(diff: PageDiff, base: string): DiffData {
  const changes = diff.entries.filter((e) => e.status !== "same").map((e): DiffChange => ({
    n: e.n, status: e.status, at: e.at,
    tag: e.new ? e.new.tag : "", id: e.new ? e.new.id : "", probe: e.new ? probe(e.new) : "",
    section: e.section, sectionTitle: e.sectionTitle, label: e.label,
    oldText: e.old && !e.movedTo ? e.old.text : "",
    html: renderMark(e, { open: false, copy: true, oldStyle: diff.oldStyle, newStyle: diff.newStyle }),
  }));
  const data: DiffData = { base, stats: diff.stats, title: diff.title, blocks: diff.blocks, changes };
  if (changes.some((c) => c.html.includes('data-style="old"'))) data.oldStyle = diff.oldStyle;
  return data;
}

/** A data file the page loads on demand: `window.BH_DIFFS["docs/x.html@<commit>"]`. */
export function diffScript(document: string, data: DiffData): string {
  return `/* GENERATED from the page's git history (scripts/page-diff.mts). Do not edit. */\n(window.BH_DIFFS = window.BH_DIFFS || {})[${JSON.stringify(`${document}@${data.base}`)}] = ${JSON.stringify(data)};\n`;
}

/** A commit id as review files and URLs may give it: hex only, so it can never be read as a git option or a path. */
export const COMMIT_RE = /^[0-9a-f]{7,40}$/;

// ---- Markdown summary (CI) -------------------------------------------------------------------

/** What changed on one page, for the summary of a set of pages. `diff` is null for a page with nothing to compare. */
export interface PageSummary { page: string; state: "changed" | "new" | "deleted" | "unreadable"; diff: PageDiff | null; out?: string }

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

/** The changed sections of each page, as GitHub-flavoured markdown. */
export function summaryMarkdown(pages: PageSummary[], labels: DiffLabels): string {
  const lines = ["## Page changes", ""];
  const touched = pages.filter((p) => p.state !== "changed" || (p.diff && (statsLine(p.diff.stats) !== "no changes" || p.diff.title || p.diff.description)));
  if (!touched.length) return [...lines, `No page's article differs between \`${labels.base}\` and \`${labels.head}\`.`, ""].join("\n");
  lines.push(`Between \`${labels.base}\` and \`${labels.head}\`. Each changed page has a rendered diff in the \`renders\` artifact, under \`diff/\`.`, "");
  for (const p of touched) {
    if (p.state !== "changed" || !p.diff) { lines.push(`- \`${p.page}\`: ${p.state === "new" ? "new page" : p.state === "deleted" ? "deleted" : "could not be compared"}`); continue; }
    lines.push(`- \`${p.page}\`: ${statsLine(p.diff.stats)}${p.diff.title ? " (title changed)" : ""}`);
    const bySection = new Map<string, DiffStats>();
    for (const e of p.diff.entries) {
      if (e.status === "same" || e.movedTo) continue;
      const key = e.sectionTitle || "Top of the page";
      if (!bySection.has(key)) bySection.set(key, { changed: 0, added: 0, removed: 0, moved: 0 });
      bySection.get(key)![e.status]++;
    }
    for (const [title, stats] of bySection) lines.push(`  - ${mdCell(title)}: ${statsLine(stats)}`);
  }
  lines.push("");
  return lines.join("\n");
}
