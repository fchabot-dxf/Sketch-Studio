// packages/core/templates.js -- TASK 651: the BANK of template drawings, DECLARED as data. PURE, no DOM.
//
// A template is { id, name, description, params, build(params) }. build() returns a version-3 project document (serializeDocument's shape) made
// with the existing shape builders (makePolygon, makeArc) and the ordinary constraint records, so a template opens as a normal drawing:
// every one is FULLY DIMENSIONED (driving dimensions, fixed by the origin anchor) and editable after it opens.
//
// UNITS: templates are authored in mm = world units (units.js BASE). A document's unit (mm | cm | in) is a display lens over the same world
// values, so a template opens at the same physical size in an inch document; there is no conversion here.
// ORIENTATION: authored with Y UP (as the user sees it) and stored through userToWorldY (the one Y seam).
// ANCHOR: each template has one joint tied to the origin (a `coincident` with j_origin) so the drawing is fully constrained; it sits at (0, 0).
// PARAMETERS (TASK 670): a template's LENGTH / ANGLE params open as the document's USER PARAMETERS (the Parameters table: name = paramName(key),
// expression = the value in mm / deg, comment = the label), made by #core/parameters.js planChange (the ONE parameter model), and every driving
// dimension is a FORMULA of them (its `expression`), so changing a parameter later goes through the existing parameter -> dimension -> solve path.
// COUNT / CHOICE params (and a length declared `atOpen`) are chosen in the start modal only: they change the topology (how many boards, which joint)
// or a value no dimension carries (a pattern's spacing), so a user parameter could not drive them and none is made.

import { serializeDocument } from '#core/document.js';
import { makeArc, makePolygon } from '#core/shapes.js';
import { userToWorldY, worldToUserY } from '#core/units.js';
import { ORIGIN_JOINT_ID, CONSTRAINT_TYPES } from '#core/constants.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';
import { planChange, nextDimensionName } from '#core/parameters.js';
import { cornerBoards, cornerJointPoints, CORNER_JOINT_TYPES } from '#core/corner-joint.js';
import { calculateFramingGeometry, calculatePolygonFrameGeometry, regularPolygonVertices, BRACE_JOINTS, POLYGON_JOINT_TYPES } from '#core/frame-geometry.js';

const R = (v) => Math.round(v * 1e6) / 1e6;

// One small sketch builder: joints in user coordinates, shapes and constraints as plain records.
function sketcher(id) {
  const joints = new Map(), shapes = [], constraints = [];
  let jn = 0, sn = 0;
  const named = (c, expr) => { const d = { ...c, name: nextDimensionName(constraints) }; if (expr) d.expression = expr; constraints.push(d); return d.name; };
  const genJ = () => `jt${++jn}`;
  const sid = (k) => `st_${id}_${++sn}_${k}`;
  const b = {
    joints, shapes, constraints, genJ,
    pt(x, y) { const j = genJ(); joints.set(j, { x: R(x), y: R(userToWorldY(y)), fixed: false }); return j; },
    at(j) { const p = joints.get(j); return { x: p.x, y: userToWorldY(p.y) }; },
    line(a, c, construction = false) { const s = sid('line'); shapes.push({ id: s, type: 'line', joints: [a, c], isConstruction: construction }); return s; },
    // an arc about `c` from `a` to `e`, counter-clockwise AS THE USER SEES IT (makeArc adds the equal-radius rule of its rim points)
    arc(c, a, e) {
      const built = makeArc(joints, c, a, e, 'CENTER');
      const s = built.shapes[0]; s.id = sid('arc'); s.sweep = false; // sweep false = negative world angle = counter-clockwise on screen (Y-down world)
      shapes.push(s); constraints.push(...built.constraints);
      return s.id;
    },
    circle(c, r, construction = false) { const s = sid('circle'); shapes.push({ id: s, type: 'circle', joints: [c], radius: r, isConstruction: construction }); return s; },
    h(a, c) { constraints.push({ type: 'horizontal', joints: [a, c] }); },
    v(a, c) { constraints.push({ type: 'vertical', joints: [a, c] }); },
    equalShapes(chain) { for (let i = 0; i + 1 < chain.length; i++) constraints.push({ type: 'equal', shapes: [chain[i], chain[i + 1]] }); },
    equalLengths(chain) { for (let i = 0; i + 1 < chain.length; i++) constraints.push({ type: 'equal', joints: [...chain[i], ...chain[i + 1]] }); }, // chain of [a, b] pairs
    pointOn(j, shape) { constraints.push({ type: 'pointOnLine', joint: j, shape }); },
    midpoint(m, a, c) { constraints.push({ type: 'midpoint', joints: [a, c, m] }); },
    parallel(s1, s2) { constraints.push({ type: 'parallel', shapes: [s1, s2] }); }, // TASK 672
    // TASK 672: a driving ANGLE dimension (degrees) from line s1's direction to line s2's, counter-clockwise in the world (#core/angle-sector.js:
    // the default sector, stored so a load measures this one)
    angle(s1, s2, value, offset = 40, expr) { return named({ type: 'angle', shapes: [s1, s2], value: R(value), offset, sector: { ray1: 1, ray2: 1, turn: 1 }, isDriven: false, driven: false }, expr); },
    // driving dimensions: mode 'aligned' | 'horizontal' | 'vertical'; offset = where the label sits (mm from the geometry); expr = its formula
    // (TASK 670: every template dimension has one, of the user parameters or of an earlier dimension; `value` is what it gives at the built
    // values). Each is NAMED here (d1, d2, ... in order: the names a load would give) so a formula can read an earlier one; each returns its name.
    dim(a, c, value, mode = 'aligned', offset = 8, expr) { return named({ type: 'distance', joints: [a, c], value: R(value), dimMode: mode, offset, isDriven: false, driven: false }, expr); },
    radius(shape, value, offset = 8, expr) { return named({ type: 'distance', shape, value: R(value), isRadius: true, offset, isDriven: false, driven: false }, expr); },
    gap(s1, s2, value, offset = 8, expr) { return named({ type: 'distance', shapes: [s1, s2], value: R(value), offset, isDriven: false, driven: false }, expr); },
    // the anchor: `j` goes to (0, 0) (everything moves with it) and is tied to the origin
    finish(j) {
      const p = joints.get(j);
      const dx = p.x, dy = p.y;
      for (const q of joints.values()) { q.x = R(q.x - dx); q.y = R(q.y - dy); }
      constraints.push({ type: 'coincident', joints: [j, ORIGIN_JOINT_ID] });
      return serializeDocument({ joints, shapes, constraints, parameters: [] });
    },
  };
  return b;
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// ── TASK 672: BOARD sketches (the frame templates), one path from board outlines to a sketch and its rules ──────────────────────────────────
const NEAR = 1e-6; // two corners closer than this (mm) are ONE point (a frame engine computes a shared corner twice, a float apart)
// Board OUTLINES (world polygons: frame-calc's frame, Y down) -> the sketch: every polygon corner is ONE joint, every edge is split at the
// corners lying on it and each piece is drawn ONCE (a seam two boards share is one line). (Task 670's right-angle corner, made reusable.)
// -> { J(q): the joint at a world point, corners: [{ q, j }], pieces: [{ a, b, shape }] (a, b: corners; in drawing order) }
function drawBoards(s, polys) {
  const corners = [];
  const find = (q) => corners.find((c) => Math.abs(c.q.x - q.x) < NEAR && Math.abs(c.q.y - q.y) < NEAR);
  for (const poly of polys) for (const q of poly) if (!find(q)) corners.push({ q, j: s.pt(q.x, worldToUserY(q.y)) });
  const pieces = [], drawn = new Set();
  for (const poly of polys) poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const on = corners.map((c) => ({ c, u: ((c.q.x - a.x) * dx + (c.q.y - a.y) * dy) / (len * len), off: Math.abs((c.q.x - a.x) * dy - (c.q.y - a.y) * dx) / len }))
      .filter((o) => o.off < NEAR && o.u > -NEAR / len && o.u < 1 + NEAR / len).sort((u, v) => u.u - v.u); // the joints ON this edge, from a to b
    for (let k = 0; k + 1 < on.length; k++) {
      const u = on[k].c, v = on[k + 1].c, id = [u.j, v.j].sort().join('|');
      if (drawn.has(id)) continue; // the shared seam: drawn once
      drawn.add(id);
      pieces.push({ a: u, b: v, shape: s.line(u.j, v.j) });
    }
  });
  return { J: (q) => find(q).j, corners, pieces };
}
// The RULES of a board sketch, from its CARRIER lines: every board edge lies on one (a frame's outer and inner faces), and every corner sits
// where two carriers cross, so holding each corner on its carriers leaves only the carriers to place (the template's dimensions and parallels).
// A carrier declared 'h' / 'v' chains its corners, in order along it, with horizontal / vertical rules (k - 1 rules for k corners: the carrier
// keeps one freedom, its offset); a free (slanted) carrier keeps two (offset and angle): its first drawn piece is its REFERENCE line and every
// other corner on it is a point-on-line of that piece (k - 2 rules). carriers: [{ a, b, axis: 'h' | 'v' | null }] (world points, a != b).
// -> per carrier { corners (in order along it), ref (the reference piece's shape id) }
function carrierRules(s, board, carriers) {
  return carriers.map((cr) => {
    const dx = cr.b.x - cr.a.x, dy = cr.b.y - cr.a.y, len = Math.hypot(dx, dy);
    const onIt = (q) => Math.abs((q.x - cr.a.x) * dy - (q.y - cr.a.y) * dx) / len < NEAR;
    const along = (q) => (q.x - cr.a.x) * dx + (q.y - cr.a.y) * dy;
    const corners = board.corners.filter((c) => onIt(c.q)).sort((u, v) => along(u.q) - along(v.q));
    const ref = board.pieces.find((p) => onIt(p.a.q) && onIt(p.b.q));
    if (cr.axis) for (let i = 0; i + 1 < corners.length; i++) (cr.axis === 'h' ? s.h : s.v)(corners[i].j, corners[i + 1].j);
    else for (const c of corners) if (c !== ref.a && c !== ref.b) s.pointOn(c.j, ref.shape);
    return { corners, ref: ref && ref.shape };
  });
}

