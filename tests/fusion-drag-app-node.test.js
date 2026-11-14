// tests/fusion-drag-app-node.test.js - TASK 576 (node port of tests/fusion-drag-live.test.js, TASK 530), SketchStudio through tests/helpers/node-app.js: the drag
// cells whose "ours" record the node replay (tests/fusion-drag.test.js) claims, checked in the app's own pointer path: a free line by its body, a
// rectangle edge by its body, a circle by its rim, an arc by its end, a length-dimensioned free line by an end. The same path as the oracle: a
// straight line from the grab point to the target, 20 steps, 30 % of the shape size. Geometry is read from the DOM the renderer drew (joint handles,
// lines, circles, arc paths), in screen px through the app's world -> screen. The expected outcomes are the app's; they are what
// tests/fixtures/fusion-oracle/drag-known.json rests on for these cells.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { buildCells, runOurs } from './harness/fusion-oracle/drag-cells.js';
import { px } from './helpers/node-dom-read.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const svg = app.svg;
  const rd = (v) => Math.round(v * 10) / 10;
  const P = (x, y) => { const p = px(app, x, y); return [rd(p.x), rd(p.y)]; };
  const scale = () => px(app, 1, 0).x - px(app, 0, 0).x;
  const clickBtn = (id) => { app.document.getElementById(id).click(); app.frames(); };
  // the shapes as drawn (screen px): lines (ends), circles (centre, r), arcs (path endpoints and radius); read from the DOM, read-only
  const geom = () => {
    const out = { lines: [], circles: [], arcs: [], handles: {} };
    for (const e of svg.querySelectorAll('.joint-handle')) out.handles[e.dataset.jointId] = P(+e.getAttribute('cx'), +e.getAttribute('cy'));
    for (const e of svg.querySelectorAll('line.shape-elem')) out.lines.push([P(+e.getAttribute('x1'), +e.getAttribute('y1')), P(+e.getAttribute('x2'), +e.getAttribute('y2'))]);
    for (const e of svg.querySelectorAll('circle.shape-elem')) { const c = P(+e.getAttribute('cx'), +e.getAttribute('cy')); out.circles.push([c[0], c[1], rd(+e.getAttribute('r') * scale())]); }
    for (const e of svg.querySelectorAll('path.shape-elem')) { const n = (e.getAttribute('d') || '').match(/-?\d+\.?\d*/g) || []; if (n.length >= 7) out.arcs.push({ start: P(+n[0], +n[1]), r: rd(+n[2] * scale()), end: P(+n[n.length - 2], +n[n.length - 1]), d: e.getAttribute('d') }); }
    return out;
  };
  const dd = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  // every drawn point that moved, and every length / radius that changed, by more than 1.5 px
  const diff = (a, b) => {
    const pts = [];
    a.lines.forEach((l, i) => { const m = b.lines[i]; if (!m) return; pts.push(dd(l[0], m[0]) > 1.5, dd(l[1], m[1]) > 1.5); });
    a.circles.forEach((c, i) => { const m = b.circles[i]; if (m) pts.push(dd(c, m) > 1.5); });
    a.arcs.forEach((r, i) => { const m = b.arcs[i]; if (m) pts.push(dd(r.start, m.start) > 1.5, dd(r.end, m.end) > 1.5); });
    const radii = a.circles.some((c, i) => b.circles[i] && Math.abs(c[2] - b.circles[i][2]) > 1.5) || a.arcs.some((r, i) => b.arcs[i] && Math.abs(r.r - b.arcs[i].r) > 1.5);
    const lens = a.lines.some((l, i) => b.lines[i] && Math.abs(dd(l[0], l[1]) - dd(b.lines[i][0], b.lines[i][1])) > 1.5);
    const hm = Object.keys(a.handles).filter((id) => b.handles[id] && dd(a.handles[id], b.handles[id]) > 1.5).length;
    return { handlesMoved: hm, handles: Object.keys(a.handles).length, movedPoints: pts.filter(Boolean).length, points: pts.length, radiusChanged: radii, lengthChanged: lens };
  };
  const rc = svg.getBoundingClientRect();
  const cv = { x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) };
  const mid = (l) => ({ x: (l[0][0] + l[1][0]) / 2, y: (l[0][1] + l[1][1]) / 2 });
  const alongOf = (l, f) => { const n = dd(l[0], l[1]); return { x: (l[1][0] - l[0][0]) / n * f * n, y: (l[1][1] - l[0][1]) / n * f * n }; };
  const results = {};
  const run = (name, setup, from, vec) => {
    setup();
    clickBtn('tool-select');
    const before = geom();
    const f = typeof from === 'function' ? from(before) : from, v = typeof vec === 'function' ? vec(before) : vec;
    const to = { x: f.x + v.x, y: f.y + v.y };
    console.log(name, 'grab', JSON.stringify(f), 'to', JSON.stringify(to));
    app.drag(f, to, 20);
    const after = geom();
    results[name] = { ...diff(before, after), grab: f, to, before, after };
    console.log(name, JSON.stringify({ handlesMoved: results[name].handlesMoved, handles: results[name].handles, movedPoints: results[name].movedPoints, of: results[name].points, radiusChanged: results[name].radiusChanged, lengthChanged: results[name].lengthChanged }));
    return results[name];
  };
  const reset = () => { app.state.clearDocument(); app.frames(); assert.strictEqual(svg.querySelectorAll('.shape-elem').length, 0, 'Clear All empties the board'); };
  const drawLine = (a, b) => { clickBtn('tool-line'); app.click(a.x, a.y); app.click(b.x, b.y); app.esc(); };

  // 1. a free line by its BODY (mid), along the line
  const L1 = [{ x: cv.x - 150, y: cv.y + 40 }, { x: cv.x + 100, y: cv.y - 40 }];
  run('line-free-mid-along', () => { drawLine(L1[0], L1[1]); }, (g) => mid(g.lines[0]), (g) => alongOf(g.lines[0], 0.3));

  // 2. a rectangle edge by its body (bottom edge middle), along x. Task 538: the bottom edge is the lowest HORIZONTAL line (the old pick, the
  // line with the largest y, tied with the two vertical sides and took the right side: that drag was an edge pulled ACROSS itself)
  reset();
  const R = { x1: cv.x - 120, y1: cv.y - 80, x2: cv.x + 80, y2: cv.y + 60 };
  run('rect-free-edge-along', () => { clickBtn('tool-rect'); app.click(R.x1, R.y1); app.click(R.x2, R.y2); app.esc(); }, (g) => { const l = g.lines.filter((l) => Math.abs(l[0][1] - l[1][1]) < 1.5).sort((p, q) => q[0][1] - p[0][1])[0]; return mid(l); }, (g) => { const l = g.lines.find((l) => Math.abs(l[0][1] - l[1][1]) < 1.5); return { x: 0.3 * Math.abs(l[1][0] - l[0][0]), y: 0 }; });

  // 3. a circle by its rim, along x
  reset();
  const C = { x: cv.x, y: cv.y, r: 80 };
  run('circle-free-rim-along', () => { clickBtn('tool-circle'); app.drag({ x: C.x, y: C.y }, { x: C.x + C.r, y: C.y }, 8); app.esc(); }, (g) => ({ x: g.circles[0][0] + g.circles[0][2], y: g.circles[0][1] }), (g) => ({ x: 0.3 * 2 * g.circles[0][2], y: 0 }));

  // 4. an arc by its end, across (centre, start, end clicks)
  reset();
  const A = { c: { x: cv.x, y: cv.y + 40 }, r: 100 }, a0 = 20 * Math.PI / 180, a1 = 160 * Math.PI / 180;
  const As = { x: A.c.x + A.r * Math.cos(a0), y: A.c.y - A.r * Math.sin(a0) }, Ae = { x: A.c.x + A.r * Math.cos(a1), y: A.c.y - A.r * Math.sin(a1) };
  run('arc-free-end-across', () => { clickBtn('tool-arc'); app.click(A.c.x, A.c.y); app.click(As.x, As.y); app.click(Ae.x, Ae.y); app.esc(); }, (g) => ({ x: g.arcs[0].end[0], y: g.arcs[0].end[1] }), (g) => ({ x: 0, y: -0.3 * 2 * g.arcs[0].r }));

  // 5. a length-dimensioned free line by an end, across
  reset();
  const D = [{ x: cv.x - 150, y: cv.y + 40 }, { x: cv.x + 100, y: cv.y - 40 }];
  await (async () => {
    // the dimension step awaits the value box, so the run's setup is run here and `run` is given a no-op setup
    drawLine(D[0], D[1]);
    clickBtn('tool-dim'); app.click((D[0].x + D[1].x) / 2, (D[0].y + D[1].y) / 2); app.click(cv.x + 60, cv.y + 40); // the drop is a click on EMPTY space, clear of both axes (a click on an axis is the second pick, task 555)
    await app.waitFor(() => { const i = app.document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); }, 'the dimension input');
    app.enter(); app.frames(3);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === 'distance').length, 1, 'the line has its length dimension (the browser run only logged the labels)');
    console.log('dimension labels:', JSON.stringify([...svg.querySelectorAll('.dim-label')].map((e) => e.textContent.trim())));
  })();
  run('line-len-end-across', () => {}, (g) => ({ x: g.lines[0][1][0], y: g.lines[0][1][1] }), (g) => { const l = g.lines[0], n = dd(l[0], l[1]), ux = (l[1][0] - l[0][0]) / n, uy = (l[1][1] - l[0][1]) / n; return { x: -uy * 0.3 * n, y: ux * 0.3 * n }; });
  // the app's outcome per cell (read from the DOM after the drag)
  const r = results;
  // task 538: a body drag pulls the grabbed point (definitions.js BODY_POINTS); each of these three now has Fusion's recorded class
  assert(r['line-free-mid-along'].movedPoints === 2 && !r['line-free-mid-along'].lengthChanged, 'free line by its body: both ends move, the length is kept (translate, like Fusion): ' + JSON.stringify(r['line-free-mid-along']));
  assert(r['rect-free-edge-along'].movedPoints === 8 && !r['rect-free-edge-along'].lengthChanged, 'rectangle edge by its body: all 8 drawn points move, no side length changes (translate, like Fusion)');
  assert(r['circle-free-rim-along'].movedPoints === 0 && r['circle-free-rim-along'].radiusChanged, 'circle grabbed on its rim resizes (centre kept, radius changes, like Fusion)');
  assert(r['arc-free-end-across'].radiusChanged, 'arc grabbed by its end: the radius changes (stretch)');
  assert(r['line-len-end-across'].movedPoints === 2 && !r['line-len-end-across'].lengthChanged, 'length-dimensioned free line by an end: both ends move, the length is kept (rotate)');
  // the node replay (tests/fusion-drag.test.js) must give the same CLASS for the same cells: it adds the app's render-loop solve after every pointer move
  const mode = { 'line-free-mid-along': 'line.free.mid.along', 'rect-free-edge-along': 'rect.free.edge.along', 'circle-free-rim-along': 'circle.free.rim.along', 'arc-free-end-across': 'arc.free.end.across', 'line-len-end-across': 'line.len.end.across' };
  const want = { 'line-free-mid-along': 'translate', 'rect-free-edge-along': 'translate', 'circle-free-rim-along': 'stretch', 'arc-free-end-across': 'stretch', 'line-len-end-across': 'rotate' };
  for (const [name, id] of Object.entries(mode)) { const cell = buildCells().find((c) => c.id === id); assert.strictEqual(runOurs(cell).mode, want[name], `${id}: the node replay class equals the app's (${want[name]})`); }
  console.log('fusion-drag-app-node: ok', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v.movedPoints}/${v.points} moved${v.lengthChanged ? ', length changed' : ''}${v.radiusChanged ? ', radius changed' : ''}`]))));
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
