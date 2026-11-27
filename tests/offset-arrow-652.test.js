// tests/offset-arrow-652.test.js -- TASK 652 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// An L of two lines. Offset, tap a line: the distance box opens and ONE shared drag ARROW (drag-arrow-handle.js, class offset-handle) sits on the
// preview, pointing the way the distance grows.
//  - dragging it outwards grows the box value and the preview's offset distance equals it; releasing keeps the box open; Enter applies that distance;
//  - Esc after a drag: no change, no undo step; dragging it across the source flips the side;
//  - the arrow is a >= 44 px target (a press 20 px off its centre still grabs it), draws darker while dragged, the done check never overlaps it;
//  - a tool switch removes it.
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots: .evidence/652.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '652');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '652', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: {
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
        hover: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(150); },
        down: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(60); },
        move: async (p) => { await mouse('mouseMoved', p.x, p.y, 1); await sleep(25); },
        up: async (p) => { await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        hover: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        down: async (p) => { await T('touchStart', [p]); await sleep(60); },
        move: async (p) => { await T('touchMove', [p]); await sleep(25); },
        up: async () => { await T('touchEnd', []); await sleep(300); },
      },
    };
    const hist = () => evalJs(`${STATE}.history.length`);
    const box = () => evalJs(`(() => { const i = document.getElementById('offset-distance-input'); return i ? i.value : null; })()`);
    const lines = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'line').map((s) => ({ id: s.id, a: ${STATE}.joints.get(s.joints[0]), b: ${STATE}.joints.get(s.joints[1]) })))`).then(JSON.parse);
    const preview = () => evalJs(`JSON.stringify([...document.querySelectorAll('#offset-tool-overlay line.offset-preview')].map((e) => ({ a: { x: +e.getAttribute('x1'), y: +e.getAttribute('y1') }, b: { x: +e.getAttribute('x2'), y: +e.getAttribute('y2') } })))`).then(JSON.parse);
    const offsets = () => evalJs(`JSON.stringify(${STATE}.constraints.filter((c) => c.type === 'offset').map((c) => ({ shapes: c.shapes, value: c.value })))`).then(JSON.parse);
    // the arrow in screen px: centre, unit direction (tail -> tip), state
    const arrow = () => evalJs(`(() => { const h = document.querySelector('#offset-tool-overlay .offset-handle'); if (!h) return null; const svg = document.querySelector('#design-canvas'); const m = svg.getScreenCTM();
      const P = h.getAttribute('points').trim().split(/\\s+/).map((s) => s.split(',').map(Number)).map(([x, y]) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(m); return [r.x, r.y]; });
      const tip = P[3], tail = [(P[0][0] + P[6][0]) / 2, (P[0][1] + P[6][1]) / 2], cx = (tip[0] + tail[0]) / 2, cy = (tip[1] + tail[1]) / 2, L = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
      const r = h.getBoundingClientRect(); return { x: cx, y: cy, ux: (tip[0] - tail[0]) / L, uy: (tip[1] - tail[1]) / L, len: L, state: h.getAttribute('data-state'), rect: { l: r.left, t: r.top, r: r.right, b: r.bottom } }; })()`);
    const doneRect = () => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Apply the offset/.test(x.getAttribute('aria-label') || x.title || '') && x.getClientRects().length > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
    const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    // each preview line's distance to the source line most parallel to it
    const previewDistance = async () => {
      const pv = await preview(), src = await lines();
      return pv.map((p) => {
        const par = src.map((s) => { const sx = s.b.x - s.a.x, sy = s.b.y - s.a.y, px = p.b.x - p.a.x, py = p.b.y - p.a.y; return { s, c: Math.abs(sx * py - sy * px) / (Math.hypot(sx, sy) * Math.hypot(px, py)) }; }).sort((u, v) => u.c - v.c)[0].s;
        const ux = par.b.x - par.a.x, uy = par.b.y - par.a.y, l = Math.hypot(ux, uy);
        return Math.abs((p.a.x - par.a.x) * uy - (p.a.y - par.a.y) * ux) / l;
      });
    };

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
      const arm = Math.min(cr.w * 0.32, 220);
      const K = { x: cr.l + cr.w * 0.5 - arm * 0.5, y: cr.t + cr.h * 0.62 };
      const A = { x: K.x, y: K.y - arm }, B = { x: K.x + arm, y: K.y };
      await tool('tool-line'); await P.tap(A); await P.tap(K); await P.tap(B); await key('Escape', 'Escape', 27);
      assert.strictEqual((await lines()).length, 2, `[${kind}] two lines are drawn`);
      const h0 = await hist();
      const onA = { x: K.x, y: K.y - arm * 0.5 }, inside = { x: K.x + arm * 0.3, y: K.y - arm * 0.5 };
      const clip = { x: Math.max(0, K.x - 90), y: Math.max(0, A.y - 60), width: Math.min(arm + 220, cr.w), height: arm + 130 };
      const openOffset = async () => {
        await P.tap(onA); await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind}] the distance box`);
        await P.hover(inside);
        await waitFor(`!!document.querySelector('#offset-tool-overlay .offset-handle')`, `[${kind}] the drag arrow`);
      };
      await tool('tool-offset');

      // ---- 1. drag the arrow outwards: box and preview follow, release keeps the box, Enter applies it
      await openOffset();
      const a0 = await arrow();
      assert(a0.len >= 25 && a0.state === 'idle', `[${kind}] one idle arrow ${JSON.stringify(a0)}`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('#offset-tool-overlay .offset-handle').length`), 1, `[${kind}] exactly one arrow`);
      const done0 = await doneRect();
      assert(done0 && !overlap(done0, a0.rect), `[${kind}] the done check does not overlap the arrow ${JSON.stringify([done0, a0.rect])}`);
      // 20 px off the arrow's centre (inside the 44 px target) still grabs it
      const grab = { x: a0.x + a0.uy * 20, y: a0.y - a0.ux * 20 };
      await P.down(grab);
      assert.strictEqual((await arrow()).state, 'drag', `[${kind}] the arrow draws as dragged`);
      const to = (t) => ({ x: grab.x + a0.ux * t, y: grab.y + a0.uy * t });
      for (let t = 5; t <= 60; t += 5) await P.move(to(t));
      const dragged = parseFloat(await box());
      assert(dragged > 5.5, `[${kind}] the box grew with the drag (${dragged})`);
      const pd = await previewDistance();
      assert(pd.length === 2 && pd.every((d) => Math.abs(d - dragged) < 0.02), `[${kind}] the preview offset distance equals the box ${dragged}: ${pd}`);
      await shot(`${kind}-1-mid-drag.png`, clip);
      await P.up(to(60));
      assert.strictEqual(parseFloat(await box()), dragged, `[${kind}] the box stays open on release with the dragged value`);
      assert.strictEqual((await arrow()).state, kind === 'mouse' ? 'hover' : 'idle', `[${kind}] after the release the arrow is not dragged (hover under the mouse, idle for a finger)`);
      assert.strictEqual(await hist(), h0, `[${kind}] dragging makes no undo step`);
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await box(), null, `[${kind}] Enter closes the box`);
      const off = await offsets();
      assert(off.length === 1 && Math.abs(off[0].value - dragged) < 1e-9, `[${kind}] Enter applied the dragged distance: ${JSON.stringify(off)}`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] one undo step`);
      out(`dragged to ${dragged}, applied ${off[0].value}`);
      const undoBtn = await evalJs(`(() => { const r = document.getElementById('btn-undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await P.tap(undoBtn); await sleep(250);
      assert.strictEqual((await lines()).length, 2, `[${kind}] Undo removed the offset`);

      // ---- 2. Esc after a drag: no change, no undo step (task 667: Enter above ended Offset, so reopen it)
      const h1 = await hist(), n1 = (await lines()).length;
      await tool('tool-offset');
      await openOffset();
      const a1 = await arrow();
      await P.down(a1); for (let t = 5; t <= 40; t += 5) await P.move({ x: a1.x + a1.ux * t, y: a1.y + a1.uy * t }); await P.up(a1);
      assert(parseFloat(await box()) > 5.5, `[${kind}] dragged again`);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await box(), null, `[${kind}] Esc closes the box`);
      assert.strictEqual(await evalJs(`!!document.querySelector('#offset-tool-overlay .offset-handle')`), false, `[${kind}] Esc removes the arrow`);
      assert.strictEqual((await lines()).length, n1, `[${kind}] Esc makes nothing`);
      assert.strictEqual(await hist(), h1, `[${kind}] Esc leaves no undo step`);
      await tool('tool-offset'); // R2-07 (owner ruling BUG-105): ONE Esc left the tool, so the next pick starts from its button

      // ---- 3. dragging across the source flips the side
      await openOffset();
      const side0 = await preview(), a2 = await arrow();
      await P.down(a2); for (let t = -5; t >= -(5 + 2 * 40); t -= 5) await P.move({ x: a2.x + a2.ux * t, y: a2.y + a2.uy * t }); // over the source and beyond
      const flipped = await preview();
      await shot(`${kind}-2-flipped-mid-drag.png`, clip);
      await P.up(a2);
      const mid = (p) => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });
      assert(Math.hypot(mid(flipped[0]).x - mid(side0[0]).x, mid(flipped[0]).y - mid(side0[0]).y) > 1, `[${kind}] the preview crossed to the other side`);
      assert(parseFloat(await box()) > 0, `[${kind}] the box holds a positive distance (${await box()})`);
      assert.strictEqual(await hist(), h1, `[${kind}] still no undo step`);

      // ---- 4. a tool switch removes the arrow
      await tool('tool-select');
      assert.strictEqual(await evalJs(`!!document.querySelector('#offset-tool-overlay .offset-handle') || !!document.getElementById('offset-distance-input')`), false, `[${kind}] a tool switch removes the arrow and the box`);
      // leave the sketch empty (the next run reloads the same stored design)
      for (let i = 0; i < 8 && await evalJs(`!document.getElementById('btn-undo').disabled`); i++) { await P.tap(undoBtn); await sleep(150); }
      assert.strictEqual(await evalJs(`${STATE}.shapes.length`), 0, `[${kind}] sketch emptied`);
      out('all checks passed');
    };
    await run('mouse');
    await run('touch');
    console.log('offset-arrow-652.test.js: ok');
  } finally { await cdp.close(); }
})();