// ── the bank ────────────────────────────────────────────────────────────────────────────────────────────────────
function buildSlot(p) {
  const L = num(p.length, 40), W = num(p.width, 10), r = W / 2, d = L - W; // d = centre-to-centre distance of the two ends
  const s = sketcher('slot');
  const CL = s.pt(0, 0), CR = s.pt(d, 0);
  const TL = s.pt(0, r), BL = s.pt(0, -r), TR = s.pt(d, r), BR = s.pt(d, -r);
  s.line(TL, TR); s.line(BL, BR);
  s.arc(CL, TL, BL); s.arc(CR, BR, TR);
  s.h(TL, TR); s.h(BL, BR); s.v(CL, TL); s.v(CL, BL); s.v(CR, TR); s.v(CR, BR);
  s.dim(TL, BL, W, 'vertical', -7, 'width');
  s.dim(CL, CR, d, 'horizontal', -r - 4, 'length - width');
  return s.finish(CL);
}

function buildRoundedRect(p) {
  const w = num(p.width, 60), h = num(p.height, 40), r = num(p.radius, 5);
  const s = sketcher('rrect');
  const corner = (cx, cy, ax, ay, bx, by) => ({ c: s.pt(cx, cy), a: s.pt(ax, ay), b: s.pt(bx, by) });
  const x0 = r, x1 = w - r, y0 = r, y1 = h - r;
  const bl = corner(x0, y0, x0, 0, 0, y0), br = corner(x1, y0, x1, 0, w, y0), tr = corner(x1, y1, x1, h, w, y1), tl = corner(x0, y1, x0, h, 0, y1);
  s.line(tl.a, tr.a); s.line(tr.b, br.b); s.line(br.a, bl.a); s.line(bl.b, tl.b);
  const arcs = [s.arc(tl.c, tl.a, tl.b), s.arc(bl.c, bl.b, bl.a), s.arc(br.c, br.a, br.b), s.arc(tr.c, tr.b, tr.a)];
  s.h(tl.a, tr.a); s.h(br.a, bl.a); s.v(tr.b, br.b); s.v(bl.b, tl.b);
  for (const k of [tl, tr, bl, br]) { s.v(k.c, k.a); s.h(k.c, k.b); }
  s.equalLengths([[tl.c, tl.a], [tr.c, tr.a], [br.c, br.a], [bl.c, bl.a]]);
  s.radius(arcs[0], r, 10, 'radius');
  s.dim(tl.b, tr.b, w, 'horizontal', -5, 'width');
  s.dim(tl.a, bl.a, h, 'vertical', -6, 'height');
  return s.finish(bl.c);
}

function buildKeyhole(p) {
  const R0 = num(p.radius, 10), neck = num(p.neck, 8), depth = num(p.depth, 35);
  const s = sketcher('keyhole');
  const hw = neck / 2, ph = Math.sqrt(Math.max(R0 * R0 - hw * hw, 0));
  const CB = s.pt(0, 0), P1 = s.pt(hw, -ph), P2 = s.pt(-hw, -ph);
  const Q1 = s.pt(hw, -depth), Q2 = s.pt(-hw, -depth), CS = s.pt(0, -depth);
  const big = s.arc(CB, P1, P2); // from the right shoulder up and over the top (counter-clockwise) to the left shoulder
  s.line(P2, Q2); s.line(P1, Q1);
  s.arc(CS, Q2, Q1); // the rounded end of the neck, round the bottom
  s.h(P1, P2); s.v(P1, Q1); s.v(P2, Q2); s.h(CS, Q1); s.h(Q1, Q2);
  s.radius(big, R0, 12, 'radius'); s.dim(P1, P2, neck, 'horizontal', 6, 'neck'); s.dim(CB, CS, depth, 'vertical', 14, 'depth');
  return s.finish(CB);
}

