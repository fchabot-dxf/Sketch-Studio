// Export manager: build SVG or DXF exports from sketch data (lines, arcs and, TASK 761, beziers: a cubic `C` / in a DXF its sampled points, TASK 1043); TASK 1043: both from ONE decomposition
// (exportOutlines: closed outlines + open chains), an SVG closed <path>s, a DXF closed R12 POLYLINEs
import { CONSTRAINT_TYPES } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { arcSweepInfo } from '#core/geometry.js';
import { CURVE_KINDS, bezierPoints, exportedShapes } from '#core/curve-kinds.js'; // TASK 761: a bezier's control points / sampled points, declared once; TASK 1036: what is exported (BUG-300's rule, moved there)
import { track } from '#ui/analytics.js'; // TASK 738
import { findLoops, findOpenChains, buildNodeMap, curveEnds } from '#core/loop-finder.js'; // TASK 1040 / 1043: the closed outlines and open chains an export writes (the finder Shaper reads)
import { chainWalk } from '#core/loop-geometry.js'; // TASK 1040: an open chain's walk, end to end (the one chainToPathD writes)

// Task 614: the stroke width of an export when the caller passes none. A DECLARED export constant (was the LINE_STROKE display knob, whose
// factory value was 1): a display look never changes what is exported.
export const EXPORT_STROKE_WIDTH = 1;

// BUG-300 (F-81 / F-81b): what an export writes is #core/curve-kinds.js exportedShapes (the drawn kinds, never construction), for the SVG and the DXF
// writer (and the design thumbnail, TASK 1036).

function getJointPos(state, jid) {
  const j = state.joints.get(jid);
  return j ? { x: j.x, y: j.y } : null;
}

function formatNum(n, precision=6) { return Number(n).toFixed(precision); }

function sampleArcPoints(cx, cy, r, startAngle, endAngle, sweep, segments) {
  // Normalize sweep direction and compute total angle (CCW if sweep===true)
  let a0 = startAngle;
  let a1 = endAngle;
  // compute delta in range -PI..PI
  let delta = a1 - a0;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;

  let total = delta;
  if (sweep && total < 0) total += Math.PI * 2;
  if (!sweep && total > 0) total -= Math.PI * 2;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const ang = a0 + total * t;
    pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
  return pts;
}

