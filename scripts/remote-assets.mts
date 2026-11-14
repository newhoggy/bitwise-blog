// `check` rules that keep third-party code and fonts from drifting back onto a moving CDN URL.
//
// The theme serves its fonts (theme/fonts/) and scripts (theme/vendor/, see scripts/vendor.mts) itself,
// so a page asks no other host for anything. These rules hold that line:
//   - a page or template that loads a script or stylesheet from another host must pin an exact version
//     and carry an integrity hash, so the bytes cannot change under it;
//   - the theme loads nothing from another host at all (theme code has no way to carry a hash);
//   - bh.js loads exactly the vendored files scripts/vendor.mts writes, and they exist;
//   - a code block's language is one the vendored Prism build has (otherwise it is not highlighted).

import fs from "node:fs";
import path from "node:path";
import { VENDOR, prismLanguages } from "./vendor.mts";

const REMOTE = /^(?:https?:)?\/\//i;
/** An exact version in a CDN path: `pkg@1.2.3/`, `/1.2.3/`, `/v1.2.3/` (a pre-release suffix is allowed). */
const EXACT_VERSION = /(?:@|\/v?)\d+\.\d+\.\d+(?:-[\w.]+)?(?=[/?#]|$)/;
const INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;
/** The theme scripts people write; the other theme/*.js files are generated data (page text can name any URL). */
const THEME_SCRIPTS = ["bh.js", "examples.js", "unlisted.js"];

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

/** A `<script src>` or stylesheet/preload `<link>` on another host that is not an exact version with an integrity hash. */
export function remoteAssetProblems(html: string): string[] {
  const out: string[] = [];
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const [tag] of text.matchAll(/<(?:script|link)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
    const isScript = /^<script/i.test(tag);
    if (!isScript && !/(?:^|\s)(?:stylesheet|preload|modulepreload)(?:\s|$)/i.test(attr(tag, "rel") || "")) continue;
    const url = attr(tag, isScript ? "src" : "href");
    if (!url || !REMOTE.test(url)) continue;
    const what = isScript ? `<script src="${url}">` : `<link rel="${attr(tag, "rel")}" href="${url}">`;
    const missing = [
      EXACT_VERSION.test(url.split(/[?#]/)[0]!) ? "" : "an exact version (x.y.z) in its URL",
      INTEGRITY.test(attr(tag, "integrity") || "") ? "" : 'an integrity="sha384-…" hash',
    ].filter(Boolean);
    if (missing.length) out.push(`${what} loads from another host without ${missing.join(" or ")}: pin and hash it, or serve it from theme/vendor/`);
  }
  return out;
}

/** The theme's stylesheets and scripts load nothing from another host, and bh.js loads the vendored files that exist. */
export function themeRemoteProblems(root: string): string[] {
  const out: string[] = [];
  const theme = path.join(root, "theme");
  for (const f of fs.readdirSync(theme).filter((x) => x.endsWith(".css")).sort()) {
    const css = fs.readFileSync(path.join(theme, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/(?:@import\s+(?:url\()?|url\()\s*["']?((?:https?:)?\/\/[^"')\s;]+)/gi)) {
      out.push(`theme/${f}: loads ${m[1]} from another host: serve it from theme/ (fonts go in theme/fonts/, declared in theme/fonts.css)`);
    }
  }
  const modules = path.join(theme, "modules");
  const scripts = [...THEME_SCRIPTS, ...(fs.existsSync(modules) ? fs.readdirSync(modules).filter((x) => x.endsWith(".js")).sort().map((x) => `modules/${x}`) : [])];
  for (const f of scripts) {
    const file = path.join(theme, f);
    if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, "utf8").matchAll(/["'`]((?:https?:)?\/\/[^"'`\s]+?\.(?:m?js|css|woff2?|ttf|otf))(?=[?#"'`])/gi)) {
      out.push(`theme/${f}: loads ${m[1]} from another host: vendor it under theme/vendor/ (scripts/vendor.mts)`);
    }
  }
  const bhJs = path.join(theme, "bh.js");
  const src = fs.existsSync(bhJs) ? fs.readFileSync(bhJs, "utf8") : "";
  for (const rel of Object.values(VENDOR)) {
    if (!src.includes(JSON.stringify(rel))) out.push(`theme/bh.js does not load ${rel}: keep its vendor paths equal to VENDOR in scripts/vendor.mts`);
    if (!fs.existsSync(path.join(root, rel))) out.push(`${rel} is missing: run \`npm run vendor\``);
  }
  return out;
}

/** The languages the vendored Prism build highlights (aliases included), or null when the build is missing. */
export function vendoredPrismLanguages(root: string): Set<string> | null {
  const file = path.join(root, VENDOR.prism);
  if (!fs.existsSync(file)) return null;
  return new Set([...prismLanguages(fs.readFileSync(file, "utf8")), "none"]);
}

/** `language-x` classes the vendored Prism has no grammar for: those blocks render as plain text. */
export function codeLanguageProblems(html: string, languages: Set<string>): string[] {
  const text = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const unknown = new Set<string>();
  for (const [, cls] of text.matchAll(/<[a-z][\w-]*\b[^>]*?\sclass="([^"]*)"/gi)) {
    for (const [, lang] of cls!.matchAll(/(?:^|\s)language-([\w-]+)/g)) if (!languages.has(lang!.toLowerCase())) unknown.add(lang!);
  }
  return [...unknown].map((l) => `language-${l}: the vendored Prism has no such language, so the block is not highlighted: add it to PRISM_LANGUAGES in scripts/vendor.mts and run \`npm run vendor\``);
}
