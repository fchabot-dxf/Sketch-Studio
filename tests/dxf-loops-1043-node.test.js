// tests/dxf-loops-1043-node.test.js — TASK 1043 (BUG-402): SketchStudio's "Download DXF" writes each closed outline as ONE closed R12 polyline (POLYLINE
// 66 = 1, flag 70 = 1, its VERTEXes, SEQEND; a bulge 42 on the VERTEX that starts each arc = tan(sweep / 4), positive counter-clockwise in the DXF's Y-up
// plane) and each open chain as ONE open POLYLINE, read from the SAME decomposition the SVG export writes (export-manager.js exportOutlines: the app's ONE
// loop finder, TASK 1040). Not an LWPOLYLINE: Fusion's DXF import refuses those (the advisor, measured 2026-11-27). A circle stays a CIRCLE, a lone line /
// arc stays a LINE / ARC. A bezier is its SAMPLED points inside the polyline (#core/curve-kinds, chord deviation <= CURVE_TOLERANCE_MM), so an outline with a
// bezier is ONE closed POLYLINE too and NO SPLINE is ever written (BUG-421: Fusion refuses any DXF holding a SPLINE; R12 has none). Declared limit: our own
// DXF import gives a bezier back as those lines. With arcApprox every outline (a circle's too) is one closed POLYLINE of points.
//   D-1 the drawings of svg-loops-1040 (drawn with the real tools: node kit): the entity kinds and counts, the closed flags, the bulges (their size from the
//       arc's sweep, their sign the outline's turn), EVERY curve written exactly once (a bezier: one chain of segments from its start to its end, each
//       vertex on the curve, the curve within CURVE_TOLERANCE_MM of them), no SPLINE, the DXF Y-up (every point and every arc's turn mirrored)
//   D-2 arcApprox: no ARC, no SPLINE, no bulge; every closed outline one closed POLYLINE; the same points as the exact file's ends
//   D-3 the round trip: each file through the app's own DXF import (#core/dxf-import) gives back exactly the file's segments: the same curves (lines, arcs
//       with the same radius, side and direction, circles), a bezier as its sampled lines (the declared limit), and the same closed outlines
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { buildDXF } from '#app/ui/export-manager.js';
import { importDxf } from '#core/dxf-import.js';
import { findLoops } from '#core/loop-finder.js';
import { exportedShapes, bezierPoints, CURVE_TOLERANCE_MM } from '#core/curve-kinds.js';
import { arcSweepInfo } from '#core/geometry.js';

const failures = [];
let passed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log(`  FAIL: ${name}: ${String(e.message).split('\n')[0]}`); }
}

