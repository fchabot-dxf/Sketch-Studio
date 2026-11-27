// tests/offset-650-live.test.js -- TASK 650 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Draw an L of two lines. Offset (Modify group), tap one line: its chain (both lines) lights up, the distance box opens; the preview follows the
// side of the cursor (mouse: a move; touch: a tap on the canvas) and flips on the other side. Esc: no change, no undo step. Tap again, type 5,
// Enter -> two new lines 5 mm from their sources, joined (one shared corner), ONE offset dimension label. ONE Undo removes all of it, Redo puts it
// back. Select, double click / double tap the offset label, 8, Enter -> the offset chain moves to 8 mm, the sources stay.
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots: .evidence/650.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '650');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '650', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const typeIn = async (id, text) => { await evalJs(`(() => { const i = document.getElementById('${id}'); i.focus(); i.select(); })()`); for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(200); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: {
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
        hover: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(150); },
        double: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); for (let i = 0; i < 2; i++) { await mouse('mousePressed', p.x, p.y, 1); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0); await sleep(60); } await sleep(300); },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        hover: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); }, // a finger has no hover: the side is a tap
        double: async (p) => { for (let i = 0; i < 2; i++) { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(80); } await sleep(300); },
      },
    };
    const hist = () => evalJs(`${STATE}.history.length`);
    const box = () => evalJs(`(() => { const i = document.getElementById('offset-distance-input'); return i ? i.value : null; })()`);
    const overlay = () => evalJs(`!!document.getElementById('offset-tool-overlay')`);
    const lit = () => evalJs(`document.querySelectorAll('#offset-tool-overlay .offset-chain').length`);
    // the preview's offset lines, in WORLD units (the overlay draws in world coordinates)
    const preview = () => evalJs(`JSON.stringify([...document.querySelectorAll('#offset-tool-overlay line.offset-preview')].map((e) => ['x1', 'y1', 'x2', 'y2'].map((a) => +e.getAttribute(a))))`).then(JSON.parse);
    const lines = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'line').map((s) => ({ id: s.id, a: ${STATE}.joints.get(s.joints[0]), b: ${STATE}.joints.get(s.joints[1]), j: s.joints })))`).then(JSON.parse);
    const offsets = () => evalJs(`JSON.stringify(${STATE}.constraints.filter((c) => c.type === 'offset').map((c) => ({ shapes: c.shapes, value: c.value, name: c.name, idx: ${STATE}.constraints.indexOf(c) })))`).then(JSON.parse);
    const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    // distance from line L's two ends to the infinite line through M (world)
    const distTo = (L, M) => { const ux = M.b.x - M.a.x, uy = M.b.y - M.a.y, l = Math.hypot(ux, uy); return [L.a, L.b].map((p) => Math.abs((p.x - M.a.x) * uy - (p.y - M.a.y) * ux) / l); };

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');

    const run = async (kind) => {
      const P = pointers[kind];
      const out = (s) => console.log(`[${kind}] ${s}`);
      if (kind === 'touch') {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        const l2 = once('Page.loadEventFired');
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
        await Promise.race([l2, sleep(8000)]);
        await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button (phone)');
      }
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
      await sleep(500);
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const tool = async (id) => { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); };
      // the ribbon: Offset in the Modify group, right after Mirror (TASK 647 moved Mirror into Modify)
      const rib = await evalJs(`(() => { const b = document.getElementById('tool-offset'); const g = b && b.closest('.sk-ribbon-group'); return g ? { label: g.querySelector('.sk-ribbon-group-label').textContent, ids: [...g.querySelectorAll('.sk-ribbon-btn')].map((x) => x.id) } : null; })()`);
      assert(rib && rib.label === 'Modify' && rib.ids.indexOf('tool-offset') === rib.ids.indexOf('tool-mirror') + 3, `[${kind}] Offset in Modify after Mirror and the two pattern tools (task 658): ${JSON.stringify(rib)}`);
      // the L, big against 5 mm: the corner low-left, arms up and right (screen px); then measured in world mm
      const arm = Math.min(cr.w * 0.32, 220);
      const K = { x: cr.l + cr.w * 0.5 - arm * 0.5, y: cr.t + cr.h * 0.62 };
      const A = { x: K.x, y: K.y - arm }, B = { x: K.x + arm, y: K.y };
      await tool('tool-line'); await P.tap(A); await P.tap(K); await P.tap(B); await key('Escape', 'Escape', 27);
      const src = await lines();
      assert.strictEqual(src.length, 2, `[${kind}] two lines are drawn`);
      const lenMm = Math.min(...src.map((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)));
      assert(lenMm > 20, `[${kind}] the L's arms (${lenMm.toFixed(1)} mm) are long against a 5 mm offset`);
      const h0 = await hist();
      const onA = { x: K.x, y: K.y - arm * 0.5 }, inside = { x: K.x + arm * 0.3, y: K.y - arm * 0.5 }, outside = { x: K.x - arm * 0.5, y: K.y - arm * 0.5 };
      const clip = { x: Math.max(0, K.x - 70), y: Math.max(0, A.y - 40), width: Math.min(arm + 140, cr.w), height: arm + 110 };

      // ---- 1. pick: chain lit, box, preview on the cursor side, flips; Esc: nothing, no undo step
      await tool('tool-offset');
      await P.tap(onA);
      await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind}] the distance box`);
      assert.strictEqual(parseFloat(await box()), 5, `[${kind}] the box opens with the remembered 5`);
      assert.strictEqual(await lit(), 2, `[${kind}] the connected chain (both lines) lights up`);
      await P.hover(inside);
      const pin = await preview();
      const srcA = src.find((s) => Math.abs(s.a.x - s.b.x) < Math.abs(s.a.y - s.b.y)); // the up arm
      const vin = pin.find((l) => Math.abs(l[0] - l[2]) < Math.abs(l[1] - l[3]));
      assert(pin.length === 2 && vin && Math.abs(Math.abs(vin[0] - srcA.a.x) - 5) < 0.2, `[${kind}] the preview: two lines, the up one 5 mm from its source ${JSON.stringify(pin)}`);
      await shot(`${kind}-1-preview-inside.png`, clip);
      await P.hover(outside);
      const pout = await preview();
      const vout = pout.find((l) => Math.abs(l[0] - l[2]) < Math.abs(l[1] - l[3]));
      assert(vout && Math.sign(vout[0] - srcA.a.x) === -Math.sign(vin[0] - srcA.a.x), `[${kind}] the other side flips the preview`);
      await shot(`${kind}-2-preview-outside.png`, clip);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await box(), null, `[${kind}] Esc closes the box`);
      assert.strictEqual(await overlay(), false, `[${kind}] Esc removes the preview`);
      assert.strictEqual((await lines()).length, 2, `[${kind}] Esc makes nothing`);
      assert.strictEqual(await hist(), h0, `[${kind}] Esc leaves no undo step`);
      await tool('tool-offset'); // R2-07 (owner ruling BUG-105): ONE Esc left the tool, so the next pick starts from its button

      // ---- 2. tap, type 5, Enter: two lines 5 mm away, joined, one dimension; one undo step
      await P.tap(onA); await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind}] the box again`);
      await P.hover(inside);
      await typeIn('offset-distance-input', '5');
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await box(), null, `[${kind}] Enter closes the box`);
      const after = await lines(), offs = await offsets();
      assert.strictEqual(after.length, 4, `[${kind}] two new lines`);
      assert.strictEqual(offs.length, 1, `[${kind}] one offset constraint`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] one undo step`);
      const byId = new Map(after.map((s) => [s.id, s]));
      const pairs = [0, 1].map((k) => [byId.get(offs[0].shapes[2 * k]), byId.get(offs[0].shapes[2 * k + 1])]);
      for (const [s, o] of pairs) for (const d of distTo(o, s)) assert(Math.abs(d - 5) < 1e-6, `[${kind}] an offset line is 5 mm from its source (${d})`);
      assert(pairs[0][1].j.some((j) => pairs[1][1].j.includes(j)), `[${kind}] the two new lines share their corner (joined)`);
      const labels = await evalJs(`JSON.stringify([...document.querySelectorAll('.dim-label[data-constraint-idx="${offs[0].idx}"]')].map((e) => e.textContent.trim()))`).then(JSON.parse);
      assert(labels.length === 1 && /5/.test(labels[0]), `[${kind}] the offset dimension label: ${labels}`);
      await shot(`${kind}-3-result-with-dimension.png`, clip);
      out(`applied: dimension ${offs[0].name} = ${offs[0].value}, label ${labels[0]}`);

      // ---- 3. ONE Undo removes all of it; Redo
      const undoBtn = await evalJs(`(() => { const r = document.getElementById('btn-undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await P.tap(undoBtn); await sleep(200);
      assert.strictEqual((await lines()).length, 2, `[${kind}] one Undo removes both new lines`);
      assert.strictEqual((await offsets()).length, 0, `[${kind}] ... and the dimension`);
      const redoBtn = await evalJs(`(() => { const r = document.getElementById('btn-redo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await P.tap(redoBtn); await sleep(200);
      assert.strictEqual((await offsets()).length, 1, `[${kind}] Redo brings it back`);

      // ---- 4. the dimension edit: double click / double tap the label, 8, Enter: the chain moves, the sources stay
      await tool('tool-select');
      const o2 = (await offsets())[0];
      const lab = await evalJs(`(() => { const e = document.querySelector('.dim-label[data-constraint-idx="${o2.idx}"]'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await sleep(600);
      await P.double(lab);
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `[${kind}] the dimension box`);
      await typeIn('dimInput', '8');
      await key('Enter', 'Enter', 13);
      await sleep(300);
      const moved = await lines(), m = new Map(moved.map((s) => [s.id, s]));
      for (let k = 0; k < 2; k++) {
        const s = m.get(o2.shapes[2 * k]), o = m.get(o2.shapes[2 * k + 1]);
        for (const d of distTo(o, s)) assert(Math.abs(d - 8) < 1e-4, `[${kind}] after the edit an offset line is 8 mm from its source (${d})`);
        const s0 = src.find((x) => x.id === s.id);
        assert(Math.hypot(s.a.x - s0.a.x, s.a.y - s0.a.y) < 1e-6 && Math.hypot(s.b.x - s0.b.x, s.b.y - s0.b.y) < 1e-6, `[${kind}] the source stays`);
      }
      assert.strictEqual((await offsets())[0].value, 8, `[${kind}] the dimension reads 8`);
      await shot(`${kind}-4-edited-to-8.png`, clip);
      out('edit to 8 moved the chain');

      // leave the sketch empty (the next run reloads the same stored design)
      for (let i = 0; i < 8 && await evalJs(`!document.getElementById('btn-undo').disabled`); i++) { await P.tap(undoBtn); await sleep(150); }
      assert.strictEqual(await evalJs(`${STATE}.shapes.length`), 0, `[${kind}] sketch emptied`);
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('offset-650-live.test.js: ok');
  } finally { await cdp.close(); }
})();
