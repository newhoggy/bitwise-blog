// `check` rules for diagram geometry: where arrowheads land, and labels that collide.
// No side effects, so tests can import it (scripts/bh.mts runs its CLI on import).

import type { Finding, PathSeg, NodeRect, Box, Pt, TreeNode } from "../types.mts";
import { stripComments, parseTree, nodeAttr, hasClass, walkTree, findNode, nodeText } from "../html-tree.mts";

// ---- SVG edge geometry ---------------------------------------------------------------
//
// Arrowheads (bh.js) are 10 units long. The head's BASE centre sits on the path end and the
// head points along the path's final direction, so the line stops at the base (square-on,
// centred) and never runs under the head to blunt its tip. A path therefore ends ARROW_LEN
// short of where the tip should land. The same applies to the START of `.edge.both` paths.
// The checker projects each tip and verifies it lands on the target node's outline.

export const ARROW_LEN = 10;      // head length in user units (must match bh.js markers)
export const TIP_GAP_MAX = 2;     // tip may stop up to this far outside a node's outline

export function parsePath(d: string): PathSeg[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const segs: PathSeg[] = [];
  let i = 0, cmd: string | null = null, x = 0, y = 0, sx = 0, sy = 0;
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) break;
    const up = cmd.toUpperCase(), rel: boolean = cmd !== up, n = arity[up];
    if (n === undefined) throw new Error(`unsupported path command "${cmd}"`);
    const a = tokens.slice(i, i + n).map(Number);
    i += n;
    const from: Pt = [x, y];
    const pt = (px: number, py: number): Pt => (rel ? [x + px, y + py] : [px, py]);
    let to!: Pt, ctrl: Pt[] | null = null;
    switch (up) {
      case "M": to = pt(a[0], a[1]); sx = to[0]; sy = to[1]; cmd = rel ? "l" : "L"; break;
      case "L": case "T": to = pt(a[0], a[1]); break;
      case "H": to = [rel ? x + a[0] : a[0], y]; break;
      case "V": to = [x, rel ? y + a[0] : a[0]]; break;
      case "C": ctrl = [pt(a[0], a[1]), pt(a[2], a[3])]; to = pt(a[4], a[5]); break;
      case "S": case "Q": ctrl = [pt(a[0], a[1])]; to = pt(a[2], a[3]); break;
      case "A": to = pt(a[5], a[6]); break;
      case "Z": to = [sx, sy]; break;
    }
    if (up !== "M") segs.push({ type: up, from, to, ctrl });
    [x, y] = to;
    if (up === "Z") break;
  }
  return segs;
}

/** Unit direction the path travels at one end ("end" or "start", pointing outward). */
export function endDirection(segs: PathSeg[], end: "end" | "start"): { point: Pt; dir: Pt } | null {
  const ordered = end === "end" ? segs : [...segs].reverse().map((s) => ({
    ...s, from: s.to, to: s.from, ctrl: s.ctrl && [...s.ctrl].reverse(),
  }));
  for (let k = ordered.length - 1; k >= 0; k--) {
    const s = ordered[k];
    // Tangent at the end point: from the nearest distinct control point, else the segment start.
    const candidates = [...(s.ctrl ? [...s.ctrl].reverse() : []), s.from];
    for (const p of candidates) {
      const v = [s.to[0] - p[0], s.to[1] - p[1]], len = Math.hypot(...v);
      if (len > 1e-6) return { point: ordered[ordered.length - 1].to, dir: [v[0] / len, v[1] / len] };
    }
  }
  return null;
}

/** Node rectangles in an <svg> block (first rect inside each <g class="node …">). */
export function nodeRects(svg: string): NodeRect[] {
  const rects: NodeRect[] = [];
  for (const g of svg.matchAll(/<g\b[^>]*\sclass="[^"]*\bnode\b[^"]*"[^>]*>([\s\S]*?)<\/g>/g)) {
    const id = (g[0].match(/\sdata-id="([^"]*)"/) || [])[1] || "?";
    const r = g[1].match(/<rect\b[^>]*>/);
    if (!r) continue;
    const num = (name: string) => +((r[0].match(new RegExp(`\\s${name}="([-\\d.]+)"`)) || [])[1] ?? 0);
    rects.push({ id, x: num("x"), y: num("y"), w: num("width"), h: num("height") });
  }
  return rects;
}

/** Signed distance from a point to a rect outline: > 0 outside, < 0 inside (penetration). */
function rectDistance([px, py]: Pt, r: NodeRect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w)), dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  if (dx || dy) return Math.hypot(dx, dy);
  return -Math.min(px - r.x, r.x + r.w - px, py - r.y, r.y + r.h - py);
}

