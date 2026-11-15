// tests/pattern-658-live.test.js -- TASK 658 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// CIRCULAR: draw a short line right of the origin; Circular Pattern (Modify group): the dialog opens (non-blocking: docked to the bottom on a
// phone); tap the line, the check -> the centre step; tap the origin -> the live preview (3 copies, Fusion's 3 / 360); type Quantity 6 in the
// dialog -> 6 lines, 60 degrees apart; the dialog does not cover the preview; OK -> one undo step, the tool ends. A double click / double tap on
// the pattern's label opens the dialog on it: Quantity 4, Enter -> 4 lines (one more undo step); Undo -> 6 again.
// RECTANGULAR: the source line selected, Rectangular Pattern: live at once (2 x 1, Spacing 10); drag the direction-1 ARROW -> the distance
// follows the pointer; Quantity 2 = 3, Enter -> 3 x 3 = 9 lines on the grid; Cancel on a second start leaves nothing and no undo step.
// Run twice: desktop with the mouse (1600 x 900), phone (390 x 844) with a finger. Screenshots: .evidence/658.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { LANDSCAPE_HOSTS } from './helpers/phone-landscape.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '658');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '658', width: 1600, height: 900 });
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
        double: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); for (let i = 0; i < 2; i++) { await mouse('mousePressed', p.x, p.y, 1); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0); await sleep(60); } await sleep(300); },
        drag: async (a, b) => { await mouse('mouseMoved', a.x, a.y, 0); await sleep(60); await mouse('mousePressed', a.x, a.y, 1); for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10, 1); await sleep(30); } await mouse('mouseReleased', b.x, b.y, 0); await sleep(250); },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        double: async (p) => { for (let i = 0; i < 2; i++) { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(80); } await sleep(300); },
        drag: async (a, b) => { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= 10; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / 10, y: a.y + (b.y - a.y) * i / 10 }]); await sleep(30); } await T('touchEnd', []); await sleep(300); },
      },
    };
    const hist = () => evalJs(`${STATE}.history.length`);
    const lines = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'line').map((s) => ({ id: s.id, a: ${STATE}.joints.get(s.joints[0]), b: ${STATE}.joints.get(s.joints[1]) })))`).then(JSON.parse);
    const pats = () => evalJs(`JSON.stringify(${STATE}.constraints.filter((c) => /Pattern$/.test(c.type)).map((c) => ({ type: c.type, quantity: c.quantity, angle: c.angle, distance: c.distance, n: c.instances.length, idx: ${STATE}.constraints.indexOf(c) })))`).then(JSON.parse);
    const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    const dialog = () => evalJs(`(() => { const d = document.querySelector('.sk-pattern-dialog'); if (!d || d.hidden) return null; const r = d.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, title: d.getAttribute('aria-label') }; })()`);
    const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const field = (name) => `.sk-pattern-dialog [data-field="${name}"]`;
    // type into a dialog field with REAL key events: the press focuses it (select all), then the characters
    const typeField = async (P, name, text) => {
      await P.tap(await centre(field(name)));
      await evalJs(`(() => { const i = document.querySelector(${JSON.stringify(field(name))}); i.focus(); i.select(); })()`);
      for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(300);
    };
    // the screen box of every line's ends (the preview: the copies are real geometry)
    const linesBox = async () => { const ls = await lines(); const pts = []; for (const l of ls) { pts.push(await toScreen(l.a.x, l.a.y), await toScreen(l.b.x, l.b.y)); } return { l: Math.min(...pts.map((p) => p.x)), r: Math.max(...pts.map((p) => p.x)), t: Math.min(...pts.map((p) => p.y)), b: Math.max(...pts.map((p) => p.y)) }; };
    const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    const angleOf = (l, c) => (Math.atan2(-((l.a.y + l.b.y) / 2 - c.y), (l.a.x + l.b.x) / 2 - c.x) * 180 / Math.PI + 360) % 360;

    const open = async (phone) => {
      if (phone) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      const l = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
      await Promise.race([l, sleep(8000)]);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
      await sleep(500);
    };

    const run = async (kind) => {
      const P = pointers[kind];
      const out = (s) => console.log(`[${kind}] ${s}`);
      await open(kind === 'touch');
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      // the ribbon: both tools in Modify, right after Mirror (owner ruling; Fusion: Create)
      const rib = await evalJs(`(() => { const ids = [...document.querySelectorAll('.sk-ribbon-group[data-section="modify"] .sk-ribbon-btn')].map((x) => x.id); const b = document.getElementById('tool-circularPattern'); return { ids, aria: b && b.getAttribute('aria-label'), aria2: (document.getElementById('tool-rectangularPattern') || {}).ariaLabel }; })()`);
      const mi = rib.ids.indexOf('tool-mirror');
      assert(mi >= 0 && rib.ids[mi + 1] === 'tool-circularPattern' && rib.ids[mi + 2] === 'tool-rectangularPattern', `[${kind}] the two tools right after Mirror: ${rib.ids}`);
      assert.strictEqual(rib.aria, 'Circular Pattern', `[${kind}] the Circular tool's accessible name`);
      // the drawing: a line from O (the canvas's upper middle) to its right; the pattern turns it about its own start O (a star of spokes)
      const R1 = Math.min(cr.w, cr.h) * 0.28;
      const O = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + Math.max(R1 + 50, cr.h * 0.4)) };
      await evalJs(`document.querySelector('#tool-line').click()`); await sleep(200);
      await P.tap(O); await P.tap({ x: O.x + R1, y: O.y }); await key('Escape', 'Escape', 27);
      const src = await lines();
      assert.strictEqual(src.length, 1, `[${kind}] one line drawn`);
      const CW = src[0].a; // the centre, world
      const h0 = await hist();
      const clip = { x: Math.max(0, O.x - R1 - 60), y: Math.max(0, O.y - R1 - 60), width: Math.min(2 * R1 + 120, cr.w), height: Math.min(2 * R1 + 120, 844) };
      const mid = { x: O.x + R1 * 0.6, y: O.y };

      // ---- CIRCULAR
      await evalJs(`${STATE}.selectedShapes.clear(); ${STATE}.selectedJoints.clear()`);
      await pressRibbonTool(evalJs, P.tap, 'tool-circularPattern');
      await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] the pattern dialog`);
      const d0 = await dialog();
      assert.strictEqual(d0.title, 'Circular Pattern', `[${kind}] the Circular Pattern dialog`);
      assert(d0.l >= 0 && d0.r <= (kind === 'touch' ? 390 : 1600) + 0.5 && d0.t >= 0 && d0.b <= (kind === 'touch' ? 844 : 900) + 0.5, `[${kind}] the dialog is on screen ${JSON.stringify(d0)}`);
      await P.tap(mid);
      assert.strictEqual(await evalJs(`${STATE}.selectedShapes.size`), 1, `[${kind}] the tap picks the line as the object`);
      // the check (Enter's twin) ends the objects step -> the centre step
      const check = await centre('.sk-done:not([hidden])');
      assert(check, `[${kind}] the green check shows`);
      await P.tap(check);
      assert.strictEqual(await evalJs(`${STATE}.pattern && ${STATE}.pattern.step`), 'centre', `[${kind}] the check moves on to the centre step`);
      await P.tap(O);
      await waitFor(`${STATE}.constraints.some((c) => c.type === 'circularPattern')`, `[${kind}] the live pattern`);
      let ls = await lines();
      assert.strictEqual(ls.length, 3, `[${kind}] the live preview: Fusion's default quantity 3 (${ls.length} lines)`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] the live pattern holds ONE undo step`);
      await typeField(P, 'Quantity', '6');
      ls = await lines();
      assert.strictEqual(ls.length, 6, `[${kind}] Quantity 6 -> 6 lines (${ls.length})`);
      const ang = ls.map((l) => angleOf(l, CW)).sort((a, b) => a - b);
      ang.forEach((a, k) => assert(Math.abs(a - 60 * k) < 1e-6, `[${kind}] line ${k} at ${60 * k} deg (${a})`));
      const box = await linesBox(), dlg = await dialog();
      assert(!overlaps(box, dlg), `[${kind}] the dialog does not cover the preview ${JSON.stringify({ box, dlg })}`);
      const chk = await evalJs(`(() => { const e = document.querySelector('.sk-done:not([hidden])'); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
      assert(chk && Math.hypot((chk.l + chk.r) / 2 - O.x, (chk.t + chk.b) / 2 - O.y) >= 44, `[${kind}] the check does not sit on its anchor (the centre) ${JSON.stringify(chk)}`);
      await shot(`${kind}-1-circular-preview.png`, clip);
      await shot(`${kind}-1b-circular-dialog.png`, { x: Math.max(0, dlg.l - 4), y: Math.max(0, dlg.t - 4), width: Math.min(dlg.r - dlg.l + 8, kind === 'touch' ? 390 : 1600), height: dlg.b - dlg.t + 8 });
      await P.tap(await centre('.sk-pattern-dialog .sk-pat-ok'));
      assert.strictEqual(await dialog(), null, `[${kind}] OK closes the dialog`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] the pattern is ONE undo step`);
      assert.strictEqual(await evalJs(`${STATE}.currentTool`), 'select', `[${kind}] the command ends (Select)`);
      const p1 = (await pats())[0];
      assert(p1 && p1.quantity === 6 && p1.angle === 360 && p1.n === 5, `[${kind}] one circular pattern, 6 x 360 ${JSON.stringify(p1)}`);
      await shot(`${kind}-2-circular-result.png`, clip);
      out('circular: 6 x 360 applied');

      // ---- the quantity edit: double click / double tap the label, Quantity 4, Enter
      const lab = await centre(`.dim-label[data-constraint-idx="${p1.idx}"]`);
      assert(lab, `[${kind}] the pattern's label is drawn`);
      await sleep(600);
      await P.double(lab);
      await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] the dialog on the stored pattern`);
      await typeField(P, 'Quantity', '4');
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await dialog(), null, `[${kind}] Enter applies and closes`);
      ls = await lines();
      assert.strictEqual(ls.length, 4, `[${kind}] the quantity edit regenerates: 4 lines (${ls.length})`);
      ls.map((l) => angleOf(l, CW)).sort((a, b) => a - b).forEach((a, k) => assert(Math.abs(a - 90 * k) < 1e-6, `[${kind}] after the edit line ${k} at ${90 * k} deg (${a})`));
      assert.strictEqual(await hist(), h0 + 2, `[${kind}] the edit is ONE more undo step`);
      await shot(`${kind}-3-circular-edited-to-4.png`, clip);
      const undoBtn = await centre('#btn-undo');
      await P.tap(undoBtn); await sleep(200);
      assert.strictEqual((await lines()).length, 6, `[${kind}] Undo: back to 6`);
      await P.tap(undoBtn); await sleep(200);
      assert.strictEqual((await lines()).length, 1, `[${kind}] Undo again: only the source`);
      out('circular: label edit 6 -> 4, undo / undo');

      // ---- RECTANGULAR: the line selected first (the pre-selection is the objects): live at once, 2 x 1 at Spacing 10
      await evalJs(`${STATE}.selectedShapes.add(${JSON.stringify(src[0].id)})`);
      const h1 = await hist();
      await pressRibbonTool(evalJs, P.tap, 'tool-rectangularPattern');
      await waitFor(`${STATE}.constraints.some((c) => c.type === 'rectangularPattern')`, `[${kind}] the live rectangular pattern`);
      assert.strictEqual((await lines()).length, 2, `[${kind}] 2 x 1: two lines`);
      // the arrow of direction 1: drag it 30 px further along +X -> the spacing grows by 30 px in mm
      const arrow = await centre('#pattern-tool-overlay .pattern-handle-0');
      assert(arrow, `[${kind}] the direction-1 drag arrow`);
      const pxPerMm = (await toScreen(CW.x + 1, CW.y)).x - (await toScreen(CW.x, CW.y)).x;
      const d0mm = (await pats())[0].distance[0];
      await P.drag(arrow, { x: arrow.x + 30, y: arrow.y });
      const d1mm = (await pats())[0].distance[0];
      assert(Math.abs(d1mm - (d0mm + 30 / pxPerMm)) < 0.6, `[${kind}] the arrow drag sets the spacing (${d0mm} -> ${d1mm}, expected ~${d0mm + 30 / pxPerMm})`);
      assert.strictEqual(parseFloat(await evalJs(`document.querySelector(${JSON.stringify(field('Distance 1'))}).value`)), Number(d1mm.toFixed(2)), `[${kind}] the box shows the dragged distance`);
      await typeField(P, 'Quantity 2', '3');
      await typeField(P, 'Distance 2', '8');
      ls = await lines();
      assert.strictEqual(ls.length, 6, `[${kind}] 2 x 3 = 6 lines (${ls.length})`);
      const rbox = await linesBox(), rdlg = await dialog();
      assert(!overlaps(rbox, rdlg), `[${kind}] the rectangular dialog does not cover the preview ${JSON.stringify({ rbox, rdlg })}`);
      await shot(`${kind}-4-rect-preview.png`, { x: Math.max(0, rbox.l - 60), y: Math.max(0, rbox.t - 60), width: Math.min(rbox.r - rbox.l + 120, cr.w), height: Math.min(rbox.b - rbox.t + 120, 844) });
      await shot(`${kind}-4b-rect-dialog.png`, { x: Math.max(0, rdlg.l - 4), y: Math.max(0, rdlg.t - 4), width: Math.min(rdlg.r - rdlg.l + 8, kind === 'touch' ? 390 : 1600), height: rdlg.b - rdlg.t + 8 });
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await dialog(), null, `[${kind}] Enter applies`);
      assert.strictEqual(await hist(), h1 + 1, `[${kind}] the rectangular pattern is ONE undo step`);
      const q = (await pats())[0];
      assert(q.type === 'rectangularPattern' && q.quantity[0] === 2 && q.quantity[1] === 3 && q.distance[1] === 8 && q.n === 5, `[${kind}] 2 x 3 stored ${JSON.stringify(q)}`);
      ls = await lines();
      const ys = [...new Set(ls.map((l) => Number((-l.a.y).toFixed(4))))].sort((a, b) => a - b);
      assert(ys.length === 3 && Math.abs(ys[1] - ys[0] - 8) < 1e-6 && Math.abs(ys[2] - ys[1] - 8) < 1e-6, `[${kind}] the rows are 8 mm apart (${ys})`);
      await shot(`${kind}-5-rect-result.png`, { x: Math.max(0, rbox.l - 60), y: Math.max(0, rbox.t - 60), width: Math.min(rbox.r - rbox.l + 120, cr.w), height: Math.min(rbox.b - rbox.t + 120, 844) });
      out('rectangular: arrow drag, 2 x 3 applied');

      // ---- Cancel leaves nothing: start Circular on the selected source, Cancel -> no pattern change, no undo step
      const n1 = (await lines()).length, h2 = await hist();
      await evalJs(`${STATE}.selectedShapes.add(${JSON.stringify(src[0].id)})`);
      await pressRibbonTool(evalJs, P.tap, 'tool-circularPattern');
      await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] the dialog again`);
      await P.tap(O);
      assert.strictEqual(await hist(), h2 + 1, `[${kind}] the second pattern is live`);
      await P.tap(await centre('.sk-pattern-dialog .sk-pat-cancel'));
      assert.strictEqual(await dialog(), null, `[${kind}] Cancel closes the dialog`);
      assert.strictEqual((await lines()).length, n1, `[${kind}] Cancel removes the live copies`);
      assert.strictEqual(await hist(), h2, `[${kind}] Cancel leaves no undo step`);
      assert.strictEqual(await evalJs(`${STATE}.redoStack.length`), 0, `[${kind}] ... and no redo entry`);
      out('cancel: nothing left');

      for (let i = 0; i < 8 && await evalJs(`!document.getElementById('btn-undo').disabled`); i++) { await P.tap(undoBtn); await sleep(150); }
      assert.strictEqual(await evalJs(`${STATE}.shapes.length`), 0, `[${kind}] sketch emptied`);
      out('all checks passed');
    };

    // the four hosts: the two tools exactly where Mirror is (every host has it today), right after it in Modify
    for (const h of LANDSCAPE_HOSTS) {
      const l = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${h.url}` });
      await Promise.race([l, sleep(8000)]);
      await waitFor(`!!document.getElementById('tool-select')`, `${h.name}: the ribbon`);
      const ids = await evalJs(`[...document.querySelectorAll('.sk-ribbon-btn')].map((b) => b.id)`);
      const m = ids.indexOf('tool-mirror'), c = ids.indexOf('tool-circularPattern'), r = ids.indexOf('tool-rectangularPattern');
      assert((m < 0 && c < 0 && r < 0) || (m >= 0 && c === m + 1 && r === m + 2), `${h.name}: the pattern tools are where Mirror is, right after it (${ids})`);
      console.log(`[hosts] ${h.name}: mirror ${m >= 0}, circular ${c >= 0}, rectangular ${r >= 0}`);
    }

    await run('mouse');
    await run('touch');
    console.log('pattern-658-live.test.js: ok');
  } finally { await cdp.close(); }
})();
