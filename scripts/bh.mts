#!/usr/bin/env node
// beautiful-html CLI — no runtime dependencies, Node ≥ 22.18.
//
//   node scripts/bh.mts new [--private] [--example] [--unlisted] <template> <slug> "<Title>" ["<description>"]
//   node scripts/bh.mts index                 regenerate index.html list, social meta (with JSON-LD), each hero's facts and banner, feed.xml, sitemap.xml, robots.txt, 404.html, theme/{glossary,site,search-index,unlisted-pages,unlisted-slugs}.js
//   node scripts/bh.mts check [--skip-keys]   lint docs/ and index.html (--skip-keys: no 1Password lookups)
//   node scripts/bh.mts cards                 render docs/assets/og/<slug>.png and record it in social-cards.txt (needs Chrome; see scripts/cards.mts)
//   node scripts/bh.mts bundle <page|--all>   inline theme → dist/<name>.html (single file)
//   node scripts/bh.mts diff <page> [base] [head]   what changed in a page between two versions → dist/diff/<name>.html (see contracts/page-diff.md)
//   node scripts/bh.mts seal [--show-links|--reshell]   encrypt docs/*.private.html → docs/<slug>.html (see contracts/private-pages.md)
//   node scripts/bh.mts unseal [slug…]        decrypt docs/<slug>.html → docs/<slug>.private.html
//   node scripts/bh.mts serve [port] [host]   static server (pages also work from file://); port 0 picks a free one
//   node scripts/bh.mts stamp                 print the build stamp serve gives a page (repo, commit, dirty) as JSON, for a review made from file://

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execSync, execFile, execFileSync } from "node:child_process";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { contractProblems, readmeDependencyProblems, readmeExampleProblems } from "./docs-drift.mts";
import {
  KIND_LABELS, escapeHtml, CARD_FILE, KEY_RE, GROUP_RE, cardFromDoc, tryDecryptCard, buildBlob,
  renderCardsFile, parseCardsFile, validateCardsFile, mergeEntries, docCardHtml,
} from "./private-cards.mts";
import { inlineScriptProblems } from "./inline-scripts.mts";
import { pageWeight, pageSizeFinding } from "./page-size.mts";
import { pngSize } from "./png.mts";
import { CARD_RECORDS_FILE, parseCardRecords, renderCardRecords } from "./card-records.mts";
import { reviewFiles, readReview, canonicalDocument, isPrivateDocument, reviewRecord, sameReviewMessage, reviewProblems, isSealedFile, isSealedShell, PRIVATE_EXT } from "./reviews.mts";
import { stripComments, VOID_TAGS, parseTree, nodeAttr, hasClass, walkTree, findNode, nodeText, decodeEntities } from "./html-tree.mts";
import { arrowTipFindings, diagramLabelFindings } from "./check/diagram-geometry.mts";
import { contrastFindings } from "./check/contrast.mts";
import { linkTargetFindings } from "./check/link-targets.mts";
import { feedContent, feedInteractives } from "./feed-content.mts";
import { HERO_META_RE, EMPTY_HERO_META, SUPERSEDED_RE, HERO_RE, withoutHeroMeta, heroMetaList, supersededBanner, readingTime, articleWords, type HeroMetaRow } from "./hero-meta.mts";
import { hiddenPages, hiddenHrefs, HIDDEN_RULE, type HiddenKind } from "./hidden-pages.mts";
import { LEAK_ALLOWED } from "./leak-allowed.mts";
import { trackedPrivatePlaintext } from "./private-leaks.mts";
import { remoteAssetProblems, themeRemoteProblems, vendoredPrismLanguages, codeLanguageProblems } from "./remote-assets.mts";
import { VENDOR } from "./vendor.mts";
import { COMMIT_RE, diffPages, renderDiffPage, statsLine, summaryMarkdown, type PageSummary } from "./page-diff.mts";
import { PAGE_RE, pageAt, resolveCommit, changedPages, reviewDiffScript } from "./page-history.mts";
import type { Doc, SocialMeta, JsonLd, Visual, CardJob, GlossaryEntry, TreeNode, ReviewFile, ReviewRecord, OpItem, Finding } from "./types.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const TEMPLATES = path.join(ROOT, "templates");
const DIST = path.join(ROOT, "dist");
const INDEX = path.join(ROOT, "index.html");
const GLOSSARY_SRC = path.join(DOCS, "glossary.html");
const GLOSSARY_OUT = path.join(ROOT, "theme", "glossary.js");
const SITE_OUT = path.join(ROOT, "theme", "site.js");
const SEARCH_OUT = path.join(ROOT, "theme", "search-index.js");
const REVIEWS_OUT = path.join(ROOT, "theme", "reviews.js");
// Unlisted pages (bh:unlisted): published and readable by direct link, but off the home page,
// search, backlinks and in-site links unless the reader opened a page with #unlisted=true.
// Everything about them lives in UNLISTED_OUT, which a page loads only when that flag is on;
// UNLISTED_SLUGS_OUT holds their paths alone, so links to them can be made inert by default.
const UNLISTED_OUT = path.join(ROOT, "theme", "unlisted-pages.js");
const UNLISTED_SLUGS_OUT = path.join(ROOT, "theme", "unlisted-slugs.js");
// An unlisted page's published review threads: theme/reviews.js (loaded by listed pages) must not
// carry their text, so they are in a file that only the unlisted page itself loads.
const UNLISTED_REVIEWS_OUT = path.join(ROOT, "theme", "unlisted-reviews.js");
// Private pages: plaintext in docs/<slug>.private.html (git-ignored), published only as an
// encrypted docs/<slug>.html that decrypts in the browser with the key in the URL fragment.
// Keys live in 1Password (vault $BH_OP_VAULT, default "Private"), never in the repo.
const OP_VAULT = process.env.BH_OP_VAULT || "Private";

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ---- HTML helpers (regex-based; fine for the files we author) ------------------

function getMeta(html: string, name: string): string {
  const re = new RegExp(`<meta\\s+name="${name.replace(":", "\\:")}"\\s+content="([^"]*)"`, "i");
  return (html.match(re) || [])[1]?.trim() ?? "";
}

