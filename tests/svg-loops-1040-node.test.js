// tests/svg-loops-1040-node.test.js — TASK 1040: SketchStudio's "Download SVG" writes closed outlines as ONE closed path (BUG-401), read from the app's ONE
// closed-shape finder (#core/loop-finder.js, the one Shaper's Prepare and cut file read), and the finder gives two rectangles drawn side by side (their
// shared side = two lines on each other) as TWO loops, not one twisted loop walking both shared lines twice (BUG-400, a Shaper bug too).
//   S-1 the 6 drawings the advisor measured (drawn with the real tools: node kit), + a bezier loop, + an open chain of a line and an arc, + a rectangle
//       with a divider (two loops sharing a line) and a circle: the closed outlines (<path ... Z>) and open paths written, EVERY curve written exactly once
//       (the shapes' curves = the file's segments), with "Invert Y axis" off and on (mirrored: every point, every arc's direction), and arcApprox on / off
//   S-2 the round trip: the file through the app's own SVG import (SketchStudio's sidebar import, app.importFile) gives back the same curves (lines, arcs,
//       circles exactly; a bezier as the import's flattened points on the same cubic), the same closed outlines; the inverted file the mirrored ones
//   S-3 Shaper: the same two rectangles drawn in Shaper's Design, its Prepare finds 2 rectangle loops (4 lines each), no twisted loop
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { buildSVG } from '#app/ui/export-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { exportedShapes, bezierPoints } from '#core/curve-kinds.js';
import { arcSweepInfo } from '#core/geometry.js';

const failures = [];
let passed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log(`  FAIL: ${name}: ${String(e.message).split('\n')[0]}`); }
}

