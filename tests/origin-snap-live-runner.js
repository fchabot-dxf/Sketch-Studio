// tests/origin-snap-live-runner.js - TASK 554 live scenarios (headless CDP, real pointer events). NOT a test file itself: the gate runs each
// *.test.js under a 90 s limit, so origin-snap-live-*.test.js each set HOST / AXIS / ZOOMS (and AWAY) and import this runner.
//
// The owner's report: "I can't snap to origin anymore", "the origin isn't even showing". Cause: "New design" (sidebar / Projects modal)
// loads the store's empty document, which has no joints at all, and loading a document did not put the origin back, so the new design had
// NO j_origin: no origin marker, nothing to snap to, and no axis snap (it hangs on the origin joint). Every scenario here starts from
// "New design" (the path that lost it): the origin marker is drawn, then each tool is moved onto the origin and clicked / released, and
// the element it made must be attached to the origin: the origin joint itself is used, or a new joint sits exactly at (0, 0) with a
// COINCIDENT constraint to j_origin. The snap indicator shown just before the press must be the origin joint.
//   HOST  'sketchstudio' | 'shaper'      AXIS  'on' | 'off' (the AXIS_SNAP setting)
//   ZOOMS wheel steps applied (about the origin) before each level, e.g. '0,4,-8' = default, 4 in, then 8 out (= 4 out of the default);
//         rows report the net steps from the default (0 / 4 / -4)
//   AWAY  '1' = also check axis snap AWAY from the origin (a line end near the X axis gets horizontal(end, j_origin) when on, nothing when off)

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './helpers/cdp-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HOST = process.env.HOST || 'sketchstudio';
const AXIS = process.env.AXIS || 'on';
const ZOOMS = (process.env.ZOOMS || '0').split(',').map(Number);
const AWAY = process.env.AWAY === '1';
const EVID = process.env.EVIDENCE_DIR || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));





