// packages/core/templates.js -- TASK 651: the BANK of template drawings, DECLARED as data. PURE, no DOM.
//
// A template is { id, name, description, params, dimensions, build(d, params) }. TASK 680 (owner turn 1734: "templates should be built using the
// app's tools"): build() is a RECIPE. It draws on a fresh headless sketch of its own (#core/tool-ops.js newSketchState: its own engine store and
// sketch state, task 679, so a preview never touches the open design) with the app's TOOL OPERATIONS only (#core/tool-ops.js: the Line, Rect,
// Arc, Circle, Polygon, Slot and Fillet tools, the constraint tools, the Dimension tool and its value box, the Parameters window's + Add row, the
// Pattern tool): each one calls exactly the core function its tool calls, so a template is exactly what a user drawing it with the tools gets.
// buildTemplate() then serializes the sketch through serializeDocument (the one save path). Every template is FULLY DIMENSIONED (driving
// dimensions, fixed by the origin anchor) and editable after it opens.
//
// UNITS: templates are authored in mm = world units (units.js BASE). A document's unit (mm | cm | in) is a display lens over the same world
// values, so a template opens at the same physical size in an inch document; there is no conversion here.
// ORIENTATION: authored with Y UP (as the user sees it) and stored through userToWorldY (the one Y seam).
// ANCHOR: each template has one point on the origin (a tool's click on the origin: its snap's coincident, or a line drawn from the origin);
// d.origin(x, y) says which authored point that is, so the drawing is placed with that point at (0, 0) before it is drawn.
// PARAMETERS (TASK 670): a template's LENGTH / ANGLE params open as the document's USER PARAMETERS (the Parameters table: name = paramName(key),
// expression = the value in mm / deg, comment = the label), and every driving dimension is a FORMULA reading them DIRECTLY (owner ruling, turn
// 1729: no dimension reads another dimension), typed into the dimension's value box as a user would, so changing a parameter later goes through
// the existing parameter -> dimension -> solve path.
// COUNT / CHOICE params (and a length declared `atOpen`) are chosen in the start modal only: they change the topology (how many boards, which joint)
// or a value no dimension carries (a pattern's spacing), so a user parameter could not drive them and none is made.