function getTitle(html: string): string {
  return (html.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim() ?? "";
}

function allDocFiles(): string[] {
  if (!fs.existsSync(DOCS)) return [];
  return fs.readdirSync(DOCS).filter((f) => f.endsWith(".html")).sort().map((f) => path.join(DOCS, f));
}

const isPrivateSource = (file: string) => file.endsWith(PRIVATE_EXT);
const isSealed = (file: string) => !isPrivateSource(file) && isSealedFile(file);

/** Public documents only: every page that is published, unlisted ones included. */
function docFiles(): string[] {
  return allDocFiles().filter((f) => !isPrivateSource(f) && !isSealed(f));
}
/** Public documents the site surfaces: what the catalogue, search, backlinks and `bundle --all` see.
    An unlisted page is published and checked like any other but is not in this list. */
function listedDocFiles(): string[] {
  return docFiles().filter((f) => !readDoc(f).unlisted);
}
const privateSources = () => allDocFiles().filter(isPrivateSource);
const sealedFiles = () => allDocFiles().filter(isSealed);

function readDoc(file: string): Doc {
  const html = stripComments(fs.readFileSync(file, "utf8")); // example <meta> in comments must not count
  return {
    file,
    href: path.relative(ROOT, file).split(path.sep).join("/"),
    title: getTitle(html),
    description: getMeta(html, "description"),
    kind: getMeta(html, "bh:kind") || "explainer",
    status: getMeta(html, "bh:status"),
    date: getMeta(html, "bh:date"),
    tags: getMeta(html, "bh:tags"),
    // Pages that only demonstrate the theme and templates: hidden by default, shown with ?examples
    // (theme/examples.js decides in the browser).
    example: getMeta(html, "bh:example") === "true",
    // Published but not surfaced: off the home page, search and backlinks, and links to it are inert,
    // unless the reader opened a page with #unlisted=true (theme/unlisted.js decides in the browser).
    unlisted: getMeta(html, "bh:unlisted") === "true",
    feed: getMeta(html, "bh:feed"),
    authors: getMeta(html, "bh:authors"),
    // Lifecycle links (relative to the doc in the source; root-relative here).
    supersedes: resolveDocLink(file, getMeta(html, "bh:supersedes")),
    supersededBy: resolveDocLink(file, getMeta(html, "bh:superseded-by")),
  };
}

/** The page's topics, lowercase. An example page is also under "examples". */
function docTopics(d: Doc): string[] {
  const tags = (d.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return d.example && !tags.includes("examples") ? ["examples", ...tags] : tags;
}

/** A doc-relative link from a meta tag as a root-relative path ("docs/x.html"), or "". */
function resolveDocLink(file: string, value: string): string {
  if (!value) return "";
  return path.relative(ROOT, path.resolve(path.dirname(file), value)).split(path.sep).join("/");
}

// ---- social cards: the managed <head> block and the card images --------------------------------
//
// Every public page carries Open Graph / Twitter tags between two markers. `npm run index`
// writes them from the page's own title, description and bh:* metas, and `check` fails when
// they are missing or stale. Each page also has a 1200×630 card, docs/assets/og/<slug>.png,
// rendered by scripts/cards.mts from a visual chosen out of the page itself. The home page uses
// the shared site card. Absolute URLs come from one place: package.json `homepage`, or the
// BH_SITE_URL environment variable (for forks).

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const SITE_URL = String(process.env.BH_SITE_URL || PKG.homepage || "").replace(/\/*$/, "/");
const SITE_NAME = PKG.bh?.siteName || "Bitwise Engineering";
const REPO_URL = String(process.env.BH_REPO_URL || PKG.bh?.repoUrl || "").replace(/\/*$/, "");
const SHARED_CARD = "theme/logo/og.png"; // the home page's card, and the fallback for every other
/** The shared card's alt text: the <title> of its source, theme/logo/og-card.svg, so the two cannot drift. */
const SHARED_CARD_ALT: string = (() => {
  try {
    const svg = fs.readFileSync(path.join(ROOT, "theme", "logo", "og-card.svg"), "utf8");
    return svg.match(/<title\b[^>]*>([^<]*)<\/title>/)?.[1].trim() || SITE_NAME;
  } catch { return SITE_NAME; }
})();
const LOGO_TILE = path.join(ROOT, "theme", "logo", "mark-tile.svg");
const CARD_DIR = path.join(DOCS, "assets", "og");
const CARD_W = 1200, CARD_H = 630;
const SOCIAL_START = "<!-- bh:social:start (generated by `npm run index`; do not edit) -->";
const SOCIAL_END = "<!-- bh:social:end -->";
const ROBOTS_NOINDEX = '<meta name="robots" content="noindex, nofollow">';
const SOCIAL_RE = /[ \t]*<!-- bh:social:start\b[\s\S]*?<!-- bh:social:end -->/;
const DESCRIPTION_MAX = 200; // chat apps and crawlers truncate beyond about this

const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const attr = (s: unknown) => String(s).replace(/"/g, "&quot;");

/** HTML text → plain text, for drawing a title on a card. One pass, so "&amp;#65;" stays "&#65;". */
function decodeHtml(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", times: "×", middot: "·",
    apos: "'", copy: "©", reg: "®", trade: "™", deg: "°", minus: "−", le: "≤", ge: "≥", ne: "≠", larr: "←", rarr: "→", harr: "↔",
    eacute: "é", egrave: "è", aacute: "á", agrave: "à", iacute: "í", oacute: "ó", uacute: "ú", ccedil: "ç", ntilde: "ñ", auml: "ä", ouml: "ö", uuml: "ü", szlig: "ß" };
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : named[name!] ?? m);
}

/**
 * The block of social tags for `m`: { type, title, description, url, image, alt, published?, authors?, tags? }.
 * title, description, alt, authors and tags are HTML text as written in the page; urls and the site name are plain.
 */
function socialBlock(m: SocialMeta): string {
  const tag = (k: string, v: string, a = "property") => `  <meta ${a}="${k}" content="${attr(v)}">`;
  return [
    `  ${SOCIAL_START}`,
    `  <link rel="canonical" href="${escapeHtml(m.url)}">`,
    tag("og:type", m.type),
    tag("og:site_name", escapeHtml(SITE_NAME)),
    tag("og:title", m.title),
    tag("og:description", m.description),
    tag("og:url", escapeHtml(m.url)),
    tag("og:image", escapeHtml(m.image)),
    tag("og:image:type", "image/png"),
    tag("og:image:width", String(CARD_W)),
    tag("og:image:height", String(CARD_H)),
    tag("og:image:alt", m.alt),
    ...(m.published ? [tag("article:published_time", m.published)] : []),
    ...(m.authors || []).map((a) => tag("article:author", a)),
    ...(m.tags || []).map((t) => tag("article:tag", t)),
    tag("twitter:card", "summary_large_image", "name"),
    // An unlisted page asks crawlers to leave it out. It is the author's marker that decides, not a tag they write.
    ...(m.noindex ? [`  ${ROBOTS_NOINDEX}`] : []),
    ...(m.jsonLd ? [`  ${jsonLdScript(m.jsonLd)}`] : []),
    `  ${SOCIAL_END}`,
  ].join("\n");
}

// -- JSON-LD (schema.org) structured data, one line inside the social block --------------------
//
// A post gets a TechArticle, the home page a WebSite. Example, unlisted and `reference` pages get
// none (an unlisted page is noindex; examples are removed at deploy; the glossary and gallery are
// not posts, as in the feed), and sealed shells are frozen without a social block at all.

/** A JSON-LD script's opening tag, in any attribute order; LD_RE also captures its text. */
const LD_TAG = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json\b[^>]*>/i;
const LD_RE = new RegExp(`${LD_TAG.source}([\\s\\S]*?)<\\/script>`, "gi");

/**
 * `data` as a script element. A script's text is raw: entities are not decoded, and `</` (or
 * `<!--`, which puts the parser in its escaped state) inside a string could end it early. Both are
 * written as JSON escapes, so JSON.parse still gives back the original text.
 */
function jsonLdScript(data: JsonLd): string {
  const json = JSON.stringify(data).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--");
  return `<script type="application/ld+json">${json}</script>`;
}

const ldPublisher = (): JsonLd => ({
  "@type": "Organization", name: SITE_NAME, url: SITE_URL,
  logo: { "@type": "ImageObject", url: SITE_URL + "theme/logo/apple-touch-icon.png" },
});

/** Whether a public page is a post that carries a TechArticle block. */
const hasArticleLd = (d: Doc) => !d.example && !d.unlisted && !FEED_NON_POST_KINDS.has(d.kind);

/** The TechArticle for a post; its text fields are the page's HTML text, decoded. */
function articleLd(d: Doc, image: string): JsonLd {
  const authors = metaList(d.authors).map(decodeHtml), tags = metaList(d.tags).map(decodeHtml);
  return {
    "@context": "https://schema.org", "@type": "TechArticle",
    headline: decodeHtml(d.title), description: decodeHtml(d.description),
    ...(validFeedDate(d.date) ? { datePublished: d.date } : {}),
    ...(authors.length ? { author: authors.map((name) => ({ "@type": "Person", name })) } : {}),
    ...(tags.length ? { keywords: tags.join(", ") } : {}),
    url: pageUrl(d.href), image, publisher: ldPublisher(),
  };
}

/** The home page's WebSite block. */
const websiteLd = (description: string): JsonLd => ({
  "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: SITE_URL,
  ...(description ? { description: decodeHtml(description) } : {}), publisher: ldPublisher(),
});

/**
 * `html` with each JSON-LD block's own `url` and `image` removed, for a standalone file that has
 * neither. The publisher (the site's name, link and logo) stays, like the footer's attribution
 * link. A block that does not parse is dropped, with a warning, rather than shipped with its links.
 */
function withoutLdLinks(html: string, label: string): string {
  return html.replace(LD_RE, (_whole, json: string) => {
    try {
      const { url: _url, image: _image, ...rest } = JSON.parse(json) as JsonLd;
      return jsonLdScript(rest as JsonLd);
    } catch {
      console.warn(c.yellow(`${label}: dropped a JSON-LD block that is not valid JSON (run \`npm run index\` and \`npm run check\`)`));
      return "";
    }
  });
}

/** A comma-separated bh:* meta (authors, tags) as a list, still HTML text. */
const metaList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const pageUrl = (href: string) => SITE_URL + href;
const cardPath = (file: string) => path.join(CARD_DIR, path.basename(file, ".html") + ".png");
const cardHref = (file: string) => path.relative(ROOT, cardPath(file)).split(path.sep).join("/");

/** The block a public page (or index.html) must carry. */
function expectedSocial(file: string): string {
  if (file === INDEX) {
    const html = stripComments(fs.readFileSync(INDEX, "utf8"));
    return socialBlock({ type: "website", title: getTitle(html), description: getMeta(html, "description"), url: SITE_URL, image: SITE_URL + SHARED_CARD, alt: SHARED_CARD_ALT, jsonLd: websiteLd(getMeta(html, "description")) });
  }
  const d = readDoc(file);
  const sel = chooseVisual(file);
  return socialBlock({
    type: "article", title: d.title, description: d.description, url: pageUrl(d.href), image: SITE_URL + cardHref(file),
    alt: escapeHtml(sel.label ? `${decodeHtml(d.title)}: ${sel.label}` : `${decodeHtml(d.title)} (${KIND_LABELS[d.kind] || d.kind}, ${SITE_NAME})`),
    published: d.date, authors: metaList(d.authors), tags: metaList(d.tags), noindex: d.unlisted,
    jsonLd: hasArticleLd(d) ? articleLd(d, SITE_URL + cardHref(file)) : undefined,
  });
}

/** `raw` with its social block replaced, or inserted (before the theme script) when it has none. */
function withSocial(raw: string, block: string): string {
  if (SOCIAL_RE.test(raw)) return raw.replace(SOCIAL_RE, () => block);
  // First time: tags written by hand move into the block.
  const stripped = raw
    .replace(/^[ \t]*<meta\s+(?:property="(?:og|article):|name="twitter:)[^>]*>\n/gm, "")
    .replace(/^[ \t]*<link\s+rel="canonical"[^>]*>\n/gm, "");
  const at = stripped.search(/^[ \t]*<script>try\{var t=localStorage/m);
  if (at >= 0) return stripped.slice(0, at) + block + "\n" + stripped.slice(at);
  return stripped.replace(/^[ \t]*<\/head>/m, (m) => block + "\n" + m);
}

// -- choosing the card's visual: static, so `check` needs no browser -----------------------------

/**
 * The visual a page's card shows, first match wins:
 *   1. <meta name="bh:image">: "#element-id" on the page, or a path to an image file
 *   2. the first <figure> holding an <svg>, <img>, <bh-sequence> or <bh-chart>
 *   3. a standalone <img> in the article
 *   4. the hero glyph (.bh-hero-mark / [data-bh-logo])
 *   5. the logo tile
 * Returns { tier, css, index } (an element of the page, found with querySelectorAll(css)[index])
 * or { tier, image } (a file), plus `label` (its aria-label/alt), `source` and `files`
 * (what the card's staleness key hashes) and `problem` when an override can't be resolved.
 */
const visuals = new Map<string, { raw: string; result: Visual }>();
function chooseVisual(file: string): Visual {
  const raw = fs.readFileSync(file, "utf8");
  const hit = visuals.get(file);
  if (hit?.raw === raw) return hit.result; // `index` and `check` ask twice per page
  const result = pickVisual(file, raw);
  visuals.set(file, { raw, result });
  return result;
}

function pickVisual(file: string, raw: string): Visual {
  const { root, src } = parseTree(raw);
  const dir = path.dirname(file);
  const article = findNode(root, (n) => hasClass(n, "bh-article"));
  const inner = (n: TreeNode) => (VOID_TAGS.has(n.tag) ? "" : src.slice(n.start, n.end));
  const markup = (n: TreeNode) => `<${n.tag}${n.attrs}>${inner(n)}`;
  const VIS = /<(svg|img|bh-sequence|bh-chart)\b/;
  const label = (n: TreeNode) => {
    const t = markup(n);
    return decodeHtml((t.match(/aria-label="([^"]+)"/) || t.match(/\balt="([^"]+)"/) || [])[1] || "");
  };
  const files = (n: TreeNode) => [...markup(n).matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/^(https?:|data:|\/\/)/.test(u)).map((u) => path.resolve(dir, decodeURI(u.split(/[?#]/)[0])));
  const element = (n: TreeNode, tier: Visual["tier"], css: string, index: number): Visual => ({ tier, css, index, label: label(n), source: markup(n), files: files(n) });
  const byId = (id: string) => `[id="${id}"]`;

  const override = getMeta(stripComments(raw), "bh:image");
  if (override.startsWith("#")) {
    const n = findNode(root, (x) => nodeAttr(x, "id") === override.slice(1));
    if (!n) return { tier: "override", image: null, label: "", source: "", files: [], problem: `bh:image="${override}": no element with that id` };
    return element(n, "override", byId(override.slice(1)), 0);
  }
  if (override) {
    const image = path.resolve(dir, override);
    const problem = !fs.existsSync(image) ? `bh:image="${override}": no such file` : !MIME[path.extname(image).toLowerCase()] ? `bh:image="${override}": not an image file` : undefined;
    return { tier: "override", image, label: "", source: "", files: [image], problem };
  }
  if (article) {
    let figures = -1, hit = null as { n: TreeNode; index: number } | null;
    walkTree(article, (n) => { if (n.tag === "figure") { figures++; if (!hit && VIS.test(markup(n))) hit = { n, index: figures }; } });
    if (hit) {
      const id = nodeAttr(hit.n, "id");
      return id ? element(hit.n, "figure", byId(id), 0) : element(hit.n, "figure", ".bh-article figure", hit.index);
    }
    const img = findNode(article, (n) => n.tag === "img");
    if (img) return element(img, "image", ".bh-article img", 0);
    const glyph = findNode(article, (n) => hasClass(n, "bh-hero-mark") || /\sdata-bh-logo\b/.test(n.attrs));
    if (glyph) return { tier: "glyph", image: LOGO_TILE, label: "", source: "glyph", files: [LOGO_TILE] };
  }
  return { tier: "logo", image: LOGO_TILE, label: "", source: "logo", files: [LOGO_TILE] };
}

/** Hash of the shared files every card is drawn from: the card layout, the logo, the theme CSS, the fonts and bh.js (which adds a diagram's arrowhead markers). */
let sharedCardInputs: string | null = null;
const cardInputsHash = (withModules: boolean): string => {
  if (sharedCardInputs === null) {
    const fontDir = path.join(ROOT, "theme", "fonts");
    const fonts = fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter((f) => f.endsWith(".woff2")).sort().map((f) => `theme/fonts/${f}`) : [];
    sharedCardInputs = sha256(["scripts/cards.mts", "theme/logo/mark.svg", "theme/bh.js", ...["fonts", "tokens", "base", "layout", "components", "diagrams"].map((f) => `theme/${f}.css`), ...fonts]
      .map((f) => sha256(fs.readFileSync(path.join(ROOT, f)))).join("\0")); // per-file hashes: the fonts are binary
  }
  if (!withModules) return sharedCardInputs;
  // <bh-…> components (charts, sequences, …) are drawn by the on-demand modules.
  const dir = path.join(ROOT, "theme", "modules");
  return sha256(sharedCardInputs + fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\0"));
};

/** Everything that decides how a page's card looks. Any change here makes the card stale. */
function cardJob(file: string): CardJob {
  const d = readDoc(file);
  const sel = chooseVisual(file);
  const styles = [...stripComments(fs.readFileSync(file, "utf8")).matchAll(/<style\b[\s\S]*?<\/style>/g)].map((m) => m[0]).join("\n");
  const kind = KIND_LABELS[d.kind] || d.kind;
  const bytes = (f: string) => (fs.existsSync(f) ? sha256(fs.readFileSync(f)) : "missing");
  const key = sha256(JSON.stringify([
    cardInputsHash(/<bh-/.test(sel.source)), d.title, kind, d.date, SITE_NAME, sel.tier, sel.css, sel.index, sel.source, styles, sel.files.map(bytes),
  ]));
  return {
    slug: path.basename(file, ".html"), href: d.href, out: cardPath(file), key, selection: sel,
    frame: { title: decodeHtml(d.title), kind, date: d.date, siteName: SITE_NAME },
  };
}

// Each card's key and the hash of its PNG live in social-cards.txt, not in the PNG (scripts/card-records.mts),
// so a re-render that draws the same pixels leaves the PNG's bytes alone. Cards drawn before that still
// carry a `bh-card` tEXt chunk; nothing reads it.
const CARD_RECORDS = path.join(ROOT, CARD_RECORDS_FILE);
/** social-cards.txt as written, or null when there is none. */
const cardRecordsText = (): string | null => (fs.existsSync(CARD_RECORDS) ? fs.readFileSync(CARD_RECORDS, "utf8") : null);

function orphanCards(): string[] {
  const slugs = new Set(docFiles().map((f) => path.basename(f, ".html")));
  return fs.existsSync(CARD_DIR) ? fs.readdirSync(CARD_DIR).filter((f) => f.endsWith(".png") && !slugs.has(f.slice(0, -4))) : [];
}

/** Problems with social-cards.txt as a whole: missing, a line it cannot read, not canonical, or a record of no public page. */
function cardRecordProblems(): string[] {
  const text = cardRecordsText();
  if (text === null) return [`${CARD_RECORDS_FILE} is missing: run \`npm run cards\``];
  const { records, problems } = parseCardRecords(text);
  const slugs = new Set(docFiles().map((f) => path.basename(f, ".html")));
  return [
    ...problems.map((p) => `${CARD_RECORDS_FILE}: ${p}: run \`npm run cards\``),
    ...(!problems.length && renderCardRecords(records) !== text ? [`${CARD_RECORDS_FILE} is not in its canonical form (the header, then one card per line in slug order): run \`npm run cards\``] : []),
    ...[...records.keys()].filter((s) => !slugs.has(s)).map((s) => `${CARD_RECORDS_FILE} records ${s}, which is no public page: run \`npm run cards\` to remove it`),
  ];
}

/** Problems with the site base: it has to be an absolute http(s) URL, since crawlers need that. */
function siteUrlProblems(): string[] {
  return /^https?:\/\/[^/\s]+\/(\S*\/)?$/.test(SITE_URL) ? [] : [`site base "${SITE_URL}" must be an absolute http(s) URL: set "homepage" in package.json (or BH_SITE_URL)`];
}

async function cmdCards(argv: string[]): Promise<void> {
  const force = argv.includes("--force");
  for (const f of orphanCards()) {
    fs.rmSync(path.join(CARD_DIR, f));
    console.log(c.dim(`Removed docs/assets/og/${f} (no public page has that name)`));
  }
  const jobs = docFiles().map(cardJob);
  for (const j of jobs) if (j.selection.problem) throw new Error(`${j.href}: ${j.selection.problem}`);
  // A line it cannot read, or a slug listed twice (a conflict left in the file), is no record: that card is drawn again.
  const before = cardRecordsText();
  const { records } = parseCardRecords(before ?? "");
  const slugs = new Set(jobs.map((j) => j.slug));
  for (const s of [...records.keys()].filter((s) => !slugs.has(s))) {
    records.delete(s);
    console.log(c.dim(`Removed ${s} from ${CARD_RECORDS_FILE} (no public page has that name)`));
  }
  const pngHash = (f: string) => (fs.existsSync(f) ? sha256(fs.readFileSync(f)) : null);
  // Current: the record names this key, and the PNG on disk is the one it was recorded with.
  const current = (j: CardJob) => { const r = records.get(j.slug); return !!r && r.key === j.key && r.png === pngHash(j.out); };
  const todo = jobs.filter((j) => force || !current(j));
  const save = () => {
    const text = renderCardRecords(records);
    if (text !== before) { fs.writeFileSync(CARD_RECORDS, text); console.log(c.dim(`Wrote ${CARD_RECORDS_FILE}`)); }
  };
  if (!todo.length) { save(); console.log(c.green(`All ${jobs.length} cards are up to date.`)); return; }
  const { renderCards } = await import("./cards.mts");
  const r = await renderCards(todo, { sharedCard: path.join(ROOT, SHARED_CARD), systemFonts: argv.includes("--system-fonts") });
  // A card that failed keeps its old record, so `check` still calls it stale. Without Chrome every job is a fallback.
  for (const j of todo) if (!r.failed.includes(j.href)) records.set(j.slug, { key: r.fallback ? "fallback" : j.key, png: pngHash(j.out)! });
  save();
  console.log(c.green(`Rendered ${r.rendered} card${r.rendered === 1 ? "" : "s"}`) + (r.unchanged ? c.green(`, ${r.unchanged} drawn again with the same pixels (PNG kept)`) : "") + (r.fallback ? c.yellow(`, ${r.fallback} fell back to the shared card`) : "") + c.dim(`, ${jobs.length - todo.length} already up to date`));
  if (r.failed.length) throw new Error(`could not render the card of ${r.failed.join(", ")}`);
}

// ---- new --------------------------------------------------------------------------

function cmdNew(argv: string[]): void {
  const isPrivate = argv.includes("--private");
  const isExample = argv.includes("--example");
  const isUnlisted = argv.includes("--unlisted");
  const [template, slug, title, description] = argv.filter((a) => a !== "--private" && a !== "--example" && a !== "--unlisted");
  const templates = fs.readdirSync(TEMPLATES).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
  if (!template || !slug || !title) {
    console.error(`Usage: bh new [--private] [--example] [--unlisted] <template> <slug> "<Title>" ["<description>"]\nTemplates: ${templates.join(", ")}`);
    process.exit(2);
  }
  if (isPrivate && isExample) {
    console.error(c.red("--private and --example don't combine: a private page is never listed, so it is never an example."));
    process.exit(2);
  }
  if (isPrivate && isUnlisted) {
    console.error(c.red("--private and --unlisted don't combine: a private page already stays off the site, and is never listed."));
    process.exit(2);
  }
  if (!templates.includes(template)) {
    console.error(c.red(`Unknown template "${template}". Choose one of: ${templates.join(", ")}`));
    process.exit(2);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    console.error(c.red(`Slug must be kebab-case: "${slug}"`));
    process.exit(2);
  }
  const out = path.join(DOCS, `${slug}${isPrivate ? PRIVATE_EXT : ".html"}`);
  if (fs.existsSync(out) || fs.existsSync(path.join(DOCS, `${slug}${isPrivate ? ".html" : PRIVATE_EXT}`))) {
    console.error(c.red(`Refusing to overwrite ${path.relative(ROOT, out)}`));
    process.exit(1);
  }
  let author = "";
  try { author = execSync("git config user.name", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  const vars: Record<string, string> = {
    title: escapeHtml(title),
    description: escapeHtml(description || "One sentence: what the reader will understand by the end."),
    date: new Date().toISOString().slice(0, 10),
    author: escapeHtml(author),
    slug,
  };
  let html = fs.readFileSync(path.join(TEMPLATES, `${template}.html`), "utf8")
    .replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  if (isExample) {
    const marked = html.replace(/^(  <meta name="bh:tags" content="[^"]*">\n)/m, `$1  <meta name="bh:example" content="true">\n`);
    if (marked === html) { console.error(c.red(`templates/${template}.html has no bh:tags line to add the example marker after`)); process.exit(1); }
    html = marked;
  }
  if (isUnlisted) {
    const marked = html.replace(/^(  <meta name="bh:tags" content="[^"]*">\n)/m, `$1  <meta name="bh:unlisted" content="true">\n`);
    if (marked === html) { console.error(c.red(`templates/${template}.html has no bh:tags line to add the unlisted marker after`)); process.exit(1); }
    html = marked;
  }
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(out, html);
  console.log(c.green(`Created ${path.relative(ROOT, out)}`));
  if (isPrivate) console.log(c.dim("Private page: it is git-ignored. Run `npm run seal` to publish an encrypted copy."));
  else {
    if (isExample) console.log(c.dim("Example page: hidden by default, here and on the published site; open any page with ?examples to see it."));
    if (isUnlisted) console.log(c.dim("Unlisted page: published, but off the home page, search and links unless a page is opened with #unlisted=true. Not private: anyone with the link can read it."));
    console.log(c.dim("When the page is written, run `npm run cards` to render its social card."));
  }
  cmdIndex();
}

// ---- glossary ---------------------------------------------------------------------
//
// docs/glossary.html is the single source: <dl class="glossary"> with
// <dt id="…" data-aliases="a, b">Term</dt><dd>…html…</dd>. It compiles to
// theme/glossary.js, which bh.js loads on every page (works from file://, unlike fetch).
// Relative links in definitions are rebased to the site root.

function attrOf(attrs: string, name: string): string | undefined {
  return (attrs.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
}

/** Entries from every <dl class="glossary"> in an HTML string (comments stripped). */
function parseGlossary(html: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const dl of stripComments(html).matchAll(/<dl\b[^>]*\sclass="[^"]*\bglossary\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/g)) {
    for (const m of dl[1].matchAll(/<dt\b([^>]*)>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)) {
      entries.push({
        id: attrOf(m[1], "id"),
        term: decodeEntities(m[2].replace(/<[^>]+>/g, "")).trim(),
        aliases: (attrOf(m[1], "data-aliases") || "").split(",").map((a) => decodeEntities(a).trim()).filter(Boolean),
        html: m[3].trim().replace(/\s+\n/g, "\n"),
      });
    }
  }
  return entries;
}

function compileGlossary(): { entries: (GlossaryEntry & { href: string })[]; js: string } {
  const header = "/* GENERATED by `npm run index` from docs/glossary.html. Edit that page, not this file. */\n";
  if (!fs.existsSync(GLOSSARY_SRC)) return { entries: [], js: header + "window.BH_GLOSSARY = [];\n" };
  const rebase = (html: string) => html.replace(/(\s(?:href|src)=")([^"]+)(")/g, (m, a, url, b) => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return m;
    if (url.startsWith("#")) return a + "docs/glossary.html" + url + b;
    return a + path.posix.normalize(path.posix.join("docs", url)) + b;
  });
  const entries = parseGlossary(fs.readFileSync(GLOSSARY_SRC, "utf8"))
    .map((e) => ({ id: e.id, term: e.term, aliases: e.aliases, html: rebase(e.html), href: `docs/glossary.html#${e.id}` }));
  return { entries, js: header + "window.BH_GLOSSARY = " + JSON.stringify(entries, null, 2) + ";\n" };
}

/** Problems in a list of glossary entries: missing ids, duplicate ids/names. */
function glossaryProblems(entries: GlossaryEntry[]): string[] {
  const out: string[] = [], ids = new Set<string>(), names = new Map<string, string>();
  for (const e of entries) {
    if (!e.id) { out.push(`glossary term "${e.term}" has no id`); continue; }
    if (ids.has(e.id)) out.push(`duplicate glossary id "${e.id}"`);
    ids.add(e.id);
    if (!e.html.replace(/<[^>]+>/g, "").trim()) out.push(`glossary term "${e.id}" has an empty definition`);
    for (const n of [e.term, ...e.aliases]) {
      const k = n.toLowerCase();
      if (names.has(k) && names.get(k) !== e.id) out.push(`"${n}" names both "${names.get(k)}" and "${e.id}"`);
      names.set(k, e.id);
    }
  }
  return out;
}

// ---- site data: search index & backlinks ---------------------------------------------
//
// theme/site.js (every page): page metadata + "referenced by" backlinks.
// theme/search-index.js (loaded on first search): section-level text of every doc and
// every glossary entry. Both are generated by `npm run index`; `check` fails when stale.

const SECTION_TEXT_MAX = 4000;

/** The article split at h2/h3 ids: [{ id, heading, html, text }]. The part before the
    first heading (hero, TL;DR) has id "". */
function extractSections(html: string): { id: string; heading: string; html: string; text: string }[] {
  // The generated list and banner are the page's metas again, not its words: no search text, no backlink.
  const art = stripComments(withoutHeroMeta(html)).match(/<article\b[^>]*class="[^"]*\bbh-article\b[^"]*"[^>]*>([\s\S]*)<\/article>/);
  if (!art) return [];
  const body = art[1]
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(DISCUSS_RE, " ");
  return body.split(/(?=<h[23]\b[^>]*\sid="[^"]+"[^>]*>)/).map((part) => {
    const h = part.match(/^<h[23]\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/);
    const rest = h ? part.slice(h[0].length) : part;
    const text = decodeEntities(rest.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, SECTION_TEXT_MAX);
    return { id: h ? h[1] : "", heading: h ? decodeEntities(h[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "", html: part, text };
  });
}

/** The card markup for one page of the home list (the markup lives in scripts/private-cards.mts). `titles` maps hrefs to titles for "Replaced by".
    theme/modules/unlisted-cards.js and private-cards.js build the same card in the browser (tests compare them). */
const cardHtml = (d: Doc, titles: Map<string, string>, tags = docTopics(d)) => docCardHtml(d, tags, titles);

const byDateThenTitle = (a: { date: string; title: string }, b: { date: string; title: string }) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title);

interface SearchEntry { href: string; title: string; kind: string; example?: boolean; sections: { id: string; heading: string; text: string }[] }

function buildSiteData() {
  const docs = docFiles().map((f) => ({ ...readDoc(f), html: fs.readFileSync(f, "utf8") }));
  const known = new Set(docs.map((d) => d.href));
  const hidden = new Set(docs.filter((d) => d.unlisted).map((d) => d.href)); // unlisted pages
  const titles = new Map(docs.map((d) => [d.href, d.title]));
  const pageOf = ({ href, title, kind, status, date, description, supersedes, supersededBy, example }: Doc) => ({ href, title, kind, status, date, description, supersedes, supersededBy, ...(example ? { example: true } : {}) });
  const pages = docs.filter((d) => !hidden.has(d.href)).map(pageOf);
  // What the site leaves out unless the reader opts in: unlisted pages, their search text, and any
  // backlink that starts or ends at one. Kept apart so the default page load never fetches them.
  const backlinks: Record<string, { href: string; title: string; section: string }[]> = {}, unlistedBacklinks: typeof backlinks = {};
  const search: SearchEntry[] = [], unlistedSearch: SearchEntry[] = [];
  for (const d of docs) {
    const sections = extractSections(d.html);
    const entry = { href: d.href, title: d.title, kind: d.kind, ...(d.example ? { example: true } : {}), sections: sections.map(({ id, heading, text }) => ({ id, heading, text })).filter((x) => x.text || x.heading) };
    (hidden.has(d.href) ? unlistedSearch : search).push(entry);
    for (const sec of sections) {
      for (const m of sec.html.matchAll(/\shref="([^"#?]+\.html)(?:[#?][^"]*)?"/g)) {
        if (/^[a-z]+:/i.test(m[1])) continue;
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(d.href), m[1]));
        if (target === d.href || !known.has(target)) continue;
        const into = hidden.has(d.href) || hidden.has(target) ? unlistedBacklinks : backlinks;
        const list = (into[target] = into[target] || []);
        const from = d.href + (sec.id ? "#" + sec.id : "");
        if (!list.some((b) => b.href === from)) list.push({ href: from, title: d.title, section: sec.heading });
      }
    }
  }
  for (const e of compileGlossary().entries) {
    search.push({ href: e.href, title: e.term, kind: "glossary", sections: [{ id: "", heading: e.aliases.join(", "), text: decodeEntities(e.html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }] });
  }
  const header = "/* GENERATED by `npm run index` from docs/. Do not edit. */\n";
  const reviews: Record<string, { threads: number; open: number }> = {}; // threads per document, so pages load review only when needed
  for (const [href, summary] of Object.entries(compileReviews().summary)) if (!hidden.has(href)) reviews[href] = summary;
  const unlisted = docs.filter((d) => hidden.has(d.href)).sort(byDateThenTitle).map((d) => ({
    slug: path.posix.basename(d.href, ".html"), ...pageOf(d), kindLabel: KIND_LABELS[d.kind] || d.kind, tags: docTopics(d), unlisted: true,
    ...(d.supersededBy ? { replacedBy: { href: d.supersededBy, title: titles.get(d.supersededBy) || d.supersededBy } } : {}),
  }));
  return {
    site: header + "window.BH_SITE = " + JSON.stringify({ pages, backlinks, reviews }, null, 1) + ";\n",
    search: header + "window.BH_SEARCH = " + JSON.stringify(search) + ";\n",
    unlisted: header + "window.BH_UNLISTED = " + JSON.stringify({ v: 1, pages: unlisted, backlinks: unlistedBacklinks, search: unlistedSearch }, null, 1) + ";\n",
    unlistedSlugs: header + "window.BH_UNLISTED_SLUGS = " + JSON.stringify(unlisted.map((p) => p.href), null, 1) + ";\n",
    counts: { pages: pages.length, links: Object.values(backlinks).reduce((a, b) => a + b.length, 0), entries: search.length, unlisted: unlisted.length },
  };
}

// ---- Atom feed ----------------------------------------------------------------------
//
// feed.xml at the site root, generated by `npm run index` from the same page data as the home
// page. Entries are the posts the site surfaces: public, listed, not an example and not a
// `reference` page (the glossary and component gallery). Newest first, each with its summary; a
// post with <meta name="bh:feed" content="full"> also carries its article as <content type="html">
// (scripts/feed-content.mts). Every page advertises the feed with a <link rel="alternate"> and a
// visible "Subscribe" link in its footer.

const FEED_OUT = path.join(ROOT, "feed.xml");
const FEED_FILE = "feed.xml";
const FEED_NON_POST_KINDS = new Set(["reference"]);
const FEED_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date: "2026-13-45" has the shape but would make an invalid Atom timestamp. */
const validFeedDate = (d: string) => FEED_DATE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().startsWith(d);

/** The pages that belong in the feed, newest first. */
function feedPosts(): Doc[] {
  return listedDocFiles().map(readDoc)
    .filter((d) => !d.example && !FEED_NON_POST_KINDS.has(d.kind) && validFeedDate(d.date))
    .sort(byDateThenTitle);
}

const xmlEscape = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** HTML text as written in a page → text safe inside XML. */
const xmlText = (html: string) => xmlEscape(decodeHtml(html));
const atomDate = (d: string) => `${d}T00:00:00Z`;

/**
 * A page that quotes private writing under a LEAK_ALLOWED allowance (scripts/leak-allowed.mts). The
 * allowance covers that page, not feed.xml, so its text never goes into the feed: `check` refuses its
 * bh:feed, and the feed carries its summary only.
 */
const quotesPrivateWriting = (d: Doc) => Object.hasOwn(LEAK_ALLOWED, d.href);

/** Page URLs a feed entry's content must not link to (HIDDEN_RULE.feed in scripts/hidden-pages.mts). */
const feedHiddenUrls = (): Set<string> => new Set([...hiddenHrefs(ROOT, "feed")].map(pageUrl));

function buildFeed(posts: Doc[] = feedPosts()): string {
  const home = stripComments(fs.readFileSync(INDEX, "utf8"));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  let hidden: Set<string> | undefined;
  const content = (d: Doc) => {
    if (d.feed !== "full" || quotesPrivateWriting(d)) return [];
    const html = stripComments(fs.readFileSync(d.file, "utf8"));
    hidden ??= feedHiddenUrls();
    return [`    <content type="html">${xmlEscape(feedContent(html, { pageUrl: pageUrl(d.href), hidden: (u) => hidden!.has(u) }))}</content>`];
  };
  const entries = posts.map((d) => [
    "  <entry>",
    `    <id>${xmlEscape(pageUrl(d.href))}</id>`,
    `    <title>${xmlText(d.title)}</title>`,
    `    <link rel="alternate" type="text/html" href="${xmlEscape(pageUrl(d.href))}"/>`,
    `    <published>${atomDate(d.date)}</published>`,
    `    <updated>${atomDate(d.date)}</updated>`,
    ...list(d.authors).map((a) => `    <author><name>${xmlText(a)}</name></author>`),
    ...list(d.tags).map((t) => `    <category term="${xmlText(t)}"/>`),
    `    <summary>${xmlText(d.description)}</summary>`,
    ...content(d),
    "  </entry>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- GENERATED by `npm run index`. Do not edit. -->",
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${xmlEscape(SITE_URL)}</id>`,
    `  <title>${xmlText(SITE_NAME)}</title>`,
    ...(getMeta(home, "description") ? [`  <subtitle>${xmlText(getMeta(home, "description"))}</subtitle>`] : []),
    `  <link rel="alternate" type="text/html" href="${xmlEscape(SITE_URL)}"/>`,
    `  <link rel="self" type="application/atom+xml" href="${xmlEscape(SITE_URL + FEED_FILE)}"/>`,
    `  <updated>${posts.length ? atomDate(posts[0].date) : "1970-01-01T00:00:00Z"}</updated>`,
    `  <author><name>${xmlText(SITE_NAME)}</name></author>`,
    "  <generator>beautiful-html</generator>",
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}

/** The autodiscovery tag a page must carry; `prefix` is the path from the page to the site root. */
const feedLinkTag = (prefix: string) => `<link rel="alternate" type="application/atom+xml" title="${attr(escapeHtml(SITE_NAME))}" href="${prefix}${FEED_FILE}">`;
/** The footer link that makes the feed visible to readers. */
const feedFooterLink = (prefix: string) => `<a href="${prefix}${FEED_FILE}">Subscribe</a>`;
const FEED_LINK_RE = /^[ \t]*<link\b(?=[^>]*\brel="alternate")(?=[^>]*\btype="application\/atom\+xml")[^>]*>\n?/gm;
const feedPrefix = (file: string) => (file === INDEX ? "" : "../");

/** The attribution every footer carries: absolute links back to the blog and its repo, so it still works in a bundle or a copy. */
const attributionSpan = () => `<span data-attribution>From <a href="${attr(SITE_URL)}">${escapeHtml(SITE_NAME)}</a> · <a href="${attr(REPO_URL)}">source</a></span>`;
const ATTRIBUTION_RE = /^([ \t]*)<span data-attribution>[\s\S]*?<\/span>\n?/m;

/** `raw` with its footer attribution written: replaced if present, else added after the Subscribe link. */
function withAttribution(raw: string): string {
  const span = attributionSpan();
  if (ATTRIBUTION_RE.test(raw)) return raw.replace(ATTRIBUTION_RE, (m, indent) => `${indent}${span}\n`);
  return raw.replace(/^([ \t]*)(<span><a href="(?:\.\.\/)?feed\.xml">Subscribe<\/a><\/span>)\n/m, (m, indent, sub) => `${indent}${sub}\n${indent}${span}\n`);
}

// ---- "Discuss this post" ------------------------------------------------------------
//
// Every post the site surfaces ends with a static block that links to its conversation on GitHub
// Discussions, and to the Review panel for comments on one passage. `npm run index` writes it just
// before the footer, as it writes the attribution, so it works without JavaScript; `check` requires
// it on exactly the posts that should have it. One thread per page, keyed by the canonical URL: the
// block searches the repo's discussions for that URL, and its "start it" link prefills a new thread
// whose body carries it. A page can pin its thread (bh:discuss = the thread's URL) or opt out (off).

/** The repo's discussions, from package.json `bh.discussionsUrl` (default `<bh.repoUrl>/discussions`). "" switches the block off. */
// An empty environment variable falls back to package.json, as BH_REPO_URL does; only package.json's "" switches it off.
const DISCUSSIONS_URL = String(process.env.BH_DISCUSSIONS_URL || (PKG.bh?.discussionsUrl ?? (REPO_URL ? `${REPO_URL}/discussions` : ""))).replace(/\/*$/, "");
const DISCUSSION_CATEGORY = String(PKG.bh?.discussionCategory || "general");
const DISCUSSIONS_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)(?<!\.git)\/discussions$/; // not a clone URL
/** Why the discussions setting can't be used, or "" when it can (or is switched off). */
const discussConfigProblem = () =>
  DISCUSSIONS_URL && !DISCUSSIONS_RE.test(DISCUSSIONS_URL) ? `package.json bh.discussionsUrl must be https://github.com/OWNER/REPO/discussions (got "${DISCUSSIONS_URL}")`
  : !/^[a-z0-9-]+$/.test(DISCUSSION_CATEGORY) ? `package.json bh.discussionCategory must be a category slug such as "general" (got "${DISCUSSION_CATEGORY}")` : "";
const DISCUSS_RE = /^[ \t]*<aside\b[^>]*\sdata-discuss(?=[\s>=])[^>]*>[\s\S]*?<\/aside>[ \t]*(?:\n[ \t]*(?=\n))?\n?/gm;
const DISCUSS_TITLE = '"Discuss this post" block';
const FOOTER_LINE_RE = /^([ \t]*)<footer class="bh-footer"/m;

/** "" when `file` gets the block, else the reason it doesn't. */
function discussExclusion(file: string, html: string): string {
  if (file === INDEX) return "it is the home page";
  if (file.startsWith(TEMPLATES + path.sep)) return "it is a template (`npm run index` writes the block into each post)";
  if (isPrivateSource(file)) return "it is a private page, which must not point at a public thread";
  if (!DISCUSSIONS_URL || discussConfigProblem()) return "discussions are switched off in package.json (bh.discussionsUrl)";
  const d = readDoc(file);
  if (d.unlisted) return "it is an unlisted page, and a public thread would surface its slug and title";
  if (d.example) return "it is an example page";
  if (FEED_NON_POST_KINDS.has(d.kind)) return `it is a ${d.kind} page, not a post`;
  if (getMeta(html, "bh:discuss") === "off") return 'it sets <meta name="bh:discuss" content="off">';
  return "";
}

/** A page's own bh:discuss value as a problem, or "": "off", or the URL of one thread in the repo's discussions. */
function discussMetaProblem(html: string): string {
  const v = getMeta(html, "bh:discuss");
  // With discussions switched off a pinned thread is simply unused, not wrong.
  if (!v || v === "off" || !DISCUSSIONS_URL) return "";
  return v.startsWith(DISCUSSIONS_URL + "/") && /^\d+$/.test(v.slice(DISCUSSIONS_URL.length + 1)) ? ""
    : `bh:discuss must be "off" or the URL of this post's thread, ${DISCUSSIONS_URL || "<bh.discussionsUrl>"}/<number> (got "${v}")`;
}

/** The block for an eligible `file`, each line indented by `indent`. */
function discussBlock(file: string, html: string, indent: string): string {
  const d = readDoc(file), url = pageUrl(d.href), title = decodeHtml(d.title);
  const pinned = getMeta(html, "bh:discuss");
  const [, owner, repo] = DISCUSSIONS_URL.match(DISCUSSIONS_RE)!;
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const search = `https://github.com/search?${q({ type: "discussions", q: `repo:${owner}/${repo} "${url}"` })}`;
  const start = `${DISCUSSIONS_URL}/new?${q({ category: DISCUSSION_CATEGORY, title, body: `About ${url}\n\n` })}`;
  const a = (href: string, text: string) => `<a href="${escapeHtml(href)}">${text}</a>`;
  const thread = pinned && pinned !== "off"
    ? `Questions, corrections and “this helped” are all welcome: ${a(pinned, "join the discussion on GitHub")}. It needs a GitHub account.`
    : `Questions, corrections and “this helped” are all welcome. ${a(search, "Find this post’s thread on GitHub Discussions")}, or ${a(start, "start it")} if there is none yet. Both need a GitHub account.`;
  const review = /<body\b[^>]*\sdata-review="off"/.test(html) ? [] : [`  <p>To comment on one passage instead, ${a("?review", "open the Review panel")}.</p>`];
  return [
    `<aside class="callout no-glossary" id="discuss" data-linkable data-discuss>`,
    `  <p class="callout-title">Discuss this post</p>`,
    `  <p>${thread}</p>`,
    ...review,
    `</aside>`,
  ].map((l) => indent + l).join("\n") + "\n\n";
}

/** `raw` with its discuss block written just before the footer when `file` gets one, and every other copy removed. */
function withDiscuss(raw: string, file: string): string {
  const bare = raw.replace(DISCUSS_RE, ""), html = stripComments(raw);
  if (discussExclusion(file, html)) return bare;
  return bare.replace(FOOTER_LINE_RE, (m, indent) => discussBlock(file, html, indent) + m);
}

/** Everything `check` says about the discuss block on one page. */
function discussProblems(file: string, raw: string): string[] {
  const html = stripComments(raw);
  const found = [...html.matchAll(DISCUSS_RE)];
  const out: string[] = [];
  const meta = discussMetaProblem(html);
  if (meta) out.push(meta);
  const why = discussExclusion(file, html);
  if (why) {
    if (found.length) out.push(`must not carry a ${DISCUSS_TITLE}: ${why}; ${isPrivateSource(file) ? "delete it" : "run `npm run index`"}`);
    return out;
  }
  if (meta) return out;
  if (!FOOTER_LINE_RE.test(html)) out.push(`the ${DISCUSS_TITLE} goes just before the footer, so the page needs a line that starts <footer class="bh-footer">`);
  else if (!found.length) out.push(`missing the ${DISCUSS_TITLE}: run \`npm run index\``);
  else if (found.length > 1) out.push(`has ${found.length} ${DISCUSS_TITLE}s; \`npm run index\` writes exactly one`);
  else if (!/^\s*<footer class="bh-footer"/.test(html.slice(found[0].index + found[0][0].length))) out.push(`the ${DISCUSS_TITLE} must sit just before the <footer class="bh-footer">: run \`npm run index\``);
  else if (found[0][0] !== discussBlock(file, html, found[0][0].match(/^[ \t]*/)![0])) out.push(`the ${DISCUSS_TITLE} is stale or edited by hand: run \`npm run index\``);
  return out;
}

// ---- The hero's facts and the "Superseded" banner (scripts/hero-meta.mts) ---------------------
//
// `npm run index` writes the list in each public page's hero, and the banner after the hero of a page that
// has been superseded, from the page's own bh:* metas, as bh.js used to build them on load; `npm run seal`
// does the same for a private page before it encrypts it. `check` fails when either is stale. bh.js builds
// them only into a list left empty (a page diff, or a page from before this was generated).

/** Every public page, by root-relative path: the pages a decision link may name. Read once (`index` changes no meta). */
let publicDocsByHref: Map<string, Doc> | null = null;
const publicDoc = (href: string): Doc | undefined => (publicDocsByHref ??= new Map(docFiles().map((f) => { const d = readDoc(f); return [d.href, d] as const; }))).get(href);

/** A meta's value as text in the page: decoded, as the browser reads the attribute, then escaped. */
const metaText = (v: string) => escapeHtml(decodeHtml(v));

/**
 * The link to the page that `d` supersedes or is superseded by: `value` as the author wrote it, `target` the
 * page it names. Its text is that page's title when everyone who may read `d` may also see that title: a
 * listed page's, and an example's only on another example (the published site has no examples, so a post
 * would show a title no reader can follow). Otherwise it is the path as written, which is what bh.js showed
 * without data for the page, and `data-untitled` asks bh.js for the title where the reader's data has it
 * (an unlisted chain with #unlisted=true, an example with ?examples). See docs/visibility-threat-model.html.
 */
function lifecycleLink(d: Doc, value: string, target: string): string {
  const t = publicDoc(target);
  const titled = !!t && !t.unlisted && (!t.example || d.example);
  return `<a href="${attr(value)}"${titled ? "" : " data-untitled"}>${metaText(titled ? t!.title : value)}</a>`;
}

/** The rows of `file`'s list, in bh.js's order: Status, Updated, Authors, Reading time, Tags, Supersedes, Superseded by. */
function heroMetaRows(file: string, raw: string): HeroMetaRow[] {
  const html = stripComments(raw), d = readDoc(file);
  const rows: HeroMetaRow[] = [];
  const status = getMeta(html, "bh:status"), date = getMeta(html, "bh:date"), authors = getMeta(html, "bh:authors"), tags = getMeta(html, "bh:tags");
  if (status) rows.push({ term: "Status", html: `<span class="badge ${escapeHtml(decodeHtml(status).toLowerCase())}">${metaText(status)}</span>` });
  if (date) rows.push({ term: "Updated", html: `<time datetime="${metaText(date)}">${metaText(date)}</time>` });
  if (authors) rows.push({ term: "Authors", html: metaText(authors) });
  const reading = readingTime(articleWords(raw));
  if (reading) rows.push({ term: "Reading time", html: reading });
  if (tags) rows.push({ term: "Tags", html: metaText(tags) });
  const supersedes = getMeta(html, "bh:supersedes"), supersededBy = getMeta(html, "bh:superseded-by");
  if (supersedes) rows.push({ term: "Supersedes", html: lifecycleLink(d, supersedes, d.supersedes) });
  if (supersededBy) rows.push({ term: "Superseded by", html: lifecycleLink(d, supersededBy, d.supersededBy) });
  return rows;
}

/** `raw` with its list written: each generated list, filled. A template's stays empty: `new` copies it and `index` fills it. */
function withHeroList(raw: string, file: string): string {
  if (file.startsWith(TEMPLATES + path.sep)) return raw.replace(new RegExp(HERO_META_RE.source, "g"), EMPTY_HERO_META);
  const rows = heroMetaRows(file, raw);
  return raw.replace(new RegExp(HERO_META_RE.source, "g"), (_m, at: number) => {
    const line = raw.slice(raw.lastIndexOf("\n", at - 1) + 1, at);
    return heroMetaList(rows, /^[ \t]*$/.test(line) ? line : "");
  });
}

/** `raw` with its banner written after the hero when the page is superseded, and every other copy removed. */
function withSupersededBanner(raw: string, file: string): string {
  const bare = raw.replace(new RegExp(SUPERSEDED_RE.source, "g"), "");
  if (file.startsWith(TEMPLATES + path.sep)) return bare;
  const html = stripComments(raw), value = getMeta(html, "bh:superseded-by");
  if (!value) return bare;
  const d = readDoc(file);
  return bare.replace(HERO_RE, (hero, indent: string) => hero + supersededBanner(lifecycleLink(d, value, d.supersededBy), getMeta(html, "bh:kind") === "decision", indent));
}

const withHeroMeta = (raw: string, file: string) => withSupersededBanner(withHeroList(raw, file), file);

/** Everything `check` says about the generated list and banner on one page (or template, or private source). */
function heroMetaProblems(file: string, raw: string): string[] {
  const run = isPrivateSource(file) ? "run `npm run seal`, which writes them into the private page before it encrypts it" : "run `npm run index`";
  const out: string[] = [];
  const lists = (stripComments(raw).match(new RegExp(HERO_META_RE.source, "g")) || []).length;
  if (lists > 1) out.push(`has ${lists} <dl class="bh-meta" data-auto> lists; the hero holds one`);
  if (withHeroList(raw, file) !== raw) out.push(file.startsWith(TEMPLATES + path.sep) ? `the <dl class="bh-meta" data-auto> list must be empty in a template: \`new\` and \`index\` fill it` : `the hero's <dl class="bh-meta" data-auto> list is stale or edited by hand: ${run}`);
  if (withSupersededBanner(raw, file) !== raw) out.push(`the "Superseded" banner after the hero is stale, misplaced or edited by hand: ${run}`);
  return out;
}

/** `raw` with its autodiscovery link written (replacing any other feed link, after the icon links). */
function withFeedLink(raw: string, file: string): string {
  const tag = `  ${feedLinkTag(feedPrefix(file))}\n`;
  const end = raw.search(/<\/head>/i);
  if (end < 0) return raw;
  // Only the <head>, and not inside a comment: that is what `check` reads too.
  const head = raw.slice(0, end).replace(new RegExp(`<!--[\\s\\S]*?-->|${FEED_LINK_RE.source}`, "gm"), (m) => (m.startsWith("<!--") ? m : ""));
  const at = head.search(/^[ \t]*<link rel="stylesheet"/m);
  return (at >= 0 ? head.slice(0, at) + tag + head.slice(at) : head.replace(/([ \t]*)$/, () => tag)) + raw.slice(end);
}

/** Problems in feed text: not well-formed, or an entry that should not be there. `eligible` is the set of page URLs allowed in. */
function feedTextProblems(text: string, eligible: Set<string>): string[] {
  const out: string[] = [];
  const body = text.replace(/^<\?xml[^>]*\?>/, "");
  const stack: string[] = [];
  let last = 0;
  const TOKEN = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  const text_ = (chunk: string) => {
    if (/[<>]/.test(chunk)) out.push("contains a stray < or >");
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(chunk)) out.push("contains an unescaped &");
  };
  for (const m of body.matchAll(TOKEN)) {
    text_(body.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const [, close, name, attrs, selfClose] = m;
    text_(attrs.replace(/="[^"]*"/g, ""));
    for (const v of attrs.matchAll(/="([^"]*)"/g)) text_(v[1]);
    if (close) { if (stack.pop() !== name) { out.push(`has a closing </${name}> that matches no open tag`); break; } }
    else if (!selfClose) stack.push(name);
  }
  text_(body.slice(last));
  if (stack.length) out.push(`never closes <${stack[stack.length - 1]}>`);
  const problems = [...new Set(out)].map((p) => `${FEED_FILE} ${p}`);
  if (problems.length) return problems;
  const seen = new Set();
  for (const m of body.matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const id = decodeHtml((m[0].match(/<id>([^<]*)<\/id>/) || [])[1] || "");
    if (!eligible.has(id)) problems.push(`${FEED_FILE} lists ${id || "an entry with no id"}, which is private, unlisted, an example, a reference page or not a page`);
    if (seen.has(id)) problems.push(`${FEED_FILE} lists ${id} twice`);
    seen.add(id);
  }
  return problems;
}

/** Everything `check` says about the feed and the links that advertise it. */
function feedProblems(posts: Doc[] = feedPosts()): string[] {
  const problems: string[] = [];
  const expected = buildFeed(posts);
  const rel = path.relative(ROOT, FEED_OUT);
  const current = fs.existsSync(FEED_OUT) ? fs.readFileSync(FEED_OUT, "utf8") : null;
  if (current === null) problems.push(`${rel} is missing: run \`npm run index\``);
  else {
    problems.push(...feedTextProblems(current, new Set(posts.map((d) => pageUrl(d.href)))));
    if (current !== expected) problems.push(`${rel} is stale: run \`npm run index\``);
  }
  return problems;
}

// ---- Sitemap, robots.txt and the 404 page --------------------------------------------
//
// Three more generated files at the site root, written by `npm run index` and compared by `check`.
//   sitemap.xml  the home page and every public page the site surfaces (same exclusions as the feed:
//                sealed, unlisted and example pages are out; `reference` pages are in, since they are real pages).
//   robots.txt   allows everything and names the sitemap. It names no page: an unlisted page is kept out of
//                search by its own `noindex`, which a crawler can only see if robots.txt lets it fetch the page.
//   404.html     what GitHub Pages serves for every missing path, so its assets are root-relative.

const SITEMAP_FILE = "sitemap.xml", ROBOTS_FILE = "robots.txt", NOT_FOUND_FILE = "404.html";
/** The path part of the site URL ("/" for a domain root, "/repo/" for a project site): the base of the 404 page's assets. */
const SITE_PATH = (() => { try { return new URL(SITE_URL).pathname.replace(/\/*$/, "/"); } catch { return "/"; } })();

/** The pages the sitemap lists, newest first. */
function sitemapPages(): Doc[] {
  return listedDocFiles().map(readDoc).filter((d) => !d.example).sort(byDateThenTitle);
}

function buildSitemap(pages: Doc[] = sitemapPages()): string {
  const dates = pages.map((d) => d.date).filter(validFeedDate).sort();
  const url = (loc: string, date?: string) => `  <url><loc>${xmlEscape(loc)}</loc>${date && validFeedDate(date) ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- GENERATED by `npm run index`. Do not edit. -->",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url(SITE_URL, dates[dates.length - 1]),
    ...pages.map((d) => url(pageUrl(d.href), d.date)),
    "</urlset>",
    "",
  ].join("\n");
}

const buildRobots = () => `# GENERATED by \`npm run index\`. Do not edit.\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}${SITEMAP_FILE}\n`;

function build404(): string {
  const base = attr(escapeHtml(SITE_PATH)), title = `Page not found · ${SITE_NAME}`;
  const description = "Nothing lives at this address. The link may be mistyped or out of date.";
  return `<!doctype html>
<html lang="en">
<head>
  <!-- GENERATED by \`npm run index\`. Do not edit. Served by GitHub Pages for every missing path, so assets are root-relative. -->
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${attr(escapeHtml(description))}">
  <meta name="robots" content="noindex">
  <script>try{var t=localStorage.getItem("bh-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
  <script src="${base}theme/examples.js"></script>
  <script src="${base}theme/unlisted.js"></script>
  <link rel="icon" type="image/svg+xml" href="${base}theme/logo/mark-tile.svg">
  <link rel="apple-touch-icon" href="${base}theme/logo/apple-touch-icon.png">
  <link rel="stylesheet" href="${base}theme/bh.css">
  <script src="${base}theme/bh.js" defer></script>
</head>
<body data-home="${base}index.html" data-eyebrows="off" data-present="off">
<main class="bh-page no-toc">
  <article class="bh-article">
    <header class="bh-hero">
      <span class="bh-hero-mark" data-bh-logo aria-hidden="true"></span>
      <p class="eyebrow">Error 404</p>
      <h1>Page not found</h1>
      <p class="lede">${escapeHtml(description)}</p>
    </header>

    <p><a href="${base}">Back to all posts</a>, or <a href="${base}${FEED_FILE}">subscribe</a> to hear about new ones.</p>

    <footer class="bh-footer">
      <span>${feedFooterLink(base)}</span>
      ${attributionSpan()}
    </footer>
  </article>
</main>
</body>
</html>
`;
}

/** The generated root files, by name. */
const rootFiles = (pages: Doc[] = sitemapPages()): [string, string][] => [[SITEMAP_FILE, buildSitemap(pages)], [ROBOTS_FILE, buildRobots()], [NOT_FOUND_FILE, build404()]];

/** Everything `check` says about the sitemap, robots.txt and 404 page. */
function rootFileProblems(): string[] {
  const problems: string[] = [];
  const pages = sitemapPages(), eligible = new Set([SITE_URL, ...pages.map((d) => pageUrl(d.href))]);
  for (const [name, expected] of rootFiles(pages)) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) { problems.push(`${name} is missing: run \`npm run index\``); continue; }
    const current = fs.readFileSync(file, "utf8");
    if (name === SITEMAP_FILE) {
      const seen = new Set<string>();
      for (const m of current.matchAll(/<loc>([^<]*)<\/loc>/g)) {
        const loc = decodeHtml(m[1]);
        if (!eligible.has(loc)) problems.push(`${name} lists ${loc || "an empty <loc>"}, which is private, unlisted, an example or not a page`);
        if (seen.has(loc)) problems.push(`${name} lists ${loc} twice`);
        seen.add(loc);
      }
    }
    if (current !== expected) problems.push(`${name} is stale: run \`npm run index\``);
  }
  return problems;
}

// ---- index ------------------------------------------------------------------------

function cmdIndex(): void {
  const docs = docFiles().map(readDoc).filter((d) => !d.unlisted).sort(byDateThenTitle);
  const titles = new Map(docs.map((d) => [d.href, d.title]));
  const cards = docs.map((d) => cardHtml(d, titles)).join("\n");
  const html = fs.readFileSync(INDEX, "utf8");
  const start = "<!-- bh:index:start -->";
  const end = "<!-- bh:index:end -->";
  const i = html.indexOf(start), j = html.indexOf(end);
  if (i < 0 || j < 0) {
    console.error(c.red(`index.html is missing the ${start} … ${end} markers`));
    process.exit(1);
  }
  const next = html.slice(0, i + start.length) + "\n" + cards + "\n      " + html.slice(j);
  if (next !== html) fs.writeFileSync(INDEX, next);
  console.log(c.green(`Indexed ${docs.length} document${docs.length === 1 ? "" : "s"} → index.html`));

  // Social meta (Open Graph / Twitter) for the home page and every public page.
  let social = 0;
  for (const file of [INDEX, ...docFiles()]) {
    const raw = fs.readFileSync(file, "utf8"), next = withSocial(raw, expectedSocial(file));
    if (next !== raw) { fs.writeFileSync(file, next); social++; }
  }
  console.log(c.green(`Social meta written for ${docFiles().length + 1} pages`) + c.dim(` (${social} updated)`));

  // The hero's facts and the "Superseded" banner, on every public page; templates keep an empty list.
  // Private sources are left alone, as below: `seal` writes theirs.
  let heroes = 0;
  for (const file of [...docFiles(), ...(fs.existsSync(TEMPLATES) ? fs.readdirSync(TEMPLATES).filter((f) => f.endsWith(".html")).map((f) => path.join(TEMPLATES, f)) : [])]) {
    const raw = fs.readFileSync(file, "utf8"), next = withHeroMeta(raw, file);
    if (next !== raw) { fs.writeFileSync(file, next); heroes++; }
  }
  console.log(c.green(`Hero facts written for ${docFiles().length} pages`) + c.dim(` (${heroes} updated)`));

  // The feed, and the autodiscovery link every public page carries.
  const posts = feedPosts(), feedText = buildFeed(posts);
  if (!fs.existsSync(FEED_OUT) || fs.readFileSync(FEED_OUT, "utf8") !== feedText) fs.writeFileSync(FEED_OUT, feedText);
  let linked = 0;
  for (const file of [INDEX, ...docFiles()]) {
    const raw = fs.readFileSync(file, "utf8"), next = withFeedLink(raw, file);
    if (next !== raw) { fs.writeFileSync(file, next); linked++; }
  }
  // The footer attribution, and the "Discuss this post" block on each post (removed from every other page).
  // Private sources are left alone: editing one would make its seal stale, so `check` asks for a hand edit.
  let discuss = 0;
  for (const file of [INDEX, ...docFiles(), ...(fs.existsSync(TEMPLATES) ? fs.readdirSync(TEMPLATES).filter((f) => f.endsWith(".html")).map((f) => path.join(TEMPLATES, f)) : [])]) {
    const raw = fs.readFileSync(file, "utf8"), next = withDiscuss(withAttribution(raw), file);
    if (next !== raw) fs.writeFileSync(file, next);
    if (next.match(DISCUSS_RE)) discuss++;
  }
  console.log(c.green(`Wrote ${FEED_FILE} (${posts.length} post${posts.length === 1 ? "" : "s"})`) + c.dim(` (${linked} autodiscovery links updated)`));
  console.log(c.green(`"Discuss this post" on ${discuss} post${discuss === 1 ? "" : "s"}`) + (discussConfigProblem() ? c.yellow(` (${discussConfigProblem()})`) : DISCUSSIONS_URL ? "" : c.dim(" (switched off: bh.discussionsUrl is empty)")));

  // The sitemap, robots.txt and 404 page.
  const sitemap = sitemapPages();
  for (const [name, text] of rootFiles(sitemap)) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
  }
  console.log(c.green(`Wrote ${SITEMAP_FILE} (${sitemap.length + 1} URLs), ${ROBOTS_FILE} and ${NOT_FOUND_FILE}`));

  const g = compileGlossary();
  const prev = fs.existsSync(GLOSSARY_OUT) ? fs.readFileSync(GLOSSARY_OUT, "utf8") : "";
  if (prev !== g.js) fs.writeFileSync(GLOSSARY_OUT, g.js);
  console.log(c.green(`Compiled ${g.entries.length} glossary term${g.entries.length === 1 ? "" : "s"} → theme/glossary.js`));

  const site = buildSiteData();
  const reviews = compileReviews();
  for (const [file, text] of [[SITE_OUT, site.site], [SEARCH_OUT, site.search], [REVIEWS_OUT, reviews.js], [UNLISTED_REVIEWS_OUT, reviews.unlistedJs], [UNLISTED_OUT, site.unlisted], [UNLISTED_SLUGS_OUT, site.unlistedSlugs]]) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
  }
  console.log(c.green(`Built search index (${site.counts.entries} entries) and ${site.counts.links} backlinks → theme/site.js, theme/search-index.js`));
  console.log(c.green(`Set aside ${site.counts.unlisted} unlisted page${site.counts.unlisted === 1 ? "" : "s"}`) + c.dim(" → theme/unlisted-pages.js, theme/unlisted-slugs.js"));
}

// ---- theme checks: stylesheet import order (token contrast: scripts/check/contrast.mts) ---

/** @import must come before every rule except @charset and @layer statements placed before
    the first import; anything else in between makes later imports silently ignored. */
function cssImportProblems(file: string): string[] {
  const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  let phase = 0; // 0 = before imports, 1 = in imports, 2 = after
  for (const m of css.matchAll(/@(charset|import|layer)\b[^;{]*(;|\{)|[^\s@][^{]*\{/g)) {
    const kind = m[1], statement = m[2] === ";";
    if (kind === "import") {
      if (phase === 2) out.push(`${path.relative(ROOT, file)}: @import after other rules is ignored by browsers: ${m[0].trim().slice(0, 60)}`);
      const local = m[0].match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
      if (local && !/^https?:/.test(local[1]) && !fs.existsSync(path.resolve(path.dirname(file), local[1]))) out.push(`${path.relative(ROOT, file)}: @import of missing file ${local[1]}`);
      phase = phase === 2 ? 2 : 1;
    } else if (kind === "charset" || (kind === "layer" && statement && phase === 0)) {
      // allowed before imports
    } else {
      phase = 2;
    }
  }
  return out;
}

// ---- review files (helpers and the validator are in reviews.mts) ---------------------

/** Every merged comment and reply, grouped by document, oldest first → theme/reviews.js. */
function compileReviews() {
  const byDoc: Record<string, (ReviewRecord & { file: string })[]> = {}, ids = new Map<string, { document: string; record: ReviewRecord }>();
  for (const file of reviewFiles(ROOT).sort()) {
    let r: ReviewFile;
    try { r = readReview(file); } catch { continue; } // reported by reviewProblems()
    if (r.format !== "bh-review/1" || !Array.isArray(r.comments)) continue;
    if (isPrivateDocument(ROOT, r.document)) continue; // reported by reviewProblems(); never published
    const docKey = canonicalDocument(r.document);
    for (const cm of r.comments) {
      const record = reviewRecord(cm, r);
      const message = { document: docKey, record };
      if (cm.id && ids.has(cm.id) && sameReviewMessage(ids.get(cm.id)!, message)) continue;
      if (cm.id && !ids.has(cm.id)) ids.set(cm.id, message);
      (byDoc[docKey] = byDoc[docKey] || []).push({ ...record, file: path.relative(ROOT, file).split(path.sep).join("/") });
    }
  }
  for (const list of Object.values(byDoc)) list.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  const summary: Record<string, { threads: number; open: number }> = {};
  for (const [docPath, list] of Object.entries(byDoc)) {
    const byId = new Map(list.map((m) => [m.id, m]));
    const rootOf = (m: (typeof list)[number]) => { let r = m, guard = 0; while (r.inReplyTo && byId.has(r.inReplyTo) && guard++ < 50) r = byId.get(r.inReplyTo)!; return r; };
    const roots = list.filter((m) => !m.inReplyTo);
    const resolved = roots.filter((rt) => {
      const replies = list.filter((m) => m.inReplyTo && typeof m.resolves === "boolean" && rootOf(m).id === rt.id);
      return replies.length && replies[replies.length - 1].resolves;
    });
    summary[docPath] = { threads: roots.length, open: roots.length - resolved.length };
  }
  const header = "/* GENERATED by `npm run index` from reviews/. Do not edit. */\n";
  const hidden = new Set(docFiles().map(readDoc).filter((d) => d.unlisted).map((d) => d.href));
  const split = (keep: boolean) => Object.fromEntries(Object.entries(byDoc).filter(([href]) => hidden.has(href) === keep));
  return {
    byDoc, summary,
    js: header + "window.BH_REVIEWS = " + JSON.stringify(split(false), null, 1) + ";\n",
    unlistedJs: header + "window.BH_REVIEWS = " + JSON.stringify(split(true), null, 1) + ";\n",
  };
}

// ---- check ------------------------------------------------------------------------

// ---- logo: the inline mark in bh.js must match the self-contained SVG ------------------------

const LOGO_DIR = path.join(ROOT, "theme", "logo");

/** theme/logo/mark.svg is the source of truth for the mark's geometry; bh.js inlines the same paths. */
function logoProblems(): string[] {
  const problems: string[] = [];
  const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
  const mark = read(path.join(LOGO_DIR, "mark.svg")), js = read(path.join(ROOT, "theme", "bh.js"));
  if (!mark) return ["theme/logo/mark.svg is missing"];
  const paths = [...mark.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!paths.length) problems.push("theme/logo/mark.svg has no <path> to compare");
  for (const d of paths) if (!js!.includes(`d="${d}"`)) problems.push("theme/bh.js LOGO_SVG has drifted from theme/logo/mark.svg: copy the paths across");
  const tokens = read(path.join(ROOT, "theme", "tokens.css")) || "";
  const accent = tokens.match(/--accent:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i);
  for (const f of ["mark.svg", "mark-tile.svg", "lockup.svg", "og-card.svg"]) {
    const t = read(path.join(LOGO_DIR, f));
    if (!t) { problems.push(`theme/logo/${f} is missing`); continue; }
    for (const d of paths) if (!t.includes(`d="${d}"`)) problems.push(`theme/logo/${f} has drifted from theme/logo/mark.svg: copy the paths across`);
    if (f !== "og-card.svg" && accent && !(t.includes(accent[1]) && t.includes(accent[2]))) problems.push(`theme/logo/${f} does not use the --accent values from tokens.css (${accent[1]} / ${accent[2]})`);
    if (!/role="img"/.test(t) || !/<title\b/.test(t)) problems.push(`theme/logo/${f} needs role="img" and a <title>`);
    if (/<(image|text)\b|font-family|@import|url\(\s*["']?https?:/.test(t)) problems.push(`theme/logo/${f} must be self-contained: no raster, <text>, fonts or remote references`);
  }
  // The PNGs are renders: check their size (IHDR width/height), which og:image:width/height in index.html declare.
  for (const [f, w, h] of [["apple-touch-icon.png", 180, 180], ["og.png", 1200, 630]] as [string, number, number][]) {
    const file = path.join(LOGO_DIR, f);
    if (!fs.existsSync(file)) { problems.push(`theme/logo/${f} is missing`); continue; }
    const b = fs.readFileSync(file);
    if (b.readUInt32BE(16) !== w || b.readUInt32BE(20) !== h) problems.push(`theme/logo/${f} must be ${w}x${h}px (is ${b.readUInt32BE(16)}x${b.readUInt32BE(20)})`);
  }
  return problems;
}

/** Whether a secret name shows in ciphertext. Names shorter than 8 characters can't be told from chance in base64, so they are not searched for. */
const nameLeaks = (name: string, haystack: string) => name.length >= 8 && haystack.includes(name);

/** `check`: look the private-page keys up concurrently first (unless `--skip-keys`), then run the checks. */
async function cmdCheckCommand(argv: string[]): Promise<void> {
  const unknown = argv.filter((a) => a !== "--skip-keys");
  if (unknown.length) throw new Error(`check: unknown argument ${unknown.map((a) => `"${a}"`).join(", ")} (the only option is --skip-keys)`);
  const skipKeys = argv.includes("--skip-keys");
  // CI is where a stale seal must fail, so it never skips the key checks.
  if (skipKeys && process.env.CI) throw new Error("check: --skip-keys is for the edit loop; under CI the key checks always run");
  if (!skipKeys) await warmKeys();
  cmdCheck(skipKeys);
}

function cmdCheck(skipKeys = false): void {
  let errors = 0, warnings = 0;
  const templates = fs.readdirSync(TEMPLATES).filter((f) => f.endsWith(".html")).sort().map((f) => path.join(TEMPLATES, f));
  const files = [INDEX, ...docFiles(), ...privateSources(), ...templates];
  const publicDocs = docFiles().map(readDoc);
  // What each card was rendered from (social-cards.txt); a missing file is reported once, under the theme.
  const recordsText = cardRecordsText(), cardRecords = parseCardRecords(recordsText ?? "").records;

  // Theme: stylesheet import order and token contrast in both themes.
  {
    const problems = [
      ...fs.readdirSync(path.join(ROOT, "theme")).filter((f) => f.endsWith(".css")).flatMap((f) => cssImportProblems(path.join(ROOT, "theme", f))),
      ...contrastFindings(fs.readFileSync(path.join(ROOT, "theme", "tokens.css"), "utf8"), fs.readFileSync(path.join(ROOT, "theme", "components.css"), "utf8")).map((f) => f.message),
      ...logoProblems(),
      ...siteUrlProblems(),
      ...themeRemoteProblems(ROOT),
      ...orphanCards().map((f) => `docs/assets/og/${f} belongs to no public page: run \`npm run cards\` to remove it`),
      ...cardRecordProblems(),
    ];
    console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + "theme (import order, token contrast, logo, site base, card files, self-hosted fonts and scripts)");
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    errors += problems.length;
  }

  // Review files (reviews/**/*.json[.gz]) are well-formed and point at real documents.
  {
    const problems = reviewProblems(ROOT);
    const n = reviewFiles(ROOT).length;
    if (n || problems.length) {
      console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + `reviews (${n} file${n === 1 ? "" : "s"})`);
      problems.forEach((p) => console.log(c.red("  error  ") + p));
      errors += problems.length;
    }
  }

  // Glossary: compiled data must be fresh and entries well-formed.
  const glossary = compileGlossary();
  const globalTerms = new Set(glossary.entries.map((e) => e.id));
  {
    const problems = glossaryProblems(glossary.entries);
    const current = fs.existsSync(GLOSSARY_OUT) ? fs.readFileSync(GLOSSARY_OUT, "utf8") : "";
    if (current !== glossary.js) problems.push("theme/glossary.js is stale: run `npm run index`");
    const site = buildSiteData();
    for (const [file, text] of [[SITE_OUT, site.site], [SEARCH_OUT, site.search], [REVIEWS_OUT, compileReviews().js], [UNLISTED_REVIEWS_OUT, compileReviews().unlistedJs], [UNLISTED_OUT, site.unlisted], [UNLISTED_SLUGS_OUT, site.unlistedSlugs]]) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) problems.push(`${path.relative(ROOT, file)} is stale: run \`npm run index\``);
    }
    // Decision lifecycle: supersedes / superseded-by must agree in both directions.
    const all = publicDocs;
    const byHref = new Map(all.map((d) => [d.href, d]));
    for (const d of all) {
      if (d.status.toLowerCase() === "superseded" && !d.supersededBy) problems.push(`${d.href}: status "superseded" needs <meta name="bh:superseded-by">`);
      if (d.supersededBy && d.status.toLowerCase() !== "superseded") problems.push(`${d.href}: has bh:superseded-by, so bh:status must be "superseded"`);
      const chain: [string, "supersedes" | "supersededBy", string][] = [["bh:superseded-by", "supersedes", d.supersededBy], ["bh:supersedes", "supersededBy", d.supersedes]];
      for (const [rel, back, target] of chain) {
        if (!target) continue;
        const t = byHref.get(target);
        if (t && t.unlisted !== d.unlisted && rel === "bh:superseded-by") problems.push(`${d.href}: ${rel} → ${target}, but one is unlisted and the other is not: a decision chain must be all listed or all unlisted`);
        if (target === d.href) problems.push(`${d.href}: ${rel} points at itself`);
        else if (!t) problems.push(`${d.href}: ${rel} → ${target} does not exist`);
        else if (t[back] !== d.href) problems.push(`${d.href}: ${rel} → ${target}, but that page's ${back === "supersedes" ? "bh:supersedes" : "bh:superseded-by"} doesn't point back`);
      }
    }
    console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + `generated data & decision links (${glossary.entries.length} glossary terms)`);
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    errors += problems.length;
  }
  // The Atom feed: present, current, well-formed, and free of pages the site keeps off its listings.
  {
    const posts = feedPosts(), problems = feedProblems(posts);
    console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + `atom feed (${posts.length} post${posts.length === 1 ? "" : "s"})`);
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    errors += problems.length;
  }
  // The sitemap, robots.txt and 404 page: present, current, and the sitemap lists nothing the site keeps off its listings.
  {
    const problems = rootFileProblems();
    console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + `${SITEMAP_FILE}, ${ROBOTS_FILE} and ${NOT_FOUND_FILE}`);
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    errors += problems.length;
  }
  // The README's dependency and example lists must match package.json and the bh:example markers.
  // Skipped when there is no README (a fork may delete it; the test fixtures copy none).
  if (fs.existsSync(path.join(ROOT, "README.md"))) {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const problems = [
      ...readmeDependencyProblems(readme, JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))),
      ...readmeExampleProblems(readme, publicDocs.filter((d) => d.example).map((d) => d.href)),
    ];
    console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + "README (dependency and example lists match the repo)");
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    errors += problems.length;
  }
  // CLAUDE.md points at one contract file per feature (and README.md links some): each must exist, and each contract must be pointed at.
  // Skipped when there is no CLAUDE.md, as for the README.
  if (fs.existsSync(path.join(ROOT, "CLAUDE.md"))) {
    const dir = path.join(ROOT, "contracts");
    const present = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !fs.statSync(path.join(dir, f)).isDirectory()) : [];
    const readme = path.join(ROOT, "README.md"); // its links to contracts must not dangle either
    const others: Record<string, string> = fs.existsSync(readme) ? { "README.md": fs.readFileSync(readme, "utf8") } : {};
    const problems = contractProblems(fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8"), present, others);
    console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + "CLAUDE.md (feature contract pointers)");
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    errors += problems.length;
  }
  // Private pages: every plaintext is sealed and current; sealed shells are well-formed.
  const privateSlugs = new Set([...privateSources().map((f) => path.basename(f, PRIVATE_EXT)), ...sealedFiles().map((f) => path.basename(f, ".html"))]);
  {
    // Only .gitignore keeps the plaintext out, and `git add -f` goes past it (the push checks refuse it too: scripts/private-leaks.mts).
    const problems: string[] = trackedPrivatePlaintext(ROOT).map((f) => `${f} is tracked by git, but a private page's plaintext must never be committed: \`git rm --cached ${f}\` (and rewrite any commit that has it); \`npm run seal\` makes the copy to commit`);
    for (const shell of sealedFiles()) {
      const slug = path.basename(shell, ".html"), text = fs.readFileSync(shell, "utf8");
      if (!/id="sealed-payload">\s*[A-Za-z0-9+/=\s]{40,}<\/script>/.test(text)) problems.push(`docs/${slug}.html: sealed payload is missing or malformed`);
      if (!/name="robots" content="noindex/.test(text)) problems.push(`docs/${slug}.html: sealed page must be noindex`);
      if (getMeta(text, "bh:sealed-shell") !== SHELL_VERSION()) problems.push(`docs/${slug}.html uses an outdated shell: run \`npm run seal -- --reshell\``);
      // Everything outside the ciphertext must be the generic shell, so a title, description or tag can't leak.
      else if (text !== sealedShell(sealedPayload(text), getMeta(text, "bh:sealed-digest"))) problems.push(`docs/${slug}.html differs from the generic sealed shell: only the payload and digest may vary`);
      // The icons name the site, not the page, so the shell may carry them (and the tab shouldn't show a default icon).
      for (const [rel, file] of [["icon", "mark-tile.svg"], ["apple-touch-icon", "apple-touch-icon.png"]]) {
        const link = text.match(new RegExp(`<link\\b[^>]*\\brel="${rel}"[^>]*>`));
        const href = link && (link[0].match(/\bhref="([^"]+)"/) || [])[1];
        if (!href) problems.push(`docs/${slug}.html is missing <link rel="${rel}">: run \`npm run seal -- --reshell\``);
        else if (!fs.existsSync(path.resolve(DOCS, href))) problems.push(`docs/${slug}.html: ${rel} ${href} does not exist`);
      }
      const source = path.join(DOCS, slug + PRIVATE_EXT);
      if (fs.existsSync(source)) {
        const plain = stripComments(fs.readFileSync(source, "utf8"));
        const generic = sealedShell("", "", "");
        for (const [what, value] of [["title", getTitle(plain)], ["description", getMeta(plain, "description")], ["group name", getMeta(plain, "bh:group")]]) {
          // A value the generic shell already contains (a title like "Private") can't be told apart; the exact comparison above covers it.
          for (const v of new Set([value, decodeHtml(value)])) {
            // A group name must also be long enough to tell from chance in base64.
            if (v && !generic.includes(v) && (what === "group name" ? nameLeaks(v, text) : text.includes(v))) problems.push(`docs/${slug}.html leaks the page's ${what}`);
          }
        }
      }
    }
    // The encrypted cards for the home page: structure everywhere, content where the keys are.
    const cardsFile = path.join(ROOT, CARD_FILE);
    let cardsText: string | null = null;
    if (!fs.existsSync(cardsFile)) problems.push(`${CARD_FILE} is missing: run \`npm run seal\``);
    else {
      cardsText = fs.readFileSync(cardsFile, "utf8");
      for (const p of validateCardsFile(cardsText, new Set(sealedFiles().map((f) => path.basename(f, ".html"))))) problems.push(`${CARD_FILE} ${p}`);
    }
    const cardEntries = cardsText ? parseCardsFile(cardsText).entries : [];
    let keysSkipped = 0;
    for (const src of privateSources()) {
      const slug = path.basename(src, PRIVATE_EXT), out = path.join(DOCS, `${slug}.html`);
      if (fs.existsSync(out) && !isSealed(out)) { problems.push(`docs/${slug}.html is public but docs/${slug}${PRIVATE_EXT} also exists`); continue; }
      const group = getMeta(stripComments(fs.readFileSync(src, "utf8")), "bh:group");
      if (group && !GROUP_RE.test(group)) problems.push(`docs/${slug}${PRIVATE_EXT}: bh:group "${group}" must be kebab-case`);
      if (group && nameLeaks(group, cardEntries.map((e) => e.blob).join("\n"))) problems.push(`${CARD_FILE} leaks the group name of ${slug}`);
      // --skip-keys: everything below needs the key, so it needs 1Password.
      if (skipKeys) { keysSkipped++; continue; }
      let keyText: string | null = null;
      try { keyText = readKey(slug); } catch (e) { problems.push(`can't read the key for ${slug} from 1Password: ${(e as Error).message}`); continue; }
      if (!keyText && readItem(opTitle(slug))) { problems.push(`can't read the key for ${slug}: ${missingKeyReason(slug)}`); continue; }
      if (!keyText || !fs.existsSync(out)) { problems.push(`docs/${slug}${PRIVATE_EXT} has never been sealed: run \`npm run seal\``); continue; }
      const digest = sealDigest(Buffer.from(keyText, "base64url"), fs.readFileSync(src));
      if (getMeta(fs.readFileSync(out, "utf8"), "bh:sealed-digest") !== digest) problems.push(`docs/${slug}.html is stale: run \`npm run seal\``);
      const blob = cardEntries.find((e) => e.slug === slug)?.blob;
      if (blob && !isDeepStrictEqual(tryDecryptCard(blob, keyText, slug), sourceCard(src))) problems.push(`private card for ${slug} is stale: run \`npm run seal\``);
    }
    if (privateSlugs.size || problems.length) console.log((problems.length ? c.red("✗ ") : c.green("✓ ")) + `private pages (${privateSlugs.size} sealed)`);
    problems.forEach((p) => console.log(c.red("  error  ") + p));
    if (keysSkipped) console.log(c.yellow("  warn   ") + `--skip-keys: did not check that ${keysSkipped} private page${keysSkipped === 1 ? " is" : "s are"} sealed and current (no 1Password lookup); run plain \`npm run check\` before you push`);
    errors += problems.length;
    warnings += keysSkipped ? 1 : 0;
  }

  // The pages a link must not reach (scripts/hidden-pages.mts decides which, and HIDDEN_RULE.check whether `check` looks).
  const hiddenKinds = new Map([...hiddenPages(ROOT)].filter(([, kind]) => HIDDEN_RULE[kind].check));
  const hrefsOfKind = (kind: HiddenKind) => new Set([...hiddenKinds].filter(([, k]) => k === kind).map(([href]) => href));
  const exampleHrefs = hrefsOfKind("example"), unlistedHrefs = hrefsOfKind("unlisted");
  const prismLanguages = vendoredPrismLanguages(ROOT);
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const raw = fs.readFileSync(file, "utf8");
    const html = stripComments(raw);
    const isTemplate = file.startsWith(TEMPLATES + path.sep);
    const isDoc = file !== INDEX;
    const problems: string[] = [];
    const err = (m: string) => { problems.push(c.red("  error  ") + m); errors++; };
    const warn = (m: string) => { problems.push(c.yellow("  warn   ") + m); warnings++; };
    const report = (f: Finding) => (f.level === "error" ? err : warn)(f.message);

    if (!getTitle(html)) err("missing <title>");
    if (!getMeta(html, "description")) err('missing <meta name="description">');
    if (!isTemplate && /\{\{\w+\}\}/.test(html)) err("unfilled {{placeholder}} left from template");
    if (!/<html[^>]*\slang=/.test(html)) err("<html> is missing lang");
    if (!/name="viewport"/.test(html)) err("missing viewport meta");
    // Favicon and touch icon: present, and the files exist (bundle inlines them).
    const iconLinks = [...html.matchAll(/<link\b[^>]*\brel="([^"]*)"[^>]*>/g)].filter((m) => /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(m[1]));
    if (!iconLinks.some((m) => /(^|\s)icon(\s|$)/.test(m[1]))) err('missing <link rel="icon"> (see theme/logo/)');
    for (const m of iconLinks) {
      const href = (m[0].match(/\bhref="([^"]+)"/) || [])[1];
      if (href && !/^(https?:|data:)/.test(href) && !fs.existsSync(path.resolve(path.dirname(file), href))) err(`icon ${href} does not exist`);
    }
    // Third-party scripts and stylesheets: an exact version and an integrity hash, or served from theme/ (scripts/remote-assets.mts).
    for (const p of remoteAssetProblems(html)) err(p);
    if (prismLanguages) for (const p of codeLanguageProblems(html, prismLanguages)) warn(p);

    // The feed: one autodiscovery link in <head> and a visible Subscribe link in the footer (the home page, public pages, templates).
    if (!isPrivateSource(file)) {
      const prefix = feedPrefix(file), tag = feedLinkTag(prefix);
      const links = [...html.split("</head>")[0].matchAll(new RegExp(FEED_LINK_RE.source, "gm"))].map((m) => m[0].trim());
      if (links.length !== 1) err(`needs exactly one feed autodiscovery link in <head> (found ${links.length}): ${tag}`);
      // A template's title is whatever the site was called when it was written: `new` + `index` set the real one on a page.
      else if (links[0] !== tag && !(isTemplate && links[0].replace(/ title="[^"]*"/, "") === tag.replace(/ title="[^"]*"/, ""))) err(`feed autodiscovery link must be ${tag}`);
      const footer = (html.match(/<footer class="bh-footer"[^>]*>([\s\S]*?)<\/footer>/) || [])[1] || "";
      if (!footer.includes(feedFooterLink(prefix))) err(`the <footer class="bh-footer"> needs a Subscribe link: ${feedFooterLink(prefix)}`);
      if (!REPO_URL) err("package.json needs bh.repoUrl (the repo the footer attribution links to)");
      else if ((footer.match(/<span data-attribution>/g) || []).length !== 1 || !footer.includes(attributionSpan())) err(`the <footer class="bh-footer"> needs exactly this attribution link (run npm run index): ${attributionSpan()}`);
    }

    // "Discuss this post": generated by `npm run index` on each post, and on nothing else.
    if (file === INDEX && discussConfigProblem()) err(discussConfigProblem());
    for (const p of discussProblems(file, raw)) err(p);
    // The hero's facts and the "Superseded" banner: generated by `npm run index` (`seal` for a private page).
    if (file !== INDEX) for (const p of heroMetaProblems(file, raw)) err(p);

    // Example pages are shown or hidden by theme/examples.js, which must run in <head> before first paint.
    {
      const head = html.split("</head>")[0];
      const script = head.search(/<script\s+src="[^"]*theme\/examples\.js"\s*><\/script>/);
      if (script < 0) err('missing <script src="…/theme/examples.js"></script> in <head> (synchronous, after the theme script)');
      // The script reads the marker as it runs, so the marker must come first.
      else if (head.search(/<meta\s+name="bh:example"/) > script) err('<meta name="bh:example"> must come before the theme/examples.js script in <head>');
      // Unlisted pages: the same, with theme/unlisted.js, which must follow examples.js.
      const unlistedScript = head.search(/<script\s+src="[^"]*theme\/unlisted\.js"\s*><\/script>/);
      if (unlistedScript < 0) err('missing <script src="…/theme/unlisted.js"></script> in <head> (synchronous, after theme/examples.js)');
      else {
        if (script >= 0 && unlistedScript < script) err("theme/unlisted.js must come after theme/examples.js in <head>");
        if (head.search(/<meta\s+name="bh:unlisted"/) > unlistedScript) err('<meta name="bh:unlisted"> must come before the theme/unlisted.js script in <head>');
      }
    }

    // The home page lists unlisted pages (when the reader opts in) into this list, in the browser.
    if (file === INDEX && !/<ul\b(?=[^>]*\sid="doc-list")[^>]*\sdata-unlisted-cards[\s>=]/.test(html)) err('the <ul id="doc-list"> needs the data-unlisted-cards attribute, which loads the module that lists unlisted pages');

    // A group name is secret while the page is: it may only sit in a private source, and so is encrypted once sealed.
    if (!isPrivateSource(file) && /<meta\s+name="bh:group"/i.test(html)) err('<meta name="bh:group"> is only valid in docs/*.private.html: a public page has no key to share');
    // The catalogue's marker: without it the home page never looks for private cards.
    if (file === INDEX && !/<ul\b(?=[^>]*\sid="doc-list")[^>]*\sdata-private-cards[\s>=]/.test(html)) err('the #doc-list needs the data-private-cards attribute');

    // Social meta: generated, so it must be present and current (templates carry the empty markers).
    if (!isPrivateSource(file)) {
      const block = raw.match(SOCIAL_RE);
      if (isTemplate) {
        if (!block || block[0] !== `  ${SOCIAL_START}\n  ${SOCIAL_END}`) err(`must hold the empty social markers:\n  ${SOCIAL_START}\n  ${SOCIAL_END}`);
      } else {
        if (!block) err("missing the social meta block: run `npm run index`");
        else if (block[0] !== expectedSocial(file)) err("social meta block is stale: run `npm run index`");
        const outside = stripComments(raw.replace(SOCIAL_RE, ""));
        if (/<meta\s+(?:property="(?:og|article):|name="twitter:)|<link\s+rel="canonical"/.test(outside)) err("social tags written by hand: delete them, `npm run index` generates them");
        if (getMeta(html, "description").length > DESCRIPTION_MAX) warn(`description is ${getMeta(html, "description").length} characters; link previews cut it off near ${DESCRIPTION_MAX}`);
      }
      // JSON-LD is generated into the block (a template's stays empty), so one anywhere else is hand-written.
      if (LD_TAG.test(stripComments(raw.replace(SOCIAL_RE, "")))) err("JSON-LD written by hand: delete it, `npm run index` generates it");
    }

    if (isDoc && !isTemplate && !isPrivateSource(file)) {
      // Size budget: the page's own HTML and images, apart from the shared theme (see scripts/page-size.mts).
      // Sealed shells never reach this loop (docFiles() leaves them out): their payload is already compressed.
      const size = pageSizeFinding(pageWeight(file));
      if (size) (size.level === "error" ? err : warn)(size.message);
      // The card image: one per public page, current for the visual and the text it shows.
      const job = cardJob(file);
      if (job.selection.problem) err(job.selection.problem);
      // The record binds the key to the exact PNG committed with it, so a PNG swapped or kept from the
      // other side of a merge fails here even when its record's key is current.
      const out = path.relative(ROOT, job.out), png = fs.existsSync(job.out) ? fs.readFileSync(job.out) : undefined;
      const dims = png && pngSize(png), record = cardRecords.get(job.slug);
      if (png === undefined) err(`no social card ${out}: run \`npm run cards\``);
      else if (!dims || dims.width !== CARD_W || dims.height !== CARD_H) err(`social card ${out} must be a ${CARD_W}x${CARD_H} PNG`);
      else if (!record) { if (recordsText !== null) err(`social card ${out} has no record in ${CARD_RECORDS_FILE}: run \`npm run cards\``); }
      else if (record.png !== sha256(png)) err(`social card ${out} is not the PNG that ${CARD_RECORDS_FILE} records for it: run \`npm run cards\``);
      else if (record.key === "fallback") (process.env.CI ? err : warn)("social card is the shared site card (rendered without Chrome): run `npm run cards` where Chrome is installed");
      else if (record.key !== job.key) err(`social card ${out} is stale: run \`npm run cards\``);
    }

    if (isDoc) {
      const kind = getMeta(html, "bh:kind");
      if (!kind) err('missing <meta name="bh:kind">');
      else if (!KIND_LABELS[kind]) warn(`unknown bh:kind "${kind}" (known: ${Object.keys(KIND_LABELS).join(", ")})`);
      const date = getMeta(html, "bh:date");
      if (!isTemplate && !/^\d{4}-\d{2}-\d{2}$/.test(date)) err(`bh:date must be YYYY-MM-DD (got "${date}")`);
      const h1s = (html.match(/<h1[\s>]/g) || []).length;
      if (h1s !== 1) err(`expected exactly one <h1>, found ${h1s}`);
      if (!/class="bh-article"/.test(html)) err('missing <article class="bh-article">');
      if (!/theme\/bh\.css/.test(html)) err("does not link theme/bh.css");
      for (const f of linkTargetFindings(raw)) err(f.message);

      // Example pages: a dedicated marker, never the `examples` tag (a tag is a topic).
      const example = getMeta(html, "bh:example");
      if (example && example !== "true") err(`bh:example must be "true" (got "${example}")`);
      if (!isTemplate && getMeta(html, "bh:tags").split(",").some((t) => t.trim().toLowerCase() === "examples")) {
        err('the "examples" tag is reserved: mark an example page with <meta name="bh:example" content="true"> instead (the index adds the topic)');
      }
      // Unlisted pages: a dedicated marker; the tag would only be a topic. Public pages only.
      const unlisted = getMeta(html, "bh:unlisted");
      if (unlisted && unlisted !== "true") err(`bh:unlisted must be "true" (got "${unlisted}")`);
      if (!isTemplate && getMeta(html, "bh:tags").split(",").some((t) => t.trim().toLowerCase() === "unlisted")) {
        err('the "unlisted" tag is reserved: mark an unlisted page with <meta name="bh:unlisted" content="true"> instead');
      }
      if (unlisted && isPrivateSource(file)) err("a private page cannot be unlisted: it is already off the site, and only a sealed copy is published");
      // An unlisted page's address works, but a link to it from a listed page is inert unless the reader opted in.
      if (!isTemplate && !unlisted && file !== GLOSSARY_SRC) {
        const seenLinks = new Set();
        for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"#?]+\.html)(?:[#?][^"]*)?"/g)) {
          if (/^[a-z]+:/i.test(m[1])) continue;
          const target = path.relative(ROOT, path.resolve(path.dirname(file), m[1])).split(path.sep).join("/");
          if (unlistedHrefs.has(target) && !seenLinks.has(target)) { seenLinks.add(target); warn(`links to unlisted page ${m[1]}: the link is inert unless the page is opened with #unlisted=true`); }
        }
      }
      // Off the local machine, links to example pages become plain text. Glossary definitions point at them by design.
      if (!isTemplate && !example && file !== GLOSSARY_SRC) {
        const seenLinks = new Set();
        for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"#?]+\.html)(?:[#?][^"]*)?"/g)) {
          if (/^[a-z]+:/i.test(m[1])) continue;
          const target = path.relative(ROOT, path.resolve(path.dirname(file), m[1])).split(path.sep).join("/");
          if (exampleHrefs.has(target) && !seenLinks.has(target)) { seenLinks.add(target); warn(`links to example page ${m[1]}: on the published site the link becomes plain text`); }
        }
      }
      // Full content in the feed (scripts/feed-content.mts): only for a post the feed lists, and interactives arrive broken.
      const feedMode = getMeta(html, "bh:feed");
      if (feedMode && feedMode !== "full") err(`bh:feed must be "full" (got "${feedMode}")`);
      else if (feedMode && !isTemplate && quotesPrivateWriting(readDoc(file))) err("bh:feed cannot be \"full\" here: the page quotes private writing under LEAK_ALLOWED (scripts/leak-allowed.mts), which allows the page, not feed.xml");
      // The same test the feed itself uses, so a page left out for any reason (a bad date too) is caught.
      else if (feedMode && !feedPosts().some((d) => d.file === file)) warn("bh:feed has no effect: the page is not in the feed (a template, example, unlisted, private or reference page, or one without a real bh:date)");
      else if (feedMode) for (const what of feedInteractives(html)) warn(`bh:feed is "full", but ${what} cannot run in a feed reader: leave it out with data-feed-omit, or drop the meta`);
    }

    // Duplicate ids
    // Script bodies are skipped: an inlined figure script builds markup in template strings, and
    // two figures on one page would each contribute an `id="${id}"` that is not an element.
    const ids = [...html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const seen = new Set();
    for (const id of ids) { if (seen.has(id)) err(`duplicate id="${id}"`); seen.add(id); }

    // Prose ↔ diagram references point at a real figure and real parts of it.
    {
      const { root: tree, src } = parseTree(raw);
      for (const m of html.matchAll(/\sdata-ref="([^"]*)"/g)) {
        const i = m[1].indexOf(":");
        if (i < 1) { err(`data-ref="${m[1]}" must be "figure-id:part-id [part-id…]"`); continue; }
        const figId = m[1].slice(0, i).trim();
        const fig = findNode(tree, (n) => nodeAttr(n, "id") === figId);
        if (!fig) { err(`data-ref="${m[1]}": no element with id="${figId}"`); continue; }
        const parts = new Set([...src.slice(fig.start, fig.end).matchAll(/\sdata-id="([^"]+)"/g)].map((x) => x[1]));
        for (const id of m[1].slice(i + 1).split(/[\s,]+/).filter(Boolean)) {
          if (!parts.has(id)) err(`data-ref="${m[1]}": #${figId} has no part with data-id="${id}"`);
        }
      }
    }

    // Ids bh.js generates at runtime: stepper steps (#<for or id>-step-N).
    for (const m of html.matchAll(/<bh-stepper\b([^>]*)>([\s\S]*?)<\/bh-stepper>/g)) {
      const base = attrOf(m[1], "id") || attrOf(m[1], "for");
      const steps = (m[2].match(/<bh-step\b/g) || []).length;
      for (let i = 1; base && i <= steps; i++) seen.add(`${base}-step-${i}`);
    }

    // In-page anchors (heading ids may also be generated at runtime: warn, not error)
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      if (!seen.has(m[1])) warn(`link to #${m[1]} has no matching id in the source`);
    }

    // Public pages never link to private ones: the link would either break or reveal the page.
    if (!isPrivateSource(file)) for (const m of html.matchAll(/\s(?:href|src)="([^"#?]+\.html)(?:[#?][^"]*)?"/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      const kind = hiddenKinds.get(path.relative(ROOT, path.resolve(path.dirname(file), m[1])).split(path.sep).join("/"));
      if (kind === "private" || kind === "sealed") err(`links to private page ${m[1]}`);
    }

    // Relative links and assets exist
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const url = m[1];
      if (/^(https?:|mailto:|tel:|data:|#|\/\/)/.test(url)) continue;
      const target = path.resolve(path.dirname(file), decodeURI(url.split(/[?#]/)[0]));
      if (!fs.existsSync(target)) err(`broken link: ${url}`);
    }

    // Images need alt; diagrams need an accessible name
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) err(`<img> without alt: ${m[0].slice(0, 60)}…`);
    for (const m of html.matchAll(/<figure[^>]*class="[^"]*\bdiagram\b[^"]*"[^>]*>\s*<svg\b([^>]*)>/g)) {
      if (!/role="img"/.test(m[1]) || !/aria-label(ledby)?=/.test(m[1])) warn('diagram <svg> should have role="img" and aria-label');
    }

    // Arrowed edges: tips must land on their target node's outline (scripts/check/diagram-geometry.mts).
    arrowTipFindings(raw).forEach(report);

    // Diagram labels never collide with edges, arrowheads, nodes or each other.
    diagramLabelFindings(raw).forEach(report);

    // Glossary references resolve to a global or page-local term.
    const localTerms = parseGlossary(html);
    if (file !== GLOSSARY_SRC) for (const p of glossaryProblems(localTerms)) err(p);
    for (const m of html.matchAll(/\sdata-term="([^"]*)"/g)) {
      if (!globalTerms.has(m[1]) && !localTerms.some((e) => e.id === m[1])) err(`data-term="${m[1]}" is not in the glossary`);
    }

    // Stepper targets & highlight ids
    const dataIds = new Set([...html.matchAll(/\sdata-id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/<bh-stepper\b[^>]*\sfor="([^"]+)"/g)) {
      if (!seen.has(m[1])) err(`<bh-stepper for="${m[1]}"> — no element with that id`);
    }
    for (const m of html.matchAll(/<bh-step\b[^>]*\shighlight="([^"]*)"/g)) {
      for (const id of m[1].split(/[\s,]+/).filter(Boolean)) {
        if (!dataIds.has(id)) err(`<bh-step highlight> references unknown data-id "${id}"`);
      }
    }
    for (const m of html.matchAll(/<bh-filter\b[^>]*\sfor="([^"]+)"/g)) {
      if (!seen.has(m[1])) err(`<bh-filter for="${m[1]}"> — no element with that id`);
    }

    console.log((problems.length ? (problems.some((p) => p.includes("error")) ? c.red("✗ ") : c.yellow("! ")) : c.green("✓ ")) + rel);
    problems.forEach((p) => console.log(p));
  }
  console.log(`\n${files.length} files · ${errors ? c.red(errors + " errors") : "0 errors"} · ${warnings ? c.yellow(warnings + " warnings") : "0 warnings"}`);
  if (errors) process.exit(1);
}

// ---- bundle -----------------------------------------------------------------------

function inlineCss(file: string, remote: Set<string>, seen = new Set<string>()): string {
  if (seen.has(file)) return "";
  seen.add(file);
  // Files a stylesheet names with url() (the theme's fonts) resolve against it, so a standalone file carries them as data: URIs.
  const css = fs.readFileSync(file, "utf8").replace(/(?<!@import\s+)url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, href) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return m;
    const p = path.resolve(path.dirname(file), href.split(/[?#]/)[0]);
    const mime = CSS_MIME[path.extname(p).toLowerCase()];
    return mime && fs.existsSync(p) ? `url("data:${mime};base64,${fs.readFileSync(p).toString("base64")}")` : m;
  });
  return css.replace(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*(?:layer\(([^)]+)\))?\s*;/g, (m, href, layer) => {
    if (/^https?:/.test(href)) { remote.add(m.trim()); return ""; }
    const body = inlineCss(path.resolve(path.dirname(file), href), remote, seen);
    return layer ? `@layer ${layer} {\n${body}\n}` : body;
  });
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif" };
const CSS_MIME: Record<string, string> = { ...MIME, ".woff2": "font/woff2", ".woff": "font/woff" };

/**
 * Where the document's head and body really end: the offset of the `</head>` that closes the head and of the
 * `</body>` that closes the body, or -1 when there is none. A page can say either one inside its own script
 * (a template string that builds another document), a `<style>`, a `<textarea>`, a `<title>` or a comment, and
 * a plain search finds that one first. So those are stepped over, as the HTML parser does, and the head ends at the
 * first `</head>` outside them and the body at the last `</body>`.
 */
function documentEnds(html: string): { headEnd: number; bodyEnd: number } {
  let headEnd = -1, bodyEnd = -1;
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/(head|body)\s*>/gi)) {
    const end = m[2]?.toLowerCase();
    if (end === "head" && headEnd < 0) headEnd = m.index;
    else if (end === "body") bodyEnd = m.index;
  }
  return { headEnd, bodyEnd };
}

/** `html`, the content of (or a page made from) `file`, as one self-contained document. `reviews: false` leaves the page's threads out. */
function bundleHtml(html: string, file: string, reviews = true): string {
  const dir = path.dirname(file);
  const scripts: string[] = [];

  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (m, href) => {
    if (/^https?:/.test(href)) return m;
    const remote = new Set<string>();
    const css = inlineCss(path.resolve(dir, href), remote);
    // Marked, so a script can tell the theme from the page's own <style> (theme/modules/diff.js does).
    return `<style data-bh-theme>\n${[...remote].join("\n")}\n${css}\n</style>`;
  });

  // A synchronous script in <head> (the theme's examples.js and unlisted.js) decides something before
  // first paint, so it is inlined where it is. Every other script goes to the end of <body>, in source order:
  // a bundle can arrive slowly, and scripts at the end would run only after the whole body had been
  // parsed and, perhaps, painted. "Synchronous" is: no `defer` or `async` attribute, and no `type` of `module`
  // (quoted either way, or not at all). Only a tag whose first attribute is a double-quoted `src` is inlined at all.
  // A head script's text is put in at the very end, where its placeholder stands, so that none of the
  // replacements below can match inside it (a comment that says "</head>", say).
  const headScripts: string[] = [], slot = (i: number) => `<!--bh-head-script-${slotKey}-${i}-->`, slotKey = crypto.randomBytes(8).toString("hex");
  const headEnd = documentEnds(html).headEnd;
  html = html.replace(/<script\s+src="([^"]+)"[^>]*><\/script>/g, (m, src, at: number) => {
    if (/^https?:/.test(src)) return m;
    const abs = path.resolve(dir, src);
    if (at < headEnd && !/\s(?:defer|async)(?=[\s=>])|\stype\s*=\s*["']?module["']?(?=[\s>])/i.test(m)) {
      headScripts.push(fs.readFileSync(abs, "utf8").replace(/<\/script/gi, "<\\/script"));
      return slot(headScripts.length - 1);
    }
    // bh.js loads the glossary at runtime; a standalone file must carry it inline, first.
    if (abs === path.join(ROOT, "theme", "bh.js")) {
      if (fs.existsSync(GLOSSARY_OUT)) scripts.push(fs.readFileSync(GLOSSARY_OUT, "utf8").replace(/<\/script/gi, "<\\/script"));
      // Only this page's threads: a standalone file leaves the repo, so it must not carry other pages' comments.
      const mine = path.relative(ROOT, file).split(path.sep).join("/");
      const own = { [mine]: compileReviews().byDoc[mine] || [] };
      if (reviews && own[mine].length) scripts.push(`window.BH_REVIEWS = ${JSON.stringify(own)};`.replace(/<\/script/gi, "<\\/script"));
      // bh.js loads the vendored Prism and Mermaid from theme/vendor/; inline the ones this page uses.
      const needs = { prism: /<code\b[^>]*\sclass=["']?[^"'>]*\blanguage-/i.test(html), mermaid: /<pre\b[^>]*\sclass=["']?[^"'>]*\bmermaid\b/i.test(html) };
      for (const [name, rel] of Object.entries(VENDOR)) if (needs[name as keyof typeof VENDOR]) scripts.push(fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/<\/script/gi, "<\\/script"));
    }
    scripts.push(fs.readFileSync(abs, "utf8").replace(/<\/script/gi, "<\\/script"));
    // On-demand modules can't be fetched from a standalone file: inline them all after bh.js.
    if (abs === path.join(ROOT, "theme", "bh.js")) {
      const dir = path.join(ROOT, "theme", "modules");
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) {
        scripts.push(fs.readFileSync(path.join(dir, f), "utf8").replace(/<\/script/gi, "<\\/script"));
      }
    }
    return "";
  });

  html = html.replace(/(<img\b[^>]*\ssrc=")([^"]+)(")/g, (m, a, src, b) => {
    if (/^(https?:|data:)/.test(src)) return m;
    const p = path.resolve(dir, src);
    const mime = MIME[path.extname(p).toLowerCase()];
    if (!mime || !fs.existsSync(p)) return m;
    return a + `data:${mime};base64,${fs.readFileSync(p).toString("base64")}` + b;
  });

  // A standalone file has no theme/ beside it: carry the favicon and touch icon inside it.
  html = html.replace(/<link\b[^>]*\brel="(?:[^"]*\s)?(?:icon|apple-touch-icon)(?:\s[^"]*)?"[^>]*>/g, (tag) => tag.replace(/(\bhref=")([^"]+)(")/, (m, a, href, b) => {
    if (/^(https?:|data:)/.test(href)) return m;
    const p = path.resolve(dir, href);
    const mime = MIME[path.extname(p).toLowerCase()];
    if (!mime || !fs.existsSync(p)) return m;
    return a + `data:${mime};base64,${fs.readFileSync(p).toString("base64")}` + b;
  }));

  // A standalone file has no URL of its own and no card beside it: keep the title and description
  // tags, drop the canonical URL, the image and the Twitter card, which would point at the site.
  html = html.replace(/^[ \t]*<link\s+rel="canonical"[^>]*>\n/gm, "")
    .replace(/^[ \t]*<meta\s+(?:property="og:(?:url|image[^"]*)"|name="twitter:[^"]*")[^>]*>\n/gm, "");
  html = withoutLdLinks(html, path.relative(ROOT, file));

  // A standalone file has no feed: no autodiscovery link and no Subscribe link.
  html = html.replace(FEED_LINK_RE, "").replace(/^[ \t]*<span><a href="(?:\.\.\/)?feed\.xml">Subscribe<\/a><\/span>\n/gm, "");
  // Nor a thread of its own: the "Discuss this post" block goes too.
  html = html.replace(DISCUSS_RE, "");

  // Links back into the site don't exist in a standalone file.
  html = html.replace(/<html\b/, "<html data-bundled");
  // Reviews made on a standalone file still know which document and commit they're about.
  const source = path.relative(ROOT, file).split(path.sep).join("/");
  scripts.unshift(buildScript(buildInfo()));
  html = html.replace(/<a href="\.\.\/index\.html">← All documents<\/a>/g, "");
  // Put in by offset, at the real ends of the head and the body (see documentEnds), and by slicing rather than
  // `replace`, so `$&` and friends in a script (Mermaid has dozens) are not read as replacement patterns.
  // The body first: it is later in the document, so the head's offset is still right.
  const ends = documentEnds(html);
  if (ends.bodyEnd >= 0) html = html.slice(0, ends.bodyEnd) + scripts.map((s) => `<script>\n${s}\n</script>`).join("\n") + "\n" + html.slice(ends.bodyEnd);
  if (ends.headEnd >= 0) html = html.slice(0, ends.headEnd) + `  <meta name="bh:source" content="${escapeHtml(source)}">\n` + html.slice(ends.headEnd);
  // Split on the placeholders rather than replace them one by one: a script put in is never searched.
  const bundled = html.split(new RegExp(`<!--bh-head-script-${slotKey}-(\\d+)-->`)).map((part, i) => (i % 2 ? `<script>\n${headScripts[Number(part)]}\n</script>` : part)).join("");
  // Every script that went in must still parse: one put in the wrong place fails only in the reader's browser.
  const broken = inlineScriptProblems(bundled);
  if (broken.length) throw new Error(`the bundle of ${path.relative(ROOT, file)} has ${broken.length === 1 ? "a script" : "scripts"} that cannot run:\n  ${broken.join("\n  ")}`);
  return bundled;
}

function bundleOne(file: string): void {
  const html = bundleHtml(fs.readFileSync(file, "utf8"), file);
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, path.basename(file));
  fs.writeFileSync(out, html);
  console.log(c.green(`Bundled ${path.relative(ROOT, file)} → ${path.relative(ROOT, out)}`) + c.dim(` (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`));
}