function sampleCirclePoints(cx, cy, r, segments) {
  const pts = [];
  for (let i = 0; i <= segments; i++) { const a = 2 * Math.PI * i / segments; pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return pts;
}

// TASK 1040 (BUG-401) / TASK 1043 (BUG-402): WHAT an export writes, read ONCE for both writers (buildSVG and buildDXF) from the app's ONE closed-shape
// finder (#core/loop-finder.js, the one Shaper's Prepare and cut file read), on the exported shapes only (exportedShapes: never construction):
//   outlines: every closed outline (findLoops: lines, arcs, beziers, mixed), as { circle } (a circle) or { steps } (its walk, one step per curve);
//   chains:   every other curve, in the open chains (findOpenChains), each chain its strokes (#core/loop-geometry.js chainWalk), each stroke its steps.
// A step = { shape, fromP, toP, forward }: the curve walked from the point `fromP` to `toP`, `forward` = from its kind's start end. EVERY CURVE IS IN ONE
// STEP: an outline is kept closed only when none of its curves is taken yet (the finder's order); a loop that shares a curve with one taken before (a
// rectangle with a divider: the two halves share it) leaves its other curves to the open chains. A step's ends are its NODES' points (the coincident
// joints merged, buildNodeMap's one joint per node), so two curves meeting at a node are written meeting at the very same point.
// → null (nothing to export) | { shapes, outlines, chains }
function exportOutlines(state) {
  const shapes = exportedShapes(state);
  if (shapes.length === 0) return null;
  const J = (jid) => state.joints.get(jid);
  const view = { joints: state.joints, shapes, constraints: state.constraints || [] };
  const node = buildNodeMap(view);
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const taken = new Set();
  const closed = [];
  for (const loop of findLoops(view)) {
    if (new Set(loop.edges).size !== loop.edges.length || loop.edges.some((id) => taken.has(id))) continue;
    closed.push(loop);
    for (const id of loop.edges) taken.add(id);
  }
  // the loop's walk: edge k joins node k to node k + 1 (the last one closes back to node 0)
  const outlines = closed.map((loop) => {
    const first = byId.get(loop.edges[0]);
    if (first.type === 'circle') return { circle: first };
    const n = loop.joints.length;
    return { steps: loop.edges.map((id, k) => { const s = byId.get(id), from = loop.joints[k]; return { shape: s, fromP: J(from), toP: J(loop.joints[(k + 1) % n]), forward: node(curveEnds(s)[0]) === from }; }) };
  });
  const atNode = (st) => { const [a, b] = curveEnds(st.shape); return { ...st, fromP: J(node(st.forward ? a : b)), toP: J(node(st.forward ? b : a)) }; };
  const chains = findOpenChains(view, closed).map((chain) => chainWalk(chain, view).map((stroke) => stroke.map(atNode)));
  return { shapes, outlines, chains };
}

export function buildSVG(state, opts = {}) {
  const precision = (typeof opts.precision === 'number') ? opts.precision : 6;
  const scale = (typeof opts.scale === 'number') ? opts.scale : 1;
  const invertY = !!opts.invertY;
  const arcApprox = !!opts.arcApprox;
  const arcSeg = parseInt(opts.arcSeg || 32, 10) || 32;
  const lineCap = opts.lineCap || SettingsManager.get('LINE_CAP') || 'round';
  const lineJoin = opts.lineJoin || SettingsManager.get('LINE_JOIN') || 'round';
  const lineStroke = (typeof opts.strokeWidth === 'number') ? opts.strokeWidth : EXPORT_STROKE_WIDTH;

  const out = exportOutlines(state);
  if (!out) return null;
  const { shapes } = out;

  // TASK 1036 (BUG-371, N-3): THE Y flip of the SVG export: every point written (an outline's / a path's points, an arc's end, a circle's centre, a
  // bezier's control points, a sampled curve's points) goes through it; a mirror also turns an arc's direction round (`turn`).
  const transform = (p) => {
    let x = p.x * scale;
    let y = p.y * scale;
    if (invertY) y = -y;
    return { x, y };
  };
  const turn = invertY ? -1 : 1;
  const xy = (q) => `${formatNum(q.x, precision)} ${formatNum(q.y, precision)}`;
  const J = (jid) => state.joints.get(jid);

  // The page (viewBox): each exported shape by its points as written: a line's ends, an arc's / a circle's centre +- its radius, a bezier's control
  // points (with arcApprox its sampled points)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (q) => { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); };
  const growRound = (c, r0) => { const q = transform(c), r = r0 * scale; grow({ x: q.x - r, y: q.y - r }); grow({ x: q.x + r, y: q.y + r }); };
  for (const s of shapes) {
    if (s.type === 'line') { const a = J(s.joints[0]), b = J(s.joints[1]); if (a && b) { grow(transform(a)); grow(transform(b)); } }
    else if (s.type === 'arc') { const c = J(s.joints[0]), st = J(s.joints[1]), en = J(s.joints[2]); if (c && st && en) growRound(c, Math.hypot(st.x - c.x, st.y - c.y)); }
    else if (s.type === 'circle') { const c = J(s.joints[0]); if (c && s.radius > 0) growRound(c, s.radius); }
    else if (s.type === 'bezier') { const P = bezierPoints(s, state.joints); if (P) (arcApprox ? CURVE_KINDS.bezier.points(s, state) : P).map(transform).forEach(grow); }
  }
  if (minX === Infinity) return null;

  // ONE curve as path text from `fromP` to `toP` (no M), walked `forward` (from its kind's start end) or back: a line `L`; an arc `A` turning the way
  // it is walked (TASK 550: the direction and large-arc from the one arc-sweep function), with arcApprox its sampled points as `L`s; a bezier `C`
  // (its control points in the walk's order), with arcApprox its sampled points.
  const seg = (s, fromP, toP, forward) => {
    if (s.type === 'arc') {
      const c0 = J(s.joints[0]), st0 = J(s.joints[1]), en0 = J(s.joints[2]);
      const info = arcSweepInfo(c0, st0, en0, { sweep: s.sweep });
      const dir = forward ? info.dir : -info.dir;   // the direction the walk turns
      const r0 = Math.hypot(st0.x - c0.x, st0.y - c0.y);
      if (arcApprox) {
        const a0 = Math.atan2(fromP.y - c0.y, fromP.x - c0.x), a1 = Math.atan2(toP.y - c0.y, toP.x - c0.x);
        return sampleArcPoints(c0.x, c0.y, r0, a0, a1, dir > 0, arcSeg).slice(1).map((p) => `L ${xy(transform(p))}`).join(' ');
      }
      const r = formatNum(r0 * scale, precision);
      return `A ${r} ${r} 0 ${info.large ? 1 : 0} ${dir * turn > 0 ? 1 : 0} ${xy(transform(toP))}`;   // as written: mirrored, the arc turns the other way
    }
    if (s.type === 'bezier') {
      if (arcApprox) { const pts = CURVE_KINDS.bezier.points(s, state); return (forward ? pts : pts.slice().reverse()).slice(1).map((p) => `L ${xy(transform(p))}`).join(' '); }
      const P = bezierPoints(s, state.joints);
      const [c1, c2] = forward ? [P[1], P[2]] : [P[2], P[1]];
      return `C ${xy(transform(c1))} ${xy(transform(c2))} ${xy(transform(toP))}`;
    }
    return `L ${xy(transform(toP))}`;
  };
  const elems = [];
  const pathEl = (d) => elems.push(`<path d="${d}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" fill="none" />`);

  // TASK 1040 (BUG-401): what is written is exportOutlines' decomposition (the one the DXF writes too): every closed outline is ONE closed <path ... Z>,
  // a circle stays a <circle>, every open chain ONE <path> (a stroke per M); every curve written once.
  for (const o of out.outlines) {
    if (o.circle) { // BUG-300 (F-81): a circle as a <circle> (or, with arcApprox, its sampled closed polyline)
      const first = o.circle, c0 = J(first.joints[0]);
      if (!(first.radius > 0)) continue;
      if (arcApprox) {
        const pts = sampleCirclePoints(c0.x, c0.y, first.radius, arcSeg).map(transform);
        elems.push(`<polyline points="${pts.map((p) => `${formatNum(p.x, precision)},${formatNum(p.y, precision)}`).join(' ')}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" fill="none" />`);
      } else {
        const center = transform(c0);
        elems.push(`<circle cx="${formatNum(center.x, precision)}" cy="${formatNum(center.y, precision)}" r="${formatNum(first.radius * scale, precision)}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" fill="none" />`);
      }
      continue;
    }
    // a line closing the outline is left to Z
    const n = o.steps.length;
    let d = `M ${xy(transform(o.steps[0].fromP))}`;
    o.steps.forEach((st, k) => { if (!(k === n - 1 && st.shape.type === 'line')) d += ' ' + seg(st.shape, st.fromP, st.toP, st.forward); });
    pathEl(d + ' Z');
  }
  for (const strokes of out.chains) {
    const d = strokes.map((stroke) => `M ${xy(transform(stroke[0].fromP))} ` + stroke.map((st) => seg(st.shape, st.fromP, st.toP, st.forward)).join(' ')).join(' ');
    if (d) pathEl(d);
  }

  // Default viewBox padding
  const pad = Math.max((maxX - minX), (maxY - minY)) * 0.05 || 10;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const width = maxX - minX, height = maxY - minY;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNum(minX, precision)} ${formatNum(minY, precision)} ${formatNum(width, precision)} ${formatNum(height, precision)}">\n  <g fill="none" stroke="black">\n    ${elems.join('\n    ')}\n  </g>\n</svg>`;
  return svg;
}