// ───────────────────────────── the drawings ─────────────────────────────
async function openApp(host = 'sketchstudio') {
  const app = await open({ host });
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
const twoRects = (app) => { draw(app, 'rect', 'rect-2pt', RECT); draw(app, 'rect', 'rect-2pt', [[60.3, -10.3], [100.3, -40.3]]); }; // the second on the first's right side (its corners snap)
// a pure drawing (joints [id, x, y], shapes, coincident pairs) laid into the app's state
function lay(app, joints, shapes, coincident = []) {
  for (const [id, x, y] of joints) app.state.joints.set(id, { x, y });
  for (const s of shapes) app.state.shapes.push(s);
  for (const [a, b] of coincident) app.state.constraints.push({ id: `c_${a}_${b}`, type: 'coincident', joints: [a, b] });
  app.frames(2);
}
const L = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
// name -> [draw, { closed: closed outlines, open: open paths, circles }]
const DRAWINGS = {
  'rect 2-point alone': [(app) => draw(app, 'rect', 'rect-2pt', RECT), { closed: 1, open: 0, circles: 0 }],
  'closed line chain (Line tool)': [(app) => draw(app, 'line', null, [[10.3, -10.3], [60.3, -10.3], [60.3, -40.3], [10.3, -10.3]]), { closed: 1, open: 0, circles: 0 }],
  'rect + a line touching a corner': [(app) => { draw(app, 'rect', 'rect-2pt', RECT); draw(app, 'line', null, [[60.3, -40.3], [90.3, -60.3]]); }, { closed: 1, open: 1, circles: 0 }],
  'two rects sharing an edge': [twoRects, { closed: 2, open: 0, circles: 0 }],
  'slot c2c': [(app) => draw(app, 'slot', 'slot-c2c', [[20.3, -20.3], [70.3, -20.3], [70.3, -30.3]]), { closed: 1, open: 0, circles: 0 }],
  'rect, one corner filleted': [(app) => {
    draw(app, 'rect', 'rect-2pt', RECT);
    app.tool('fillet'); clickW(app, 60.3, -40.3);
    const box = app.document.getElementById('fillet-radius-input');
    assert(box, 'the fillet radius box opens');
    box.focus(); box.select(); app.type('5'); app.enter(); app.esc(); app.frames(2);
    assert(app.state.shapes.some((s) => s.type === 'arc'), 'the corner is filleted');
  }, { closed: 1, open: 0, circles: 0 }],
  'a bezier loop (2 lines + a bezier)': [(app) => lay(app, [['p', 0, 0], ['q', 40, 0], ['q2', 40, 0], ['r', 40, -30], ['r2', 40, -30], ['p2', 0, 0]],
    [L('bl1', 'p', 'q'), L('bl2', 'q2', 'r'), { id: 'bz', type: 'bezier', joints: ['r2', 'p2'], c1: [30, -45], c2: [-10, -35] }], [['q', 'q2'], ['r', 'r2'], ['p', 'p2']]),
    { closed: 1, open: 0, circles: 0 }],
  'an open chain: a line + an arc': [(app) => lay(app, [['a', 0, 0], ['b', 30, 0], ['b2', 30, 0], ['ac', 30, -10], ['ae', 40, -10]],
    [L('ol', 'a', 'b'), { id: 'oa', type: 'arc', subType: 'CENTER', joints: ['ac', 'b2', 'ae'], sweep: false }], [['b', 'b2']]), { closed: 0, open: 1, circles: 0 }],
  'a rect with a divider (two loops share it) + a circle': [(app) => lay(app, [['a', 0, 0], ['m', 20, 0], ['b', 40, 0], ['c', 40, -20], ['n', 20, -20], ['d', 0, -20], ['o', 70, -10]],
    [L('d1', 'a', 'm'), L('d2', 'm', 'b'), L('d3', 'b', 'c'), L('d4', 'c', 'n'), L('d5', 'n', 'd'), L('d6', 'd', 'a'), L('dv', 'm', 'n'), { id: 'ci', type: 'circle', joints: ['o'], radius: 6 }]),
    { closed: 1, open: 1, circles: 1 }],
};

// ───────────────────────────── reading the file back ─────────────────────────────
const R = (v) => Math.round(v * 1e3) / 1e3 + 0; // + 0: no -0
const pt = (p) => `${R(p.x)},${R(p.y)}`;
const TAU = Math.PI * 2;
// the centre of the circular arc from p1 to p2 of radius r with SVG's flags (fS 1 = increasing angle), and its angular midpoint
function svgArcMid(p1, p2, r, fA, fS) {
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y), h = Math.sqrt(Math.max(r * r - d * d / 4, 0));
  const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, n = { x: -(p2.y - p1.y) / d, y: (p2.x - p1.x) / d };
  for (const s of [1, -1]) {
    const c = { x: m.x + s * h * n.x, y: m.y + s * h * n.y };
    const a1 = Math.atan2(p1.y - c.y, p1.x - c.x), a2 = Math.atan2(p2.y - c.y, p2.x - c.x);
    let delta = ((a2 - a1) % TAU + TAU) % TAU; if (!fS) delta -= TAU;
    if ((Math.abs(delta) > Math.PI) === Boolean(fA) || h < 1e-9) return { c, mid: { x: c.x + r * Math.cos(a1 + delta / 2), y: c.y + r * Math.sin(a1 + delta / 2) } };
  }
  throw new Error('no centre for the arc');
}
// ONE curve's key, whichever way it is walked: a line its two ends; an arc its two ends + its angular midpoint (its side and direction-free); a bezier its
// four points in their own order or reversed (the smaller); a circle its centre + radius
const lineKey = (a, b) => 'L ' + [pt(a), pt(b)].sort().join(' ');
const arcKey = (a, b, mid) => 'A ' + [pt(a), pt(b)].sort().join(' ') + ' mid ' + pt(mid);
const bezKey = (P) => { const f = P.map(pt).join(' '), r = P.slice().reverse().map(pt).join(' '); return 'C ' + (f < r ? f : r); };
const circleKey = (c, r) => `O ${pt(c)} r ${R(r)}`;
/** every element of an SVG export as { tag, closed, keys } (a path's segments, an implicit Z-closing line included) */
function elementsOf(svg) {
  const out = [];
  for (const m of svg.matchAll(/<(path|circle|polygon|polyline|line) ([^>]*)\/>/g)) {
    const [, tag, attrs] = m;
    const a = (n) => { const r = new RegExp(`\\b${n}="([^"]*)"`).exec(attrs); return r ? r[1] : null; };
    if (tag === 'circle') { out.push({ tag, closed: true, keys: [circleKey({ x: +a('cx'), y: +a('cy') }, +a('r'))] }); continue; }
    if (tag !== 'path') { out.push({ tag, closed: tag === 'polygon', keys: [] }); continue; }
    const t = a('d').match(/[MLACZ]|-?[\d.]+(?:e-?\d+)?/g);
    const keys = []; let i = 0, cur = null, start = null, closed = false, moves = 0;
    const N = () => Number(t[i++]), P = () => ({ x: N(), y: N() });
    while (i < t.length) {
      const c = t[i++];
      if (c === 'M') { cur = start = P(); moves++; }
      else if (c === 'L') { const q = P(); keys.push(lineKey(cur, q)); cur = q; }
      else if (c === 'A') { const r = N(); N(); N(); const fA = N(), fS = N(), q = P(); keys.push(arcKey(cur, q, svgArcMid(cur, q, r, fA, fS).mid)); cur = q; }
      else if (c === 'C') { const c1 = P(), c2 = P(), q = P(); keys.push(bezKey([cur, c1, c2, q])); cur = q; }
      else if (c === 'Z') { if (Math.hypot(cur.x - start.x, cur.y - start.y) > 1e-6) keys.push(lineKey(cur, start)); closed = true; cur = start; }
      else throw new Error('unexpected path token ' + c);
    }
    out.push({ tag, closed, moves, keys, d: a('d') });
  }
  return out;
}
/** the curves of a state (the exported ones), each as its key, with the Y flip when `mirror` */
function curveKeys(st, mirror = false) {
  const J = (id) => { const p = st.joints.get(id); return mirror ? { x: p.x, y: -p.y } : { x: p.x, y: p.y }; };
  return exportedShapes(st).map((s) => {
    if (s.type === 'line') return lineKey(J(s.joints[0]), J(s.joints[1]));
    if (s.type === 'circle') return circleKey(J(s.joints[0]), s.radius);
    if (s.type === 'bezier') return bezKey(bezierPoints(s, st.joints).map((p) => (mirror ? { x: p.x, y: -p.y } : p)));
    const [c, a, b] = s.joints.map((id) => st.joints.get(id)); // the arc's midpoint in the drawing, then flipped
    const info = arcSweepInfo(c, a, b, { sweep: s.sweep }), r = Math.hypot(a.x - c.x, a.y - c.y), am = info.a0 + info.dir * info.span / 2;
    return arcKey(J(s.joints[1]), J(s.joints[2]), mirror ? { x: c.x + r * Math.cos(am), y: -(c.y + r * Math.sin(am)) } : { x: c.x + r * Math.cos(am), y: c.y + r * Math.sin(am) });
  }).sort();
}
const count = (svg) => {
  const els = elementsOf(svg);
  return { closed: els.filter((e) => e.tag === 'path' && e.closed).length, open: els.filter((e) => e.tag === 'path' && !e.closed).length, circles: els.filter((e) => e.tag === 'circle').length, other: els.filter((e) => !['path', 'circle'].includes(e.tag)).length };
};