function cmdBundle([target]: string[]): void {
  if (!target) {
    console.error("Usage: bh bundle <docs/page.html | --all>");
    process.exit(2);
  }
  const files = target === "--all" ? listedDocFiles() : [path.resolve(process.cwd(), target)];
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error(c.red(`No such file: ${f}`)); process.exit(1); }
    bundleOne(f);
  }
}

// ---- diff: what changed in a page between two versions ----------------------------------

/**
 *   bh diff <docs/page.html> [base] [head]                    one page; base defaults to HEAD, head to the working tree
 *   bh diff --changed <base> [--out <dir>] [--summary <file>]   every page that differs from <base> (CI)
 * Each diff is the new version of the page, bundled into one file, with the differences marked.
 */
function cmdDiff(argv: string[]): void {
  const opts: Record<string, string> = {}, rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(changed|out|summary)$/);
    if (m) { if (argv[i + 1] === undefined) throw new Error(`--${m[1]} needs a value`); opts[m[1]] = argv[++i]; }
    else if (argv[i].startsWith("--")) throw new Error(`Unknown option ${argv[i]}`);
    else rest.push(argv[i]);
  }
  const outDir = path.resolve(process.cwd(), opts.out || path.join(DIST, "diff"));
  const short = (rev: string) => (COMMIT_RE.test(rev) ? rev.slice(0, 7) : rev);
  const write = (page: string, base: string, head: string, oldHtml: string, newHtml: string): PageSummary => {
    const diff = diffPages(oldHtml, newHtml);
    if (!diff) return { page, state: "unreadable", diff: null };
    const out = path.join(outDir, path.basename(page));
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(out, bundleHtml(renderDiffPage(diff, { base: short(base), head: head ? short(head) : "the working tree" }), path.join(ROOT, page), false));
    return { page, state: "changed", diff, out };
  };
  const pages: PageSummary[] = [];
  let base: string, head = "";
  if (opts.changed) {
    if (rest.length) throw new Error("--changed takes the base revision only");
    base = opts.changed;
    if (!resolveCommit(ROOT, base)) throw new Error(`No such revision: ${base} (a shallow clone? fetch it first)`);
    for (const { page, state } of changedPages(ROOT, base) ?? []) {
      const file = path.join(ROOT, page);
      if (state === "deleted") { pages.push({ page, state, diff: null }); continue; }
      if (isSealedFile(file)) continue; // ciphertext: nothing to read, and nothing to say about it
      if (state === "new") { pages.push({ page, state, diff: null }); continue; }
      const old = pageAt(ROOT, base, page);
      pages.push(old === null || isSealedShell(old) ? { page, state: "unreadable", diff: null } : write(page, base, "", old, fs.readFileSync(file, "utf8")));
    }
  } else {
    const [target, baseArg = "HEAD", headArg = ""] = rest;
    if (!target) throw new Error("Usage: bh diff <docs/page.html> [base] [head]   or   bh diff --changed <base> [--out <dir>] [--summary <file>]");
    const file = path.resolve(process.cwd(), target), page = path.relative(ROOT, file).split(path.sep).join("/");
    if (!PAGE_RE.test(page)) throw new Error(`Not a page in docs/: ${target}`);
    base = baseArg; head = headArg;
    for (const rev of [base, head].filter(Boolean)) if (!resolveCommit(ROOT, rev)) throw new Error(`No such revision: ${rev}`);
    const oldHtml = pageAt(ROOT, base, page);
    if (oldHtml === null) throw new Error(`${page} does not exist at ${base}`);
    const newHtml = head ? pageAt(ROOT, head, page) : fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (newHtml === null) throw new Error(`${page} does not exist ${head ? `at ${head}` : "in the working tree"}`);
    const done = write(page, base, head, oldHtml, newHtml);
    if (!done.diff) throw new Error(`${page} has no article to compare (a sealed page?)`);
    pages.push(done);
  }
  for (const p of pages) {
    const what = p.diff ? statsLine(p.diff.stats) + (p.diff.title ? ", title changed" : "") : p.state === "new" ? "new page" : p.state === "deleted" ? "deleted" : "could not be compared";
    console.log(`${p.page}: ${what}${p.out ? c.dim(` → ${path.relative(process.cwd(), p.out)}`) : ""}`);
  }
  if (!pages.length) console.log(c.dim(`No page differs from ${base}.`));
  if (opts.summary) fs.writeFileSync(path.resolve(process.cwd(), opts.summary), summaryMarkdown(pages, { base: short(base), head: head ? short(head) : "the working tree" }));
}