await (async () => {
  const cdp = await launchBrowser({ tag: '554', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, ws, waitFor, navigate, waitForApp, flushAutosave } = cdp;
  try {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    const CANVAS = HOST === 'shaper' ? 'design-canvas' : 'svgCanvas';
    const url = `http://127.0.0.1:${port}/apps/${HOST}/index.html`;
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); };
    // a click that lands on a panel / toolbar instead of the canvas would make a scenario pass vacuously: refuse it
    const onCanvas = (x, y) => evalJs(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!(e && e.closest && e.closest('#${CANVAS}')); })()`);
    const press = async (x, y) => { assert(await onCanvas(x, y), 'the press at ' + x + ',' + y + ' is not on the canvas'); await mouse('mousePressed', x, y, 1); await sleep(40); };
    const click = async (x, y) => { await move(x, y); await press(x, y); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(120);
    };
    const esc = () => key('Escape', 'Escape', 27);
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleep(200); };
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('${CANVAS}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const pxPerUnit = () => evalJs(`+document.getElementById('${CANVAS}').getScreenCTM().a.toFixed(3)`);
    // the snap the canvas shows right now (the shared input layer's dev summary window.ug.snap.log: type + target of the active snap)
    const snapShown = () => evalJs(`(() => { const s = window.ug.snap.log(); return s.activeSnap ? s.activeSnap.type + ':' + s.activeSnap.targetId : null; })()`);
    // the origin marker: the white joint circle drawn at (0, 0) plus the j_origin handle (svg-renderer.js joint pass)
    const originMarker = () => evalJs(`(() => { const s = document.getElementById('${CANVAS}'); return !!s.querySelector('[data-joint-id="j_origin"]') && [...s.querySelectorAll('circle')].some((c) => +c.getAttribute('cx') === 0 && +c.getAttribute('cy') === 0 && /fill:[^;]*white/.test(c.getAttribute('style') || '')); })()`);
    const storedDoc = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    // Shaper's Design tab has the test hook window.__designController (the live state); SketchStudio is read from its autosaved store.
    const readDoc = async () => {
      if (HOST === 'shaper') return JSON.parse(await evalJs(`(() => { const s = window.__designController.state; return JSON.stringify({ shapes: s.shapes, constraints: s.constraints, joints: [...s.joints.entries()] }); })()`));
      await flushAutosave(); return storedDoc(); // the autosave writes through the app's own page-hide path, then the store holds the current state
    };
    const jmap = (d) => { const out = {}; for (const e of (Array.isArray(d.joints) ? d.joints : Object.entries(d.joints))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };

    // boot: no stored design, the AXIS_SNAP setting as asked
    await navigate(url, 8000); await waitFor(`!!document.querySelector('#' + ${JSON.stringify(CANVAS)}) || !!document.querySelector('[data-mode="design"]')`, 'the app to load');
    await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
    await evalJs(`localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: ${AXIS === 'on'} }))`);
    await navigate(url, 8000);
    if (HOST === 'shaper') {
      await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'the Shaper to load');
      for (let i = 0; i < 6; i++) { await evalJs(`document.querySelector('[data-mode="design"]').click()`); await sleep(500); if (await evalJs(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`)) break; }
      await sleep(800);
    }
    await waitForApp(CANVAS);

    // "New design" from the app menu (the Projects modal's toolbar runs the same projectActions.newDesign)
    const newDesign = async () => {
      await evalJs(`document.querySelector('.sk-sidebar-btn').click()`); await sleep(300);
      await evalJs(`document.querySelector('.sk-sidebar-item[data-action="new-design"]').click()`); await sleep(1200);
      await esc(); // the drawer, if it stayed open
      if (HOST !== 'shaper') return null; // SketchStudio is read from its autosave (seconds per read): its origin is checked by the marker, which is drawn only for a j_origin in the state
      const d = await readDoc();
      assert.deepStrictEqual(d.shapes, [], 'New design starts empty');
      return d;
    };
    const zoomAboutOrigin = async (steps) => {
      if (!steps) return;
      const o = await toScreen(0, 0);
      await move(o.x, o.y);
      for (let i = 0; i < Math.abs(steps); i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: o.x, y: o.y, deltaX: 0, deltaY: steps > 0 ? -120 : 120 }); await sleep(100); }
      await sleep(250);
    };
    // the approach: moves converging on the origin, then the press ON it; the snap shown just before the press is recorded
    let shown = null;
    const onOrigin = async (o, release = true) => {
      for (const [dx, dy] of [[60, 50], [30, 25], [6, 4], [2, 1], [0, 0]]) await move(o.x + dx, o.y + dy);
      await sleep(60); shown = await snapShown();
      await press(o.x, o.y);
      if (release) { await mouse('mouseReleased', o.x, o.y, 0); await sleep(150); }
    };
    const S = 80; // screen px to the element's other points
    const scenarios = {
      'line start': async (o) => { await tool('line'); await onOrigin(o); await click(o.x + 2 * S, o.y - S); await esc(); },
      'line end': async (o) => { await tool('line'); await click(o.x + 2 * S, o.y - S); await onOrigin(o); await esc(); },
      'rect corner': async (o) => { await tool('rect'); await onOrigin(o); await click(o.x + 2 * S, o.y - S); await esc(); },
      'circle centre': async (o) => { await tool('circle'); await onOrigin(o); await click(o.x + S, o.y - S); await esc(); },
      'arc centre': async (o) => { await tool('arc'); await onOrigin(o); await click(o.x + S, o.y - S); await click(o.x - S, o.y - S); await esc(); },
      'polygon centre': async (o) => { await tool('polygon'); await onOrigin(o); await click(o.x + S, o.y - S); await esc(); },
      'select drag': async (o) => {
        await tool('line'); await click(o.x + 2 * S, o.y - S); await click(o.x + S, o.y - 2 * S); await esc();
        await tool('select');
        const a = { x: o.x + S, y: o.y - 2 * S };
        await move(a.x, a.y); await press(a.x, a.y);
        for (const [x, y] of [[a.x - 20, a.y + 40], [a.x - 40, a.y + 80], [o.x + 30, o.y - 40], [o.x + 8, o.y - 6], [o.x + 2, o.y - 1], [o.x, o.y]]) { await mouse('mouseMoved', x, y, 1); await sleep(40); }
        await sleep(60); shown = await snapShown();
        await mouse('mouseReleased', o.x, o.y, 0); await sleep(250); await esc();
      },
    };

    const rows = [];
    const scales = [];
    const baseScale = await pxPerUnit(); // the default zoom; a level with net wheel steps must be a different scale
    let netSteps = 0;
    for (const z of ZOOMS) {
      await zoomAboutOrigin(z);
      netSteps += z;
      for (const [name, run] of Object.entries(scenarios)) {
        const before = await newDesign();
        const scale = await pxPerUnit();
        const marker = await originMarker();
        const bj = before ? jmap(before) : { j_origin: marker };
        const o = await toScreen(0, 0);
        shown = null;
        await run(o);
        const d = await readDoc();
        const J = jmap(d);
        const made = d.shapes;
        const usesOrigin = made.some((s) => (s.joints || []).includes('j_origin'));
        const coincident = d.constraints.filter((c) => c.type === 'coincident' && (c.joints || []).includes('j_origin')).map((c) => c.joints.find((j) => j !== 'j_origin'));
        const coincidentAtOrigin = coincident.filter((j) => J[j] && J[j].x === 0 && J[j].y === 0);
        const row = { zoom: netSteps, pxPerUnit: scale, name, originBefore: !!bj.j_origin, marker, shown, usesOrigin, coincidentAtOrigin: coincidentAtOrigin.length, shapes: made.length, origin: J.j_origin || null };
        rows.push(row);
        console.log('ROW', JSON.stringify(row));
        if (EVID && name === 'line end') { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: o.x - 120, y: o.y - 120, width: 240, height: 240, scale: 2 } }); fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, `${HOST}-axis${AXIS}-zoom${z}-line-end.png`), Buffer.from(r.data, 'base64')); }
      }
      scales.push(rows[rows.length - 1].pxPerUnit);
    }
    for (const r of rows) {
      const tag = `${HOST} axis ${AXIS} zoom ${r.zoom} (${r.pxPerUnit} px/unit) ${r.name}: `;
      assert(r.originBefore && r.marker, tag + 'the new design has its origin joint and the origin marker is drawn; got ' + JSON.stringify(r));
      assert.deepStrictEqual(r.origin, { x: 0, y: 0, fixed: true, ...(r.origin && r.origin.sketchId ? { sketchId: r.origin.sketchId } : {}) }, tag + 'the origin stays fixed at (0, 0)');
      assert(r.shapes >= 1, tag + 'an element was made');
      assert.strictEqual(r.shown, 'joint:j_origin', tag + 'the snap shown on the origin is the origin joint (not an axis, not the grid)');
      assert(r.usesOrigin || r.coincidentAtOrigin >= 1, tag + 'the element is attached to the origin (uses j_origin, or a joint at exactly (0, 0) coincident with it); got ' + JSON.stringify(r));
    }
    for (const r of rows) if (r.zoom !== 0) assert.notStrictEqual(r.pxPerUnit, baseScale, 'a zoomed level is not the default scale: ' + JSON.stringify({ baseScale, r }));
    for (let i = 1; i < scales.length; i++) assert.notStrictEqual(scales[i], scales[i - 1], 'each zoom level is a different scale: ' + JSON.stringify(scales));

    if (AWAY) {
      // axis snap AWAY from the origin, in a new design: a line end released 9 px off the X axis, far from the origin
      await newDesign();
      const o = await toScreen(0, 0);
      await tool('line'); await click(o.x + 160, o.y - 90); await move(o.x + 220, o.y + 30); await move(o.x + 200, o.y + 9); await sleep(80);
      const awayShown = await snapShown();
      await click(o.x + 200, o.y + 9); await esc();
      const d = await readDoc(); const J = jmap(d);
      const h = d.constraints.filter((c) => c.type === 'horizontal' && (c.joints || []).includes('j_origin'));
      const end = d.shapes[0] && d.shapes[0].joints[1];
      console.log('AWAY', JSON.stringify({ axis: AXIS, shown: awayShown, h: h.length, end: J[end] }));
      if (AXIS === 'on') {
        assert.strictEqual(awayShown, 'axis-x:axis-x', 'away from the origin the X axis snap is shown');
        assert(h.length === 1 && h[0].joints.includes(end) && J[end].y === 0, 'the line end sits on the X axis with horizontal(end, j_origin): ' + JSON.stringify({ h, end: J[end] }));
      } else {
        assert.notStrictEqual(awayShown, 'axis-x:axis-x', 'axis snap off: no X axis snap');
        assert.strictEqual(h.length, 0, 'axis snap off: no horizontal constraint with the origin');
      }
    }

    console.log(`origin-snap-live ${HOST} axis ${AXIS} zooms ${ZOOMS.join(',')}: ok (${rows.length} cells)`);
  } finally {
    await cdp.close();
  }
})();
