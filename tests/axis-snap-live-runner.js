// tests/axis-snap-live-runner.js - TASK 537 live scenarios (headless CDP, real pointer events). NOT a test file itself: the gate runs each
// *.test.js under a 90 s limit, so axis-snap-live-{lines,shapes,session}.test.js each set ONLY and import this runner.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '537', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp, flushAutosave } = cdp;
  try {
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const drag = async (a, b) => {
      await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleep(60);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await sleep(30); }
      await mouse('mouseReleased', b.x, b.y, 0); await sleep(200);
    };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(120);
    };
    const TOOL = { l: 'line', r: 'rect', c: 'circle', a: 'arc', s: 'select' };
    const letter = async (c) => { await evalJs(`document.getElementById('tool-${TOOL[c]}').click()`); await sleep(200); };
    const esc = () => key('Escape', 'Escape', 27);
    const undoKey = () => key('z', 'KeyZ', 90, 2);
    const stored = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const fresh = async () => {
      await navigate(url, 8000); await waitForApp('svgCanvas');
      await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
      await navigate(url, 8000); await waitForApp('svgCanvas');
    };
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const EVID = process.env.EVIDENCE_DIR || '';
    const jointsOf = (d) => { const jo = d && d.joints; if (!jo) return {}; const out = {}; for (const e of (Array.isArray(jo) ? jo : Object.entries(jo))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
      if (EVID) { fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); }
    };
    // task 539: the snap leaves a POINT-ON-LINE with the built-in axis line (ref_axis_x / ref_axis_y)
    const isAxisH = (c) => String(c.type) === 'pointOnLine' && c.shape === 'ref_axis_x';
    const isAxisV = (c) => String(c.type) === 'pointOnLine' && c.shape === 'ref_axis_y';
    const readDesign = async () => { await flushAutosave(); return stored(); }; // the autosave writes through the app's own page-hide path, then the store holds the current state
    const drawBase = async (o) => { await click(o.x + 300, o.y + 200); await esc(); };

    const scenarios = {
      'line end on X axis': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 200, o.y + 9); await esc(); },
      'line end on Y axis': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 7, o.y + 120); await esc(); },
      'line start on X axis': async (o) => { await letter('l'); await click(o.x + 160, o.y + 8); await click(o.x + 260, o.y - 90); await esc(); },
      'rect corner on X axis': async (o) => { await letter('r'); await click(o.x + 150, o.y - 100); await click(o.x + 250, o.y + 8); await esc(); },
      'circle centre on Y axis': async (o) => { await letter('c'); await click(o.x + 6, o.y + 120); await click(o.x + 60, o.y + 120); await esc(); },
      'polygon centre on X axis': async (o) => { await evalJs("document.getElementById('tool-polygon').click()"); await sleep(200); await click(o.x + 200, o.y + 7); await click(o.x + 260, o.y + 7); await esc(); },
      'arc centre on X axis': async (o) => { await letter('a'); await click(o.x + 200, o.y + 7); await click(o.x + 260, o.y - 60); await click(o.x + 140, o.y - 40); await esc(); },
      'select drag to X axis': async (o) => {
        await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 250, o.y - 90); await esc();
        await letter('s'); await drag({ x: o.x + 250, y: o.y - 90 }, { x: o.x + 300, y: o.y + 10 }); await esc();
      },
    };
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const results = {};
    for (const [name, run] of Object.entries(scenarios)) {
      if (only && !only.includes(name)) continue;
      await fresh();
      const o = await toScreen(0, 0);
      await drawBase(o);
      await run(o);
      const d = await readDesign();
      const J = jointsOf(d);
      const h = d.constraints.filter(isAxisH), v = d.constraints.filter(isAxisV);
      const onX = Object.entries(J).filter(([id, p]) => id !== 'j_origin' && Math.abs(p.y) < 1e-6 && Math.abs(p.x) > 1).map(([id]) => id);
      const onY = Object.entries(J).filter(([id, p]) => id !== 'j_origin' && Math.abs(p.x) < 1e-6 && Math.abs(p.y) > 1).map(([id]) => id);
      results[name] = { shapes: d.shapes.length, h: h.length, v: v.length, onX, onY, constraints: d.constraints.map((c) => c.type + ':' + (c.joints || [c.joint]).join('+')) };
      console.log(name.padEnd(26), JSON.stringify(results[name]));
    }
    const R = results;
    const need = (name, cond, msg) => { if (only && !only.includes(name)) return; assert(R[name] && R[name].shapes >= 1, name + ': a shape was drawn'); assert(cond(R[name]), name + ': ' + msg + ' got ' + JSON.stringify(R[name])); };
    need('line end on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'end joint at y === 0 exactly with a horizontal constraint to j_origin');
    need('line end on Y axis', (r) => r.v >= 1 && r.onY.length >= 1, 'end joint at x === 0 exactly with a vertical constraint to j_origin');
    need('line start on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'start joint on the X axis with a horizontal constraint');
    need('rect corner on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'a rect corner on the X axis with a horizontal constraint');
    need('circle centre on Y axis', (r) => r.v >= 1 && r.onY.length >= 1, 'circle centre on the Y axis with a vertical constraint');
    need('polygon centre on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'polygon centre on the X axis with a horizontal constraint');
    need('arc centre on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'arc centre on the X axis with a horizontal constraint');
    need('select drag to X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'the dragged joint on the X axis with a horizontal constraint');

    if (!only || only.includes('session')) {
      // the line's second point stays on the axis when the FIRST point is dragged; save/load keeps it; undo removes it
      await fresh();
      let o = await toScreen(0, 0);
      await drawBase(o);
      await letter('l');
      await click(o.x + 160, o.y - 90);
      // BEFORE: pointer 60 px off the axis (no snap) / AFTER: pointer 9 px off (snap): the indicator, cropped
      await move(o.x + 200, o.y + 60); await sleep(150);
      await shot('before-no-snap.png', { x: o.x + 60, y: o.y - 60, w: 280, h: 160 });
      assert(await evalJs('document.querySelectorAll(\'[data-snap-axis]\').length') === 0, 'no axis highlight 60 px off the axis');
      await move(o.x + 200, o.y + 9); await sleep(150);
      await shot('after-axis-snap.png', { x: o.x + 60, y: o.y - 60, w: 280, h: 160 });
      const axisHighlight = await evalJs('document.querySelectorAll(\'[data-snap-axis="axis-x"]\').length');
      assert(axisHighlight >= 1, 'the X axis is highlighted while the snap is active; got ' + axisHighlight);
      await click(o.x + 200, o.y + 9); await esc();
      let d = await readDesign();
      let J = jointsOf(d);
      const line = d.shapes.find((s) => s.type === 'line');
      const [aId, bId] = line.joints;
      assert(J[bId].y === 0, 'end joint y is exactly 0: ' + J[bId].y);
      assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'pointOnLine(end, ref_axis_x) stored');
      // a point-on-line glyph is hidden by design until its joint is selected: nothing to assert here
      await shot('after-glyph.png', { x: o.x + 60, y: o.y - 60, w: 280, h: 160 });
      // undo removes the axis constraint (the line is one undo group), redo brings it back with the end joint on the axis
      let gone = false;
      for (let i = 0; i < 4 && !gone; i++) { await key('z', 'KeyZ', 90, 2); d = await readDesign(); gone = !d || !d.constraints.some((c) => isAxisH(c) && c.joint === bId); }
      assert(gone, 'undo removes the axis constraint');
      await key('y', 'KeyY', 89, 2); d = await readDesign(); J = jointsOf(d);
      assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'redo brings the axis constraint back');
      assert(Math.abs(J[bId].y) < 1e-6, 'redo: the end joint is back on the axis: ' + J[bId].y);
      // drag the first point
      await letter('s');
      const a = await toScreen(J[aId].x, J[aId].y);
      await drag(a, { x: a.x + 30, y: a.y - 60 });
      await esc();
      d = await readDesign(); J = jointsOf(d);
      assert(Math.abs(J[bId].y) < 1e-6, 'the end joint stays on the axis after the first point is dragged: ' + J[bId].y);
      // save / load
      await navigate(url, 8000); await waitForApp('svgCanvas');
      d = await stored(); J = jointsOf(d);
      assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'the constraint survives save/load');
      assert(Math.abs(J[bId].y) < 1e-6, 'the end joint is still on the axis after load: ' + J[bId].y);
      console.log('line end: undo-redo / drag-first-point / save-load ok');
    }

    // setting off: no axis snap
    if (!only || only.includes('setting off')) {
      await fresh();
      await evalJs("localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false }))");
      await navigate(url, 8000); await waitForApp('svgCanvas');
      const o = await toScreen(0, 0);
      await drawBase(o);
      await letter('l'); await click(o.x + 160, o.y - 90); await move(o.x + 200, o.y + 9); await sleep(150);
      assert(await evalJs('document.querySelectorAll(\'[data-snap-axis]\').length') === 0, 'setting off: no axis highlight');
      await click(o.x + 200, o.y + 9); await esc();
      const d = await readDesign();
      assert(!d.constraints.some((c) => isAxisH(c) || isAxisV(c)), 'setting off: no axis constraint; got ' + JSON.stringify(d.constraints.map((c) => c.type + ':' + (c.joints || [c.joint]).join('+'))));
      await evalJs("localStorage.removeItem('sketch-studio-settings')");
      console.log('setting off: ok');
    }

    console.log('axis-snap-live: ok');
  } finally {
    await cdp.close();
  }
})();
