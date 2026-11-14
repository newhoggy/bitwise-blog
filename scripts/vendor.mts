// Third-party files the theme serves itself: the web fonts and the Prism and Mermaid scripts.
//
//   npm run vendor     re-fetch them at the versions pinned below (needs the network; CI never runs it)
//
// Each step downloads everything it needs before it replaces anything in theme/, so a failed run leaves the
// files it had not reached as they were.
//
// Serving them from the repo means a page asks no other host for anything, so no reader's IP address
// reaches Google, jsDelivr or cdnjs, and renders (`visual`, `cards`, `a11y`) are the same offline.
// To upgrade, change a constant here and in `theme/bh.js` (`check` fails while they differ), run this,
// then `npm run visual` and `npm run cards`.
//
// - Fonts: the WOFF2 files Google Fonts serves for the families, axes and weights in FONT_CSS, kept to
//   the SUBSETS the site uses, with Google's @font-face descriptors (unicode-range, one rule per weight),
//   written to theme/fonts/ and theme/fonts.css, with each family's OFL licence beside them.
// - Prism: one file, the core and PRISM_LANGUAGES in dependency order (no autoloader, which injects
//   scripts of its own), from the npm package.
// - Mermaid: dist/mermaid.min.js from the npm package, unchanged.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PRISM_VERSION = "1.30.0";
export const MERMAID_VERSION = "11.17.2";
/** Paths from the site root of the vendored scripts. `theme/bh.js` loads these; `bundle` inlines them. */
export const VENDOR = {
  prism: `theme/vendor/prism-${PRISM_VERSION}/prism.min.js`,
  mermaid: `theme/vendor/mermaid-${MERMAID_VERSION}/mermaid.min.js`,
} as const;
/** Prism languages built in, dependencies first (`main` checks the order against components.json). */
export const PRISM_LANGUAGES = ["markup", "css", "clike", "javascript", "typescript", "json", "bash", "diff", "go", "haskell", "http", "lua", "python", "rust", "sql", "toml", "yaml"];

/** The families, axes and weights the theme uses (tokens.css, and the faces visual.mts loads). */
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap";
/** Google picks the font format from the User-Agent: a plain desktop Firefox one gets WOFF2. */
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
/** Every character the site uses today is in latin or greek (λ); latin-ext is cheap insurance, fetched only when used. */
const SUBSETS = ["latin", "latin-ext", "greek"];
/**
 * The font builds the files are, as Google versions them in its URLs (fonts.gstatic.com/s/<family>/<version>/).
 * The CSS API serves only the latest build, so a run that gets a different one stops instead of quietly
 * changing every page: set the new version here on purpose, then run `visual` and `cards`.
 */
