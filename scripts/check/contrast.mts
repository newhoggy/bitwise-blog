// The `check` rule for token contrast: WCAG ratios for every text/background token pair and
// every badge tone, in both themes, read from the light-dark() pairs in theme/tokens.css.
// It takes the CSS text, not paths, so tests can call it on any stylesheet. No side effects.

import type { Finding } from "../types.mts";

/** WCAG contrast for every text/background token pair, in both themes (from light-dark()). */
export const CONTRAST_PAIRS: [string, string[], number][] = [
  // [foreground, [backgrounds], minimum ratio]
  ["text", ["bg", "surface", "surface-2", "code-bg", "accent-soft", "warn-soft"], 4.5], // accent-soft: the search dialog's selected row; warn-soft: its matches
  ["text-muted", ["bg", "surface", "surface-2", "code-bg", "accent-soft"], 4.5],
  ["accent", ["bg", "surface", "accent-soft"], 4.5],
  ["accent-contrast", ["accent"], 4.5],
  ["info", ["info-soft", "surface"], 4.5],
  ["ok", ["ok-soft", "surface"], 4.5],
  ["warn", ["warn-soft", "surface"], 4.5],
  ["danger", ["danger-soft", "surface"], 4.5],
  // c1–c5 colour syntax-highlighted code (text); c6 only strokes (non-text, 3:1).
  // Review pins and count badges: --surface text on the kind/status colours.
  ["surface", ["accent", "ok", "info", "warn", "danger"], 4.5],
  ["c1", ["code-bg", "surface"], 4.5], ["c2", ["code-bg", "surface"], 4.5], ["c3", ["code-bg", "surface"], 4.5],
  ["c4", ["code-bg", "surface"], 4.5], ["c5", ["code-bg", "surface"], 4.5], ["c6", ["surface"], 3],
];

/**
 * Badge text is the tone colour on a 10% tint of itself over the page (`.badge` in components.css,
 * blended in sRGB so it is plain alpha). That background is not a token, so the pairs above miss it.
 * The tones are read from the `.badge.x { --tone: var(--y) }` rules, so a new badge is covered too.
 */
const BADGE_BACKGROUNDS = ["bg", "surface", "surface-2", "code-bg"];
/** Where only the plain (text-muted) badge sits: the kind label on the search dialog's selected row. */
const PLAIN_BADGE_ONLY_BACKGROUNDS = ["accent-soft"];
function badgeTones(css: string): string[] {
  const tones = new Set(["text-muted"]); // the default `--tone` of a plain .badge
  for (const m of css.matchAll(/\.badge\.[\w.,\s-]*\{\s*--tone:\s*var\(--([\w-]+)\)/g)) tones.add(m[1]);
  return [...tones];
}
const BADGE_TINT = 0.1;

function contrastProblems(css: string, componentsCss: string): string[] {
  const tok: Record<string, { light: string; dark: string }> = {};
  for (const m of css.matchAll(/--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)) tok[m[1]] = { light: m[2], dark: m[3] };
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const out: string[] = [];
  for (const [fg, bgs, min] of CONTRAST_PAIRS) for (const bg of bgs) for (const mode of ["light", "dark"] as const) {
    if (!tok[fg] || !tok[bg]) { out.push(`tokens.css: --${fg} or --${bg} is not a light-dark() hex pair`); continue; }
    const r = ratio(tok[fg][mode], tok[bg][mode]);
    if (r < min) out.push(`tokens.css: --${fg} on --${bg} is ${r.toFixed(2)}:1 in ${mode} mode (needs ${min}:1)`);
  }
  const hexOf = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  for (const tone of badgeTones(componentsCss)) for (const bg of tone === "text-muted" ? [...BADGE_BACKGROUNDS, ...PLAIN_BADGE_ONLY_BACKGROUNDS] : BADGE_BACKGROUNDS) for (const mode of ["light", "dark"] as const) {
    if (!tok[tone] || !tok[bg]) { out.push(`tokens.css: --${tone} or --${bg} is not a light-dark() hex pair`); continue; }
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [fg, base] = [rgb(tok[tone][mode]), rgb(tok[bg][mode])];
    const tinted = hexOf(fg.map((v, i) => v * BADGE_TINT + base[i] * (1 - BADGE_TINT)));
    const r = ratio(tok[tone][mode], tinted);
    if (r < 4.5) out.push(`tokens.css: a .badge in --${tone} on --${bg} is ${r.toFixed(2)}:1 in ${mode} mode (needs 4.5:1)`);
  }
  return out;
}

/** Contrast findings for a theme: `tokensCss` is theme/tokens.css, `componentsCss` theme/components.css (for the badge tones). */
export const contrastFindings = (tokensCss: string, componentsCss: string): Finding[] =>
  contrastProblems(tokensCss, componentsCss).map((message) => ({ rule: "theme/contrast", level: "error", message }));