// ───────────────────────────── the drawings (svg-loops-1040's) ─────────────────────────────
async function openApp() {
  const app = await open({ host: 'sketchstudio' });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 50, y: -40, w: 200 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const clickW = (app, x, y) => { const p = app.toScreen(x, y); app.move(p.x, p.y); app.click(p.x, p.y); };
function draw(app, tool, variant, pts) {
  app.tool(tool);
  if (variant) { app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${variant}"]`).click(); app.frames(2); }
  for (const [x, y] of pts) clickW(app, x, y);
  app.esc(); app.frames(2);
}
const RECT = [[10.3, -10.3], [60.3, -40.3]];   // the grid snaps the corners to (10, -10) .. (60, -40)
function lay(app, joints, shapes, coincident = []) {
  for (const [id, x, y] of joints) app.state.joints.set(id, { x, y });
  for (const s of shapes) app.state.shapes.push(s);
  for (const [a, b] of coincident) app.state.constraints.push({ id: `c_${a}_${b}`, type: 'coincident', joints: [a, b] });
  app.frames(2);
}
const L = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
const T45 = Math.tan(Math.PI / 8), T90 = 1; // a 90 degree arc's bulge tan(90/4), a half circle's tan(180/4)
// name -> [draw, { entities: kind counts, closed / open POLYLINEs, bulges: the |bulge| of each closed / open polyline's arcs (sorted) }]
const DRAWINGS = {
  'rect 2-point alone': [(app) => draw(app, 'rect', 'rect-2pt', RECT), { entities: { POLYLINE: 1 }, closed: 1, open: 0, bulges: [] }],
  'closed line chain (Line tool)': [(app) => draw(app, 'line', null, [[10.3, -10.3], [60.3, -10.3], [60.3, -40.3], [10.3, -10.3]]), { entities: { POLYLINE: 1 }, closed: 1, open: 0, bulges: [] }],
  'rect + a line touching a corner': [(app) => { draw(app, 'rect', 'rect-2pt', RECT); draw(app, 'line', null, [[60.3, -40.3], [90.3, -60.3]]); }, { entities: { POLYLINE: 1, LINE: 1 }, closed: 1, open: 0, bulges: [] }],
  'two rects sharing an edge': [(app) => { draw(app, 'rect', 'rect-2pt', RECT); draw(app, 'rect', 'rect-2pt', [[60.3, -10.3], [100.3, -40.3]]); }, { entities: { POLYLINE: 2 }, closed: 2, open: 0, bulges: [] }],
  'slot c2c': [(app) => draw(app, 'slot', 'slot-c2c', [[20.3, -20.3], [70.3, -20.3], [70.3, -30.3]]), { entities: { POLYLINE: 1 }, closed: 1, open: 0, bulges: [T90, T90] }],
  'rect, one corner filleted': [(app) => {
    draw(app, 'rect', 'rect-2pt', RECT);
    app.tool('fillet'); clickW(app, 60.3, -40.3);
    const box = app.document.getElementById('fillet-radius-input');
    assert(box, 'the fillet radius box opens');
    box.focus(); box.select(); app.type('5'); app.enter(); app.esc(); app.frames(2);
    assert(app.state.shapes.some((s) => s.type === 'arc'), 'the corner is filleted');
  }, { entities: { POLYLINE: 1 }, closed: 1, open: 0, bulges: [T45] }],
  'a bezier loop (2 lines + a bezier)': [(app) => lay(app, [['p', 0, 0], ['q', 40, 0], ['q2', 40, 0], ['r', 40, -30], ['r2', 40, -30], ['p2', 0, 0]],
    [L('bl1', 'p', 'q'), L('bl2', 'q2', 'r'), { id: 'bz', type: 'bezier', joints: ['r2', 'p2'], c1: [30, -45], c2: [-10, -35] }], [['q', 'q2'], ['r', 'r2'], ['p', 'p2']]),
  { entities: { POLYLINE: 1 }, closed: 1, open: 0, bulges: [] }], // ONE closed POLYLINE: the 2 lines and the bezier's samples
  'an open chain: a line + an arc': [(app) => lay(app, [['a', 0, 0], ['b', 30, 0], ['b2', 30, 0], ['ac', 30, -10], ['ae', 40, -10]],
    [L('ol', 'a', 'b'), { id: 'oa', type: 'arc', subType: 'CENTER', joints: ['ac', 'b2', 'ae'], sweep: false }], [['b', 'b2']]), { entities: { POLYLINE: 1 }, closed: 0, open: 1, bulges: [T45] }],
  'a rect with a divider (two loops share it) + a circle': [(app) => lay(app, [['a', 0, 0], ['m', 20, 0], ['b', 40, 0], ['c', 40, -20], ['n', 20, -20], ['d', 0, -20], ['o', 70, -10]],
    [L('d1', 'a', 'm'), L('d2', 'm', 'b'), L('d3', 'b', 'c'), L('d4', 'c', 'n'), L('d5', 'n', 'd'), L('d6', 'd', 'a'), L('dv', 'm', 'n'), { id: 'ci', type: 'circle', joints: ['o'], radius: 6 }]),
  { entities: { POLYLINE: 2, CIRCLE: 1 }, closed: 1, open: 1, bulges: [] }], // one half closed, the other half's 3 lines (the divider written in the first) one open polyline
};

// ───────────────────────────── reading the DXF (an independent reader: not the app's importer) ─────────────────────────────
const R = (v) => Math.round(v * 1e3) / 1e3 + 0; // + 0: no -0
const pt = (p) => `${R(p.x)},${R(p.y)}`;
const TAU = Math.PI * 2;
const lineKey = (a, b) => 'L ' + [pt(a), pt(b)].sort().join(' ');
const arcKey = (a, b, mid, r) => 'A ' + [pt(a), pt(b)].sort().join(' ') + ' mid ' + pt(mid) + ' r ' + R(r);
const bezKey = (P) => { const f = P.map(pt).join(' '), r = P.slice().reverse().map(pt).join(' '); return 'C ' + (f < r ? f : r); };
const circleKey = (c, r) => `O ${pt(c)} r ${R(r)}`;
/** the ENTITIES of a DXF as [{ type, pairs: [[code, text]], vertices? }] (the values kept as written, text): a POLYLINE holds the VERTEXes that follow it
 *  (each { type, pairs }) up to its SEQEND, which must come (`ended`) */
function entitiesOf(dxf) {
  const t = dxf.split('\r\n'), out = [];
  let i = t.indexOf('ENTITIES') + 1, cur = null, poly = null;
  for (; i + 1 < t.length; i += 2) {
    if (t[i] !== '0') { cur.pairs.push([Number(t[i]), t[i + 1]]); continue; }
    if (t[i + 1] === 'ENDSEC') break;
    cur = { type: t[i + 1], pairs: [] };
    if (t[i + 1] === 'VERTEX') { assert(poly, 'a VERTEX follows a POLYLINE'); poly.vertices.push(cur); }
    else if (t[i + 1] === 'SEQEND') { assert(poly, 'a SEQEND ends a POLYLINE'); poly.ended = true; poly = null; }
    else { assert(!poly, `a POLYLINE ends with SEQEND before the next entity (${t[i + 1]})`); out.push(cur); if (cur.type === 'POLYLINE') { cur.vertices = []; poly = cur; } }
  }
  assert(!poly, 'the last POLYLINE ends with SEQEND');
  return out;
}
const num = (e, code) => Number((e.pairs.find((p) => p[0] === code) || [0, 0])[1]);
/** a POLYLINE's vertices [{ x, y, bulge, text }] (text = the coordinates as written), its closed flag, and its R12 form: 66 = 1 (vertices follow), its own
 *  point the dummy 0, 0, ended by a SEQEND */
function polyOf(e) {
  const v = e.vertices.map((w) => ({ x: num(w, 10), y: num(w, 20), bulge: num(w, 42), text: `${w.pairs.find((p) => p[0] === 10)[1]},${w.pairs.find((p) => p[0] === 20)[1]}` }));
  return { verts: v, closed: (num(e, 70) & 1) === 1, r12: num(e, 66) === 1 && num(e, 10) === 0 && num(e, 20) === 0 && e.ended === true };
}
// the segment p -> q of bulge b: a line, or an arc whose midpoint is the chord's middle + b / 2 * (dy, -dx) (b > 0: counter-clockwise, the arc on the
// chord's right) and radius chord (1 + b^2) / (4 |b|)
function bulgeKey(p, q, b) {
  if (!b) return lineKey(p, q);
  const dx = q.x - p.x, dy = q.y - p.y, chord = Math.hypot(dx, dy);
  return arcKey(p, q, { x: (p.x + q.x) / 2 + b / 2 * dy, y: (p.y + q.y) / 2 - b / 2 * dx }, chord * (1 + b * b) / (4 * Math.abs(b)));
}
/** every segment of a DXF as its key (Y-up, as written; `segs`: [{ key, a, b }], a / b the ends of a straight one), and the polylines read; a SPLINE (or any
 *  other entity) throws */
function fileKeys(dxf) {
  const keys = [], polys = [], segs = [];
  const straight = (a, b) => { const key = lineKey(a, b); keys.push(key); segs.push({ key, a, b }); };
  for (const e of entitiesOf(dxf)) {
    if (e.type === 'LINE') straight({ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) });
    else if (e.type === 'CIRCLE') { const key = circleKey({ x: num(e, 10), y: num(e, 20) }, num(e, 40)); keys.push(key); segs.push({ key }); }
    else if (e.type === 'ARC') {
      const c = { x: num(e, 10), y: num(e, 20) }, r = num(e, 40), a0 = num(e, 50) * Math.PI / 180, a1 = num(e, 51) * Math.PI / 180;
      const span = ((a1 - a0) % TAU + TAU) % TAU, at = (a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      const key = arcKey(at(a0), at(a1), at(a0 + span / 2), r); keys.push(key); segs.push({ key });
    } else if (e.type === 'POLYLINE') {
      const p = polyOf(e); polys.push(p);
      const n = p.closed ? p.verts.length : p.verts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = p.verts[i], b = p.verts[(i + 1) % p.verts.length];
        if (a.bulge) { const key = bulgeKey(a, b, a.bulge); keys.push(key); segs.push({ key }); } else straight(a, b);
      }
    } else throw new Error('unexpected entity ' + e.type);
  }
  return { keys: keys.sort(), polys, segs };
}
// the cubic P at t; the distance from q to segment a b; from q to the cubic (the nearest of 4000 samples, refined by a golden-section search either side)
const cubicAt = (P, t) => { const u = 1 - t; return { x: u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x, y: u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y }; };
const segDist = (q, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / L2)) : 0; return Math.hypot(q.x - a.x - t * vx, q.y - a.y - t * vy); };
function distToCubic(P, q) {
  const N = 4000, d = (t) => { const c = cubicAt(P, t); return Math.hypot(c.x - q.x, c.y - q.y); };
  let k = 0; for (let i = 1; i <= N; i++) if (d(i / N) < d(k / N)) k = i;
  let lo = Math.max(0, (k - 1) / N), hi = Math.min(1, (k + 1) / N);
  for (let it = 0; it < 60; it++) { const m1 = hi - (hi - lo) / 1.618, m2 = lo + (hi - lo) / 1.618; if (d(m1) < d(m2)) hi = m2; else lo = m1; }
  return d((lo + hi) / 2);
}
/** the DXF holds every exported curve of st exactly once, Y-up: a line / arc / circle as its key; a bezier as ONE chain of straight segments from its start to
 *  its end (each end point used once, every inner vertex twice), every vertex ON the curve (1e-5: the written 6 decimals), the curve within
 *  CURVE_TOLERANCE_MM of the chain (2001 points along it); nothing else. → fileKeys(dxf) */
