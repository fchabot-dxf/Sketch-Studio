// tests/recentre-on-reload-node.test.js - TASK 576 (node port of tests/recentre-on-reload-live.test.js, TASK 494): a restored drawing is framed
// (fitToDrawing) after a reload and after Open recent. SketchStudio and Shaper (their shared Design canvas) through
// tests/helpers/node-app.js; designs are seeded straight into the shared project store; a reload is close() and open() on the same profile.
//  - a small drawing far off-centre: after a reload its box is inside the canvas, centred, with the 10% margin
//  - an empty design keeps the default view
//  - after the user zooms, an autosave tick does not re-fit (a real 3.2 s wait: two ticks of the buffer's 1.5 s poll)
//  - Open recent of another design fits THAT design; a huge and a tiny drawing both end up visible (tiny capped at FIT_MIN_WIDTH)
// Differences from the browser run: Open recent runs the project action the Open recent tile runs (designItems 'open', the same one the
// Projects modal calls) instead of clicking the sidebar and the tile, which the kit does not mount; the wheel is a WheelEvent on the canvas.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { createProjectActions } from '#ui/project-actions.js';

const line = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
const doc = (pts, shapes) => ({
  version: 1,
  geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true }], ...pts.map(([id, x, y]) => [id, { x, y }])], shapes, constraints: [] },
  hosts: {},
});
const SMALL = { name: 'small', bbox: { minX: 5000, minY: 3000, maxX: 5040, maxY: 3020 }, document: doc([['a', 5000, 3000], ['b', 5040, 3020]], [line('L1', 'a', 'b')]) };
const HUGE = { name: 'huge', bbox: { minX: -90000, minY: -40000, maxX: 30000, maxY: 25000 }, document: doc([['a', -90000, -40000], ['b', 30000, 25000]], [line('L1', 'a', 'b')]) };
const TINY = { name: 'tiny', bbox: { minX: -900, minY: 700, maxX: -899.5, maxY: 700 }, document: doc([['a', -900, 700], ['b', -899.5, 700]], [line('L1', 'a', 'b')]) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = null;
try {
  const viewBoxOf = (app) => { const r = app.svg.getBoundingClientRect(); return { vb: app.svg.getAttribute('viewBox').split(' ').map(Number), w: r.width, h: r.height }; };
  // The drawing's box must lie inside the viewBox, centred, with the 10% margin (or the capped width for a tiny drawing).
  const assertFramed = (v, bbox, label) => {
    const [vx, vy, vw, vh] = v.vb; // viewBox = x - w/2, y - h/2, w, h
    const bw = bbox.maxX - bbox.minX, bh = bbox.maxY - bbox.minY;
    const cx = vx + vw / 2, cy = vy + vh / 2, tol = Math.max(vw, vh) * 1e-3;
    assert(Math.abs(cx - (bbox.minX + bbox.maxX) / 2) < tol && Math.abs(cy - (bbox.minY + bbox.maxY) / 2) < tol, `${label}: centred (view centre ${cx},${cy})`);
    assert(bbox.minX >= vx && bbox.maxX <= vx + vw && bbox.minY >= vy && bbox.maxY <= vy + vh, `${label}: box inside the canvas`);
    assert(Math.abs(vw / vh - v.w / v.h) < 1e-3, `${label}: viewBox aspect follows the canvas`);
    if (Math.max(bw, bh) * 1.2 < 10) assert(Math.abs(vw - 10) < 1e-6, `${label}: tiny drawing capped at 10 units across (got ${vw})`);
    else assert(Math.max(bw / vw, bh / vh) > 0.8 && Math.max(bw / vw, bh / vh) < 0.84, `${label}: 10% margin (fill ${Math.max(bw / vw, bh / vh)})`);
    console.log(label, 'ok: viewBox', v.vb.map((n) => +n.toFixed(3)).join(' '));
  };
  for (const host of ['sketchstudio', 'shaper']) { // Pen Plotter stays in tests/recentre-on-reload-live.test.js: its framing is wired in the page script (sketch-stage.js), not in design-canvas.js
    SMALL.bbox.maxY = 3020;
    const profile = await createProfile();
    let app = null;
    const goto = async () => { if (app) await app.close(); app = await open({ host, profile }); app.frames(3); await sleep(50); };
    // Seeds a NEW current design in the shared store (the app is loaded, so the store is the page's own).
    const seed = async (d) => { const p = await app.store.newDesign(d.name, { app: host }); await app.store.save(d.document, { app: host, id: p.id }); return p.id; };
    try {
      await goto();
      // an EMPTY design keeps the default view (the host's own initial view), and a second empty reload gives the identical view
      await seed({ name: 'empty', document: doc([], []) });
      await goto();
      const e1 = viewBoxOf(app);
      await goto();
      assert.deepStrictEqual(viewBoxOf(app).vb, e1.vb, host + ': empty design view is stable across reloads');
      console.log(host, 'empty ok: viewBox', e1.vb.join(' '));

      // a small drawing far off-centre: framed after a reload
      const smallId = await seed(SMALL);
      await goto();
      assertFramed(viewBoxOf(app), SMALL.bbox, host + ' small off-centre after reload');

      const framedW = viewBoxOf(app).vb[2];
      // the user zooms: an autosave tick (the buffer polls every 1.5 s) must not re-fit
      const r = app.svg.getBoundingClientRect();
      const wx = Math.round(r.left + r.width * 0.3), wy = Math.round(r.top + r.height * 0.4);
      app.svg.dispatchEvent(new app.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: wx, clientY: wy, deltaX: 0, deltaY: -400 })); app.frames();
      await sleep(50); app.frames(3);
      const zoomed = viewBoxOf(app);
      assert(zoomed.vb[2] < framedW, host + ': wheel zoomed in (' + zoomed.vb + ')');
      await app.store.save(doc([['a', 5000, 3000], ['b', 5040, 3020], ['c', 5040, 3050]], [line('L1', 'a', 'b'), line('L2', 'b', 'c')]), { app: host, id: smallId });
      await sleep(3200); app.frames(3); // two autosave ticks
      assert.deepStrictEqual(viewBoxOf(app).vb, zoomed.vb, host + ': an autosave tick after a zoom does not re-fit');
      console.log(host, 'no re-fit after a user zoom ok');
      SMALL.bbox.maxY = 3050; // the autosave step above added a line to this design

      // a huge and a tiny drawing both end up visible after a reload
      await seed(HUGE); await goto();
      assertFramed(viewBoxOf(app), HUGE.bbox, host + ' huge after reload');
      await seed(TINY); await goto();
      assertFramed(viewBoxOf(app), TINY.bbox, host + ' tiny after reload');

      // Open recent of another design fits THAT design (current = tiny; open "small" and then "huge")
      const actions = createProjectActions({ store: app.store, getBuffer: () => app.buffer, ask: async () => 'discard' });
      for (const d of [SMALL, HUGE]) {
        const rows = await app.store.listRecent(host); // what the Open recent pane lists
        const row = rows.find((x) => x.name === d.name); assert(row, 'Recent has ' + d.name);
        const vbBefore = app.svg.getAttribute('viewBox');
        await actions.designItems(row).find((i) => i.id === 'open').run();
        await app.waitFor(() => app.svg.getAttribute('viewBox') !== vbBefore, host + ' to fit the opened design ' + d.name);
        app.frames(3);
        assertFramed(viewBoxOf(app), d.bbox, host + ' Open recent -> ' + d.name);
      }
    } finally { if (app) await app.close(); }
  }
  console.log('recentre-on-reload node test passed');
} catch (e) { failed = e; }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
