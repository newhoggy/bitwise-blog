// The size budget for a page: the weight of the page itself, apart from the shared theme.
//
// Measured as gzip (level 9, so it is deterministic) of the page's HTML plus every page-local
// file it loads through <img src>. Gzip is what crosses the network: raw HTML bytes would
// punish repetitive SVG that compresses to almost nothing. The theme is left out because it is
// shared and cached; social cards because the page does not load them. CSS url(), <script src>
// to local files and files fetched by script are not followed, so the budget bounds the page's
// own HTML and images, not everything it could load. `check` does not measure sealed (encrypted)
// shells: its page loop skips them, and their payload is already compressed.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const KB = 1024;
/** Above this, `check` warns. Just over the largest page today (64.7 KB gzip, how-deflate-works). */
export const PAGE_WARN_BYTES = 75 * KB;
/** Above this, `check` fails. */
export const PAGE_ERROR_BYTES = 200 * KB;

export interface PagePart { path: string; bytes: number }
export interface PageWeight { total: number; parts: PagePart[] }
export interface PageSizeFinding { level: "warn" | "error"; message: string }

const gzipSize = (buf: Buffer): number => zlib.gzipSync(buf, { level: 9 }).length;

/** Decode what an `src` attribute may hold: HTML entities that appear in paths, and percent-escapes. */
function srcToPath(value: string): string {
  const path = value.replace(/&amp;/g, "&").replace(/&#38;/g, "&").split(/[?#]/)[0];
  try { return decodeURIComponent(path); } catch { return path; }
}

/**
 * Page-local files named by `<img src>`: relative, inside the page's own folder (so not the shared
 * theme, and nothing outside the repo), existing, de-duplicated, in document order. Comments and
 * scripts are skipped, `data-src` is not `src`, and quotes may be double, single or absent.
 */
function localImages(html: string, dir: string): string[] {
  const text = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const found: string[] = [];
  for (const tag of text.matchAll(/<img\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi)) {
    const attr = tag[0].match(/(?<![\w-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = attr ? srcToPath(attr[1] ?? attr[2] ?? attr[3]) : "";
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src)) continue; // data:, http(s):, protocol-relative, absolute
    const file = path.resolve(dir, src);
    if (!file.startsWith(dir + path.sep)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile() && !found.includes(file)) found.push(file);
  }
  return found;
}

/** The gzip size of a page's HTML and of the local images it shows. */
export function pageWeight(file: string): PageWeight {
  const dir = path.resolve(path.dirname(file));
  const html = fs.readFileSync(file, "utf8");
  const parts: PagePart[] = [{ path: path.basename(file), bytes: gzipSize(Buffer.from(html)) }];
  for (const img of localImages(html, dir)) parts.push({ path: path.relative(dir, img), bytes: gzipSize(fs.readFileSync(img)) });
  return { total: parts.reduce((n, p) => n + p.bytes, 0), parts };
}

const kb = (n: number): string => `${(n / KB).toFixed(1)} KB`;

/** A warning or an error when the page is over budget, naming the heaviest part; otherwise undefined. */
export function pageSizeFinding(weight: PageWeight): PageSizeFinding | undefined {
  const level = weight.total > PAGE_ERROR_BYTES ? "error" : weight.total > PAGE_WARN_BYTES ? "warn" : undefined;
  if (!level) return undefined;
  const budget = level === "error" ? PAGE_ERROR_BYTES : PAGE_WARN_BYTES;
  const biggest = weight.parts.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  return { level, message: `page weighs ${kb(weight.total)} gzipped (HTML and local images), over the ${kb(budget)} ${level === "error" ? "limit" : "budget"}; the heaviest part is ${biggest.path} at ${kb(biggest.bytes)}` };
}
