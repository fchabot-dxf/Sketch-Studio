// tests/offset-line-reverse-656-live.test.js -- TASK 656 (live headless, REAL mouse via CDP, Pen Plotter = the shared Design tab).
// Draw a rectangle (Rect, two-point), dimension it 60 wide and 40 high (Dimension tool), Offset it 15 inside (a 30 x 10 inner rectangle).
// Select, double click the HEIGHT dimension, type 20, Enter: 20 - 30 < 0 has no inner rectangle (it would turn inside out), so the edit is
// REFUSED through the dimension box's own refusal path (ONE warning "Can't set to 20 ... Reverted."), the rectangle stays 40 high, the inner one
// 30 x 10, no undo step. Then 60: accepted, the inner rectangle is 30 x 30, one undo step; Undo -> 30 x 10, Redo -> 30 x 30.
// Screenshots: .evidence/656.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '656');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '656', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } }); assert(r && r.data, `screenshot ${file}: ${JSON.stringify(r)}`); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const typeIn = async (id, text) => { await evalJs(`(() => { const i = document.getElementById('${id}'); i.focus(); i.select(); })()`); for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(200); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const tap = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); };
    const hover = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(150); };
    const double = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); for (let i = 0; i < 2; i++) { await mouse('mousePressed', p.x, p.y, 1); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0); await sleep(60); } await sleep(300); };
    const centerOf = (sel) => evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const hist = () => evalJs(`${STATE}.history.length`);
    const toasts = () => evalJs(`JSON.stringify([...document.querySelectorAll('#notification-container [data-level]')].map((e) => ({ level: e.getAttribute('data-level'), text: e.textContent.trim() })))`).then(JSON.parse);
    const toScreen = (w) => evalJs(`(() => { const s = document.querySelector('#design-canvas'); const p = s.createSVGPoint(); p.x = ${w.x}; p.y = ${w.y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    const boxOpen = (id) => waitFor(`(() => { const i = document.getElementById('${id}'); return !!i && !i.classList.contains('hidden') && i.getBoundingClientRect().width > 0; })()`, `the box #${id}`);
    // every line: { id, a, b, len } (world mm)
    const lines = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'line').map((s) => { const a = ${STATE}.joints.get(s.joints[0]), b = ${STATE}.joints.get(s.joints[1]); return { id: s.id, joints: s.joints, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, len: Math.hypot(b.x - a.x, b.y - a.y) }; }))`).then(JSON.parse);
    const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;
    const sorted = (ls) => ls.map((l) => l.len).sort((p, q) => p - q);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
    await sleep(500);
    const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const tool = (id) => pressRibbonTool(evalJs, tap, id).then(() => sleep(200));

    // ---- the rectangle: Rect (two-point), two clicks about the canvas middle, roughly 3 : 2
    const M = { x: cr.l + cr.w * 0.5, y: cr.t + cr.h * 0.5 }, hw = Math.min(cr.w * 0.18, 180), hh = hw * 2 / 3;
    await tool('tool-rect');
    await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="rect-2pt"]')`, 'the Rect variants menu');
    await tap(await centerOf('.sk-ribbon-menu.show [data-mode="rect-2pt"]'));
    await tap({ x: M.x - hw, y: M.y - hh }); await tap({ x: M.x + hw, y: M.y + hh });
    await key('Escape', 'Escape', 27);
    const rect = await lines();
    assert.strictEqual(rect.length, 4, `the rectangle has 4 sides: ${JSON.stringify(rect)}`);
    const vertical = rect.filter((l) => near(l.a.x, l.b.x, 1e-6)), horizontal = rect.filter((l) => near(l.a.y, l.b.y, 1e-6));
    assert(vertical.length === 2 && horizontal.length === 2, `two vertical and two horizontal sides: ${JSON.stringify(rect)}`);
    const right = vertical.sort((p, q) => q.a.x - p.a.x)[0], top = horizontal[0];
    const mid = (l) => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });

    // ---- the Dimension tool: the right side (placed to its right) 40, a horizontal side (placed beyond it) 60
    const dimension = async (side, away, value) => {
      await tool('tool-dim');
      const m = await toScreen(mid(side));
      await tap(m);
      const place = { x: m.x + away.x, y: m.y + away.y };
      await hover(place); await tap(place);
      await boxOpen('dimInput');
      await typeIn('dimInput', value);
      await key('Enter', 'Enter', 13);
      await sleep(300);
    };
    const tc = await toScreen(mid(top)), rc = await toScreen(mid(right));
    const outward = (p) => ({ x: Math.sign(p.x - M.x) * 70, y: Math.sign(p.y - M.y) * 70 });
    await dimension(right, { x: outward(rc).x, y: 0 }, '40');
    await dimension(top, { x: 0, y: outward(tc).y }, '60');
    await key('Escape', 'Escape', 27);
    const heightDim = () => evalJs(`(() => { const cs = ${STATE}.constraints; const c = cs.find((k) => k.type === 'distance' && !k.isRadius && k.joints && k.joints.length === 2 && ${JSON.stringify(right.joints)}.every((j) => k.joints.includes(j))); return c ? { idx: cs.indexOf(c), value: c.value } : null; })()`);
    const sized = await lines();
    assert.deepStrictEqual(sorted(sized).map((v) => +v.toFixed(6)), [40, 40, 60, 60], `the rectangle is 60 x 40: ${JSON.stringify(sorted(sized))}`);
    const hd = await heightDim();
    assert(hd && hd.value === 40, `the height dimension reads 40: ${JSON.stringify(hd)}`);

    // ---- Offset 15 inside: a 30 x 10 inner rectangle
    await tool('tool-offset');
    const topNow = sized.find((l) => l.id === top.id);
    await tap(await toScreen({ x: mid(topNow).x - 10, y: mid(topNow).y }));
    await boxOpen('offset-distance-input');
    const centreW = (() => { const xs = sized.flatMap((l) => [l.a.x, l.b.x]), ys = sized.flatMap((l) => [l.a.y, l.b.y]); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; })();
    await hover(await toScreen({ x: centreW.x - 8, y: centreW.y }));
    await typeIn('offset-distance-input', '15');
    await key('Enter', 'Enter', 13);
    await key('Escape', 'Escape', 27);
    const rectIds = new Set(rect.map((l) => l.id));
    const inner = async () => (await lines()).filter((l) => !rectIds.has(l.id));
    const made = await inner();
    assert.deepStrictEqual(sorted(made).map((v) => +v.toFixed(6)), [10, 10, 30, 30], `the inner rectangle is 30 x 10: ${JSON.stringify(sorted(made))}`);
    console.log(`made: rectangle 60 x 40, inner ${sorted(made).map((v) => v.toFixed(3)).join(' ')}`);

    // ---- the height 40 -> 20: refused, one message, nothing changes, no undo step
    await tool('tool-select');
    const editTo = async (text) => {
      const d = await heightDim();
      const lab = await centerOf(`.dim-label[data-constraint-idx="${d.idx}"]`);
      await sleep(600);
      await double(lab);
      await boxOpen('dimInput');
      await typeIn('dimInput', text);
      await key('Enter', 'Enter', 13);
      await sleep(400);
    };
    const h0 = await hist(), t0 = (await toasts()).length;
    await editTo('20');
    const fresh = (await toasts()).slice(t0);
    assert.strictEqual((await lines()).find((l) => l.id === right.id).len.toFixed(6), '40.000000', 'after 20: the rectangle stays 40 high');
    const i20 = await inner();
    assert.deepStrictEqual(sorted(i20).map((v) => +v.toFixed(6)), [10, 10, 30, 30], `after 20: the inner rectangle stays 30 x 10: ${JSON.stringify(sorted(i20))}`);
    assert.strictEqual((await heightDim()).value, 40, 'after 20: the height dimension reads 40');
    assert.strictEqual(await hist(), h0, 'after 20: no undo step');
    assert(fresh.length === 1 && fresh[0].level === 'warning' && /^⚠️?\s*Can't set to 20\b.*Reverted\.$/.test(fresh[0].text), `after 20: ONE warning "Can't set to 20 ... Reverted.": ${JSON.stringify(fresh)}`);
    console.log(`refused 20: message "${fresh[0].text}"`);
    const all = await lines(), xs = all.flatMap((l) => [l.a.x, l.b.x]), ys = all.flatMap((l) => [l.a.y, l.b.y]);
    const p0 = await toScreen({ x: Math.min(...xs), y: Math.min(...ys) }), p1 = await toScreen({ x: Math.max(...xs), y: Math.max(...ys) });
    const box = { x: Math.min(p0.x, p1.x) - 110, y: Math.min(p0.y, p1.y) - 110, width: Math.abs(p1.x - p0.x) + 220, height: Math.abs(p1.y - p0.y) + 220 };
    await shot('mouse-1-after-refusal-drawing.png', { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height });
    const tr = await evalJs(`(() => { const e = [...document.querySelectorAll('#notification-container [data-level]')].pop(); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
    await shot('mouse-2-after-refusal-message.png', { x: Math.max(0, tr.x - 10), y: Math.max(0, tr.y - 10), width: tr.width + 20, height: tr.height + 20 });

    // ---- 40 -> 60: accepted, inner 30 x 30; one undo step; Undo / Redo
    await editTo('60');
    assert.strictEqual((await lines()).find((l) => l.id === right.id).len.toFixed(6), '60.000000', 'after 60: the rectangle is 60 high');
    const i60 = await inner();
    assert.deepStrictEqual(sorted(i60).map((v) => +v.toFixed(6)), [30, 30, 30, 30], `after 60: the inner rectangle is 30 x 30: ${JSON.stringify(sorted(i60))}`);
    assert.strictEqual(await hist(), h0 + 1, 'after 60: ONE undo step');
    const a60 = await lines(), xs6 = a60.flatMap((l) => [l.a.x, l.b.x]), ys6 = a60.flatMap((l) => [l.a.y, l.b.y]);
    const q0 = await toScreen({ x: Math.min(...xs6), y: Math.min(...ys6) }), q1 = await toScreen({ x: Math.max(...xs6), y: Math.max(...ys6) });
    await shot('mouse-3-after-60.png', { x: Math.max(0, Math.min(q0.x, q1.x) - 110), y: Math.max(0, Math.min(q0.y, q1.y) - 110), width: Math.abs(q1.x - q0.x) + 220, height: Math.abs(q1.y - q0.y) + 220 });
    await tap(await centerOf('#btn-undo')); await sleep(200);
    const u = await inner();
    assert.deepStrictEqual(sorted(u).map((v) => +v.toFixed(6)), [10, 10, 30, 30], `Undo: the inner rectangle is 30 x 10 again: ${JSON.stringify(sorted(u))}`);
    assert.strictEqual((await heightDim()).value, 40, 'Undo: the height reads 40');
    await tap(await centerOf('#btn-redo')); await sleep(200);
    const rd = await inner();
    assert.deepStrictEqual(sorted(rd).map((v) => +v.toFixed(6)), [30, 30, 30, 30], `Redo: the inner rectangle is 30 x 30: ${JSON.stringify(sorted(rd))}`);
    assert.strictEqual((await heightDim()).value, 60, 'Redo: the height reads 60');
    console.log('accepted 60: inner 30 x 30; undo / redo ok');
    console.log('offset-line-reverse-656-live.test.js: ok');
  } finally { await cdp.close(); }
})();