/** Distance along a ray (origin o, unit dir d) to where it enters rect r, or Infinity. */
function rayToRect(o: Pt, d: Pt, r: NodeRect): number {
  let t0 = -Infinity, t1 = Infinity;
  for (const [oi, di, lo, hi] of [[o[0], d[0], r.x, r.x + r.w], [o[1], d[1], r.y, r.y + r.h]]) {
    if (Math.abs(di) < 1e-9) { if (oi < lo || oi > hi) return Infinity; continue; }
    const a = (lo - oi) / di, b = (hi - oi) / di;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
}

/** Problems with where an arrowhead's tip lands: on the outline of the node it points at. */
export function tipProblems(segs: PathSeg[], end: "end" | "start", rects: NodeRect[]): string[] {
  const e = endDirection(segs, end);
  if (!e) return [`has no direction at its ${end}`];
  const tip: Pt = [e.point[0] + e.dir[0] * ARROW_LEN, e.point[1] + e.dir[1] * ARROW_LEN];
  const at = `${tip[0].toFixed(1)},${tip[1].toFixed(1)}`;
  const fix = `end the path ${ARROW_LEN} + 1 before the outline`;
  for (const r of rects) {
    const d = rectDistance(tip, r);
    if (d < -0.5) return [`${end} arrow tip (${at}) pokes ${(-d).toFixed(1)} into node "${r.id}"; ${fix}`];
  }
  // The node the head points at: first rect the ray from the tip runs into.
  const hit = rects.map((r) => ({ r, t: rayToRect(tip, e.dir, r) })).sort((a, b) => a.t - b.t)[0];
  if (hit && isFinite(hit.t) && hit.t > TIP_GAP_MAX) {
    return [`${end} arrow tip (${at}) stops ${hit.t.toFixed(1)} short of node "${hit.r.id}"; ${fix}`];
  }
  return []; // touching its node, or aimed at a non-rect shape (not verifiable)
}

// ---- diagram labels: no collisions -------------------------------------------------------
//
// Free-standing labels (<text> outside a .node) must not touch an edge, an arrowhead, a
// node, or another label; text inside a node must fit its box. Sizes are estimated from
// the theme (node text 14px, labels 12px, zone labels 11px; ~0.58em per character), so
// keep a little air. Opt one label out with data-overlap-ok.

const CHAR_W = 0.58;

function labelBox(n: TreeNode, src: string, inNode: boolean): Box & { text: string } {
  const cls = (nodeAttr(n, "class") || "").split(/\s+/);
  const size = cls.includes("zone-label") ? 11 : cls.includes("label") || cls.includes("sub") || cls.includes("mono") ? 12 : 14;
  const text = nodeText(src, n);
  const w = text.length * size * CHAR_W;
  const x = Number(nodeAttr(n, "x")) || 0, y = Number(nodeAttr(n, "y")) || 0;
  const anchor = nodeAttr(n, "text-anchor") || (inNode ? "middle" : "start");
  const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  // Zone labels hang from y (top); everything else is vertically centred on y.
  const top = cls.includes("zone-label") ? y - size * 0.8 : y - size / 2;
  return { text, left, right: left + w, top, bottom: top + size };
}

function samplePath(segs: PathSeg[]): number[][] {
  const pts: number[][] = [];
  for (const s of segs) {
    if (s.type === "C" && s.ctrl && s.ctrl.length === 2) {
      const [p0, p1, p2, p3] = [s.from, s.ctrl[0], s.ctrl[1], s.to];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        pts.push([0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
      }
    } else {
      for (let i = 0; i <= 12; i++) pts.push([0, 1].map((k) => s.from[k] + ((s.to[k] - s.from[k]) * i) / 12));
    }
  }
  return pts;
}

function arrowPoints(segs: PathSeg[], end: "end" | "start"): number[][] {
  const e = endDirection(segs, end);
  if (!e) return [];
  const [px, py] = e.point, [dx, dy] = e.dir, [nx, ny] = [-dy, dx];
  const tip = [px + dx * ARROW_LEN, py + dy * ARROW_LEN], a = [px + nx * 5, py + ny * 5], b = [px - nx * 5, py - ny * 5];
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  return [tip, a, b, mid(tip, a), mid(tip, b), [(tip[0] + a[0] + b[0]) / 3, (tip[1] + a[1] + b[1]) / 3]];
}

const inside = (p: number[], box: Box, pad: number) => p[0] >= box.left - pad && p[0] <= box.right + pad && p[1] >= box.top - pad && p[1] <= box.bottom + pad;
const boxesOverlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function diagramLabelProblems(html: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(html).matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    if (/\stransform=/.test(m[0])) continue; // estimates don't follow transforms
    const { root: tree, src } = parseTree(m[0]);
    const labels: (Box & { text: string })[] = [], nodes: (Box & { id: string })[] = [], edges: { id: string | undefined; line: number[][]; arrows: number[][] }[] = [];
    walkTree(tree, (n) => {
      const nodeG = n.parent && (function up(p: TreeNode | null): TreeNode | null { return p && p.tag !== "#root" ? (p.tag === "g" && hasClass(p, "node") ? p : up(p.parent)) : null; })(n.parent);
      if (n.tag === "text") {
        const box = labelBox(n, src, !!nodeG);
        if (nodeG) {
          const r = findNode(nodeG, (x) => x.tag === "rect");
          if (r && !/\sdata-overlap-ok\b/.test(n.attrs)) {
            const w = Number(nodeAttr(r, "width"));
            if (box.right - box.left > w - 8) out.push(`node text "${box.text}" (~${Math.round(box.right - box.left)}px) doesn't fit its ${w}px box`);
          }
        } else if (!/\sdata-overlap-ok\b/.test(n.attrs)) labels.push(box);
      }
      if (n.tag === "rect" && nodeG && nodeG.children.find((c) => c.tag === "rect") === n) {
        const x = Number(nodeAttr(n, "x")) || 0, y = Number(nodeAttr(n, "y")) || 0;
        nodes.push({ left: x, top: y, right: x + (Number(nodeAttr(n, "width")) || 0), bottom: y + (Number(nodeAttr(n, "height")) || 0), id: nodeAttr(nodeG, "data-id") || "?" });
      }
      if (n.tag === "path" && hasClass(n, "edge")) {
        let segs: PathSeg[];
        try { segs = parsePath(nodeAttr(n, "d") || ""); } catch { return; }
        const arrows = hasClass(n, "no-arrow") ? [] : [...arrowPoints(segs, "end"), ...(hasClass(n, "both") ? arrowPoints(segs, "start") : [])];
        edges.push({ id: nodeAttr(n, "data-id") || nodeAttr(n, "d"), line: samplePath(segs), arrows });
      }
    });
    for (const l of labels) {
      for (const e of edges) {
        if (e.line.some((p) => inside(p, l, 1.5))) out.push(`label "${l.text}" touches edge "${e.id}"`);
        else if (e.arrows.some((p) => inside(p, l, 1))) out.push(`label "${l.text}" touches the arrowhead of "${e.id}"`);
      }
      for (const nd of nodes) if (boxesOverlap(l, nd)) out.push(`label "${l.text}" overlaps node "${nd.id}"`);
    }
    labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => { if (boxesOverlap(a, b)) out.push(`labels "${a.text}" and "${b.text}" overlap`); }));
  }
  return out;
}

