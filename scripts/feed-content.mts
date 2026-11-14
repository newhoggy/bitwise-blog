// Full content for the Atom feed.
//
// A post that opts in with <meta name="bh:feed" content="full"> gets a <content type="html"> in
// its feed entry. This module turns the page's <article class="bh-article"> into HTML that a feed
// reader can show with no theme, no script and no page CSS:
//
//   - scripts, styles, templates, controls (buttons, form fields), canvases, frames, anything
//     hidden, and anything marked `data-feed-omit` are left out, with their content;
//   - the hero's eyebrow, <h1> (the entry has the title) and meta list, and the article footer, too;
//   - attributes come from a short allow-list, so every data-* hook, class, id, style, role and
//     on* handler goes;
//   - href and src are made absolute against the page's own URL;
//   - links to pages the feed must not reveal (example, unlisted, private, sealed) become text,
//     as scripts/publish.mts does for example pages;
//   - <bh-…> components, spans and <noscript> are unwrapped, so a component arrives as its no-script fallback;
//   - an inline <svg> (drawn with theme classes, so its lines would vanish) or a Mermaid sketch
//     becomes its text alternative and a link to the figure on the page;
//   - a sidenote becomes a numbered marker, with the notes listed at the end.
//
// The result is HTML, not yet escaped for XML: the feed generator escapes it. Regex-based, like
// the rest of the tooling: fine for the pages we author, not a general HTML parser.

/** Where the content is going. */
export interface FeedContentOptions {
  /** The page's absolute URL. Relative links and images resolve against it. */
  pageUrl: string;
  /** True for a page the feed must not link to, given as origin + decoded path (no query or fragment). */
  hidden?: (url: string) => boolean;
}

/** What one walk of the article gives: the content, and the interactive parts that cannot survive it. */
export interface FeedWalk { content: string; interactives: string[] }

interface Attr { name: string; value: string | null }
type Token =
  | { kind: "text"; text: string }
  | { kind: "open"; name: string; attrs: Attr[]; selfClose: boolean }
  | { kind: "close"; name: string };
type Mode = "keep" | "unwrap" | "drop" | "sidenote";
interface Frame { name: string; mode: Mode; id: string; out?: string[] }

const TAG = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Left out with everything inside them: they need a script or the page to mean anything. */
const DROP = new Set(["script", "style", "template", "button", "input", "select", "textarea", "form", "label", "canvas", "iframe", "object", "embed", "dialog", "meta", "link", "base", "area", "param", "h1"]);
/** Classes of theme furniture that a feed entry already has, or does not need. */
const DROP_CLASSES = ["eyebrow", "bh-meta", "bh-footer", "bh-hero-mark"];
/** Controls a reader cannot run: reported by `check` on a `full` page. */
const CONTROLS = new Set(["button", "input", "select", "textarea", "form", "canvas", "iframe", "object", "embed", "dialog"]);
/** The only attributes that reach the feed. */
const KEEP_ATTRS = new Set(["href", "src", "srcset", "sizes", "media", "poster", "alt", "title", "width", "height", "colspan", "rowspan", "scope", "headers", "abbr", "lang", "dir", "cite", "datetime", "start", "reversed", "type", "value", "open", "controls", "loop", "muted", "playsinline"]);
const URL_ATTRS = new Set(["href", "src", "cite", "poster"]);
/** URL schemes that would run code or smuggle a document in a reader: such a link becomes text, such an image goes. */
const UNSAFE_SCHEMES = new Set(["javascript:", "vbscript:", "data:"]);
/** An end tag HTML lets an author leave out, closed by the next of these (up to the boundary that holds them). */
const IMPLIED_END: Record<string, { closes: string[]; within: string[] }> = {
  li: { closes: ["li"], within: ["ul", "ol", "menu"] },
  dt: { closes: ["dt", "dd"], within: ["dl"] },
  dd: { closes: ["dt", "dd"], within: ["dl"] },
  tr: { closes: ["tr", "td", "th"], within: ["table", "thead", "tbody", "tfoot"] },
  td: { closes: ["td", "th"], within: ["tr", "table"] },
  th: { closes: ["td", "th"], within: ["tr", "table"] },
};
/** Elements that close an open <p> when they start, as in HTML. */
const CLOSES_P = new Set(["address", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
/** Where a search for an open <p> stops: a <p> outside one of these is not in scope. */
const P_SCOPE = new Set(["li", "td", "th", "dd", "dt", "blockquote", "figure", "details", "section", "aside", "div", "table", "button"]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
/** A numeric entity's character, or U+FFFD when it names no character XML allows. */
const codePoint = (n: number) =>
  Number.isInteger(n) && (n === 0x9 || n === 0xa || n === 0xd || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff)) ? String.fromCodePoint(n) : "\ufffd";
/** A URL attribute as written → the URL. One pass, so "&amp;#65;" stays "&#65;"; named entities beyond the basic ones stay as written. */
const decode = (s: string) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) =>
  dec ? codePoint(+dec) : hex ? codePoint(parseInt(hex, 16)) : NAMED[name!.toLowerCase()] ?? m);
