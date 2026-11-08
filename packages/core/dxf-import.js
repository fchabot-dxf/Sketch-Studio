// packages/core/dxf-import.js — DECLARED DXF → #core-shape importer. PURE (no DOM). Same { joints, shapes, stats }
// contract as svg-import's importSvgGeometry, so a host treats both alike. Target: a Fusion 360 sketch saved as DXF
// (AutoCAD R2000+ ASCII): true LINE / ARC / CIRCLE / LWPOLYLINE / SPLINE entities in the ENTITIES section.
//
//   parseDxf(text)                       → { entities, insunits, error? }   (error = a readable string; never throws)
//   importDxfGeometry(parsed, opts)      → { joints, shapes, stats }        (opts = { genJ, idPrefix })
//   importDxf(text, opts)                → importDxfGeometry result | { error }   (the one call a host makes)
//
// Mapping (a DECLARED table, ENTITY_EMITTERS below): LINE → line; CIRCLE → circle; ARC → #core arc (CENTER subType:
// joints [centre, start, end] + explicit largeArc/sweep, exactly what the arc tool stores); LWPOLYLINE / POLYLINE
// with bulges → lines + arcs; SPLINE (clamped, non-rational, degree 2/3) → EXACT cubic beziers, otherwise flattened
// and COUNTED; ELLIPSE → flattened ring/arc at the SVG importer's curve density. Everything else is SKIPPED and
// COUNTED with a reason. Output is STATIC (no constraints), like the SVG import.
//
// Units: $INSUNITS → mm via svg-import's PHYS table. 0/missing/unknown = mm, reported `assumed: true`.
// Y: DXF is Y-up, the world is Y-down → y is negated (an arc's CCW therefore becomes sweep=false).
// Joints: endpoints coinciding within JOINT_TOL × the drawing's diagonal become ONE joint so a closed profile is a
// closed loop. Centres are never merged.

import { PHYS, arcSteps } from './svg-import.js';
import { arcShape } from './import-arcs.js'; // the ONE circular-arc shape helper (shared with the SVG importer's `A` commands)

const JOINT_TOL = 1e-6;          // × drawing diagonal (DXF units)
const TAU = Math.PI * 2;

// $INSUNITS code → mm per drawing unit (derived from PHYS; ft and m are exact multiples of in / cm).
const INSUNITS_MM = { 1: PHYS.in, 2: PHYS.in * 12, 4: PHYS.mm, 5: PHYS.cm, 6: PHYS.cm * 100 };
const INSUNITS_LABEL = { 1: 'inches', 2: 'feet', 4: 'mm', 5: 'cm', 6: 'metres' };

// CONSTRUCTION geometry: Fusion writes a sketch's construction lines with linetype DASHED (the real export in
// tests/fixtures/dxf/fusion-sketch4.dxf: 4 of its 6 LINEs, every entity on layer 0). Declared ONCE: a dashed-family linetype (group 6) or a
// layer named *construction* (a common CAD convention; NOT seen in a Fusion file, kept as a bonus) imports as construction geometry.
const CONSTRUCTION = { linetype: /^(dashed|hidden|center|phantom|dot)/i, layer: /construction/i };
const isConstruction = (e) => {
  const lt = e.pairs.find((q) => q[0] === 6), ly = e.pairs.find((q) => q[0] === 8);
  return !!((lt && CONSTRUCTION.linetype.test(lt[1])) || (ly && CONSTRUCTION.layer.test(ly[1])));
};

const SKIP_REASON = {
  TEXT: 'text not imported', MTEXT: 'text not imported', ATTRIB: 'text not imported', ATTDEF: 'text not imported',
  DIMENSION: 'dimension not imported', LEADER: 'dimension not imported', MLEADER: 'dimension not imported',
  HATCH: 'hatch not imported', INSERT: 'block reference (INSERT) not expanded',
  // Fusion writes every sketch point (the origin, centre / reference points) as a POINT. A lone point is nothing to cut or loop, so it
  // is SKIPPED and COUNTED rather than minted as a free joint that would clutter the sketch.
  POINT: 'sketch point (a reference / centre point: nothing to cut)',
};

// ── parse ───────────────────────────────────────────────────────────────────────────────────────────────
const NUMERIC_CODE = (c) => (c >= 10 && c <= 59) || (c >= 70 && c <= 79) || (c >= 210 && c <= 239);

