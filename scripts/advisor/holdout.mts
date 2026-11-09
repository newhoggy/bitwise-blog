// Choose a writer's eval holdout: the posts the stance atlas never sees, so the eval set's positive
// controls don't come from what the atlas was built from. A port of make_holdout.py.
//
// Selection is stratified by (category, era) and ordered by a seeded SHA-256 of each post stem, so
// the same corpus, fraction and seed always give the same holdout, on any machine.

import crypto from "node:crypto";
import { eraOf, atlasEligible, type CorpusMeta, type Post } from "./corpus.mts";
import { codePointCompare, pyRound } from "./py-compat.mts";

export const DEFAULT_FRACTION = 0.15;
export const DEFAULT_SEED = 6;

function rank(seed: number, stem: string): string {
  return crypto.createHash("sha256").update(`${seed}:${stem}`).digest("hex");
}

/** Pick round(fraction × eligible) stems, allocated across (category, era) strata by largest remainder. */
export function computeHoldout(posts: Post[], fraction = DEFAULT_FRACTION, seed = DEFAULT_SEED): Set<string> {
  interface Stratum { category: string; era: string; stems: string[]; quota: number; alloc: number }
  const strata = new Map<string, Stratum>();
  for (const p of posts) {
    if (!atlasEligible(p)) continue;
    const category = typeof p.meta.category === "string" ? p.meta.category : "";
    const era = eraOf(p.published);
    const key = JSON.stringify([category, era]);
    const stratum = strata.get(key) ?? { category, era, stems: [], quota: 0, alloc: 0 };
    stratum.stems.push(p.stem);
    strata.set(key, stratum);
  }
  const all = [...strata.values()];
  const total = all.reduce((n, s) => n + s.stems.length, 0);
  const target = pyRound(fraction * total);
  for (const s of all) {
    s.quota = fraction * s.stems.length;
    s.alloc = Math.floor(s.quota);
  }
  const byRemainder = [...all].sort(
    (a, b) => (b.quota - b.alloc) - (a.quota - a.alloc) || codePointCompare(a.category, b.category) || codePointCompare(a.era, b.era),
  );
  const extra = target - all.reduce((n, s) => n + s.alloc, 0);
  for (const s of byRemainder.slice(0, Math.max(extra, 0))) s.alloc++;

  const chosen = new Set<string>();
  for (const s of all) {
    const ordered = s.stems.map((stem) => ({ stem, rank: rank(seed, stem) })).sort((a, b) => codePointCompare(a.rank, b.rank));
    for (const { stem } of ordered.slice(0, s.alloc)) chosen.add(stem);
  }
  return chosen;
}

/** The sidecar with `split: eval` on exactly the chosen stems. */
export function applyHoldout(meta: CorpusMeta, chosen: Set<string>): CorpusMeta {
  const out: CorpusMeta = {};
  for (const [stem, entry] of Object.entries(meta)) {
    const { split: _split, ...rest } = entry ?? {};
    out[stem] = chosen.has(stem) ? { ...rest, split: "eval" } : rest;
  }
  return out;
}
