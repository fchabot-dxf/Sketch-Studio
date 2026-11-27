// tests/dxf-loops-1043-node.test.js — TASK 1043 (BUG-402): SketchStudio's "Download DXF" writes each closed outline as ONE closed LWPOLYLINE (flag 70 = 1,
// a bulge 42 = tan(sweep / 4) for each arc, positive counter-clockwise in the DXF's Y-up plane) and each open chain as ONE open LWPOLYLINE, read from the
// SAME decomposition the SVG export writes (export-manager.js exportOutlines: the app's ONE loop finder, TASK 1040). A circle stays a CIRCLE, a lone line /
// arc stays a LINE / ARC, an exact bezier stays its SPLINE (an LWPOLYLINE holds no cubic: its outline is the SPLINE + one open LWPOLYLINE of the rest, the
// joining ends written with the very same coordinates); with arcApprox every outline (a bezier's and a circle's too) is one closed LWPOLYLINE of points.
//   D-1 the drawings of svg-loops-1040 (drawn with the real tools: node kit): the entity kinds and counts, the closed flags, the bulges (their size from the
//       arc's sweep, their sign the outline's turn), EVERY curve written exactly once, the DXF Y-up (every point and every arc's turn mirrored)
//   D-2 arcApprox: no ARC, no SPLINE, no bulge; every closed outline one closed LWPOLYLINE; the same points as the exact file's ends
//   D-3 the round trip: each file through the app's own DXF import (#core/dxf-import) gives back the same curves (lines, arcs with the same radius, side and
//       direction, circles, the bezier) and the same closed outlines
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { buildDXF } from '#app/ui/export-manager.js';
import { importDxf } from '#core/dxf-import.js';
import { findLoops } from '#core/loop-finder.js';
import { exportedShapes, bezierPoints } from '#core/curve-kinds.js';
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
// name -> [draw, { entities: kind counts, closed / open LWPOLYLINEs, bulges: the |bulge| of each closed / open polyline's arcs (sorted) }]
const DRAWINGS = {
  'rect 2-point alone': [(app) => draw(app, 'rect', 'rect-2pt', RECT), { entities: { LWPOLYLINE: 1 }, closed: 1, open: 0, bulges: [] }],
  'closed line chain (Line tool)': [(app) => draw(app, 'line', null, [[10.3, -10.3], [60.3, -10.3], [60.3, -40.3], [10.3, -10.3]]), { entities: { LWPOLYLINE: 1 }, closed: 1, open: 0, bulges: [] }],
  'rect + a line touching a corner': [(app) => { draw(app, 'rect', 'rect-2pt', RECT); draw(app, 'line', null, [[60.3, -40.3], [90.3, -60.3]]); }, { entities: { LWPOLYLINE: 1, LINE: 1 }, closed: 1, open: 0, bulges: [] }],
  'two rects sharing an edge': [(app) => { draw(app, 'rect', 'rect-2pt', RECT); draw(app, 'rect', 'rect-2pt', [[60.3, -10.3], [100.3, -40.3]]); }, { entities: { LWPOLYLINE: 2 }, closed: 2, open: 0, bulges: [] }],
  'slot c2c': [(app) => draw(app, 'slot', 'slot-c2c', [[20.3, -20.3], [70.3, -20.3], [70.3, -30.3]]), { entities: { LWPOLYLINE: 1 }, closed: 1, open: 0, bulges: [T90, T90] }],
  'rect, one corner filleted': [(app) => {
    draw(app, 'rect', 'rect-2pt', RECT);
    app.tool('fillet'); clickW(app, 60.3, -40.3);
    const box = app.document.getElementById('fillet-radius-input');
    assert(box, 'the fillet radius box opens');
    box.focus(); box.select(); app.type('5'); app.enter(); app.esc(); app.frames(2);
    assert(app.state.shapes.some((s) => s.type === 'arc'), 'the corner is filleted');
  }, { entities: { LWPOLYLINE: 1 }, closed: 1, open: 0, bulges: [T45] }],
  'a bezier loop (2 lines + a bezier)': [(app) => lay(app, [['p', 0, 0], ['q', 40, 0], ['q2', 40, 0], ['r', 40, -30], ['r2', 40, -30], ['p2', 0, 0]],
    [L('bl1', 'p', 'q'), L('bl2', 'q2', 'r'), { id: 'bz', type: 'bezier', joints: ['r2', 'p2'], c1: [30, -45], c2: [-10, -35] }], [['q', 'q2'], ['r', 'r2'], ['p', 'p2']]),
  { entities: { SPLINE: 1, LWPOLYLINE: 1 }, closed: 0, open: 1, bulges: [] }],
  'an open chain: a line + an arc': [(app) => lay(app, [['a', 0, 0], ['b', 30, 0], ['b2', 30, 0], ['ac', 30, -10], ['ae', 40, -10]],
    [L('ol', 'a', 'b'), { id: 'oa', type: 'arc', subType: 'CENTER', joints: ['ac', 'b2', 'ae'], sweep: false }], [['b', 'b2']]), { entities: { LWPOLYLINE: 1 }, closed: 0, open: 1, bulges: [T45] }],
  'a rect with a divider (two loops share it) + a circle': [(app) => lay(app, [['a', 0, 0], ['m', 20, 0], ['b', 40, 0], ['c', 40, -20], ['n', 20, -20], ['d', 0, -20], ['o', 70, -10]],
    [L('d1', 'a', 'm'), L('d2', 'm', 'b'), L('d3', 'b', 'c'), L('d4', 'c', 'n'), L('d5', 'n', 'd'), L('d6', 'd', 'a'), L('dv', 'm', 'n'), { id: 'ci', type: 'circle', joints: ['o'], radius: 6 }]),
  { entities: { LWPOLYLINE: 2, CIRCLE: 1 }, closed: 1, open: 1, bulges: [] }], // one half closed, the other half's 3 lines (the divider written in the first) one open polyline
};

