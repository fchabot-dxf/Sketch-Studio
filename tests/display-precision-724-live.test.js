// tests/display-precision-724-live.test.js -- TASK 724: adjustable display precision, in the real Shaper (Fusion host, as the 714 test) at 1280 px and at 390 px.
//  1. Auto (the default): the cut card shows what it showed before (Step depth "1.000", the 714 note);
//  2. the Style panel (menu > Settings > Units) has Length precision + Angle precision; Length 5 -> the open cut card re-renders AT ONCE (step depth "1.00000", the
//     note's outline gap has 5 decimals), no click on the card in between;
//  3. Design: a distance label, the Parameters table's value cell show 3 decimals at Length 3; Angle 0 -> the angle label is an integer;
//  4. reload keeps both settings (the selects, SettingsManager); SketchStudio (same origin) sees the same stored settings;
//  5. 390 px: the same Length 5 card + the Style panel rows fit the screen.
// Screenshots (.evidence/724/).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/724');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');
const cdp = await launchBrowser({ tag: '724-precision', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

const shot = async (name, sels = null) => {
  let clip = null;
  if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
    const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 8), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 8);
    return { x, y, width: Math.max(...rs.map((r) => r.right)) + 8 - x, height: Math.max(...rs.map((r) => r.bottom)) + 8 - y, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const clickEl = async (sel) => {
  const find = `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getBoundingClientRect().width > 0)`;
  await waitFor(`!!(${find})`, sel + ' visible');
  const p = await evalJs(`(() => { const e = ${find}; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await mouse(p.x, p.y);
};
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await mouse(p.x, p.y);
};
const P = '.sk-style-panel';
// the Style panel > Units tab: pick a precision in the real <select> (value + the change event the control listens to)
const setPrecision = async (key, value) => {
  await evalJs(`(() => { const s = document.querySelector('${P} [data-key="${key}"]'); s.value = ${JSON.stringify(String(value))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(250);
};
const openStyle = async (phone = false) => {
  if (await evalJs(`!!document.querySelector('${P}') && !document.querySelector('${P}').classList.contains('sk-hidden')`)) return;
  await clickEl(phone ? '.sk-sidebar-handle' : '.sk-sidebar-btn'); await sleep(300); await clickEl('.sk-sidebar [data-action="settings"], .sk-sidebar [data-action="style"]');
  await waitFor(`!document.querySelector('${P}').classList.contains('sk-hidden')`, 'the Style panel');
  const units = [...await evalJs(`[...document.querySelectorAll('${P} .sk-style-tab')].map((t) => t.dataset.tab)`)].indexOf('units');
  assert.ok(units >= 0, 'the Style panel has a Units tab');
  await clickEl(`${P} .sk-style-tab[data-tab="units"]`);
};
const closeStyle = async () => { if (await evalJs(`!document.querySelector('${P}').classList.contains('sk-hidden')`)) await clickEl(`${P} .sk-style-foot .sk-style-btn:last-child`); };
const setting = (k) => evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.get('${k}'))`);

try {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection')`, 'the Fusion Prepare bar');
  await evalJs(`(() => { localStorage.removeItem('sketch-studio-settings'); return import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); m.default.set('LENGTH_PRECISION', null); m.default.set('ANGLE_PRECISION', null); }); })()`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the drafted pocket imported');
  await clickEl('.sk-header-tab[data-tab="prepare"]');
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'the prepare stage');
  await clickWorld(60, -40); // the pocket
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'the cut card');
  await clickEl('#prepare-panel .cut-type-trigger');
  await clickEl('.cut-type-opt[data-id="stepped-pocket"]');
  const card = () => evalJs(`({ step: document.querySelector('.cut-step-depth').value, depth: document.querySelector('.cut-depth').value, note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);

  // 1. Auto: as before
  await waitFor(`document.querySelectorAll('.cut-note div').length > 0`, 'the stepped note');
  const auto = await card();
  console.log('Auto card: ' + JSON.stringify(auto));
  assert.strictEqual(auto.step, '1.000', 'Auto: Step depth keeps its 3 decimals');
  assert.deepStrictEqual(auto.note, ['Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.18 mm apart'], 'Auto: the note is the 714 note');
  await shot('1-card-auto.png', ['#prepare-panel .cut-card']);

  // 2. Length precision 5 in the Style panel: the open card re-renders at once
  await openStyle();
  const rows = await evalJs(`['LENGTH_PRECISION', 'ANGLE_PRECISION'].map((k) => { const s = document.querySelector('${P} [data-key="' + k + '"]'); return [k, s && s.tagName, s && s.options.length, s && s.value, s && s.getBoundingClientRect().width > 0]; })`);
  console.log('Style panel rows: ' + JSON.stringify(rows));
  assert.deepStrictEqual(rows, [['LENGTH_PRECISION', 'SELECT', 8, '', true], ['ANGLE_PRECISION', 'SELECT', 6, '', true]], 'two selects on the Units tab: Auto + 0..6 and Auto + 0..4, both Auto');
  await shot('2-style-panel-units.png', [P]);
  await setPrecision('LENGTH_PRECISION', 5);
  assert.strictEqual(await setting('LENGTH_PRECISION'), 5, 'stored as the number 5');
  const five = await card();
  console.log('Length 5 card: ' + JSON.stringify(five));
  assert.strictEqual(five.step, '1.00000', 'the open card re-rendered: Step depth has 5 decimals');
  assert.strictEqual(five.depth, '8.00000', 'the Depth field has 5 decimals');
  await setPrecision('LENGTH_PRECISION', 0);
  const zero = await card();
  console.log('Length 0 card: ' + JSON.stringify(zero));
  assert.deepStrictEqual([zero.step, zero.depth, zero.note], ['1', '8', ['Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0 mm apart']], 'Length 0: the fields and the note show whole numbers');
  await setPrecision('LENGTH_PRECISION', 5);
  await closeStyle();
  await shot('3-card-length5.png', ['#prepare-panel .cut-card']);
  // typing still takes any number of decimals: 1.23456789 is stored whole
  await evalJs(`(() => { const i = document.querySelector('.cut-step-depth'); i.value = '1.23456789'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(250);
  assert.strictEqual(await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].find((r) => r.cutType === 'stepped-pocket').stepDepth)`), 1.23456789, 'typed decimals are stored whole (display only)');

  // 3. Design: a distance label, the Parameters value cell, an angle label (Length 3, Angle 0)
  await openStyle(); await setPrecision('LENGTH_PRECISION', 3); await setPrecision('ANGLE_PRECISION', 0); await closeStyle();
  assert.deepStrictEqual([await setting('LENGTH_PRECISION'), await setting('ANGLE_PRECISION')], [3, 0], 'Length 3, Angle 0 stored');
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`); // (the Fusion host has no Design tab)
  await waitForApp('design-canvas');
  for (let i = 0; i < 5; i++) { await clickEl('.sk-header-tab[data-tab="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.sk-header-tab.active').dataset.tab`) === 'design') break; }
  await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Design tab');
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
    const J = (id, x, y) => st.joints.set(id, { x, y });
    J('a', -45, -20); J('b', -5, -20); J('c', -5, 10);
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] });
    st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40.123456, name: 'd1', glyphPos: { x: -25, y: -30 } });
    st.constraints.push({ type: 'angle', shapes: ['L1', 'L2'], value: 89.6, name: 'd2', glyphPos: { x: -12, y: -10 } });
    if (st.triggerDraw) st.triggerDraw();
  })()`);
  await clickEl('#btn-parameters');
  await waitFor(`document.querySelectorAll('.sk-pwin tr.pt-dim').length === 2`, 'the two dimension rows');
  const seen = () => evalJs(`({ labels: [...document.querySelectorAll('#design-canvas .dim-label')].map((e) => e.textContent.trim()),
    cells: [...document.querySelectorAll('.sk-pwin tr.pt-dim')].map((r) => [...r.children].map((c) => { const i = c.querySelector('input'); return i ? i.value : c.textContent; })[2]) })`);
  await waitFor(`document.querySelectorAll('#design-canvas .dim-label').length >= 2`, 'labels drawn');
  await sleep(500);
  const d = await seen();
  console.log('Length 3 / Angle 0: ' + JSON.stringify(d));
  assert.ok(d.labels.includes('40.123') && d.labels.includes('90°'), 'the canvas labels: 3 decimals for the length, an integer angle: ' + JSON.stringify(d.labels));
  assert.deepStrictEqual(d.cells, ['40.123', '90'], 'the Parameters table values follow the same two settings');
  await shot('4-design-length3-angle0.png');
  // back to Auto: both return to 1 decimal at once
  await openStyle(); await setPrecision('LENGTH_PRECISION', ''); await setPrecision('ANGLE_PRECISION', ''); await closeStyle();
  await sleep(500);
  const back = await seen();
  assert.ok(back.labels.includes('40.1') && back.labels.includes('89.6°'), 'Auto again: ' + JSON.stringify(back.labels));
  assert.deepStrictEqual(back.cells, ['40.1', '89.6'], 'Auto again: the table');

  // 4. reload keeps the setting; SketchStudio (same origin) sees it
  await openStyle(); await setPrecision('LENGTH_PRECISION', 2); await setPrecision('ANGLE_PRECISION', 3); await closeStyle();
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  assert.deepStrictEqual([await setting('LENGTH_PRECISION'), await setting('ANGLE_PRECISION')], [2, 3], 'Shaper after a reload keeps 2 and 3');
  await openStyle();
  assert.deepStrictEqual(await evalJs(`['LENGTH_PRECISION', 'ANGLE_PRECISION'].map((k) => document.querySelector('${P} [data-key="' + k + '"]').value)`), ['2', '3'], 'the selects show the stored values');
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`);
  await waitForApp('svgCanvas');
  assert.deepStrictEqual([await setting('LENGTH_PRECISION'), await setting('ANGLE_PRECISION')], [2, 3], 'SketchStudio sees the same settings');
  assert.deepStrictEqual(await evalJs(`import('/packages/ui/svg-renderer.js').then((m) => [m.formatLenLabel(12.3456), m.formatConstraintValue({ type: 'angle', value: 12.3456 })])`), ['12.35', '12.346°'], 'SketchStudio labels format at 2 and 3');

  // 5. 390 px
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await openStyle(true); await sleep(300);
  const fits = await evalJs(`['LENGTH_PRECISION', 'ANGLE_PRECISION'].map((k) => { const r = document.querySelector('${P} [data-key="' + k + '"]').getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= 390; })`);
  assert.deepStrictEqual(fits, [true, true], 'at 390 px both precision selects are on screen');
  assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, 'no page overflow at 390 px');
  await shot('5-phone-style-units.png');
  console.log('display-precision-724-live.test.js: ok');
} finally {
  await close();
}
