#!/usr/bin/env node
// Local addition (not upstream): embeds a built Anatomy figure into a Bitwise Engineering page.
// Reads the standalone page a figure's build.mjs wrote, and puts its figure, CSS and script into
// a docs/<slug>.html page, adapted to the house theme. See references/bitwise-blog.md.
//
//   node embed.mjs <built.html> <docs/page.html> --id <figure-id> [--before <element-id>]
//
// Re-running replaces the figure, its CSS and its script in place, so rebuild-and-embed is safe.
import { readFileSync, writeFileSync } from "node:fs";

const USAGE = "usage: embed.mjs <built.html> <docs/page.html> --id <figure-id> [--before <element-id>]";
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAIN_OPEN = '<main class="iso-page">';

// Rules the standalone page adds around the figure (the kit's PAGE_CSS). They style the whole
// document, so inside a blog page they would repaint the body and force a dark colour scheme.
const PAGE_SELECTORS = new Set(["*", "html", "body", 'body[data-theme="light"]', ".iso-page"]);

function args(argv) {
  const out = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--id") out.id = argv[++i];
    else if (argv[i] === "--before") out.before = argv[++i];
    else out.pos.push(argv[i]);
  }
  return out;
}

function fail(message) {
  console.error(`embed: ${message}`);
  process.exit(1);
}

// Top-level CSS rules, brace-depth aware, so an @media block counts as one rule. Braces inside
// comments and quoted strings (`content: "{"`) do not count.
function topLevelRules(css) {
  const rules = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const lead = depth === 0 && !css.slice(start, i).trim();
      i = end < 0 ? css.length : end + 1;
      if (lead) start = i + 1; // a comment between rules is not part of the next rule's selector
    } else if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      rules.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return rules.filter(Boolean);
}

// Selectors of the rules nested in an at-rule block (@media, @supports, @layer), one level deep.
function nestedSelectors(rule) {
  const open = rule.indexOf("{");
  if (!rule.startsWith("@") || open < 0) return [];
  return topLevelRules(rule.slice(open + 1, rule.lastIndexOf("}"))).map((r) => r.slice(0, r.indexOf("{")).trim());
}

// The built page up to its </main>. The kit's own source comes after, and mentions <style>,
// <main> and <script> in strings.
function beforeScript(built) {
  const main = built.indexOf("</main>");
  if (main < 0) fail("no </main> in the built page");
  return built.slice(0, main + "</main>".length);
}

function figureCss(built) {
  const blocks = [...beforeScript(built).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  if (!blocks.length) fail("no <style> in the built page");
  const kept = [];
  const pageWide = (selector) => PAGE_SELECTORS.has(selector) || /(^|[\s,>+~])(html|body|:root)\b/.test(selector);
  const warn = (selector) => console.warn(`embed: warning: the figure's CSS has a rule on "${selector}", which restyles the whole page; scope it to the figure`);
  for (const rule of blocks.flatMap(topLevelRules)) {
    const selector = rule.slice(0, rule.indexOf("{")).trim();
    if (PAGE_SELECTORS.has(selector)) continue;
    if (pageWide(selector)) warn(selector);
    // A page-wide rule inside @media is not dropped (the block may hold other rules), so say so.
    for (const inner of nestedSelectors(rule)) if (pageWide(inner)) warn(`${selector} { ${inner} }`);
    kept.push(rule);
  }
  return kept.join("\n");
}

// Everything inside <main class="iso-page">, minus its <style> elements (figureCss has them). A
// figure is usually the only thing there; some wrap it in an element their script looks up (the
// ripple tank's <div class="rt">). The id, "iso" and "wide" go on the outermost element, and a
// wrapped <figure> gets its own id, since every figure on a page needs one.
function figureMarkup(built, id) {
  const head = beforeScript(built);
  const open = head.indexOf(MAIN_OPEN);
  if (open < 0) fail(`no ${MAIN_OPEN} in the built page`);
  const inner = head.slice(open + MAIN_OPEN.length, head.lastIndexOf("</main>"));
  const markup = inner.replace(/<style>[\s\S]*?<\/style>/g, "").trim();
  const first = /^<([a-z0-9]+)\b([^>]*)>/.exec(markup);
  if (!first || !markup.endsWith(`</${first[1]}>`)) fail("the built page's figure is not a single element");
  const [tag, name, attrs] = first;
  const cls = /\sclass="([^"]*)"/.exec(attrs);
  const decorated = cls
    ? attrs.replace(cls[0], ` class="${cls[1]} iso wide no-glossary" id="${id}" data-vr-mask`)
    : `${attrs} class="iso wide no-glossary" id="${id}" data-vr-mask`;
  let out = `<${name}${decorated}>${markup.slice(tag.length)}`;
  if (name !== "figure") {
    if (!/<figure\b/.test(out)) fail("no <figure> in the built page's markup");
    out = out.replace(/<figure\b(?![^>]*\sid=)/, `<figure id="${id}-figure"`);
  }
  return out;
}