/** Plain text → attribute value. */
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** HTML as written (an attribute value or text) → the same HTML, safe in a double-quoted attribute or text: entities stay entities. */
const escHtml = (s: string) => s.replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseAttrs(raw: string): Attr[] {
  return [...raw.matchAll(ATTR)].map((m) => ({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? null }));
}
const attrOf = (attrs: Attr[], name: string) => attrs.find((a) => a.name === name);
const classesOf = (attrs: Attr[]) => new Set((attrOf(attrs, "class")?.value || "").split(/\s+/).filter(Boolean));

/** The page's tags and text in order. Comments are skipped; script and style bodies are one text token. */
function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const lower = html.toLowerCase();
  const re = new RegExp(TAG.source, "g");
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m.index > last) out.push({ kind: "text", text: html.slice(last, m.index) });
    last = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;
    const name = m[2].toLowerCase();
    if (m[1]) { out.push({ kind: "close", name }); continue; }
    const selfClose = m[4] === "/";
    out.push({ kind: "open", name, attrs: parseAttrs(m[3]), selfClose });
    if (RAW_TEXT.has(name) && !selfClose) {
      const end = lower.indexOf(`</${name}`, last);
      const stop = end < 0 ? html.length : end;
      if (stop > last) out.push({ kind: "text", text: html.slice(last, stop) });
      re.lastIndex = last = stop;
    }
  }
  if (last < html.length) out.push({ kind: "text", text: html.slice(last) });
  return out;
}

/** The tokens inside the page's <article class="bh-article">, or none. */
function articleTokens(html: string): Token[] {
  const all = tokenize(html);
  const start = all.findIndex((t) => t.kind === "open" && t.name === "article" && classesOf(t.attrs).has("bh-article"));
  if (start < 0) return [];
  let depth = 0;
  for (let i = start + 1; i < all.length; i++) {
    const t = all[i];
    if (t.kind === "open" && t.name === "article") depth++;
    if (t.kind === "close" && t.name === "article" && depth-- === 0) return all.slice(start + 1, i);
  }
  return all.slice(start + 1);
}

/** The key `hidden` is asked about: origin + decoded path, so "%65dge.html" is "edge.html". */
function pageKey(url: URL): string {
  try { return url.origin + decodeURIComponent(url.pathname); } catch { return url.origin + url.pathname; }
}