function buildHexagon(p) {
  const af = num(p.acrossFlats, 20), rc = af / 2 / Math.cos(Math.PI / 6);
  const s = sketcher('hex');
  const C = s.pt(0, 0), V = s.pt(rc, 0);
  const built = makePolygon(s.joints, C, V, 6, s.genJ);
  s.shapes.push(...built.shapes); s.constraints.push(...built.constraints);
  const sides = built.shapes.filter((x) => !x.isConstruction);
  // the polygon's first corner is on the right, so side 1 (60 to 120 degrees) is the flat on top and side 4 the one at the bottom
  s.h(sides[1].joints[0], sides[1].joints[1]);
  s.gap(sides[1].id, sides[4].id, af, 8, 'across_flats');
  return s.finish(C);
}

function buildStar(p) {
  const Ro = num(p.outer, 25), Ri = num(p.inner, 10);
  const s = sketcher('star');
  const C = s.pt(0, 0), o = [], ii = [], radO = [], radI = [];
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + k * 2 * Math.PI / 5, b = a + Math.PI / 5;
    o.push(s.pt(Ro * Math.cos(a), Ro * Math.sin(a)));
    ii.push(s.pt(Ri * Math.cos(b), Ri * Math.sin(b)));
  }
  const sides = [];
  for (let k = 0; k < 5; k++) { sides.push(s.line(o[k], ii[k])); sides.push(s.line(ii[k], o[(k + 1) % 5])); }
  for (let k = 0; k < 5; k++) { radO.push(s.line(C, o[k], true)); radI.push(s.line(C, ii[k], true)); }
  s.equalShapes(radO); s.equalShapes(radI); s.equalShapes(sides);
  s.v(C, o[0]);
  s.dim(C, o[0], Ro, 'aligned', 8, 'outer'); s.dim(C, ii[0], Ri, 'aligned', -8, 'inner');
  return s.finish(C);
}

function buildArrow(p) {
  const shaftL = num(p.shaftLength, 40), shaftW = num(p.shaftWidth, 10), headL = num(p.headLength, 20), headW = num(p.headWidth, 30);
  const s = sketcher('arrow');
  const M = s.pt(0, 0), S = s.pt(-shaftL, 0);
  const P0 = s.pt(-shaftL, shaftW / 2), P1 = s.pt(0, shaftW / 2), P2 = s.pt(0, headW / 2), P3 = s.pt(headL, 0);
  const P4 = s.pt(0, -headW / 2), P5 = s.pt(0, -shaftW / 2), P6 = s.pt(-shaftL, -shaftW / 2);
  const ring = [P0, P1, P2, P3, P4, P5, P6];
  ring.forEach((j, i) => s.line(j, ring[(i + 1) % ring.length]));
  s.h(P0, P1); s.h(P5, P6); s.v(P0, P6); s.v(P1, P2); s.v(P4, P5); s.v(P2, P4);
  s.midpoint(M, P2, P4); s.midpoint(S, P0, P6); s.h(S, M); s.h(M, P3);
  s.dim(P0, P6, shaftW, 'vertical', -8, 'shaft_width'); s.dim(P0, P1, shaftL, 'horizontal', 12, 'shaft_length'); s.dim(P2, P4, headW, 'vertical', 12, 'head_width'); s.dim(M, P3, headL, 'horizontal', -headW / 2 - 6, 'head_length');
  return s.finish(M);
}

function buildLBracket(p) {
  const w = num(p.width, 60), h = num(p.height, 50), t = num(p.thickness, 10), hd = num(p.holeDiameter, 5);
  const s = sketcher('lbracket');
  const P0 = s.pt(0, 0), P1 = s.pt(w, 0), P2 = s.pt(w, t), P3 = s.pt(t, t), P4 = s.pt(t, h), P5 = s.pt(0, h);
  const ring = [P0, P1, P2, P3, P4, P5];
  ring.forEach((j, i) => s.line(j, ring[(i + 1) % ring.length]));
  s.h(P0, P1); s.v(P1, P2); s.h(P2, P3); s.v(P3, P4); s.h(P4, P5); s.v(P5, P0);
  s.dim(P0, P1, w, 'horizontal', -8, 'width'); s.dim(P0, P5, h, 'vertical', -8, 'height'); s.dim(P1, P2, t, 'vertical', 8, 'thickness'); s.dim(P5, P4, t, 'horizontal', 8, 'thickness');
  const c1 = s.pt(w - t, t / 2), c2 = s.pt(t / 2, h - t);
  const k1 = s.circle(c1, hd / 2), k2 = s.circle(c2, hd / 2);
  s.dim(P0, c1, w - t, 'horizontal', 8 + t, 'width - thickness'); s.dim(P0, c1, t / 2, 'vertical', -14, 'thickness / 2');
  s.dim(P0, c2, t / 2, 'horizontal', -14, 'thickness / 2'); s.dim(P0, c2, h - t, 'vertical', 8 + t, 'height - thickness');
  s.radius(k1, hd / 2, 6, 'hole_diameter / 2'); s.equalShapes([k1, k2]);
  return s.finish(P0);
}

function buildBoltCircle(p) {
  const Ro = num(p.outerRadius, 30), Rb = num(p.boltRadius, 20), hr = num(p.holeRadius, 3);
  const s = sketcher('bolt');
  const C = s.pt(0, 0);
  const outer = s.circle(C, Ro), bolt = s.circle(C, Rb, true);
  const holes = [], centres = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + k * Math.PI / 3, c = s.pt(Rb * Math.cos(a), Rb * Math.sin(a));
    centres.push(c); holes.push(s.circle(c, hr)); s.pointOn(c, bolt);
  }
  const chords = centres.map((c, k) => s.line(c, centres[(k + 1) % 6], true));
  s.equalShapes(chords); s.equalShapes(holes); s.v(C, centres[0]);
  s.radius(outer, Ro, 6, 'outer_radius'); s.radius(bolt, Rb, 6, 'bolt_radius'); s.radius(holes[0], hr, 4, 'hole_radius');
  return s.finish(C);
}

function buildFingerEdge(p) {
  const tab = num(p.tabWidth, 10), gap = num(p.gapWidth, 10), depth = num(p.depth, 5), n = 5;
  const s = sketcher('fingers');
  const pitch = tab + gap, top = [], low = [], tabs = [], gaps = [], verts = [];
  let first = null, prev = null;
  const line = (a, c) => s.line(a, c);
  for (let i = 0; i < n; i++) {
    const x = i * pitch, a = s.pt(x, depth), c = s.pt(x + tab, depth);
    if (!first) first = a;
    if (prev) { verts.push(line(prev, a)); s.v(prev, a); }
    tabs.push(line(a, c)); s.h(a, c); top.push([a, c]);
    if (i < n - 1) {
      const d = s.pt(x + tab, 0), e = s.pt(x + pitch, 0);
      verts.push(line(c, d)); s.v(c, d);
      gaps.push(line(d, e)); s.h(d, e); low.push([d, e]);
      prev = e;
    }
  }
  s.equalShapes(tabs); s.equalShapes(gaps); s.equalShapes(verts);
  s.dim(top[0][0], top[0][1], tab, 'horizontal', 8, 'tab_width');
  s.dim(low[0][0], low[0][1], gap, 'horizontal', -8, 'gap_width');
  s.dim(top[0][1], low[0][0], depth, 'vertical', 8, 'depth');
  return s.finish(first);
}