function deg(v) { return (v * 180 / Math.PI); }

export function buildDXF(state, opts = {}) {
  const precision = (typeof opts.precision === 'number') ? opts.precision : 6;
  const scale = (typeof opts.scale === 'number') ? opts.scale : 1;
  const arcApprox = !!opts.arcApprox;
  const arcSeg = parseInt(opts.arcSeg || 32, 10) || 32;

  const out = exportOutlines(state);
  if (!out) return null;

  // BUG-301 (F-84): DXF is Y-up and the world is Y-down, so the DXF writer ALWAYS negates Y (the importer, #core/dxf-import, negates it back); the
  // Export view's "Invert Y axis" box is for SVG only and does not reach a DXF. Everything below is computed from the points AS WRITTEN (`to`), so an
  // arc's angles and direction are the ones of the DXF's own plane.
  const flip = true;
  const to = (p) => ({ x: p.x * scale, y: (flip ? -p.y : p.y) * scale });
  const f = (v) => formatNum(v, precision);
  const J = (jid) => getJointPos(state, jid);

  const lines = [];
  lines.push('0','SECTION','2','ENTITIES');
  const lineEnt = (a0, b0) => { const a = to(a0), b = to(b0); lines.push('0','LINE','8','0','10',f(a.x),'20',f(a.y),'11',f(b.x),'21',f(b.y)); };
  const arcEnt = (s) => {
    const c0 = J(s.joints[0]), st0 = J(s.joints[1]), en0 = J(s.joints[2]);
    const c = to(c0), st = to(st0), en = to(en0);
    const r = Math.hypot(st.x - c.x, st.y - c.y);
    let startAngle = deg(Math.atan2(st.y - c.y, st.x - c.x));
    let endAngle = deg(Math.atan2(en.y - c.y, en.x - c.x));
    if (startAngle < 0) startAngle += 360; if (endAngle < 0) endAngle += 360;
    // a DXF ARC runs counter-clockwise (increasing angle) from 50 to 51: an arc in the decreasing direction is written end -> start
    // (TASK 550: the direction from the one arc-sweep function, so a fillet arc without a stored flag is written the way it is drawn;
    // negating Y turns the direction round)
    const dir = arcSweepInfo(c0, st0, en0, { sweep: s.sweep }).dir * (flip ? -1 : 1);
    if (dir < 0) { const tmp = startAngle; startAngle = endAngle; endAngle = tmp; }
    lines.push('0','ARC','8','0','10',f(c.x),'20',f(c.y),'40',f(r),'50',f(startAngle),'51',f(endAngle));
  };
  // TASK 1043 (BUG-402): ONE R12 polyline: POLYLINE (66 = 1: vertices follow; its 10 / 20 / 30 the R12 dummy point 0; flag 70: 1 closed, 0 open), a VERTEX
  // per point of `verts` = [{ p (world), bulge }], then SEQEND. A vertex's bulge (42) is the segment to the next one (0 a line; tan(sweep / 4) an arc, positive
  // counter-clockwise in the DXF's Y-up plane). NOT an LWPOLYLINE: Fusion's DXF import refuses LWPOLYLINE files (measured by the advisor 2026-11-27, with and
  // without a HEADER: "InternalValidationError : bRet") and reads this R12 form (a closed slot: 2 lines + 2 arcs, 1 profile); the Export view's default is
  // R12. A bulge is written with the decimals that keep the arc read back as exact as a written coordinate: an error e in a bulge b on a chord c moves the
  // arc's centre (and radius) by about c e / (4 b^2), so it takes `precision` + log10(c / (4 b^2)) decimals (a nearly flat arc of a large radius needs more
  // than its coordinates' decimals)
  const polyEnt = (verts, closed) => {
    lines.push('0','POLYLINE','8','0','66','1','10',f(0),'20',f(0),'30',f(0),'70',closed ? '1' : '0');
    verts.forEach((v, i) => {
      const q = to(v.p);
      lines.push('0','VERTEX','8','0','10', f(q.x), '20', f(q.y));
      if (!v.bulge) return;
      const w = to(verts[(i + 1) % verts.length].p), c = Math.hypot(w.x - q.x, w.y - q.y);
      lines.push('42', formatNum(v.bulge, Math.min(20, precision + Math.max(0, Math.ceil(Math.log10(c / (4 * v.bulge * v.bulge)))))));
    });
    lines.push('0','SEQEND','8','0');
  };
  // a step's vertices, its end left out (the next step's start): a line its start; an arc its start with the bulge of its sweep turning the way it is walked
  // (the one arc-sweep function; negating Y turns it round), with arcApprox its sampled points (arcSeg segments) as straight segments; a bezier ALWAYS its
  // sampled points, the kind's own sampling (#core/curve-kinds CURVE_KINDS.bezier.points: chord deviation <= CURVE_TOLERANCE_MM, 0.005 mm, the tolerance the
  // hold part / pocket clearing / plotter polylines stand for a curve at), from the walk's own end points. TASK 1043 (BUG-421): NO SPLINE is written: a
  // headerless R12 DXF cannot carry one, and Fusion's DXF import refuses any file holding a SPLINE (the advisor, measured 2026-11-27), so an outline with a
  // bezier is ONE closed POLYLINE too
  const stepVerts = (st) => {
    const s = st.shape;
    if (s.type === 'arc') {
      const c0 = J(s.joints[0]), st0 = J(s.joints[1]), en0 = J(s.joints[2]);
      const info = arcSweepInfo(c0, st0, en0, { sweep: s.sweep });
      const dir = st.forward ? info.dir : -info.dir;
      if (!arcApprox) return [{ p: st.fromP, bulge: dir * (flip ? -1 : 1) * Math.tan(info.span / 4) }];
      const a0 = Math.atan2(st.fromP.y - c0.y, st.fromP.x - c0.x), a1 = Math.atan2(st.toP.y - c0.y, st.toP.x - c0.x);
      const pts = sampleArcPoints(c0.x, c0.y, Math.hypot(st0.x - c0.x, st0.y - c0.y), a0, a1, dir > 0, arcSeg);
      return [st.fromP, ...pts.slice(1, -1)].map((p) => ({ p, bulge: 0 }));
    }
    if (s.type === 'bezier') {
      const pts = CURVE_KINDS.bezier.points(s, state);
      return [st.fromP, ...(st.forward ? pts : pts.slice().reverse()).slice(1, -1)].map((p) => ({ p, bulge: 0 }));
    }
    return [{ p: st.fromP, bulge: 0 }];
  };
  // a walk (an outline's steps, closed, or an open stroke's) as ONE polyline; an open walk of ONE curve that has its own R12 entity stays that entity (a
  // LINE, an ARC; a bezier has none: its polyline)
  const writeWalk = (steps, closed) => {
    if (!steps.length) return;
    if (!closed && steps.length === 1 && steps[0].shape.type === 'line') return lineEnt(steps[0].fromP, steps[0].toP);
    if (!closed && steps.length === 1 && steps[0].shape.type === 'arc' && !arcApprox) return arcEnt(steps[0].shape);
    const verts = steps.flatMap(stepVerts);
    if (!closed) verts.push({ p: steps[steps.length - 1].toP, bulge: 0 });
    polyEnt(verts, closed);
  };

  // TASK 1043 (BUG-402): what is written is exportOutlines' decomposition (the one the SVG writes too): every closed outline ONE closed polyline, a circle
  // a CIRCLE, every open stroke ONE open polyline; every curve written once
  for (const o of out.outlines) {
    if (o.circle) {
      // BUG-300 (F-81): a circle is a CIRCLE entity (a DXF has no winding to keep), or with arcApprox its sampled points as one closed polyline
      const s = o.circle, c0 = J(s.joints[0]);
      if (!c0 || !(s.radius > 0)) continue;
      if (arcApprox) polyEnt(sampleCirclePoints(c0.x, c0.y, s.radius, arcSeg).slice(0, -1).map((p) => ({ p, bulge: 0 })), true);
      else { const c = to(c0); lines.push('0','CIRCLE','8','0','10',f(c.x),'20',f(c.y),'40',f(s.radius * scale)); }
      continue;
    }
    writeWalk(o.steps, true);
  }
  for (const strokes of out.chains) for (const stroke of strokes) writeWalk(stroke, false);
  lines.push('0','ENDSEC','0','EOF');
  return lines.join('\r\n');
}

export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); try{ a.remove(); }catch(_){} }, 1000);
}

export function exportToFile(state, filename, filetype, opts = {}) {
  if (!filename) filename = 'sketch';
  if (filetype === 'svg') {
    const svg = buildSVG(state, opts);
    if (!svg) return { ok: false, reason: 'No line/arc shapes to export' };
    downloadFile(svg, filename + '.svg', 'image/svg+xml');
    track('export:svg'); // TASK 738
    return { ok: true };
  } else if (filetype === 'dxf') {
    const dxf = buildDXF(state, opts);
    if (!dxf) return { ok: false, reason: 'No line/arc shapes to export' };
    downloadFile(dxf, filename + '.dxf', 'application/dxf');
    track('export:dxf'); // TASK 738
    return { ok: true };
  }
  return { ok: false, reason: 'Unknown filetype' };
}

/** Run exportToFile and notify only on failure (starting an export is normal behaviour). */
export function runExport(state, filename, filetype, opts = {}, notify) {
  const res = exportToFile(state, filename, filetype, opts);
  if (!(res && res.ok) && typeof notify === 'function') {
    notify('Export failed: ' + (res && res.reason ? res.reason : 'unknown'), 'error');
  }
  return res;
}
