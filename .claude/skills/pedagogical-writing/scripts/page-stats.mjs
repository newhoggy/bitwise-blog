#!/usr/bin/env node
// Usage: node page-stats.mjs <page.html | text.txt>
//
// Prints the numbers the review audits use: words per h2 section, voice rates
// compared with the 3Blue1Brown medians, predict folds, and every promise phrase
// ("for now", "later", "remember"…) with the section it is in, so each can be
// matched to its payoff. HTML is reduced to the prose of <article>; SVG, code,
// scripts and styles are dropped. No dependencies.
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node page-stats.mjs <page.html | text.txt>");
  process.exit(2);
}
const src = fs.readFileSync(file, "utf8");
const isHtml = /<html|<article/i.test(src);

// 3Blue1Brown medians over 118 long-form explainers (per 1,000 words unless noted).
const BASELINE = { words: 3143, sentLen: 24.7, you: 21.8, we: 11.5, i: 8.5, q: 2.2, name: 0.6 };

const decode = s => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&[a-z]+;|&#\d+;/g, " ");

// Split into sections: [{ id, title, text }]. Text before the first h2 is "(top)".
function sections() {
  if (!isHtml) return [{ id: "(all)", title: "", text: src }];
  let h = (/<article[^>]*>([\s\S]*)<\/article>/i.exec(src) || [, src])[1];
  // Tables, term lists and code are reference material, not narrative: leave them out.
  h = h.replace(/<(script|style|svg|pre|code|template|table|dl)\b[\s\S]*?<\/\1>/gi, " ");
  const parts = h.split(/(?=<h2\b)/i);
  return parts.map((p, n) => {
    const m = /^<h2\b([^>]*)>([\s\S]*?)<\/h2>/i.exec(p);
    const id = m ? (/\bid="([^"]+)"/.exec(m[1]) || [, "(no id)"])[1] : n === 0 ? "(top)" : "(?)";
    const title = m ? decode(m[2].replace(/<[^>]+>/g, "")).trim() : "";
    const text = decode((m ? p.slice(m[0].length) : p).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return { id, title, text, predicts: (p.match(/<details\b[^>]*class="[^"]*\bpredict\b/gi) || []).length };
  });
}

const count = (t, re) => (t.match(re) || []).length;
const RE = {
  you: /\byou(r|rs|'re|'ll|'d|'ve)?\b/gi,
  we: /\b(we|we're|we'll|we've|let's|us|our)\b/gi,
  i: /\b(I|I'm|I'll|I'd|I've|me|my)\b/g,
  q: /\?/g,
  name: /\b(is called|are called|called the|known as|we call|people call|referred to as)\b/gi,
};
// Phrases that make a promise. Bare "later" is left out: "one byte later" is not a promise.
const PROMISE = new RegExp("\\b(" + [
  "for now", "for the moment", "until (we|the next|later)",
  "later (on|in|we|you|this|the page|the series|sections?)", "an? later (page|post|series|section|chapter)",
  "(see|shown|explain\\w*|cover\\w*|discuss\\w*|fix\\w*|return to|revisit\\w*|come back to) (it |this |that |them )?later",
  "further on", "comes? after (this|that)", "by the end of (this|the) (page|section|series)",
  "(we|you)'ll (come back|return|see|get to|meet)", "come back to", "return to",
  "remember (this|that)", "keep in mind", "tuck (this|that) away", "hold on to",
  "simplif\\w*", "not quite (right|true|correct)", "(a little|slightly) wrong",
  "ignore (this|that|for)", "take (it|this|them|that) for granted", "taking (it|this|them|that) for granted",
  "we skip", "skip(ped|ping)? (this|over)", "postpone\\w*", "in a moment",
].join("|") + ")\\b", "gi");

const secs = sections();
const all = secs.map(s => s.text).join(" ");
const words = all.split(/\s+/).filter(Boolean).length;
const sents = all.split(/(?<=[.?!])\s+/).filter(s => s.split(/\s+/).length > 2).length || 1;
const per1k = re => (1000 * count(all, re) / Math.max(words, 1));

const row = (label, value, base, fmt = v => v.toFixed(1)) =>
  console.log(`${label.padEnd(30)}${fmt(value).padStart(8)}   3B1B median ${fmt(base)}`);

console.log(`# ${file}\n`);
row("words", words, BASELINE.words, v => String(Math.round(v)));
row("words per sentence", words / sents, BASELINE.sentLen);
row("'you' per 1,000 words", per1k(RE.you), BASELINE.you);
row("'we / let's' per 1,000 words", per1k(RE.we), BASELINE.we);
row("'I / me' per 1,000 words", per1k(RE.i), BASELINE.i);
row("questions per 1,000 words", per1k(RE.q), BASELINE.q);
row("'called / known as' per 1,000", per1k(RE.name), BASELINE.name);
if (isHtml) console.log(`${"details.predict folds".padEnd(30)}${String(secs.reduce((s, x) => s + x.predicts, 0)).padStart(8)}   house rule: 1-2 per page`);

if (isHtml) {
  console.log("\n## Sections\n");
  for (const s of secs) {
    const w = s.text.split(/\s+/).filter(Boolean).length;
    console.log(`${String(w).padStart(6)} words  #${s.id}${s.title ? `  ${s.title}` : ""}`);
  }
}

console.log("\n## Promise phrases (match each to its payoff)\n");
let found = 0;
for (const s of secs) {
  for (const m of s.text.matchAll(PROMISE)) {
    const a = Math.max(0, m.index - 70), b = Math.min(s.text.length, m.index + m[0].length + 70);
    console.log(`#${s.id}: …${s.text.slice(a, b)}…`);
    found++;
  }
}
if (!found) console.log("(none found: either the page makes no promises, or it makes them silently)");