// ---- seal / unseal (private pages) ---------------------------------------------------
//
// The repo and its Pages site are public, so hiding a page means never committing its
// plaintext. docs/<slug>.private.html is git-ignored; `seal` gzips it, encrypts it with
// AES-256-GCM under a per-page key kept in 1Password, and writes docs/<slug>.html: a small
// shell that decrypts itself in the browser when opened as
//   docs/<slug>.html#k=<key>            (optionally #k=<key>&<section-id>)
// The fragment is never sent to the server. Without the key the shell shows only a notice.
// The sealed file is the copy of record: `unseal` recreates the plaintext from it.

const opTitle = (slug: string) => `beautiful-html private page: ${slug}`;
const opGroupTitle = (name: string) => `beautiful-html private group: ${name}`;
const itemCache = new Map<string, OpItem | null>();
/** Lookups `prefetchItems` could not finish, so `readItem` reports that failure instead of running the same call again. */
const prefetchFailures = new Map<string, Error>();
/** How many `op` lookups `check` runs at once. */
const OP_CONCURRENCY = 6;

/** The error a failed `op` run is reported as. */
function opError(e: unknown): Error {
  const err = e as NodeJS.ErrnoException & { stderr?: unknown };
  if (err.code === "ENOENT") return new Error("the 1Password CLI (`op`) is not installed: `brew install 1password-cli`");
  return new Error(String(err.stderr || err.message).trim().replace(/^\[ERROR\]\s*\S+\s+\S+\s*/, ""));
}

