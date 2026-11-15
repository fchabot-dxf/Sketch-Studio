// tests/fillet-fusion-match-655-live.test.js -- TASK 655 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Three lines meet at one point (a T-junction), as drawn with the Line tool:
//  - Fillet, a TAP on the joint: ONE message "Pick the two curves to fillet", nothing is picked (no highlight, no radius box);
//  - pick line 1, then line 2 (two of the three): the radius box opens, Enter fillets those two; the third line keeps its end at the sharp point
//    (detached from the fillet: it shares no joint with it) and its far end does not move; one Undo step;
//  - a corner of exactly TWO lines still opens the box with one tap on the corner (unchanged);
//  - a 179.5 degree corner at R 1 is filleted (the box opens, Enter applies, the arc is tangent to both lines).
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots: .evidence/655.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '655');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '655', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const typeIn = async (text) => { await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`); for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(150); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: { tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); } },
      touch: { tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); } },
    };
    const toasts = () => evalJs(`JSON.stringify([...document.querySelectorAll('#notification-container > div')].map((e) => e.textContent.trim().replace(/^[^A-Za-z]+/, '')))`).then(JSON.parse);
    const clearToasts = () => evalJs(`document.querySelectorAll('#notification-container > div').forEach((e) => e.remove())`);
    const boxOpen = () => evalJs(`!!document.getElementById('fillet-radius-input')`);
    const overlay = () => evalJs(`!!document.getElementById('fillet-tool-overlay') && document.getElementById('fillet-tool-overlay').children.length > 0`);
    const hist = () => evalJs(`${STATE}.history.length`);
    const world = (expr) => evalJs(`JSON.stringify(${expr})`).then(JSON.parse);
    const jointOf = (shapeIdx, end) => `(() => { const st = ${STATE}; const s = st.shapes.filter((x) => x.type === 'line')[${shapeIdx}]; const j = st.joints.get(s.joints[${end}]); return { x: j.x, y: j.y, id: s.joints[${end}] }; })()`;

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
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.38) }; // the T point, on screen
      const arm = Math.round(Math.min(cr.w * 0.3, 150));
      const A = { x: C.x - arm, y: C.y }, B = { x: C.x, y: C.y - arm }, D = { x: C.x + Math.round(arm * 0.7), y: C.y + Math.round(arm * 0.7) };
      const mid = (p) => ({ x: Math.round((p.x + C.x) / 2), y: Math.round((p.y + C.y) / 2) });
      const tool = async (id) => { if (await evalJs(`${STATE}.currentTool`) !== id.replace('tool-', '')) { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); } }; // a second click on the active tool would switch it off
      const undo = async () => { await evalJs(`document.querySelector('#btn-undo').click()`); await sleep(250); };
      const clip = { x: Math.max(0, C.x - 190), y: Math.max(0, C.y - 170), width: Math.min(380, cr.w), height: 380 };

      // three lines meeting at C: A-C, C-B, then C-D (the third starts on the joint)
      await tool('tool-line'); await P.tap(A); await P.tap(C); await P.tap(B); await key('Escape', 'Escape', 27);
      await tool('tool-line'); await P.tap(D); await P.tap(C); await key('Escape', 'Escape', 27);
      const n = await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`);
      assert.strictEqual(n, 3, `[${kind}] three lines drawn`);
      const cluster = await world(`(() => { const st = ${STATE}; return st.shapes.filter((s) => s.type === 'line').map((s) => s.joints.map((j) => [st.joints.get(j).x, st.joints.get(j).y])); })()`);
      out('lines ' + JSON.stringify(cluster.map((l) => l.map((p) => p.map((v) => +v.toFixed(1))))));
      const thirdFarBefore = await world(jointOf(2, 0)); // the third line is drawn D -> C: its far end is joint 0, its end at the T is joint 1
      const baseHist = await hist();

      // ---- F11: a tap on the T joint says ONE thing and starts nothing
      await tool('tool-fillet'); await clearToasts();
      await P.tap(C);
      const t1 = await toasts();
      assert.deepStrictEqual(t1, ['Pick the two curves to fillet'], `[${kind}] one message at the T tap: ${JSON.stringify(t1)}`);
      assert.strictEqual(await boxOpen(), false, `[${kind}] the T tap opens no radius box`);
      assert.strictEqual(await overlay(), false, `[${kind}] the T tap picks nothing (no highlight)`);
      await P.tap(mid(A)); // the next tap then starts a normal pick of line 1
      assert.strictEqual(await overlay(), true, `[${kind}] after the message a tap on a line picks it`);
      await key('Escape', 'Escape', 27);

      // ---- F12: pick two of the three
      await tool('tool-fillet'); await P.tap(mid(A)); await P.tap(mid(B));
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the radius box after two picks`);
      await typeIn('30');
      await sleep(200);
      await shot(`${kind}-1-T-preview.png`, clip);
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await boxOpen(), false, `[${kind}] Enter closes the box`);
      const arcs = await world(`${STATE}.shapes.filter((s) => s.type === 'arc').length`);
      assert.strictEqual(arcs, 1, `[${kind}] one fillet arc`);
      assert.strictEqual(await hist(), baseHist + 1, `[${kind}] one undo step`);
      const third = await world(`(() => { const st = ${STATE}; const s = st.shapes.filter((x) => x.type === 'line')[2]; const f = st.shapes.find((x) => x.type === 'arc'); const sharp = st.joints.get(f.filletSharp); const j0 = st.joints.get(s.joints[1]), j1 = st.joints.get(s.joints[0]); const others = st.shapes.filter((x) => x !== s && x.type !== 'arc').flatMap((x) => x.joints).concat(f.joints); return { j0: [j0.x, j0.y], j1: [j1.x, j1.y], sharp: [sharp.x, sharp.y], shares: s.joints.some((j) => others.includes(j) || j === f.filletSharp) }; })()`);
      assert.ok(Math.hypot(third.j0[0] - cluster[2][1][0], third.j0[1] - cluster[2][1][1]) < 1e-3, `[${kind}] the third line keeps its end at the T point: ${JSON.stringify(third.j0)} vs ${JSON.stringify(cluster[2][1])}`);
      assert.ok(Math.hypot(third.j1[0] - thirdFarBefore.x, third.j1[1] - thirdFarBefore.y) < 1e-3, `[${kind}] the third line's far end did not move`);
      assert.strictEqual(third.shares, false, `[${kind}] the third line shares no joint with the fillet or the two filleted lines`);
      const lens = await world(`(() => { const st = ${STATE}; return st.shapes.filter((x) => x.type === 'line').slice(0, 2).map((s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.hypot(a.x - b.x, a.y - b.y); }); })()`);
      assert.ok(lens.every((v, i) => v < Math.hypot(cluster[i][0][0] - cluster[i][1][0], cluster[i][0][1] - cluster[i][1][1]) - 1), `[${kind}] the two picked lines were trimmed: ${JSON.stringify(lens)}`);
      await sleep(150);
      await shot(`${kind}-2-T-applied.png`, clip);
      out(`T fillet applied; third line end ${JSON.stringify(third.j0.map((v) => +v.toFixed(2)))}`);
      await undo();
      assert.strictEqual(await world(`${STATE}.shapes.filter((s) => s.type === 'arc').length`), 0, `[${kind}] one Undo removes the fillet`);

      // ---- the corner of exactly two lines: a tap on the corner still opens the box (unchanged)
      await evalJs(`(() => { const st = ${STATE}; const s = st.shapes.filter((x) => x.type === 'line')[2]; st.shapes.splice(st.shapes.indexOf(s), 1); st.triggerDraw && st.triggerDraw(); })()`);
      await sleep(250);
      await tool('tool-fillet'); await P.tap(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] a tap on a plain two-curve corner opens the box`);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await boxOpen(), false, `[${kind}] Esc closes it`);

      // ---- F19: a 179.5 degree corner at R 1 (line b leaves the corner 179.5 degrees round from line a)
      const g = await world(`(() => { const st = ${STATE}; st.constraints.length = 0; const ls = st.shapes.filter((x) => x.type === 'line'); const c = st.joints.get(ls[0].joints[1]); const a = st.joints.get(ls[0].joints[0]); const bj = st.joints.get(ls[1].joints[1]); const L = 60; const ang = Math.atan2(a.y - c.y, a.x - c.x) + (179.5 * Math.PI / 180); bj.x = c.x + L * Math.cos(ang); bj.y = c.y + L * Math.sin(ang); const aa = Math.hypot(a.x - c.x, a.y - c.y); a.x = c.x + (a.x - c.x) * L / aa; a.y = c.y + (a.y - c.y) * L / aa; st.triggerDraw && st.triggerDraw(); return { c: [c.x, c.y] }; })()`);
      // zoom on the corner (real wheel events at the corner) so the arc (its tangent length is 0.004 mm) is legible
      const screenOf = () => evalJs(`(() => { const svg = document.querySelector('#design-canvas').closest('svg') || document.querySelector('#design-canvas svg') || document.querySelector('#design-canvas'); const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; const k = Math.min(r.width / vb.width, r.height / vb.height); return { x: r.left + r.width / 2 + (${g.c[0]} - vb.x - vb.width / 2) * k, y: r.top + r.height / 2 + (${g.c[1]} - vb.y - vb.height / 2) * k, w: vb.width }; })()`);
      let lastW = Infinity;
      for (let i = 0; i < 200; i++) { const q = await screenOf(); if (q.w < 0.05 || q.w >= lastW) break; lastW = q.w; await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: q.x, y: q.y, deltaX: 0, deltaY: -300 }); await sleep(60); }
      await sleep(300);
      const cs = await screenOf();
      await tool('tool-fillet'); await clearToasts();
      await P.tap(cs);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the 179.5 degree corner opens the box`);
      await typeIn('1');
      await sleep(250);
      assert.deepStrictEqual(await toasts(), [], `[${kind}] no refusal toast at 179.5 degrees`);
      await shot(`${kind}-3-179.5-preview.png`, { x: Math.max(0, cs.x - 190), y: Math.max(0, cs.y - 150), width: Math.min(380, cr.w), height: 300 });
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await boxOpen(), false, `[${kind}] Enter closes the box`);
      const tang = await world(`(() => { const st = ${STATE}; const f = st.shapes.find((x) => x.type === 'arc'); if (!f) return null; const O = st.joints.get(f.joints[0]); const R = Math.hypot(st.joints.get(f.joints[1]).x - O.x, st.joints.get(f.joints[1]).y - O.y); const res = []; for (const j of [f.joints[1], f.joints[2]]) { const t = st.joints.get(j); const ln = st.shapes.filter((x) => x.type === 'line').find((x) => x.joints.includes(j)); const other = st.joints.get(ln.joints.find((q) => q !== j)); const lx = other.x - t.x, ly = other.y - t.y, ll = Math.hypot(lx, ly); res.push(Math.abs((lx * (t.x - O.x) + ly * (t.y - O.y)) / ll)); } return { R, dots: res }; })()`);
      assert.ok(tang, `[${kind}] a fillet arc exists at 179.5 degrees`);
      assert.ok(Math.abs(tang.R - 1) < 1e-4, `[${kind}] radius 1: ${tang.R}`);
      assert.ok(tang.dots.every((d) => d < 1e-4), `[${kind}] tangent to both lines (|radius . line| ${JSON.stringify(tang.dots)})`);
      await sleep(150);
      await shot(`${kind}-4-179.5-applied.png`, { x: Math.max(0, cs.x - 190), y: Math.max(0, cs.y - 150), width: Math.min(380, cr.w), height: 300 });
      out(`179.5 deg fillet R ${tang.R.toFixed(6)}, tangency ${JSON.stringify(tang.dots)}`);
      await tool('tool-select');
      for (let i = 0; i < 6 && await evalJs(`!document.getElementById('btn-undo').disabled`); i++) await undo();
      await evalJs(`(() => { const st = ${STATE}; st.shapes.length = 0; st.constraints.length = 0; st.triggerDraw && st.triggerDraw(); })()`);
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('fillet-fusion-match-655-live.test.js: ok');
  } finally { await cdp.close(); }
})();