// ───────────────────────────── S-1 / S-2 ─────────────────────────────
const exported = {};   // name -> { off, on, offKeys, onKeys, closedLoops }
for (const [name, [drawIt, want]] of Object.entries(DRAWINGS)) {
  await run(`S-1 ${name}: ${want.closed} closed outline(s), ${want.open} open path(s), ${want.circles} circle(s); every curve written exactly once, Invert Y off and on`, async () => {
    const app = await openApp();
    try {
      drawIt(app);
      app.engine.solve(); app.frames(2);
      const st = app.state;
      const off = buildSVG(st, { precision: 6 }), on = buildSVG(st, { precision: 6, invertY: true });
      assert.deepStrictEqual(count(off), { ...want, other: 0 }, `${name}: what the file holds`);
      assert.deepStrictEqual(count(on), count(off), `${name}: the inverted file holds the same`);
      const fileKeys = (svg) => elementsOf(svg).flatMap((e) => e.keys).sort();
      assert.deepStrictEqual(fileKeys(off), curveKeys(st), `${name}: the file's segments are the drawing's curves, each exactly once`);
      assert.deepStrictEqual(fileKeys(on), curveKeys(st, true), `${name}: Invert Y: the mirrored curves, each exactly once (an arc turns the other way)`);
      for (const e of elementsOf(off)) if (e.tag === 'path' && e.closed) assert.strictEqual(e.moves, 1, `${name}: a closed outline is ONE closed path (one M): ${e.d}`);
      for (const arcApprox of [true]) { // arcApprox: the same elements, every point mirrored
        const a = buildSVG(st, { precision: 4, arcApprox, arcSeg: 8 }), b = buildSVG(st, { precision: 4, arcApprox, arcSeg: 8, invertY: true });
        const nums = (svg) => [...svg.matchAll(/ (?:d|points)="([^"]*)"| c[xy]="([^"]*)"/g)].map((m) => (m[1] || m[2]).match(/-?[\d.]+/g).map(Number));
        const pa = nums(a), pb = nums(b);
        assert.strictEqual(pa.length, pb.length, `${name}: arcApprox: the same elements inverted`);
        assert(!/ A | C /.test(a), `${name}: arcApprox: arcs and beziers are sampled (no A, no C)`);
        pa.forEach((v, k) => v.forEach((x, j) => { const mirrored = j % 2 ? -x : x; if (!/<circle/.test(a)) assert(Math.abs(pb[k][j] - mirrored) < 1e-3, `${name}: arcApprox element ${k} number ${j}: ${x} -> ${pb[k][j]}`); }));
      }
      exported[name] = { off, on, offKeys: curveKeys(st), onKeys: curveKeys(st, true), loops: findLoops({ joints: st.joints, shapes: exportedShapes(st), constraints: st.constraints }).length, hasBezier: st.shapes.some((s) => s.type === 'bezier') };
    } finally { await app.close(); }
  });
}