/** Run the 1Password CLI. Secrets only ever travel on stdin/stdout, never in argv. */
function op(args: string[], input?: string | null): string {
  try {
    if (input == null) return execFileSync("op", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    // Node's stdin "pipe" is a socket, which op doesn't treat as piped input (it then creates an
    // empty item). `cat |` hands op a real pipe; the secret still never appears in argv.
    return execFileSync("/bin/sh", ["-c", 'cat | op "$@"', "sh", ...args], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    throw opError(e);
  }
}

/** `op` without waiting for it, for reads that can overlap. No input, so no secret travels on stdin. */
function opAsync(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("op", args, { encoding: "utf8" }, (e, stdout, stderr) => (e ? reject(opError(Object.assign(e, { stderr }))) : resolve(stdout.trim())));
    child.stdin?.end();
  });
}

const itemGetArgs = (title: string) => ["item", "get", title, "--vault", OP_VAULT, "--format", "json", "--reveal"];
const itemMissing = (e: unknown) => /isn't an item|not found/i.test((e as Error).message);

/** A 1Password item as { id, group, password } (empty strings for absent fields). */
function parseItem(json: string): OpItem {
  const item: { id: string; fields?: { label: string; value?: string }[] } = JSON.parse(json);
  const field = (label: string) => String((item.fields || []).find((f) => f.label === label)?.value ?? "");
  return { id: item.id, group: field("group"), password: field("password") };
}