function checkCurves(name, st, dxf) {
  const read = fileKeys(dxf), rest = read.segs.slice();
  for (const k of curveKeys(st, true).filter((x) => !x.startsWith('C '))) { const i = rest.findIndex((sg) => sg.key === k); assert(i >= 0, `${name}: ${k} written`); rest.splice(i, 1); }
  for (const s of exportedShapes(st).filter((x) => x.type === 'bezier')) {
    const P = bezierPoints(s, st.joints).map((q) => ({ x: q.x, y: -q.y }));
    const mine = rest.filter((sg) => sg.a && distToCubic(P, sg.a) < 1e-5 && distToCubic(P, sg.b) < 1e-5);
    assert(mine.length >= 2, `${name}: the bezier ${s.id} is written as ${mine.length} segments`);
    const uses = new Map(); for (const sg of mine) for (const q of [sg.a, sg.b]) uses.set(pt(q), (uses.get(pt(q)) || 0) + 1);
    const ends = [pt(P[0]), pt(P[3])];
    assert([...uses].every(([k, n]) => n === (ends.includes(k) ? 1 : 2)) && ends.every((k) => uses.get(k) === 1), `${name}: the bezier ${s.id}'s segments are one chain from its start to its end`);
    let worst = 0; for (let i = 0; i <= 2000; i++) { const q = cubicAt(P, i / 2000); worst = Math.max(worst, Math.min(...mine.map((sg) => segDist(q, sg.a, sg.b)))); }
    assert(worst <= CURVE_TOLERANCE_MM + 1e-5, `${name}: the bezier ${s.id} is within ${CURVE_TOLERANCE_MM} mm of its segments (${worst})`);
    for (const sg of mine) rest.splice(rest.indexOf(sg), 1);
  }
  assert.deepStrictEqual(rest.map((sg) => sg.key), [], `${name}: nothing else is written`);
  return read;
}
/** the curves of a state (the exported ones), each as its key, Y negated when `yUp` (a DXF's plane) */
function curveKeys(st, yUp = false) {
  const M = (p) => (yUp ? { x: p.x, y: -p.y } : { x: p.x, y: p.y });
  const J = (id) => M(st.joints.get(id));
  return exportedShapes(st).map((s) => {
    if (s.type === 'line') return lineKey(J(s.joints[0]), J(s.joints[1]));
    if (s.type === 'circle') return circleKey(J(s.joints[0]), s.radius);
    if (s.type === 'bezier') return bezKey(bezierPoints(s, st.joints).map(M));
    const [c, a, b] = s.joints.map((id) => st.joints.get(id));
    const info = arcSweepInfo(c, a, b, { sweep: s.sweep }), r = Math.hypot(a.x - c.x, a.y - c.y), am = info.a0 + info.dir * info.span / 2;
    return arcKey(J(s.joints[1]), J(s.joints[2]), M({ x: c.x + r * Math.cos(am), y: c.y + r * Math.sin(am) }), r);
  }).sort();
}
/** each arc of a state as [centre, its counter-clockwise start, end] (the world's increasing angle): its side AND direction, whichever end is its start */
function arcsOf(st) {
  const P = (id) => st.joints.get(id);
  return exportedShapes(st).filter((s) => s.type === 'arc').map((s) => {
    const dir = arcSweepInfo(P(s.joints[0]), P(s.joints[1]), P(s.joints[2]), { sweep: s.sweep }).dir;
    return [pt(P(s.joints[0])), dir > 0 ? pt(P(s.joints[1])) : pt(P(s.joints[2])), dir > 0 ? pt(P(s.joints[2])) : pt(P(s.joints[1])), R(Math.hypot(P(s.joints[1]).x - P(s.joints[0]).x, P(s.joints[1]).y - P(s.joints[0]).y))].join(' ');
  }).sort();
}
const kinds = (dxf) => { const k = {}; for (const e of entitiesOf(dxf)) k[e.type] = (k[e.type] || 0) + 1; return k; };
// the signed area of a polyline's vertices (Y-up: > 0 counter-clockwise)
const signedArea = (v) => v.reduce((a, p, i) => { const q = v[(i + 1) % v.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2;

// ───────────────────────────── D-1 / D-2 ─────────────────────────────
const exported = {};
for (const [name, [drawIt, want]] of Object.entries(DRAWINGS)) {
  await run(`D-1 ${name}: ${JSON.stringify(want.entities)}, ${want.closed} closed / ${want.open} open POLYLINE(s), bulges ${want.bulges.map(R)}; every curve once, Y-up`, async () => {
    const app = await openApp();
    try {
      drawIt(app);
      app.engine.solve(); app.frames(2);
      const st = app.state;
      const dxf = buildDXF(st, { precision: 6 });
      assert.deepStrictEqual(kinds(dxf), want.entities, `${name}: the entities written`);
      assert(!/\r\nSPLINE\r\n/.test(dxf), `${name}: no SPLINE (Fusion refuses it, BUG-421)`);
      const { polys } = checkCurves(name, st, dxf);
      assert.deepStrictEqual([polys.filter((p) => p.closed).length, polys.filter((p) => !p.closed).length], [want.closed, want.open], `${name}: closed / open POLYLINEs (flag 70)`);
      for (const p of polys) assert(p.r12 && p.verts.length >= 2, `${name}: each POLYLINE is R12's: 66 = 1, the dummy point 0, its VERTEXes, a SEQEND`);
      assert(!/\r\nLWPOLYLINE\r\n/.test(dxf), `${name}: no LWPOLYLINE (Fusion's DXF import refuses it)`);
      assert.deepStrictEqual(polys.flatMap((p) => p.verts.map((v) => R(Math.abs(v.bulge)))).filter((b) => b).sort(), want.bulges.map(R).sort(), `${name}: the bulges tan(sweep / 4)`);
      assert.strictEqual(buildDXF(st, { precision: 6, invertY: true }), dxf, `${name}: "Invert Y axis" is SVG only: the DXF is the same`);
      // a convex outline turns one way all round: each arc's bulge has the sign of the outline's own turn (its vertices' signed area, Y-up)
      for (const p of polys.filter((q) => q.closed)) for (const v of p.verts) if (v.bulge) assert.strictEqual(Math.sign(v.bulge), Math.sign(signedArea(p.verts)), `${name}: an arc's bulge turns with its outline`);
      // D-2 arcApprox: every curve sampled into polylines (no ARC, no SPLINE, no bulge); every closed outline (the drawing's loops a written outline holds,
      // the bezier's and the circle's too) one closed POLYLINE
      const ap = buildDXF(st, { precision: 6, arcApprox: true, arcSeg: 8 });
      assert(!/\r\n(ARC|SPLINE|CIRCLE)\r\n/.test(ap) && !/\r\n42\r\n/.test(ap), `${name}: arcApprox: no ARC, SPLINE, CIRCLE or bulge`);
      const apPolys = fileKeys(ap).polys;
      assert.strictEqual(apPolys.filter((p) => p.closed).length, want.closed + (want.entities.CIRCLE || 0), `${name}: arcApprox: each closed outline one closed POLYLINE`);
      exported[name] = { dxf, hasBezier: exportedShapes(st).some((x) => x.type === 'bezier'), keys: curveKeys(st), arcs: arcsOf(st), loops: findLoops({ joints: st.joints, shapes: exportedShapes(st), constraints: st.constraints }).length };
    } finally { await app.close(); }
  });
}

// ───────────────────────────── D-3 the round trip ─────────────────────────────
await run('D-3 the round trip: each file through the app\'s own DXF import gives back the file\'s segments: the same curves (lines, arcs: radius, side, direction; circles), a bezier as its sampled lines (declared limit), the same closed outlines', async () => {
  assert.deepStrictEqual(Object.keys(exported), Object.keys(DRAWINGS), 'every drawing was exported (D-1)');
  for (const [name, e] of Object.entries(exported)) {
    let n = 0;
    const res = importDxf(e.dxf, { genJ: () => 'r' + (n++), idPrefix: 'rt' });
    assert(!res.error && res.stats.skipped.length === 0, `${name}: imports with nothing skipped (${JSON.stringify(res.stats && res.stats.skipped)})`);
    const st = { joints: new Map(res.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes, constraints: [] };
    assert.deepStrictEqual(curveKeys(st, true), fileKeys(e.dxf).keys, `${name}: the import gives back exactly the file's segments (the same way up)`);
    if (!e.hasBezier) assert.deepStrictEqual(curveKeys(st), e.keys, `${name}: the imported curves are the drawn ones`);
    else assert(st.shapes.every((x) => x.type !== 'bezier'), `${name}: declared limit: the bezier comes back as its sampled lines`);
    assert.deepStrictEqual(arcsOf(st), e.arcs, `${name}: every arc comes back with its centre, radius and direction`);
    assert.strictEqual(findLoops(st).length, e.loops, `${name}: the drawing's ${e.loops} closed outline(s) come back closed (the import joins the entities by their end points)`);
  }
});

// ───────────────────────────── D-4 the fixture drawings ─────────────────────────────
// the drawings whose SketchStudio DXF bezier-loops-761 kept bit-identical before this task (its studioDxf facet changed on purpose): each one's DXF holds
// every curve exactly once, Y-up, and reads back through the app's DXF import to the same curves (arcs: centre, radius, direction) and the same loops
await run('D-4 the fixture drawings (bezier-loops-761\'s set): every curve once, Y-up, and the round trip gives back the same curves and loops', async () => {
  const fx = (p) => new URL('./fixtures/' + p, import.meta.url);
  const stateOf = (g) => ({ joints: new Map((g.joints || []).map((e) => (Array.isArray(e) ? [e[0], { ...e[1] }] : [e.id, { ...e }]))), shapes: (g.shapes || []).map((s) => ({ ...s, joints: [...(s.joints || [])] })), constraints: (g.constraints || []).map((c) => ({ ...c })) });
  const docs = [];
  for (const f of ['owner-trapezoid.document.json', 'pattern-params-694-old.document.json', 'pre-577-two-sketches.document.json', 'angle-dimension/owner-trapezoid-angle.json',
    'dimension/owner-drag-frozen-589.document.json', 'dimension/owner-rect-line-line-589.document.json', 'drag/owner-two-arcs-575.json']) docs.push([f, stateOf(JSON.parse(fs.readFileSync(fx(f), 'utf8')).geometry)]);
  for (const f of ['report/drag-frozen.json', 'report/line-line-driven.json', 'report/midpoint-move.json']) docs.push([f, stateOf(JSON.parse(fs.readFileSync(fx(f), 'utf8')).document.geometry)]);
  JSON.parse(fs.readFileSync(fx('angle-dimension/legacy-angles.json'), 'utf8')).docs.forEach((d, i) => docs.push([`legacy-angles#${i}`, stateOf(d.doc.geometry)]));
  for (const f of ['bulge-loop-in.dxf', 'close-path-760-gap.dxf', 'fusion-sketch4.dxf', 'part-mm.dxf']) {
    let n = 0;
    const res = importDxf(fs.readFileSync(fx('dxf/' + f), 'utf8'), { genJ: () => 'j' + (n++), idPrefix: 'd' });
    docs.push(['dxf/' + f, { joints: new Map(res.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes, constraints: [] }]);
  }
  let polys = 0, closedPolys = 0;
  for (const [name, st] of docs) {
    const dxf = buildDXF(st, { precision: 6 });
    if (!dxf) { assert.strictEqual(exportedShapes(st).length, 0, `${name}: no file only when nothing is exported`); continue; }
    assert(!/\r\nSPLINE\r\n/.test(dxf), `${name}: no SPLINE`);
    const read = checkCurves(name, st, dxf);
    polys += read.polys.length; closedPolys += read.polys.filter((p) => p.closed).length;
    let n = 0;
    const res = importDxf(dxf, { genJ: () => 'r' + (n++), idPrefix: 'rt' });
    const back = { joints: new Map(res.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes, constraints: [] };
    assert.deepStrictEqual(curveKeys(back, true), read.keys, `${name}: the round trip gives back the file's segments`);
    if (!exportedShapes(st).some((x) => x.type === 'bezier')) assert.deepStrictEqual(curveKeys(back), curveKeys(st), `${name}: the round trip gives back the same curves`);
    assert.deepStrictEqual(arcsOf(back), arcsOf(st), `${name}: and every arc's centre, radius and direction`);
    assert.strictEqual(findLoops(back).length, findLoops({ joints: st.joints, shapes: exportedShapes(st), constraints: st.constraints }).length, `${name}: and the same closed outlines`);
  }
  // the counts measured on this task's exporter (the fixtures are frozen); angle-dimension/owner-trapezoid-angle.json's nearly flat 17188 mm arc is the case
  // that needs a bulge's extra decimals (at the coordinates' 6 it came back off); dxf/part-mm.dxf's SPLINE (a bezier once imported) is its sampled POLYLINE
  assert.deepStrictEqual([docs.length, polys, closedPolys], [151, 98, 28], `the set: ${docs.length} drawings, ${polys} POLYLINEs written, ${closedPolys} closed`);
  console.log(`    D-4: ${docs.length} drawings, ${polys} POLYLINEs, ${closedPolys} closed`);
});

console.log(`dxf-loops-1043-node: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
