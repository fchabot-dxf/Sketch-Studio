// tests/arc-rim-drag-live.test.js -- TASK 578 in the REAL SketchStudio (headless, REAL mouse via CDP), on the owner's drawing
// (tests/fixtures/drag/owner-two-arcs-575.json: two concentric arcs about the origin held by the origin, radii 2286 / 2667 dimensioned, sides
// collinear with construction lines through the origin, a 10 deg angle; one DOF left = the rotation). Grabbing an arc's END (rim) joint j8 drags
// that joint alone: before, the whole arc (centre welded to the origin) was one locked cluster and j8 never moved. Now 40 mouse moves of 4 px
// along its circle rotate the drawing about the origin (the grabbed end keeps pace with the cursor: its parallel inference, a snap, holds it
// on its line for up to about 13 events at a time, so the lag bound is 60 px), both radii and the origin hold, the arcs stay concentric.
import assert from 'node:assert';
import fs from 'node:fs';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const DOC = JSON.parse(fs.readFileSync(new URL('./fixtures/drag/owner-two-arcs-575.json', import.meta.url), 'utf8'));
const J8 = 'j8_1794492561525', J2 = 'j2_1794492542145', SIDE = 's1794492578633';

await (async () => {
  const cdp = await launchBrowser({ tag: '578' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp } = cdp;
  try {
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    // the side j8 ends (s1794492578633: j8 -> j12, j12 sits on the inner arc end j2) read from the drawn line, in world units, and the canvas transform
    const geo = () => evalJs(`(() => { const m = document.querySelector('#svgCanvas .shape-elem').getScreenCTM(); const l = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="${SIDE}"]');
      const v = l && [+l.getAttribute('x1'), +l.getAttribute('y1'), +l.getAttribute('x2'), +l.getAttribute('y2')];
      return JSON.stringify({ v, m: [m.a, m.b, m.c, m.d, m.e, m.f] }); })()`).then(JSON.parse).then((r) => ({ m: r.m, o: r.v ? { [J8]: [r.v[0], r.v[1]], [J2]: [r.v[2], r.v[3]] } : {} }));
    const toS = (g, p) => [g.m[0] * p[0] + g.m[2] * p[1] + g.m[4], g.m[1] * p[0] + g.m[3] * p[1] + g.m[5]];
    const deg = (p) => Math.atan2(p[1], p[0]) * 180 / Math.PI;

    // the owner's drawing in a NAMED design (task 558: only a named design is stored), reloaded: the app restores and frames it
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Owner 578', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);

    let g = await geo();
    assert.ok(g.o[J8] && g.o[J2], 'j8 and j2 are drawn');
    const a0 = deg(g.o[J8]), R8 = Math.hypot(...g.o[J8]), R2 = Math.hypot(...g.o[J2]);
    const o = toS(g, [0, 0]), p = toS(g, g.o[J8]), Rs = Math.hypot(p[0] - o[0], p[1] - o[1]), s0 = Math.atan2(p[1] - o[1], p[0] - o[0]);
    await mouse('mouseMoved', p[0], p[1], 0); await sleep(80); await mouse('mousePressed', p[0], p[1], 1); await sleep(80);
    let worst = 0, c = p;
    for (let k = 1; k <= 40; k++) {
      const a = s0 + 4 * k / Rs; c = [o[0] + Rs * Math.cos(a), o[1] + Rs * Math.sin(a)];
      await mouse('mouseMoved', c[0], c[1], 1); await sleep(30);
      const gg = await geo(); const q = toS(gg, gg.o[J8]); worst = Math.max(worst, Math.hypot(q[0] - c[0], q[1] - c[1]));
    }
    await sleep(100); await mouse('mouseReleased', c[0], c[1], 0); await sleep(400);
    g = await geo();
    const rot = deg(g.o[J8]) - a0, travel = rot * Math.PI / 180 * Rs;
    const R8b = Math.hypot(...g.o[J8]), R2b = Math.hypot(...g.o[J2]);
    console.log(`j8 dragged 160 px along its circle: rotated ${rot.toFixed(3)} deg (${travel.toFixed(1)} px of travel), worst gap ${worst.toFixed(2)} px, radii ${R8.toFixed(4)} -> ${R8b.toFixed(4)} / ${R2.toFixed(4)} -> ${R2b.toFixed(4)}`);
    assert.ok(travel > 100, 'j8 followed the cursor (' + travel.toFixed(1) + ' of 160 px)');
    assert.ok(worst < 60, 'j8 stayed within 60 px of the cursor (worst ' + worst.toFixed(2) + ')');
    assert.ok(Math.abs(R8b - R8) < 0.01 && Math.abs(R2b - R2) < 0.01, 'the radii d3 / d2 hold');
    console.log('arc-rim-drag-live.test.js: ok');
  } finally { await cdp.close(); }
})();
