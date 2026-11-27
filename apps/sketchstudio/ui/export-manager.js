// Export manager: build SVG or DXF exports from sketch data (lines, arcs and, TASK 761, beziers: a cubic `C` / a DXF SPLINE)
import { CONSTRAINT_TYPES } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { arcSweepInfo } from '#core/geometry.js';
import { CURVE_KINDS, bezierPoints, exportedShapes } from '#core/curve-kinds.js'; // TASK 761: a bezier's control points / sampled points, declared once; TASK 1036: what is exported (BUG-300's rule, moved there)
import { track } from '#ui/analytics.js'; // TASK 738
import { findLoops, findOpenChains, buildNodeMap, curveEnds } from '#core/loop-finder.js'; // TASK 1040: the closed outlines and open chains an SVG writes (the finder Shaper reads)
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

export function buildSVG(state, opts = {}) {
  const precision = (typeof opts.precision === 'number') ? opts.precision : 6;
  const scale = (typeof opts.scale === 'number') ? opts.scale : 1;
  const invertY = !!opts.invertY;
  const arcApprox = !!opts.arcApprox;
  const arcSeg = parseInt(opts.arcSeg || 32, 10) || 32;
  const lineCap = opts.lineCap || SettingsManager.get('LINE_CAP') || 'round';
  const lineJoin = opts.lineJoin || SettingsManager.get('LINE_JOIN') || 'round';
  const lineStroke = (typeof opts.strokeWidth === 'number') ? opts.strokeWidth : EXPORT_STROKE_WIDTH;

  const shapes = exportedShapes(state);
  if (shapes.length === 0) return null;

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

  // TASK 1040 (BUG-401): WHAT is written is read from the app's ONE closed-shape finder (#core/loop-finder.js, the one Shaper's Prepare and cut file read),
  // on the exported shapes only: every closed outline (findLoops: lines, arcs, beziers, mixed) is ONE closed <path ... Z>, a circle stays a <circle>, and
  // every other curve is in an open chain (findOpenChains), each chain ONE <path> (its walk, #core/loop-geometry.js chainWalk). EVERY CURVE IS WRITTEN
  // ONCE: an outline is written closed only when none of its curves is written yet (the finder's order); a loop that shares a curve with one written
  // before (a rectangle with a divider: the two halves share it) leaves its other curves to the open chains.
  const view = { joints: state.joints, shapes, constraints: state.constraints || [] };
  const node = buildNodeMap(view);
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const written = new Set();
  const closed = [];
  for (const loop of findLoops(view)) {
    if (new Set(loop.edges).size !== loop.edges.length || loop.edges.some((id) => written.has(id))) continue;
    closed.push(loop);
    for (const id of loop.edges) written.add(id);
  }
  for (const loop of closed) {
    const first = byId.get(loop.edges[0]);
    if (first.type === 'circle') { // BUG-300 (F-81): a circle as a <circle> (or, with arcApprox, its sampled closed polyline)
      const c0 = J(first.joints[0]);
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
    // the loop's walk: edge k joins joint k to joint k + 1 (the last one closes back to joint 0); a line closing it is left to Z
    const n = loop.joints.length;
    let d = `M ${xy(transform(J(loop.joints[0])))}`;
    loop.edges.forEach((id, k) => {
      const s = byId.get(id), from = loop.joints[k], to = loop.joints[(k + 1) % n];
      if (k === n - 1 && s.type === 'line') return;
      d += ' ' + seg(s, J(from), J(to), node(curveEnds(s)[0]) === from);
    });
    pathEl(d + ' Z');
  }
  for (const chain of findOpenChains(view, closed)) {
    const d = chainWalk(chain, view).map((stroke) => `M ${xy(transform(stroke[0].fromP))} ` + stroke.map((st) => seg(st.shape, st.fromP, st.toP, st.forward)).join(' ')).join(' ');
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

  const shapes = exportedShapes(state);
  if (shapes.length === 0) return null;

  // BUG-301 (F-84): DXF is Y-up and the world is Y-down, so the DXF writer ALWAYS negates Y (the importer, #core/dxf-import, negates it back); the
  // Export view's "Invert Y axis" box is for SVG only and does not reach a DXF. Everything below is computed from the points AS WRITTEN (`to`), so an
  // arc's angles and direction are the ones of the DXF's own plane.
  const flip = true;
  const to = (p) => ({ x: p.x * scale, y: (flip ? -p.y : p.y) * scale });

  const lines = [];
  lines.push('0','SECTION','2','ENTITIES');
  for (const s of shapes) {
    if (s.type === 'line') {
      const a0 = getJointPos(state, s.joints[0]);
      const b0 = getJointPos(state, s.joints[1]);
      if (!a0 || !b0) continue;
      const a = to(a0); const b = to(b0);
      lines.push('0','LINE','8','0','10',formatNum(a.x, precision),'20',formatNum(a.y, precision),'11',formatNum(b.x, precision),'21',formatNum(b.y, precision));
    } else if (s.type === 'arc') {
      const c0 = getJointPos(state, s.joints[0]);
      const st0 = getJointPos(state, s.joints[1]);
      const en0 = getJointPos(state, s.joints[2]);
      if (!c0 || !st0 || !en0) continue;
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

      if (arcApprox) {
        // approximate arc using line segments (always increasing angle from startAngle to endAngle, as the ARC entity)
        const pts = sampleArcPoints(c.x, c.y, r, startAngle * Math.PI/180, endAngle * Math.PI/180, true, arcSeg);
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i], p2 = pts[i+1];
          lines.push('0','LINE','8','0','10',formatNum(p1.x, precision),'20',formatNum(p1.y, precision),'11',formatNum(p2.x, precision),'21',formatNum(p2.y, precision));
        }
      } else {
        lines.push('0','ARC','8','0','10',formatNum(c.x, precision),'20',formatNum(c.y, precision),'40',formatNum(r, precision),'50',formatNum(startAngle, precision),'51',formatNum(endAngle, precision));
      }
    } else if (s.type === 'circle') {
      // BUG-300 (F-81): a circle is a CIRCLE entity (a DXF has no winding to keep), or with arcApprox its sampled points as LINEs
      const c0 = getJointPos(state, s.joints[0]);
      if (!c0 || !(s.radius > 0)) continue;
      if (arcApprox) {
        const pts = sampleCirclePoints(c0.x, c0.y, s.radius, arcSeg).map(to);
        for (let i = 0; i < pts.length - 1; i++) lines.push('0','LINE','8','0','10',formatNum(pts[i].x, precision),'20',formatNum(pts[i].y, precision),'11',formatNum(pts[i+1].x, precision),'21',formatNum(pts[i+1].y, precision));
      } else {
        const c = to(c0);
        lines.push('0','CIRCLE','8','0','10',formatNum(c.x, precision),'20',formatNum(c.y, precision),'40',formatNum(s.radius * scale, precision));
      }
    } else if (s.type === 'bezier') {
      // TASK 761: a bezier is a cubic SPLINE (degree 3, its four control points, knots 0 0 0 0 1 1 1 1: what #core/dxf-import reads back as one
      // bezier), or with arcApprox its sampled points as LINEs (#core/curve-kinds)
      const P = bezierPoints(s, state.joints);
      if (!P) continue;
      if (arcApprox) {
        const pts = CURVE_KINDS.bezier.points(s, state).map(to);
        for (let i = 0; i < pts.length - 1; i++) lines.push('0','LINE','8','0','10',formatNum(pts[i].x, precision),'20',formatNum(pts[i].y, precision),'11',formatNum(pts[i+1].x, precision),'21',formatNum(pts[i+1].y, precision));
      } else {
        lines.push('0','SPLINE','8','0','70','8','71','3','72','8','73','4','74','0');
        for (const k of [0, 0, 0, 0, 1, 1, 1, 1]) lines.push('40', String(k));
        for (const q of P.map(to)) lines.push('10', formatNum(q.x, precision), '20', formatNum(q.y, precision), '30', formatNum(0, precision));
      }
    }
  }
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
