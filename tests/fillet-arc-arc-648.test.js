// tests/fillet-arc-arc-648.test.js -- TASK 648 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Two ARCS meet at a corner. Fillet, tap the corner: the radius box opens and the drag ARROW (shared drag-arrow-handle.js) sits on the preview arc's midpoint.
//  - dragging the arrow outwards grows the radius (box and preview agree); Enter applies a fillet TANGENT to both arcs (centre distance R +/- r), both arcs trimmed;
//  - one Undo removes it, Redo brings it back; the green check applies like Enter;
//  - the arrow is a chunky outlined polygon (not a circle), about 30 px long, pointing away from the corner, darker while dragged.
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots: .evidence/648.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '648');
const STATE = 'window.__sketch.controller.state';

for (const kind of ['mouse', 'touch']) await (async () => { // one fresh browser (empty profile) per pointer kind
  const cdp = await launchBrowser({ tag: '648', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(250); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const typeIn = async (text) => { await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`); for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(150); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
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
    const geo = () => evalJs(`JSON.stringify((() => { const st = ${STATE}; const P = (id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
      return st.shapes.filter((s) => s.type === 'arc').map((s) => ({ id: s.id, c: P(s.joints[0]), s: P(s.joints[1]), e: P(s.joints[2]) })); })())`).then(JSON.parse);
    const rad = (a) => Math.hypot(a.s.x - a.c.x, a.s.y - a.c.y);
    const hist = () => evalJs(`${STATE}.history.length`);
    const box = () => evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); return i ? i.value : null; })()`);
    const boxOpen = () => evalJs(`!!document.getElementById('fillet-radius-input')`);
    const arrow = () => evalJs(`(() => { const h = document.querySelector('#fillet-tool-overlay .fillet-handle'); if (!h) return null; const r = h.getBoundingClientRect(); return { tag: h.tagName, state: h.getAttribute('data-state'), fill: getComputedStyle(h).fill, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, pts: h.getAttribute('points') }; })()`);
    const previewR = () => evalJs(`(() => { const p = document.querySelector('#fillet-tool-overlay path[d*=" A "]'); const m = p && / A ([0-9.eE+-]+) /.exec(p.getAttribute('d')); return m ? parseFloat(m[1]) : null; })()`);
    const num = (v) => parseFloat(v);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');

    const run = async (kind) => {
      const P = pointers[kind];
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
      const C = { x: cr.l + cr.w * 0.5, y: cr.t + cr.h * 0.4 };
      const R = Math.min(cr.w * 0.3, 110);
      assert.strictEqual((await geo()).length, 0, `[${kind}] the canvas starts without arcs`);
      const tool = async (id) => { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); };
      const undo = async () => { await P.tap(await centerOf('#btn-undo')); await sleep(200); };
      // arc A: centre left of the corner, runs from the corner up; arc B: centre below-right, runs from the corner up-left. Three taps each: centre, start, end.
      const at = (cx, cy, deg) => ({ x: cx + R * Math.cos(deg * Math.PI / 180), y: cy + R * Math.sin(deg * Math.PI / 180) });
      const cA = { x: C.x - R, y: C.y }, cB = { x: C.x + R * 0.6, y: C.y + R * 0.8 };
      const angB = Math.atan2(C.y - cB.y, C.x - cB.x) * 180 / Math.PI;
      await tool('tool-arc');
      await P.tap(cA); await P.tap(C); await P.tap(at(cA.x, cA.y, -50));
      await P.tap(cB); await P.tap(C); await P.tap(at(cB.x, cB.y, angB + 50));
      await key('Escape', 'Escape', 27);
      assert.strictEqual((await geo()).length, 2, `[${kind}] two arcs are drawn: ${JSON.stringify(await geo())}`);
      const before = await geo();
      const baseHist = await hist();
      const clip = { x: Math.max(0, C.x - 150), y: Math.max(0, C.y - 130), width: Math.min(300, cr.w), height: 300 };
      await shot(`${kind}-0-two-arcs.png`, clip);

      await tool('tool-fillet'); await P.tap(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the radius input (two arcs are a corner)`);
      await typeIn('6');
      await waitFor(`!!document.querySelector('#fillet-tool-overlay .fillet-handle')`, `[${kind}] the arrow`);
      await sleep(150);
      const h0 = await arrow();
      assert.strictEqual(h0.tag, 'polygon', `[${kind}] the handle is an arrow polygon, not a circle`);
      assert.strictEqual(h0.state, 'idle', `[${kind}] idle at rest`);
      const v0 = num(await box());
      await shot(`${kind}-1-arrow.png`, clip);
      // the arrow's own direction on screen: tail middle -> tip (polygon points are in user units; scale by the CTM)
      const pts = h0.pts.split(' ').map((s) => s.split(',').map(Number));
      const tip = pts[3], tail = [(pts[0][0] + pts[6][0]) / 2, (pts[0][1] + pts[6][1]) / 2]; // the tip and the middle of the tail edge
      const sc = await evalJs(`(() => { const m = document.querySelector('#design-canvas').getScreenCTM(); return { a: m.a, d: m.d }; })()`);
      let dir = { x: (tip[0] - tail[0]) * sc.a, y: (tip[1] - tail[1]) * sc.d }; const m = Math.hypot(dir.x, dir.y);
      assert(m >= 28 && m <= 32, `[${kind}] the arrow is about 30 px long on screen: ${m}`);
      dir = { x: dir.x / m, y: dir.y / m };
      await P.down(h0);
      const hd = await arrow();
      assert.strictEqual(hd.state, 'drag', `[${kind}] the arrow is darker (drag state) while dragged`);
      assert.notStrictEqual(hd.fill, h0.fill, `[${kind}] the drag fill differs from the idle fill`);
      const D = kind === 'touch' ? 14 : 20;
      for (let i = 1; i <= 10; i++) await P.move({ x: h0.x + dir.x * D * i / 10, y: h0.y + dir.y * D * i / 10 });
      const v1 = num(await box());
      assert(v1 > v0 * 1.5, `[${kind}] dragging along the arrow's direction (away from the corner) grows the radius: ${v0} -> ${v1}`);
      assert(Math.abs(num(await previewR()) - v1) < 0.011, `[${kind}] the preview radius (${await previewR()}) equals the box (${v1}) during the drag`);
      await shot(`${kind}-2-dragging.png`, clip);
      await P.up(await arrow());
      assert.strictEqual(num(await box()), v1, `[${kind}] releasing keeps the value`);
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await boxOpen(), false, `[${kind}] Enter closes the box`);

      const after = await geo();
      assert.strictEqual(after.length, 3, `[${kind}] one fillet arc is added`);
      const fil = after.reduce((a, b) => (rad(a) < rad(b) ? a : b));
      assert(Math.abs(rad(fil) - v1) < 1e-3, `[${kind}] fillet radius = the box (${rad(fil)} vs ${v1})`);
      for (const b of before) {
        const a = after.find((x) => x.id === b.id);
        assert(Math.abs(a.c.x - b.c.x) + Math.abs(a.c.y - b.c.y) < 1e-6 && Math.abs(rad(a) - rad(b)) < 1e-6, `[${kind}] arc ${b.id} keeps its centre and radius`);
        assert(Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y) + Math.hypot(a.e.x - b.e.x, a.e.y - b.e.y) > 1, `[${kind}] arc ${b.id} is trimmed`);
        const d = Math.hypot(fil.c.x - a.c.x, fil.c.y - a.c.y);
        assert(Math.abs(d - (rad(a) + v1)) < 1e-3 || Math.abs(d - (rad(a) - v1)) < 1e-3, `[${kind}] fillet is tangent to ${b.id}: centre distance ${d} vs R ${rad(a)} +/- ${v1}`);
      }
      assert.strictEqual(await hist(), baseHist + 1, `[${kind}] one undo step`);
      await shot(`${kind}-3-filleted.png`, clip);
      await undo();
      assert.strictEqual((await geo()).length, 2, `[${kind}] one Undo removes the fillet`);
      await key('y', 'KeyY', 89, 2);
      assert.strictEqual((await geo()).length, 3, `[${kind}] Redo brings it back`);
      await undo();

      // the check button applies like Enter
      await tool('tool-fillet'); await P.tap(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the radius input again`);
      await typeIn('4');
      const done = await evalJs(`(() => { const b = document.querySelector('.sk-done'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })()`);
      assert(done, `[${kind}] the check shows`);
      await P.tap(done);
      const g2 = await geo(); assert.strictEqual(g2.length, 3, `[${kind}] the check applied the fillet`);
      assert(Math.abs(rad(g2.reduce((a, b) => (rad(a) < rad(b) ? a : b))) - 4) < 1e-3, `[${kind}] check applied R=4`);
      await undo();
      console.log(`[${kind}] ok: drag ${v0} -> ${v1}, tangent fillet, undo / redo, check`);
    };
    await run(kind);
    if (kind === 'touch') console.log('fillet-arc-arc-648.test.js: ok');
  } finally { await cdp.close(); }
})();