// TASK 669: DOG-BONE POCKET. The classic DIAGONAL dog-bone: at each inside corner C the relief circle (the bit's radius r) has its centre K on the
// corner's diagonal, r inside the corner, so the circle PASSES THROUGH C and crosses the two walls 2a = sqrt(2) r from C (a = r / sqrt(2)): the
// two crossing points H (on the horizontal wall) and V (on the vertical wall) are opposite ends of a diameter, so the relief is a HALF circle
// bulging past the corner. One closed loop: wall line, half-circle arc, wall line, ... The corner C itself is a construction point (it gives the
// 45 degree rule: construction |CH| = |CV|, and |KC| = |KH| puts C on the circle); it is the origin anchor of the bottom left corner.
function buildDogBone(p) {
  const w = num(p.width, 60), h = num(p.height, 40), d = num(p.bitDiameter, 6.35), r = d / 2, a = r / Math.SQRT2;
  const s = sketcher('dogbone');
  const corner = (cx, cy, ix, iy) => {
    const C = s.pt(cx, cy), K = s.pt(cx + a * ix, cy + a * iy), H = s.pt(cx + 2 * a * ix, cy), V = s.pt(cx, cy + 2 * a * iy);
    const ang = (j) => { const q = s.at(j), k = s.at(K); return Math.atan2(q.y - k.y, q.x - k.x); };
    const TAU = 2 * Math.PI, mod = (x) => ((x % TAU) + TAU) % TAU;
    // the counter-clockwise arc (as the user sees it) that passes through C: from H to V if that sweep contains C, else from V to H
    const cIn = mod(ang(C) - ang(H)) < mod(ang(V) - ang(H));
    const arc = cIn ? s.arc(K, H, V) : s.arc(K, V, H);
    s.h(C, H); s.v(C, V);
    const cH = s.line(C, H, true), cV = s.line(C, V, true);
    s.equalShapes([cH, cV]);
    s.equalLengths([[K, C], [K, H]]);
    return { C, K, H, V, arc };
  };
  const bl = corner(0, 0, 1, 1), br = corner(w, 0, -1, 1), tr = corner(w, h, -1, -1), tl = corner(0, h, 1, -1);
  s.line(bl.H, br.H); s.line(br.V, tr.V); s.line(tr.H, tl.H); s.line(tl.V, bl.V);
  s.h(bl.H, br.H); s.v(br.V, tr.V); s.h(tr.H, tl.H); s.v(tl.V, bl.V);
  s.equalLengths([[bl.K, bl.H], [br.K, br.H], [tr.K, tr.H], [tl.K, tl.H]]);
  s.radius(bl.arc, r, 10, 'bit_diameter / 2');
  s.dim(bl.V, br.V, w, 'horizontal', -12, 'width');
  s.dim(bl.H, tl.H, h, 'vertical', -12, 'height');
  return s.finish(bl.C);
}

// TASK 669: T-SLOT, the 2D profile of a T-track slot (opening up at the top, centred on the origin): a 19 mm wide slot 9.5 mm deep (3/4 inch
// T-track) over a 25 mm wide slot, 16 mm deep in all. The origin is the middle of the opening (the closing edge at the top).
function buildTSlot(p) {
  const tw = num(p.topWidth, 19), td = num(p.topDepth, 9.5), bw = num(p.bottomWidth, 25), D = num(p.totalDepth, 16);
  const s = sketcher('tslot');
  const TL = s.pt(-tw / 2, 0), TR = s.pt(tw / 2, 0), NR = s.pt(tw / 2, -td), OR = s.pt(bw / 2, -td), BR = s.pt(bw / 2, -D), BL = s.pt(-bw / 2, -D), OL = s.pt(-bw / 2, -td), NL = s.pt(-tw / 2, -td);
  const ring = [TL, TR, NR, OR, BR, BL, OL, NL];
  ring.forEach((j, i) => s.line(j, ring[(i + 1) % ring.length]));
  s.h(TL, TR); s.v(TR, NR); s.h(NR, OR); s.v(OR, BR); s.h(BR, BL); s.v(BL, OL); s.h(OL, NL); s.v(NL, TL); s.h(NR, NL);
  const M = s.pt(0, 0), Mb = s.pt(0, -D);
  s.midpoint(M, TL, TR); s.midpoint(Mb, BL, BR); s.v(M, Mb);
  s.dim(TL, TR, tw, 'horizontal', 6, 'top_width'); s.dim(TR, NR, td, 'vertical', 6, 'top_depth'); s.dim(OL, OR, bw, 'horizontal', -6, 'bottom_width'); s.dim(TR, BR, D, 'vertical', 16, 'total_depth');
  return s.finish(M);
}

// TASK 669: BUTTERFLY KEY (bow-tie / dovetail key), centred on its waist: 50 mm long, 25 mm wide at the two ends, 10 mm at the waist, straight sides.
function buildButterflyKey(p) {
  const L = num(p.length, 50), ew = num(p.endWidth, 25), ww = num(p.waistWidth, 10);
  const s = sketcher('butterfly');
  const P0 = s.pt(-L / 2, ew / 2), P1 = s.pt(0, ww / 2), P2 = s.pt(L / 2, ew / 2), P3 = s.pt(L / 2, -ew / 2), P4 = s.pt(0, -ww / 2), P5 = s.pt(-L / 2, -ew / 2);
  const ring = [P0, P1, P2, P3, P4, P5];
  ring.forEach((j, i) => s.line(j, ring[(i + 1) % ring.length]));
  const W = s.pt(0, 0), EL = s.pt(-L / 2, 0), ER = s.pt(L / 2, 0);
  s.v(P2, P3); s.v(P5, P0); s.v(P1, P4);
  s.midpoint(W, P1, P4); s.midpoint(ER, P2, P3); s.midpoint(EL, P5, P0); s.midpoint(W, EL, ER); s.h(EL, ER);
  s.equalLengths([[P2, P3], [P5, P0]]);
  s.dim(EL, ER, L, 'horizontal', 6, 'length'); s.dim(P2, P3, ew, 'vertical', 8, 'end_width'); s.dim(P1, P4, ww, 'vertical', 6, 'waist_width');
  return s.finish(W);
}

// TASK 669: CUP HINGE BORE, the European cup-hinge layout: a 35 mm cup hole at the origin, and two 8 mm screw (dowel) holes 45 mm apart on a line
// 9.5 mm from the cup's centre (below it), centred on it. (The common layout; hinge makers vary, edit the dimensions for another.)
function buildCupHinge(p) {
  const cd = num(p.cupDiameter, 35), sp = num(p.screwSpacing, 45), off = num(p.screwOffset, 9.5), sd = num(p.screwDiameter, 8);
  const s = sketcher('cuphinge');
  const C = s.pt(0, 0), S1 = s.pt(-sp / 2, -off), S2 = s.pt(sp / 2, -off), M = s.pt(0, -off);
  const cup = s.circle(C, cd / 2), k1 = s.circle(S1, sd / 2), k2 = s.circle(S2, sd / 2);
  s.midpoint(M, S1, S2); s.v(C, M); s.h(S1, S2); s.equalShapes([k1, k2]);
  s.radius(cup, cd / 2, 8, 'cup_diameter / 2'); s.radius(k1, sd / 2, 6, 'screw_diameter / 2'); s.dim(S1, S2, sp, 'horizontal', -sd / 2 - 8, 'screw_spacing'); s.dim(C, M, off, 'vertical', -cd / 2 - 8, 'screw_offset');
  return s.finish(C);
}

