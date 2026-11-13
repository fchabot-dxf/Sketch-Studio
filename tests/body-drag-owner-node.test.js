// tests/body-drag-owner-node.test.js - TASK 576 (node port of tests/body-drag-owner-live.test.js, TASK 538), SketchStudio through
// tests/helpers/node-app.js: the owner's case. An arc drawn with the arc tool below the origin, its centre held on the Y axis by the H/V tool
// (origin + centre: vertical) and 1.5 from the origin by the dimension tool; its ends free. Grab the arc's BODY at its lowest point and pull it
// down (20 pointer steps): the centre stays, the radius grows by the pull, both ends keep their angles, the sweep its sign and size; pull back up:
// it returns. Geometry is read from the DOM the renderer drew (the arc path and its centre joint dot), in world units, as the browser test did.
// The view is panned up 250 px with a middle-button drag (as the browser test did). World y points down (SVG).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { labels, typeValue, px } from './helpers/node-dom-read.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const svg = app.svg;
  const clickBtn = (id) => { app.document.getElementById(id).click(); app.frames(); };
  const click = (x, y) => app.click(x, y);
  const dragPath = (from, to, steps = 20) => app.drag(from, to, steps);
  // the arc as drawn: its path (start, end, radius, flags) in WORLD units, the origin joint, and every drawn joint dot (world)
  const geom = () => {
    const p = svg.querySelector('path.shape-elem');
    const o = svg.querySelector('.joint-handle[data-joint-id="j_origin"]');
    const out = { origin: o ? [+o.getAttribute('cx'), +o.getAttribute('cy')] : null, dots: [] };
    if (p) { const n = (p.getAttribute('d') || '').match(/-?\d+\.?\d*(e-?\d+)?/g).map(Number); out.arc = { d: p.getAttribute('d'), s: [n[0], n[1]], r: n[2], large: n[5], sweep: n[6], e: [n[7], n[8]] }; }
    for (const c of svg.querySelectorAll('circle')) { if (c.classList.contains('joint-handle')) continue; const r = +c.getAttribute('r'); if (r > 0 && r < 20) out.dots.push([+c.getAttribute('cx'), +c.getAttribute('cy')]); }
    out.labels = labels(app);
    return out;
  };
  const toScreen = (p) => px(app, p[0], p[1]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // the arc centre: the drawn dot at distance r from both path ends (the path is drawn from the joints)
  const centreOf = (g) => { const c = g.dots.filter((q) => Math.abs(dist(q, g.arc.s) - g.arc.r) < 1e-3 * g.arc.r && Math.abs(dist(q, g.arc.e) - g.arc.r) < 1e-3 * g.arc.r); assert.strictEqual(c.length > 0, true, 'the arc centre dot is drawn: ' + JSON.stringify(g)); return c[0]; };
  const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]) * 180 / Math.PI;
  const state = (g) => { const c = centreOf(g); return { c, r: g.arc.r, aS: ang(c, g.arc.s), aE: ang(c, g.arc.e), large: g.arc.large, sweep: g.arc.sweep }; };

  // pan the view up 250 px (a middle-button drag) so the arc below the origin sits clear of the canvas edges (a drag near an edge pans the view)
  const rc = svg.getBoundingClientRect();
  const cv = { x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) };
  app.drag({ x: cv.x + 300, y: cv.y + 100 }, { x: cv.x + 300, y: cv.y - 150 }, 10, { button: 1, buttons: 4 });
  let g = geom();
  assert(g.origin, 'the origin joint is drawn');
  const O = toScreen(g.origin), scale = px(app, 0, 1).y - px(app, 0, 0).y, DIM = 1.5, PULL = 0.3;
  assert(O.y < cv.y - 100, 'the view panned up: origin at screen y ' + O.y);
  // 1. the arc: centre DIM below the origin, ends at 20 and 160 degrees below it (screen y down), radius 0.9 units (all on screen below the origin)
  const C = { x: O.x, y: O.y + DIM * scale }, Rpx = 0.9 * scale, a0 = 20 * Math.PI / 180, a1 = 160 * Math.PI / 180;
  clickBtn('tool-arc');
  click(C.x, C.y); click(C.x + Rpx * Math.cos(a0), C.y + Rpx * Math.sin(a0)); click(C.x + Rpx * Math.cos(a1), C.y + Rpx * Math.sin(a1));
  app.esc();
  g = geom();
  assert(g.arc, 'the arc is drawn');
  const c0 = toScreen(centreOf(g));
  // 2. vertical with the origin: the H/V tool on the origin and the arc centre
  clickBtn('tool-hv'); click(O.x, O.y); click(c0.x, c0.y); app.esc();
  // 3. the DIM dimension between the origin and the centre
  clickBtn('tool-dim'); click(O.x, O.y); click(c0.x, c0.y); click(O.x + 90, (O.y + c0.y) / 2);
  await typeValue(app, String(DIM));
  app.esc(); clickBtn('tool-select');
  g = geom();
  const before = state(g);
  console.log('built:', JSON.stringify({ labels: g.labels, origin: g.origin, centre: before.c, r: before.r, ends: [before.aS, before.aE], path: g.arc.d }));
  assert(g.labels.some((t) => parseFloat(t) === DIM), `a driving ${DIM} dimension: ` + JSON.stringify(g.labels));
  assert(Math.abs(before.c[0] - g.origin[0]) < 1e-6 && Math.abs(before.c[1] - g.origin[1] - DIM) < 1e-6, `the centre is held ${DIM} below the origin on the Y axis: ` + JSON.stringify(before.c));
  assert(Math.abs(before.aS - 20) < 1 && Math.abs(before.aE - 160) < 1, 'the arc is as drawn (ends at 20 and 160 degrees): ' + JSON.stringify(before));

  // 4. pull the body (the arc's lowest point) down by PULL, then back up
  const low = toScreen([before.c[0], before.c[1] + before.r]);
  dragPath(low, { x: low.x, y: low.y + PULL * scale });
  g = geom();
  const down = state(g);
  console.log(`pulled down ${PULL}:`, JSON.stringify(down));
  assert(dist(down.c, before.c) < 1e-6, `the centre stays (${JSON.stringify(before.c)} -> ${JSON.stringify(down.c)})`);
  assert(Math.abs(down.r - before.r - PULL) < 0.01, `the radius grows by ${PULL} (${before.r} -> ${down.r})`);
  assert(Math.abs(down.aS - before.aS) < 0.1 && Math.abs(down.aE - before.aE) < 0.1, `the ends keep their angles (${before.aS}, ${before.aE} -> ${down.aS}, ${down.aE})`);
  assert(down.large === before.large && down.sweep === before.sweep, 'the drawn sweep keeps its flags (no complement)');
  const low2 = toScreen([down.c[0], down.c[1] + down.r]);
  dragPath(low2, { x: low2.x, y: low2.y - PULL * scale });
  g = geom();
  const back = state(g);
  console.log(`pulled back up ${PULL}:`, JSON.stringify(back));
  assert(dist(back.c, before.c) < 1e-6 && Math.abs(back.r - before.r) < 0.01, `pulled back up: centre kept, radius back (${back.r})`);
  assert(Math.abs(back.aS - before.aS) < 0.1 && Math.abs(back.aE - before.aE) < 0.1, 'pulled back up: the ends keep their angles');
  console.log(`body-drag-owner-node: ok (radius ${before.r.toFixed(3)} -> ${down.r.toFixed(3)} -> ${back.r.toFixed(3)}, centre kept)`);
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