/** A 1Password item as { id, group, password } (empty strings for absent fields), or null if there is none. */
function readItem(title: string): OpItem | null {
  const failed = prefetchFailures.get(title);
  if (failed) throw failed;
  if (!itemCache.has(title)) {
    let item: OpItem | null = null;
    try {
      item = parseItem(op(itemGetArgs(title)));
    } catch (e) {
      if (!itemMissing(e)) throw e;
    }
    itemCache.set(title, item);
  }
  return itemCache.get(title) as OpItem | null;
}

/**
 * Fetch items concurrently into the cache, `OP_CONCURRENCY` at a time. Only an optimisation for
 * what `readItem` would fetch one by one: a missing item is cached as missing, and any other
 * failure is kept so `readItem` throws it (the same error, without asking 1Password again).
 */
async function prefetchItems(titles: Iterable<string>): Promise<void> {
  const todo = [...new Set(titles)].filter((t) => !itemCache.has(t));
  const worker = async () => {
    for (let title = todo.shift(); title !== undefined; title = todo.shift()) {
      try { itemCache.set(title, parseItem(await opAsync(itemGetArgs(title)))); }
      catch (e) { if (itemMissing(e)) itemCache.set(title, null); else prefetchFailures.set(title, e as Error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(OP_CONCURRENCY, todo.length) }, worker));
}

/** Look up, ahead of `check`, every key its private-page loop is going to read: the pages' items, then the group items they name. */
async function warmKeys(): Promise<void> {
  const slugs = privateSources().map((f) => path.basename(f, PRIVATE_EXT));
  await prefetchItems(slugs.map(opTitle));
  await prefetchItems(slugs.map((s) => itemCache.get(opTitle(s))?.group).filter((g): g is string => !!g).map(opGroupTitle));
}

const validKey = (key: string | null | undefined) => (key && KEY_RE.test(key) ? key : null);

/** The key that opens a page, or null if it has none yet. A grouped page's item names its group; the group's item holds the key. */
function readKey(slug: string): string | null {
  const item = readItem(opTitle(slug));
  if (!item) return null;
  if (item.group) return validKey(readItem(opGroupTitle(item.group))?.password);
  return validKey(item.password);
}

/** Why `readKey` found no key for a page, in words. */
function missingKeyReason(slug: string): string {
  const item = readItem(opTitle(slug));
  if (!item) return `there is no item "${opTitle(slug)}"`;
  if (item.group) return `its group item "${opGroupTitle(item.group)}" is missing or holds no valid key (restore it from the 1Password archive)`;
  return `item "${opTitle(slug)}" holds no valid key`;
}

/** Create a 1Password item from the given fields; read it back, because a key hasn't reached 1Password until it can be fetched again. */
function createItem(title: string, category: string, fields: object[], verify: (item: OpItem | null) => boolean): void {
  const created = JSON.parse(op(["item", "create", "--vault", OP_VAULT, "--format", "json", "-"], JSON.stringify({ title, category, fields })));
  itemCache.delete(title);
  if (!verify(readItem(title))) throw new Error(`1Password item ${created.id} doesn't hold what was sent; archive it and retry`);
}

const notes = (value: string) => ({ id: "notesPlain", type: "STRING", purpose: "NOTES", label: "notesPlain", value });
const secret = (key: string) => ({ id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: key });

/** Store a new key as a 1Password Password item. */
function storeKey(slug: string, key = crypto.randomBytes(32).toString("base64url")) {
  createItem(opTitle(slug), "PASSWORD", [secret(key),
    notes(`Decryption key for docs/${slug}.html in beautiful-html.\nShare as: docs/${slug}.html#k=<this password>\nRecreate the plaintext with: npm run unseal -- ${slug}`)],
  (item) => item?.password === key);
  return key;
}

/** Store a new group key. Every page in the group is opened by it, and so is the home-page card of each. */
function storeGroupKey(name: string, key = crypto.randomBytes(32).toString("base64url")) {
  createItem(opGroupTitle(name), "PASSWORD", [secret(key),
    notes(`Decryption key shared by every private page in the group "${name}" (<meta name="bh:group">) in beautiful-html.\nShare as: docs/<slug>.html#k=<this password>, or index.html#k=<this password> for the home-page cards.\nAnyone with it opens every page in the group. Archive this item only once no page uses the group.`)],
  (item) => item?.password === key);
  return key;
}

/** Point a page at its group: the page's item keeps no key, only the group's name. */
function storePageGroup(slug: string, group: string): void {
  createItem(opTitle(slug), "SECURE_NOTE", [{ id: "group", type: "STRING", label: "group", value: group },
    notes(`The key for docs/${slug}.html is the password of "${opGroupTitle(group)}".\nRecreate the plaintext with: npm run unseal -- ${slug}`)],
  (item) => item?.group === group);
}

function archiveItem(title: string): void {
  op(["item", "delete", title, "--vault", OP_VAULT, "--archive"]);
  itemCache.delete(title);
}

/**
 * Refuse, before anything is written, a 1Password state that `ensureKey` must not paper over:
 * an item that exists but holds no valid key (a second item with its title would break every
 * lookup), and a group item that is gone while a page still points at it (minting a new key
 * would silently re-key the whole group).
 */
function checkItems(slug: string, group: string): void {
  if (!group) return;
  const groupItem = readItem(opGroupTitle(group));
  if (groupItem && !validKey(groupItem.password)) throw new Error(`"${opGroupTitle(group)}" in 1Password holds no valid key: fix or archive that item, then run seal again`);
  if (!groupItem && readItem(opTitle(slug))?.group === group) throw new Error(`"${opGroupTitle(group)}" is missing from 1Password but ${slug} still points at it: restore it from the archive, or archive "${opTitle(slug)}" to start the group again`);
}

/**
 * Replace a page's item. The old one is archived first, because two items with one title break
 * every lookup; if the new one can't be created, the old one is put back, so a failure never
 * leaves a sealed page without its key.
 */
function replacePageItem(slug: string, old: OpItem | null, create: () => void): void {
  const title = opTitle(slug);
  if (old) archiveItem(title);
  try { create(); }
  catch (e) {
    if (old && !readItem(title)) {
      if (old.group) storePageGroup(slug, old.group);
      else if (validKey(old.password)) storeKey(slug, old.password);
    }
    throw e;
  }
}

/**
 * Make the page's 1Password items match its `bh:group` (or lack of one), creating whatever is
 * missing. Returns the key before and after: they differ when the page's group changed, which
 * re-keys it. An item whose mode changed is archived, not edited, so no secret passes through argv.
 */
function ensureKey(slug: string, group: string): { before: string | null; key: string | null } {
  const before = readKey(slug), title = opTitle(slug), item = readItem(title);
  checkItems(slug, group);
  if (group) {
    if (!readItem(opGroupTitle(group))) { storeGroupKey(group); console.log(c.green(`Created a group key in 1Password: "${opGroupTitle(group)}" (vault ${OP_VAULT})`)); }
    if (item?.group !== group) replacePageItem(slug, item, () => storePageGroup(slug, group));
  } else if (!(item && !item.group && validKey(item.password))) {
    replacePageItem(slug, item, () => storeKey(slug));
    console.log(c.green(`Created a key in 1Password: "${title}" (vault ${OP_VAULT})`));
  }
  return { before, key: readKey(slug) };
}

/** Identifies the sealed plaintext without revealing anything about it (keyed MAC). */
const sealDigest = (key: Buffer, plain: Buffer) => crypto.createHmac("sha256", key).update(plain).digest("hex");

/** The base64 ciphertext inside a sealed page, whitespace removed. */
const sealedPayload = (text: string) => ((text.match(/id="sealed-payload">([\s\S]*?)<\/script>/) || [])[1] || "").replace(/\s+/g, "");

function sealedShell(payload: string, digest: string, shell: string = SHELL_VERSION()): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <!-- A link preview must reveal nothing: this card is the same for every private page. -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
  <meta property="og:title" content="Private page">
  <meta property="og:description" content="This page is private. Open it with the full link you were given.">
  <meta property="og:image" content="${escapeHtml(SITE_URL + SHARED_CARD)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${CARD_W}">
  <meta property="og:image:height" content="${CARD_H}">
  <meta property="og:image:alt" content="${escapeHtml(SHARED_CARD_ALT)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="bh:sealed" content="aes-256-gcm+gzip">
  <meta name="bh:sealed-digest" content="${digest}">
  <meta name="bh:sealed-shell" content="${shell}">
  <title>Private page</title>
  <link rel="icon" type="image/svg+xml" href="../theme/logo/mark-tile.svg">
  <link rel="apple-touch-icon" href="../theme/logo/apple-touch-icon.png">
  <!-- GENERATED by \`npm run seal\` from a git-ignored docs/*.private.html. Do not edit. -->
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: light-dark(#f6f7f9, #0c0e12); color: light-dark(#15181e, #e7e9ee); }
    main { max-width: 32rem; padding: 2rem 1rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
    p { line-height: 1.6; color: light-dark(#596173, #9ba3b4); }
  </style>
</head>
<body>
<main>
  <h1>Private page</h1>
  <p id="sealed-message">This page is encrypted. Open it with the full link you were given, including the part after <code>#</code>.</p>
</main>
<script type="application/octet-stream" id="sealed-payload">
${(payload.match(/.{1,120}/g) || []).join("\n")}
</script>
<script>
const message = document.getElementById("sealed-message");
const store = "bh-sealed-key:" + location.pathname;
async function unseal(fromStorage) {
  const m = location.hash.match(/^#k=([A-Za-z0-9_-]{43})(?:&(.*))?$/);
  let key = m ? m[1] : null, anchor = m ? m[2] || "" : location.hash.slice(1);
  if (!key && fromStorage) { try { key = sessionStorage.getItem(store); } catch {} }
  if (!key) return;
  const bytes = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  try {
    const raw = bytes(document.getElementById("sealed-payload").textContent.replace(/\\s+/g, ""));
    const k = await crypto.subtle.importKey("raw", bytes(key.replace(/-/g, "+").replace(/_/g, "/") + "="), "AES-GCM", false, ["decrypt"]);
    const gz = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, k, raw.slice(12));
    const html = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    try { sessionStorage.setItem(store, key); } catch {}
    // Keep the key out of the address bar, copied section links and screenshots.
    history.replaceState(null, "", location.pathname + location.search + (anchor ? "#" + anchor : ""));
    // Tells the theme this is a private page, so it offers no review (an exported review quotes the page).
    // document.open() replaces the document, not the window, so the flag is in place before the page's first script.
    window.bhSealed = true;
    document.open();
    document.write(html);
    document.close();
  } catch {
    try { sessionStorage.removeItem(store); } catch {}
    message.textContent = "This link's key doesn't open this page. Check that you copied the whole link.";
  }
}
// A link pasted into a tab already showing this notice only changes the fragment.
addEventListener("hashchange", () => unseal(false));
unseal(true);
</script>
</body>
</html>
`;
}