// ───────────────────────────── reading the DXF (an independent reader: not the app's importer) ─────────────────────────────
const R = (v) => Math.round(v * 1e3) / 1e3 + 0; // + 0: no -0
const pt = (p) => `${R(p.x)},${R(p.y)}`;
const TAU = Math.PI * 2;
const lineKey = (a, b) => 'L ' + [pt(a), pt(b)].sort().join(' ');
const arcKey = (a, b, mid, r) => 'A ' + [pt(a), pt(b)].sort().join(' ') + ' mid ' + pt(mid) + ' r ' + R(r);
const bezKey = (P) => { const f = P.map(pt).join(' '), r = P.slice().reverse().map(pt).join(' '); return 'C ' + (f < r ? f : r); };
const circleKey = (c, r) => `O ${pt(c)} r ${R(r)}`;
/** the ENTITIES of a DXF as [{ type, pairs: [[code, text]] }] (the values kept as written, text) */
function entitiesOf(dxf) {
  const t = dxf.split('\r\n'), out = [];
  let i = t.indexOf('ENTITIES') + 1, cur = null;
  for (; i + 1 < t.length; i += 2) {
    if (t[i] === '0') { if (t[i + 1] === 'ENDSEC') break; cur = { type: t[i + 1], pairs: [] }; out.push(cur); } else cur.pairs.push([Number(t[i]), t[i + 1]]);
  }
  return out;
}
const num = (e, code) => Number((e.pairs.find((p) => p[0] === code) || [0, 0])[1]);
/** an LWPOLYLINE's vertices [{ x, y, bulge, text }] (text = the coordinates as written) and its closed flag */
function polyOf(e) {
  const v = [];
  for (const [c, s] of e.pairs) {
    if (c === 10) v.push({ x: Number(s), y: 0, bulge: 0, text: s });
    else if (c === 20) { v[v.length - 1].y = Number(s); v[v.length - 1].text += ',' + s; }
    else if (c === 42) v[v.length - 1].bulge = Number(s);
  }
  return { verts: v, closed: (num(e, 70) & 1) === 1, n: num(e, 90) };
}
// the segment p -> q of bulge b: a line, or an arc whose midpoint is the chord's middle + b / 2 * (dy, -dx) (b > 0: counter-clockwise, the arc on the
// chord's right) and radius chord (1 + b^2) / (4 |b|)
function bulgeKey(p, q, b) {
  if (!b) return lineKey(p, q);
  const dx = q.x - p.x, dy = q.y - p.y, chord = Math.hypot(dx, dy);
  return arcKey(p, q, { x: (p.x + q.x) / 2 + b / 2 * dy, y: (p.y + q.y) / 2 - b / 2 * dx }, chord * (1 + b * b) / (4 * Math.abs(b)));
}
/** every curve of a DXF as its key (Y-up, as written), and the polylines read */
function fileKeys(dxf) {
  const keys = [], polys = [];
  for (const e of entitiesOf(dxf)) {
    if (e.type === 'LINE') keys.push(lineKey({ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }));
    else if (e.type === 'CIRCLE') keys.push(circleKey({ x: num(e, 10), y: num(e, 20) }, num(e, 40)));
    else if (e.type === 'ARC') {
      const c = { x: num(e, 10), y: num(e, 20) }, r = num(e, 40), a0 = num(e, 50) * Math.PI / 180, a1 = num(e, 51) * Math.PI / 180;
      const span = ((a1 - a0) % TAU + TAU) % TAU, at = (a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
      keys.push(arcKey(at(a0), at(a1), at(a0 + span / 2), r));
    } else if (e.type === 'SPLINE') {
      const xs = e.pairs.filter((p) => p[0] === 10).map((p) => Number(p[1])), ys = e.pairs.filter((p) => p[0] === 20).map((p) => Number(p[1]));
      keys.push(bezKey(xs.map((x, i) => ({ x, y: ys[i] }))));
    } else if (e.type === 'LWPOLYLINE') {
      const p = polyOf(e); polys.push(p);
      const segs = p.closed ? p.verts.length : p.verts.length - 1;
      for (let i = 0; i < segs; i++) keys.push(bulgeKey(p.verts[i], p.verts[(i + 1) % p.verts.length], p.verts[i].bulge));
    } else throw new Error('unexpected entity ' + e.type);
  }
  return { keys: keys.sort(), polys };
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
  await run(`D-1 ${name}: ${JSON.stringify(want.entities)}, ${want.closed} closed / ${want.open} open LWPOLYLINE(s), bulges ${want.bulges.map(R)}; every curve once, Y-up`, async () => {
    const app = await openApp();
    try {
      drawIt(app);
      app.engine.solve(); app.frames(2);
      const st = app.state;
      const dxf = buildDXF(st, { precision: 6 });
      assert.deepStrictEqual(kinds(dxf), want.entities, `${name}: the entities written`);
      const { keys, polys } = fileKeys(dxf);
      assert.deepStrictEqual([polys.filter((p) => p.closed).length, polys.filter((p) => !p.closed).length], [want.closed, want.open], `${name}: closed / open LWPOLYLINEs (flag 70)`);
      for (const p of polys) assert.strictEqual(p.n, p.verts.length, `${name}: an LWPOLYLINE's vertex count (90) is its vertices`);
      assert.deepStrictEqual(polys.flatMap((p) => p.verts.map((v) => R(Math.abs(v.bulge)))).filter((b) => b).sort(), want.bulges.map(R).sort(), `${name}: the bulges tan(sweep / 4)`);
      assert.deepStrictEqual(keys, curveKeys(st, true), `${name}: the file's segments are the drawing's curves, each exactly once, Y-up (Y negated: every point, every arc's side and turn)`);
      assert.strictEqual(buildDXF(st, { precision: 6, invertY: true }), dxf, `${name}: "Invert Y axis" is SVG only: the DXF is the same`);
      // a convex outline turns one way all round: each arc's bulge has the sign of the outline's own turn (its vertices' signed area, Y-up)
      for (const p of polys.filter((q) => q.closed)) for (const v of p.verts) if (v.bulge) assert.strictEqual(Math.sign(v.bulge), Math.sign(signedArea(p.verts)), `${name}: an arc's bulge turns with its outline`);
      if (name.startsWith('a bezier loop')) { // the SPLINE's two ends ARE the LWPOLYLINE's two ends, the very same text (an importer joining by end points closes it)
        const sp = entitiesOf(dxf).find((e) => e.type === 'SPLINE'), x = sp.pairs.filter((q) => q[0] === 10).map((q) => q[1]), y = sp.pairs.filter((q) => q[0] === 20).map((q) => q[1]);
        const ends = [`${x[0]},${y[0]}`, `${x[3]},${y[3]}`].sort(), pv = polys[0].verts;
        assert.deepStrictEqual([pv[0].text, pv[pv.length - 1].text].sort(), ends, `${name}: the SPLINE ends ${ends} = the LWPOLYLINE ends, as written`);
      }
      // D-2 arcApprox: every curve sampled into polylines (no ARC, no SPLINE, no bulge); every closed outline (the drawing's loops a written outline holds,
      // the bezier's and the circle's too) one closed LWPOLYLINE
      const ap = buildDXF(st, { precision: 6, arcApprox: true, arcSeg: 8 });
      assert(!/\r\n(ARC|SPLINE|CIRCLE)\r\n/.test(ap) && !/\r\n42\r\n/.test(ap), `${name}: arcApprox: no ARC, SPLINE, CIRCLE or bulge`);
      const apPolys = fileKeys(ap).polys;
      assert.strictEqual(apPolys.filter((p) => p.closed).length, want.closed + (name.startsWith('a bezier loop') ? 1 : 0) + (want.entities.CIRCLE || 0), `${name}: arcApprox: each closed outline one closed LWPOLYLINE`);
      exported[name] = { dxf, keys: curveKeys(st), arcs: arcsOf(st), loops: findLoops({ joints: st.joints, shapes: exportedShapes(st), constraints: st.constraints }).length };
    } finally { await app.close(); }
  });
}

// ───────────────────────────── D-3 the round trip ─────────────────────────────
await run('D-3 the round trip: each file through the app\'s own DXF import gives back the same curves (lines, arcs: radius, side, direction; circles; the bezier) and the same closed outlines', async () => {
  assert.deepStrictEqual(Object.keys(exported), Object.keys(DRAWINGS), 'every drawing was exported (D-1)');
  for (const [name, e] of Object.entries(exported)) {
    let n = 0;
    const res = importDxf(e.dxf, { genJ: () => 'r' + (n++), idPrefix: 'rt' });
    assert(!res.error && res.stats.skipped.length === 0, `${name}: imports with nothing skipped (${JSON.stringify(res.stats && res.stats.skipped)})`);
    const st = { joints: new Map(res.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes, constraints: [] };
    assert.deepStrictEqual(curveKeys(st), e.keys, `${name}: the imported curves are the drawn ones (the same way up)`);
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
    const read = fileKeys(dxf);
    polys += read.polys.length; closedPolys += read.polys.filter((p) => p.closed).length;
    assert.deepStrictEqual(read.keys, curveKeys(st, true), `${name}: every curve written exactly once, Y-up`);
    let n = 0;
    const res = importDxf(dxf, { genJ: () => 'r' + (n++), idPrefix: 'rt' });
    const back = { joints: new Map(res.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes, constraints: [] };
    assert.deepStrictEqual(curveKeys(back), curveKeys(st), `${name}: the round trip gives back the same curves`);
    assert.deepStrictEqual(arcsOf(back), arcsOf(st), `${name}: and every arc's centre, radius and direction`);
    assert.strictEqual(findLoops(back).length, findLoops({ joints: st.joints, shapes: exportedShapes(st), constraints: st.constraints }).length, `${name}: and the same closed outlines`);
  }
  // the counts measured on this task's exporter (the fixtures are frozen); angle-dimension/owner-trapezoid-angle.json's nearly flat 17188 mm arc is the case
  // that needs a bulge's extra decimals (at the coordinates' 6 it came back off)
  assert.deepStrictEqual([docs.length, polys, closedPolys], [151, 97, 28], `the set: ${docs.length} drawings, ${polys} LWPOLYLINEs written, ${closedPolys} closed`);
  console.log(`    D-4: ${docs.length} drawings, ${polys} LWPOLYLINEs, ${closedPolys} closed`);
});

console.log(`dxf-loops-1043-node: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
