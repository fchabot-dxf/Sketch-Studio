// tests/offset-negative-radius-654-live.test.js -- TASK 654 (live headless, REAL mouse via CDP, Pen Plotter = the shared Design tab).
// Fillet audit F24: draw an L, Fillet its corner R 8, Offset the chain 5 inside (offset arc R 3). Select, double click the fillet's radius
// dimension, type 4, Enter: 4 - 5 < 0 has no offset arc, so the edit is REFUSED through the dimension box's own refusal path (ONE warning
// "Can't set to 4 ... Reverted."), the fillet stays R 8, the offset arc stays R 3 inside it, no undo step. Then 12: accepted, offset arc R 7, one
// undo step; Undo -> R 8 / R 3, Redo -> R 12 / R 7. Screenshots: .evidence/654.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '654');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '654', width: 1600, height: 900 });
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
    // every arc: { id, c, r: [both rim radii] } (world mm)
    const arcs = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'arc').map((s) => { const J = (i) => ${STATE}.joints.get(s.joints[i]); const c = J(0); return { id: s.id, c: { x: c.x, y: c.y }, ends: [J(1), J(2)].map((p) => ({ x: p.x, y: p.y })), r: [J(1), J(2)].map((p) => Math.hypot(p.x - c.x, p.y - c.y)) }; }))`).then(JSON.parse);
    const toasts = () => evalJs(`JSON.stringify([...document.querySelectorAll('#notification-container [data-level]')].map((e) => ({ level: e.getAttribute('data-level'), text: e.textContent.trim() })))`).then(JSON.parse);
    const radiusDim = (arcId) => evalJs(`(() => { const cs = ${STATE}.constraints; const c = cs.find((k) => k.isRadius && k.shape === '${arcId}'); return c ? { idx: cs.indexOf(c), value: c.value, name: c.name } : null; })()`);
    const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
    await sleep(500);
    const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const tool = async (id) => { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); };

    // ---- the L (corner low-left, arms up and right), its corner filleted R 8, the chain offset 5 inside
    const arm = Math.min(cr.w * 0.32, 220);
    const K = { x: cr.l + cr.w * 0.5 - arm * 0.5, y: cr.t + cr.h * 0.62 };
    const A = { x: K.x, y: K.y - arm }, B = { x: K.x + arm, y: K.y };
    await tool('tool-line'); await tap(A); await tap(K); await tap(B); await key('Escape', 'Escape', 27);
    assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 2, 'two lines are drawn');
    const armMm = await evalJs(`Math.min(...${STATE}.shapes.filter((s) => s.type === 'line').map((s) => { const a = ${STATE}.joints.get(s.joints[0]), b = ${STATE}.joints.get(s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); }))`);
    assert(armMm > 30, `the L's arms (${armMm.toFixed(1)} mm) are long against a 12 mm fillet`);

    await tool('tool-fillet'); await tap(K);
    await waitFor(`!!document.getElementById('fillet-radius-input')`, 'the fillet radius box');
    await typeIn('fillet-radius-input', '8');
    await key('Enter', 'Enter', 13);
    const [fillet] = await arcs();
    assert(fillet && fillet.r.every((v) => near(v, 8)), `the fillet is R 8: ${JSON.stringify(fillet)}`);

    const onA = { x: K.x, y: K.y - arm * 0.6 }, inside = { x: K.x + arm * 0.3, y: K.y - arm * 0.5 };
    await tool('tool-offset'); await tap(onA);
    await waitFor(`!!document.getElementById('offset-distance-input')`, 'the offset distance box');
    await hover(inside);
    await typeIn('offset-distance-input', '5');
    await key('Enter', 'Enter', 13);
    const made = await arcs();
    const off = made.find((a) => a.id !== fillet.id);
    assert(off && off.r.every((v) => near(v, 3)) && near(Math.hypot(off.c.x - fillet.c.x, off.c.y - fillet.c.y), 0), `the offset arc is R 3 about the fillet's centre: ${JSON.stringify(made)}`);
    const inside3 = (o, f, d) => o.ends.every((q, k) => near(Math.hypot(q.x - f.ends[k].x, q.y - f.ends[k].y), d) && near(Math.hypot(q.x - f.c.x, q.y - f.c.y), f.r[k] - d));
    assert(inside3(off, fillet, 5), 'the offset arc ends are 5 inside the fillet ends');
    console.log(`made: fillet R ${fillet.r[0].toFixed(3)}, offset arc R ${off.r[0].toFixed(3)} inside`);

    // ---- the fillet radius 8 -> 4: refused, one message, nothing changes, no undo step
    await tool('tool-select');
    const dim = await radiusDim(fillet.id);
    assert(dim && dim.value === 8, `the fillet's radius dimension reads 8: ${JSON.stringify(dim)}`);
    const editTo = async (text) => {
      const d = await radiusDim(fillet.id);
      const lab = await centerOf(`.dim-label[data-constraint-idx="${d.idx}"]`);
      await sleep(600);
      await double(lab);
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `the dimension box (${text})`);
      await typeIn('dimInput', text);
      await key('Enter', 'Enter', 13);
      await sleep(400);
    };
    const h0 = await hist(), t0 = (await toasts()).length;
    await editTo('4');
    const afterRefusal = await arcs(), all = await toasts(), fresh = all.slice(t0);
    const f1 = afterRefusal.find((a) => a.id === fillet.id), o1 = afterRefusal.find((a) => a.id === off.id);
    assert(f1.r.every((v) => near(v, 8)), `after 4: the fillet stays R 8 (${f1.r})`);
    assert(o1.r.every((v) => near(v, 3)) && inside3(o1, f1, 5), `after 4: the offset arc stays R 3 inside (${o1.r})`);
    assert.strictEqual((await radiusDim(fillet.id)).value, 8, 'after 4: the radius dimension reads 8');
    assert.strictEqual(await hist(), h0, 'after 4: no undo step');
    assert(fresh.length === 1 && fresh[0].level === 'warning' && /^⚠️?\s*Can't set to 4\b.*Reverted\.$/.test(fresh[0].text), `after 4: ONE warning "Can't set to 4 ... Reverted.": ${JSON.stringify(fresh)}`);
    console.log(`refused 4: message "${fresh[0].text}"`);
    const fp = await evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const q = (x, y) => { const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const r = pt.matrixTransform(svg.getScreenCTM()); return { x: r.x, y: r.y }; }; return q(${fillet.c.x}, ${fillet.c.y}); })()`);
    await shot('mouse-1-after-refusal-drawing.png', { x: Math.max(0, fp.x - 160), y: Math.max(0, fp.y - 150), width: 320, height: 260 });
    const tr = await evalJs(`(() => { const e = [...document.querySelectorAll('#notification-container [data-level]')].pop(); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
    await shot('mouse-2-after-refusal-message.png', { x: Math.max(0, tr.x - 10), y: Math.max(0, tr.y - 10), width: tr.width + 20, height: tr.height + 20 });

    // ---- 8 -> 12: accepted, offset arc R 7; one undo step; Undo / Redo
    await editTo('12');
    const a12 = await arcs(), f2 = a12.find((a) => a.id === fillet.id), o2 = a12.find((a) => a.id === off.id);
    assert(f2.r.every((v) => near(v, 12)), `after 12: the fillet is R 12 (${f2.r})`);
    assert(o2.r.every((v) => near(v, 7)) && inside3(o2, f2, 5), `after 12: the offset arc is R 7 inside (${o2.r})`);
    assert.strictEqual(await hist(), h0 + 1, 'after 12: ONE undo step');
    await shot('mouse-3-after-12.png', { x: Math.max(0, fp.x - 160), y: Math.max(0, fp.y - 150), width: 320, height: 260 });
    await tap(await centerOf('#btn-undo')); await sleep(200);
    const u = await arcs();
    assert(u.find((a) => a.id === fillet.id).r.every((v) => near(v, 8)) && u.find((a) => a.id === off.id).r.every((v) => near(v, 3)), `Undo: fillet R 8, offset R 3 (${JSON.stringify(u.map((a) => a.r))})`);
    await tap(await centerOf('#btn-redo')); await sleep(200);
    const rd = await arcs();
    assert(rd.find((a) => a.id === fillet.id).r.every((v) => near(v, 12)) && rd.find((a) => a.id === off.id).r.every((v) => near(v, 7)), `Redo: fillet R 12, offset R 7 (${JSON.stringify(rd.map((a) => a.r))})`);
    console.log('accepted 12: offset arc R 7; undo / redo ok');
    console.log('offset-negative-radius-654-live.test.js: ok');
  } finally { await cdp.close(); }
})();