// → { entities:[{ type, pairs:[[code,value]…], vertices? }], insunits, error? }
export function parseDxf(text) {
  const fail = (error) => ({ entities: [], insunits: 0, error });
  if (typeof text !== 'string' || !text.trim()) return fail('Empty file');
  if (text.startsWith('AutoCAD Binary DXF')) return fail('Binary DXF is not supported — save the sketch as ASCII DXF');
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (lines[i].trim() === '' || !Number.isInteger(code)) return fail(`Not a DXF file (bad group code "${lines[i].trim().slice(0, 20)}" at line ${i + 1})`);
    const value = lines[i + 1].trim();
    if (NUMERIC_CODE(code) && !isFinite(Number(value))) return fail(`Bad number "${value.slice(0, 20)}" for group ${code} at line ${i + 2}`);
    pairs.push([code, value]);
  }
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION') || !pairs.some(([c, v]) => c === 0 && v === 'EOF')) {
    return fail('Not a DXF file (no SECTION / EOF markers — truncated?)');
  }

  let insunits = 0, section = '', haveEntities = false, hdrVar = '';
  const entities = []; let cur = null, poly = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, v] = pairs[i];
    if (code === 0 && v === 'SECTION') { section = (pairs[i + 1] && pairs[i + 1][0] === 2) ? pairs[i + 1][1] : ''; cur = null; poly = null; if (section === 'ENTITIES') haveEntities = true; continue; }
    if (code === 0 && v === 'ENDSEC') { section = ''; cur = null; poly = null; continue; }
    if (section === 'HEADER') {
      if (code === 9) hdrVar = v;
      else if (hdrVar === '$INSUNITS' && code === 70) { insunits = Number(v); hdrVar = ''; }
      continue;
    }
    if (section !== 'ENTITIES') continue;
    if (code === 0) {
      if (v === 'VERTEX' && poly) { cur = { type: v, pairs: [] }; poly.vertices.push(cur); continue; }
      if (v === 'SEQEND') { poly = null; cur = null; continue; }
      cur = { type: v, pairs: [] };
      entities.push(cur);
      poly = v === 'POLYLINE' ? (cur.vertices = [], cur) : null;
    } else if (cur) cur.pairs.push([code, v]);
  }
  if (!haveEntities) return fail('Not a DXF file (no ENTITIES section)');
  return { entities, insunits };
}

const first = (pairs, code, dflt = 0) => { const p = pairs.find((q) => q[0] === code); return p ? Number(p[1]) : dflt; };
const all = (pairs, code) => pairs.filter((q) => q[0] === code).map((q) => Number(q[1]));

// ── entity → primitives (DXF units, Y-up) ───────────────────────────────────────────────────────────────
// Primitive kinds: { k:'line', a, b } | { k:'circle', c, r } | { k:'arc', c, r, s, e, ccw, large } (a, b, c, s, e = [x,y])
// | { k:'bezier', p0, p3, c1, c2 } | { k:'poly', pts, closed }.
function arcFromAngles(c, r, a0deg, a1deg) {
  const a0 = a0deg * Math.PI / 180;
  let span = (((a1deg - a0deg) * Math.PI / 180) % TAU + TAU) % TAU;
  if (span < 1e-12) span = TAU;
  const pt = (a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  return { k: 'arc', c, r, s: pt(a0), e: pt(a0 + span), ccw: true, large: span > Math.PI };
}

// bulge from p to q (DXF Y-up): positive = counter-clockwise. tan(angle/4) = bulge.
function bulgeSegment(p, q, b) {
  if (Math.abs(b) < 1e-12) return { k: 'line', a: p, b: q };
  const dx = q[0] - p[0], dy = q[1] - p[1], chord = Math.hypot(dx, dy);
  if (!(chord > 0)) return null;
  const off = (1 - b * b) / (4 * b);                    // centre offset along the (unit-chord) left normal
  const c = [(p[0] + q[0]) / 2 - dy * off, (p[1] + q[1]) / 2 + dx * off];
  return { k: 'arc', c, r: chord * (1 + b * b) / (4 * Math.abs(b)), s: p, e: q, ccw: b > 0, large: Math.abs(b) > 1 };
}

function polylinePrims(verts, closed) {
  const prims = [];
  const n = verts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const v = verts[i], w = verts[(i + 1) % n];
    const s = bulgeSegment([v.x, v.y], [w.x, w.y], v.bulge || 0);
    if (s) prims.push(s);
  }
  return prims;
}

