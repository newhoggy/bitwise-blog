// Direct unit tests for the diagram-geometry rules in scripts/check/diagram-geometry.mts: the
// path parser, where an arrowhead's tip lands, and label collisions. tests/checker-rules.test.mts
// covers the same rules end to end through `check`; these call one rule on one SVG.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARROW_LEN, TIP_GAP_MAX, parsePath, endDirection, nodeRects, tipProblems, arrowTipFindings, diagramLabelFindings,
} from "../scripts/check/diagram-geometry.mts";
import type { NodeRect } from "../scripts/types.mts";

/** Two boxes, A at x 0–100 and B at x 200–300 (both y 0–40), plus `body`. */
const svg = (body: string, attrs = "") => `<svg viewBox="-16 -16 332 132"${attrs}>
  <g class="node c1" data-id="a"><rect x="0" y="0" width="100" height="40" rx="6"/><text x="50" y="20">A</text></g>
  <g class="node c2" data-id="b"><rect x="200" y="0" width="100" height="40" rx="6"/><text x="250" y="20">B</text></g>
  ${body}
</svg>`;
const B: NodeRect[] = [{ id: "b", x: 200, y: 0, w: 100, h: 40 }];
const messages = (findings: { message: string }[]) => findings.map((f) => f.message);

test("the arrowhead length is the one bh.js draws", () => {
  assert.equal(ARROW_LEN, 10);
  assert.equal(TIP_GAP_MAX, 2);
});

test("parsePath: absolute lines and curves, with control points", () => {
  assert.deepEqual(parsePath("M10 20 L30 40"), [{ type: "L", from: [10, 20], to: [30, 40], ctrl: null }]);
  assert.deepEqual(parsePath("M0 0 C10 0 20 10 30 10"), [{ type: "C", from: [0, 0], to: [30, 10], ctrl: [[10, 0], [20, 10]] }]);
  assert.deepEqual(parsePath("M0 0 Q5 5 10 0").map((s) => s.ctrl), [[[5, 5]]]);
});

test("parsePath: relative commands, H/V, implicit repeats and Z", () => {
  const segs = parsePath("m10 20 h5 v5 l-5 0 z");
  assert.deepEqual(segs.map((s) => s.type), ["H", "V", "L", "Z"]);
  assert.deepEqual(segs.map((s) => s.to), [[15, 20], [15, 25], [10, 25], [10, 20]]);
  // Coordinates after M without a new command are a line to.
  assert.deepEqual(parsePath("M0 0 10 10 20 0").map((s) => [s.type, s.to]), [["L", [10, 10]], ["L", [20, 0]]]);
  // Exponents and leading-dot decimals are numbers.
  assert.deepEqual(parsePath("M0 0 L1e1 .5")[0].to, [10, 0.5]);
});

test("parsePath: an unsupported command throws", () => {
  assert.throws(() => parsePath("M0 0 B1 2"), /unsupported path command "B"/);
});

test("endDirection: the tangent at either end, pointing outward", () => {
  const segs = parsePath("M0 0 C10 0 20 10 30 10");
  assert.deepEqual(endDirection(segs, "end"), { point: [30, 10], dir: [1, 0] });
  assert.deepEqual(endDirection(segs, "start"), { point: [0, 0], dir: [-1, 0] });
  // A zero-length path has no direction.
  assert.equal(endDirection(parsePath("M5 5 L5 5"), "end"), null);
});

test("nodeRects: the first rect of each .node group, with its data-id", () => {
  assert.deepEqual(nodeRects(svg("")), [{ id: "a", x: 0, y: 0, w: 100, h: 40 }, { id: "b", x: 200, y: 0, w: 100, h: 40 }]);
  assert.deepEqual(nodeRects('<svg><g class="node"><circle r="5"/></g><g class="zone"><rect x="1" y="1" width="2" height="2"/></g></svg>'), []);
});

test("tipProblems: a tip on the outline, or within the tolerance, is fine", () => {
  assert.deepEqual(tipProblems(parsePath("M101 20 H190"), "end", B), []); // tip at 200: on the outline
  assert.deepEqual(tipProblems(parsePath("M101 20 H189"), "end", B), []); // tip at 199: 1 short
  assert.deepEqual(tipProblems(parsePath("M101 20 H188"), "end", B), []); // tip at 198: exactly TIP_GAP_MAX short
});

test("tipProblems: a tip that stops short, or pokes into a node, is reported with where it is", () => {
  assert.deepEqual(tipProblems(parsePath("M101 20 H187"), "end", B), ['end arrow tip (197.0,20.0) stops 3.0 short of node "b"; end the path 10 + 1 before the outline']);
  assert.deepEqual(tipProblems(parsePath("M101 20 H170"), "end", B), ['end arrow tip (180.0,20.0) stops 20.0 short of node "b"; end the path 10 + 1 before the outline']);
  assert.deepEqual(tipProblems(parsePath("M101 20 H195"), "end", B), ['end arrow tip (205.0,20.0) pokes 5.0 into node "b"; end the path 10 + 1 before the outline']);
});

test("tipProblems: a tip aimed at no rect cannot be verified, and a path with no direction is reported", () => {
  assert.deepEqual(tipProblems(parsePath("M101 20 H150"), "end", []), []);
  assert.deepEqual(tipProblems(parsePath("M101 20 V60"), "end", B), []); // aimed down, past B
  assert.deepEqual(tipProblems(parsePath("M5 5 L5 5"), "end", B), ["has no direction at its end"]);
});

