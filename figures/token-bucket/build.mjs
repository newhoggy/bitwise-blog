// Token bucket as a coin-fed machine. Builds figures/token-bucket/token-bucket.html (add --light for
// the light theme); embed it into docs/token-bucket-rate-limiting.html with the skill's embed.mjs.
//
// What moves, and what it means:
//   - a drip timer on the hopper sweeps once per drip: one coin drops into the magazine every 1/r s;
//   - a full magazine (b coins) cannot take the next drip, so the coin is kicked out into the lost bin;
//   - a request presses the button, the solenoid fires and the pusher takes the bottom coin to the service bin;
//   - with the magazine empty the pusher finds nothing, and the 429 flag goes up.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../.claude/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../.claude/skills/anatomy/scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 640;
const HEIGHT = 392;

// The model's numbers. b coins fit; a drip lands every 1/r seconds.
const B = 6;
const RATE = 0.8;

const PLATE = { x: -132, y: -66, w: 236, d: 140, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;

// Coins: a stack on the magazine floor.
const COIN_R = 15;
const COIN_T = 5.4;
const PITCH = 6.2;
const C = [-16, 0];
const ZB = 9;
const STACK_TOP = ZB + B * PITCH;

// Magazine: a corner of two walls with a hopper over it.
const HOP = { x: -36, y: -20, w: 40, d: 40, r: 3 };
const HOP_Z = 58;
const HOP_H = 20;
const DIAL_Z = HOP_Z + HOP_H;
const DIAL_H = 8;
const DIAL_R = 15;
const DIAL_TOP = DIAL_Z + DIAL_H;
const WALL_T = 3;

// Tracks: the service track runs through the column, the lost track is in front of it.
const PLAT = { x: -52, y: -19, w: 102, d: 38, r: 2 };
const LOST_Y = 46;
const LOST_PLAT = { x: -52, y: LOST_Y - 19, w: 102, d: 38, r: 2 };
const BIN_X = 50;
const SERVICE = { x: BIN_X, y: -21, w: 40, d: 42, r: 3 };
const LOST = { x: BIN_X, y: LOST_Y - 21, w: 40, d: 42, r: 3 };
const BIN_H = 30;
const LOST_H = 22;

// Solenoid and pusher.
const SOL = { x: -90, y: -15, w: 38, d: 30, r: 3 };
const SOL_H = 26;
const BAR_W = 6;
const BAR_H = 4.4;
const BAR_JOIN = -36;
const BAR_REST = -32;
const BAR_STROKE = C[0] + COIN_R - BAR_REST;

// Request button and the 429 flag.
const BTN_PLINTH = { x: -126, y: 30, w: 30, d: 30, r: 5 };
const BTN = [-111, 45];
const POST = [-82, -8];
const FLAG_TRAVEL = 12;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [C[0], C[1], DIAL_TOP + 4], [BIN_X + SERVICE.w, LOST_Y + 22, BIN_H]],
  WIDTH,
  HEIGHT,
  { pad: 16, azimuth: 42 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const slab = (plan, z, h, steps, bevel, style) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const poly = (points, closed = false) => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;

// A closed stadium outline on a vertical face: face "x" is the plane x = level (u runs along y),
// face "y" the plane y = level (u runs along x). A slot is closed, so it has no ends to float.
function faceSlot(face, level, u0, u1, z0, z1) {
  const r = (z1 - z0) / 2, zc = (z0 + z1) / 2, pts = [];
  const put = (u, z) => pts.push(at(face === "x" ? [level, u, z] : [u, level, z]));
  for (let i = 0; i <= 6; i++) { const t = -Math.PI / 2 + (Math.PI * i) / 6; put(u1 - r + Math.cos(t) * r, zc + Math.sin(t) * r); }
  for (let i = 0; i <= 6; i++) { const t = Math.PI / 2 + (Math.PI * i) / 6; put(u0 + r + Math.cos(t) * r, zc + Math.sin(t) * r); }
  return L(poly(pts, true), { tone: "lo" });
}
// A rounded-corner rectangle outline on a vertical face.
function faceRect(face, level, u0, u1, z0, z1) {
  const pts = [[u0, z0], [u1, z0], [u1, z1], [u0, z1]].map(([u, z]) => at(face === "x" ? [level, u, z] : [u, level, z]));
  return L(poly(pts, true), { tone: "faint" });
}
const faceRule = (face, level, u0, u1, z) => L(poly([[u0, z], [u1, z]].map(([u, zz]) => at(face === "x" ? [level, u, zz] : [u, level, zz]))), { tone: "lo", free: true });
const faceDots = (face, level, list) => D(list.map(([u, z]) => at(face === "x" ? [level, u, z] : [u, level, z])), { size: 0.4 });

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // Ruler along the front edge (+y): a tick every 4 units, a major every fifth.
  const strip = { x: -108, y: PLATE.y + PLATE.d - 15, w: 200, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  // Label plate at the back with three rule lines.
  const label = { x: -118, y: PLATE.y + 8, w: 46, d: 16, r: 2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P, 4), { tone: "faint" }));
  const rules = [[label.x + 5, label.y + 5, label.x + 33], [label.x + 5, label.y + 8, label.x + 26], [label.x + 5, label.y + 11, label.x + 36]];
  for (const [x0, y, x1] of rules) out.push(L(k.lineOnTop([x0, y], [x1, y], 0.8, P), { tone: "lo", free: true }));
  out.push(D([at([label.x + 41, label.y + 4, 0.8]), at([label.x + 41, label.y + 12, 0.8])], { size: 0.4 }));
  return out.join("");
}

