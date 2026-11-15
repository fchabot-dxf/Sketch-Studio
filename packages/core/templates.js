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
import { cornerBoards, CORNER_JOINT_TYPES } from '#core/corner-joint.js';

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
export const BOX_FRAME_LAYOUTS = Object.freeze([
  Object.freeze({ value: 'Vertical', label: 'Vertical layout' }),
  Object.freeze({ value: 'Horizontal', label: 'Horizontal layout' }),
]);
function buildBoxFrame(p) {
  const Lg = num(p.length, 1500), W = num(p.width, 400), t = num(p.thickness, 18), n = Math.max(1, Math.round(num(p.compartments, 5)));
  const swap = p.layout === 'Horizontal';
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
  const last = levels.length - 1;
  const L0 = s.pt(0, 0), R0 = s.pt(W, 0), L1 = s.pt(0, Lg), R1 = s.pt(W, Lg);
  const colL = levels.map((y) => s.pt(t, y)), colR = levels.map((y) => s.pt(W - t, y));
  const hz = (a, c) => { s.line(a, c); s.h(a, c); }, vt = (a, c) => { s.line(a, c); s.v(a, c); };
  vt(L0, L1); vt(R0, R1); // the sides' outer long edges
  hz(L0, colL[0]); hz(colR[0], R0); hz(L1, colL[last]); hz(colR[last], R1); // the sides' ends
  for (let i = 0; i < last; i++) { vt(colL[i], colL[i + 1]); vt(colR[i], colR[i + 1]); }
  for (let i = 0; i <= last; i++) { s.line(colL[i], colR[i]); s.h(colL[i], colR[i]); } // every board's two long edges
  s.dim(L0, R0, W, 'horizontal', -12, 'width');
  const dL = s.dim(L0, L1, Lg, 'vertical', -12, 'length');
  const dT = s.dim(L0, colL[0], t, 'horizontal', 12, 'thickness'); // the left side: THE thickness dimension, the other boards read it
  s.dim(colR[0], R0, t, 'horizontal', 12, dT); // the right side
  // the right column has the same levels (horizontal rows), so the left column carries the cross boards' rules
  for (let k = 0; k <= n; k++) s.dim(colL[2 * k], colL[2 * k + 1], t, 'vertical', 10, dT); // each cross board
  for (let k = 0; k + 1 < n; k++) s.dim(colL[2 * k + 1], colL[2 * k + 2], g, 'vertical', 10, `(${dL} - ${n + 1} * ${dT}) / ${n}`); // the openings but the top one
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
  const key = (q) => `${R(q.x)},${R(q.y)}`;
  const at = new Map(); // a board corner (world point) -> its ONE joint
  for (const poly of [boards.h, boards.v]) for (const q of poly) if (!at.has(key(q))) at.set(key(q), { q, j: s.pt(q.x, worldToUserY(q.y)) });
  const corners = [...at.values()], drawn = new Set();
  for (const poly of [boards.h, boards.v]) poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const on = corners.map((c) => ({ c, u: ((c.q.x - a.x) * dx + (c.q.y - a.y) * dy) / (len * len), off: Math.abs((c.q.x - a.x) * dy - (c.q.y - a.y) * dx) / len }))
      .filter((o) => o.off < 1e-9 && o.u > -1e-9 && o.u < 1 + 1e-9).sort((u, v) => u.u - v.u); // the joints ON this edge, from a to b
    for (let k = 0; k + 1 < on.length; k++) {
      const u = on[k].c, v = on[k + 1].c, id = [u.j, v.j].sort().join('|');
      if (drawn.has(id)) continue; // the shared seam: drawn once
      drawn.add(id);
      s.line(u.j, v.j);
      if (Math.abs(u.q.y - v.q.y) < 1e-9) s.h(u.j, v.j); else if (Math.abs(u.q.x - v.q.x) < 1e-9) s.v(u.j, v.j);
    }
  });
  const J = (q) => at.get(key(q)).j;
  const O = J({ x: 0, y: 0 }), A = J(boards.h[1]), B = J(boards.h[2]), C = J(boards.v[1]), D = J(boards.v[2]);
  s.dim(O, A, lh, 'horizontal', 12, 'horizontal_length'); s.dim(O, C, lv, 'vertical', -12, 'vertical_length');
  const dT = s.dim(A, B, t, 'vertical', 10, 'thickness'); s.dim(C, D, t, 'horizontal', 10, dT);
  return s.finish(O);
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
  { id: 'box-frame', name: 'Box frame (front view)', description: 'A plywood cubby carcass from the front: two full-length sides, two ends and dividers between them, 5 equal compartments.', params: { length: { label: 'Overall length', default: 1500 }, width: { label: 'Width', default: 400 }, thickness: { label: 'Plywood thickness', default: 18 }, compartments: { label: 'Compartments', default: 5, kind: 'count', min: 1, max: 100 }, layout: { label: 'Layout', default: 'Vertical', kind: 'choice', options: BOX_FRAME_LAYOUTS, glyph: 'box-layout' } }, dimensions: 14, build: buildBoxFrame },
  { id: 'right-angle-corner', name: 'Right-angle frame corner', description: 'Two 18 mm boards meeting at 90 degrees, 300 and 200 mm long: mitered, or one board running through.', params: { horizontalLength: { label: 'Horizontal length', default: 300 }, verticalLength: { label: 'Vertical length', default: 200 }, thickness: { label: 'Board thickness', default: 18 }, joint: { label: 'Corner joint', default: 'H-Through', kind: 'choice', options: CORNER_JOINT_TYPES, glyph: 'corner-joint' } }, dimensions: 4, build: buildRightAngleCorner },
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
