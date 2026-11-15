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

import { serializeDocument } from '#core/document.js';
import { makeArc, makePolygon } from '#core/shapes.js';
import { userToWorldY } from '#core/units.js';
import { ORIGIN_JOINT_ID, CONSTRAINT_TYPES } from '#core/constants.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';

const R = (v) => Math.round(v * 1e6) / 1e6;

// One small sketch builder: joints in user coordinates, shapes and constraints as plain records.
function sketcher(id) {
  const joints = new Map(), shapes = [], constraints = [];
  let jn = 0, sn = 0;
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
    // driving dimensions: mode 'aligned' | 'horizontal' | 'vertical'; offset = where the label sits (mm from the geometry)
    dim(a, c, value, mode = 'aligned', offset = 8) { constraints.push({ type: 'distance', joints: [a, c], value: R(value), dimMode: mode, offset, isDriven: false, driven: false }); },
    radius(shape, value, offset = 8) { constraints.push({ type: 'distance', shape, value: R(value), isRadius: true, offset, isDriven: false, driven: false }); },
    gap(s1, s2, value, offset = 8) { constraints.push({ type: 'distance', shapes: [s1, s2], value: R(value), offset, isDriven: false, driven: false }); },
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

// ── the bank ────────────────────────────────────────────────────────────────────────────────────────────────────
function buildSlot(p) {
  const L = num(p.length, 40), W = num(p.width, 10), r = W / 2, d = L - W; // d = centre-to-centre distance of the two ends
  const s = sketcher('slot');
  const CL = s.pt(0, 0), CR = s.pt(d, 0);
  const TL = s.pt(0, r), BL = s.pt(0, -r), TR = s.pt(d, r), BR = s.pt(d, -r);
  s.line(TL, TR); s.line(BL, BR);
  s.arc(CL, TL, BL); s.arc(CR, BR, TR);
  s.h(TL, TR); s.h(BL, BR); s.v(CL, TL); s.v(CL, BL); s.v(CR, TR); s.v(CR, BR);
  s.dim(TL, BL, W, 'vertical', -7);
  s.dim(CL, CR, d, 'horizontal', -r - 4);
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
  s.radius(arcs[0], r, 10);
  s.dim(tl.b, tr.b, w, 'horizontal', -5);
  s.dim(tl.a, bl.a, h, 'vertical', -6);
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
  s.radius(big, R0, 12); s.dim(P1, P2, neck, 'horizontal', 6); s.dim(CB, CS, depth, 'vertical', 14);
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
  s.gap(sides[1].id, sides[4].id, af, 8);
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
  s.dim(C, o[0], Ro, 'aligned', 8); s.dim(C, ii[0], Ri, 'aligned', -8);
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
  s.dim(P0, P6, shaftW, 'vertical', -8); s.dim(P0, P1, shaftL, 'horizontal', 12); s.dim(P2, P4, headW, 'vertical', 12); s.dim(M, P3, headL, 'horizontal', -headW / 2 - 6);
  return s.finish(M);
}

function buildLBracket(p) {
  const w = num(p.width, 60), h = num(p.height, 50), t = num(p.thickness, 10), hd = num(p.holeDiameter, 5);
  const s = sketcher('lbracket');
  const P0 = s.pt(0, 0), P1 = s.pt(w, 0), P2 = s.pt(w, t), P3 = s.pt(t, t), P4 = s.pt(t, h), P5 = s.pt(0, h);
  const ring = [P0, P1, P2, P3, P4, P5];
  ring.forEach((j, i) => s.line(j, ring[(i + 1) % ring.length]));
  s.h(P0, P1); s.v(P1, P2); s.h(P2, P3); s.v(P3, P4); s.h(P4, P5); s.v(P5, P0);
  s.dim(P0, P1, w, 'horizontal', -8); s.dim(P0, P5, h, 'vertical', -8); s.dim(P1, P2, t, 'vertical', 8); s.dim(P5, P4, t, 'horizontal', 8);
  const c1 = s.pt(w - t, t / 2), c2 = s.pt(t / 2, h - t);
  const k1 = s.circle(c1, hd / 2), k2 = s.circle(c2, hd / 2);
  s.dim(P0, c1, w - t, 'horizontal', 8 + t); s.dim(P0, c1, t / 2, 'vertical', -14);
  s.dim(P0, c2, t / 2, 'horizontal', -14); s.dim(P0, c2, h - t, 'vertical', 8 + t);
  s.radius(k1, hd / 2, 6); s.equalShapes([k1, k2]);
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
  s.radius(outer, Ro, 6); s.radius(bolt, Rb, 6); s.radius(holes[0], hr, 4);
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
  s.dim(top[0][0], top[0][1], tab, 'horizontal', 8);
  s.dim(low[0][0], low[0][1], gap, 'horizontal', -8);
  s.dim(top[0][1], low[0][0], depth, 'vertical', 8);
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
  s.radius(bl.arc, r, 10);
  s.dim(bl.V, br.V, w, 'horizontal', -12);
  s.dim(bl.H, tl.H, h, 'vertical', -12);
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
  s.dim(TL, TR, tw, 'horizontal', 6); s.dim(TR, NR, td, 'vertical', 6); s.dim(OL, OR, bw, 'horizontal', -6); s.dim(TR, BR, D, 'vertical', 16);
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
  s.dim(EL, ER, L, 'horizontal', 6); s.dim(P2, P3, ew, 'vertical', 8); s.dim(P1, P4, ww, 'vertical', 6);
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
  s.radius(cup, cd / 2, 8); s.radius(k1, sd / 2, 6); s.dim(S1, S2, sp, 'horizontal', -sd / 2 - 8); s.dim(C, M, off, 'vertical', -cd / 2 - 8);
  return s.finish(C);
}

// TASK 669: SHELF-PIN ROW: ONE source hole + ONE rectangular pattern constraint (pattern.js applyPattern, the app's own pattern, no new code: the
// builder calls it on its own joints / shapes / constraints). The copies follow the source (its radius dimension) and the pattern's spacing;
// count and spacing are the pattern's values, not sketch dimensions. 32 mm centres (the 32 mm cabinet system).
function buildShelfPins(p) {
  const n = Math.max(2, Math.round(num(p.count, 5))), sp = num(p.spacing, 32), hd = num(p.holeDiameter, 5);
  const s = sketcher('shelfpins');
  const c = s.pt(0, 0), hole = s.circle(c, hd / 2);
  s.radius(hole, hd / 2, 6);
  const made = applyPattern({ joints: s.joints, shapes: s.shapes, constraints: s.constraints }, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, { shapes: [hole], joints: [] },
    { ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [n, 1], distance: [sp, sp] });
  if (!made.ok) throw new Error('shelf-pin pattern: ' + made.reason);
  return s.finish(c);
}

// TASK 669: BOX FRAME (front view) of a plywood cubby / bookcase carcass, the long direction VERTICAL: two SIDE boards the FULL length, two END
// boards BETWEEN the sides, and N - 1 DIVIDERS between the sides, all t thick, splitting the inside into N equal compartments. The boards SHARE
// their edges (one line and one pair of joints per shared edge: no gaps, no overlaps). Joint grid: four x levels (0, t, W - t, W) and 2 (N + 1)
// y levels (the bottom and the top of the N + 1 cross boards); the inner columns carry a joint at every level. Constraints: every segment
// horizontal / vertical, three dimensions (width, length, thickness), every other board thickness equal to t, the N openings equal.
function buildBoxFrame(p) {
  const Lg = num(p.length, 1500), W = num(p.width, 400), t = num(p.thickness, 18), n = Math.max(1, Math.round(num(p.compartments, 5)));
  const g = (Lg - (n + 1) * t) / n;
  const s = sketcher('boxframe');
  const levels = []; // the bottom and the top y of each cross board, from the bottom
  for (let k = 0; k <= n; k++) { const b = k * (g + t); levels.push(b, b + t); }
  const last = levels.length - 1;
  const L0 = s.pt(0, 0), R0 = s.pt(W, 0), L1 = s.pt(0, Lg), R1 = s.pt(W, Lg);
  const colL = levels.map((y) => s.pt(t, y)), colR = levels.map((y) => s.pt(W - t, y));
  const hz = (a, c) => { s.line(a, c); s.h(a, c); }, vt = (a, c) => { s.line(a, c); s.v(a, c); };
  vt(L0, L1); vt(R0, R1); // the sides' outer long edges
  hz(L0, colL[0]); hz(colR[0], R0); hz(L1, colL[last]); hz(colR[last], R1); // the sides' ends
  const thick = [], opening = [];
  for (let i = 0; i < last; i++) {
    vt(colL[i], colL[i + 1]); vt(colR[i], colR[i + 1]);
    (i % 2 === 0 ? thick : opening).push([colL[i], colL[i + 1]]); // the right column has the same levels (horizontal rows), so one column carries the rules
  }
  for (let i = 0; i <= last; i++) { s.line(colL[i], colR[i]); s.h(colL[i], colR[i]); } // every board's two long edges
  s.dim(L0, R0, W, 'horizontal', -12); s.dim(L0, L1, Lg, 'vertical', -12); s.dim(L0, colL[0], t, 'horizontal', 12);
  const tref = [L0, colL[0]];
  for (const x of [[colR[0], R0], [colL[last], L1], [colR[last], R1], ...thick]) s.equalLengths([tref, x]);
  // the first board's two vertical segments are also thick; the openings equal each other
  for (let i = 0; i + 1 < opening.length; i++) s.equalLengths([opening[i], opening[i + 1]]);
  return s.finish(L0);
}

/**
 * THE bank. id: stable key; params: { key: { label, default } } (the defaults build() uses; mm); build(params) -> a v3 document.
 * `dimensions` is what the editor shows: the number of driving dimensions the drawing carries (a test asserts it).
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
  { id: 'shelf-pin-row', name: 'Shelf-pin row', description: 'Five 5 mm holes on 32 mm centres (the 32 mm cabinet system): one hole and a rectangular pattern.', params: { count: { label: 'Holes', default: 5 }, spacing: { label: 'Spacing', default: 32 }, holeDiameter: { label: 'Hole diameter', default: 5 } }, dimensions: 1, build: buildShelfPins },
  { id: 'box-frame', name: 'Box frame (front view)', description: 'A plywood cubby carcass from the front: two full-length sides, two ends and dividers between them, 5 equal compartments.', params: { length: { label: 'Overall length', default: 1500 }, width: { label: 'Width', default: 400 }, thickness: { label: 'Plywood thickness', default: 18 }, compartments: { label: 'Compartments', default: 5 } }, dimensions: 3, build: buildBoxFrame },
];

/** The default parameters of a template: { key: default }. */
export const defaultParams = (t) => Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, v.default]));
/** Build a template's document with its default parameters (or `params` over them). */
export const buildTemplate = (t, params = {}) => t.build({ ...defaultParams(t), ...params });
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;