function solenoid() {
  const out = [];
  const faceX = SOL.x + SOL.w, faceY = SOL.y + SOL.d;
  const fins = [];
  for (let x = SOL.x + 7; x < faceX - 3; x += 6) fins.push(k.segment([x, faceY, 0], [x, faceY, SOL_H], P));
  out.push(S(k.slabOf(SOL, 0, SOL_H, P, 6, 0.8), { tone: "mid", inner: [7, 13, 19].map((z) => L(k.sideSeam(SOL, z, P, 6), { tone: "faint" })).join("") }));
  out.push(L(k.planOutline(k.insetPlan(SOL, 2.4), SOL_H, P, 6), { tone: "faint" }));
  // Terminal block on top, with the two screws the wire lands on.
  const block = { x: -72, y: 5, w: 14, d: 8, r: 1.2 };
  out.push(slab(block, SOL_H, 4, 3, 0.4, { tone: "mid" }));
  out.push(D([at([block.x + 3.5, block.y + 4, SOL_H + 4]), at([block.x + 10.5, block.y + 4, SOL_H + 4])], { size: 0.5, tone: "hi" }));
  out.push(L([block.x + 3.5, block.x + 10.5].map((x) => k.ring(x, block.y + 4, 1.5, SOL_H + 4, P, 12)).join(""), { tone: "lo" }));
  // Name plate on the +x face and a gland plate round the pusher.
  out.push(faceRect("x", faceX, -12, 12, 17, 23));
  out.push(faceRule("x", faceX, -9, 4, 20), faceRule("x", faceX, -9, 8, 18.6), faceDots("x", faceX, [[9.5, 21.4], [9.5, 18.6]]));
  out.push(faceDots("x", faceX, [[-12, 3], [12, 3]]));
  out.push(slab({ x: faceX, y: -7, w: 1.4, d: 14, r: 1 }, ZB, 7.4, 2, 0.3, { tone: "mid" }));
  return out.join("");
}

// The pusher's shaft behind the wall (fixed).
function barBehind() {
  return slab({ x: SOL.x + SOL.w + 1.4, y: -BAR_W / 2, w: BAR_JOIN - (SOL.x + SOL.w + 1.4), d: BAR_W, r: 1 }, ZB, BAR_H, 3, 0.4, { tone: "mid" });
}

function tracks() {
  const out = [];
  for (const plan of [PLAT, LOST_PLAT]) {
    out.push(`<path class="iso-halo" d="${k.haloOf(plan, 0, 1, P)}" style="filter:blur(4px)"/>`);
    out.push(S(k.slabOf(plan, 0, ZB, P, 3, 0.6), { tone: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(plan, 3), ZB, P, 3), { tone: "faint" }));
    out.push(D([[plan.x + 4, plan.y + 4], [plan.x + 4, plan.y + plan.d - 4]].map(([x, y]) => at([x, y, ZB])), { size: 0.4 }));
    // Cross ribs on the belt, rail to rail.
    const rib = [];
    for (let x = C[0] + COIN_R + 4; x < BIN_X - 2; x += 6) rib.push(k.lineOnTop([x, plan.y + 3], [x, plan.y + plan.d - 3], ZB, P));
    out.push(L(rib.join(""), { tone: "faint" }));
  }
  // Rails on the far side of each lane (the near side is drawn after the coins).
  for (const plan of [PLAT, LOST_PLAT]) out.push(slab({ x: C[0] + 8, y: plan.y, w: BIN_X - (C[0] + 8), d: 3, r: 0.8 }, ZB, 2.4, 2, 0.3, { tone: "mid" }));
  // Seat ring the stack stands in.
  out.push(L(k.ring(C[0], C[1], COIN_R + 1.6, ZB, P, 48), { tone: "lo" }));
  return out.join("");
}