function deBoor(U, P, p, t) {          // P = [[x,y,w]] homogeneous; returns [x,y]
  const n = P.length - 1;
  let k = p; while (k < n && U[k + 1] <= t) k++;
  const d = []; for (let j = 0; j <= p; j++) d.push(P[j + k - p].slice());
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const den = U[j + 1 + k - r] - U[j + k - p];
      const a = den > 0 ? (t - U[j + k - p]) / den : 0;
      for (let m = 0; m < 3; m++) d[j][m] = (1 - a) * d[j - 1][m] + a * d[j][m];
    }
  }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}

function insertKnot(U, P, p, u) {      // Boehm: one insertion of u (non-end knot) → new { U, P }
  let k = 0; while (k + 1 < U.length && U[k + 1] <= u) k++;
  const Q = [];
  for (let i = 0; i <= P.length; i++) {
    if (i <= k - p) Q.push(P[i]);
    else if (i <= k) {
      const a = (u - U[i]) / (U[i + p] - U[i]);
      Q.push([a * P[i][0] + (1 - a) * P[i - 1][0], a * P[i][1] + (1 - a) * P[i - 1][1]]);
    } else Q.push(P[i - 1]);
  }
  return { U: [...U.slice(0, k + 1), u, ...U.slice(k + 1)], P: Q };
}

// → { prims, flattened:boolean } | { reason }
function splinePrims(pairs) {
  const flags = first(pairs, 70), p = first(pairs, 71);
  const U = all(pairs, 40), W = all(pairs, 41);
  const xs = all(pairs, 10), ys = all(pairs, 20), fx = all(pairs, 11), fy = all(pairs, 21);
  const ctrl = xs.map((x, i) => [x, ys[i] || 0]);
  const wts = ctrl.map((_, i) => (W.length === ctrl.length ? W[i] : 1));
  const rational = wts.some((w) => Math.abs(w - 1) > 1e-9);
  const valid = ctrl.length >= p + 1 && p >= 1 && U.length === ctrl.length + p + 1 && U.every((u, i) => i === 0 || u >= U[i - 1]);
  const clamped = valid && U.slice(0, p + 1).every((u) => u === U[0]) && U.slice(-(p + 1)).every((u) => u === U[U.length - 1]);
  const periodic = (flags & 2) !== 0;

  if (valid && clamped && !rational && !periodic && p === 1) return { prims: [{ k: 'poly', pts: ctrl, closed: false }], flattened: false };
  if (valid && clamped && !rational && !periodic && (p === 2 || p === 3)) {
    let cu = U, cp = ctrl;
    const interior = [...new Set(U.slice(p + 1, U.length - p - 1))];
    for (const u of interior) {
      let m = cu.filter((x) => x === u).length;
      for (; m < p; m++) ({ U: cu, P: cp } = insertKnot(cu, cp, p, u));
    }
    const prims = [];
    for (let i = 0; i + p < cp.length; i += p) {
      const seg = cp.slice(i, i + p + 1);
      const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const c1 = p === 3 ? seg[1] : lerp(seg[0], seg[1], 2 / 3), c2 = p === 3 ? seg[2] : lerp(seg[2], seg[1], 2 / 3);
      prims.push({ k: 'bezier', p0: seg[0], p3: seg[p], c1, c2 });
    }
    return { prims, flattened: false };
  }
  if (valid && p >= 1) {                                   // rational / periodic / unclamped / degree > 3: sample the curve
    const P = ctrl.map((c, i) => [c[0] * wts[i], c[1] * wts[i], wts[i]]);
    const t0 = U[p], t1 = U[ctrl.length], pts = [];
    const spans = [...new Set(U.filter((u) => u >= t0 && u <= t1))];
    for (let s = 0; s + 1 < spans.length; s++) {
      const n = arcSteps(Math.PI / 2);
      for (let j = (s === 0 ? 0 : 1); j <= n; j++) {
        const t = spans[s] + (spans[s + 1] - spans[s]) * (j / n);
        pts.push(deBoor(U, P, p, Math.min(t, t1)));
      }
    }
    if (pts.length >= 2) return { prims: [{ k: 'poly', pts, closed: false }], flattened: true };
  }
  if (fx.length >= 2) return { prims: [{ k: 'poly', pts: fx.map((x, i) => [x, fy[i] || 0]), closed: (flags & 1) !== 0 }], flattened: true };
  if (ctrl.length >= 2) return { prims: [{ k: 'poly', pts: ctrl, closed: (flags & 1) !== 0 }], flattened: true };
  return { reason: 'SPLINE with no usable control or fit points' };
}

