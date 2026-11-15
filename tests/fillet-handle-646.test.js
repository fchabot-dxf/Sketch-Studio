// tests/fillet-handle-646.test.js -- TASK 646 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Two lines meet at a corner. Fillet, tap the corner: the radius box opens and a round HANDLE sits on the preview arc's midpoint.
//  - dragging the handle outwards makes the box value grow and the preview arc's radius equal it; releasing keeps the input open; Enter applies the box value;
//  - Esc after a drag leaves no change and no undo step; a radius that extends a line draws the dashed --sk-warning extension in the preview;
//  - the green check button (DONE_ACTIONS) applies the fillet like Enter, beside the corner, clear of the box and the handle;
//  - the view moves (wheel, middle drag / two fingers) while the fillet is open: nothing is cancelled, the typed radius stays, the box follows the corner;
//  - tool switch and Undo remove the box, the preview and the handle.
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots: .evidence/646.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '646');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '646', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const typeIn = async (text) => { await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`); for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(150); };

    // a pointer: mouse or finger, the same verbs (tap, down, move, up)
    const mouse = (type, x, y, buttons, button) => send('Input.dispatchMouseEvent', { type, x, y, button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: {
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
        down: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(60); },
        move: async (p) => { await mouse('mouseMoved', p.x, p.y, 1); await sleep(25); },
        up: async (p) => { await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        down: async (p) => { await T('touchStart', [p]); await sleep(60); },
        move: async (p) => { await T('touchMove', [p]); await sleep(25); },
        up: async () => { await T('touchEnd', []); await sleep(300); },
      },
    };

    const arcs = () => evalJs(`JSON.stringify((() => { const st = ${STATE}; const P = (id) => st.joints.get(id); return st.shapes.filter((s) => s.type === 'arc').map((s) => Math.hypot(P(s.joints[1]).x - P(s.joints[0]).x, P(s.joints[1]).y - P(s.joints[0]).y)); })())`).then(JSON.parse);
    const hist = () => evalJs(`${STATE}.history.length`);
    const box = () => evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); return i ? i.value : null; })()`);
    const boxRect = () => evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); if (!i) return null; const r = i.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
    const overlay = () => evalJs(`!!document.getElementById('fillet-tool-overlay') && document.getElementById('fillet-tool-overlay').children.length > 0`);
    const handle = () => evalJs(`(() => { const h = document.querySelector('#fillet-tool-overlay .fillet-handle'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
    const previewR = () => evalJs(`(() => { const p = document.querySelector('#fillet-tool-overlay path[d*=" A "]'); const m = p && / A ([0-9.eE+-]+) /.exec(p.getAttribute('d')); return m ? parseFloat(m[1]) : null; })()`);
    const extension = () => evalJs(`document.querySelectorAll('#fillet-tool-overlay path[style*="sk-warning"]').length`);
    const num = (v) => parseFloat(v);

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
      const C = { x: cr.l + cr.w * 0.5, y: cr.t + cr.h * 0.38 }; // the corner, on screen
      const arm = Math.min(cr.w * 0.3, 150);
      const A = { x: C.x - arm, y: C.y + arm * 0.67 }, B = { x: C.x + arm, y: C.y + arm * 0.67 };
      const tool = async (id) => { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); };
      const undo = async () => { const c = await centerOf('#btn-undo'); await P.tap(c); await sleep(200); };
      await tool('tool-line'); await P.tap(A); await P.tap(C); await P.tap(B); await key('Escape', 'Escape', 27);
      assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 2, `[${kind}] two lines are drawn ${await evalJs(`JSON.stringify([...${STATE}.shapes].map((s) => [s.type, s.joints.map((j) => [${STATE}.joints.get(j).x.toFixed(1), ${STATE}.joints.get(j).y.toFixed(1)])]))`)} ${JSON.stringify({ A, C, B, cr })}`);
      const baseHist = await hist();
      const openAt = async () => {
        await tool('tool-fillet'); await P.tap(C);
        await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the radius input`);
        await typeIn('5'); // the box opens with the last radius used: start every case from 5
        await waitFor(`!!document.querySelector('#fillet-tool-overlay .fillet-handle')`, `[${kind}] the handle`);
        await sleep(150);
      };
      const clip = { x: Math.max(0, C.x - 170), y: Math.max(0, C.y - 90), width: Math.min(340, cr.w), height: 300 };

      // ---- 1. the handle is on the preview arc; a drag grows the radius; the box and the preview agree; releasing keeps the input open; Enter applies the box value
      await openAt();
      let v0 = num(await box()), h0 = await handle();
      assert(h0, `[${kind}] the handle is drawn`);
      assert(Math.abs(num(await previewR()) - v0) < 0.011, `[${kind}] the preview arc radius equals the box at the start`);
      await shot(`${kind}-1-open.png`, clip);
      const dir = { x: 0, y: 1 }; // the corner's bisector on screen: the lines are symmetric about the vertical, the corner points up
      const D = kind === 'touch' ? 45 : 70;
      await P.down(h0);
      for (let i = 1; i <= 10; i++) await P.move({ x: h0.x + dir.x * D * i / 10, y: h0.y + dir.y * D * i / 10 });
      const v1 = num(await box()), h1 = await handle();
      assert(v1 > v0 * 2, `[${kind}] dragging outwards grows the radius: ${v0} -> ${v1}`);
      assert(Math.abs(num(await previewR()) - v1) < 0.011, `[${kind}] the preview arc radius (${await previewR()}) equals the box (${v1}) during the drag`);
      assert(Math.hypot(h1.x - (h0.x + dir.x * D), h1.y - (h0.y + dir.y * D)) < 8, `[${kind}] the handle follows the pointer: ${JSON.stringify(h1)}`);
      await shot(`${kind}-2-dragging.png`, clip);
      await P.up(h1);
      assert.strictEqual(num(await box()), v1, `[${kind}] releasing keeps the box value`);
      assert(await boxRect(), `[${kind}] releasing keeps the input open`);
      assert(await evalJs(`document.activeElement && document.activeElement.id === 'fillet-radius-input'`), `[${kind}] the box has the focus again after the drag`);
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await boxRect(), null, `[${kind}] Enter closes the box`);
      assert.strictEqual(await overlay(), false, `[${kind}] Enter removes the preview and the handle`);
      let rs = await arcs();
      assert.strictEqual(rs.length, 1, `[${kind}] one fillet arc`);
      assert(Math.abs(rs[0] - v1) < 1e-3, `[${kind}] the applied radius (${rs[0]}) equals the box (${v1})`);
      assert.strictEqual(await hist(), baseHist + 1, `[${kind}] one undo step`);
      out(`drag ${v0} -> ${v1}, applied ${rs[0]}`);
      await undo();
      assert.deepStrictEqual(await arcs(), [], `[${kind}] one Undo removes the fillet`);

      // ---- 2. Esc after a drag: no change, no undo step
      const h2 = await hist();
      await openAt(); const hd = await handle();
      await P.down(hd); for (let i = 1; i <= 6; i++) await P.move({ x: hd.x + dir.x * 8 * i, y: hd.y + dir.y * 8 * i }); await P.up(hd);
      assert(num(await box()) > v0, `[${kind}] the drag moved the radius`);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await boxRect(), null, `[${kind}] Esc closes the box`);
      assert.strictEqual(await overlay(), false, `[${kind}] Esc removes the preview and the handle`);
      assert.deepStrictEqual(await arcs(), [], `[${kind}] Esc after a drag changes nothing`);
      assert.strictEqual(await hist(), h2, `[${kind}] Esc after a drag leaves no undo step`);

      // ---- 3. a radius that extends a line shows the dashed extension; a small one does not
      await openAt();
      assert.strictEqual(await extension(), 0, `[${kind}] a small radius extends nothing`);
      const he = await handle();
      await P.down(he); for (let i = 1; i <= 10; i++) await P.move({ x: he.x + dir.x * 130 * i / 10, y: he.y + dir.y * 130 * i / 10 });
      const vBig = num(await box());
      assert((await extension()) >= 1, `[${kind}] R=${vBig} extends a line: a dashed --sk-warning path is in the preview`);
      const warnColour = await evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--sk-warning').trim()`);
      assert.strictEqual(warnColour, '#f59e0b', `[${kind}] the colour is the --sk-warning token`);
      await shot(`${kind}-3-too-big-radius.png`, { x: Math.max(0, C.x - Math.min(cr.w, 760) / 2), y: Math.max(0, C.y - 100), width: Math.min(760, cr.w), height: 400 });
      await P.up(he);
      await key('Escape', 'Escape', 27);

      // ---- 4. the check button applies like Enter, beside the corner, off the box and the handle
      await openAt(); await typeIn('8');
      const done = await evalJs(`(() => { const b = document.querySelector('.sk-done'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, aria: b.getAttribute('aria-label'), title: b.title }; })()`);
      assert(done, `[${kind}] the check button shows while the radius input is open`);
      assert.strictEqual(done.aria, 'Apply the fillet', `[${kind}] label`); assert.strictEqual(done.title, '', `[${kind}] no tooltip`);
      const bx = await boxRect(), hh = await handle();
      assert(!(done.l < bx.r && done.r > bx.l && done.t < bx.b && done.b > bx.t), `[${kind}] the check does not cover the radius box ${JSON.stringify({ done, bx, C, hh })}`);
      assert(!(hh.x > done.l && hh.x < done.r && hh.y > done.t && hh.y < done.b), `[${kind}] the check does not cover the handle`);
      assert(Math.hypot((done.l + done.r) / 2 - C.x, (done.t + done.b) / 2 - C.y) < 90, `[${kind}] the check sits beside the corner`);
      await shot(`${kind}-4-check-button.png`, clip);
      await P.tap({ x: (done.l + done.r) / 2, y: (done.t + done.b) / 2 });
      assert.strictEqual(await boxRect(), null, `[${kind}] the check closes the box`);
      rs = await arcs();
      assert(rs.length === 1 && Math.abs(rs[0] - 8) < 1e-3, `[${kind}] the check applied R=8 like Enter: ${rs}`);
      assert.strictEqual(await hist(), baseHist + 1, `[${kind}] one undo step`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-done').hidden`), true, `[${kind}] the check button is gone after applying`);
      await undo();

      // ---- 5. the view moves while the fillet is open: nothing is cancelled, the radius is kept, the box follows the corner
      const cornerNow = () => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const st = ${STATE}; const sh = st.shapes.filter((s) => s.type === 'line'); let best = null; for (const x of sh[0].joints) for (const y of sh[1].joints) { const d = Math.hypot(st.joints.get(x).x - st.joints.get(y).x, st.joints.get(x).y - st.joints.get(y).y); if (!best || d < best.d) best = { d, j: st.joints.get(x) }; } const j = best.j; const pt = svg.createSVGPoint(); pt.x = j.x; pt.y = j.y; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
      const empty = { x: cr.l + cr.w * 0.85, y: cr.t + cr.h * 0.12 };
      const viewMoves = {
        wheel: async () => { await mouse('mouseMoved', empty.x, empty.y, 0); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: empty.x, y: empty.y, deltaX: 0, deltaY: -120 }); await sleep(300); },
        middleDrag: async () => { await mouse('mouseMoved', empty.x, empty.y, 0); await mouse('mousePressed', empty.x, empty.y, 4, 'middle'); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', empty.x - 12 * i, empty.y + 10 * i, 4, 'middle'); await sleep(20); } await mouse('mouseReleased', empty.x - 72, empty.y + 60, 0, 'middle'); await sleep(300); },
        pinch: async () => { const a = { x: empty.x - 30, y: empty.y, id: 1 }, b = { x: empty.x + 30, y: empty.y, id: 2 }; await T('touchStart', [a, b]); for (let i = 1; i <= 6; i++) { await T('touchMove', [{ ...a, x: a.x - 3 * i }, { ...b, x: b.x + 3 * i }]); await sleep(20); } await T('touchEnd', []); await sleep(300); },
        twoFingerPan: async () => { const a = { x: empty.x - 30, y: empty.y, id: 1 }, b = { x: empty.x + 30, y: empty.y, id: 2 }; await T('touchStart', [a, b]); for (let i = 1; i <= 6; i++) { await T('touchMove', [{ ...a, x: a.x - 6 * i, y: a.y + 9 * i }, { ...b, x: b.x - 6 * i, y: b.y + 9 * i }]); await sleep(20); } await T('touchEnd', []); await sleep(300); },
      };
      const gestures = kind === 'mouse' ? ['wheel', 'middleDrag'] : ['pinch', 'twoFingerPan'];
      for (const g of gestures) {
        await evalJs(`(() => { const v = ${STATE}.view; window.__v646 = { x: v.x, y: v.y, w: v.w }; })()`);
        await openAt(); await typeIn('12'); const c0 = await cornerNow(), b0 = await boxRect();
        const v0v = await evalJs(`JSON.stringify(${STATE}.view)`);
        await viewMoves[g]();
        const c1 = await cornerNow(), b1 = await boxRect();
        assert.notStrictEqual(await evalJs(`JSON.stringify(${STATE}.view)`), v0v, `[${kind}] ${g} moved the view`);
        assert(b1, `[${kind}] ${g} does not close the radius box`);
        assert.strictEqual(await box(), '12', `[${kind}] ${g} keeps the typed radius`);
        assert(await overlay() && await handle(), `[${kind}] ${g} keeps the preview and the handle`);
        assert(Math.hypot(c1.x - c0.x, c1.y - c0.y) > 8, `[${kind}] the corner moved on screen (${g})`);
        assert(Math.abs(b1.l - (c1.x + 14)) < 3 && Math.abs(b1.t - (c1.y + 14)) < 3, `[${kind}] the box follows the corner after ${g}: box ${JSON.stringify(b1)} corner ${JSON.stringify(c1)} (was ${JSON.stringify(b0)} / ${JSON.stringify(c0)})`);
        const hz = await handle(); const pr = await previewR(); assert(Math.abs(pr - 12) < 0.011, `[${kind}] the preview still shows R 12 after ${g}`);
        assert(hz && Math.abs(hz.x - c1.x) < 400, `[${kind}] the handle is on screen near the corner`);
        const dn = await evalJs(`(() => { const b = document.querySelector('.sk-done'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })()`);
        assert(dn && Math.hypot(dn.x - c1.x, dn.y - c1.y) < 90, `[${kind}] the check button follows the corner after ${g}`);
        await shot(`${kind}-5-after-${g}.png`, { x: Math.max(0, c1.x - 170), y: Math.max(0, c1.y - 90), width: 340, height: 300 });
        await key('Enter', 'Enter', 13);
        rs = await arcs(); assert(rs.length === 1 && Math.abs(rs[0] - 12) < 1e-3, `[${kind}] Enter after ${g} applies R=12: ${rs}`);
        await undo();
        // restore the view for the next gesture (the corner must stay on screen)
        await evalJs(`(() => { const v = ${STATE}.view, o = window.__v646; v.x = o.x; v.y = o.y; v.w = o.w; document.querySelector('#design-canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 0, clientX: 10, clientY: 10, bubbles: true, cancelable: true })); })()`); await sleep(250);
      }
      // line 1 picked (no input yet): the view moves, the pick survives, the next tap on line 2 still opens the box
      await tool('tool-fillet'); await P.tap({ x: (A.x + C.x) / 2, y: (A.y + C.y) / 2 });
      assert(await overlay(), `[${kind}] line 1 is highlighted`);
      await viewMoves[gestures[0]]();
      assert(await overlay(), `[${kind}] the pick survives ${gestures[0]}`);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await overlay(), false, `[${kind}] Esc drops the pick`);
      await evalJs(`(() => { const v = ${STATE}.view, o = window.__v646; v.x = o.x; v.y = o.y; v.w = o.w; document.querySelector('#design-canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 0, clientX: 10, clientY: 10, bubbles: true, cancelable: true })); })()`); await sleep(250);

      // ---- 6. a click on empty canvas still abandons the input; tool switch and Undo remove box, preview and handle
      await openAt(); await P.tap(empty);
      assert.strictEqual(await boxRect(), null, `[${kind}] a click on empty canvas abandons the input`);
      assert.strictEqual(await overlay(), false, `[${kind}] ... and its preview`);
      await openAt(); await tool('tool-select');
      assert.strictEqual(await boxRect(), null, `[${kind}] a tool switch removes the box`);
      assert.strictEqual(await overlay(), false, `[${kind}] a tool switch removes the preview and the handle`);
      await openAt(); await undo();
      assert.strictEqual(await boxRect(), null, `[${kind}] Undo removes the box`);
      assert.strictEqual(await overlay(), false, `[${kind}] Undo removes the preview and the handle`);
      for (let i = 0; i < 4 && await evalJs(`!document.getElementById('btn-undo').disabled`); i++) await undo(); // leave the sketch empty (the next run reloads the same stored design)
      assert.strictEqual(await evalJs(`${STATE}.shapes.length`), 0, `[${kind}] sketch emptied`);
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('fillet-handle-646.test.js: ok');
  } finally { await cdp.close(); }
})();
