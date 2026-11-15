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
import { ORIGIN_JOINT_ID } from '#core/constants.js';

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
];

/** The default parameters of a template: { key: default }. */
export const defaultParams = (t) => Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, v.default]));
/** Build a template's document with its default parameters (or `params` over them). */
export const buildTemplate = (t, params = {}) => t.build({ ...defaultParams(t), ...params });
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null;
