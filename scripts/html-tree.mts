// The tolerant HTML element tree (regex-based; fine for the files we author): enough for
// nesting-aware lint rules and for finding a page's visual. Shared by scripts/bh.mts and the
// rules in scripts/check/. No side effects, so tests can import it (scripts/bh.mts runs its CLI
// on import).

import type { TreeNode } from "./types.mts";

export function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}


export const VOID_TAGS = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const AUTO_CLOSE: Record<string, string[]> = { p: ["p"], li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr", "td", "th"], td: ["td", "th"], th: ["td", "th"], option: ["option"] };
// A start tag whose quoted attribute values may contain ">" (e.g. data-bind expressions).
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;

export function parseTree(html: string): { root: TreeNode; src: string } {
  const src = stripComments(html).replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, "<$1$2></$1>");
  const root: TreeNode = { tag: "#root", attrs: "", children: [], parent: null, start: 0, end: src.length };
  let cur = root;
  for (const m of src.matchAll(TAG_RE)) {
    const [, closing, name, attrs, selfClosing] = m;
    const tag = name.toLowerCase();
    if (closing) {
      let n = cur;
      while (n !== root && n.tag !== tag) n = n.parent!;
      if (n !== root) { n.end = m.index; cur = n.parent!; }
      continue;
    }
    if (AUTO_CLOSE[tag]) while (cur !== root && AUTO_CLOSE[tag].includes(cur.tag)) { cur.end = m.index; cur = cur.parent!; }
    const node: TreeNode = { tag, attrs, children: [], parent: cur, start: m.index + m[0].length, end: src.length };
    cur.children.push(node);
    if (!selfClosing && !VOID_TAGS.has(tag)) cur = node;
  }
  return { root, src };
}

export const nodeAttr = (n: TreeNode, name: string): string | undefined => (n.attrs.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`)) || [])[1];
export const hasClass = (n: TreeNode, c: string) => (nodeAttr(n, "class") || "").split(/\s+/).includes(c);
export function walkTree(n: TreeNode, fn: (n: TreeNode) => void): void { for (const c of n.children) { fn(c); walkTree(c, fn); } }
export function findNode(n: TreeNode, pred: (n: TreeNode) => boolean): TreeNode | null { let hit = null as TreeNode | null; walkTree(n, (c) => { if (!hit && pred(c)) hit = c; }); return hit; }
export const nodeText = (src: string, n: TreeNode) => src.slice(n.start, n.end).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
