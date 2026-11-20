// tests/parameters-fx-badge-699-live.test.js - TASK 699: the Parameters table's "fx" badge marks only a row whose Expression is a FORMULA.
// The `.pt-fx { display: inline-block }` rule used to beat the `hidden` attribute, so every dimension row showed it (found by task 694).
// Live, the REAL Shaper Design tab (the table is the shared #ui one SketchStudio embeds; SketchStudio exposes no state handle to seed from),
// real mouse at 1400 x 860 and real touch at 390 x 844: a plain dimension d1 (20 mm), a rectangular pattern's values d2..d5 (plain), then
// `d1 * 2` typed into d4's Expression cell (a formula): per row the badge's computed display and its visible rect: only d4 shows it.
// EVIDENCE_DIR + SHOT_PREFIX (optional): cropped screenshots of the table.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/699');
fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const cdp = await launchBrowser({ tag: '699', width: 1400, height: 860 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const W = '.sk-pwin';
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const mouse = async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(40); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(30); await mouseEv('mouseReleased', p.x, p.y); await sleep(300); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (p) => { await T('touchStart', [p]); await sleep(50); await T('touchEnd', []); await sleep(400); };
  let pointer = mouse;
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
  const Enter = async () => { await key('Enter', 'Enter', 13, 0, '\r'); await sleep(500); };
  const Tab = () => key('Tab', 'Tab', 9);
  const selectAll = () => key('a', 'KeyA', 65, 2);
  const SIGN = { ' ': ['Space', 32], '=': ['Equal', 187], '*': ['Digit8', 56], '-': ['Minus', 189], '.': ['Period', 190], '/': ['Slash', 191], '°': ['Unidentified', 0] };
  const type = async (text) => {
    for (const ch of text) {
      const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : SIGN[ch];
      await key(ch, code, vk, 0, ch); await sleep(15);
    }
    await sleep(200);
  };
  const center = async (sel) => {
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null; })()`);
    assert(c, sel + ' not on screen'); return c;
  };
  const press = async (sel) => pointer(await center(sel));
  const S = (expr) => evalJs(`(() => { const s = window.__designController.state; return (${expr}); })()`);
  const J = (expr) => S(`JSON.stringify(${expr})`).then(JSON.parse);
  const history = () => S('s.history.length');
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const row = (name) => `${W} tr.sk-ptable-row[data-name="${name}"]`;
  const cellIn = (name, col) => `${row(name)} input[data-col="${col}"]`;
  const message = (name) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(row(name))}); const m = r && r.nextElementSibling; return m && m.classList.contains('pt-msg') ? { text: m.textContent, err: m.classList.contains('pt-msg-err') } : null; })()`);
  const typeCell = async (name, col, text, { enter = true } = {}) => { await press(cellIn(name, col)); await selectAll(); await type(text); if (enter) await Enter(); };
  const pat = (type) => J(`(() => { const c = s.constraints.find((k) => k.type === ${JSON.stringify(type)}); return c ? { names: c.names, expressions: c.expressions || null, quantity: c.quantity, distance: c.distance, angle: c.angle, distanceType: c.distanceType, idx: s.constraints.indexOf(c), n: c.instances.length } : null; })()`);
  const d1 = () => J(`(() => { const c = s.constraints.find((k) => k.type === 'distance'); const a = s.joints.get('m0'), b = s.joints.get('m1'); return { name: c.name, expression: c.expression || null, value: Math.round(c.value * 1e6) / 1e6, len: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 1e6) / 1e6 }; })()`);
  const labelText = (idx) => evalJs(`[...document.querySelectorAll('#design-canvas .dim-label[data-constraint-idx="${idx}"] text')].map((t) => t.textContent.trim())`);
  const shot = async (file, rect, pad = 8) => {
    const clip = { x: Math.max(0, Math.round(rect.x - pad)), y: Math.max(0, Math.round(rect.y - pad)), width: Math.round(rect.width + 2 * pad), height: Math.round(rect.height + 2 * pad), scale: 2 };
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
  };
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
  // the screen box of the drawing (every shape's joints) and its labels, inside the canvas
  const drawingRect = () => evalJs(`(() => { const s = window.__designController.state, svg = document.querySelector('#design-canvas'), m = svg.getScreenCTM(), cv = svg.getBoundingClientRect();
    const ps = s.shapes.flatMap((sh) => sh.joints.map((id) => s.joints.get(id))).filter(Boolean).map((j) => { const p = svg.createSVGPoint(); p.x = j.x; p.y = j.y; return p.matrixTransform(m); });
    const ls = [...document.querySelectorAll('#design-canvas .dim-label')].map((g) => g.getBoundingClientRect());
    const xs = [...ps.map((p) => p.x), ...ls.flatMap((b) => [b.left, b.right])], ys = [...ps.map((p) => p.y), ...ls.flatMap((b) => [b.top, b.bottom])];
    const l = Math.max(cv.left, Math.min(...xs) - 20), t = Math.max(cv.top, Math.min(...ys) - 20), r = Math.min(cv.right, Math.max(...xs) + 20), b = Math.min(cv.bottom, Math.max(...ys) + 20);
    return { x: l, y: t, width: r - l, height: b - t }; })()`);
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-chevron')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
  };
  // a short vertical line SRC (fixed: 0,0 -> 0,10 up) and a horizontal line M from (0, -20) with its distance dimension d1 = 20 mm
  const seed = () => evalJs(`(() => {
    const st = window.__designController.state;
    st.clearDocument();
    st.joints.set('s0', { x: 0, y: 0, fixed: true }); st.joints.set('s1', { x: 0, y: -10, fixed: true });
    st.shapes.push({ id: 'SRC', type: 'line', joints: ['s0', 's1'] });
    st.joints.set('m0', { x: 0, y: 20, fixed: true }); st.joints.set('m1', { x: 20, y: 20, fixed: false });
    st.shapes.push({ id: 'M', type: 'line', joints: ['m0', 'm1'] });
    st.constraints.push({ type: 'horizontal', joints: ['m0', 'm1'] });
    st.constraints.push({ type: 'distance', joints: ['m0', 'm1'], value: 20, name: 'd1', dimMode: 'horizontal', offset: 4, isDriven: false, driven: false });
    st.saveState('seeded');
    return st.shapes.length;
  })()`);
  const fit = async (steps = 4) => {
    await press('#btn-recenter-view'); await sleep(500);
    const cv = await center('#design-canvas');
    for (let i = 0; i < steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cv.x, y: cv.y, deltaX: 0, deltaY: 200 }); await sleep(120); }
    await sleep(400);
  };
  const tapLine = async (a, b) => { const p = await toScreen((a.x + b.x) / 2, (a.y + b.y) / 2); await pointer(p); };
  const closeDialogToasts = () => evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; })()`);
  const badge = (name) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(row(name))}); const b = r && r.querySelector('.pt-fx'); if (!b) return null; const q = b.getBoundingClientRect(); return { hidden: b.hidden, display: getComputedStyle(b).display, visible: q.width > 0 && q.height > 0 }; })()`);
  const scenario = async (tag) => {
    await seed();
    await press('#tool-select');
    await fit(pointer === touch ? 8 : 4);
    await tapLine({ x: 0, y: 0 }, { x: 0, y: -10 });
    await pressRibbonTool(evalJs, pointer, 'tool-rectangularPattern');
    await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])') && window.__designController.state.constraints.some((c) => c.type === 'rectangularPattern')`, `${tag}: the live pattern`);
    await press('.sk-pattern-dialog .sk-pat-ok');
    await waitFor(`!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `${tag}: OK closes the dialog`);
    await press('#btn-parameters');
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 5`, `${tag}: d1 + the 4 pattern values in the table`);
    const state = async () => { const out = {}; for (const n of ['d1', 'd2', 'd3', 'd4', 'd5']) out[n] = await badge(n); return out; };
    const plain = await state();
    await sleep(300);
    await shot(`${process.env.SHOT_PREFIX || ''}${tag}-1-plain-table.png`, await rectOf(W));
    for (const n of ['d1', 'd2', 'd3', 'd4', 'd5']) assert.deepStrictEqual(plain[n] && [plain[n].hidden, plain[n].display, plain[n].visible], [true, 'none', false], `${tag}: ${n} is a plain value: no fx badge shown (${JSON.stringify(plain[n])})`);
    await typeCell('d4', 'expression', 'd1 * 2');
    await waitFor(`!!document.querySelector(${JSON.stringify(row('d4') + ' .pt-fx:not([hidden])')})`, `${tag}: d4's badge unhides`);
    const f = await state();
    assert.deepStrictEqual([f.d4.hidden, f.d4.display, f.d4.visible], [false, 'block', true], `${tag}: the formula row d4 shows fx (${JSON.stringify(f.d4)})`);
    for (const n of ['d1', 'd2', 'd3', 'd5']) assert.deepStrictEqual([f[n].display, f[n].visible], ['none', false], `${tag}: ${n} still shows no fx (${JSON.stringify(f[n])})`);
    await sleep(300);
    await shot(`${process.env.SHOT_PREFIX || ''}${tag}-2-formula-table.png`, await rectOf(W));
  };
  try {
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await scenario('mouse');
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await openShaper();
    await scenario('touch');
    console.log('parameters-fx-badge-699-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
