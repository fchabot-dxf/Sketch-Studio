// tests/typed-sizes-782-live.test.js -- TASK 782 (live headless; REAL mouse + keys at 1280x800, REAL touch taps at the phone 390x844; Pen Plotter = the shared Design tab):
//  A  centre-point rectangle: typed W / H hold at the click, and the same two dimensions the 2-point rectangle keeps are kept
//  B  two clicks on one spot: no zero-size rectangle (2-point, centre), circle, arc
//  D  the line's angle box counts counter-clockwise: a typed 45 draws up-right on the screen (mouse only: the cursor's +45 is read from the box)
//  E  centre-point slot: the length box is the full length, a typed length is kept as a dimension
//  F  (mouse) a typed 0 / negative size is refused: red field, hint, nothing drawn; fixed -> placed
// Screenshots (zoomed on the boxes) go to $EVIDENCE_DIR (default .evidence/782).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = process.env.EVIDENCE_DIR || path.join(process.cwd(), '.evidence', '782');

await (async () => {
  const cdp = await launchBrowser({ tag: '782', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const failures = [];
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const key = async (k, code, vk) => { await sendRealKey(send, k, code, vk); await sleep(150); };
    const text = async (t) => { await send('Input.insertText', { text: t }); await sleep(120); };
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.w), height: Math.round(clip.h), scale: 2.5 } });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };

    for (const kind of ['mouse', 'touch']) {
      const phone = kind === 'touch';
      const ok = (cond, msg) => { if (!cond) failures.push(`[${kind}] ${msg}`); };
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
      const move = async (p) => { if (!phone) { await mouse('mouseMoved', p.x, p.y, 0); await sleep(90); } };
      const tap = async (p) => {
        if (phone) { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(280); }
        else { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(220); }
      };
      await resetBufferLive(cdp);
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]') || !!document.querySelector('.sk-ribbon .sk-ribbon-btn')`, `[${kind}] page`);
      await evalJs(`(() => { const t = document.querySelector('.sk-header-tab[data-tab="design"]'); if (t) t.click(); })()`);
      await waitFor(`!!window.__sketch && !!window.__sketch.controller && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, `[${kind}] Design tab`);
      await sleep(500);
      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const cx = Math.round(cr.l + cr.w / 2), cy = Math.round(cr.t + cr.h / 2);
      const at = (dx, dy) => ({ x: cx + dx, y: cy + dy });
      const ST = `window.__sketch.controller.state`;
      const world = () => evalJs(`(() => { const st = ${ST};
        const sides = st.shapes.filter((s) => s.type === 'line' && !s.isConstruction).map((s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return { len: Math.hypot(b.x - a.x, b.y - a.y), dx: b.x - a.x, dy: b.y - a.y }; });
        const cons = st.shapes.filter((s) => s.type === 'line' && s.isConstruction).map((s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); });
        const dist = st.constraints.filter((c) => c.type === 'distance' && !c.isRadius).map((c) => ({ v: c.value, driven: !!(c.isDriven || c.driven) }));
        return { shapes: st.shapes.length, joints: st.joints.size, cons: st.constraints.length, sides, construction: cons, dist, active: !!st.active, toasts: document.getElementById('notification-container') ? document.getElementById('notification-container').children.length : 0 };
      })()`);
      const boxes = () => evalJs(`[...document.querySelectorAll('.sk-live-box')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none').flatMap((e) => e.tagName === 'INPUT' ? [e] : [...e.querySelectorAll('input')]).map((i) => { const r = i.getBoundingClientRect(); return { ph: i.placeholder, v: i.value, invalid: i.getAttribute('aria-invalid') === 'true', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })`);
      // type into box field i (a finger taps the field to focus it; a mouse has it focused already / by Tab)
      const typeInto = async (i, t) => { if (phone) { const b = await boxes(); if (!b[i]) { failures.push(`[${kind}] no box field ${i} to type "${t}" in`); return; } await tap({ x: b[i].x, y: b[i].y }); } await text(t); };
      const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
      const clearDoc = () => evalJs(`(() => { const st = ${ST}; for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0; })()`);   // each section on a clean page: a tap near an earlier shape would snap to it
      const pick = async (tool, setup) => { await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150); await clearDoc(); await evalJs(`(() => { ${setup || ''} })()`); await pressRibbonTool(evalJs, tap, tool); await sleep(150); await evalJs(`(() => { ${setup || ''} })()`); };

      // ---------------- A: centre-point rectangle, typed 4 x 2, by the click
      await pick('tool-rect', `${ST}.rectMode = 'rect-center'`);
      let w0 = await world();
      await tap(at(-120, -120));
      let bx = await boxes(); ok(bx.length === 2 && bx[0].ph === 'W' && bx[1].ph === 'H', `A: the W x H boxes show after the centre click: ${JSON.stringify(bx)}`);
      await move(at(-80, -90));
      await typeInto(0, '4'); if (!phone) await key('Tab', 'Tab', 9); await typeInto(1, '2');
      await tap(at(-70, -85));   // the click is where the cursor is: the typed sides hold, not the cursor's size
      let w1 = await world();
      const sidesA = w1.sides.slice(w0.sides.length).map((s) => +s.len.toFixed(6)).sort((a, b) => a - b);
      ok(JSON.stringify(sidesA) === JSON.stringify([2, 2, 4, 4]), `A: the sides are the typed 4 x 2: ${JSON.stringify(sidesA)}`);
      const dA = w1.dist.slice(w0.dist.length).map((d) => d.v).sort();
      ok(JSON.stringify(dA) === '[2,4]' && w1.dist.slice(w0.dist.length).every((d) => !d.driven), `A: two driving dimensions 4 and 2 (not four): ${JSON.stringify(w1.dist.slice(w0.dist.length))}`);
      ok(w1.toasts === w0.toasts, `A: no notice`);
      // A, centre rectangle with the boxes up: screenshot (mouse), a plain 6 x ? one
      if (!phone) {
        await pick('tool-rect', `${ST}.rectMode = 'rect-center'`);
        await tap(at(160, -120)); await move(at(230, -80)); await typeInto(0, '9');
        const b = await boxes(); const r = b.length ? { x: Math.min(...b.map((q) => q.x)) - 120, y: Math.min(...b.map((q) => q.y)) - 90 } : { x: cx, y: cy };
        await shot('A-centre-rectangle-boxes.png', { x: r.x - 40, y: r.y - 60, w: 380, h: 260 });
        await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150);
      }

      // ---------------- B: two clicks on one spot
      for (const [name, tool, setup, clicks] of [['2-point rectangle', 'tool-rect', `${ST}.rectMode = 'rect-2pt'`, 2], ['centre rectangle', 'tool-rect', `${ST}.rectMode = 'rect-center'`, 2], ['circle', 'tool-circle', '', 2], ['arc', 'tool-arc', '', 3]]) {
        await pick(tool, setup);
        // the middle of a grid square (world 65, 65: 5 units from every grid point, further than the grid magnetism): no snap moves the first click, so the clicks are on exactly one spot
        const p = await evalJs(`(() => { const svg = document.getElementById('design-canvas'); const q = svg.createSVGPoint(); q.x = 65; q.y = 65; const s = q.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
        const before = await world();
        for (let i = 0; i < clicks; i++) await tap(p);
        const after = await world();
        const hasCircle = await evalJs(`${ST}.shapes.filter((s) => s.type === 'circle' || s.type === 'arc').length`);
        ok(after.shapes === before.shapes && after.sides.length === before.sides.length && after.cons === before.cons, `B ${name}: ${clicks} clicks on one spot placed nothing: ${JSON.stringify({ b: before.shapes, a: after.shapes, bc: before.cons, ac: after.cons })} (${hasCircle} round)`);
      }

      // ---------------- D: line angle (typed 45 draws up-right)
      await pick('tool-line');
      w0 = await world();
      await tap(at(-100, 140));
      if (!phone) {
        await move(at(-40, 80));   // 60 right, 60 up on the screen: +45
        bx = await boxes();
        const want = await evalJs(`(() => { const st = ${ST}; const s = st.active.startPt, m = st.tempMousePos; return { ang: -Math.atan2(m.y - s.y, m.x - s.x) * 180 / Math.PI, dx: m.x - s.x, dy: m.y - s.y }; })()`);
        ok(want.dx > 0 && want.dy < 0 && want.ang > 20 && want.ang < 70, `D: the cursor is up-right: ${JSON.stringify(want)}`);
        ok(bx.length === 2 && bx[1].ph === '°' && Math.abs(parseFloat(bx[1].v) - want.ang) < 0.06, `D: the cursor up-right shows a POSITIVE angle (counter-clockwise): ${JSON.stringify(bx)} vs ${want.ang}`);
        await shot('D-line-angle-box.png', { x: Math.min(...bx.map((q) => q.x)) - 160, y: Math.min(...bx.map((q) => q.y)) - 110, w: 380, h: 240 });
      }
      await typeInto(0, '2'); if (!phone) await key('Tab', 'Tab', 9); await typeInto(1, '45'); await key('Enter', 'Enter', 13); await sleep(250);
      w1 = await world();
      const seg = w1.sides[w0.sides.length];
      ok(seg && near(seg.len, 2, 1e-6) && seg.dx > 0 && seg.dy < 0 && near(-seg.dy, seg.dx, 1e-6), `D: a typed 2 / 45 draws up-right on the screen: ${JSON.stringify(seg)}`);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150);

      // ---------------- E: centre-point slot: the box is the full length; a typed length is a dimension
      await pick('tool-slot', `${ST}.slotMode = 'slot-center'`);
      w0 = await world();
      await tap(at(100, 100));
      if (!phone) {
        await move(at(160, 100));
        bx = await boxes();
        const span = await evalJs(`(() => { const st = ${ST}; const c = st.active.picks[0].pt, m = st.tempMousePos; return 2 * Math.hypot(m.x - c.x, m.y - c.y); })()`);
        ok(bx.length === 1 && Math.abs(parseFloat(bx[0].v) - span) < 6e-4, `E: the box is the FULL length (twice the centre-to-cursor): ${JSON.stringify(bx)} vs ${span}`);
        await shot('E-centre-slot-length-box.png', { x: bx[0].x - 140, y: bx[0].y - 100, w: 340, h: 220 });
      }
      await typeInto(0, '6'); await key('Enter', 'Enter', 13); await sleep(250);
      await tap(at(150, 130));
      w1 = await world();
      ok(w1.construction.length > w0.construction.length && near(w1.construction[w1.construction.length - 1], 6, 1e-6), `E: the slot is the typed 6 long: ${JSON.stringify(w1.construction)}`);
      ok(w1.dist.slice(w0.dist.length).some((d) => near(d.v, 6) && !d.driven), `E: the typed 6 is kept as a dimension: ${JSON.stringify(w1.dist.slice(w0.dist.length))}`);

      // ---------------- F (mouse): typed 0 refused
      if (!phone) {
        await pick('tool-rect', `${ST}.rectMode = 'rect-2pt'`);
        w0 = await world();
        await tap(at(-200, 200)); await move(at(-150, 230));
        await text('0'); await key('Tab', 'Tab', 9); await text('2');
        bx = await boxes();
        ok(bx.length === 2 && bx[0].invalid && !bx[1].invalid, `F: the 0 width is marked invalid: ${JSON.stringify(bx)}`);
        const hint = await evalJs(`(() => { const h = document.getElementById('dimHint'); return h && !h.classList.contains('hidden') ? h.textContent : null; })()`);
        ok(/more than 0/.test(hint || ''), `F: the hint says why: ${hint}`);
        await shot('F-refused-zero-width.png', { x: Math.min(...bx.map((q) => q.x)) - 150, y: Math.min(...bx.map((q) => q.y)) - 80, w: 380, h: 220 });
        await key('Enter', 'Enter', 13); await tap(at(-150, 230));
        w1 = await world();
        ok(w1.sides.length === w0.sides.length && (await boxes()).length === 2, `F: Enter and a click with a 0 width place nothing, the boxes stay`);
        await evalJs(`(() => { const i = document.querySelectorAll('.sk-live-box input')[0]; i.focus(); i.select(); })()`);   // the width field, its text selected: the next typing replaces it
        await text('5');
        bx = await boxes(); ok(!bx[0].invalid, `F: a fixed width is valid again: ${JSON.stringify(bx)}`);
        await key('Enter', 'Enter', 13); await sleep(200);
        w1 = await world();
        ok(w1.sides.length === w0.sides.length + 4 && near(Math.max(...w1.sides.slice(w0.sides.length).map((s) => s.len)), 5, 1e-6), `F: the fixed size places the rectangle: ${JSON.stringify(w1.sides.slice(w0.sides.length))}`);
      }
    }
    assert.strictEqual(failures.length, 0, '\n' + failures.join('\n'));
    console.log('typed sizes 782 live: ok');
  } finally { try { await cdp.close(); } catch (_) { /* closed */ } }
})();
