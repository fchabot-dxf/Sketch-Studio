// packages/core/curve-cuts.js — TASK 1018: WHERE a sketch curve is cut, declared ONCE for Trim (#core/trim.js) and Break (#core/break.js).
// PURE (no DOM). The curves that cut and that are cut: a LINE, a (CENTER) ARC and a CIRCLE (a Bezier has no maths here: CURVE_REFUSALS keeps refusing it).
//
// A curve's geometry (curveGeom) and its PARAMETER u:
//   line    { kind: 'line', a, b }                     u = t in [0, 1] from a to b
//   arc     { kind: 'arc', c, r, a0, span, dir }       u in [0, 1] along its sweep, from its start (joints[1]) to its end (joints[2]); dir = +1 when the angle grows
//   circle  { kind: 'circle', c, r }                   u = the angle in [0, 2 pi) (atan2, growing); a circle has no ends
// A CUT is where another curve of the active sketch crosses it (curveCuts): { u, pt, cutters: [shape ids] }. A line's or an arc's own ends are no cut.

import { arcSweepInfo } from './geometry.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { inActiveSketch } from './sketch-model.js';

const TAU = Math.PI * 2;
const mod2pi = (v) => ((v % TAU) + TAU) % TAU;
/** A curve parameter this close to a line's or an arc's end (or two cuts this close) is that end (the same one; Trim's epsilon since TRACE-1). */
export const CUT_EPS = 1e-6;

/** The geometry of a cuttable curve (the table above), or null: any other shape, or one whose points are missing. */
export function curveGeom(state, s) {
  if (!s || !Array.isArray(s.joints)) return null;
  const J = (id) => state.joints.get(id);
  if (s.type === 'line') {
    const a = J(s.joints[0]), b = J(s.joints[1]);
    return a && b ? { kind: 'line', a, b } : null;
  }
  if (s.type === 'circle') {
    const c = J(s.joints[0]);
    return c && s.radius > 0 ? { kind: 'circle', c, r: s.radius } : null;
  }
  if (s.type === 'arc' && (!s.subType || s.subType === 'CENTER')) {
    const c = J(s.joints[0]), p = J(s.joints[1]), q = J(s.joints[2]);
    if (!c || !p || !q) return null;
    const r = Math.hypot(p.x - c.x, p.y - c.y);
    if (!(r > 0)) return null;
    const info = arcSweepInfo(c, p, q, { sweep: s.sweep });
    return { kind: 'arc', c, r, a0: info.a0, span: info.span, dir: info.dir };
  }
  return null;
}

/** The point of curve g at parameter u. */
export function curvePointAt(g, u) {
  if (g.kind === 'line') return { x: g.a.x + u * (g.b.x - g.a.x), y: g.a.y + u * (g.b.y - g.a.y) };
  const ang = g.kind === 'arc' ? g.a0 + g.dir * u * g.span : u;
  return { x: g.c.x + g.r * Math.cos(ang), y: g.c.y + g.r * Math.sin(ang) };
}

// an arc's angle offset of the direction `ang` from its start, along its sweep (0 .. 2 pi)
const arcRel = (g, ang) => mod2pi((ang - g.a0) * g.dir);

/** The parameter of the point of curve g nearest p: a line's projection (clamped to its ends), an arc's angle along its sweep (a point off the
 *  sweep takes the nearer end), a circle's angle. */
export function curveParamAt(g, p) {
  if (g.kind === 'line') {
    const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return 0;
    return Math.max(0, Math.min(1, ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / L2));
  }
  const ang = Math.atan2(p.y - g.c.y, p.x - g.c.x);
  if (g.kind === 'circle') return mod2pi(ang);
  if (!(g.span > 0)) return 0;
  const rel = arcRel(g, ang);
  if (rel <= g.span) return rel / g.span;
  return (rel - g.span) < (TAU - rel) ? 1 : 0;
}

