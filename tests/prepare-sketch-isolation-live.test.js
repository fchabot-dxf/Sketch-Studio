// tests/prepare-sketch-isolation-live.test.js
// Real Shaper Prepare desktop CDP verification:
//   - Outer rectangle in Sketch 2 enclosing an inner rectangle in Sketch 1 selects ONLY the outer rectangle (1 subpath, not 2).
//   - Shift+click inside Sketch 1's inner rectangle selects both profiles independently across sketches (2 selected paths).
//   - Same-sketch enclosing frame in Sketch 1 still auto-selects its same-sketch hole (2 subpaths).
// Screenshots to .evidence/prepare-sketch-isolation/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', 'prepare-sketch-isolation');
const r2 = (v) => Math.round(v * 100) / 100;

await (async () => {
  const cdp = await launchBrowser({ tag: 'prep-iso', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });
  const click = async (x, y, modifiers = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0, modifiers }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers }); await sleep(260);
  };
  const press = async (sel) => {
    const pt = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !x.hidden && x.getClientRects().length > 0); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(pt, `missing clickable ${sel}`);
    await click(pt.x, pt.y);
  };
  const canvasBox = () => evalJs(`(() => { const b = document.getElementById('design-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  const drawRectFrac = async (fx0, fy0, fx1, fy1) => {
    const active = await evalJs(`window.__designController.state.currentTool === 'rect'`);
    if (!active) {
      await press('.sk-ribbon-btn[data-tool="rect"]');
      await waitFor(`window.__designController.state.currentTool === 'rect'`, 'rect tool active');
    }
    const r = await canvasBox();
    const a = { x: Math.round(r.x + r.w * fx0), y: Math.round(r.y + r.h * fy0) };
    const b = { x: Math.round(r.x + r.w * fx1), y: Math.round(r.y + r.h * fy1) };
    await click(a.x, a.y);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'none', clickCount: 0 });
    await sleep(60);
    await click(b.x, b.y);
    await sleep(120);
  };
  const worldCenterOf = (sketchId, preferLargest = true) => evalJs(`(() => {
    const st = window.__designController.state;
    const shapes = st.shapes.filter((s) => !s.isConstruction && (s.sketchId || 'sketch-1') === ${JSON.stringify(sketchId)});
    const boxes = [];
    for (let i = 0; i + 3 < shapes.length; i += 4) {
      const pts = shapes.slice(i, i + 4).flatMap((s) => s.joints.map((id) => st.joints.get(id)));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      boxes.push({ x0, y0, x1, y1, area: (x1 - x0) * (y1 - y0) });
    }
    boxes.sort((a, b) => ${preferLargest ? 'b.area - a.area' : 'a.area - b.area'});
    return boxes[0];
  })()`);
  const clickPrepareWorld = async (wx, wy, modifiers = 0) => {
    const p = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await click(p.x, p.y, modifiers);
  };
  const selected = async () => JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#prepare-select-group path')].map((p) => { const b = p.getBBox(); return [(p.getAttribute('d').match(/M/g) || []).length, [b.x, b.y, b.x + b.width, b.y + b.height]]; }))`))
    .map(([n, b]) => [n, b.map(r2)]).sort((u, v) => u[1][0] - v[1][0]);
  const shot = async (name) => {
    const b = await evalJs(`(() => { const g = document.querySelector('#prepare-select-group').closest('svg').getBoundingClientRect(); return { x: Math.round(g.left), y: Math.round(g.top), width: Math.round(g.width), height: Math.round(g.height) }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...b, scale: 1 } });
    fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
  };

  try {
    fs.mkdirSync(EVID, { recursive: true });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');
    await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);

    // Sketch 1: inner slat (left) AND same-sketch outer frame (right) with hole inside it
    await drawRectFrac(0.36, 0.38, 0.46, 0.62);
    await drawRectFrac(0.58, 0.28, 0.84, 0.72);
    await drawRectFrac(0.64, 0.38, 0.78, 0.62);

    // Add Sketch 2 via Sketches panel '+' and draw outer rect enclosing Sketch 1's left inner slat
    await press('.sk-tree-add');
    await waitFor(`window.__designController.state.activeSketchId === 'sketch-2'`, 'Sketch 2 active');
    await drawRectFrac(0.30, 0.28, 0.52, 0.72);
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.filter((s) => !s.isConstruction).length`), 16, '16 non-construction lines (4 rects)');

    const sk2Outer = await worldCenterOf('sketch-2', true);
    const sk1Boxes = await evalJs(`(() => {
      const st = window.__designController.state;
      const shapes = st.shapes.filter((s) => !s.isConstruction && (s.sketchId || 'sketch-1') === 'sketch-1');
      const out = [];
      for (let i = 0; i + 3 < shapes.length; i += 4) {
        const pts = shapes.slice(i, i + 4).flatMap((s) => s.joints.map((id) => st.joints.get(id)));
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      }
      return out.sort((a, b) => a.x0 - b.x0);
    })()`);
    assert.strictEqual(sk1Boxes.length, 3, '3 rects in Sketch 1');
    const [leftSlat, rightOuter] = [sk1Boxes[0], sk1Boxes[1]];

    // Switch to Prepare
    await press('.sk-header-tab[data-tab="prepare"]');
    await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'Prepare drawn');
    await sleep(400);

    // 1. Click Sketch 2 outer rect margin (left side inside sk2Outer, outside leftSlat): selects ONLY Sketch 2 outer rect (1 subpath, NO hole from Sketch 1)
    await clickPrepareWorld((sk2Outer.x0 + leftSlat.x0) / 2, (sk2Outer.y0 + sk2Outer.y1) / 2);
    const selOuter = await selected();
    assert.strictEqual(selOuter.length, 1, 'one selected profile');
    assert.strictEqual(selOuter[0][0], 1, 'outer rect in Sketch 2 has 1 subpath (no auto-hole from Sketch 1): ' + JSON.stringify(selOuter));
    await shot('prepare-outer-sketch2-only.png');

    // 2. Shift+click inside Sketch 1 inner slat: multi-selects BOTH profiles independently
    await clickPrepareWorld((leftSlat.x0 + leftSlat.x1) / 2, (leftSlat.y0 + leftSlat.y1) / 2, 8);
    const selMulti = await selected();
    assert.strictEqual(selMulti.length, 2, 'Shift+click selects both Sketch 2 outer and Sketch 1 inner independently');
    assert.deepStrictEqual(selMulti.map((x) => x[0]), [1, 1], 'each selected target has 1 subpath');
    await shot('prepare-shift-multiselect.png');

    // 3. Click same-sketch frame in Sketch 1 (left margin inside rightOuter, outside rightHole): same-sketch auto-hole STILL works (2 subpaths)
    const rightHole = sk1Boxes[2];
    await clickPrepareWorld((rightOuter.x0 + rightHole.x0) / 2, (rightOuter.y0 + rightOuter.y1) / 2);
    const selSame = await selected();
    assert.strictEqual(selSame.length, 1, 'one selected same-sketch frame');
    assert.strictEqual(selSame[0][0], 2, 'same-sketch outer frame keeps its same-sketch hole (2 subpaths)');
    await shot('prepare-same-sketch-hole.png');

    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('prepare-sketch-isolation-live: ok');
  } finally {
    await cdp.close();
  }
})();
