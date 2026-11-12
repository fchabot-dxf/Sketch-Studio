// TASK 531 -- extreme arcs, part A: the arc VARIANTS as data, the builders (the REAL arc tool handlers, the REAL fillet), and the measurements of an
// arc (radius, signed sweep, flag coherence, what the renderer's path draws). Nothing here changes anything under packages/.
//
// Sign convention (the app's, Y-down world): sweep > 0 = the arc runs in the POSITIVE ANGLE direction (the stored `sweep` flag true, clockwise on
// screen); sweep < 0 = negative angle direction (flag false, counter-clockwise on screen). Written 'cw' / 'ccw' (on screen) in the ids.
import * as L from '../audit/lib.js';
import { handleArcPointerDown, handleArcPointerMove, handleArcPointerUp } from '#ui/input-handlers/arc-tool.js';
import { arcSweepInfo, calculateArcPath } from '#core/geometry.js';
import { svgCircularArcCentre } from '#core/import-arcs.js';
import { svgStub } from './matrix-run.js';

// ------------------------------------------------------------------------------------------------------------------ the variants (DATA)
// via 'tool': the arc tool (centre click, start click, pointer moves round the centre in <= 30 degree steps, end click) -- the arc is START at angle 0 from
//             the centre. via 'fillet': two lines meeting at `corner` degrees, the Fillet tool path (findCornerBetweenLines + applyFillet) with radius r.
// R: radius; sweep: signed degrees; control: the ordinary arc every other variant is compared with.
const tool = (id, R, sweep, why) => ({ id, via: 'tool', R, sweep, why });
export const VARIANTS = [
  tool('s30cw', 20, 30, 'CONTROL: ordinary arc'),
  tool('s30ccw', 20, -30, 'ordinary arc, other direction'),
  tool('s0.1cw', 20, 0.1, 'very short sweep: chord 0.035 < GEOMETRY_TOLERANCE 0.05 (and < every pixel tolerance)'),
  tool('s0.1ccw', 20, -0.1, 'very short sweep, other direction'),
  tool('s1cw', 20, 1, 'chord 0.35: below one pixel at zoom 1'),
  tool('s1ccw', 20, -1, 'chord 0.35, other direction'),
  tool('s5cw', 20, 5, 'chord 1.7'),
  tool('s179cw', 20, 179, 'just under a half circle'),
  tool('s180cw', 20, 180, 'exactly a half circle (the tool nudges the end by 1e-6)'),
  tool('s181cw', 20, 181, 'just over a half circle (large-arc flag)'),
  tool('s181ccw', 20, -181, 'just over a half circle, other direction'),
  tool('s355cw', 20, 355, 'almost a full circle'),
  tool('s359.9cw', 20, 359.9, 'end 0.035 from the start again'),
  tool('s359.9ccw', 20, -359.9, 'end 0.035 from the start again, other direction'),
  tool('r0.5s30cw', 0.5, 30, 'tiny radius'),
  tool('r0.5s0.1cw', 0.5, 0.1, 'tiny radius and tiny sweep: chord 0.0009 < VERIFIER_TOLERANCE 0.001'),
  tool('r0.5s181cw', 0.5, 181, 'tiny radius, large arc'),
  tool('r5000c20cw', 5000, 2 * Math.asin(10 / 5000) * 180 / Math.PI, 'huge radius 5000, chord 20: nearly straight'),
  tool('r5000c20ccw', 5000, -2 * Math.asin(10 / 5000) * 180 / Math.PI, 'huge radius, chord 20, other direction'),
  tool('r5000s5cw', 5000, 5, 'huge radius, chord 436'),
  { id: 'f90r0.5', via: 'fillet', corner: 90, r: 0.5, why: 'FILLET arc: tiny fillet radius on a right angle' },
  { id: 'f90r10', via: 'fillet', corner: 90, r: 10, why: 'FILLET arc CONTROL: ordinary fillet on a right angle' },
  { id: 'f179r10', via: 'fillet', corner: 179, r: 10, why: 'FILLET arc on a nearly straight corner (179 deg): sweep 1 deg' },
  { id: 'f2r10', via: 'fillet', corner: 2, r: 10, why: 'FILLET arc on a very sharp corner (2 deg): sweep 178 deg' },
];
export const CONTROL = 's30cw';
export const FILLET_CONTROL = 'f90r10';
export const variant = (id) => VARIANTS.find(v => v.id === id);

// ------------------------------------------------------------------------------------------------------------------ building
// quiet the arc tool's console.debug chatter (it logs every pointer event)
function quiet(fn) { const d = console.debug; console.debug = () => {}; try { return fn(); } finally { console.debug = d; } }
const ev = (x, y) => ({ clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, target: { closest: () => null } });

