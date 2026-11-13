// tests/fusion-drag-live.test.js -- TASK 530 (live headless, REAL mouse via CDP Input.dispatchMouseEvent, SketchStudio): the drag cells whose "ours" record
// the node replay (tests/fusion-drag.test.js) claims, checked in the REAL app: a free line by its body, a rectangle edge by its body, a circle by its rim,
// an arc by its end, a length-dimensioned free line by an end. The same path as the oracle: straight line from the grab point to the target, 20 steps,
// 30 % of the shape size. SketchStudio exposes no state global, so geometry is read from the DOM (joint handles carry data-joint-id; circles carry r).
// The expected outcomes below are the real app's; they are what tests/fixtures/fusion-oracle/drag-known.json rests on for these cells.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { buildCells, runOurs } from './harness/fusion-oracle/drag-cells.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '530' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const EV = process.env.EVIDENCE_DIR;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const dragPath = async (from, to, steps = 20) => {
      await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1); await sleep(40);
      for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, 1); await sleep(30); }
      await sleep(100); await mouse('mouseReleased', to.x, to.y, 0); await sleep(400);
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    // the shapes as drawn (screen px): lines (ends), circles (centre, r), arcs (path endpoints and radius); read from the DOM, read-only
    const geom = () => evalJs(`(() => { const rd = (v) => Math.round(v * 10) / 10; const out = { lines: [], circles: [], arcs: [], handles: {} };
      for (const e of document.querySelectorAll('#svgCanvas .joint-handle')) { const m = e.getScreenCTM(); const x = +e.getAttribute('cx'), y = +e.getAttribute('cy'); out.handles[e.dataset.jointId] = [rd(m.a * x + m.c * y + m.e), rd(m.b * x + m.d * y + m.f)]; }
      for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) { const m = e.getScreenCTM(); const P = (x, y) => [rd(m.a * x + m.c * y + m.e), rd(m.b * x + m.d * y + m.f)]; out.lines.push([P(+e.getAttribute('x1'), +e.getAttribute('y1')), P(+e.getAttribute('x2'), +e.getAttribute('y2'))]); }
      for (const e of document.querySelectorAll('#svgCanvas circle.shape-elem')) { const m = e.getScreenCTM(); out.circles.push([rd(m.a * +e.getAttribute('cx') + m.c * +e.getAttribute('cy') + m.e), rd(m.b * +e.getAttribute('cx') + m.d * +e.getAttribute('cy') + m.f), rd(+e.getAttribute('r') * m.a)]); }
      for (const e of document.querySelectorAll('#svgCanvas path.shape-elem')) { const m = e.getScreenCTM(); const n = (e.getAttribute('d') || '').match(/-?\\d+\\.?\\d*/g) || []; const P = (x, y) => [rd(m.a * x + m.c * y + m.e), rd(m.b * x + m.d * y + m.f)]; if (n.length >= 7) out.arcs.push({ start: P(+n[0], +n[1]), r: rd(+n[2] * m.a), end: P(+n[n.length - 2], +n[n.length - 1]), d: e.getAttribute('d') }); }
      return JSON.stringify(out); })()`).then(JSON.parse);
    const shot = async (name) => { if (EV) fs.writeFileSync(path.join(EV, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };
    const dd = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    // every drawn point that moved, and every length / radius that changed, by more than 1.5 px
    const diff = (a, b) => {
      const pts = [];
      a.lines.forEach((l, i) => { const m = b.lines[i]; if (!m) return; pts.push(dd(l[0], m[0]) > 1.5, dd(l[1], m[1]) > 1.5); });
      a.circles.forEach((c, i) => { const m = b.circles[i]; if (m) pts.push(dd(c, m) > 1.5); });
      a.arcs.forEach((r, i) => { const m = b.arcs[i]; if (m) pts.push(dd(r.start, m.start) > 1.5, dd(r.end, m.end) > 1.5); });
      const radii = a.circles.some((c, i) => b.circles[i] && Math.abs(c[2] - b.circles[i][2]) > 1.5) || a.arcs.some((r, i) => b.arcs[i] && Math.abs(r.r - b.arcs[i].r) > 1.5);
      const lens = a.lines.some((l, i) => b.lines[i] && Math.abs(dd(l[0], l[1]) - dd(b.lines[i][0], b.lines[i][1])) > 1.5);
      const hm = Object.keys(a.handles).filter(id => b.handles[id] && dd(a.handles[id], b.handles[id]) > 1.5).length;
      return { handlesMoved: hm, handles: Object.keys(a.handles).length, movedPoints: pts.filter(Boolean).length, points: pts.length, radiusChanged: radii, lengthChanged: lens };
    };

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!document.getElementById('tool-select'); })()`, 'SketchStudio to load');
    await waitForApp('svgCanvas');
    const cv = await centerOf('#svgCanvas');
    const mid = (l) => ({ x: (l[0][0] + l[1][0]) / 2, y: (l[0][1] + l[1][1]) / 2 });
    const alongOf = (l, f) => { const n = dd(l[0], l[1]); return { x: (l[1][0] - l[0][0]) / n * f * n, y: (l[1][1] - l[0][1]) / n * f * n }; };
    const results = {};
    const run = async (name, setup, from, vec) => {
      await setup();
      await clickEl('#tool-select'); await sleep(200);
      const before = await geom(); await shot(name + '-before.png');
      const f = typeof from === 'function' ? from(before) : from, v = typeof vec === 'function' ? vec(before) : vec;
      const to = { x: f.x + v.x, y: f.y + v.y };
      console.log(name, 'grab', JSON.stringify(f), 'to', JSON.stringify(to));
      await dragPath(f, to);
      const after = await geom(); await shot(name + '-after.png');
      results[name] = { ...diff(before, after), grab: f, to, before, after };
      console.log(name, JSON.stringify({ handlesMoved: results[name].handlesMoved, handles: results[name].handles, movedPoints: results[name].movedPoints, of: results[name].points, radiusChanged: results[name].radiusChanged, lengthChanged: results[name].lengthChanged }));
      return results[name];
    };
    const reset = async () => { await clickEl('#btn-clear'); await sleep(300); assert.strictEqual(await evalJs(`document.querySelectorAll('#svgCanvas .shape-elem').length`), 0, 'Clear All empties the board'); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(150); };
    const drawLine = async (a, b) => { await clickEl('#tool-line'); await click(a.x, a.y); await click(b.x, b.y); await key('Escape', 'Escape', 27); };

    // 1. a free line by its BODY (mid), along the line
    const L1 = [{ x: cv.x - 150, y: cv.y + 40 }, { x: cv.x + 100, y: cv.y - 40 }];
    const len1 = Math.hypot(L1[1].x - L1[0].x, L1[1].y - L1[0].y), u1 = { x: (L1[1].x - L1[0].x) / len1, y: (L1[1].y - L1[0].y) / len1 };
    await run('line-free-mid-along', async () => { await drawLine(L1[0], L1[1]); }, (g) => mid(g.lines[0]), (g) => alongOf(g.lines[0], 0.3));

    // 2. a rectangle edge by its body (bottom edge middle), along x. Task 538: the bottom edge is the lowest HORIZONTAL line (the old pick, the
    // line with the largest y, tied with the two vertical sides and took the right side: that drag was an edge pulled ACROSS itself)
    await reset();
    const R = { x1: cv.x - 120, y1: cv.y - 80, x2: cv.x + 80, y2: cv.y + 60 };
    await run('rect-free-edge-along', async () => { await clickEl('#tool-rect'); await click(R.x1, R.y1); await click(R.x2, R.y2); await key('Escape', 'Escape', 27); }, (g) => { const l = g.lines.filter(l => Math.abs(l[0][1] - l[1][1]) < 1.5).sort((p, q) => q[0][1] - p[0][1])[0]; return mid(l); }, (g) => { const l = g.lines.find(l => Math.abs(l[0][1] - l[1][1]) < 1.5); return { x: 0.3 * Math.abs(l[1][0] - l[0][0]), y: 0 }; });

    // 3. a circle by its rim, along x
    await reset();
    const C = { x: cv.x, y: cv.y, r: 80 };
    await run('circle-free-rim-along', async () => { await clickEl('#tool-circle'); await mouse('mouseMoved', C.x, C.y, 0); await sleep(40); await mouse('mousePressed', C.x, C.y, 1); for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', C.x + C.r * i / 8, C.y, 1); await sleep(30); } await mouse('mouseReleased', C.x + C.r, C.y, 0); await sleep(400); await key('Escape', 'Escape', 27); }, (g) => ({ x: g.circles[0][0] + g.circles[0][2], y: g.circles[0][1] }), (g) => ({ x: 0.3 * 2 * g.circles[0][2], y: 0 }));

    // 4. an arc by its end, across (centre, start, end clicks)
    await reset();
    const A = { c: { x: cv.x, y: cv.y + 40 }, r: 100 }, a0 = 20 * Math.PI / 180, a1 = 160 * Math.PI / 180;
    const As = { x: A.c.x + A.r * Math.cos(a0), y: A.c.y - A.r * Math.sin(a0) }, Ae = { x: A.c.x + A.r * Math.cos(a1), y: A.c.y - A.r * Math.sin(a1) };
    await run('arc-free-end-across', async () => { await clickEl('#tool-arc'); await click(A.c.x, A.c.y); await click(As.x, As.y); await click(Ae.x, Ae.y); await key('Escape', 'Escape', 27); }, (g) => ({ x: g.arcs[0].end[0], y: g.arcs[0].end[1] }), (g) => ({ x: 0, y: -0.3 * 2 * g.arcs[0].r }));

    // 5. a length-dimensioned free line by an end, across
    await reset();
    const D = [{ x: cv.x - 150, y: cv.y + 40 }, { x: cv.x + 100, y: cv.y - 40 }];
    const lenD = Math.hypot(D[1].x - D[0].x, D[1].y - D[0].y), uD = { x: (D[1].x - D[0].x) / lenD, y: (D[1].y - D[0].y) / lenD };
    await run('line-len-end-across', async () => {
      await drawLine(D[0], D[1]);
      await clickEl('#tool-dim'); await click((D[0].x + D[1].x) / 2, (D[0].y + D[1].y) / 2); await click(cv.x + 60, cv.y + 40); // the drop is a click on EMPTY space, clear of both axes (the origin is at about cv + (-117, +117); a click on an axis is the second pick, task 555)
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension input', 8000);
      await key('Enter', 'Enter', 13); await sleep(400);
      console.log('dimension labels:', await evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.trim()))`));
    }, (g) => ({ x: g.lines[0][1][0], y: g.lines[0][1][1] }), (g) => { const l = g.lines[0], n = dd(l[0], l[1]), ux = (l[1][0] - l[0][0]) / n, uy = (l[1][1] - l[0][1]) / n; return { x: -uy * 0.3 * n, y: ux * 0.3 * n }; });
    if (EV) fs.writeFileSync(path.join(EV, 'fusion-drag-live-results.json'), JSON.stringify(results, null, 1));
    // the REAL app's outcome per cell (read from the DOM after a real mouse drag)
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
    for (const [live, id] of Object.entries(mode)) { const cell = buildCells().find(c => c.id === id); assert.strictEqual(runOurs(cell).mode, want[live], `${id}: the node replay class equals the real app's (${want[live]})`); }
    console.log('fusion-drag-live.test.js: ok', JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v.movedPoints}/${v.points} moved${v.lengthChanged ? ', length changed' : ''}${v.radiusChanged ? ', radius changed' : ''}`]))));
  } finally { await cdp.close(); }
})();