function railsNear() {
  return [PLAT, LOST_PLAT].map((plan) => slab({ x: C[0] + 8, y: plan.y + plan.d - 3, w: BIN_X - (C[0] + 8), d: 3, r: 0.8 }, ZB, 2.4, 2, 0.3, { tone: "mid" })).join("");
}

// The corner magazine: two walls, the slot for the pusher, a gauge line for every coin.
function walls() {
  const out = [];
  const inner = COIN_R + 1;
  const back = { x: C[0] - COIN_R - 2 - WALL_T, y: -inner - WALL_T, w: COIN_R * 2 + 2 + 2, d: WALL_T, r: 0.8 };
  // Gauge: a line at every coin level, wrapping the wall's corner like a seam; the capacity mark is heavier.
  const gauge = Array.from({ length: B }, (_, n) => L(k.sideSeam(back, ZB + (n + 1) * PITCH - 0.3, P, 2), { tone: n === B - 1 ? "hi" : "lo" })).join("");
  out.push(S(k.slabOf(back, ZB, HOP_Z - ZB, P, 2, 0.5), { tone: "mid", inner: gauge }));
  const faceY = back.y + back.d;
  out.push(faceDots("y", faceY, [[back.x + 4, ZB + 4], [back.x + back.w - 4, ZB + 4], [back.x + 4, HOP_Z - 4], [back.x + back.w - 4, HOP_Z - 4]]));
  const wallX = C[0] - COIN_R - 2 - WALL_T;
  const jamb = (y0, y1) => slab({ x: wallX, y: y0, w: WALL_T, d: y1 - y0, r: 0.6 }, ZB, HOP_Z - ZB, 2, 0.4, { tone: "mid" });
  out.push(jamb(-inner, -4));
  out.push(slab({ x: wallX, y: -4, w: WALL_T, d: 8, r: 0.4 }, ZB + BAR_H + 1, HOP_Z - ZB - BAR_H - 1, 2, 0.3, { tone: "mid" }));
  out.push(jamb(4, inner));
  out.push(faceDots("x", wallX + WALL_T, [[-inner + 3, ZB + 4], [inner - 3, ZB + 4], [-inner + 3, HOP_Z - 4], [inner - 3, HOP_Z - 4]]));
  return out.join("");
}

const coinSvg = (lit) => {
  const out = [];
  out.push(S(k.cylinder(C[0], C[1], COIN_R, 0, COIN_T, P, 36, 0.4), { tone: "hi", lit }));
  out.push(L(k.ring(C[0], C[1], COIN_R - 2.8, COIN_T, P, 36), { tone: "faint" }));
  out.push(L(k.ring(C[0], C[1], 3.6, COIN_T, P, 16), { tone: "lo" }));
  return out.join("");
};

function hopper() {
  const out = [];
  const faceX = HOP.x + HOP.w, faceY = HOP.y + HOP.d;
  out.push(S(k.slabOf(HOP, HOP_Z, HOP_H, P, 6, 0.8), { tone: "mid", inner: [HOP_Z + 4, HOP_Z + HOP_H - 4].map((z) => L(k.sideSeam(HOP, z, P, 6), { tone: "faint" })).join("") }));
  // Vent slots on +x, a name plate with three rules on +y.
  for (const z of [HOP_Z + 7, HOP_Z + 11, HOP_Z + 15]) out.push(faceSlot("x", faceX, -12, 12, z - 1, z + 1));
  out.push(faceRect("y", faceY, HOP.x + 8, HOP.x + 32, HOP_Z + 6, HOP_Z + 14));
  out.push(faceRule("y", faceY, HOP.x + 12, HOP.x + 28, HOP_Z + 12), faceRule("y", faceY, HOP.x + 12, HOP.x + 22, HOP_Z + 10.4), faceRule("y", faceY, HOP.x + 12, HOP.x + 26, HOP_Z + 8.8));
  out.push(faceDots("y", faceY, [[HOP.x + 5, HOP_Z + 4], [HOP.x + HOP.w - 5, HOP_Z + 4], [HOP.x + 5, HOP_Z + HOP_H - 4], [HOP.x + HOP.w - 5, HOP_Z + HOP_H - 4]]));
  // Dial on top: puck, knurled bezel, ticks, hub.
  const [x, y] = C;
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3.2, DIAL_TOP, 72, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3.2, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL_R - 3, 40, 5, DIAL_TOP, [1.2, 2.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.6, DIAL_TOP, P, 16), { tone: "mid" }));
  return out.join("");
}

