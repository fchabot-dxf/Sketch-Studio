// tests/helpers/text-845-live.js — TASK 845: the TEXT tool in the REAL apps (headless Edge / Chrome via CDP, real mouse / touch / keys), shared by the
// text-845-*-live test files (one per app and layout, each short). What is read: the page's drawing (the letters are curves drawn with a
// data-shape-id <text id>_o<n>), the text editor box (.sk-text-editor), the canvas menu, and the hosts' own dev / test seams where the state is
// asserted (Shaper window.__designController, Pen Plotter window.__sketch). Screenshots to .evidence/845/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';
import { pressRibbonTool } from './ribbon-tool.js';
import { openPocketPage } from './pocket-live.js'; // the Shaper page tools (Prepare: a click on a shape, the type menu, the plan, the download)

export const HOSTS = {
  sketchstudio: { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', canvasId: 'svgCanvas', show: null, state: null },
  shaper: { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: 'design', state: 'window.__designController.state' },
  penplotter: { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: 'design', state: 'window.__sketch.controller.state' },
};
export const EVID = path.resolve('.evidence/845');

/** Opens a browser on `host` (phone: 390 x 844 touch, else 1280 x 800 mouse); returns the page tools. null: no browser installed. */
export async function openTextPage(host, { phone = false, tag = '' } = {}) {
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '845-' + host.name + (phone ? '-phone' : '') + tag, width: 1280, height: 800 });
  if (!cdp) return null;
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const C = host.canvas;
  const mouse = (type, x, y, buttons, clickCount = 1, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
  const click = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(450); };
  const press = (p) => (phone ? tap(p) : click(p));
  const dblclick = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(70); await T('touchEnd', []); await sleep(180); await tap({ x: p.x + 4, y: p.y + 4 }); await sleep(300); return; }
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90);
    await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(500);
  };
  const menuAt = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(750); await T('touchEnd', []); await sleep(350); return; }
    await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 2, 1, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, 'right'); await sleep(350);
  };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(350));
  const keys = { esc: () => key('Escape', 'Escape', 27), undo: () => key('z', 'KeyZ', 90, 2), redo: () => key('y', 'KeyY', 89, 2), f8: () => key('F8', 'F8', 119) };
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
  const toWorld = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: s.x, y: s.y }; })()`);
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 2 } } : {}) }); const f = path.join(EVID, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('screenshot ' + f); return f; };
  // the letters drawn on the Design canvas: { n, ids (their text ids), box (screen) }
  const letters = () => evalJs(`(() => { const els = [...document.querySelectorAll('${C} [data-shape-id]')].filter((e) => /_o\\d+$/.test(e.dataset.shapeId));
    const ids = [...new Set(els.map((e) => e.dataset.shapeId.replace(/_o\\d+$/, '')))];
    if (!els.length) return { n: 0, ids, box: null };
    const rs = els.map((e) => e.getBoundingClientRect()); const box = { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) };
    box.width = box.r - box.x; box.height = box.b - box.y; return { n: els.length, ids, box, types: [...new Set(els.map((e) => e.localName))] }; })()`);
  const editor = () => evalJs(`(() => { const e = document.querySelector('.sk-text-editor'); if (!e) return null; const r = e.getBoundingClientRect();
    return { text: e.querySelector('textarea').value, font: e.querySelector('.sk-text-font').value, size: e.querySelector('.sk-text-size').value, note: e.querySelector('.sk-text-note').textContent,
      focused: document.activeElement === e.querySelector('textarea'), box: { x: r.left, y: r.top, width: r.width, height: r.height }, label: e.getAttribute('aria-label') }; })()`);
  const centreOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y); return { x, y, h: r.height, w: r.width, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const pressEl = async (sel) => { const p = await centreOf(sel); assert.ok(p && p.onTop, `${sel} on screen and not covered: ${JSON.stringify(p)}`); await press(p); return p; };
  // the editor's fields: the user's own typing (focus, select all, the typed text arrives as an input event)
  const typeInto = async (sel, text) => { await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`); await send('Input.insertText', { text }); await sleep(300); };
  // a font picked in the editor's font list (the native list popup is the browser's own: its choice arrives as a change event)
  const pickFont = async (name) => { await evalJs(`(() => { const s = document.querySelector('.sk-text-font'); s.focus(); s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300); };
  // a screen point ON a letter, as far as can be from the letters' box centre and corners (where a selected group's transform box puts its handles)
  const letterPoint = () => evalJs(`(() => { const els = [...document.querySelectorAll('${C} [data-shape-id]')].filter((e) => /_o\\d+$/.test(e.dataset.shapeId)); const cv =document.querySelector('${C}').getBoundingClientRect();
    const rs = els.map((e) => e.getBoundingClientRect()); const L = Math.min(...rs.map((r) => r.left)), T = Math.min(...rs.map((r) => r.top)), R = Math.max(...rs.map((r) => r.right)), B = Math.max(...rs.map((r) => r.bottom));
    const handles = [[L, T], [R, T], [L, B], [R, B], [(L + R) / 2, (T + B) / 2]]; let best = null, bestD = -1;
    for (const e of els) { const n = e.getTotalLength(); for (let i = 1; i < 10; i++) { const q = e.getPointAtLength(n * i / 10); const svg = e.ownerSVGElement; const pt = svg.createSVGPoint(); pt.x = q.x; pt.y = q.y; const s = pt.matrixTransform(e.getScreenCTM());
      if (s.x < cv.left + 30 || s.x > cv.right - 30 || s.y < cv.top + 30 || s.y > cv.bottom - 30) continue; // on the canvas, clear of its edges
      const d = Math.min(...handles.map(([x, y]) => Math.hypot(s.x - x, s.y - y))); if (d > bestD) { bestD = d; best = { x: s.x, y: s.y }; } } }
    return best; })()`);
  const ribbon = (id) => pressRibbonTool(evalJs, press, id);
  const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id)`);
  const menuRow = (id) => evalJs(`(() => { const e = document.querySelector('.sk-context-menu .sk-context-item[data-id="${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; })()`);
  const stateJs = (body) => (host.state ? evalJs(`(() => { const st = ${host.state}; ${body} })()`) : Promise.resolve(null));
  const showStage = async (tab) => {
    if (!phone) { await evalJs(`document.querySelector('.sk-header-tab[data-tab="${tab}"]').click()`); await sleep(500); return; }
    if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await pressEl('.sk-sidebar-chevron');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
    await pressEl(`.sk-sidebar-stage[data-tab="${tab}"]`); await sleep(500);
  };
  const open = async () => {
    await installFakeDriveSession(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
    if (host.show) { await sleep(400); await showStage(host.show); }
    await waitForApp(host.canvasId); await sleep(400);
  };
  /** Text tool (its ribbon button), a press at screen point p, the text typed in the box that opens there. -> the editor read after typing. */
  const placeText = async (p, text) => {
    await ribbon('tool-text');
    await press(p);
    await waitFor(`!!document.querySelector('.sk-text-editor')`, host.name + ': the text editor opens at the press');
    const ed = await editor();
    assert.ok(ed.focused, host.name + ': the text box has the keyboard');
    await send('Input.insertText', { text });
    await waitFor(`[...document.querySelectorAll('${C} [data-shape-id]')].some((e) => /_o\\d+$/.test(e.dataset.shapeId))`, host.name + ': the letters drawn while typing', 15000);
    await sleep(300);
    return editor();
  };
  return { cdp, send, evalJs, waitFor, mouse, T, tap, click, press, dblclick, menuAt, key, keys, toScreen, toWorld, shot, letters, editor, centreOf, pressEl, typeInto, pickFont,
    ribbon, letterPoint, menuIds, menuRow, stateJs, showStage, open, placeText, phone, close: () => cdp.close() };
}

/** Shaper (desktop mm, or phone 390 touch): a text from the Design tab's Text tool cut in Prepare: a click on the ring of its 'o' picks the letter WITH its
 *  counter as a hole and Pocket assigns it; a single-line text (Hershey Simplex) is open strokes: On line; the exported file (desktop) writes the o and its counter. */
export async function shaperTextPhase({ phone }) {
  const label = phone ? 'shaper phone' : 'shaper desktop';
  const t = await openPocketPage({ tag: '845-shaper' + (phone ? '-phone' : ''), phone, evidenceDir: EVID });
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); return null; }
  const out = {};
  try {
    const { evalJs, waitFor, send } = t;
    await t.setUnit('mm');
    await t.openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
    const at = (fx, fy) => evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) }; })()`);
    const place = async (p, text, font) => {
      await pressRibbonTool(evalJs, (q) => t.press(q.x, q.y), 'tool-text');
      await t.press(p.x, p.y);
      await waitFor(`!!document.querySelector('.sk-text-editor')`, label + ': the text editor');
      await sleep(200);
      await send('Input.insertText', { text });
      if (font) { await evalJs(`(() => { const s = document.querySelector('.sk-text-font'); s.value = ${JSON.stringify(font)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); }
      await waitFor(`(() => { const st = window.__designController.state, t = st.shapes.filter((s) => s.type === 'text').pop(); return !!t && t.font === ${JSON.stringify(font || 'Inter')} && st.shapes.some((s) => s.textOutline && s.userGroupId === t.userGroupId); })()`, label + ': the letters built');
      await t.clickElRaw('.sk-text-ok');
      await sleep(300);
    };
    await place(await at(0.3, 0.45), 'oB', null);
    await place(await at(0.3, 0.75), 'L', 'Hershey Simplex');
    const geo = await evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js'), import('/packages/core/profile-model.js')]).then(([L, G, P]) => {
      const st = window.__designController.state, by = new Map(st.shapes.map((s) => [s.id, s])), loops = L.findLoops(st);
      const polys = Object.fromEntries(loops.map((l) => [l.id, G.loopPolygon(l, st, by)]));
      const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
      const outers = loops.filter((l) => !loops.some((m) => m !== l && G.polygonContains(polys[m.id], polys[l.id]))).sort((a, b) => box(polys[a.id])[0] - box(polys[b.id])[0]);
      const o = outers[0], ob = box(polys[o.id]), inner = P.derivedProfileForLoop(o.id, loops, polys, st).inners;
      const ib = box(polys[inner[0]]);
      const chains = L.findOpenChains(st, loops).filter((c) => c.edges.every((id) => by.get(id).textOutline));
      const stroke = by.get(chains[0].edges[0]), a = st.joints.get(stroke.joints[0]), b = st.joints.get(stroke.joints[1]);
      return { loops: loops.length, o: o.id, holes: inner.length, ring: { x: (ob[0] + ib[0]) / 2, y: (ob[1] + ob[3]) / 2 }, chains: chains.length, chain: chains[0].id, onStroke: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; })`);
    out.loops = geo.loops; out.chains = geo.chains;
    assert.deepStrictEqual([geo.loops, geo.holes], [5, 1], label + ': o (2 loops) + B (3); the o has its counter as its hole');
    assert.ok(geo.chains >= 2, label + ': the Hershey L is open strokes: ' + geo.chains);
    await t.openMode('prepare');
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await t.clickEl('#prepare-ops .ops-head');
    // the o's ring: picked with its counter, Pocket
    await t.clickWorld(geo.ring.x, geo.ring.y);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the card for the o');
    await t.pickType('pocket');
    await sleep(500);
    const r = await t.rec(geo.ring.x, geo.ring.y);
    assert.strictEqual(r && r.cutType, 'pocket', label + ': the o is a Pocket: ' + JSON.stringify(r));
    out.pocketKey = await evalJs(`import('/tests/helpers/plan-v2.js').then((C) => [...C.V2_PLAN.keys()].filter((k) => C.V2_PLAN.get(k).cutType === 'pocket'))`);
    assert.deepStrictEqual(out.pocketKey, ['loop:' + geo.o], label + ': the pocket is on the o outline (its counter a hole of it)');
    await t.shotWorld(phone ? 'shaper-phone-1-pocket.png' : 'shaper-1-pocket.png', [geo.ring.x - 12, geo.ring.y - 12, geo.ring.x + 30, geo.ring.y + 12]);
    // the Hershey stroke: On line
    await t.clickWorld(geo.onStroke.x, geo.onStroke.y);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the card for the stroke');
    await t.pickType('online');
    await sleep(500);
    out.online = await evalJs(`import('/tests/helpers/plan-v2.js').then((C) => [...C.V2_PLAN.keys()].filter((k) => C.V2_PLAN.get(k).cutType === 'online'))`);
    assert.ok(out.online.length === 1 && out.online[0].startsWith('chain:'), label + ': the stroke On line (an open chain): ' + out.online);
    // the file: the pocket's path is the o with its counter (two sub-paths)
    if (!phone) {
      const svg = await t.download();
      const pocket = [...svg.matchAll(/<path [^>]*>/g)].map((m) => m[0]).find((p) => /pocket/i.test(p));
      const d = pocket && (pocket.match(/ d="([^"]+)"/) || [])[1];
      out.pocketSubpaths = d ? (d.match(/M/g) || []).length : 0;
      assert.strictEqual(out.pocketSubpaths, 2, label + ': the exported pocket is the o outline + its counter');
      // the design saved and opened again (a reload): the letters are rebuilt from the texts with the SAME ids, so the cuts are still on them
      await evalJs(`window.dispatchEvent(new Event('pagehide'))`);
      await waitFor(`document.getElementById('design-canvas').dataset.saveState !== 'saving'`, label + ': the autosave written');
      await send('Page.reload', {});
      await sleep(1000);
      await waitFor(`!!document.getElementById('design-canvas') && document.getElementById('design-canvas').dataset.docReady === '1' && !!window.__designController`, label + ': the page back');
      await waitFor(`window.__designController.state.shapes.filter((s) => s.textOutline).length > 0`, label + ': the letters rebuilt after the reload', 20000);
      await t.openMode('prepare');
      await sleep(500);
      out.afterReload = await evalJs(`import('/tests/helpers/plan-v2.js').then((C) => [...C.V2_PLAN.keys()].map((k) => k + '=' + C.V2_PLAN.get(k).cutType).sort())`);
      assert.deepStrictEqual(out.afterReload, ['chain:' + geo.chain + '=online', 'loop:' + geo.o + '=pocket'].sort(), label + ': after a reload the Pocket and the On line are still on the letters');
    }
    console.log(`text-845 ${label}: ALL CHECKS PASSED ${JSON.stringify(out)}`);
    return out;
  } finally { await t.close(); }
}

/** Pen Plotter (desktop, or phone 390 touch): a text from the Design tab's Text tool is plotted as lines: in its Prepare (toolpath) stage every letter curve
 *  is a stroke of the drawing (an outline font's outline, a single-line font's strokes), and the text shape itself is none. */
export async function plotterTextPhase({ phone }) {
  const label = phone ? 'penplotter phone' : 'penplotter desktop';
  const t = await openTextPage(HOSTS.penplotter, { phone });
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); return null; }
  const out = {};
  try {
    await t.open();
    const at = (fx, fy) => t.evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }; })()`);
    await t.placeText(await at(0.25, 0.4), 'oB');
    await t.typeInto('.sk-text-size', '40'); // big enough to read on the plotter's paper (the next text keeps the size)
    await t.pressEl('.sk-text-ok');
    await t.placeText(await at(0.25, 0.75), 'Hi');
    await t.pickFont('Relief SingleLine');
    await t.waitFor(`(() => { const st = ${HOSTS.penplotter.state}; const tx = st.shapes.filter((s) => s.type === 'text').pop(); return tx.font === 'Relief SingleLine' && st.shapes.some((s) => s.textOutline && s.userGroupId === tx.userGroupId); })()`, label + ': Relief SingleLine letters');
    await t.pressEl('.sk-text-ok');
    const want = await t.stateJs(`return st.shapes.filter((s) => s.textOutline).map((s) => s.id).sort();`);
    out.letters = want.length;
    await t.showStage('toolpath');
    await t.waitFor(`document.querySelectorAll('[data-layer="core-geometry"] polyline[data-shape-id]').length > 0`, label + ': the plotter drawing');
    const drawn = await t.evalJs(`[...document.querySelectorAll('[data-layer="core-geometry"] polyline[data-shape-id]')].map((e) => e.dataset.shapeId).sort()`);
    out.strokes = drawn.length;
    assert.deepStrictEqual(drawn, want, label + ': every letter curve is a plotted stroke, nothing else (the text shape is none)');
    const box = await t.evalJs(`(() => { const rs = [...document.querySelectorAll('[data-layer="core-geometry"] polyline')].map((e) => e.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top)); return { x: Math.max(0, x - 20), y: Math.max(0, y - 20), width: Math.max(...rs.map((r) => r.right)) - x + 40, height: Math.max(...rs.map((r) => r.bottom)) - y + 40 }; })()`);
    await t.shot(phone ? 'penplotter-phone-1-strokes.png' : 'penplotter-1-strokes.png', { ...box, scale: 4 });
    console.log(`text-845 ${label}: ALL CHECKS PASSED ${JSON.stringify(out)}`);
    return out;
  } finally { await t.close(); }
}