// Each emitter: (entity, ctx) → void. ctx = { prims, skip(tag, reason), flattened(tag, reason) }.
const ENTITY_EMITTERS = {
  LINE(e, ctx) { const p = e.pairs; ctx.prims.push({ k: 'line', a: [first(p, 10), first(p, 20)], b: [first(p, 11), first(p, 21)] }); },
  CIRCLE(e, ctx) {
    const r = first(e.pairs, 40);
    if (!(r > 0)) return ctx.skip('CIRCLE', 'zero radius');
    ctx.prims.push({ k: 'circle', c: [first(e.pairs, 10), first(e.pairs, 20)], r });
  },
  ARC(e, ctx) {
    const r = first(e.pairs, 40);
    if (!(r > 0)) return ctx.skip('ARC', 'zero radius');
    ctx.prims.push(arcFromAngles([first(e.pairs, 10), first(e.pairs, 20)], r, first(e.pairs, 50), first(e.pairs, 51)));
  },
  LWPOLYLINE(e, ctx) {
    const verts = [];
    for (const [c, v] of e.pairs) {
      if (c === 10) verts.push({ x: Number(v), y: 0, bulge: 0 });
      else if (c === 20 && verts.length) verts[verts.length - 1].y = Number(v);
      else if (c === 42 && verts.length) verts[verts.length - 1].bulge = Number(v);
    }
    if (verts.length < 2) return ctx.skip('LWPOLYLINE', 'fewer than 2 vertices');
    ctx.prims.push(...polylinePrims(verts, (first(e.pairs, 70) & 1) !== 0));
  },
  POLYLINE(e, ctx) {
    const flags = first(e.pairs, 70);
    if (flags & (16 | 64)) return ctx.skip('POLYLINE', 'mesh / polyface not supported');
    const verts = (e.vertices || []).filter((v) => !(first(v.pairs, 70) & 16))
      .map((v) => ({ x: first(v.pairs, 10), y: first(v.pairs, 20), bulge: first(v.pairs, 42) }));
    if (verts.length < 2) return ctx.skip('POLYLINE', 'fewer than 2 vertices');
    ctx.prims.push(...polylinePrims(verts, (flags & 1) !== 0));
  },
  SPLINE(e, ctx) {
    const r = splinePrims(e.pairs);
    if (r.reason) return ctx.skip('SPLINE', r.reason);
    ctx.prims.push(...r.prims);
    if (r.flattened) ctx.flattened('SPLINE', 'flattened to line segments (not an exact curve)');
  },
  ELLIPSE(e, ctx) {
    const p = e.pairs, c = [first(p, 10), first(p, 20)], M = [first(p, 11), first(p, 21)], ratio = first(p, 40, 1);
    let t0 = first(p, 41, 0), t1 = first(p, 42, TAU);
    if (!(Math.hypot(M[0], M[1]) > 0) || !(ratio > 0)) return ctx.skip('ELLIPSE', 'zero radius');
    let span = t1 - t0; if (span <= 0) span += TAU;
    const full = Math.abs(span - TAU) < 1e-9;
    const n = arcSteps(span), pts = [];
    for (let k = 0; k <= (full ? n - 1 : n); k++) {
      const t = t0 + span * (k / n);
      pts.push([c[0] + Math.cos(t) * M[0] - Math.sin(t) * ratio * M[1], c[1] + Math.cos(t) * M[1] + Math.sin(t) * ratio * M[0]]);
    }
    ctx.prims.push({ k: 'poly', pts, closed: full });
    ctx.flattened('ELLIPSE', 'flattened to line segments (no ellipse shape)');
  },
};