const handAt = (turn) => {
  const angle = turn * Math.PI * 2;
  const [x, y] = C;
  return k.lineOnTop([x - Math.sin(angle) * 3.4, y + Math.cos(angle) * 3.4], [x + Math.sin(angle) * (DIAL_R - 3), y - Math.cos(angle) * (DIAL_R - 3)], DIAL_TOP + 0.2, P);
};

function bin(plan, lamp, BIN_H) {
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, 0, BIN_H, P)}" style="filter:blur(5px)"/>`];
  const faceX = plan.x + plan.w, faceY = plan.y + plan.d;
  out.push(S(k.slabOf(plan, 0, BIN_H, P, 6, 0.8), { tone: "mid", inner: [3, 10].map((z) => L(k.sideSeam(plan, z, P, 6), { tone: "faint" })).join("") }));
  out.push(L(k.planOutline(k.insetPlan(plan, 3), BIN_H, P, 6), { tone: "faint" }));
  // Coin slot on the top, a closed outline.
  const slot = { x: plan.x + 6, y: plan.y + plan.d / 2 - 1.6, w: 20, d: 3.2, r: 1.5 };
  out.push(L(k.planOutline(slot, BIN_H, P, 4), { tone: "hi" }));
  out.push(D([[plan.x + 5, plan.y + 5], [plan.x + plan.w - 5, plan.y + plan.d - 5], [plan.x + 5, plan.y + plan.d - 5]].map(([x, y]) => at([x, y, BIN_H])), { size: 0.45 }));
  // Vent slots on +x, a hatch with rules on +y.
  for (const z of lamp ? [16, 20, 24] : [12, 16, 20]) out.push(faceSlot("x", faceX, plan.y + 9, plan.y + plan.d - 9, z - 1, z + 1));
  const hz = lamp ? 0 : -6;
  out.push(faceRect("y", faceY, plan.x + 7, plan.x + plan.w - 7, 14 + hz, 24 + hz));
  out.push(faceRule("y", faceY, plan.x + 11, plan.x + plan.w - 11, 21 + hz), faceRule("y", faceY, plan.x + 11, plan.x + plan.w - 17, 18.4 + hz), faceDots("y", faceY, [[plan.x + 9, 16 + hz], [plan.x + plan.w - 9, 16 + hz], [plan.x + 9, 22 + hz], [plan.x + plan.w - 9, 22 + hz]]));
  if (lamp) {
    out.push(S(k.cylinder(plan.x + plan.w - 9, plan.y + 8, 3, BIN_H, 2.4, P, 16), { tone: "mid" }));
    out.push(L(k.ring(plan.x + plan.w - 9, plan.y + 8, 1.6, BIN_H + 2.4, P, 12), { tone: "lo" }));
  } else {
    out.push(L([0, 1, 2].map((i) => k.planOutline({ x: plan.x + plan.w - 17 + i * 4.4, y: plan.y + 5, w: 2, d: 7, r: 1 }, BIN_H, P, 3)).join(""), { tone: "lo" }));
  }
  return out.join("");
}

function button() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(BTN_PLINTH, 0, 6, P)}" style="filter:blur(4px)"/>`);
  out.push(slab(BTN_PLINTH, 0, 6, 6, 0.8, { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(BTN_PLINTH, 2.4), 6, P, 6), { tone: "faint" }));
  out.push(D(k.corners(BTN_PLINTH, 4).map(([x, y]) => at([x, y, 6])), { size: 0.45 }));
  // Bezel the plunger travels in.
  out.push(S(k.cylinder(BTN[0], BTN[1], 11, 6, 3, P, 36, 0.4), { tone: "lo" }));
  out.push(L(k.ring(BTN[0], BTN[1], 9.4, 9, P, 36), { tone: "faint" }));
  return out.join("");
}

