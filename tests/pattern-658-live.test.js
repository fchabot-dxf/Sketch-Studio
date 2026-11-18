// tests/pattern-658-live.test.js -- TASK 658 + 662 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// CIRCULAR: draw a short line right of the origin; Circular Pattern (Modify group): Fusion rows (Objects, Center Point, Distribution Full/Angle/Symmetric,
// Suppression, Quantity, Angle); tap line + check + origin -> live (3 / Full = 360); spinner steps Quantity by 1; type Quantity 6 -> 6 lines 60 deg apart;
// OK -> one undo step, Select. Double click/tap label -> dialog opens, Quantity 4, Enter -> 4 lines; Undo / Undo.
// RECTANGULAR: line pre-selected -> live at once (2 x 1, Distribution defaults to Extent); drag direction-1 arrow -> inline Distance + Quantity boxes
// appear beside the arrow and stay after release; inline spinner steps Quantity 1 (2 -> 3) and updates dialog; typing inline Distance drives dialog + pattern;
// Direction 1 One Direction -> Symmetric moves copies to Fusion's symmetric positions; dialog spinner steps Quantity 2 (1 -> 2 -> 3); Distance 2 = 8;
// Enter -> 3 x 3 = 9 / 2 x 3 = 6 lines; Cancel leaves nothing and no undo step.
// Run twice: desktop with the mouse (1600 x 900), phone (390 x 844) with a finger. Screenshots: .evidence/662.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { LANDSCAPE_HOSTS } from './helpers/phone-landscape.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '662');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '662', width: 1600, height: 900 });
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
    const pats = () => evalJs(`JSON.stringify(${STATE}.constraints.filter((c) => /Pattern$/.test(c.type)).map((c) => ({ type: c.type, quantity: c.quantity, angle: c.angle, distance: c.distance, distanceType: c.distanceType, symmetric: c.symmetric, n: c.instances.length, at: c.instances.map((i) => i.at), idx: ${STATE}.constraints.indexOf(c) })))`).then(JSON.parse);
    const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    const dialog = () => evalJs(`(() => { const d = document.querySelector('.sk-pattern-dialog'); if (!d || d.hidden) return null; const r = d.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, title: d.getAttribute('aria-label') }; })()`);
    const inlineBox = () => evalJs(`(() => { const b = document.querySelector('.sk-pat-inline'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, dir: b.dataset.dir, dist: b.querySelector('[data-inline-field="distance"]').value, qty: b.querySelector('[data-inline-field="quantity"]').value }; })()`);
    const centre = async (sel) => {
      await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); })()`);
      return evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    };
    const field = (name) => `.sk-pattern-dialog [data-field="${name}"]`;
    const typeSelector = async (P, sel, text) => {
      await P.tap(await centre(sel));
      await evalJs(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.select(); })()`);
      for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(300);
    };
    const typeField = (P, name, text) => typeSelector(P, field(name), text);
    const setSelect = async (name, val) => {
      await evalJs(`(() => { const s = document.querySelector(${JSON.stringify(field(name))}); s.value = ${JSON.stringify(val)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(250);
    };
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
      const vw = kind === 'touch' ? 390 : 1600, vh = kind === 'touch' ? 844 : 900;
      const out = (s) => console.log(`[${kind}] ${s}`);
      await open(kind === 'touch');
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const rib = await evalJs(`(() => { const ids = [...document.querySelectorAll('.sk-ribbon-group[data-section="modify"] .sk-ribbon-btn')].map((x) => x.id); const b = document.getElementById('tool-circularPattern'); return { ids, aria: b && b.getAttribute('aria-label') }; })()`);
      const mi = rib.ids.indexOf('tool-mirror');
      assert(mi >= 0 && rib.ids[mi + 1] === 'tool-circularPattern' && rib.ids[mi + 2] === 'tool-rectangularPattern', `[${kind}] the two tools right after Mirror: ${rib.ids}`);
      assert.strictEqual(rib.aria, 'Circular Pattern', `[${kind}] Circular tool accessible name`);

      const R1 = Math.min(cr.w, cr.h) * 0.25;
      const O = { x: Math.round(cr.l + cr.w * 0.48), y: Math.round(cr.t + Math.max(R1 + 50, cr.h * 0.38)) };
      await evalJs(`document.querySelector('#tool-line').click()`); await sleep(200);
      await P.tap(O); await P.tap({ x: O.x + R1, y: O.y }); await key('Escape', 'Escape', 27);
      const src = await lines();
      assert.strictEqual(src.length, 1, `[${kind}] one line drawn`);
      const CW = src[0].a;
      const h0 = await hist();
      const clip = { x: Math.max(0, O.x - R1 - 60), y: Math.max(0, O.y - R1 - 60), width: Math.min(2 * R1 + 120, cr.w), height: Math.min(2 * R1 + 120, vh) };
      const mid = { x: O.x + R1 * 0.6, y: O.y };

      // ---- CIRCULAR
      await evalJs(`${STATE}.selectedShapes.clear(); ${STATE}.selectedJoints.clear()`);
      await pressRibbonTool(evalJs, P.tap, 'tool-circularPattern');
      await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] the pattern dialog`);
      const circLabels = await evalJs(`[...document.querySelectorAll('.sk-pattern-dialog .sk-pat-row > label')].map((l) => l.textContent)`);
      assert.deepStrictEqual(circLabels, ['Objects', 'Center Point', 'Distribution', 'Suppression', 'Quantity', 'Angle'], `[${kind}] Circular labels match Fusion`);
      assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Distribution'))}).value`), 'full', `[${kind}] Circular Distribution defaults to Full`);
      assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Angle'))}).closest('.sk-pat-row').hidden`), true, `[${kind}] Angle hidden when Distribution is Full`);
      const d0 = await dialog();
      assert.strictEqual(d0.title, 'Circular Pattern', `[${kind}] the Circular Pattern dialog`);
      assert(d0.l >= 0 && d0.r <= vw + 0.5 && d0.t >= 0 && d0.b <= vh + 0.5, `[${kind}] the dialog is on screen ${JSON.stringify(d0)}`);
      await P.tap(mid);
      assert.strictEqual(await evalJs(`${STATE}.selectedShapes.size`), 1, `[${kind}] the tap picks the line as the object`);
      const check = await centre('.sk-done:not([hidden])');
      assert(check, `[${kind}] the green check shows`);
      await P.tap(check);
      assert.strictEqual(await evalJs(`${STATE}.pattern && ${STATE}.pattern.step`), 'centre', `[${kind}] the check moves on to the centre step`);
      await P.tap(O);
      await waitFor(`${STATE}.constraints.some((c) => c.type === 'circularPattern')`, `[${kind}] the live pattern`);
      let ls = await lines();
      assert.strictEqual(ls.length, 3, `[${kind}] the live preview: Fusion's default quantity 3 (${ls.length} lines)`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] the live pattern holds ONE undo step`);
      // Spinner steps Quantity by 1 (3 -> 4 -> 3)
      await P.tap(await centre('.sk-pattern-dialog [data-spin-for="Quantity"][data-spin="up"]'));
      assert.strictEqual((await pats())[0].quantity, 4, `[${kind}] circular spinner up steps 3 -> 4`);
      await P.tap(await centre('.sk-pattern-dialog [data-spin-for="Quantity"][data-spin="down"]'));
      assert.strictEqual((await pats())[0].quantity, 3, `[${kind}] circular spinner down steps 4 -> 3`);
      await typeField(P, 'Quantity', '6');
      ls = await lines();
      assert.strictEqual(ls.length, 6, `[${kind}] Quantity 6 -> 6 lines (${ls.length})`);
      const ang = ls.map((l) => angleOf(l, CW)).sort((a, b) => a - b);
      ang.forEach((a, k) => assert(Math.abs(a - 60 * k) < 1e-6, `[${kind}] line ${k} at ${60 * k} deg (${a})`));
      const box = await linesBox(), dlg = await dialog();
      assert(!overlaps(box, dlg), `[${kind}] the dialog does not cover the preview ${JSON.stringify({ box, dlg })}`);
      const chk = await evalJs(`(() => { const e = document.querySelector('.sk-done:not([hidden])'); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
      assert(chk && Math.hypot((chk.l + chk.r) / 2 - O.x, (chk.t + chk.b) / 2 - O.y) >= 44, `[${kind}] the check does not sit on its anchor ${JSON.stringify(chk)}`);
      await shot(`${kind}-1-circular-preview.png`, clip);
      await shot(`${kind}-1b-circular-dialog.png`, { x: Math.max(0, dlg.l - 4), y: Math.max(0, dlg.t - 4), width: Math.min(dlg.r - dlg.l + 8, vw), height: Math.min(dlg.b - dlg.t + 8, vh) });
      await P.tap(await centre('.sk-pattern-dialog .sk-pat-ok'));
      assert.strictEqual(await dialog(), null, `[${kind}] OK closes the dialog`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] the pattern is ONE undo step`);
      assert.strictEqual(await evalJs(`${STATE}.currentTool`), 'select', `[${kind}] the command ends (Select)`);
      const p1 = (await pats())[0];
      assert(p1 && p1.quantity === 6 && p1.angle === 360 && p1.n === 5, `[${kind}] one circular pattern, 6 x 360 ${JSON.stringify(p1)}`);
      out('circular: 6 x 360 applied');

      // ---- label edit: double click / double tap the label, Quantity 4, Enter
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
      const undoBtn = await centre('#btn-undo');
      await P.tap(undoBtn); await sleep(200);
      assert.strictEqual((await lines()).length, 6, `[${kind}] Undo: back to 6`);
      await P.tap(undoBtn); await sleep(200);
      assert.strictEqual((await lines()).length, 1, `[${kind}] Undo again: only the source`);
      out('circular: label edit 6 -> 4, undo / undo');

      // ---- RECTANGULAR: line selected -> live at once, Distribution defaults to Extent
      await evalJs(`${STATE}.selectedShapes.add(${JSON.stringify(src[0].id)})`);
      const h1 = await hist();
      await pressRibbonTool(evalJs, P.tap, 'tool-rectangularPattern');
      await waitFor(`${STATE}.constraints.some((c) => c.type === 'rectangularPattern')`, `[${kind}] the live rectangular pattern`);
      const rectLabels = await evalJs(`[...document.querySelectorAll('.sk-pattern-dialog .sk-pat-row > label')].map((l) => l.textContent)`);
      assert.deepStrictEqual(rectLabels, ['Objects', 'Direction/s', 'Distribution', 'Suppression', 'Quantity', 'Distance', 'Direction', 'Quantity', 'Distance', 'Direction'], `[${kind}] Rectangular labels match Fusion`);
      assert.strictEqual((await pats())[0].distanceType, 'total', `[${kind}] Distribution defaults to Extent (stored 'total')`);
      assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Distribution'))}).value`), 'total', `[${kind}] Distribution select defaults to Extent`);
      assert.strictEqual((await lines()).length, 2, `[${kind}] 2 x 1: two lines`);

      // Drag direction-1 arrow -> inline Distance + Quantity boxes appear beside the arrow and stay after release
      const arrow = await centre('#pattern-tool-overlay .pattern-handle-0');
      assert(arrow, `[${kind}] the direction-1 drag arrow`);
      const pxPerMm = (await toScreen(CW.x + 1, CW.y)).x - (await toScreen(CW.x, CW.y)).x;
      const d0mm = (await pats())[0].distance[0];
      await P.drag(arrow, { x: arrow.x + 30, y: arrow.y });
      const d1mm = (await pats())[0].distance[0];
      assert(Math.abs(d1mm - (d0mm + 30 / pxPerMm)) < 0.6, `[${kind}] the arrow drag sets the distance (${d0mm} -> ${d1mm})`);
      const dlgDist1 = await evalJs(`document.querySelector(${JSON.stringify(field('Distance 1'))}).value`);
      assert.strictEqual(parseFloat(dlgDist1), Number(d1mm.toFixed(3)), `[${kind}] dialog Distance 1 matches dragged distance`);
      assert(dlgDist1.endsWith('mm'), `[${kind}] dialog Distance 1 carries unit (${dlgDist1})`);
      const inl = await inlineBox();
      assert(inl && inl.dir === '0', `[${kind}] inline boxes appear beside arrow 0 and stay after drag release`);
      assert.strictEqual(inl.dist, dlgDist1, `[${kind}] inline distance matches formatted dialog (${inl.dist} vs ${dlgDist1})`);
      assert.strictEqual(inl.qty, '2', `[${kind}] inline quantity matches dialog (2)`);
      assert(inl.l >= 0 && inl.r <= vw + 0.5 && inl.t >= 0 && inl.b <= vh + 0.5, `[${kind}] inline boxes inside viewport ${JSON.stringify(inl)}`);
      // Inline spinner steps Quantity 1 (2 -> 3) and updates dialog + pattern
      await P.tap(await centre('.sk-pat-inline [data-inline-spin="up"]'));
      assert.strictEqual((await pats())[0].quantity[0], 3, `[${kind}] inline spinner steps quantity 2 -> 3`);
      assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Quantity 1'))}).value`), '3', `[${kind}] dialog Quantity 1 updated to 3`);
      assert.strictEqual((await inlineBox()).qty, '3', `[${kind}] inline quantity updated to 3`);
      // Typing in inline distance updates dialog + pattern (ONE value state); blurring inline distance reformats with unit
      await typeSelector(P, '.sk-pat-inline [data-inline-field="distance"]', '12');
      assert(Math.abs((await pats())[0].distance[0] - 12) < 1e-6, `[${kind}] typing in inline distance drives pattern (12)`);
      assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Distance 1'))}).value`), '12mm', `[${kind}] dialog Distance 1 updated to 12mm`);
      await P.tap(await centre('.sk-pat-inline [data-inline-field="quantity"]'));
      assert.strictEqual((await inlineBox()).dist, '12mm', `[${kind}] blurred inline distance shows unit (12mm)`);
      const inlAfter = await inlineBox();
      const arrowAfter = await centre('#pattern-tool-overlay .pattern-handle-0');
      await shot(`${kind}-rect-inline-boxes.png`, {
        x: Math.max(0, Math.min(inlAfter.l, arrowAfter.x) - 40),
        y: Math.max(0, Math.min(inlAfter.t, arrowAfter.y) - 40),
        width: Math.min(vw, Math.max(inlAfter.r, arrowAfter.x) - Math.min(inlAfter.l, arrowAfter.x) + 80),
        height: Math.min(vh, Math.max(inlAfter.b, arrowAfter.y) - Math.min(inlAfter.t, arrowAfter.y) + 80),
      });

      // One Direction -> Symmetric moves copies to Fusion's symmetric positions (-1, 1 around source 0)
      await setSelect('Direction 1', 'symmetric');
      const symAt = (await pats())[0].at.map((a) => a[0]).sort((a, b) => a - b);
      assert.deepStrictEqual(symAt, [-1, 1], `[${kind}] One Direction -> Symmetric moves copies to [-1, 1] around source (${symAt})`);
      const symXs = (await lines()).map((l) => Number(l.a.x.toFixed(4))).sort((a, b) => a - b);
      assert(Math.abs(symXs[0] - (CW.x - 6)) < 1e-3 && Math.abs(symXs[1] - CW.x) < 1e-3 && Math.abs(symXs[2] - (CW.x + 6)) < 1e-3, `[${kind}] Symmetric positions at ${CW.x - 6}, ${CW.x}, ${CW.x + 6} (${symXs})`);
      await setSelect('Direction 1', 'one');

      // Dialog spinner steps Quantity 2 by 1 (1 -> 2 -> 3)
      await P.tap(await centre('.sk-pattern-dialog [data-spin-for="Quantity 2"][data-spin="up"]'));
      assert.strictEqual((await pats())[0].quantity[1], 2, `[${kind}] dialog spinner steps Quantity 2: 1 -> 2`);
      await P.tap(await centre('.sk-pattern-dialog [data-spin-for="Quantity 2"][data-spin="up"]'));
      assert.strictEqual((await pats())[0].quantity[1], 3, `[${kind}] dialog spinner steps Quantity 2: 2 -> 3`);
      await typeField(P, 'Distance 2', '8');
      await P.tap(await centre(field('Quantity 2')));
      assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Distance 2'))}).value`), '8mm', `[${kind}] Distance 2 reformats with unit on blur (8mm)`);
      ls = await lines();
      assert.strictEqual(ls.length, 9, `[${kind}] 3 x 3 = 9 lines (${ls.length})`);
      const rbox = await linesBox(), rdlg = await dialog();
      assert(!overlaps(rbox, rdlg), `[${kind}] the rectangular dialog does not cover the preview ${JSON.stringify({ rbox, rdlg })}`);
      await shot(`${kind}-4-rect-preview.png`, { x: Math.max(0, rbox.l - 60), y: Math.max(0, rbox.t - 60), width: Math.min(rbox.r - rbox.l + 120, cr.w), height: Math.min(rbox.b - rbox.t + 120, vh) });
      await shot(`${kind}-4b-rect-dialog.png`, { x: Math.max(0, rdlg.l - 4), y: Math.max(0, rdlg.t - 4), width: Math.min(rdlg.r - rdlg.l + 8, vw), height: Math.min(rdlg.b - rdlg.t + 8, vh) });
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await dialog(), null, `[${kind}] Enter applies`);
      assert.strictEqual(await inlineBox(), null, `[${kind}] Enter hides inline boxes`);
      assert.strictEqual(await hist(), h1 + 1, `[${kind}] the rectangular pattern is ONE undo step`);
      const q = (await pats())[0];
      assert(q.type === 'rectangularPattern' && q.quantity[0] === 3 && q.quantity[1] === 3 && q.distance[1] === 8 && q.n === 8, `[${kind}] 3 x 3 stored ${JSON.stringify(q)}`);
      ls = await lines();
      const ys = [...new Set(ls.map((l) => Number((-l.a.y).toFixed(4))))].sort((a, b) => a - b);
      // Extent 8 with Quantity 3 -> spacing 4 mm -> rows 4 mm apart
      assert(ys.length === 3 && Math.abs(ys[1] - ys[0] - 4) < 1e-6 && Math.abs(ys[2] - ys[1] - 4) < 1e-6, `[${kind}] Extent 8 with 3 rows: 4 mm apart (${ys})`);
      out('rectangular: arrow drag, inline boxes, symmetric, spinners, 3 x 3 applied');

      // ---- Cancel leaves nothing
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