function figureScript(built) {
  // The module script is the one after </main>, and runs to the last </script> (the kit escapes
  // its own "</script" as "<\/script").
  const open = '<script type="module">';
  const start = built.indexOf(open, built.indexOf("</main>"));
  if (start < 0) fail('no <script type="module"> after </main> in the built page');
  return built.slice(start + open.length, built.lastIndexOf("</script>"));
}

// The kit themes a figure from data-theme on its .iso wrapper, and the shader figures read it once
// at load. So this runs first in the script, and keeps the wrapper in step with the blog's own
// theme: the toggle's data-theme on <html>, else the system preference.
function bridge(id) {
  return `(() => {
  const root = document.documentElement, fig = document.getElementById(${JSON.stringify(id)});
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const sync = () => { fig.dataset.theme = root.dataset.theme || (dark.matches ? "dark" : "light"); };
  sync();
  dark.addEventListener("change", sync);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
})();
`;
}

function cssBlock(id, css) {
  // Contrast: the kit's muted text is about 3.3:1 in light and 3.6:1 in dark; the house bar is 4.5:1.
  // The blog's figcaption counter would put "Figure N —" before the kit's legend.
  return `/* anatomy:start ${id} (generated by embed.mjs; re-run it, do not edit) */
${css}
#${id}.iso { --anatomy-muted: #8e8e8e; }
#${id}.iso[data-theme="light"] { --anatomy-muted: #6b6b70; }
#${id} figcaption::before, #${id} > figcaption::before { content: none; }
/* The blog's copy-link button sits in the figure's top-right corner, where the kit puts the title. */
#${id} .iso-plate-corner[data-corner="title"] { right: 36px; }
/* anatomy:end ${id} */`;
}

// Replaces what lies from `from` to the end of `to`, or returns null when `from` is absent.
function replaceBetween(text, from, to, replacement) {
  const a = text.indexOf(from);
  if (a < 0) return null;
  const b = text.indexOf(to, a);
  if (b < 0) fail(`found "${from}" with no "${to}" after it`);
  return text.slice(0, a) + replacement + text.slice(b + to.length);
}

function embed(page, id, before, parts) {
  // CSS, in the page's one <style>.
  const css = cssBlock(id, parts.css);
  page = replaceBetween(page, `/* anatomy:start ${id} `, `/* anatomy:end ${id} */`, css) ?? (() => {
    const at = page.indexOf("</style>");
    if (at >= 0) return `${page.slice(0, at)}\n${css}\n${page.slice(at)}`;
    return page.replace("</head>", () => `<style>\n${css}\n</style>\n</head>`);
  })();

  // Figure, a direct child of the article, between comment markers so a re-run can find it.
  const figStart = `<!-- anatomy:figure ${id} start -->`;
  const figEnd = `<!-- anatomy:figure ${id} end -->`;
  const figure = `${figStart}\n${parts.figure}\n${figEnd}`;
  page = replaceBetween(page, figStart, figEnd, figure) ?? (() => {
    if (!before) fail(`no figure "${id}" in the page yet: say where it goes with --before <element-id>`);
    const target = new RegExp(`^([ \\t]*)<[a-z0-9]+\\b[^>]*\\sid="${before}"`, "m").exec(page);
    if (!target) fail(`no element with id "${before}" at the start of a line`);
    return `${page.slice(0, target.index)}${target[1]}${figure}\n\n${page.slice(target.index)}`;
  })();

  // Script, last in the body. The kit's source contains the text "</body>", so use the last one.
  const scriptStart = `<script type="module" data-anatomy="${id}">`;
  const script = `${scriptStart}\n${bridge(id)}${parts.script}\n</script>\n`;
  page = replaceBetween(page, scriptStart, "</script>\n", script) ?? (() => {
    const at = page.lastIndexOf("</body>");
    if (at < 0) fail("no </body> in the page");
    return page.slice(0, at) + script + page.slice(at);
  })();
  return page;
}

const { pos, id, before } = args(process.argv.slice(2));
if (pos.length !== 2 || !id) fail(USAGE);
if (!KEBAB.test(id)) fail(`--id "${id}" must be kebab-case (a-z, 0-9, hyphens)`);
if (before && !KEBAB.test(before)) fail(`--before "${before}" must be kebab-case`);

const built = readFileSync(pos[0], "utf8");
const parts = { figure: figureMarkup(built, id), css: figureCss(built), script: figureScript(built) };
writeFileSync(pos[1], embed(readFileSync(pos[1], "utf8"), id, before, parts));
console.log(`embedded #${id} into ${pos[1]}: ${(parts.figure.length / 1024).toFixed(0)} KB markup, ${(parts.script.length / 1024).toFixed(0)} KB script`);