// The plunger cap: what the reader presses. Moves down 3 units.
function plunger() {
  const out = [];
  out.push(S(k.cylinder(BTN[0], BTN[1], 8, 9, 6, P, 32, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(BTN[0], BTN[1], 8, 9, 12, 40, P, 0.3), { tone: "lo" }));
  out.push(L(k.ring(BTN[0], BTN[1], 5.4, 15, P, 28), { tone: "lo" }));
  return out.join("");
}

// A wire from the button plinth to the solenoid's terminal block: along the floor, then up the +y face.
function wire() {
  const wx = -66;
  const route = [[BTN_PLINTH.x + BTN_PLINTH.w, BTN[1], 3], [wx, BTN[1], 0.5], [wx, SOL.y + SOL.d, 0.5], [wx, SOL.y + SOL.d, SOL_H], [wx, 13, SOL_H + 2]];
  const points = route.map((p) => at(p));
  return k.wireSvg(points[0], points[points.length - 1], { via: points.slice(1, -1), tone: "mid", size: 1.1 });
}

// The 429 flag: a post on the solenoid, a collar and plate that ride up it.
function flagPost() {
  const out = [];
  out.push(S(k.cylinder(POST[0], POST[1], 3.4, SOL_H, 2, P, 20), { tone: "lo" }));
  out.push(S(k.cylinder(POST[0], POST[1], 1.5, SOL_H + 2, 30, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(POST[0], POST[1], 2.2, SOL_H + 32, 2, P, 16), { tone: "mid" }));
  return out.join("");
}
function flag() {
  const out = [];
  const z = SOL_H + 3;
  out.push(S(k.cylinder(POST[0], POST[1], 3, z, 3, P, 20), { tone: "mid" }));
  const plan = { x: POST[0] - 1, y: POST[1] - 3, w: 2, d: 16, r: 0.6 };
  out.push(S(k.slabOf(plan, z, 10, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  out.push(k.faceTextSvg(k.sideMatrix([POST[0] + 1, POST[1] + 5], z + 4, P, "right"), "429", { size: 4.4, tone: "mid", anchor: "middle" }));
  return out.join("");
}

const svgBody = [
  plate(),
  solenoid(),
  `<g data-press>${button()}</g>`,
  `<g data-part="plunger" data-press>${plunger()}</g>`,
  wire(),
  flagPost(),
  `<g data-part="flag">${flag()}</g>`,
  tracks(),
  barBehind(),
  walls(),
  `<g data-part="barfront"></g>`,
  `<g data-part="eject" display="none"></g>`,
  `<g data-part="stack">${Array.from({ length: B }, (_, i) => `<g data-coin="${i}">${coinSvg(false)}</g>`).join("")}</g>`,
  `<g data-part="drop" display="none">${coinSvg(true)}</g>`,
  `<g data-part="spill" display="none"></g>`,
  railsNear(),
  hopper(),
  `<path data-part="hand" class="iso-line" data-tone="hi" data-free="start" d="${handAt(0)}" style="stroke-width:1.1"/>`,
  bin(SERVICE, true, BIN_H),
  bin(LOST, false, LOST_H),
];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A coin-fed machine that works like a token bucket. A drip timer on top drops a coin into the magazine every 1.25 seconds; the magazine holds six, and a coin dropped onto a full one is kicked out into the lost bin. A button fires a solenoid whose pusher sends the bottom coin to the service bin; with the magazine empty the pusher finds nothing and a 429 flag goes up.",
  body: svgBody,
});

const live = `
const P = ${JSON.stringify(P)};
const B = ${B}, RATE = ${RATE}, ZB = ${ZB}, PITCH = ${PITCH}, COIN_R = ${COIN_R}, STACK_TOP = ${STACK_TOP};
const C = ${JSON.stringify(C)}, HOP_Z = ${HOP_Z}, DIAL_TOP = ${DIAL_TOP}, DIAL_R = ${DIAL_R};
const BAR = { w: ${BAR_W}, h: ${BAR_H}, join: ${BAR_JOIN}, rest: ${BAR_REST}, stroke: ${BAR_STROKE} };
const BIN_X = ${BIN_X}, LOST_Y = ${LOST_Y}, FLAG_TRAVEL = ${FLAG_TRAVEL};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector('[data-part="' + name + '"]');
const [plunger, flagEl, barFront, eject, stack, drop, spill, hand] = ["plunger", "flag", "barfront", "eject", "stack", "drop", "spill", "hand"].map(part);
const coins = [...stack.querySelectorAll("[data-coin]")];
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const coinMarkup = ${JSON.stringify(coinSvg(true))};
const handAt = ${handAt.toString().replace(/k\./g, "")};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (u) => u * u * (3 - 2 * u);
const show = (el, on) => (on ? el.removeAttribute("display") : el.setAttribute("display", "none"));
const FALL = 0.16, PHI0 = 1 - FALL * RATE;
const STROKE = { out: 0.12, hold: 0.03, back: 0.15 };

// The model: whole coins in the magazine, a drip clock, and counts. A drip lands when the clock wraps.
let coinsIn = B, phi = 0.55, sent = 0, refused = 0, lost = 0;
let shift = 0, holdStack = false;             // the stack sits one slot high until the bottom coin has cleared it
let stroke = null, queue = 0, flagUp = 0, flagHold = 0, pressDown = 0;
const ejected = [], spilled = [];
let frame = 0, last = 0, clock = 0, touring = true, visible = false, idleTimer = 0;

const at = (x, y, z) => translateAlong(P, [x - C[0], y - C[1], z]);
function request() {
  if (queue < 3) queue++;
  pressDown = 0.14;
  run();
}
function startStroke() {
  const dry = coinsIn < 1;
  stroke = { t: 0, dry, tip: BAR.rest, pushed: false };
  if (dry) { refused++; flagHold = 1.3; }
  else { coinsIn--; sent++; shift = 1; holdStack = true; ejected.push({ x: C[0], v: 0 }); }
}
function barAt(t) {
  const { out, hold, back } = STROKE;
  if (t < out) return ease(t / out);
  if (t < out + hold) return 1;
  if (t < out + hold + back) return 1 - ease((t - out - hold) / back);
  return 0;
}
function step(dt) {
  phi += RATE * dt;
  while (phi >= 1) {
    phi -= 1;
    if (coinsIn < B) coinsIn++;
    else { lost++; spilled.push({ t: 0, x: C[0], y: C[1], z: STACK_TOP, s: 0 }); }
  }
  if (!stroke && queue > 0) { queue--; startStroke(); }
  if (stroke) {
    stroke.t += dt;
    const s = barAt(stroke.t);
    stroke.tip = BAR.rest + BAR.stroke * s;
    if (stroke.t >= STROKE.out + STROKE.hold + STROKE.back) stroke = null;
  }
  if (holdStack) { const front = ejected[ejected.length - 1]; if (!front || front.x >= C[0] + 2 * COIN_R - 1) holdStack = false; }
  else shift *= Math.exp(-dt / 0.07);
  if (shift < 0.002) shift = 0;
  for (const coin of ejected) {
    const push = stroke ? stroke.tip + COIN_R : -Infinity;
    if (push > coin.x) { coin.v = Math.min((push - coin.x) / dt, 140); coin.x = push; }
    else { coin.v = Math.max(coin.v * Math.exp(-dt / 0.6), 38); coin.x += coin.v * dt; }
  }
  while (ejected.length && ejected[0].x > BIN_X + COIN_R + 4) ejected.shift();
  for (const coin of spilled) {
    coin.t += dt;
    if (coin.z > ZB || coin.t < 0.05) {
      coin.x = C[0] + 22 * coin.t; coin.y = C[1] + 69 * coin.t;
      coin.z = Math.max(ZB, STACK_TOP + 45 * coin.t - 150 * coin.t * coin.t);
    } else coin.x += 55 * dt;
  }
  while (spilled.length && spilled[0].x > BIN_X + COIN_R + 4) spilled.shift();
  flagHold = Math.max(0, flagHold - dt);
  flagUp += ((flagHold > 0 ? 1 : 0) - flagUp) * (1 - Math.exp(-dt / 0.09));
  pressDown = Math.max(0, pressDown - dt);
}
function draw() {
  hand.setAttribute("d", handAt(phi));
  plunger.setAttribute("transform", translateAlong(P, [0, 0, pressDown > 0 ? -3 : 0]));
  flagEl.setAttribute("transform", translateAlong(P, [0, 0, FLAG_TRAVEL * flagUp]));
  coins.forEach((coin, i) => {
    show(coin, i < coinsIn);
    coin.setAttribute("transform", translateAlong(P, [0, 0, ZB + (i + shift) * PITCH]));
  });
  // The coin on its way down: it leaves the hopper at PHI0 and lands as the clock wraps.
  const u = phi >= PHI0 ? (phi - PHI0) / (1 - PHI0) : -1;
  show(drop, u >= 0);
  if (u >= 0) {
    const land = ZB + (coinsIn >= B ? B : coinsIn + shift) * PITCH;
    drop.setAttribute("transform", translateAlong(P, [0, 0, HOP_Z + (land - HOP_Z) * u * u]));
  }
  eject.innerHTML = "";
  show(eject, ejected.length > 0);
  if (ejected.length) eject.innerHTML = ejected.map((coin) => '<g transform="' + translateAlong(P, [coin.x - C[0], 0, ZB]) + '">' + coinMarkup + "</g>").join("");
  spill.innerHTML = "";
  show(spill, spilled.length > 0);
  if (spilled.length) spill.innerHTML = spilled.map((coin) => '<g transform="' + translateAlong(P, [coin.x - C[0], coin.y - C[1], coin.z]) + '">' + coinMarkup + "</g>").join("");
  const tip = stroke ? stroke.tip : BAR.rest;
  const len = Math.max(tip - BAR.join, 1);
  barFront.innerHTML = solidSvg(slabOf({ x: BAR.join, y: -BAR.w / 2, w: len, d: BAR.w, r: 1 }, ZB, BAR.h, P, 3, 0.4), { tone: "mid" });
  const next = ((1 - phi) / RATE).toFixed(1);
  const text = coinsIn + " of " + B + " tokens · " + sent + " admitted · " + refused + " rejected";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(coinsIn));
  stage.setAttribute("aria-valuetext", text + ", next token in " + next + " s");
}

const SCRIPT = [1.4, 1.72, 2.04, 2.36, 2.68, 3, 3.32, 3.64, 3.96, 4.28, 4.6, 4.92, 9.5, 11.1, 12.7, 14.3];
const LOOP = 26;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (touring) {
    const before = clock;
    clock += dt;
    for (const time of SCRIPT) if (before < time && clock >= time) request();
    if (clock >= LOOP) clock -= LOOP;
  }
  step(dt);
  draw();
  frame = visible ? requestAnimationFrame(tick) : 0;
}
function calmTick() {
  step(0.5);
  ejected.length = 0; spilled.length = 0; stroke = null; shift = 0; holdStack = false; flagUp = flagHold > 0 ? 1 : 0;
  draw();
  frame = visible ? setTimeout(calmTick, 500) : 0;
}
function run() {
  if (frame || !visible) return;
  last = 0;
  frame = still.matches ? setTimeout(calmTick, 500) : requestAnimationFrame(tick);
}
const interact = () => {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; }, 7000);
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointerdown", (event) => { if (!event.target.closest("[data-press]")) return; interact(); request(); });
stage.addEventListener("keydown", (event) => {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  interact();
  request();
});
draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "Token bucket",
  hint: "Press the button or Space",
  readout: `${B} of ${B} tokens · 0 admitted · 0 rejected`,
  keys: [
    { mark: "lit", label: "A coin on the move: dropped by the timer, sent on to the service, or lost" },
    { mark: "raised", label: "The six coins the magazine holds" },
  ],
  caption:
    "A toy bucket that holds six tokens (b = 6), refilled by one every 1.25 s (r = 0.8 per second). Each press takes the bottom coin; with none left the pusher finds nothing and the 429 flag goes up. A coin dropped onto a full magazine is lost. The machine counts whole coins and its drip clock keeps running when the magazine is full, so after a take from a full magazine the next coin can land sooner than the refill rule below allows.",
  body: `<style>.iso [data-press] { cursor: pointer; }</style><div class="iso-stage" tabindex="0" role="button" aria-label="Token bucket: press Space, or the button, to send a request" aria-valuenow="${B}">${svg}</div>`,
});

const name = theme === "light" ? "token-bucket-light.html" : "token-bucket.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Token bucket", theme, body, script: kitScript() + live }));
console.log("wrote", name);