test("arrowTipFindings: a clean diagram has no findings", () => {
  assert.deepEqual(arrowTipFindings(svg('<path class="edge" data-id="ab" d="M101 20 H189"/>')), []);
});

test("arrowTipFindings: each finding is an error of the arrow-tip rule, named by the edge", () => {
  const found = arrowTipFindings(svg('<path class="edge" data-id="ab" d="M101 20 H170"/>'));
  assert.deepEqual(found, [{ rule: "diagram/arrow-tip", level: "error", message: 'edge "ab" end arrow tip (180.0,20.0) stops 20.0 short of node "b"; end the path 10 + 1 before the outline' }]);
  // Without a data-id the edge is named by its path.
  assert.deepEqual(messages(arrowTipFindings(svg('<path class="edge" d="M101 20 H170"/>'))), ['edge "M101 20 H170" end arrow tip (180.0,20.0) stops 20.0 short of node "b"; end the path 10 + 1 before the outline']);
});

test("arrowTipFindings: an edge with no d, or a command the parser does not know", () => {
  assert.deepEqual(messages(arrowTipFindings(svg('<path class="edge" data-id="ab"/>'))), ['edge "ab" has no d attribute']);
  assert.deepEqual(messages(arrowTipFindings(svg('<path class="edge" data-id="ab" d="M101 20 B189 20"/>'))), ['edge "ab": unsupported path command "B"']);
});

test("arrowTipFindings: no-arrow edges and paths that are not edges are exempt", () => {
  assert.deepEqual(arrowTipFindings(svg('<path class="edge no-arrow" data-id="ab" d="M101 20 H120"/>')), []);
  assert.deepEqual(arrowTipFindings(svg('<path class="outline" d="M101 20 H120"/>')), []);
});

test("arrowTipFindings: a both-way edge is checked at its start too", () => {
  assert.deepEqual(arrowTipFindings(svg('<path class="edge both" data-id="ab" d="M111 20 H189"/>')), []);
  assert.deepEqual(messages(arrowTipFindings(svg('<path class="edge both" data-id="ab" d="M120 20 H189"/>'))), ['edge "ab" start arrow tip (110.0,20.0) stops 10.0 short of node "a"; end the path 10 + 1 before the outline']);
  // A one-way edge's start is not an arrow.
  assert.deepEqual(arrowTipFindings(svg('<path class="edge" data-id="ab" d="M120 20 H189"/>')), []);
});

test("arrowTipFindings: commented-out markup is not checked", () => {
  assert.deepEqual(arrowTipFindings(svg('<!-- <path class="edge" data-id="ab" d="M101 20 H170"/> -->')), []);
});

test("arrowTipFindings: each <svg> is checked against its own nodes", () => {
  // The second SVG has no nodes, so its edge's tip cannot be checked against the first one's B.
  const html = svg('<path class="edge" data-id="ab" d="M101 20 H189"/>') + '<svg><path class="edge" data-id="lone" d="M101 20 H170"/></svg>';
  assert.deepEqual(arrowTipFindings(html), []);
});

const EDGE = '<path class="edge" data-id="ab" d="M101 20 H189"/>';

test("diagramLabelFindings: a label in open space is clean", () => {
  assert.deepEqual(diagramLabelFindings(svg(EDGE + '<text class="label" x="150" y="60" text-anchor="middle">via</text>')), []);
});

test("diagramLabelFindings: a label on an edge, on an arrowhead, or over a node", () => {
  assert.deepEqual(diagramLabelFindings(svg(EDGE + '<text class="label" x="150" y="20" text-anchor="middle">via</text>')), [{ rule: "diagram/label-overlap", level: "error", message: 'label "via" touches edge "ab"' }]);
  assert.deepEqual(messages(diagramLabelFindings(svg(EDGE + '<text class="label" x="183" y="9">go</text>'))), ['label "go" touches the arrowhead of "ab"']);
  assert.deepEqual(messages(diagramLabelFindings(svg(EDGE + '<text class="label" x="50" y="-4" text-anchor="middle">hi</text>'))), ['label "hi" overlaps node "a"']);
});

test("diagramLabelFindings: two labels that overlap each other", () => {
  const body = EDGE + '<text class="label" x="150" y="60" text-anchor="middle">one</text><text class="label" x="152" y="60" text-anchor="middle">two</text>';
  assert.deepEqual(messages(diagramLabelFindings(svg(body))), ['labels "one" and "two" overlap']);
});

test("diagramLabelFindings: node text wider than its box", () => {
  const html = svg(EDGE).replace(">A</text>", ">A very long node label</text>");
  assert.deepEqual(messages(diagramLabelFindings(html)), ["node text \"A very long node label\" (~179px) doesn't fit its 100px box"]);
});

test("diagramLabelFindings: data-overlap-ok, a transformed <svg> and commented-out markup are not checked", () => {
  assert.deepEqual(diagramLabelFindings(svg(EDGE + '<text class="label" x="150" y="20" data-overlap-ok>via</text>')), []);
  assert.deepEqual(diagramLabelFindings(svg(EDGE + '<text class="label" x="150" y="20">via</text>', ' transform="scale(2)"')), []);
  assert.deepEqual(diagramLabelFindings(svg(EDGE + '<!-- <text class="label" x="150" y="20">via</text> -->')), []);
});
