// tests/spur-gear-840-live.test.js -- TASK 840: the SPUR GEAR template in the REAL pages, real mouse (desktop 1400 x 900) and real touch (phone 390 x 844):
//  A. Sketch Studio, desktop: the template picker's Spur gear card -> its start view (the teeth / module / bore / backlash fields, the pressure angle's glyph
//     picker) -> Open: a new tab "Spur gear" holding the gear, two tinted profiles (the page's loops: the ONE outline and the bore)
//     (screenshots: the start view, the gear); in Shaper (its controller seam) also the circular pattern of 24 teeth and the loops (24 x 9 curves + the bore);
//  B. Shaper, desktop: the same from Shaper's picker (its document is in inches: the module opens as 1/8 in); PREPARE: a click inside the gear picks its
//     region, Outside, depth 1/2 in, Hold part Tabs (module 3/8 in typed in the start view; the default 3/8 in tab is refused: no curve that long; 1/8 in): the Preview draws the outside path and the tab marks round the teeth (screenshot); OK; the 3D preview (Export
//     3D) builds the gear standing on its tabs (screenshot);
//  C. phone, real touch: Sketch Studio and Shaper each open the gear from the picker (screenshots).
// Screenshots to .evidence/840/ (EVIDENCE_DIR overrides).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { clickOpenLive, stepLive, previewLive, okLive, selectedLive, typeLive } from './helpers/prepare-open-live.js'; // TASK S3: a click selects (no card); the toolbar's Outside opens the new operation
import { REVIEW_BUILT } from './helpers/review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/840');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const cdp = await launchBrowser({ tag: '840', width: 1400, height: 900, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate } = cdp;
const out = {};
const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;
const ST = 'window.__designController.state';
let phone = false;

const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const press = async (x, y) => {
  if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
  else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(300);
};
const clickElRaw = async (sel) => {
  await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); })()`);
  await sleep(80);
  const p = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const shot = async (name, clip = null) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const shotEl = async (name, sel, scale = 1) => {
  const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.min(innerWidth, b.right) - Math.max(0, b.left), height: Math.min(innerHeight, b.bottom) - Math.max(0, b.top) }; })()`);
  await shot(name, { ...r, scale });
};
// a world box [x0, y0, x1, y1] of the svg `canvasId` on screen, magnified
const shotWorld = async (name, canvasId, box, scale = 2) => {
  const clip = await evalJs(`(() => { const svg = document.getElementById(${JSON.stringify(canvasId)}), m = svg.getScreenCTM(); const p = (x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
    const a = p(${box[0]}, ${box[1]}), b = p(${box[2]}, ${box[3]}); const x = Math.max(0, Math.min(a.x, b.x) - 12), y = Math.max(0, Math.min(a.y, b.y) - 12);
    return { x, y, width: Math.min(innerWidth, Math.max(a.x, b.x) + 12) - x, height: Math.min(innerHeight, Math.max(a.y, b.y) + 12) - y, scale: ${scale} }; })()`);
  await shot(name, clip);
};
const openMenu = async () => {
  if (await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) return;
  await clickElRaw('.sk-sidebar-btn, .sk-sidebar-chevron');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu opens');
  await sleep(250);
};
// the gear in the page: its pattern, the page's own loop finder, the outline's world box
const gearFacts = () => evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js')]).then(([L, G]) => { const st = ${ST}, by = new Map(st.shapes.map((s) => [s.id, s]));
  const pat = st.constraints.find((c) => c.type === 'circularPattern'), loops = L.findLoops(st).map((l) => ({ edges: l.edges.length, poly: G.loopPolygon(l, st, by) }));
  const outline = loops.find((l) => l.edges > 1), box = outline ? outline.poly.reduce((b, q) => [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x), Math.max(b[3], q.y)], [Infinity, Infinity, -Infinity, -Infinity]) : null;
  return { quantity: pat && pat.quantity, instances: pat && pat.instances.length, loops: loops.map((l) => l.edges).sort((a, b) => a - b), box, params: (st.parameters || []).map((p) => p.name + ' = ' + p.expression) }; })`);
// the picker -> the Spur gear card -> its start view -> Open (a new tab named Spur gear)
async function openGear(host, label, { module = null } = {}) {
  await openMenu();
  await clickElRaw('[data-action="templates"]');
  await waitFor(`!!document.querySelector('.sk-tp-card[data-template="spur-gear"]')`, label + ': the Spur gear card in the picker');
  await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, label + ': every card preview drawn', 60000);
  const cards = await evalJs(`[...document.querySelectorAll('.sk-tp-card')].map((c) => c.dataset.template)`);
  assert.strictEqual(cards.indexOf('spur-gear'), cards.indexOf('bolt-circle') + 1, label + ': the Spur gear card right after the Bolt circle');
  if (!phone) await shotEl(`${host}-desktop-picker-gear-card.png`, '.sk-tp-card[data-template="spur-gear"]', 2);
  await clickElRaw('.sk-tp-card[data-template="spur-gear"]');
  await waitFor(`!!document.querySelector('.sk-tp-start[data-template="spur-gear"] .sk-tp-prev svg')`, label + ': the start view with its preview', 60000);
  const fields = await evalJs(`[...document.querySelectorAll('.sk-tp-start .sk-tp-field')].map((f) => f.dataset.param)`);
  assert.deepStrictEqual(fields, ['teeth', 'module', 'pressureAngle', 'bore', 'backlash'], label + ': the start view fields');
  if (module) { // typed in the start view's Module field (a real focus, select all, the text): the preview follows
    await clickElRaw('#sk-tp-f-spur-gear-module');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.insertText', { text: module });
    await sleep(1500);
    await waitFor(`!document.querySelector('.sk-tp-open').disabled`, label + ': the start view rebuilt for module ' + module, 60000);
  }
  await shotEl(`${host}-${phone ? 'phone' : 'desktop'}-start-view.png`, '.sk-tp-panel', phone ? 1 : 1.5);
  await clickElRaw('.sk-tp-open');
  await waitFor(`!document.querySelector('.sk-tp-panel')`, label + ': Open closes the picker', 60000);
  await sleep(400);
  const dont = await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].findIndex((b) => /Don.t save/.test(b.textContent))`);
  if (dont >= 0) await clickElRaw(`.sk-tp-backdrop [role="dialog"] button:nth-of-type(${dont + 1})`);
  await waitFor(`document.querySelectorAll('${host === 'shaper' ? '#design-canvas' : '#svgCanvas'} [data-shape-id]').length > 200`, label + ': the gear drawn', 60000);
  await sleep(800);
  // the profile tint is the page's own loop finder at work: one tint per closed loop, the gear's outline and its bore
  const tint = await evalJs(`[...document.querySelectorAll('${host === 'shaper' ? '#design-canvas' : '#svgCanvas'} path.profile-fill')].map((p) => (p.getAttribute('d').match(/M/g) || []).length)`);
  assert.deepStrictEqual(tint, [1, 1], label + ": two tinted profiles (the page's loops): the gear's ONE outline and the bore: " + JSON.stringify(tint));
  if (host !== 'shaper') return { tint, box: await evalJs(`(() => { const bs = [...document.querySelectorAll('#svgCanvas path.profile-fill')].map((p) => p.getBBox()).sort((p, q) => q.width - p.width), b = bs[0]; return [b.x, b.y, b.x + b.width, b.y + b.height]; })()`) };
  const f = await gearFacts();
  assert.deepStrictEqual([f.quantity, f.instances, f.loops], [24, 23, [1, 216]], label + ': 24 teeth (the pattern), ONE outline of 216 curves and the bore: ' + JSON.stringify(f));
  f.tint = tint;
  assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent`), 'Spur gear', label + ': the new tab is named Spur gear');
  return f;
}

try {
  // ── A. Sketch Studio, desktop ──
  await navigate(url('sketchstudio'), 15000);
  await resetBufferLive(cdp);
  await navigate(url('sketchstudio'), 15000);
  await waitFor(`!!document.getElementById('svgCanvas') && !!document.querySelector('.sk-doctabs')`, 'Sketch Studio loaded');
  out.studio = await openGear('sketchstudio', 'A Sketch Studio');
  await shotWorld('sketchstudio-desktop-gear.png', 'svgCanvas', out.studio.box, 1.5);
  await shot('sketchstudio-desktop-full.png');

  // ── B. Shaper, desktop: open, Prepare Outside with tabs, 3D ──
  await resetBufferLive(cdp);
  await navigate(url('shaper'), 15000);
  await waitFor(`!!window.__designController && !!document.getElementById('design-canvas')`, 'Shaper loaded');
  // Shaper's document is in inches: the module field opens at 1/8 in (3 mm rounded); a 3/8 in module is typed here, so a tab fits inside one curve of the
  // outline (Shaper's tab rule: a tab lies inside ONE segment, its width + the bit away from the segment's ends; at 1/8 in the longest curve is 4.2 mm)
  out.shaper = await openGear('shaper', 'B Shaper', { module: '0.375' });
  assert.ok(out.shaper.params.includes('module = 0.375 in') && out.shaper.params.includes('backlash = 0.004 in'), "B: Shaper's inch document: the module and the backlash in inches: " + JSON.stringify(out.shaper.params));
  await shotWorld('shaper-desktop-gear.png', 'design-canvas', out.shaper.box, 1.5);
  const s2 = { get phone() { return phone; }, evalJs, waitFor, clickEl: clickElRaw };
  const clickEl = (sel) => stepLive(s2, () => clickElRaw(sel));
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await evalJs(`(() => { const e = document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`) === mode) return;
      await clickElRaw(`.sk-header-tab[data-tab="${mode}"]`); await sleep(500);
    }
    assert.fail('could not open ' + mode);
  };
  await openMode('prepare');
  await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.querySelectorAll('#prepare-world-group [data-shape-id]').length > 200`, 'B: Prepare draws the gear', 60000);
  const inside = { x: 0, y: -(out.shaper.box[3] - out.shaper.box[1]) / 2 * 0.6 }; // between the bore and the root circle, on the tooth's axis (world y down)
  await clickOpenLive(s2, async () => {
    const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${inside.x}; pt.y = ${inside.y}; const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
    await press(p.x, p.y);
  });
  await selectedLive(s2, 'B: a click inside the gear picks its region (TASK S3: selected, no card)');
  await typeLive(s2, 'exterior'); // TASK S3: Prepare's toolbar: a new Outside of the gear's region, open
  await waitFor(`!document.querySelector('.cut-card').hidden && document.querySelector('.cut-type-cur').textContent.toLowerCase().includes('outside')`, 'B: Outside picked (its card open)');
  // the depth typed (a real focus by click, select all, the text, the field's change): 1/2 in, Shaper's document being in inches
  const typeDepth = async (text) => {
    await clickEl('.cut-depth');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.insertText', { text });
    await evalJs(`document.querySelector('.cut-depth').blur()`); await sleep(300);
  };
  await typeDepth('0.5');
  await clickEl('.cut-row[data-row="holdPart"] .cut-preset[data-value="tabs"]');
  // the default 3/8 in tab is refused (no curve of the outline is that long: the note says so); a 1/8 in tab fits on the flanks
  out.refusedNote = await evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  const typeInto = async (sel, text) => {
    await clickEl(sel);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.insertText', { text });
    await evalJs(`document.querySelector(${JSON.stringify(sel)}).blur()`); await sleep(300);
  };
  await typeInto('.cut-tab-width', '0.125');
  await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => /tabs?,/.test(d.textContent))`, 'B: the tabs note');
  await previewLive(s2, 'B: the Preview of the Outside cut with tabs');
  out.marks = await evalJs(`({ tabs: document.querySelectorAll('#prepare-canvas .sk-tab-mark').length, strips: document.querySelectorAll('#prepare-canvas .sk-strip').length })`);
  out.note = await evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  assert.ok(out.marks.tabs >= 3, 'B: the tab marks are drawn round the gear: ' + JSON.stringify(out.marks));
  out.paths = await evalJs(`document.querySelectorAll('#prepare-toolpath-group path, #prepare-canvas .sk-travel').length`);
  await shotWorld('shaper-prepare-outside-tabs.png', 'prepare-canvas', out.shaper.box.map((v, i) => v + (i < 2 ? -6 : 6)), 1.5);
  await okLive(s2);
  await openMode('review');
  if (await evalJs(`document.getElementById('review-view-3d').getAttribute('aria-pressed')`) !== 'true') await clickElRaw('#review-view-3d');
  await waitFor(REVIEW_BUILT, 'B: the 3D preview built', 120000);
  await sleep(800);
  out.info3d = await evalJs(`document.getElementById('review-info').textContent`);
  await shotEl('shaper-3d-preview.png', '#review-canvas-host', 1);

  // ── C. phone, real touch: Sketch Studio and Shaper open the gear ──
  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const host of ['sketchstudio', 'shaper']) {
    await resetBufferLive(cdp);
    await navigate(url(host), 15000);
    await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-chevron')`, host + ' phone loaded');
    await sleep(600);
    out[host + 'Phone'] = await openGear(host, 'C ' + host + ' phone');
    await shot(`${host}-phone-gear.png`);
  }
  console.log(`spur-gear-840-live: ALL CHECKS PASSED ${JSON.stringify({ ...out, studio: { ...out.studio, box: undefined }, shaper: { ...out.shaper, box: undefined } })}`);
} finally { await cdp.close(); }