/** Arrowed edges: tips must land on their target node's outline (see ARROW_LEN). Commented-out markup is not checked. */
export function arrowTipFindings(html: string): Finding[] {
  const out: Finding[] = [];
  const err = (message: string) => out.push({ rule: "diagram/arrow-tip", level: "error", message });
  for (const svg of stripComments(html).matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    const rects = nodeRects(svg[0]);
    for (const m of svg[0].matchAll(/<path\b[^>]*>/g)) {
      const cls = (m[0].match(/\sclass="([^"]*)"/) || [])[1] || "";
      const classes = cls.split(/\s+/);
      if (!classes.includes("edge") || classes.includes("no-arrow")) continue;
      const d = (m[0].match(/\sd="([^"]*)"/) || [])[1];
      const name = (m[0].match(/\sdata-id="([^"]*)"/) || [])[1] || d;
      if (!d) { err(`edge "${name}" has no d attribute`); continue; }
      let segs: PathSeg[];
      try { segs = parsePath(d); } catch (e) { err(`edge "${name}": ${(e as Error).message}`); continue; }
      const ends: ("end" | "start")[] = classes.includes("both") ? ["end", "start"] : ["end"];
      for (const end of ends) for (const p of tipProblems(segs, end, rects)) err(`edge "${name}" ${p}`);
    }
  }
  return out;
}

/** Diagram labels never collide with edges, arrowheads, nodes or each other. */
export const diagramLabelFindings = (html: string): Finding[] =>
  diagramLabelProblems(html).map((message) => ({ rule: "diagram/label-overlap", level: "error", message }));