// TASK 669: SHELF-PIN ROW: ONE source hole + ONE rectangular pattern constraint (pattern.js applyPattern, the app's own pattern, no new code: the
// builder calls it on its own joints / shapes / constraints). The copies follow the source (its radius dimension) and the pattern's spacing;
// count and spacing are the pattern's values, not sketch dimensions. 32 mm centres (the 32 mm cabinet system).
function buildShelfPins(p) {
  const n = Math.max(2, Math.round(num(p.count, 5))), sp = num(p.spacing, 32), hd = num(p.holeDiameter, 5);
  const s = sketcher('shelfpins');
  const c = s.pt(0, 0), hole = s.circle(c, hd / 2);
  s.radius(hole, hd / 2, 6, 'hole_diameter / 2');
  const made = applyPattern({ joints: s.joints, shapes: s.shapes, constraints: s.constraints }, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, { shapes: [hole], joints: [] },
    { ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [n, 1], distance: [sp, sp] });
  if (!made.ok) throw new Error('shelf-pin pattern: ' + made.reason);
  return s.finish(c);
}

// TASK 669: BOX FRAME (front view) of a plywood cubby / bookcase carcass, the long direction VERTICAL: two SIDE boards the FULL length, two END
// boards BETWEEN the sides, and N - 1 DIVIDERS between the sides, all t thick, splitting the inside into N equal compartments. The boards SHARE
// their edges (one line and one pair of joints per shared edge: no gaps, no overlaps). Joint grid: four x levels (0, t, W - t, W) and 2 (N + 1)
// y levels (the bottom and the top of the N + 1 cross boards); the inner columns carry a joint at every level. Every segment is horizontal / vertical.
// TASK 670 (no FOLD): every board thickness and every opening but the top one is a SIGNED horizontal / vertical dimension (the solver locks which
// side its second joint is on, engine.js dimSign), a formula: the left side's thickness dimension reads `thickness`, every other board reads THAT
// dimension, an opening is (the length dimension - (N + 1) * the thickness dimension) / N, so a number typed into the length or the thickness
// dimension moves every board as the parameter does (as the task 669 equal rules did). The top opening is what the overall length leaves (linear: it cannot flip either). The task 669 equal-LENGTH rules were unsigned, so
// shrinking the length could land the solve on a folded branch (the top end board flipped above the top edge, the top opening absorbing it).
// TASK 670 LAYOUT: 'Vertical' (above) or 'Horizontal' = the SAME construction with x and y swapped (a mirror in the diagonal through the
// origin, which stays the bottom-left corner): the full-length boards become the bottom and the top, the ends and dividers stand between
// them, the compartments sit side by side; every horizontal rule / dimension becomes vertical and the other way round.
// TASK 672 CORNER JOINT (one choice for the 4 outer corners, #core/corner-joint.js cornerJointPoints, frame-calc's): 'V-Through' (default) =
// the construction above (the sides run the full length: the owner's original rule); 'H-Through' = the ends run the full width, the sides stand
// between them; 'Miter' = 45 degree seams. The boards are frame-calc's stud-layout buildFrameGeometry ones (the jambs = the sides, the plates =
// the ends, the rails = the dividers), drawn through the one board path (drawBoards + carrierRules: every edge is on one of the 4 x levels or
// the 2 (N + 1) y levels); the dimensions are the same 2 N + 4 in every joint (only which corner joint carries a board's thickness changes). The
// joint is in the construction's frame: the Horizontal layout mirrors the whole drawing, joint included, so 'V-Through' is always "the
// full-length boards run through" (#ui/template-glyphs.js draws its glyph mirrored there).
export const BOX_FRAME_LAYOUTS = Object.freeze([
  Object.freeze({ value: 'Vertical', label: 'Vertical layout' }),
  Object.freeze({ value: 'Horizontal', label: 'Horizontal layout' }),
]);
function buildBoxFrame(p) {
  const Lg = num(p.length, 1500), W = num(p.width, 400), t = num(p.thickness, 18), n = Math.max(1, Math.round(num(p.compartments, 5)));
  const swap = p.layout === 'Horizontal';
  const joint = CORNER_JOINT_TYPES.some((o) => o.value === p.joint) ? p.joint : 'V-Through';
  const g = (Lg - (n + 1) * t) / n;
  const b0 = sketcher('boxframe');
  // the swap seam: the construction below is written for the vertical layout; `s` puts each point, rule and dimension where the layout wants it
  const across = { horizontal: 'vertical', vertical: 'horizontal' };
  const s = !swap ? b0 : {
    ...b0,
    pt: (x, y) => b0.pt(y, x), h: b0.v, v: b0.h,
    dim: (a, c, value, mode, offset, expr) => b0.dim(a, c, value, across[mode] || mode, -offset, expr),
  };
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
  const board = drawBoards(s, boards.map((poly) => poly.map(world)));
  carrierRules(s, board, [
    ...[0, t, W - t, W].map((x) => ({ a: world({ x, y: 0 }), b: world({ x, y: Lg }), axis: 'v' })),
    ...levels.map((y) => ({ a: world({ x: 0, y }), b: world({ x: W, y }), axis: 'h' })),
  ]);
  const J = (q) => board.J(world(q)), col = (i) => J({ x: t, y: levels[i] });
  const L0 = J({ x: 0, y: 0 }), R0 = J({ x: W, y: 0 });
  s.dim(L0, R0, W, 'horizontal', -12, 'width');
  const dL = s.dim(L0, J({ x: 0, y: Lg }), Lg, 'vertical', -12, 'length');
  const dT = s.dim(L0, J(BL.vInner), t, 'horizontal', 12, 'thickness'); // the left side: THE thickness dimension, the other boards read it
  s.dim(J(BR.vInner), R0, t, 'horizontal', 12, dT); // the right side
  // the right column has the same levels (horizontal rows), so the left column (and its corners) carries the cross boards' rules
  s.dim(J(BL.hOuter), J(BL.hInner), t, 'vertical', 10, dT); // the bottom end
  for (let k = 1; k < n; k++) s.dim(col(2 * k), col(2 * k + 1), t, 'vertical', 10, dT); // each divider
  s.dim(J(TL.hInner), J(TL.hOuter), t, 'vertical', 10, dT); // the top end
  for (let k = 0; k + 1 < n; k++) s.dim(col(2 * k + 1), col(2 * k + 2), g, 'vertical', 10, `(${dL} - ${n + 1} * ${dT}) / ${n}`); // the openings but the top one
  return s.finish(L0);
}