await run('S-2 the round trip: each file through the app\'s own SVG import gives back the same curves and the same closed outlines (the inverted file: the mirrored ones)', async () => {
  for (const [name, e] of Object.entries(exported)) {
    for (const [which, svg, keys] of [['off', e.off, e.offKeys], ['on', e.on, e.onKeys]]) {
      const app = await openApp();
      try {
        const before = new Set(app.state.shapes.map((s) => s.id));
        app.importFile(svg, `${which}.svg`); // the sidebar's / the drop's import (it says how it went in a notice)
        assert(app.state.shapes.some((s) => !before.has(s.id)), `${name} (${which}): the import lands shapes`);
        const st = { joints: app.state.joints, shapes: app.state.shapes.filter((s) => !before.has(s.id)), constraints: app.state.constraints };
        const got = curveKeys(st);
        if (!e.hasBezier) assert.deepStrictEqual(got, keys, `${name} (${which}): the imported curves are the exported ones`);
        else { // the import flattens a cubic (#core/svg-import flattenCubic): every curve but the bezier comes back as it was, the bezier as lines from its start to its end
          const rest = keys.filter((k) => !k.startsWith('C ')), extra = got.filter((k) => !rest.includes(k));
          assert(rest.every((k) => got.includes(k)), `${name} (${which}): every curve but the bezier comes back`);
          assert(extra.length >= 8 && extra.every((k) => k.startsWith('L ')), `${name} (${which}): the bezier comes back as ${extra.length} lines`);
        }
        // every closed outline of the file comes back closed (the import does not join two ELEMENTS: the divider's open path stays apart from the outline written
        // before it, so that drawing comes back with its written outline + its circle, where the drawing had 3 loops)
        const c = count(svg);
        assert.strictEqual(findLoops(st).length, c.closed + c.circles, `${name} (${which}): the file's ${c.closed + c.circles} closed outline(s) come back closed (the drawing had ${e.loops})`);
      } finally { await app.close(); }
    }
  }
});

// ───────────────────────────── S-3 Shaper ─────────────────────────────
await run('S-3 Shaper: two rectangles drawn side by side (the shared side = two lines on each other): Prepare finds 2 rectangle loops, 4 lines each, no twisted loop', async () => {
  const app = await openApp('shaper');
  try {
    twoRects(app);
    app.engine.solve(); app.frames(2);
    const lines = app.state.shapes.filter((s) => s.type === 'line').map((s) => s.id);
    assert.strictEqual(lines.length, 8, 'two rectangles: 8 lines');
    app.modes.showMode('prepare');
    const loops = app.prepare.view().loops;
    assert.deepStrictEqual(loops.map((l) => [l.edges.length, new Set(l.edges).size]), [[4, 4], [4, 4]], `Prepare's loops: ${JSON.stringify(loops.map((l) => l.edges))}`);
    assert.deepStrictEqual(loops.flatMap((l) => l.edges).sort(), lines.slice().sort(), 'the two loops hold the 8 lines, each once');
    assert.deepStrictEqual(loops.map((l) => Math.round(l.area)).sort(), [1200, 1500], 'the loops are the 40 x 30 and the 50 x 30 rectangles');
  } finally { await app.close(); }
});

console.log(`svg-loops-1040-node: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