/** Changes whenever the shell's markup or script changes, so stale shells get re-sealed. */
function SHELL_VERSION(): string {
  return crypto.createHash("sha256").update(sealedShell("", "", "")).digest("hex").slice(0, 16);
}

/** Rewrap sealed pages in the current shell, keeping each payload as it is. Needs no key. */
function reshell(): void {
  for (const file of sealedFiles()) {
    const text = fs.readFileSync(file, "utf8"), rel = path.relative(ROOT, file);
    const next = sealedShell(sealedPayload(text), getMeta(text, "bh:sealed-digest"));
    if (next === text) { console.log(c.dim(`${rel} is up to date`)); continue; }
    fs.writeFileSync(file, next);
    console.log(c.green(`Rewrapped ${rel} in the current shell`));
  }
}

/** The page's `bh:group` from its plaintext ("" for none); exits on a name that isn't kebab-case. */
function sourceGroup(src: string): string {
  const group = getMeta(stripComments(fs.readFileSync(src, "utf8")), "bh:group");
  if (group && !GROUP_RE.test(group)) { console.error(c.red(`${path.relative(ROOT, src)}: bh:group "${group}" must be kebab-case (a-z, 0-9, hyphens)`)); process.exit(1); }
  return group;
}

/** The card a private source would show: what `readDoc` extracts, as plain data. */
const sourceCard = (src: string) => { const d = readDoc(src); return cardFromDoc(d, docTopics(d)); };