// TASK 670: RIGHT-ANGLE FRAME CORNER: a horizontal and a vertical board meeting at 90 degrees (the top-left corner of a frame: the horizontal
// board runs right from the outer corner, the vertical one runs down), both `thickness` thick, each its length long from the OUTER corner, joined
// by the corner joint the start modal picks ('Miter' | 'H-Through' | 'V-Through'). The two board outlines are #core/corner-joint.js
// cornerBoards (frame-calc's cornerJointPoints) in WORLD coordinates (Y down, as frame-calc's), so the seam moves exactly as frame-calc's does.
// The boards SHARE their seam: every polygon corner is one joint, every edge is split at the other board's corners lying on it and drawn once.
// Rules: each straight edge horizontal / vertical (a miter seam is the only slanted one); the two lengths and the two boards' thicknesses are
// SIGNED horizontal / vertical dimensions (no fold): the first thickness reads `thickness`, the second reads the first (with the miter: the
// 45 degree seam). Outer corner
// at the origin.
function buildRightAngleCorner(p) {
  const lh = num(p.horizontalLength, 300), lv = num(p.verticalLength, 200), t = num(p.thickness, 18);
  const type = CORNER_JOINT_TYPES.some((o) => o.value === p.joint) ? p.joint : 'H-Through';
  const boards = cornerBoards(0, 0, 1, 1, t, lh, lv, type);
  const s = sketcher('corner');
  const { J, pieces } = drawBoards(s, [boards.h, boards.v]); // TASK 672: the one board path (task 670's code, moved there)
  for (const { a: u, b: v } of pieces) if (Math.abs(u.q.y - v.q.y) < 1e-9) s.h(u.j, v.j); else if (Math.abs(u.q.x - v.q.x) < 1e-9) s.v(u.j, v.j);
  const O = J({ x: 0, y: 0 }), A = J(boards.h[1]), B = J(boards.h[2]), C = J(boards.v[1]), D = J(boards.v[2]);
  s.dim(O, A, lh, 'horizontal', 12, 'horizontal_length'); s.dim(O, C, lv, 'vertical', -12, 'vertical_length');
  const dT = s.dim(A, B, t, 'vertical', 10, 'thickness'); s.dim(C, D, t, 'horizontal', 10, dT);
  return s.finish(O);
}

// TASK 672: STAIR STRINGER, a cut stringer from one board (side view; the origin at the foot of the first riser, on the floor; Y up). `steps`
// notches, each a riser `rise` high and a tread `run` deep; riser k + 1 stands on the back of tread k. At the top a PLUMB cut (vertical) drops
// from the back of the last tread to the lower edge; at the bottom a LEVEL cut (on the floor) runs from the foot of the first riser to the
// lower edge. The lower edge is parallel to the PITCH line (a construction line through the inner corners of the notches: the backs of the
// treads, and the foot of the first riser), `throat` below it (the board left under every notch, square to the pitch). The board the stringer
// is cut from is a construction line `board width` above the lower edge (the board's top edge: the notches' tips must stay under it).
// Rules (no fold: once the pitch is set every one is linear): risers vertical, treads horizontal, the inner corners on the pitch line, the tips
// (the nosings) on a construction line parallel to it, so every step is the first one; the first riser and tread are signed dimensions; the
// throat and the board width are line-to-line dimensions of parallel lines; the board's top edge spans the stringer (front to plumb cut).
function buildStringer(p) {
  const n = Math.max(2, Math.round(num(p.steps, 4))), r = num(p.rise, 180), g = num(p.run, 250), w = num(p.boardWidth, 286), th = num(p.throat, 125);
  const L = Math.hypot(r, g), drop = th * L / g, top = (w - th) * L / g; // the lower edge: y = (r / g) x - drop; the board's top edge: y = (r / g) x + top
  const s = sketcher('stringer');
  const F = s.pt(0, 0), T = [], C = [];
  for (let k = 1; k <= n; k++) { T.push(s.pt((k - 1) * g, k * r)); C.push(s.pt(k * g, k * r)); } // the tip and the inner corner of each notch
  const P = s.pt(n * g, n * r - drop), B = s.pt(th * L / r, 0); // the lower edge's two ends: on the plumb cut, on the floor
  const S1 = s.pt(0, top), S2 = s.pt(n * g, n * r + top); // the board's top edge, over the front and over the plumb cut
  s.line(F, T[0]); s.v(F, T[0]);
  for (let k = 0; k < n; k++) {
    s.line(T[k], C[k]); s.h(T[k], C[k]); // tread k + 1
    if (k + 1 < n) { s.line(C[k], T[k + 1]); s.v(C[k], T[k + 1]); } // riser k + 2
  }
  s.line(C[n - 1], P); s.v(C[n - 1], P); // the plumb cut
  const lower = s.line(P, B);
  s.line(B, F); s.h(B, F); // the level cut
  const pitch = s.line(F, C[n - 1], true), tips = s.line(T[0], T[n - 1], true), board = s.line(S1, S2, true);
  for (let k = 0; k + 1 < n; k++) s.pointOn(C[k], pitch);
  for (let k = 1; k + 1 < n; k++) s.pointOn(T[k], tips);
  s.parallel(tips, pitch); s.parallel(lower, pitch); s.parallel(board, lower);
  s.v(F, S1); s.v(P, S2);
  s.dim(F, T[0], r, 'vertical', -10, 'rise');
  s.dim(T[0], C[0], g, 'horizontal', 10, 'run');
  s.gap(pitch, lower, th, 10, 'throat');
  s.gap(lower, board, w, 10, 'board_width');
  return s.finish(F);
}