/** The distance from p to the drawn curve g (a line's segment, an arc's sweep, a circle). */
export function curveDistance(g, p) {
  const q = curvePointAt(g, curveParamAt(g, p));
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// Does the point x (on g's carrier: its infinite line or its whole circle) lie on the drawn curve g? (u within CUT_EPS past an end still does.)
function onDrawn(g, x) {
  if (g.kind === 'circle') return true;
  if (g.kind === 'line') {
    const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return false;
    const t = ((x.x - g.a.x) * dx + (x.y - g.a.y) * dy) / L2;
    return t >= -CUT_EPS && t <= 1 + CUT_EPS;
  }
  const rel = arcRel(g, Math.atan2(x.y - g.c.y, x.x - g.c.x)), tol = CUT_EPS * g.span;
  return rel <= g.span + tol || rel >= TAU - tol;
}

// The points where the CARRIERS of g and h cross (a line's infinite line, an arc's whole circle): 0, 1 or 2 points. Parallel lines and
// concentric circles never cross (an overlap is no cut).
function carrierCrossings(g, h) {
  const circ = (k) => (k.kind === 'line' ? null : { c: k.c, r: k.r });
  const cg = circ(g), ch = circ(h);
  if (!cg && !ch) {
    const d1x = g.b.x - g.a.x, d1y = g.b.y - g.a.y, d2x = h.b.x - h.a.x, d2y = h.b.y - h.a.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-10) return [];
    const t = ((h.a.x - g.a.x) * d2y - (h.a.y - g.a.y) * d2x) / den;
    return [{ x: g.a.x + t * d1x, y: g.a.y + t * d1y }];
  }
  if (!cg || !ch) {
    const ln = cg ? h : g, ci = cg || ch;
    const dx = ln.b.x - ln.a.x, dy = ln.b.y - ln.a.y, L = Math.hypot(dx, dy);
    if (L < 1e-12) return [];
    const ux = dx / L, uy = dy / L, wx = ln.a.x - ci.c.x, wy = ln.a.y - ci.c.y;
    const b = wx * ux + wy * uy, disc = b * b - (wx * wx + wy * wy - ci.r * ci.r);
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    const ks = s === 0 ? [-b] : [-b - s, -b + s];
    return ks.map((k) => ({ x: ln.a.x + k * ux, y: ln.a.y + k * uy }));
  }
  const dx = ch.c.x - cg.c.x, dy = ch.c.y - cg.c.y, d = Math.hypot(dx, dy);
  if (!(d > 1e-12) || d > cg.r + ch.r || d < Math.abs(cg.r - ch.r)) return [];
  const a = (cg.r * cg.r - ch.r * ch.r + d * d) / (2 * d), h2 = Math.max(0, cg.r * cg.r - a * a), hh = Math.sqrt(h2);
  const mx = cg.c.x + a * dx / d, my = cg.c.y + a * dy / d;
  if (hh === 0) return [{ x: mx, y: my }];
  return [{ x: mx + hh * dy / d, y: my - hh * dx / d }, { x: mx - hh * dy / d, y: my + hh * dx / d }];
}

/** Are u and v the same place on curve g (a circle's angle wraps at 2 pi)? */
export const sameU = (g, u, v) => (g.kind === 'circle' ? Math.min(mod2pi(u - v), mod2pi(v - u)) <= CUT_EPS * TAU : Math.abs(u - v) <= CUT_EPS);

/** THE cuts of `target` (a shape): where every OTHER line, arc and circle of the active sketch crosses it (task 659: the active sketch's curves
 *  alone cut), sorted by u, cuts at the same place merged (their cutters together). A line's or an arc's own ends are no cut. -> [{ u, pt, cutters }] */
export function curveCuts(state, target) {
  const g = curveGeom(state, target);
  if (!g) return [];
  const cuts = [];
  for (const other of (state.shapes || [])) {
    if (!other || other.id === target.id || !inActiveSketch(state, other)) continue;
    const h = curveGeom(state, other);
    if (!h) continue;
    for (const x of carrierCrossings(g, h)) {
      if (!onDrawn(g, x) || !onDrawn(h, x)) continue;
      const u = curveParamAt(g, x);
      if (g.kind !== 'circle' && (u <= CUT_EPS || u >= 1 - CUT_EPS)) continue;
      const pt = curvePointAt(g, u);
      const same = cuts.find((k) => sameU(g, k.u, u));
      if (same) { if (!same.cutters.includes(other.id)) same.cutters.push(other.id); }
      else cuts.push({ u, pt, cutters: [other.id] });
    }
  }
  return cuts.sort((p, q) => p.u - q.u);
}