function cmdSeal(argv: string[] = []): void {
  if (argv.includes("--reshell")) return reshell();
  const showLinks = argv.includes("--show-links");
  const sources = privateSources();
  const cardsFile = path.join(ROOT, CARD_FILE);
  const existing = fs.existsSync(cardsFile) ? parseCardsFile(fs.readFileSync(cardsFile, "utf8")).entries : [];
  // Refuse what can be known up front before writing anything: a failure half way would leave the pages and their cards out of step.
  // (A 1Password write that fails mid-run still can; the cards written below then follow the pages that were sealed.)
  const plans = sources.map((src) => {
    const slug = path.basename(src, PRIVATE_EXT), out = path.join(DOCS, `${slug}.html`);
    const group = sourceGroup(src);
    if (fs.existsSync(out) && !isSealed(out)) { console.error(c.red(`Refusing to overwrite public page ${path.relative(ROOT, out)}`)); process.exit(1); }
    try { checkItems(slug, group); } catch (e) { console.error(c.red(`${slug}: ${(e as Error).message}`)); process.exit(1); }
    return { src, slug, out, rel: path.relative(ROOT, out), group };
  });
  const fresh: Record<string, string> = {}, groups = new Map<string, string>();
  try {
    for (const { src, slug, out, rel, group } of plans) {
      const { before, key: storedKey } = ensureKey(slug, group);
      const keyText = storedKey!; // ensureKey stores the key and reads it back
      if (fs.existsSync(out) && before !== keyText) {
        const why = !before ? "its key was missing from 1Password, so a new one was made" : group ? `now in the group "${group}"` : "it left its group";
        console.warn(c.yellow(`⚠ ${slug}: its key changed (${why}). The page is re-encrypted, so every old #k= link to ${rel} stops working: share the new link.`));
      }
      const key = Buffer.from(keyText, "base64url");
      // The hero's facts and banner go into the plaintext first, as `index` writes them into a public page:
      // the sealed page then reads as one does, and the digest covers them.
      const text = fs.readFileSync(src, "utf8"), filled = withHeroMeta(text, src);
      if (filled !== text) { fs.writeFileSync(src, filled); console.log(c.green(`Wrote the hero's facts into ${path.relative(ROOT, src)}`)); }
      const plain = fs.readFileSync(src);
      const digest = sealDigest(key, plain);
      // Re-sealing unchanged plaintext would only change the IV, so leave the file alone.
      const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
      if (getMeta(current, "bh:sealed-digest") === digest && getMeta(current, "bh:sealed-shell") !== SHELL_VERSION()) {
        // Same plaintext, older shell: keep the ciphertext (a new IV would only add churn).
        fs.writeFileSync(out, sealedShell(sealedPayload(current), digest));
        console.log(c.green(`Rewrapped ${rel} in the current shell`));
      } else if (!(getMeta(current, "bh:sealed-digest") === digest && getMeta(current, "bh:sealed-shell") === SHELL_VERSION())) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
        const sealed = Buffer.concat([iv, cipher.update(zlib.gzipSync(plain, { level: 9 })), cipher.final(), cipher.getAuthTag()]);
        fs.writeFileSync(out, sealedShell(sealed.toString("base64"), digest));
        console.log(c.green(`Sealed ${path.relative(ROOT, src)} → ${rel}`));
      } else console.log(c.dim(`${rel} is up to date`));
      console.log(`  link: ${rel}#k=${showLinks ? keyText : `<password of "${group ? opGroupTitle(group) : opTitle(slug)}">`}`);
      fresh[slug] = buildBlob(existing.find((e) => e.slug === slug)?.blob, sourceCard(src), keyText, slug);
      if (group) groups.set(group, keyText);
    }
  } finally {
    // The card file follows the sealed pages: a blob each, those without local plaintext kept, orphans dropped.
    // Written even if a page failed, so the pages that were sealed keep matching cards.
    const text = renderCardsFile(mergeEntries(existing, fresh, new Set(sealedFiles().map((f) => path.basename(f, ".html")))));
    if (!fs.existsSync(cardsFile) || fs.readFileSync(cardsFile, "utf8") !== text) {
      fs.writeFileSync(cardsFile, text);
      console.log(c.green(`Updated ${CARD_FILE}`));
    } else if (sources.length) console.log(c.dim(`${CARD_FILE} is up to date`));
  }
  if (!sources.length) { console.log(c.dim("No docs/*.private.html to seal.")); return; }
  for (const [name, keyText] of [...groups].sort()) console.log(`  home page, group "${name}": index.html#k=${showLinks ? keyText : `<password of "${opGroupTitle(name)}">`}`);
  if (!showLinks) console.log(c.dim("Run `npm run seal -- --show-links` to print the full links."));
}

/** Decrypt a sealed page with its key; the inverse of the encryption in cmdSeal. */
function unsealFile(file: string, keyText: string): Buffer {
  const text = fs.readFileSync(file, "utf8");
  const b64 = (text.match(/id="sealed-payload">([\s\S]*?)<\/script>/) || [])[1];
  if (!b64) throw new Error(`${path.relative(ROOT, file)} has no sealed payload`);
  const raw = Buffer.from(b64.replace(/\s+/g, ""), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyText, "base64url"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return zlib.gunzipSync(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]));
}

function cmdUnseal(argv: string[]): void {
  const force = argv.includes("--force");
  const wanted = argv.filter((a) => a !== "--force");
  const shells = sealedFiles().filter((f) => !wanted.length || wanted.includes(path.basename(f, ".html")));
  if (!shells.length) { console.log(c.dim(wanted.length ? `No sealed page named ${wanted.join(", ")}.` : "No sealed pages.")); return; }
  for (const shell of shells) {
    const slug = path.basename(shell, ".html");
    const out = path.join(DOCS, slug + PRIVATE_EXT), rel = path.relative(ROOT, out);
    const keyText = readKey(slug);
    if (!keyText) { console.error(c.red(`No key for ${slug} in 1Password (vault ${OP_VAULT}): ${missingKeyReason(slug)}`)); process.exitCode = 1; continue; }
    let plain: Buffer;
    try { plain = unsealFile(shell, keyText); } catch (e) { console.error(c.red(`Can't decrypt docs/${slug}.html: ${(e as Error).message}`)); process.exitCode = 1; continue; }
    if (fs.existsSync(out)) {
      if (fs.readFileSync(out).equals(plain)) { console.log(c.dim(`${rel} is up to date`)); continue; }
      if (!force) { console.error(c.red(`${rel} has edits that aren't sealed yet; run \`npm run seal\`, or \`unseal -- --force\` to discard them`)); process.exitCode = 1; continue; }
    }
    fs.writeFileSync(out, plain);
    console.log(c.green(`Unsealed docs/${slug}.html → ${rel}`));
  }
}

// ---- serve ------------------------------------------------------------------------

/** What review comments are made against: repo, commit and whether the tree had edits.
    On GitHub Pages the deploy writes theme/build.js; `serve` and `bundle` compute it here. */
function buildInfo() {
  const git = (args: string) => { try { return execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const repo = String(pkg.repository || "").replace(/^github:/, "");
  return { repo, commit: git("rev-parse HEAD") || null, dirty: git("status --porcelain -- docs theme index.html") !== "", builtAt: new Date().toISOString() };
}
/** `stamp`: the build stamp on one line, for the Review panel of a page opened from file://, which has none (#353). */
function cmdStamp(): void { console.log(JSON.stringify(buildInfo())); }
const buildScript = (info: ReturnType<typeof buildInfo>) => `/* Review build stamp (generated, not committed). */\nwindow.BH_BUILD = ${JSON.stringify(info)};\n`;

function cmdServe([port = "8000", host]: string[]): void {
  const root = fs.realpathSync(ROOT);
  const contains = (file: string) => file === root || file.startsWith(root + path.sep);
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".xml": "application/xml; charset=utf-8", ".woff2": "font/woff2", ...MIME };
  const server = http.createServer((req, res) => {
    let p: string;
    try { p = decodeURIComponent(new URL(req.url!, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
    // A missing path gets the 404 page with status 404, as on GitHub Pages (plain text if it has not been generated yet).
    const notFound = () => fs.readFile(path.join(root, NOT_FOUND_FILE), (e, page) => {
      if (e) res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      else {
        // The page's assets are rooted at `homepage`'s path; serve mounts the repo at "/".
        const html = SITE_PATH === "/" ? page : page.toString().replaceAll(`"${SITE_PATH}`, '"/');
        res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }).end(html);
      }
    });
    if (p === "/theme/build.js") {
      res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" }).end(buildScript(buildInfo()));
      return;
    }
    // What changed in a page since a commit (the Review panel asks): computed here from git, as the
    // deploy writes it for the commits that review files name. Any commit works locally.
    const diffReq = p.match(/^\/theme\/diffs\/([a-z0-9][a-z0-9-]*)\.([0-9a-f]{7,40})\.js$/);
    if (diffReq) {
      const page = `docs/${diffReq[1]}.html`, file = path.join(root, page);
      const script = fs.existsSync(file) && !isPrivateSource(file) ? reviewDiffScript(root, page, diffReq[2], fs.readFileSync(file, "utf8")) : null;
      if (script === null) notFound();
      else res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-cache" }).end(script);
      return;
    }
    let file = path.join(root, p), target: string;
    if (!contains(file)) { res.writeHead(403).end(); return; }
    try {
      target = fs.realpathSync(file);
      if (!contains(target)) { res.writeHead(403).end(); return; }
      if (fs.statSync(target).isDirectory()) {
        file = path.join(file, "index.html");
        target = fs.realpathSync(path.join(target, "index.html"));
        if (!contains(target)) { res.writeHead(403).end(); return; }
      }
    } catch { notFound(); return; }
    fs.readFile(target, (e, data) => {
      if (e) { notFound(); return; }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(data);
    });
  });
  const listening = () => {
    // The port actually bound, so `serve 0` (any free port, as the tests use) says which one it got.
    const base = `http://${host ?? "localhost"}:${(server.address() as { port: number }).port}/`;
    console.log(`Serving ${ROOT} at ${c.green(base)}`);
    console.log(c.dim(`Unlisted pages stay hidden here, as for readers: open any page with #unlisted=true to see them (${base}#unlisted=true).`));
    console.log(c.dim(`Example pages are hidden too: open any page with ?examples to see them (${base}?examples).`));
  };
  // Every interface by default. A host binds that address only: the tests pass 127.0.0.1, because on macOS a
  // port the kernel picks for the dual-stack wildcard may already be held on 127.0.0.1 by another process,
  // which then answers the tests' requests.
  if (host) server.listen(+port, host, listening);
  else server.listen(+port, listening);
}

// ---- main -------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
const commands: Record<string, (args: string[]) => unknown> = { new: cmdNew, index: cmdIndex, check: cmdCheckCommand, cards: cmdCards, bundle: cmdBundle, diff: cmdDiff, seal: cmdSeal, unseal: cmdUnseal, serve: cmdServe, stamp: cmdStamp };
if (!commands[cmd]) {
  console.log(`beautiful-html

  new [--private] [--example] [--unlisted] <template> <slug> "<Title>" ["<desc>"]
                                               create docs/<slug>.html (or a git-ignored <slug>.private.html);
                                               --unlisted publishes it off the site's listings (see contracts/unlisted-pages.md)
  index                                        regenerate the document list in index.html
  check [--skip-keys]                          lint docs/ and index.html (links, ids, stepper refs, a11y);
                                               --skip-keys skips the 1Password lookups of private pages' keys
  cards [--force] [--system-fonts]             render the social card of every page whose card is missing or stale
  bundle <page | --all>                        inline the theme → dist/<page>.html (one shareable file)
  diff <page> [base] [head]                    what changed in a page: base (default HEAD) → head (default: the
                                               working tree), as dist/diff/<page>.html with the changes marked
  diff --changed <base> [--out <dir>] [--summary <file>]
                                               the same for every page that differs from <base>
  seal [--show-links | --reshell]              encrypt docs/*.private.html → docs/<slug>.html (keys in 1Password);
                                               --reshell rewraps sealed pages in the current shell, no key needed
  unseal [slug…] [--force]                     recreate docs/<slug>.private.html from the sealed page and its key
  serve [port] [host]                          static server on http://localhost:8000/ (every interface unless
                                               a host is given; port 0 picks a free port and prints it)
  stamp                                        print the build stamp \`serve\` gives a page (repo, commit, dirty) as
                                               JSON: what a review made from file:// asks for`);
  process.exit(cmd ? 2 : 0);
}
try { await commands[cmd](args); } catch (e) { console.error(c.red(`bh ${cmd}: ${(e as Error).message}`)); process.exit(1); }