// TASK 672: CURVED BENCH SEAT, a ring segment (the centre at the origin, the seat above it, symmetric about the Y axis) split into `slats`
// IDENTICAL straight tapered slats with even gaps. n + 1 radial lines at equal angles (sweep / n apart) bound the slats; each slat's two straight
// sides are parallel to its two radial lines, gap / 2 inside them, so every gap between two slats is a strip `gap` wide (its sides parallel)
// and the seat's two ends sit gap / 2 inside the end radials (every slat the same: one cutting pattern). The outer and the inner edge of each
// slat are real ARCS on the ring's two circles. Rules, every one LOCAL to the slats (a rule about a side's tiny distance from the far centre,
// a tangent to a gap-sized circle there or equal side lengths, flips or crawls: a side 1000 away turns 0.6 degree to pass the centre):
//   every corner on its circle: each arc's own rule, the arcs of a circle equal, the two radius dimensions;
//   each GAP: its two sides parallel and a gap dimension (the first reads `gap`, the others read the first: two distinct parallel lines
//   `gap` apart cannot merge, so no gap can close);
//   IDENTICAL slats: every slat's outer chord and inner chord equal to the first slat's (the same angle and the same width);
//   the first and the last slat SYMMETRIC (their two diagonals equal): with the gaps, every slat is, so each side is gap / 2 from its radial;
//   the ANGLE between the seat's two end sides = the sweep; the middle of the seat on the Y axis (the two outer corners either side of it level).
function buildBenchSeat(p) {
  const n = Math.max(2, Math.round(num(p.slats, 8))), Ro = num(p.outerRadius, 900), Ri = num(p.innerRadius, 450), sw = num(p.sweepAngle, 60), gap = num(p.gap, 10);
  const h = gap / 2, step = (sw / n) * Math.PI / 180, a0 = Math.PI / 2 - (sw / 2) * Math.PI / 180;
  const s = sketcher('bench');
  const C = s.pt(0, 0);
  // the corner on the circle of radius rho of the line parallel to the radial at angle phi, h to its counter-clockwise (+1) or clockwise (-1) side
  const corner = (rho, phi, side) => { const t = Math.sqrt(rho * rho - h * h), ux = Math.cos(phi), uy = Math.sin(phi); return s.pt(t * ux - side * h * uy, t * uy + side * h * ux); };
  const slats = [];
  for (let k = 0; k < n; k++) { // counter-clockwise from the right end
    const pa = a0 + k * step, pb = pa + step;
    const IA = corner(Ri, pa, 1), OA = corner(Ro, pa, 1), IB = corner(Ri, pb, -1), OB = corner(Ro, pb, -1);
    const A = s.line(IA, OA), outer = s.arc(C, OA, OB), B = s.line(IB, OB), inner = s.arc(C, IA, IB);
    slats.push({ IA, OA, IB, OB, A, B, outer, inner });
  }
  s.equalLengths(slats.map((x) => [C, x.OA])); // the outer arcs on ONE circle (each arc's own rule holds its other end)
  s.equalLengths(slats.map((x) => [C, x.IA])); // the inner arcs on one circle
  s.equalLengths(slats.map((x) => [x.OA, x.OB])); // identical slats: the outer chords
  s.equalLengths(slats.map((x) => [x.IA, x.IB])); // and the inner chords
  for (const x of [slats[0], slats[n - 1]]) s.equalLengths([[x.OA, x.IB], [x.OB, x.IA]]); // the end slats symmetric
  const rim = slats.flatMap((x) => [x.OA, x.OB]);
  s.h(rim[n - 1], rim[n]); // the middle slat (n odd) or the middle gap (n even) level: the seat symmetric about the Y axis
  for (let k = 0; k + 1 < n; k++) s.parallel(slats[k].B, slats[k + 1].A); // each gap: two parallel sides
  s.radius(slats[0].outer, Ro, 10, 'outer_radius');
  s.radius(slats[0].inner, Ri, 10, 'inner_radius');
  s.angle(slats[n - 1].B, slats[0].A, sw, 40, 'sweep_angle');
  let dG = null;
  for (let k = 0; k + 1 < n; k++) { const d = s.gap(slats[k].B, slats[k + 1].A, gap, 8, dG || 'gap'); dG = dG || d; } // each gap's width
  return s.finish(C);
}

// TASK 672: RIGHT-ANGLE BRACE, frame-calc's triangle frame (#core/frame-geometry.js calculateFramingGeometry, PORTED): a vertical board, a
// horizontal board and the diagonal brace between their far ends, `width` x `height` outside, each board its own thickness (as frame-calc
// measures them: the vertical one across x, the horizontal one across y, the diagonal square to its faces), and a joint per corner (top,
// bottom-left, bottom-right: frame-calc's options for each) that cuts the boards exactly as frame-calc does. The boards go through the one board
// path (drawBoards); every edge lies on one of six carriers (the outer and the inner face of each board: two vertical, two horizontal, two
// slanted) and every corner where two of them cross (carrierRules), so the drawing is held by the width and the height (the outer corners), the
// three thicknesses (signed horizontal / vertical dimensions for the vertical and the horizontal board, a line-to-line one for the diagonal) and
// the diagonal's inner face parallel to its outer face. frame-calc's frame (the apex at its origin, Y down) is moved so the outer right-angle
// corner (bottom-left) is the origin.
function buildBrace(p) {
  const pick = (v, opts) => (opts.some((o) => o.value === v) ? v : opts[0].value);
  const g = calculateFramingGeometry({ width: num(p.width, 300), height: num(p.height, 600), thickV: num(p.thickV, 38), thickH: num(p.thickH, 38), thickD: num(p.thickD, 38),
    topJoint: pick(p.topJoint, BRACE_JOINTS.top), blJoint: pick(p.blJoint, BRACE_JOINTS.bl), brJoint: pick(p.brJoint, BRACE_JOINTS.br) });
  const { W, H, Tv, Th, Td, L } = g, P = g.points;
  const s = sketcher('brace');
  const board = drawBoards(s, [P.V, P.H, P.D].map((b) => Object.values(b)));
  const [, iV, , iH, oD, iD] = carrierRules(s, board, [
    { a: { x: 0, y: 0 }, b: { x: 0, y: H }, axis: 'v' }, { a: { x: Tv, y: 0 }, b: { x: Tv, y: H }, axis: 'v' }, // the vertical board's outer / inner face
    { a: { x: 0, y: H }, b: { x: W, y: H }, axis: 'h' }, { a: { x: 0, y: H - Th }, b: { x: W, y: H - Th }, axis: 'h' }, // the horizontal board's
    { a: { x: 0, y: 0 }, b: { x: W, y: H }, axis: null }, { a: { x: 0, y: Td * L / W }, b: { x: W - Td * L / H, y: H }, axis: null }, // the diagonal's
  ]);
  s.parallel(iD.ref, oD.ref);
  const T = board.J({ x: 0, y: 0 }), BL = board.J({ x: 0, y: H }), BR = board.J({ x: W, y: H });
  s.dim(BL, BR, W, 'horizontal', -12, 'width');
  s.dim(BL, T, H, 'vertical', -12, 'height');
  s.dim(BL, iV.corners[iV.corners.length - 1].j, Tv, 'horizontal', -24, 'thick_v'); // to the lowest corner of the vertical board's inner face
  s.dim(BL, iH.corners[0].j, Th, 'vertical', -24, 'thick_h'); // to the leftmost corner of the horizontal board's inner face
  s.gap(oD.ref, iD.ref, Td, 10, 'thick_d');
  return s.finish(BL);
}