/** The points HELD on curve s by a constraint (task 1018, R2-05: where Break splits at an existing point): a point on it ({ joint, shape }:
 *  pointOnLine, on a circle / an arc too), the midpoint of a line ({ joints: [a, b, m] } on its two ends) or of an arc ({ joint, shape }).
 *  Only the points on the drawn curve, its own ends excluded. -> [{ joint, u, pt }] */
export function heldJointsOn(state, s) {
  const g = curveGeom(state, s);
  if (!g) return [];
  const ends = new Set(s.type === 'line' ? s.joints : s.type === 'arc' ? s.joints.slice(1) : []);
  const out = [];
  for (const c of (state.constraints || [])) {
    if (!c) continue;
    let jid = null;
    if ((c.type === CONSTRAINT_TYPES.POINT_ON_LINE || c.type === CONSTRAINT_TYPES.MIDPOINT) && c.joint && c.shape === s.id) jid = c.joint;
    else if (c.type === CONSTRAINT_TYPES.MIDPOINT && s.type === 'line' && Array.isArray(c.joints) && c.joints.length === 3
      && s.joints.includes(c.joints[0]) && s.joints.includes(c.joints[1])) jid = c.joints[2];
    if (!jid || ends.has(jid) || out.some((o) => o.joint === jid)) continue;
    const p = state.joints.get(jid);
    if (!p) continue;
    const u = curveParamAt(g, p);
    if (g.kind !== 'circle' && (u <= CUT_EPS || u >= 1 - CUT_EPS)) continue;
    const pt = curvePointAt(g, u);
    if (Math.hypot(pt.x - p.x, pt.y - p.y) > 1e-5 * Math.max(1, g.r || Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y))) continue; // held, but not there now
    out.push({ joint: jid, u, pt: { x: p.x, y: p.y } });
  }
  return out;
}

/** The two bounds around parameter uc of curve g with these cuts (curveCuts'): a line's or an arc's ends bound it too ({ u: 0 } / { u: 1 }, no
 *  cutters); a circle has no ends: the cut at or before uc and the next one, wrapping round (a circle needs two cuts, else null). -> [b0, b1] */
export function boundsAround(g, cuts, uc) {
  if (g.kind === 'circle') {
    if (cuts.length < 2) return null;
    let i = -1;
    for (let k = 0; k < cuts.length; k++) if (cuts[k].u <= uc) i = k;
    if (i < 0) i = cuts.length - 1;
    return [cuts[i], cuts[(i + 1) % cuts.length]];
  }
  const bounds = [{ u: 0, pt: curvePointAt(g, 0), cutters: [] }, ...cuts, { u: 1, pt: curvePointAt(g, 1), cutters: [] }];
  for (let i = 0; i < bounds.length - 1; i++) if (uc >= bounds[i].u && uc <= bounds[i + 1].u) return [bounds[i], bounds[i + 1]];
  return null;
}

/** The piece of curve g between parameters u0 and u1 (a circle: from angle u0 growing to u1; whole: the whole circle) as the overlay draws it:
 *  { kind: 'line', a, b } | { kind: 'arc', c, r, from, to, dir, large } | { kind: 'circle', c, r }. */
export function curvePiece(g, u0, u1, whole = false) {
  if (g.kind === 'line') return { kind: 'line', a: curvePointAt(g, u0), b: curvePointAt(g, u1) };
  if (whole) return { kind: 'circle', c: { x: g.c.x, y: g.c.y }, r: g.r };
  const sweep = g.kind === 'arc' ? (u1 - u0) * g.span : mod2pi(u1 - u0);
  return { kind: 'arc', c: { x: g.c.x, y: g.c.y }, r: g.r, from: curvePointAt(g, u0), to: curvePointAt(g, u1), dir: g.kind === 'arc' ? g.dir : 1, large: sweep > Math.PI };
}

/** An arc's or a circle's piece parameters on the ORIGINAL geometry g: is the point p (on the circle) inside the part from u0 to u1? */
export function inPiece(g, u0, u1, p) {
  const u = curveParamAt(g, p);
  if (g.kind === 'circle') return mod2pi(u - u0) <= mod2pi(u1 - u0);
  return u >= u0 - CUT_EPS && u <= u1 + CUT_EPS;
}