const FONT_VERSIONS: Record<string, string> = { "Fraunces": "v38", "IBM Plex Sans": "v23", "JetBrains Mono": "v24" };
/** The licences, from a fixed commit of github.com/google/fonts. */
const FONTS_REPO = "https://raw.githubusercontent.com/google/fonts/29b4ec6df2522a8aee279414b78a07910b065874/ofl";
const FONT_LICENCES: Record<string, string> = {
  "Fraunces": `${FONTS_REPO}/fraunces/OFL.txt`,
  "IBM Plex Sans": `${FONTS_REPO}/ibmplexsans/OFL.txt`,
  "JetBrains Mono": `${FONTS_REPO}/jetbrainsmono/OFL.txt`,
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The language names (aliases included) a Prism build defines, found by running it in a sandbox. */
export function prismLanguages(source: string): string[] {
  const sandbox: any = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  const langs = sandbox.Prism?.languages || {};
  return Object.keys(langs).filter((k) => typeof langs[k] !== "function").sort();
}

async function fetchOk(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

/** Temporary directories to remove when the run ends. */
const temps: string[] = [];

/** The unpacked npm package `name@version`, in a fresh temporary directory. */
function npmPackage(name: string, version: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bh-vendor-${name}-`));
  temps.push(dir);
  const tgz = execFileSync("npm", ["pack", `${name}@${version}`, "--silent", "--pack-destination", dir], { encoding: "utf8", timeout: 120000 }).trim().split("\n").pop()!;
  execFileSync("tar", ["-xzf", path.join(dir, tgz), "-C", dir], { timeout: 60000 });
  return path.join(dir, "package");
}

/** Replace a vendor directory's contents: old versions of the same package are removed. */
function freshDir(rel: string, prefix: string): string {
  const parent = path.join(ROOT, path.dirname(rel));
  fs.mkdirSync(parent, { recursive: true });
  for (const d of fs.readdirSync(parent)) if (d.startsWith(prefix)) fs.rmSync(path.join(parent, d), { recursive: true, force: true });
  const dir = path.join(ROOT, rel);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function vendorFonts(): Promise<void> {
  const css = await (await fetchOk(FONT_CSS, { "user-agent": USER_AGENT })).text();
  const faces = [...css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[2]!, prop = (p: string) => body.match(new RegExp(`${p}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
    return { subset: m[1]!, family: prop("font-family").replace(/['"]/g, ""), style: prop("font-style"), weight: prop("font-weight"), body, url: body.match(/url\(([^)]+)\)\s*format\('woff2'\)/)?.[1] ?? "" };
  }).filter((f) => SUBSETS.includes(f.subset));
  if (!faces.length || faces.some((f) => !f.url)) throw new Error("the Google Fonts CSS has no WOFF2 sources: did the User-Agent stop getting WOFF2?");
  for (const f of faces) {
    const got = f.url.match(/\/s\/[^/]+\/(v\d+)\//)?.[1], want = FONT_VERSIONS[f.family];
    if (got !== want) throw new Error(`Google now serves ${f.family} ${got ?? "(no version)"}, not ${want}: set FONT_VERSIONS in scripts/vendor.mts to take it on purpose`);
  }
  // One file per distinct URL. Google points every weight of a variable family at the same file.
  const names = new Map<string, string>();
  for (const f of faces) {
    if (names.has(f.url)) continue;
    const base = [slug(f.family), f.style === "italic" ? "italic" : "", f.subset].filter(Boolean).join("-");
    const taken = [...names.values()].includes(`${base}.woff2`);
    names.set(f.url, taken ? `${base}-${slug(f.weight)}.woff2` : `${base}.woff2`);
  }
  // Everything is downloaded before theme/fonts/ is touched, so a failed run leaves it as it was.
  const files = new Map<string, Buffer | string>();
  for (const [url, name] of names) files.set(name, Buffer.from(await (await fetchOk(url)).arrayBuffer()));
  for (const [family, url] of Object.entries(FONT_LICENCES)) files.set(`OFL-${slug(family)}.txt`, await (await fetchOk(url)).text());
  const dir = path.join(ROOT, "theme", "fonts");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of files) fs.writeFileSync(path.join(dir, name), data);
  // Google gives each weight of a variable family its own rule, all naming the same file. Where those weights
  // are every step from the lightest to the heaviest (Plex Sans: 400 to 700), one rule with that range matches
  // the same faces and names the file once, so a bundle inlines it once. Otherwise (JetBrains Mono: 400 and
  // 600, where a 500 must still pick 400) the rules stay as they are.
  const rules: string[] = [];
  for (const [url, name] of names) {
    const same = faces.filter((f) => f.url === url);
    const weights = same.map((f) => Number(f.weight)).sort((a, b) => a - b);
    const steps = weights.length > 1 && weights.every((w, i) => Number.isInteger(w) && (i === 0 || w === weights[i - 1]! + 100));
    const group = steps ? [{ ...same[0]!, body: same[0]!.body.replace(/font-weight:[^;]+;/, `font-weight: ${weights[0]} ${weights.at(-1)};`) }] : same;
    for (const f of group) rules.push(`/* ${f.family}${f.style === "italic" ? " italic" : ""}, ${f.subset} */\n@font-face {${f.body.replace(f.url, `"fonts/${name}"`)}}`);
  }
  fs.writeFileSync(path.join(ROOT, "theme", "fonts.css"), [
    "/* The theme's web fonts, served from theme/fonts/ (SIL Open Font License 1.1; the licences are beside",
    "   the files). Generated by `npm run vendor` (scripts/vendor.mts) from Google Fonts: do not edit. */",
    "", ...rules, "",
  ].join("\n"));
  console.log(`fonts: ${names.size} files, ${rules.length} @font-face rules (${SUBSETS.join(", ")})`);
}

function vendorPrism(): void {
  const pkg = npmPackage("prismjs", PRISM_VERSION);
  const meta = JSON.parse(fs.readFileSync(path.join(pkg, "components.json"), "utf8")).languages;
  const list = (v: unknown): string[] => (v == null ? [] : Array.isArray(v) ? v : [String(v)]);
  PRISM_LANGUAGES.forEach((lang, i) => {
    if (!meta[lang]) throw new Error(`Prism ${PRISM_VERSION} has no language "${lang}"`);
    // A language must come after what it requires, modifies or optionally extends, when that is built in too.
    for (const dep of [...list(meta[lang].require), ...list(meta[lang].modify), ...list(meta[lang].optional)]) {
      const at = PRISM_LANGUAGES.indexOf(dep);
      if (at > i) throw new Error(`PRISM_LANGUAGES: "${dep}" must come before "${lang}"`);
      if (at < 0 && list(meta[lang].require).includes(dep)) throw new Error(`PRISM_LANGUAGES: "${lang}" requires "${dep}"`);
    }
  });
  const read = (rel: string) => fs.readFileSync(path.join(pkg, rel), "utf8").trim();
  const source = [
    `/* Prism ${PRISM_VERSION} (MIT, see LICENSE): the core and ${PRISM_LANGUAGES.join(", ")}. Built by \`npm run vendor\` (scripts/vendor.mts): do not edit. */`,
    // Set before the core reads it, so Prism never highlights on its own: bh.js calls it once the code blocks are built.
    "window.Prism = window.Prism || { manual: true };",
    read("components/prism-core.min.js"),
    ...PRISM_LANGUAGES.map((l) => read(`components/prism-${l}.min.js`)),
  ].map((s) => s.replace(/;?$/, ";")).join("\n") + "\n";
  const dir = freshDir(path.dirname(VENDOR.prism), "prism-");
  fs.writeFileSync(path.join(ROOT, VENDOR.prism), source);
  fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(dir, "LICENSE"));
  console.log(`prism ${PRISM_VERSION}: ${(source.length / 1024).toFixed(1)} KB, languages ${prismLanguages(source).join(" ")}`);
}

function vendorMermaid(): void {
  const pkg = npmPackage("mermaid", MERMAID_VERSION);
  const dir = freshDir(path.dirname(VENDOR.mermaid), "mermaid-");
  fs.copyFileSync(path.join(pkg, "dist", "mermaid.min.js"), path.join(ROOT, VENDOR.mermaid));
  fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(dir, "LICENSE"));
  console.log(`mermaid ${MERMAID_VERSION}: ${(fs.statSync(path.join(ROOT, VENDOR.mermaid)).size / 1024 / 1024).toFixed(1)} MB`);
}

async function main(): Promise<number> {
  try {
    await vendorFonts();
    vendorPrism();
    vendorMermaid();
  } finally {
    for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