/** Walk the article once: the feed content, and the interactive parts a reader cannot run. */
export function walkArticle(html: string, { pageUrl, hidden = () => false }: FeedContentOptions): FeedWalk {
  const stack: Frame[] = [];
  const notes: string[] = [];
  const interactives = new Set<string>();
  let out: string[] = [];
  let dropping = 0; // open frames in "drop" mode: while above 0, nothing is written
  let inComponent = 0; // open <bh-…> elements: only the outermost is reported

  // Checked after parsing, because the parser drops tabs and newlines: "java&#x09;script:" is javascript:.
  const absolute = (value: string): string | null => {
    let url: URL;
    try { url = new URL(decode(value).trim(), pageUrl); } catch { return null; }
    return UNSAFE_SCHEMES.has(url.protocol) ? null : url.href;
  };
  /** srcset: each candidate's URL made absolute; an unsafe or unparsable candidate is dropped. */
  const absoluteSet = (value: string) => decode(value).split(",").map((c) => c.trim().split(/\s+/)).filter((c) => c[0])
    .map(([u, ...d]) => { const a = absolute(u); return a === null ? null : [a, ...d].join(" "); }).filter((c) => c !== null).join(", ");
  const isHiddenLink = (href: string) => {
    try { const u = new URL(href); return /^https?:$/.test(u.protocol) && hidden(pageKey(u)); } catch { return false; }
  };
  const figureLink = () => {
    const fig = [...stack].reverse().find((f) => f.name === "figure" && f.id);
    return fig ? `${pageUrl}#${fig.id}` : pageUrl;
  };
  const diagram = (label: string) =>
    `<p>[Diagram${label ? `: ${escHtml(label)}` : ""}] <a href="${escAttr(figureLink())}">See the diagram on the page.</a></p>`;
  const tag = (name: string, attrs: Attr[]) => {
    const kept = attrs.filter((a) => KEEP_ATTRS.has(a.name)).map((a) => {
      if (a.value === null) return ` ${a.name}`;
      if (a.name === "srcset") return ` srcset="${escAttr(absoluteSet(a.value))}"`;
      if (!URL_ATTRS.has(a.name)) return ` ${a.name}="${escHtml(a.value)}"`;
      const url = absolute(a.value);
      return url === null ? "" : ` ${a.name}="${escAttr(url)}"`;
    });
    return `<${name}${kept.join("")}>`;
  };
  /** Close the elements whose end tag the author may leave out, before `name` opens. */
  const impliedEnds = (name: string) => {
    const rule = IMPLIED_END[name];
    const names = stack.map((f) => f.name);
    let at = -1;
    if (rule) {
      // The outermost match below the boundary: a new <tr> closes the open <td> and its <tr>.
      for (let i = names.length - 1; i >= 0 && !rule.within.includes(names[i]); i--) if (rule.closes.includes(names[i])) at = i;
    } else if (CLOSES_P.has(name)) {
      for (let i = names.length - 1; i >= 0 && !P_SCOPE.has(names[i]); i--) if (names[i] === "p") at = i;
    }
    if (at >= 0) while (stack.length > at) close(stack.pop()!);
  };
  // Anatomy figures (the anatomy skill): the figure is in the article, its script last in the body.
  const anatomyIds = new Set([...html.matchAll(/<script\b[^>]*\bdata-anatomy="([^"]+)"/gi)].map((m) => m[1]));
  const close = (f: Frame) => {
    if (f.mode === "drop") dropping--;
    if (f.name.startsWith("bh-")) inComponent--;
    if (f.mode === "keep") out.push(`</${f.name}>`);
    if (f.mode === "sidenote") {
      const note = out.join("").trim();
      out = f.out!;
      notes.push(note);
      out.push(`<sup>[${notes.length}]</sup>`);
    }
  };

  for (const t of articleTokens(html)) {
    if (t.kind === "text") { if (!dropping) out.push(t.text); continue; }
    if (t.kind === "close") {
      const at = stack.map((f) => f.name).lastIndexOf(t.name);
      if (at < 0) continue; // a stray close tag: nothing to match
      while (stack.length > at) close(stack.pop()!);
      continue;
    }
    const { name, attrs } = t;
    impliedEnds(name);
    const isVoid = VOID.has(name) || t.selfClose;
    const cls = classesOf(attrs);
    let mode: Mode;
    if (dropping) mode = "drop";
    else {
      const omitted = attrOf(attrs, "hidden") || attrOf(attrs, "data-feed-omit") || attrOf(attrs, "aria-hidden")?.value === "true";
      if (!omitted) {
        if (name.startsWith("bh-") && !inComponent) interactives.add(`<${name}>`);
        if (CONTROLS.has(name) && !inComponent) interactives.add(`<${name}>`);
        if (name === "pre" && cls.has("mermaid")) interactives.add('<pre class="mermaid">');
        if (anatomyIds.has(attrOf(attrs, "id")?.value || "")) interactives.add("an anatomy figure");
      }
      if (omitted || DROP.has(name) || DROP_CLASSES.some((c) => cls.has(c))) mode = "drop";
      else if (name === "svg") { out.push(diagram(attrOf(attrs, "aria-label")?.value || "")); mode = "drop"; }
      else if (name === "pre" && cls.has("mermaid")) { out.push(diagram("")); mode = "drop"; }
      else if (cls.has("sidenote")) mode = "sidenote";
      else if (name.startsWith("bh-") || name === "span" || name === "noscript" || (name === "header" && cls.has("bh-hero"))) mode = "unwrap";
      else if (name === "a") {
        const href = attrOf(attrs, "href")?.value;
        const abs = href == null ? null : absolute(href);
        mode = abs === null || isHiddenLink(abs) ? "unwrap" : "keep";
      } else mode = "keep";
    }
    if (isVoid) {
      if (mode === "keep") out.push(tag(name, attrs));
      continue;
    }
    const frame: Frame = { name, mode, id: attrOf(attrs, "id")?.value || "" };
    if (mode === "drop") dropping++;
    if (name.startsWith("bh-")) inComponent++;
    if (mode === "keep") out.push(tag(name, attrs));
    // The theme draws the TL;DR label in CSS, so a reader needs it written out.
    if (mode === "keep" && cls.has("tldr")) out.push("<p><strong>TL;DR</strong></p>");
    if (mode === "sidenote") { frame.out = out; out = []; }
    stack.push(frame);
  }
  while (stack.length) close(stack.pop()!);

  let content = out.join("").trim();
  if (notes.length) content += `\n<hr>\n<p><strong>Notes</strong></p>\n<ol>\n${notes.map((n) => `<li>${n}</li>`).join("\n")}\n</ol>`;
  return { content, interactives: [...interactives].sort() };
}

/** The HTML for a feed entry's <content type="html">, before XML escaping. */
export const feedContent = (html: string, options: FeedContentOptions): string => walkArticle(html, options).content;

/** The interactive parts of a page's article that a feed reader cannot run, e.g. "<bh-stepper>", sorted. */
export const feedInteractives = (html: string): string[] => walkArticle(html, { pageUrl: "https://example.invalid/" }).interactives;