import { serializeDocument } from '#core/document.js';
import { userToWorldY, worldToUserY } from '#core/units.js';
import { ORIGIN_JOINT_ID, CONSTRAINT_TYPES } from '#core/constants.js';
import { patternDefaults } from '#core/pattern.js';
import { cornerBoards, cornerJointPoints, CORNER_JOINT_TYPES } from '#core/corner-joint.js';
import { calculateFramingGeometry, calculatePolygonFrameGeometry, regularPolygonVertices, BRACE_JOINTS, POLYGON_JOINT_TYPES } from '#core/frame-geometry.js';
import { resolveDimEndpoints, linearDimFrame, linearParamsToPoint, projectDimLabel } from '#core/dim-label.js';
import { arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import * as ops from '#core/tool-ops.js';

const R = (v) => Math.round(v * 1e6) / 1e6;
const T = CONSTRAINT_TYPES;

// ── TASK 672 (owner, turn 1732: "template dimension should be offset further away"): THE placement rule of every linear template dimension ──
// A recipe gives a dimension only its SIDE (where its label is dropped: the sign of its `offset` along the dimension frame's normal,
// #core/dim-label.js linearDimFrame, the frame the canvas draws it in). Its dimension line (and its label, on it) then sits OUTSIDE the drawing:
// DIM_GAP past the solid outline's extent in that direction, DIM_GAP = DIM_FRACTION of the larger side of the drawing's bounding box, never
// under DIM_FLOOR mm; the dimensions on one side are stacked in lanes, DIM_GAP apart, shorter spans nearer the outline, two in one lane only
// when their spans (each at least DIM_GAP long: the label's room) do not overlap. Radius / angle dimensions keep their offsets.
// TASK 680: each label is then DRAGGED there (#core/dim-label.js projectDimLabel, the select tool's label drag).
export const DIM_FRACTION = 0.15, DIM_FLOOR = 10;
/** The rule's distance for a drawing (world joints Map, shapes): DIM_FRACTION of its larger side, at least DIM_FLOOR. */
export function dimensionGap(joints, shapes) {
  const ext = solidExtent(joints, shapes);
  return Math.max(DIM_FLOOR, DIM_FRACTION * Math.max(ext(1, 0) + ext(-1, 0), ext(0, 1) + ext(0, -1)));
}
// the solid (non-construction) drawing's extent along a unit direction: max of p . u over its line ends, circles and arc sweeps
function solidExtent(joints, shapes) {
  const solid = shapes.filter((x) => !x.isConstruction);
  return (ux, uy) => {
    let m = -Infinity;
    const ang = Math.atan2(uy, ux);
    for (const sh of solid) {
      const P = sh.joints.map((id) => joints.get(id));
      if (sh.type === 'line') for (const p of P) m = Math.max(m, p.x * ux + p.y * uy);
      else if (sh.type === 'circle') m = Math.max(m, P[0].x * ux + P[0].y * uy + sh.radius);
      else if (sh.type === 'arc') {
        const [c, a, e] = P, r = Math.hypot(a.x - c.x, a.y - c.y);
        m = Math.max(m, a.x * ux + a.y * uy, e.x * ux + e.y * uy);
        if (angleInArcSweep(arcSweepInfo(c, a, e, { sweep: sh.sweep }), ang)) m = Math.max(m, c.x * ux + c.y * uy + r);
      }
    }
    return m;
  };
}
function placeDimensions(joints, shapes, constraints) {
  const ext = solidExtent(joints, shapes), gap = dimensionGap(joints, shapes);
  const groups = new Map(); // side (the outward direction, to a degree) -> its dimensions
  for (const c of constraints) {
    if (c.type !== 'distance' || c.isRadius) continue;
    const { j1, j2 } = resolveDimEndpoints(c, joints, shapes), f = linearDimFrame(c, j1, j2), side = c.offset < 0 ? -1 : 1;
    const ux = side * f.nx, uy = side * f.ny, along = (p) => p.x * f.ax + p.y * f.ay;
    const a = Math.min(along(j1), along(j2)), b = Math.max(along(j1), along(j2)), mid = (a + b) / 2, half = Math.max(b - a, gap) / 2;
    const key = `${Math.round(Math.atan2(uy, ux) * 180 / Math.PI)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c, f, side, ux, uy, len: b - a, span: [mid - half, mid + half], at: f.mid.x * ux + f.mid.y * uy });
  }
  for (const items of groups.values()) {
    items.sort((p, q) => p.len - q.len);
    const lanes = [];
    for (const it of items) {
      let lane = 0;
      while ((lanes[lane] || []).some(([s0, s1]) => it.span[0] < s1 && it.span[1] > s0)) lane++;
      (lanes[lane] = lanes[lane] || []).push(it.span);
      const offset = R(it.side * (ext(it.ux, it.uy) + gap * (1 + lane) - it.at));
      projectDimLabel(it.c, linearParamsToPoint(it.f, offset, it.c.labelSlide || 0), joints, shapes); // the label dragged to its lane
    }
  }
}

// ── TASK 680: the DRAWING a recipe works on: the tool operations (#core/tool-ops.js) in the template's user coordinates ──────────────────────
// Points are [x, y] in user coordinates (Y up, before the anchor shift) or the id of an existing joint (a click on it). Lines come back as
// the Line tool's segments ({ id, a, b }: its shape and its own two joints).
const LABEL_AWAY = 10; // where a recipe drops a linear dimension's label (mm from its points; the placement rule above moves it out later)
function drawing() {
  const state = ops.newSketchState();
  let ox = 0, oy = 0, swap = false;
  const across = { horizontal: 'vertical', vertical: 'horizontal' };
  const d = {
    state,
    /** The authored point that lands on the origin (the anchor): every point is placed relative to it. */
    origin(x, y) { ox = x; oy = y; },
    /** TASK 670's layout seam: from here on the authored x and y are swapped (a mirror in the diagonal through the anchor). */
    mirrorDiagonal() { swap = true; },
    w(x, y) { const [u, v] = swap ? [y, x] : [x, y]; return [u - (swap ? oy : ox), userToWorldY(v - (swap ? ox : oy))]; },
    pos(j) { return state.joints.get(j); },
    pt(x, y) { const [a, b] = d.w(x, y); return ops.click(state, a, b); },
    poly(pts, closed = false, construction = false) { return ops.polyline(state, pts.map((p) => (typeof p === 'string' ? p : d.w(p[0], p[1]))), closed, construction); },
    line(a, b, construction = false) { return d.poly([a, b], false, construction)[0]; },
    circle(x, y, r, construction = false) { const [a, b] = d.w(x, y); return ops.circle(state, a, b, r, construction); },
    // an arc about `c` from `a` to `e` (three click joints), counter-clockwise AS THE USER SEES IT (the Arc tool's winding: sweep false)
    arc(c, a, e) { return ops.arc(state, c, a, e, { sweep: false }); },
    h(a, b) { return ops.constrain(state, swap ? T.VERTICAL : T.HORIZONTAL, { joints: [a, b] }); },
    v(a, b) { return ops.constrain(state, swap ? T.HORIZONTAL : T.VERTICAL, { joints: [a, b] }); },
    hl(seg) { return d.h(seg.a, seg.b); },
    vl(seg) { return d.v(seg.a, seg.b); },
    equal(s1, s2) { return ops.constrain(state, T.EQUAL, { shapes: [s1, s2] }); },
    equalChain(list) { for (let i = 0; i + 1 < list.length; i++) d.equal(list[i], list[i + 1]); },
    parallel(s1, s2) { return ops.constrain(state, T.PARALLEL, { shapes: [s1, s2] }); },
    midpoint(a, b, m) { return ops.constrain(state, T.MIDPOINT, { joints: [a, b, m] }); }, // the Midpoint tool's three points: m halfway from a to b
    coincident(a, b) { return ops.constrain(state, T.COINCIDENT, { joints: [a, b] }); },
    on(j, shape) { ops.snap(state, j, { shape }); }, // a point dragged / drawn onto a curve
    anchor(j) { ops.snap(state, j, ORIGIN_JOINT_ID); }, // a point on the origin
    /**
     * A point-to-point dimension. `mode` and `side` say where the user drops the label (as the old offset did): 'aligned' beside the middle,
     * 'horizontal' / 'vertical' beyond the end that is outermost on that side. The Dimension tool picks the mode from the label point (its
     * detectDimMode; TASK 680: a level / plumb pair is always a horizontal / vertical dimension, like Fusion). `text` is typed in its box.
     */
    dim(a, b, mode, side, text) {
      if (swap) { mode = across[mode] || mode; side = -side; }
      const label = labelPoint(state, { type: T.DISTANCE, joints: [a, b], dimMode: mode }, side);
      const c = ops.dimension(state, { joints: [a, b] }, label, text);
      const A = state.joints.get(a), B = state.joints.get(b);
      const want = Math.abs(A.y - B.y) < 1e-9 ? 'horizontal' : Math.abs(A.x - B.x) < 1e-9 ? 'vertical' : mode; // a level / plumb pair: its own axis
      if (c.dimMode !== want) throw new Error(`dimension ${c.name}: the label point made a ${c.dimMode} dimension, not ${want}`);
      return c;
    },
    /** A line-to-line distance (two parallel lines), the label on `side` of the dimension line. */
    gap(l1, l2, side, text) {
      if (swap) side = -side;
      return ops.dimension(state, { lines: [l1, l2] }, labelPoint(state, { type: T.DISTANCE, shapes: [l1, l2] }, side), text);
    },
    /** A radius dimension, its label `dist` from the centre, up and to the right as the user sees it. */
    radius(shape, text, dist = 10) {
      const sh = state.shapes.find((s) => s.id === shape), c = state.joints.get(sh.joints[0]);
      return ops.dimension(state, { shape }, { x: c.x + dist * Math.SQRT1_2, y: c.y - dist * Math.SQRT1_2 }, text);
    },
    /** An angle dimension between two lines, its label dropped at the authored point [x, y] (the sector under it is the one it measures). */
    angle(l1, l2, at, text) { const [x, y] = d.w(at[0], at[1]); return ops.dimension(state, { lines: [l1, l2] }, { x, y }, text); },
    /** A text typed into an existing dimension's box (a double click on its label). */
    type(c, text) { return ops.typeDimension(state, c, text); },
    /** The drawing as a document: the linear labels dragged to the placement rule's lanes, then the one save path. */
    finish() {
      placeDimensions(state.joints, state.shapes, state.constraints);
      return serializeDocument(state);
    },
  };
  return d;
}
// where a user drops a linear dimension's label to get `side` (the sign of its offset along the frame of `cLike`, the old template offset): beside
// the middle for an aligned one (and for a line-to-line one), beyond the outermost end on that side for a horizontal / vertical one
function labelPoint(state, cLike, side) {
  const { j1, j2 } = resolveDimEndpoints(cLike, state.joints, state.shapes), f = linearDimFrame(cLike, j1, j2);
  const ux = side * f.nx, uy = side * f.ny;
  const at = cLike.dimMode === 'horizontal' || cLike.dimMode === 'vertical' ? (j1.x * ux + j1.y * uy >= j2.x * ux + j2.y * uy ? j1 : j2) : f.mid;
  return { x: at.x + ux * LABEL_AWAY, y: at.y + uy * LABEL_AWAY };
}
// a closed polyline's corner k (the start joint of its segment k)
const corners = (segs) => segs.map((s) => s.a);

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// ── TASK 672: BOARD sketches (the frame templates), one path from board outlines to a sketch and its rules ──────────────────────────────────
const NEAR = 1e-6; // two corners closer than this (mm) are ONE point (a frame engine computes a shared corner twice, a float apart)
// Board OUTLINES (world polygons: frame-calc's frame, Y down) -> the sketch, drawn with the LINE TOOL: every edge is split at the corners lying
// on it and each piece is drawn ONCE (a seam two boards share is one line). Each board's pieces not drawn yet are drawn as polylines along the
// board (the whole outline closed when none is drawn yet); a polyline starts on a corner's joint when that corner has one, and ends on it (the
// Line tool's coincident). Each corner's FIRST joint is its joint for the rules and the dimensions (`homes`: corners given a joint beforehand).
// -> { J(q): a corner's joint, corners: [{ q, j }], pieces: [{ a, b, shape }] (a, b: corners; in drawing order) }
function drawBoards(d, polys, homes = []) {
  const corners = [];
  const find = (q) => corners.find((c) => Math.abs(c.q.x - q.x) < NEAR && Math.abs(c.q.y - q.y) < NEAR);
  for (const h of homes) corners.push({ q: h.q, j: h.j });
  for (const poly of polys) for (const q of poly) if (!find(q)) corners.push({ q, j: null });
  const key = (u, v) => [corners.indexOf(u), corners.indexOf(v)].sort((x, y) => x - y).join('|');
  const pieces = [], drawn = new Set();
  const userPt = (c) => c.j || [c.q.x, worldToUserY(c.q.y)];
  for (const poly of polys) {
    const ring = []; // this board's pieces, in order round it
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const on = corners.map((c) => ({ c, u: ((c.q.x - a.x) * dx + (c.q.y - a.y) * dy) / (len * len), off: Math.abs((c.q.x - a.x) * dy - (c.q.y - a.y) * dx) / len }))
        .filter((o) => o.off < NEAR && o.u > -NEAR / len && o.u < 1 + NEAR / len).sort((u, v) => u.u - v.u); // the corners ON this edge, from a to b
      for (let k = 0; k + 1 < on.length; k++) ring.push([on[k].c, on[k + 1].c]);
    });
    const todo = ring.map(([u, v]) => !drawn.has(key(u, v)));
    const runs = [];
    if (todo.every(Boolean)) runs.push({ pieces: ring, closed: true });
    else {
      const s0 = todo.findIndex((t, i) => !t && todo[(i + 1) % ring.length]); // a run starts after a drawn piece
      let run = null;
      for (let k = 1; k <= ring.length; k++) {
        const i = (s0 + k) % ring.length;
        if (todo[i]) { if (!run) runs.push(run = { pieces: [], closed: false }); run.pieces.push(ring[i]); } else run = null;
      }
    }
    for (const run of runs) {
      const pts = run.closed ? run.pieces.map(([u]) => userPt(u)) : [userPt(run.pieces[0][0]), ...run.pieces.map(([, v]) => userPt(v))];
      const segs = d.poly(pts, run.closed);
      run.pieces.forEach(([u, v], k) => {
        if (!u.j) u.j = segs[k].a;
        if (!v.j) v.j = segs[k].b;
        drawn.add(key(u, v));
        pieces.push({ a: u, b: v, shape: segs[k].id });
      });
    }
  }
  return { J: (q) => find(q).j, corners, pieces };
}
// The RULES of a board sketch, from its CARRIER lines: every board edge lies on one (a frame's outer and inner faces), and every corner sits
// where two carriers cross, so holding each corner on its carriers leaves only the carriers to place (the template's dimensions and parallels).
// A carrier declared 'h' / 'v' chains its corners, in order along it, with horizontal / vertical rules (k - 1 rules for k corners: the carrier
// keeps one freedom, its offset); a free (slanted) carrier keeps two (offset and angle): its first drawn piece is its REFERENCE line and every
// other corner on it is held on that piece (k - 2 rules: the point dragged onto the line). carriers: [{ a, b, axis: 'h' | 'v' | null }] (world
// points, a != b). -> per carrier { corners (in order along it), ref (the reference piece's shape id) }
function carrierRules(d, board, carriers) {
  return carriers.map((cr) => {
    const dx = cr.b.x - cr.a.x, dy = cr.b.y - cr.a.y, len = Math.hypot(dx, dy);
    const onIt = (q) => Math.abs((q.x - cr.a.x) * dy - (q.y - cr.a.y) * dx) / len < NEAR;
    const along = (q) => (q.x - cr.a.x) * dx + (q.y - cr.a.y) * dy;
    const cs = board.corners.filter((c) => onIt(c.q)).sort((u, v) => along(u.q) - along(v.q));
    const ref = board.pieces.find((p) => onIt(p.a.q) && onIt(p.b.q));
    if (cr.axis) for (let i = 0; i + 1 < cs.length; i++) (cr.axis === 'h' ? d.h : d.v)(cs[i].j, cs[i + 1].j);
    else for (const c of cs) if (c !== ref.a && c !== ref.b) d.on(c.j, ref.shape);
    return { corners: cs, ref: ref && ref.shape };
  });
}

// ── the bank: one RECIPE per template (what a user does with the tools to draw it) ────────────────────────────────────────────────────────
// TASK 680: the Slot tool (centre to centre, task 673) from the origin: its two ends, the lines tangent to them, its width (the tool's own
// diameter dimension, `width` typed in it); the centre line horizontal and the centres `length - width` apart.
function buildSlot(d, p) {
  const L = num(p.length, 40), W = num(p.width, 10), c = L - W; // c = centre-to-centre distance of the two ends
  const CR = d.pt(c, 0);
  const built = ops.slot(d.state, ORIGIN_JOINT_ID, CR, W); // the first pick on the origin (the Slot tool reuses that joint)
  const width = d.state.constraints.find((k) => k.type === T.DISTANCE && k.isRadius && k.shape === built.meta.e1.id);
  d.type(width, 'width');
  d.h(ORIGIN_JOINT_ID, CR);
  d.dim(ORIGIN_JOINT_ID, CR, 'horizontal', -1, 'length - width');
}

// TASK 680: the Rect tool, its width and height dimensioned, then each corner rounded by the Fillet tool: four fillets, each with its OWN radius
// dimension (the fillet's own, `radius` typed in it) and no equal rule between them (owner, turns 1735-1742). The bottom-left fillet's centre is
// on the origin (as before).
function buildRoundedRect(d, p) {
  const w = num(p.width, 60), h = num(p.height, 40), r = num(p.radius, 5);
  d.origin(r, r);
  const [x0, y0] = d.w(0, 0), [x1, y1] = d.w(w, h);
  const rc = ops.rect(d.state, x0, y0, x1, y1); // world: y0 is the bottom edge (the larger y), y1 the top
  const line = (id) => d.state.shapes.find((s) => s.id === id);
  const bottom = rc.top, right = rc.right, top = rc.bottom, left = rc.left; // makeRectFromTwoJoints names its edges for a first click top-left
  d.dim(line(top).joints[0], line(top).joints[1], 'horizontal', -1, 'width');
  d.dim(line(left).joints[0], line(left).joints[1], 'vertical', -1, 'height');
  let bl = null;
  for (const [a, b] of [[top, right], [right, bottom], [bottom, left], [left, top]]) {
    const f = ops.fillet(d.state, a, b, r);
    d.type(d.state.constraints.find((k) => k.isRadius && k.shape === f.arc), 'radius');
    if (a === bottom) bl = f;
  }
  d.anchor(bl.center);
}

function buildKeyhole(d, p) {
  const R0 = num(p.radius, 10), neck = num(p.neck, 8), depth = num(p.depth, 35);
  const hw = neck / 2, ph = Math.sqrt(Math.max(R0 * R0 - hw * hw, 0));
  const CB = d.pt(0, 0), P1 = d.pt(hw, -ph), P2 = d.pt(-hw, -ph);
  const big = d.arc(CB, P1, P2); // from the right shoulder up and over the top (counter-clockwise) to the left shoulder
  d.anchor(CB);
  const CS = d.pt(0, -depth), Q2 = d.pt(-hw, -depth), Q1 = d.pt(hw, -depth);
  d.arc(CS, Q2, Q1); // the rounded end of the neck, round the bottom
  const left = d.line(P2, Q2), right = d.line(P1, Q1); // the neck's sides, from the shoulders down to the end arc's points
  d.h(P1, P2); d.vl(right); d.vl(left); d.h(CS, Q1); d.h(Q1, Q2);
  d.radius(big, 'radius', 12); d.dim(P1, P2, 'horizontal', 1, 'neck'); d.dim(CB, CS, 'vertical', 1, 'depth');
}

function buildHexagon(d, p) {
  const af = num(p.acrossFlats, 20), rc = af / 2 / Math.cos(Math.PI / 6);
  const C = d.pt(0, 0), V = d.pt(rc, 0);
  const built = ops.polygon(d.state, C, V, 6);
  d.anchor(C);
  const sides = built.shapes.filter((x) => !x.isConstruction);
  // the polygon's first corner is on the right, so side 1 (60 to 120 degrees) is the flat on top and side 4 the one at the bottom
  d.h(sides[1].joints[0], sides[1].joints[1]);
  d.gap(sides[1].id, sides[4].id, 1, 'across_flats');
}

function buildStar(d, p) {
  const Ro = num(p.outer, 25), Ri = num(p.inner, 10);
  const pts = [];
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + k * 2 * Math.PI / 5, b = a + Math.PI / 5;
    pts.push([Ro * Math.cos(a), Ro * Math.sin(a)], [Ri * Math.cos(b), Ri * Math.sin(b)]);
  }
  const sides = d.poly(pts, true), at = corners(sides); // the outline: outer point, inner point, ... (the Line tool, closed)
  const radO = [], radI = [];
  for (let k = 0; k < 5; k++) { radO.push(d.line(ORIGIN_JOINT_ID, at[2 * k], true)); radI.push(d.line(ORIGIN_JOINT_ID, at[2 * k + 1], true)); } // construction radii from the centre
  d.equalChain(radO.map((s) => s.id)); d.equalChain(radI.map((s) => s.id)); d.equalChain(sides.map((s) => s.id));
  d.vl(radO[0]);
  d.dim(ORIGIN_JOINT_ID, at[0], 'aligned', 1, 'outer'); d.dim(ORIGIN_JOINT_ID, at[1], 'aligned', -1, 'inner');
}

function buildArrow(d, p) {
  const shaftL = num(p.shaftLength, 40), shaftW = num(p.shaftWidth, 10), headL = num(p.headLength, 20), headW = num(p.headWidth, 30);
  const ring = d.poly([[-shaftL, shaftW / 2], [0, shaftW / 2], [0, headW / 2], [headL, 0], [0, -headW / 2], [0, -shaftW / 2], [-shaftL, -shaftW / 2]], true);
  const [P0, P1, P2, P3, P4, P5, P6] = corners(ring);
  d.hl(ring[0]); d.hl(ring[5]); d.vl(ring[6]); d.vl(ring[1]); d.vl(ring[4]); d.v(P2, P4);
  const axis = d.line(ORIGIN_JOINT_ID, [-shaftL, 0], true), tip = d.line(ORIGIN_JOINT_ID, P3, true); // the arrow's axis, construction, from the origin
  d.midpoint(P2, P4, ORIGIN_JOINT_ID); d.midpoint(P0, P6, axis.b); d.hl(axis); d.hl(tip);
  d.dim(P0, P6, 'vertical', -1, 'shaft_width'); d.dim(P0, P1, 'horizontal', 1, 'shaft_length'); d.dim(P2, P4, 'vertical', 1, 'head_width'); d.dim(ORIGIN_JOINT_ID, P3, 'horizontal', -1, 'head_length');
}

function buildLBracket(d, p) {
  const w = num(p.width, 60), h = num(p.height, 50), t = num(p.thickness, 10), hd = num(p.holeDiameter, 5);
  const ring = d.poly([[0, 0], [w, 0], [w, t], [t, t], [t, h], [0, h]], true);
  const [P0, P1, P2, , P4, P5] = corners(ring);
  d.anchor(P0);
  ring.forEach((s, i) => (i % 2 ? d.vl(s) : d.hl(s)));
  d.dim(P0, P1, 'horizontal', -1, 'width'); d.dim(P0, P5, 'vertical', -1, 'height'); d.dim(P1, P2, 'vertical', 1, 'thickness'); d.dim(P5, P4, 'horizontal', 1, 'thickness');
  const k1 = d.circle(w - t, t / 2, hd / 2), k2 = d.circle(t / 2, h - t, hd / 2);
  d.dim(P0, k1.c, 'horizontal', 1, 'width - thickness'); d.dim(P0, k1.c, 'vertical', -1, 'thickness / 2');
  d.dim(P0, k2.c, 'horizontal', -1, 'thickness / 2'); d.dim(P0, k2.c, 'vertical', 1, 'height - thickness');
  d.radius(k1.id, 'hole_diameter / 2', 6); d.equal(k1.id, k2.id);
}

function buildBoltCircle(d, p) {
  const Ro = num(p.outerRadius, 30), Rb = num(p.boltRadius, 20), hr = num(p.holeRadius, 3);
  const outer = d.circle(0, 0, Ro), bolt = d.circle(0, 0, Rb, true);
  d.anchor(outer.c); d.anchor(bolt.c);
  const holes = [], centres = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + k * Math.PI / 3, c = d.circle(Rb * Math.cos(a), Rb * Math.sin(a), hr);
    holes.push(c.id); centres.push(c.c); d.on(c.c, bolt.id); // each centre clicked on the bolt circle
  }
  const chords = d.poly(centres, true, true); // construction chords between the hole centres
  d.equalChain(chords.map((s) => s.id)); d.equalChain(holes); d.v(ORIGIN_JOINT_ID, centres[0]);
  d.radius(outer.id, 'outer_radius', 6); d.radius(bolt.id, 'bolt_radius', 6); d.radius(holes[0], 'hole_radius', 4);
}

function buildFingerEdge(d, p) {
  const tab = num(p.tabWidth, 10), gap = num(p.gapWidth, 10), depth = num(p.depth, 5), n = 5;
  const pitch = tab + gap, pts = [];
  for (let i = 0; i < n; i++) {
    const x = i * pitch;
    pts.push([x, depth], [x + tab, depth]);
    if (i < n - 1) pts.push([x + tab, 0], [x + pitch, 0]);
  }
  const segs = d.poly(pts, false); // one open polyline: tab, down, gap, up, tab, ...
  const tabs = [], gaps = [], verts = [];
  segs.forEach((s, i) => (i % 4 === 0 ? tabs : i % 4 === 2 ? gaps : verts).push(s));
  for (const s of [...tabs, ...gaps]) d.hl(s);
  for (const s of verts) d.vl(s);
  d.anchor(segs[0].a);
  d.equalChain(tabs.map((s) => s.id)); d.equalChain(gaps.map((s) => s.id)); d.equalChain(verts.map((s) => s.id));
  d.dim(tabs[0].a, tabs[0].b, 'horizontal', 1, 'tab_width');
  d.dim(gaps[0].a, gaps[0].b, 'horizontal', -1, 'gap_width');
  d.dim(tabs[0].b, gaps[0].a, 'vertical', 1, 'depth');
}

// TASK 669: DOG-BONE POCKET. The classic DIAGONAL dog-bone: at each inside corner C the relief circle (the bit's radius r) has its centre K on the
// corner's diagonal, r inside the corner, so the circle PASSES THROUGH C and crosses the two walls 2a = sqrt(2) r from C (a = r / sqrt(2)): the
// two crossing points H (on the horizontal wall) and V (on the vertical wall) are opposite ends of a diameter, so the relief is a HALF circle
// bulging past the corner. One closed loop: wall line, half-circle arc, wall line, ... TASK 680: the four reliefs are Arc tool arcs, the walls
// Line tool lines from one arc's end to the next; the corner C is the middle point of a construction polyline H -> C -> V (its two legs
// horizontal / vertical and equal: the 45 degrees) held on the relief arc (the point on the circle); the bottom-left C is on the origin. Each
// relief has its own radius dimension `bit_diameter / 2` (TASK 680: no equal rule between arcs, as the rounded rectangle's corners).
function buildDogBone(d, p) {
  const w = num(p.width, 60), h = num(p.height, 40), bd = num(p.bitDiameter, 6.35), r = bd / 2, a = r / Math.SQRT2;
  const TAU = 2 * Math.PI, mod = (x) => ((x % TAU) + TAU) % TAU;
  const corner = (cx, cy, ix, iy) => {
    const K = [cx + a * ix, cy + a * iy], H = [cx + 2 * a * ix, cy], V = [cx, cy + 2 * a * iy];
    const ang = (q) => Math.atan2(q[1] - K[1], q[0] - K[0]);
    // the counter-clockwise arc (as the user sees it) that passes through C: from H to V if that sweep contains C, else from V to H
    const cIn = mod(ang([cx, cy]) - ang(H)) < mod(ang(V) - ang(H));
    const [from, to] = cIn ? [H, V] : [V, H];
    const k = d.pt(...K), f = d.pt(...from), t = d.pt(...to);
    const arc = d.arc(k, f, t);
    return { cx, cy, arc, H: cIn ? f : t, V: cIn ? t : f };
  };
  const bl = corner(0, 0, 1, 1), br = corner(w, 0, -1, 1), tr = corner(w, h, -1, -1), tl = corner(0, h, 1, -1);
  const walls = [d.line(bl.H, br.H), d.line(br.V, tr.V), d.line(tr.H, tl.H), d.line(tl.V, bl.V)];
  d.hl(walls[0]); d.vl(walls[1]); d.hl(walls[2]); d.vl(walls[3]);
  for (const k of [bl, br, tr, tl]) {
    const [cH, cV] = d.poly([k.H, [k.cx, k.cy], k.V], false, true); // construction: H -> the corner -> V
    d.hl(cH); d.vl(cV); d.equal(cH.id, cV.id);
    d.on(cH.b, k.arc);
    k.C = cH.b;
  }
  d.anchor(bl.C);
  for (const k of [bl, br, tr, tl]) d.radius(k.arc, 'bit_diameter / 2', 10);
  d.dim(bl.V, br.V, 'horizontal', -1, 'width');
  d.dim(bl.H, tl.H, 'vertical', -1, 'height');
}

// TASK 669: T-SLOT, the 2D profile of a T-track slot (opening up at the top, centred on the origin): a 19 mm wide slot 9.5 mm deep (3/4 inch
// T-track) over a 25 mm wide slot, 16 mm deep in all. The origin is the middle of the opening (the closing edge at the top).
function buildTSlot(d, p) {
  const tw = num(p.topWidth, 19), td = num(p.topDepth, 9.5), bw = num(p.bottomWidth, 25), D = num(p.totalDepth, 16);
  const ring = d.poly([[-tw / 2, 0], [tw / 2, 0], [tw / 2, -td], [bw / 2, -td], [bw / 2, -D], [-bw / 2, -D], [-bw / 2, -td], [-tw / 2, -td]], true);
  const [TL, TR, NR, OR, BR, , OL, NL] = corners(ring);
  ring.forEach((s, i) => (i % 2 ? d.vl(s) : d.hl(s))); d.h(NR, NL);
  const axis = d.line(ORIGIN_JOINT_ID, [0, -D], true); // the centre line, construction, from the origin down to the bottom
  d.midpoint(TL, TR, ORIGIN_JOINT_ID); d.midpoint(ring[4].a, ring[4].b, axis.b); d.vl(axis);
  d.dim(TL, TR, 'horizontal', 1, 'top_width'); d.dim(TR, NR, 'vertical', 1, 'top_depth'); d.dim(OL, OR, 'horizontal', -1, 'bottom_width'); d.dim(TR, BR, 'vertical', 1, 'total_depth');
}

// TASK 669: BUTTERFLY KEY (bow-tie / dovetail key), centred on its waist: 50 mm long, 25 mm wide at the two ends, 10 mm at the waist, straight sides.
function buildButterflyKey(d, p) {
  const L = num(p.length, 50), ew = num(p.endWidth, 25), ww = num(p.waistWidth, 10);
  const ring = d.poly([[-L / 2, ew / 2], [0, ww / 2], [L / 2, ew / 2], [L / 2, -ew / 2], [0, -ww / 2], [-L / 2, -ew / 2]], true);
  const [, P1, P2, P3, P4] = corners(ring);
  const toL = d.line(ORIGIN_JOINT_ID, [-L / 2, 0], true), toR = d.line(ORIGIN_JOINT_ID, [L / 2, 0], true); // the long axis, construction, from the waist
  const EL = toL.b, ER = toR.b;
  d.vl(ring[2]); d.vl(ring[5]); d.v(P1, P4);
  d.midpoint(P1, P4, ORIGIN_JOINT_ID); d.midpoint(ring[2].a, ring[2].b, ER); d.midpoint(ring[5].a, ring[5].b, EL); d.midpoint(EL, ER, ORIGIN_JOINT_ID); d.h(EL, ER);
  d.equal(ring[2].id, ring[5].id);
  d.dim(EL, ER, 'horizontal', 1, 'length'); d.dim(P2, P3, 'vertical', 1, 'end_width'); d.dim(P1, P4, 'vertical', 1, 'waist_width');
}

// TASK 669: CUP HINGE BORE, the European cup-hinge layout: a 35 mm cup hole at the origin, and two 8 mm screw (dowel) holes 45 mm apart on a line
// 9.5 mm from the cup's centre (below it), centred on it. (The common layout; hinge makers vary, edit the dimensions for another.)
function buildCupHinge(d, p) {
  const cd = num(p.cupDiameter, 35), sp = num(p.screwSpacing, 45), off = num(p.screwOffset, 9.5), sd = num(p.screwDiameter, 8);
  const cup = d.circle(0, 0, cd / 2);
  d.anchor(cup.c);
  const k1 = d.circle(-sp / 2, -off, sd / 2), k2 = d.circle(sp / 2, -off, sd / 2);
  const drop = d.line(ORIGIN_JOINT_ID, [0, -off], true); // construction, from the cup centre down to the screw line
  d.midpoint(k1.c, k2.c, drop.b); d.vl(drop); d.h(k1.c, k2.c); d.equal(k1.id, k2.id);
  d.radius(cup.id, 'cup_diameter / 2', 8); d.radius(k1.id, 'screw_diameter / 2', 6); d.dim(k1.c, k2.c, 'horizontal', -1, 'screw_spacing'); d.dim(cup.c, drop.b, 'vertical', -1, 'screw_offset');
}

// TASK 669: SHELF-PIN ROW: ONE source hole + ONE rectangular pattern (the Rectangular Pattern tool, #core/pattern.js applyPattern). The copies
// follow the source (its radius dimension) and the pattern's spacing; count and spacing are the pattern's values, not sketch dimensions. 32 mm
// centres (the 32 mm cabinet system).
function buildShelfPins(d, p) {
  const n = Math.max(2, Math.round(num(p.count, 5))), sp = num(p.spacing, 32), hd = num(p.holeDiameter, 5);
  const hole = d.circle(0, 0, hd / 2);
  d.anchor(hole.c);
  d.radius(hole.id, 'hole_diameter / 2', 6);
  ops.pattern(d.state, T.RECTANGULAR_PATTERN, { shapes: [hole.id], joints: [] }, { ...patternDefaults(T.RECTANGULAR_PATTERN), quantity: [n, 1], distance: [sp, sp] });
}

// TASK 669: BOX FRAME (front view) of a plywood cubby / bookcase carcass, the long direction VERTICAL: two SIDE boards the FULL length, two END
// boards BETWEEN the sides, and N - 1 DIVIDERS between the sides, all t thick, splitting the inside into N equal compartments. The boards SHARE
// their edges (one line per shared edge: no gaps, no overlaps). Every segment is horizontal / vertical.
// TASK 670 (no FOLD): every board's thickness and every opening but the top one is dimensioned, a formula of the USER PARAMETERS: every
// thickness reads `thickness`, an opening is (length - (N + 1) * thickness) / N (TASK 672, owner ruling: every dimension reads the parameters
// directly). The top opening is what the overall length leaves. TASK 680: the dimensions are the Dimension tool's: on these level / plumb
// pairs it makes SIGNED horizontal / vertical dimensions (like Fusion: the solver locks which side the second point is on, so no board folds).
// TASK 670 LAYOUT: 'Vertical' (above) or 'Horizontal' = the SAME construction with x and y swapped (a mirror in the diagonal through the
// origin, which stays the bottom-left corner): the full-length boards become the bottom and the top, the ends and dividers stand between
// them, the compartments sit side by side; every horizontal rule becomes vertical and the other way round.
// TASK 672 CORNER JOINT (one choice for the 4 outer corners, #core/corner-joint.js cornerJointPoints, frame-calc's): 'V-Through' (default) =
// the sides run the full length (the owner's original rule); 'H-Through' = the ends run the full width, the sides stand between them; 'Miter' =
// 45 degree seams. The boards are frame-calc's stud-layout buildFrameGeometry ones (the jambs = the sides, the plates = the ends, the rails =
// the dividers), drawn through the one board path (drawBoards + carrierRules: every edge is on one of the 4 x levels or the 2 (N + 1) y
// levels); the dimensions are the same 2 N + 4 in every joint. The Horizontal layout mirrors the whole drawing, joint included, so 'V-Through'
// is always "the full-length boards run through" (#ui/template-glyphs.js draws its glyph mirrored there).
export const BOX_FRAME_LAYOUTS = Object.freeze([
  Object.freeze({ value: 'Vertical', label: 'Vertical layout' }),
  Object.freeze({ value: 'Horizontal', label: 'Horizontal layout' }),
]);
function buildBoxFrame(d, p) {
  const Lg = num(p.length, 1500), W = num(p.width, 400), t = num(p.thickness, 18), n = Math.max(1, Math.round(num(p.compartments, 5)));
  const joint = CORNER_JOINT_TYPES.some((o) => o.value === p.joint) ? p.joint : 'V-Through';
  const g = (Lg - (n + 1) * t) / n;
  if (p.layout === 'Horizontal') d.mirrorDiagonal(); // the construction below is written for the vertical layout
  const levels = []; // the bottom and the top y of each cross board, from the bottom
  for (let k = 0; k <= n; k++) { const b = k * (g + t); levels.push(b, b + t); }
  // the four outer corners (user coordinates of the construction): the horizontal board is an END, the vertical one a SIDE
  const BL = cornerJointPoints(0, 0, 1, 1, t, joint), BR = cornerJointPoints(W, 0, -1, 1, t, joint);
  const TL = cornerJointPoints(0, Lg, 1, -1, t, joint), TR = cornerJointPoints(W, Lg, -1, -1, t, joint);
  const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const boards = [
    [BL.vOuter, TL.vOuter, TL.vInner, BL.vInner], [BR.vOuter, TR.vOuter, TR.vInner, BR.vInner], // the sides
    [BL.hOuter, BR.hOuter, BR.hInner, BL.hInner], [TL.hOuter, TR.hOuter, TR.hInner, TL.hInner], // the ends
  ];
  for (let k = 1; k < n; k++) boards.push(rect(t, levels[2 * k], W - 2 * t, t)); // the dividers, between the sides
  const world = (q) => ({ x: q.x, y: userToWorldY(q.y) });
  const board = drawBoards(d, boards.map((poly) => poly.map(world)));
  const J = (q) => board.J(world(q)), col = (i) => J({ x: t, y: levels[i] });
  const L0 = J({ x: 0, y: 0 }), R0 = J({ x: W, y: 0 });
  d.anchor(L0);
  carrierRules(d, board, [
    ...[0, t, W - t, W].map((x) => ({ a: world({ x, y: 0 }), b: world({ x, y: Lg }), axis: 'v' })),
    ...levels.map((y) => ({ a: world({ x: 0, y }), b: world({ x: W, y }), axis: 'h' })),
  ]);
  d.dim(L0, R0, 'horizontal', -1, 'width');
  d.dim(L0, J({ x: 0, y: Lg }), 'vertical', -1, 'length');
  d.dim(L0, J(BL.vInner), 'horizontal', 1, 'thickness'); // the left side
  d.dim(J(BR.vInner), R0, 'horizontal', 1, 'thickness'); // the right side
  // the right column has the same levels (horizontal rows), so the left column (and its corners) carries the cross boards' dimensions
  d.dim(J(BL.hOuter), J(BL.hInner), 'vertical', 1, 'thickness'); // the bottom end
  for (let k = 1; k < n; k++) d.dim(col(2 * k), col(2 * k + 1), 'vertical', 1, 'thickness'); // each divider
  d.dim(J(TL.hInner), J(TL.hOuter), 'vertical', 1, 'thickness'); // the top end
  for (let k = 0; k + 1 < n; k++) d.dim(col(2 * k + 1), col(2 * k + 2), 'vertical', 1, `(length - ${n + 1} * thickness) / ${n}`); // the openings but the top one
}

// TASK 670: RIGHT-ANGLE FRAME CORNER: a horizontal and a vertical board meeting at 90 degrees (the top-left corner of a frame: the horizontal
// board runs right from the outer corner, the vertical one runs down), both `thickness` thick, each its length long from the OUTER corner, joined
// by the corner joint the start modal picks ('Miter' | 'H-Through' | 'V-Through'). The two board outlines are #core/corner-joint.js
// cornerBoards (frame-calc's cornerJointPoints) in WORLD coordinates (Y down, as frame-calc's), so the seam moves exactly as frame-calc's does.
// The boards SHARE their seam (drawn once). Rules: each straight edge horizontal / vertical (a miter seam is the only slanted one); the two
// lengths and the two boards' thicknesses are dimensions; both thicknesses read `thickness`. Outer corner at the origin.
function buildRightAngleCorner(d, p) {
  const lh = num(p.horizontalLength, 300), lv = num(p.verticalLength, 200), t = num(p.thickness, 18);
  const type = CORNER_JOINT_TYPES.some((o) => o.value === p.joint) ? p.joint : 'H-Through';
  const boards = cornerBoards(0, 0, 1, 1, t, lh, lv, type);
  const { J, pieces } = drawBoards(d, [boards.h, boards.v]);
  const O = J({ x: 0, y: 0 }), A = J(boards.h[1]), B = J(boards.h[2]), C = J(boards.v[1]), D = J(boards.v[2]);
  d.anchor(O);
  for (const { a: u, b: v } of pieces) if (Math.abs(u.q.y - v.q.y) < 1e-9) d.h(u.j, v.j); else if (Math.abs(u.q.x - v.q.x) < 1e-9) d.v(u.j, v.j);
  d.dim(O, A, 'horizontal', 1, 'horizontal_length'); d.dim(O, C, 'vertical', -1, 'vertical_length');
  d.dim(A, B, 'vertical', 1, 'thickness'); d.dim(C, D, 'horizontal', 1, 'thickness');
}

// TASK 672: STAIR STRINGER, a cut stringer from one board (side view; the origin at the foot of the first riser, on the floor; Y up). `steps`
// notches, each a riser `rise` high and a tread `run` deep; riser k + 1 stands on the back of tread k. At the top a PLUMB cut (vertical) drops
// from the back of the last tread to the lower edge; at the bottom a LEVEL cut (on the floor) runs from the foot of the first riser to the
// lower edge. The lower edge is parallel to the PITCH line (a construction line through the inner corners of the notches: the backs of the
// treads, and the foot of the first riser), `throat` below it (the board left under every notch, square to the pitch). The board the stringer
// is cut from is a construction line `board width` above the lower edge (the board's top edge: the notches' tips must stay under it).
// Rules (no fold: once the pitch is set every one is linear): risers vertical, treads horizontal, the inner corners on the pitch line, the tips
// (the nosings) on a construction line parallel to it, so every step is the first one; the first riser and tread are dimensioned; the throat
// and the board width are line-to-line dimensions of parallel lines; the board's top edge spans the stringer (front to plumb cut).
function buildStringer(d, p) {
  const n = Math.max(2, Math.round(num(p.steps, 4))), r = num(p.rise, 180), g = num(p.run, 250), w = num(p.boardWidth, 286), th = num(p.throat, 125);
  const L = Math.hypot(r, g), drop = th * L / g, top = (w - th) * L / g; // the lower edge: y = (r / g) x - drop; the board's top edge: y = (r / g) x + top
  const pts = [[0, 0]];
  for (let k = 1; k <= n; k++) pts.push([(k - 1) * g, k * r], [k * g, k * r]); // the tip and the inner corner of each notch
  pts.push([n * g, n * r - drop], [th * L / r, 0]); // the lower edge's two ends: on the plumb cut, on the floor
  const segs = d.poly(pts, true), at = corners(segs); // the outline (the Line tool, closed): riser, tread, riser, ..., plumb cut, lower edge, level cut
  const F = at[0], Tk = (k) => at[1 + 2 * k], Ck = (k) => at[2 + 2 * k];
  d.anchor(F);
  for (let i = 0; i < 2 * n; i++) (i % 2 ? d.hl(segs[i]) : d.vl(segs[i])); // risers vertical, treads horizontal
  const plumb = segs[2 * n], lower = segs[2 * n + 1], level = segs[2 * n + 2];
  d.vl(plumb); d.hl(level);
  const pitch = d.line(F, Ck(n - 1), true), tips = d.line(Tk(0), Tk(n - 1), true), board = d.line([0, top], [n * g, n * r + top], true);
  for (let k = 0; k + 1 < n; k++) d.on(Ck(k), pitch.id);
  for (let k = 1; k + 1 < n; k++) d.on(Tk(k), tips.id);
  d.parallel(tips.id, pitch.id); d.parallel(lower.id, pitch.id); d.parallel(board.id, lower.id);
  d.v(F, board.a); d.v(plumb.b, board.b);
  d.dim(F, Tk(0), 'vertical', -1, 'rise');
  d.dim(Tk(0), Ck(0), 'horizontal', 1, 'run');
  d.gap(pitch.id, lower.id, 1, 'throat');
  d.gap(lower.id, board.id, 1, 'board_width');
}

// TASK 672: CURVED BENCH SEAT, a ring segment (the centre at the origin, the seat above it, symmetric about the Y axis) split into `slats`
// IDENTICAL straight tapered slats with even gaps. n + 1 radial lines at equal angles (sweep / n apart) bound the slats; each slat's two straight
// sides are parallel to its two radial lines, gap / 2 inside them, so every gap between two slats is a strip `gap` wide (its sides parallel)
// and the seat's two ends sit gap / 2 inside the end radials (every slat the same: one cutting pattern). The outer and the inner edge of each
// slat are real ARCS on the ring's two circles. Rules, every one LOCAL to the slats (a rule about a side's tiny distance from the far centre,
// a tangent to a gap-sized circle there or equal side lengths, flips or crawls: a side 1000 away turns 0.6 degree to pass the centre):
//   every arc centred on the origin, the outer arcs equal (the Equal tool: one circle), the inner arcs equal, the two radius dimensions;
//   each GAP: its two sides parallel and a gap dimension (each reads `gap`, the user parameter: two distinct parallel lines `gap` apart cannot
//   merge, so no gap can close);
//   IDENTICAL slats: every slat's outer chord and inner chord (construction lines) equal to the first slat's (the same angle and the same width);
//   the first and the last slat SYMMETRIC (their two construction diagonals equal): with the gaps, every slat is, so each side is gap / 2 from
//   its radial;
//   the ANGLE between the seat's two end sides = the sweep; the middle of the seat on the Y axis (the two outer corners either side of it level).
function buildBenchSeat(d, p) {
  const n = Math.max(2, Math.round(num(p.slats, 8))), Ro = num(p.outerRadius, 900), Ri = num(p.innerRadius, 450), sw = num(p.sweepAngle, 60), gap = num(p.gap, 10);
  const h = gap / 2, step = (sw / n) * Math.PI / 180, a0 = Math.PI / 2 - (sw / 2) * Math.PI / 180;
  // the corner on the circle of radius rho of the line parallel to the radial at angle phi, h to its counter-clockwise (+1) or clockwise (-1) side
  const corner = (rho, phi, side) => { const t = Math.sqrt(rho * rho - h * h), ux = Math.cos(phi), uy = Math.sin(phi); return d.pt(t * ux - side * h * uy, t * uy + side * h * ux); };
  const arcAt = (rho, phi1, phi2) => { const c = d.pt(0, 0), a = corner(rho, phi1, 1), b = corner(rho, phi2, -1), id = d.arc(c, a, b); d.anchor(c); return { id, a, b }; };
  const slats = [];
  for (let k = 0; k < n; k++) { // counter-clockwise from the right end
    const pa = a0 + k * step, pb = pa + step;
    const outer = arcAt(Ro, pa, pb), inner = arcAt(Ri, pa, pb);
    const A = d.line(inner.a, outer.a), B = d.line(inner.b, outer.b); // the two sides, from the inner arc's ends to the outer arc's
    slats.push({ IA: inner.a, OA: outer.a, IB: inner.b, OB: outer.b, A: A.id, B: B.id, outer: outer.id, inner: inner.id });
  }
  d.equalChain(slats.map((x) => x.outer)); // the outer arcs on ONE circle (each arc's centre on the origin)
  d.equalChain(slats.map((x) => x.inner)); // the inner arcs on one circle
  d.equalChain(slats.map((x) => d.line(x.OA, x.OB, true).id)); // identical slats: the outer chords
  d.equalChain(slats.map((x) => d.line(x.IA, x.IB, true).id)); // and the inner chords
  for (const x of [slats[0], slats[n - 1]]) d.equal(d.line(x.OA, x.IB, true).id, d.line(x.OB, x.IA, true).id); // the end slats symmetric
  const rim = slats.flatMap((x) => [x.OA, x.OB]);
  d.h(rim[n - 1], rim[n]); // the middle slat (n odd) or the middle gap (n even) level: the seat symmetric about the Y axis
  for (let k = 0; k + 1 < n; k++) d.parallel(slats[k].B, slats[k + 1].A); // each gap: two parallel sides
  d.radius(slats[0].outer, 'outer_radius', 10);
  d.radius(slats[0].inner, 'inner_radius', 10);
  d.angle(slats[n - 1].B, slats[0].A, [0, (Ro + Ri) / 2], 'sweep_angle'); // the label dropped in the seat's middle: the sector the seat spans
  for (let k = 0; k + 1 < n; k++) d.gap(slats[k].B, slats[k + 1].A, 1, 'gap'); // each gap's width: every one reads the parameter
}

// TASK 672: RIGHT-ANGLE BRACE, frame-calc's triangle frame (#core/frame-geometry.js calculateFramingGeometry, PORTED): a vertical board, a
// horizontal board and the diagonal brace between their far ends, `width` x `height` outside, each board its own thickness (as frame-calc
// measures them: the vertical one across x, the horizontal one across y, the diagonal square to its faces), and a joint per corner (top,
// bottom-left, bottom-right: frame-calc's options for each) that cuts the boards exactly as frame-calc does. The boards go through the one board
// path (drawBoards); every edge lies on one of six carriers (the outer and the inner face of each board: two vertical, two horizontal, two
// slanted) and every corner where two of them cross (carrierRules), so the drawing is held by the width and the height (the outer corners), the
// three thicknesses (dimensions for the vertical and the horizontal board, a line-to-line one for the diagonal) and the diagonal's inner face
// parallel to its outer face. frame-calc's frame (the apex at its origin, Y down) is placed so the outer right-angle corner (bottom-left) is the
// origin.
function buildBrace(d, p) {
  const pick = (v, opts) => (opts.some((o) => o.value === v) ? v : opts[0].value);
  const g = calculateFramingGeometry({ width: num(p.width, 300), height: num(p.height, 600), thickV: num(p.thickV, 38), thickH: num(p.thickH, 38), thickD: num(p.thickD, 38),
    topJoint: pick(p.topJoint, BRACE_JOINTS.top), blJoint: pick(p.blJoint, BRACE_JOINTS.bl), brJoint: pick(p.brJoint, BRACE_JOINTS.br) });
  const { W, H, Tv, Th, Td, L } = g, P = g.points;
  d.origin(0, worldToUserY(H)); // the bottom-left corner (frame-calc's (0, H)) on the origin
  const board = drawBoards(d, [P.V, P.H, P.D].map((b) => Object.values(b)));
  const T0 = board.J({ x: 0, y: 0 }), BL = board.J({ x: 0, y: H }), BR = board.J({ x: W, y: H });
  d.anchor(BL);
  const [, iV, , iH, oD, iD] = carrierRules(d, board, [
    { a: { x: 0, y: 0 }, b: { x: 0, y: H }, axis: 'v' }, { a: { x: Tv, y: 0 }, b: { x: Tv, y: H }, axis: 'v' }, // the vertical board's outer / inner face
    { a: { x: 0, y: H }, b: { x: W, y: H }, axis: 'h' }, { a: { x: 0, y: H - Th }, b: { x: W, y: H - Th }, axis: 'h' }, // the horizontal board's
    { a: { x: 0, y: 0 }, b: { x: W, y: H }, axis: null }, { a: { x: 0, y: Td * L / W }, b: { x: W - Td * L / H, y: H }, axis: null }, // the diagonal's
  ]);
  d.parallel(iD.ref, oD.ref);
  d.dim(BL, BR, 'horizontal', -1, 'width');
  d.dim(BL, T0, 'vertical', -1, 'height');
  d.dim(BL, iV.corners[iV.corners.length - 1].j, 'horizontal', -1, 'thick_v'); // to the lowest corner of the vertical board's inner face
  d.dim(BL, iH.corners[0].j, 'vertical', -1, 'thick_h'); // to the leftmost corner of the horizontal board's inner face
  d.gap(oD.ref, iD.ref, 1, 'thick_d');
}

// TASK 672: POLYGON FRAME, frame-calc's polygon frame: a regular N-sided frame of boards. The outer polygon is frame-calc's (#core/frame-geometry.js
// regularPolygonVertices: P_0 on top, centred on the origin), the boards come from THE per-vertex frame engine (calculatePolygonFrameGeometry,
// frame-calc's calculateQuadFrameGeometry: the one engine every polygon frame uses) with ONE joint at every corner (Miter | CW-Through |
// CCW-Through). TASK 680: the INNER polygon is the Polygon tool's (construction, centred on the origin, its first corner straight above the
// centre: its sides equal, its radii equal), the boards are drawn on its corners through the one board path; every edge lies on the outer or
// the inner face of a board (2 N slanted carriers, carrierRules). Each outer corner on its corner's radius, the outer faces parallel to the
// inner ones (N - 1 of them: the last one follows), the outer side length and the thickness (the first board's two faces).
function buildPolygonFrame(d, p) {
  const N = Math.round(num(p.sides, 6)), side = num(p.sideLength, 300), t = num(p.thickness, 38);
  const joint = POLYGON_JOINT_TYPES.some((o) => o.value === p.joint) ? p.joint : 'Miter';
  const g = calculatePolygonFrameGeometry({ P: regularPolygonVertices(N, side), thick: t, joints: Array(N).fill(joint) });
  const n = g.P.length, user = (q) => [q.x, worldToUserY(q.y)];
  const C = d.pt(0, 0), V = d.pt(...user(g.Q[0]));
  const poly = ops.polygon(d.state, C, V, n, true); // the inner polygon (construction), its first corner Q_0
  d.anchor(C);
  const radial = (j) => poly.shapes.find((s) => s.isConstruction && s.joints[0] === C && s.joints[1] === j && !s.groupId);
  const nearest = (q) => [...new Set(poly.shapes.flatMap((s) => s.joints))].filter((j) => j !== C)
    .reduce((best, j) => { const a = d.pos(j), e = Math.hypot(a.x - q.x, a.y - q.y); return !best || e < best.e ? { j, e } : best; }, null).j;
  const Qj = g.Q.map(nearest);
  const board = drawBoards(d, g.boards.map((b) => [b.p1, b.p2, b.p3, b.p4]), g.Q.map((q, k) => ({ q, j: Qj[k] })));
  const carriers = [];
  for (const ring of [g.P, g.Q]) ring.forEach((q, k) => carriers.push({ a: q, b: ring[(k + 1) % n], axis: null })); // outer faces, then inner faces
  const cr = carrierRules(d, board, carriers), outer = cr.slice(0, n), inner = cr.slice(n);
  const Pj = g.P.map((q) => board.J(q));
  d.v(C, Qj[0]);
  Pj.forEach((j, k) => d.on(j, radial(Qj[k]).id));
  for (let k = 0; k + 1 < n; k++) d.parallel(outer[k].ref, inner[k].ref);
  d.dim(Pj[0], Pj[1], 'aligned', 1, 'side_length');
  d.gap(outer[0].ref, inner[0].ref, 1, 'thickness');
}

/**
 * THE bank. id: stable key; params: { key: spec } (the defaults build() uses; mm); build(d, params) draws the template's RECIPE on the drawing `d`
 * with the app's tool operations (TASK 680); buildTemplate() makes the document.
 * A param spec: { label, default, kind?, ... }. kind (default 'length'):
 *   'length' | 'angle'  a user parameter of the opened document (mm | deg), unless `atOpen: true` (chosen in the start modal only: no dimension
 *                       carries it, so a parameter could not drive it)
 *   'count'             a whole number chosen in the start modal only (min, max): it changes how many parts the drawing has
 *   'choice'            one of `options` ([{ value, label }]) chosen in the start modal only, shown by the `glyph` picker named there
 * `dimensions` is what the editor shows: the number of driving dimensions the drawing carries at its defaults (a test asserts it).
 */
export const TEMPLATES = [
  { id: 'slot', name: 'Slot', description: 'A straight slot with round ends: 10 mm wide, the two end centres 30 mm apart (40 mm overall).', params: { length: { label: 'Length', default: 40 }, width: { label: 'Width', default: 10 } }, dimensions: 2, build: buildSlot },
  { id: 'rounded-rectangle', name: 'Rounded rectangle', description: '60 by 40 mm with four 5 mm corner radii, all equal.', params: { width: { label: 'Width', default: 60 }, height: { label: 'Height', default: 40 }, radius: { label: 'Corner radius', default: 5 } }, dimensions: 6, build: buildRoundedRect },
  { id: 'keyhole', name: 'Keyhole', description: 'A 20 mm round head on a 8 mm neck with a round end, 35 mm deep.', params: { radius: { label: 'Head radius', default: 10 }, neck: { label: 'Neck width', default: 8 }, depth: { label: 'Depth', default: 35 } }, dimensions: 3, build: buildKeyhole },
  { id: 'hexagon', name: 'Hexagon', description: 'A regular hexagon, 20 mm across the flats (a nut or a bolt head).', params: { acrossFlats: { label: 'Across flats', default: 20 } }, dimensions: 1, build: buildHexagon },
  { id: 'star', name: 'Star', description: 'A five-point star, 25 mm outer and 10 mm inner radius.', params: { outer: { label: 'Outer radius', default: 25 }, inner: { label: 'Inner radius', default: 10 } }, dimensions: 2, build: buildStar },
  { id: 'arrow', name: 'Arrow', description: 'A straight arrow: 40 mm by 10 mm shaft and a 20 mm long, 30 mm wide head.', params: { shaftLength: { label: 'Shaft length', default: 40 }, shaftWidth: { label: 'Shaft width', default: 10 }, headLength: { label: 'Head length', default: 20 }, headWidth: { label: 'Head width', default: 30 } }, dimensions: 4, build: buildArrow },
  { id: 'l-bracket', name: 'L-bracket', description: 'A 60 by 50 mm L-bracket, 10 mm thick, with two 5 mm holes.', params: { width: { label: 'Width', default: 60 }, height: { label: 'Height', default: 50 }, thickness: { label: 'Thickness', default: 10 }, holeDiameter: { label: 'Hole diameter', default: 5 } }, dimensions: 9, build: buildLBracket },
  { id: 'bolt-circle', name: 'Bolt circle', description: 'A 60 mm disc with six 6 mm holes on a 40 mm bolt circle.', params: { outerRadius: { label: 'Disc radius', default: 30 }, boltRadius: { label: 'Bolt circle radius', default: 20 }, holeRadius: { label: 'Hole radius', default: 3 } }, dimensions: 3, build: buildBoltCircle },
  { id: 'finger-edge', name: 'Finger-joint edge', description: 'The tabbed edge of a box panel: five 10 mm tabs, 5 mm deep.', params: { tabWidth: { label: 'Tab width', default: 10 }, gapWidth: { label: 'Gap width', default: 10 }, depth: { label: 'Depth', default: 5 } }, dimensions: 3, build: buildFingerEdge },
  { id: 'dog-bone-pocket', name: 'Dog-bone pocket', description: 'A 60 by 40 mm pocket with a diagonal dog-bone relief in each corner for a 1/4 inch (6.35 mm) bit.', params: { width: { label: 'Width', default: 60 }, height: { label: 'Height', default: 40 }, bitDiameter: { label: 'Bit diameter', default: 6.35 } }, dimensions: 6, build: buildDogBone },
  { id: 't-slot', name: 'T-slot', description: 'A T-track slot profile: 19 mm wide and 9.5 mm deep over a 25 mm wide slot, 16 mm deep in all.', params: { topWidth: { label: 'Top width', default: 19 }, topDepth: { label: 'Top depth', default: 9.5 }, bottomWidth: { label: 'Bottom width', default: 25 }, totalDepth: { label: 'Total depth', default: 16 } }, dimensions: 4, build: buildTSlot },
  { id: 'butterfly-key', name: 'Butterfly key', description: 'A bow-tie key: 50 mm long, 25 mm wide at the ends, 10 mm at the waist.', params: { length: { label: 'Length', default: 50 }, endWidth: { label: 'End width', default: 25 }, waistWidth: { label: 'Waist width', default: 10 } }, dimensions: 3, build: buildButterflyKey },
  { id: 'cup-hinge-bore', name: 'Cup hinge bore', description: 'A 35 mm hinge cup hole with two 8 mm screw holes 45 mm apart, 9.5 mm from the cup centre.', params: { cupDiameter: { label: 'Cup diameter', default: 35 }, screwSpacing: { label: 'Screw spacing', default: 45 }, screwOffset: { label: 'Screw line offset', default: 9.5 }, screwDiameter: { label: 'Screw diameter', default: 8 } }, dimensions: 4, build: buildCupHinge },
  { id: 'shelf-pin-row', name: 'Shelf-pin row', description: 'Five 5 mm holes on 32 mm centres (the 32 mm cabinet system): one hole and a rectangular pattern.', params: { count: { label: 'Holes', default: 5, kind: 'count', min: 2, max: 100 }, spacing: { label: 'Spacing', default: 32, atOpen: true }, holeDiameter: { label: 'Hole diameter', default: 5 } }, dimensions: 1, build: buildShelfPins },
  { id: 'box-frame', name: 'Box frame (front view)', description: 'A plywood cubby carcass from the front: two full-length sides, two ends and dividers between them, 5 equal compartments.', params: { length: { label: 'Overall length', default: 1500 }, width: { label: 'Width', default: 400 }, thickness: { label: 'Plywood thickness', default: 18 }, compartments: { label: 'Compartments', default: 5, kind: 'count', min: 1, max: 100 }, layout: { label: 'Layout', default: 'Vertical', kind: 'choice', options: BOX_FRAME_LAYOUTS, glyph: 'box-layout' }, joint: { label: 'Corner joint', default: 'V-Through', kind: 'choice', options: CORNER_JOINT_TYPES, glyph: 'box-corner-joint' } }, dimensions: 14, build: buildBoxFrame },
  { id: 'right-angle-corner', name: 'Right-angle frame corner', description: 'Two 18 mm boards meeting at 90 degrees, 300 and 200 mm long: mitered, or one board running through.', params: { horizontalLength: { label: 'Horizontal length', default: 300 }, verticalLength: { label: 'Vertical length', default: 200 }, thickness: { label: 'Board thickness', default: 18 }, joint: { label: 'Corner joint', default: 'H-Through', kind: 'choice', options: CORNER_JOINT_TYPES, glyph: 'corner-joint' } }, dimensions: 4, build: buildRightAngleCorner },
  // TASK 672
  { id: 'stair-stringer', name: 'Stair stringer', description: 'A cut stringer from one 286 mm board: 4 steps of 180 rise and 250 run, a plumb cut at the top, a level cut on the floor, 125 mm throat.', params: { steps: { label: 'Steps', default: 4, kind: 'count', min: 2, max: 30 }, rise: { label: 'Rise', default: 180 }, run: { label: 'Run', default: 250 }, boardWidth: { label: 'Board width', default: 286 }, throat: { label: 'Throat', default: 125 } }, dimensions: 4, build: buildStringer },
  { id: 'curved-bench-seat', name: 'Curved bench seat', description: 'A 60 degree ring segment, 900 and 450 mm radii, split into 8 identical tapered slats with 10 mm gaps.', params: { slats: { label: 'Slats', default: 8, kind: 'count', min: 2, max: 40 }, outerRadius: { label: 'Outer radius', default: 900 }, innerRadius: { label: 'Inner radius', default: 450 }, sweepAngle: { label: 'Sweep angle', default: 60, kind: 'angle' }, gap: { label: 'Gap', default: 10 } }, dimensions: 10, build: buildBenchSeat },
  { id: 'right-angle-brace', name: 'Right-angle brace', description: 'A right-angle frame with its diagonal brace: 300 wide, 600 tall, 38 mm boards, a joint at each corner.', params: { width: { label: 'Width', default: 300 }, height: { label: 'Height', default: 600 }, thickV: { label: 'Vertical board thickness', default: 38 }, thickH: { label: 'Horizontal board thickness', default: 38 }, thickD: { label: 'Diagonal board thickness', default: 38 }, topJoint: { label: 'Top joint', default: 'V-Through', kind: 'choice', options: BRACE_JOINTS.top, glyph: 'brace-top' }, blJoint: { label: 'Bottom-left joint', default: 'V-Through', kind: 'choice', options: BRACE_JOINTS.bl, glyph: 'brace-bl' }, brJoint: { label: 'Bottom-right joint', default: 'H-Through', kind: 'choice', options: BRACE_JOINTS.br, glyph: 'brace-br' } }, dimensions: 5, build: buildBrace },
  { id: 'polygon-frame', name: 'Polygon frame', description: 'A regular 6-sided frame of 38 mm boards, 300 mm sides, one joint at every corner.', params: { sides: { label: 'Sides', default: 6, kind: 'count', min: 3, max: 12 }, sideLength: { label: 'Side length', default: 300 }, thickness: { label: 'Board thickness', default: 38 }, joint: { label: 'Corner joint', default: 'Miter', kind: 'choice', options: POLYGON_JOINT_TYPES, glyph: 'polygon-joint' } }, dimensions: 2, build: buildPolygonFrame },
];

/** The default parameters of a template: { key: default }. */
export const defaultParams = (t) => Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, v.default]));

// ── TASK 670: the params as data for the start modal and the document's user parameters ──
export const paramKind = (spec) => spec.kind || 'length';
/** A param that opens as a USER PARAMETER of the document (a length or an angle a dimension formula reads). */
export const isLiveParam = (spec) => (paramKind(spec) === 'length' || paramKind(spec) === 'angle') && !spec.atOpen;
/** The user parameter's name for a param key: camelCase -> snake_case (bitDiameter -> bit_diameter), a name the expression parser accepts. */
export const paramName = (key) => key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
/** The unit a param is shown and stored in: mm for a length, deg for an angle, none for a count or a choice. */
export const paramUnit = (spec) => ({ length: 'mm', angle: 'deg' })[paramKind(spec)] || '';

/** Why `value` cannot be this param's value (the start modal shows it), or null. */
export function paramRefusal(spec, value) {
  const kind = paramKind(spec);
  if (kind === 'choice') return spec.options.some((o) => o.value === value) ? null : `${spec.label}: pick one of the options`;
  const v = Number(value);
  if (kind === 'count') {
    if (!Number.isInteger(v)) return `${spec.label} must be a whole number`;
    if (v < spec.min || v > spec.max) return `${spec.label} must be from ${spec.min} to ${spec.max}`;
    return null;
  }
  return Number.isFinite(v) && v > 0 ? null : `${spec.label} must be a number more than 0`;
}

/**
 * Build a template's document with its default parameters (or `params` over them): TASK 680, its RECIPE on a fresh sketch of its own: the user
 * parameters first (the Parameters window's + Add row, in declaration order: { name, unit, expression: '<value> <unit>', comment: label }), then
 * the drawing with the app's tools, its dimensions' texts reading those parameters, and the document through serializeDocument. A value the
 * param refuses (paramRefusal) throws: the start modal checks every value before it opens a template. Values the tools cannot draw (a step
 * refused, e.g. boards thicker than the length leaves) throw "<name> cannot be drawn with these values (<the tool's reason>)".
 */
export function buildTemplate(t, params = {}) {
  const values = { ...defaultParams(t), ...params };
  for (const [k, spec] of Object.entries(t.params)) {
    const why = paramRefusal(spec, values[k]);
    if (why) throw new Error(`template ${t.id}: ${why}`);
    if (paramKind(spec) !== 'choice') values[k] = R(Number(values[k])); // the drawing and its parameter read the SAME number
  }
  const d = drawing();
  for (const [k, spec] of Object.entries(t.params)) {
    if (!isLiveParam(spec)) continue;
    const unit = paramUnit(spec);
    ops.parameter(d.state, paramName(k), unit, `${values[k]} ${unit}`, spec.label);
  }
  try {
    t.build(d, values);
  } catch (e) { // a tool refused a step (e.g. a dimension that would collapse a board): these values make no drawing
    throw new Error(`${t.name} cannot be drawn with these values (${e.message})`, { cause: e });
  }
  return d.finish();
}
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;