// ── primitives → joints + shapes ────────────────────────────────────────────────────────────────────────
export function importDxfGeometry(parsed, { genJ, idPrefix = 'dxf' } = {}) {
  const joints = [], shapes = [], skipped = [];
  const bump = (tag, reason, n = 1) => { const e = skipped.find((s) => s.tag === tag && s.reason === reason); if (e) e.count += n; else skipped.push({ tag, reason, count: n }); };
  const units = INSUNITS_MM[parsed.insunits] != null
    ? { scale: INSUNITS_MM[parsed.insunits], label: INSUNITS_LABEL[parsed.insunits], assumed: false }
    : { scale: 1, label: 'mm', assumed: true };
  const stats = { shapeCount: 0, jointCount: 0, skipped, scale: units.scale, label: units.label, assumed: units.assumed, flattened: 0, construction: 0, insunits: parsed.insunits || 0 };

  const prims = [];
  const ctx = {
    prims,
    skip: (tag, reason) => bump(tag, reason),
    flattened: (tag, reason) => { stats.flattened++; bump(tag, reason); },
  };
  for (const e of (parsed.entities || [])) {
    if (first(e.pairs, 67) === 1) { bump(e.type, 'paper space entity'); continue; }
    if (first(e.pairs, 230, 1) < 0) { bump(e.type, 'mirrored extrusion (OCS) not supported'); continue; }
    const emit = ENTITY_EMITTERS[e.type];
    if (emit) { const n0 = prims.length; emit(e, ctx); if (isConstruction(e)) for (let i = n0; i < prims.length; i++) prims[i].con = true; }
    else bump(e.type, SKIP_REASON[e.type] || 'entity type not supported');
  }

  // Drawing diagonal → the joint-merge tolerance.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (pt) => { minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]); minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]); };
  for (const q of prims) {
    if (q.k === 'line') { ext(q.a); ext(q.b); }
    else if (q.k === 'circle') { ext([q.c[0] - q.r, q.c[1] - q.r]); ext([q.c[0] + q.r, q.c[1] + q.r]); }
    else if (q.k === 'arc') { ext(q.s); ext(q.e); ext([q.c[0] - q.r, q.c[1] - q.r]); ext([q.c[0] + q.r, q.c[1] + q.r]); }
    else if (q.k === 'bezier') { ext(q.p0); ext(q.p3); ext(q.c1); ext(q.c2); }
    else q.pts.forEach(ext);
  }
  const diag = prims.length ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const tol = Math.max(diag * JOINT_TOL, Number.EPSILON);

  const sc = units.scale;
  const out = (pt) => ({ x: pt[0] * sc, y: -pt[1] * sc });     // DXF Y-up → world Y-down
  const cells = new Map();                                      // endpoint merge: spatial hash on a `tol` grid
  const cellKey = (i, j) => i + ',' + j;
  const endpoint = (pt) => {
    const ci = Math.floor(pt[0] / tol), cj = Math.floor(pt[1] / tol);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const h of (cells.get(cellKey(ci + di, cj + dj)) || [])) if (Math.hypot(h.x - pt[0], h.y - pt[1]) <= tol) return h.id;
    }
    const id = genJ(), o = out(pt);
    joints.push({ id, x: o.x, y: o.y });
    const key = cellKey(ci, cj); if (!cells.has(key)) cells.set(key, []); cells.get(key).push({ x: pt[0], y: pt[1], id });
    return id;
  };
  const centre = (pt) => { const id = genJ(), o = out(pt); joints.push({ id, x: o.x, y: o.y }); return id; };
  let nShape = 0;
  const SID = () => idPrefix + '_s' + (nShape++);
  const line = (a, b) => { const ja = endpoint(a), jb = endpoint(b); if (ja === jb) return bump('LINE', 'zero-length segment'); shapes.push({ id: SID(), type: 'line', joints: [ja, jb] }); };

  for (const q of prims) {
    const n0 = shapes.length;
    if (q.k === 'line') line(q.a, q.b);
    else if (q.k === 'circle') shapes.push({ id: SID(), type: 'circle', joints: [centre(q.c)], radius: q.r * sc });
    else if (q.k === 'arc') {
      const js = endpoint(q.s), je = endpoint(q.e);
      shapes.push(arcShape(SID(), centre(q.c), js, je, { largeArc: q.large, sweep: !q.ccw }));
    } else if (q.k === 'bezier') {
      const o1 = out(q.c1), o2 = out(q.c2);
      shapes.push({ id: SID(), type: 'bezier', joints: [endpoint(q.p0), endpoint(q.p3)], c1: [o1.x, o1.y], c2: [o2.x, o2.y] });
    } else {
      for (let i = 0; i + 1 < q.pts.length; i++) line(q.pts[i], q.pts[i + 1]);
      if (q.closed && q.pts.length > 2) line(q.pts[q.pts.length - 1], q.pts[0]);
    }
    if (q.con) { for (let i = n0; i < shapes.length; i++) shapes[i].isConstruction = true; stats.construction += shapes.length - n0; }
  }
  stats.shapeCount = shapes.length; stats.jointCount = joints.length;
  return { joints, shapes, stats };
}

export function importDxf(text, opts) {
  const parsed = parseDxf(text);
  if (parsed.error) return { error: parsed.error };
  return importDxfGeometry(parsed, opts);
}

// True when the file name or the content says DXF (a host's one import entry picks the parser with this).
export function looksLikeDxf(name, text) {
  if (/\.dxf$/i.test(name || '')) return true;
  if (/\.svg$/i.test(name || '')) return false;
  return /^\s*0\s*\r?\n\s*SECTION\s*\r?\n/.test(String(text || '').slice(0, 200));
}