// the arc tool, driven by its own handlers (pointer down/up on the centre, down/up on the start, moves round the centre, up on the end)
export function arcByTool(S, cx, cy, R, sweepDeg, startRad = 0) {
  const st = S.state;
  st.currentTool = 'arc'; st.arcMode = 'arc-cse'; st.activeSnap = null; st.snapTarget = null;
  const at = (a) => ({ x: cx + R * Math.cos(a + startRad), y: cy + R * Math.sin(a + startRad) });
  const n0 = st.shapes.length;
  quiet(() => {
    const c = { x: cx, y: cy };
    handleArcPointerDown(ev(c.x, c.y), svgStub, st, null, c);
    handleArcPointerUp(ev(c.x, c.y), svgStub, st, null, c, false);        // the first click only arms the tool (_tempStart)
    const p0 = at(0);
    handleArcPointerMove(ev(p0.x, p0.y), svgStub, st, p0);
    handleArcPointerUp(ev(p0.x, p0.y), svgStub, st, null, p0, true);      // the start point
    const total = sweepDeg * Math.PI / 180, n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 6)));
    for (let i = 1; i <= n; i++) { const p = at(total * i / n); handleArcPointerMove(ev(p.x, p.y), svgStub, st, p); }
    const pe = at(total);
    handleArcPointerUp(ev(pe.x, pe.y), svgStub, st, null, pe, true);      // the end point
  });
  if (st.shapes.length !== n0 + 1) throw new Error(`the arc tool did not create the arc (R ${R}, sweep ${sweepDeg})`);
  const sh = st.shapes[st.shapes.length - 1];
  return { k: 'A', shape: sh.id, joints: sh.joints.slice(), jn: sh.joints[1] };
}

// two lines meeting at `corner` degrees at (ox, oy), filleted with radius r. The lines are 100 long.
export function filletArc(S, ox, oy, corner, r) {
  const a = corner * Math.PI / 180;
  const segs = L.polyline(S, [[ox + 100, oy], [ox, oy], [ox + 100 * Math.cos(a), oy + 100 * Math.sin(a)]], false);
  const f = L.fillet(S, segs[0].id, segs[1].id, r);
  const arc = L.shape(S, f.arc);
  return { k: 'F', shape: f.arc, joints: arc.joints.slice(), jn: arc.joints[1], extra: { lines: segs.map(s => s.id), V: f.V } };
}

// one arc variant at (ox, oy) in a sketch. Returns the operand { k, shape, joints:[centre,start,end], jn (the START: the point partners attach to) }.
export function buildArc(S, v, ox = 200, oy = 200) {
  if (v.via === 'tool') return arcByTool(S, ox, oy, v.R, v.sweep);
  return filletArc(S, ox, oy, v.corner, v.r);
}

// ------------------------------------------------------------------------------------------------------------------ measuring an arc
const TAU = Math.PI * 2;
const P = (S, id) => S.state.joints.get(id);

// everything a later check compares: radius (start side / end side), chord, the EFFECTIVE sweep (arcSweepInfo = what the renderer, hit test and exporters use),
// the stored flags and whether they are coherent with the geometry, and what the SVG path the renderer emits actually draws.
export function measureArc(S, shapeId) {
  const sh = L.shape(S, shapeId);
  const [c, s, e] = sh.joints.map(id => P(S, id));
  const R = Math.hypot(s.x - c.x, s.y - c.y), Re = Math.hypot(e.x - c.x, e.y - c.y), chord = Math.hypot(e.x - s.x, e.y - s.y);
  // TASK 550: the arc is read like the app reads it: its direction (`sweep`) through arcSweepInfo; the large-arc flag is the one the renderer's
  // path DRAWS (derived), so "flag coherent" asks whether the drawn arc is the arc the joints say (EA-2), not what a stored field holds.
  const info = arcSweepInfo(c, s, e, { sweep: sh.sweep });
  const flagged = typeof sh.sweep === 'boolean';
  const span = info.span, signed = info.dir * span;
  const finite = [R, Re, chord, span].every(Number.isFinite);
  const path = calculateArcPath(c, s, e, sh.subType, { sweep: sh.sweep });
  const pathOk = typeof path === 'string' && path.length > 0 && !/NaN|Infinity|undefined/.test(path);
  // the arc the SVG path draws: centre implied by (radius, flags, the two end points) -- should be the stored centre
  let impliedCentre = null, centreErr = null, drawnLarge = null;
  const m = /^M\s+(\S+)\s+(\S+)\s+A\s+(\S+)\s+(\S+)\s+0\s+(\d)\s+(\d)\s+(\S+)\s+(\S+)$/.exec(path || '');
  if (m) {
    const [x1, y1, r, , la, sw, x2, y2] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], +m[7], +m[8]];
    drawnLarge = !!la;
    const q = svgCircularArcCentre(x1, y1, r, !!la, !!sw, x2, y2);
    if (q) { impliedCentre = q; centreErr = Math.hypot(q.cx - c.x, q.cy - c.y); }
  }
  return {
    R, Re, chord, span, signed, spanDeg: span * 180 / Math.PI, signedDeg: signed * 180 / Math.PI, dir: info.dir, finite, flagged,
    largeArc: drawnLarge, sweepFlag: sh.sweep, pathOk, path,
    // the drawn large-arc flag must say whether the span is above a half circle
    flagCoherent: drawnLarge === null || drawnLarge === (span > Math.PI + 1e-9) || Math.abs(span - Math.PI) < 1e-4,
    // the renderer draws a different arc than the joints say (flags stale, or radius from the start side only)
    centreErr, drawnOk: centreErr === null ? chord === 0 : centreErr <= 1e-3 * Math.max(R, 1e-3) + 1e-6,
    // the joint-side orientation sign (lib.signature 'A'): cross(start - centre, end - centre)
    cross: Math.sign((s.x - c.x) * (e.y - c.y) - (s.y - c.y) * (e.x - c.x)),
  };
}