// TASK 672: POLYGON FRAME, frame-calc's polygon frame: a regular N-sided frame of boards. The outer polygon is frame-calc's (#core/frame-geometry.js
// regularPolygonVertices: P_0 on top, centred on the origin), the boards come from THE per-vertex frame engine (calculatePolygonFrameGeometry,
// frame-calc's calculateQuadFrameGeometry: the one engine every polygon frame uses) with ONE joint at every corner (Miter | CW-Through |
// CCW-Through). Drawn through the one board path; every edge lies on the outer or the inner face of a board (2 N slanted carriers,
// carrierRules). Rules: the INNER polygon is regular about the centre (construction radii to its corners, equal, its sides equal, the first
// radius vertical), each outer corner on its corner's radius, the outer faces parallel to the inner ones (N - 1 of them: the last one follows),
// the outer side length and the thickness (the first board's two faces).
function buildPolygonFrame(p) {
  const N = Math.round(num(p.sides, 6)), side = num(p.sideLength, 300), t = num(p.thickness, 38);
  const joint = POLYGON_JOINT_TYPES.some((o) => o.value === p.joint) ? p.joint : 'Miter';
  const g = calculatePolygonFrameGeometry({ P: regularPolygonVertices(N, side), thick: t, joints: Array(N).fill(joint) });
  const s = sketcher('polyframe');
  const C = s.pt(0, 0); // the centre (the origin)
  const board = drawBoards(s, g.boards.map((b) => [b.p1, b.p2, b.p3, b.p4]));
  const n = g.P.length, carriers = [];
  for (const ring of [g.P, g.Q]) ring.forEach((q, k) => carriers.push({ a: q, b: ring[(k + 1) % n], axis: null })); // outer faces, then inner faces
  const cr = carrierRules(s, board, carriers), outer = cr.slice(0, n), inner = cr.slice(n);
  const Pj = g.P.map((q) => board.J(q)), Qj = g.Q.map((q) => board.J(q));
  const radii = Qj.map((j) => s.line(C, j, true));
  s.equalShapes(radii);
  s.equalLengths(Qj.map((j, k) => [j, Qj[(k + 1) % n]]));
  s.v(C, Qj[0]);
  Pj.forEach((j, k) => s.pointOn(j, radii[k]));
  for (let k = 0; k + 1 < n; k++) s.parallel(outer[k].ref, inner[k].ref);
  s.dim(Pj[0], Pj[1], side, 'aligned', 12, 'side_length');
  s.gap(outer[0].ref, inner[0].ref, t, 10, 'thickness');
  return s.finish(C);
}

/**
 * THE bank. id: stable key; params: { key: spec } (the defaults build() uses; mm); build(params) -> a v3 document.
 * A param spec: { label, default, kind?, ... }. kind (default 'length'):
 *   'length' | 'angle'  a user parameter of the opened document (mm | deg), unless `atOpen: true` (chosen in the start modal only: no dimension
 *                       carries it, so a parameter could not drive it)
 *   'count'             a whole number chosen in the start modal only (min, max): it changes how many parts the drawing has
 *   'choice'            one of `options` ([{ value, label }]) chosen in the start modal only, shown by the `glyph` picker named there
 * `dimensions` is what the editor shows: the number of driving dimensions the drawing carries at its defaults (a test asserts it).
 */
export const TEMPLATES = [
  { id: 'slot', name: 'Slot', description: 'A straight slot with round ends: 10 mm wide, the two end centres 30 mm apart (40 mm overall).', params: { length: { label: 'Length', default: 40 }, width: { label: 'Width', default: 10 } }, dimensions: 2, build: buildSlot },
  { id: 'rounded-rectangle', name: 'Rounded rectangle', description: '60 by 40 mm with four 5 mm corner radii, all equal.', params: { width: { label: 'Width', default: 60 }, height: { label: 'Height', default: 40 }, radius: { label: 'Corner radius', default: 5 } }, dimensions: 3, build: buildRoundedRect },
  { id: 'keyhole', name: 'Keyhole', description: 'A 20 mm round head on a 8 mm neck with a round end, 35 mm deep.', params: { radius: { label: 'Head radius', default: 10 }, neck: { label: 'Neck width', default: 8 }, depth: { label: 'Depth', default: 35 } }, dimensions: 3, build: buildKeyhole },
  { id: 'hexagon', name: 'Hexagon', description: 'A regular hexagon, 20 mm across the flats (a nut or a bolt head).', params: { acrossFlats: { label: 'Across flats', default: 20 } }, dimensions: 1, build: buildHexagon },
  { id: 'star', name: 'Star', description: 'A five-point star, 25 mm outer and 10 mm inner radius.', params: { outer: { label: 'Outer radius', default: 25 }, inner: { label: 'Inner radius', default: 10 } }, dimensions: 2, build: buildStar },
  { id: 'arrow', name: 'Arrow', description: 'A straight arrow: 40 mm by 10 mm shaft and a 20 mm long, 30 mm wide head.', params: { shaftLength: { label: 'Shaft length', default: 40 }, shaftWidth: { label: 'Shaft width', default: 10 }, headLength: { label: 'Head length', default: 20 }, headWidth: { label: 'Head width', default: 30 } }, dimensions: 4, build: buildArrow },
  { id: 'l-bracket', name: 'L-bracket', description: 'A 60 by 50 mm L-bracket, 10 mm thick, with two 5 mm holes.', params: { width: { label: 'Width', default: 60 }, height: { label: 'Height', default: 50 }, thickness: { label: 'Thickness', default: 10 }, holeDiameter: { label: 'Hole diameter', default: 5 } }, dimensions: 9, build: buildLBracket },
  { id: 'bolt-circle', name: 'Bolt circle', description: 'A 60 mm disc with six 6 mm holes on a 40 mm bolt circle.', params: { outerRadius: { label: 'Disc radius', default: 30 }, boltRadius: { label: 'Bolt circle radius', default: 20 }, holeRadius: { label: 'Hole radius', default: 3 } }, dimensions: 3, build: buildBoltCircle },
  { id: 'finger-edge', name: 'Finger-joint edge', description: 'The tabbed edge of a box panel: five 10 mm tabs, 5 mm deep.', params: { tabWidth: { label: 'Tab width', default: 10 }, gapWidth: { label: 'Gap width', default: 10 }, depth: { label: 'Depth', default: 5 } }, dimensions: 3, build: buildFingerEdge },
  { id: 'dog-bone-pocket', name: 'Dog-bone pocket', description: 'A 60 by 40 mm pocket with a diagonal dog-bone relief in each corner for a 1/4 inch (6.35 mm) bit.', params: { width: { label: 'Width', default: 60 }, height: { label: 'Height', default: 40 }, bitDiameter: { label: 'Bit diameter', default: 6.35 } }, dimensions: 3, build: buildDogBone },
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
 * The document's USER PARAMETERS for the param values (the live ones, in declaration order): { name, unit, expression: '<value> <unit>',
 * comment: label }, made by #core/parameters.js planChange createParameter (the one model: its name rule and its canonical text).
 */
export function templateParameters(t, values) {
  let parameters = [];
  for (const [k, spec] of Object.entries(t.params)) {
    if (!isLiveParam(spec)) continue;
    const unit = paramUnit(spec);
    const plan = planChange({ parameters, constraints: [] }, { type: 'createParameter', name: paramName(k), unit, text: `${values[k]} ${unit}`, comment: spec.label });
    if (!plan.ok) throw new Error(`template ${t.id}: parameter ${k}: ${plan.message}`);
    parameters = plan.paramsAfter;
  }
  return parameters;
}

/**
 * Build a template's document with its default parameters (or `params` over them): the drawing, its dimensions as formulas, and its user
 * parameters. A value the param refuses (paramRefusal) throws: the start modal checks every value before it opens a template.
 */
export function buildTemplate(t, params = {}) {
  const values = { ...defaultParams(t), ...params };
  for (const [k, spec] of Object.entries(t.params)) {
    const why = paramRefusal(spec, values[k]);
    if (why) throw new Error(`template ${t.id}: ${why}`);
    if (paramKind(spec) !== 'choice') values[k] = R(Number(values[k])); // the drawing and its parameter read the SAME number
  }
  const doc = t.build(values);
  doc.geometry.parameters = templateParameters(t, values);
  return doc;
}
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;
