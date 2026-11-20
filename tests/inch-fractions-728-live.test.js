// tests/inch-fractions-728-live.test.js -- TASK 728: Fractional inch display in the real apps (Shaper and SketchStudio), desktop 1280 and phone 390.
//  Shaper (Fusion host: a cut card; then its Design tab): in an inch document Settings > Units shows "Inch display" (Decimal | Fractional); Fractional swaps the
//  Length precision select for the denominators 1/8 .. 1/64 (default 1/16); the open cut card's Depth, a Design dimension label and its Parameters row show
//  fractions at once; a typed "1/4" is stored exactly (6.35 mm), an untouched field writes nothing; back to Decimal restores the decimals; a reload keeps the
//  setting; a mm document has no Inch display row and stays decimal.
//  SketchStudio: a dimension typed "1 1/4 * 0.2" (a mixed number in a formula) reads fx: 1/4" on its label and 1/4 in its Parameters row; Decimal reads
//  fx: 0.3. The same at 390 px (phone).
// Screenshots: .evidence/728/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { clickOpenLive, stepLive } from './helpers/prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed

const EVIDENCE_DIR = path.resolve('.evidence/728');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');
const cdp = await launchBrowser({ tag: '728-fractions', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const url = (p) => `http://127.0.0.1:${port}${p}`;
const IN = 25.4;

const shot = async (name, sels = null) => {
  let clip = null;
  if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q)).filter((e) => e && e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
    const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 8), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 8);
    return { x, y, width: Math.min(innerWidth - x, Math.max(...rs.map((r) => r.right)) + 8 - x), height: Math.min(innerHeight - y, Math.max(...rs.map((r) => r.bottom)) + 8 - y), scale: 2 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const mouse = (type, x, y, buttons = 0, clickCount) => send('Input.dispatchMouseEvent', { type, x, y, button: (type === 'mouseMoved' && !buttons) ? 'none' : 'left', buttons, clickCount: clickCount != null ? clickCount : type === 'mouseMoved' ? 0 : 1 });
const click = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); await sleep(250); };
const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
const clickElRaw = async (sel) => {
  const find = `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getBoundingClientRect().width > 0)`;
  await waitFor(`!!(${find})`, sel + ' visible');
  await evalJs(`(${find}).scrollIntoView({ block: 'nearest', inline: 'nearest' })`);
  const p = await evalJs(`(() => { const e = ${find}; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await click(p.x, p.y);
};
const clickWorldRaw = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await click(p.x, p.y);
};
// TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the steps of before S2 in today's terms (tests/helpers/prepare-open-live.js): a click on the canvas = OK on the open
// operation, the click, and the clicked shape's operation opened (it is in one); a press / a typed field that changes the open operation = its own step
const s2Steps = { get phone() { return false; }, evalJs, waitFor, clickEl: clickElRaw };
const clickEl = (sel) => stepLive(s2Steps, () => clickElRaw(sel));
const clickWorld = (x, y) => clickOpenLive(s2Steps, () => clickWorldRaw(x, y));
// a Shaper stage: the header tab on a desktop; on a phone (no header bar) the drawer's stage row (task 619)
const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
const openMode = async (mode, phone) => {
  for (let i = 0; i < 5; i++) {
    if (await activeStage() === mode) return;
    if (phone) {
      await clickEl('.sk-sidebar-handle');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
      await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
    } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
    await sleep(400);
  }
  assert.fail('could not open the ' + mode + ' stage');
};
const SM = `import('/packages/core/settings-manager.js')`;
const setting = (k) => evalJs(`${SM}.then((m) => m.default.get('${k}'))`);
const setSettings = (o) => evalJs(`${SM}.then((m) => { for (const [k, v] of Object.entries(${JSON.stringify(o)})) m.default.set(k, v); })`);
const P = '.sk-style-panel';
const panelOpen = () => evalJs(`!!document.querySelector('${P}') && !document.querySelector('${P}').classList.contains('sk-hidden')`);
const openSettings = async () => {
  if (!(await panelOpen())) await clickEl('#btn-settings');
  await waitFor(`!document.querySelector('${P}').classList.contains('sk-hidden')`, 'the Settings panel');
  await clickEl(`${P} .sk-style-tab[data-tab="units"]`);
};
const closeSettings = async () => { if (await panelOpen()) await clickEl(`${P} .sk-style-foot .sk-style-btn:last-child`); };
// pick an option in the real <select> of the Units tab (its value + the change event its control listens to)
const pick = async (k, value) => {
  await evalJs(`(() => { const s = document.querySelector('${P} [data-key="${k}"]'); s.value = ${JSON.stringify(String(value))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
};
// the Units tab's rows: [key, shown, value, option texts]
const unitRows = () => evalJs(`[...document.querySelectorAll('${P} .sk-style-tabpanel[data-tab="units"] .sk-style-row')].map((r) => { const s = r.querySelector('select');
  return [r.dataset.row, !r.hidden && r.getBoundingClientRect().width > 0, s ? s.value : null, s ? [...s.options].map((o) => o.textContent) : null]; })`);
const rowShown = async (k) => (await unitRows()).find((r) => r[0] === k)[1];
const labels = (sel) => evalJs(`[...document.querySelectorAll('${sel} .dim-label')].map((g) => (g.querySelector('text') || g).textContent.trim().replace(/\\s+/g, ' '))`);
const tableValues = () => evalJs(`[...document.querySelectorAll('.sk-pwin tr.pt-dim')].map((r) => [...r.children].map((c) => { const i = c.querySelector('input'); return i ? i.value : c.textContent; })[2])`);
const openParameters = async () => { if (!(await evalJs(`!!document.querySelector('.sk-pwin') && !document.querySelector('.sk-pwin').hidden`))) await clickEl('#btn-parameters'); await waitFor(`document.querySelectorAll('.sk-pwin tr.pt-dim').length >= 1`, 'a dimension row'); };

// ── Shaper: the cut card (Fusion host) then the Design tab ──
async function shaper(phone) {
  const tag = phone ? 'phone' : 'desktop';
  await navigate(url('/apps/shaper/index.html?host=fusion'));
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection')`, 'the Fusion Prepare bar');
  await setSettings({ DOC_UNIT: 'in', INCH_DISPLAY: 'decimal', LENGTH_FRACTION: 16, LENGTH_PRECISION: 3, ANGLE_PRECISION: 1, TRAILING_ZEROS: false });
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the drafted pocket imported');
  await openMode('prepare', phone);
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'the prepare stage');
  await clickWorld(60, -40); // the pocket
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'the cut card');
  const depth = () => evalJs(`document.querySelector('.cut-depth').value`);
  const stored = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].find((r) => r.cutType === 'pocket').cutDepth)`);
  const mm0 = await stored();
  assert.strictEqual(await depth(), (mm0 / IN).toFixed(3), `${tag}: Decimal: the depth in inches, 3 decimals`);
  // the Units tab in an inch document
  await openSettings();
  let rows = await unitRows();
  console.log(`${tag} Units rows (Decimal): ` + JSON.stringify(rows));
  assert.deepStrictEqual(rows.find((r) => r[0] === 'INCH_DISPLAY'), ['INCH_DISPLAY', true, 'decimal', ['Decimal (e.g. 1.5 in)', 'Fractional (e.g. 1 1/2")']], `${tag}: the Inch display row`);
  assert.deepStrictEqual([await rowShown('LENGTH_PRECISION'), await rowShown('LENGTH_FRACTION')], [true, false], `${tag}: Decimal: the decimal precision row, not the fraction one`);
  if (!phone) await shot('1-shaper-units-decimal.png', [P]);
  // Fractional: the open card re-renders at once
  await pick('INCH_DISPLAY', 'fractional');
  rows = await unitRows();
  assert.deepStrictEqual(rows.find((r) => r[0] === 'LENGTH_FRACTION'), ['LENGTH_FRACTION', true, '16', ['1/8"', '1/16"', '1/32"', '1/64"']], `${tag}: Fractional: Length precision offers 1/8 .. 1/64, default 1/16`);
  assert.deepStrictEqual([await rowShown('LENGTH_PRECISION'), await setting('INCH_DISPLAY')], [false, 'fractional'], `${tag}: the decimal row is gone, the setting stored`);
  if (phone) assert.deepStrictEqual(await evalJs(`['INCH_DISPLAY', 'LENGTH_FRACTION'].map((k) => { const r = document.querySelector('${P} [data-key="' + k + '"]').getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; })`), [true, true], 'phone: both selects on screen');
  await shot(`2-shaper-units-fractional-${tag}.png`, [P]);
  const frac16 = await depth();
  assert.strictEqual(frac16, '5/16', `${tag}: the open card's Depth reads a fraction at once (${mm0} mm = ${(mm0 / IN).toFixed(4)} in -> 5/16): ${frac16}`);
  await pick('LENGTH_FRACTION', 8);
  assert.strictEqual(await depth(), '3/8', `${tag}: 1/8: the nearest eighth`);
  await pick('LENGTH_FRACTION', 16);
  await closeSettings();
  await shot(`3-shaper-card-fractional-${tag}.png`, ['#prepare-panel .cut-card']);
  // an untouched field writes nothing back; a typed fraction is stored exactly
  await evalJs(`document.querySelector('.cut-depth').focus()`); await sleep(100); await evalJs(`document.querySelector('.cut-depth').blur()`); await sleep(300);
  assert.strictEqual(await stored(), mm0, `${tag}: focus + blur untouched: the exact depth stays`);
  for (const [text, want, shown] of [['1/4', 0.25, '1/4'], ['1 1/8"', 1.125, '1 1/8'], ['3/8 in', 0.375, '3/8']]) {
    await evalJs(`(() => { const i = document.querySelector('.cut-depth'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
    assert.ok(Math.abs((await stored()) - want * IN) < 1e-9, `${tag}: typed ${text} -> ${want} in`);
    assert.strictEqual(await depth(), shown, `${tag}: and the field shows ${shown}`);
  }
  // back to Decimal: the decimals come back
  await openSettings(); await pick('INCH_DISPLAY', 'decimal');
  assert.deepStrictEqual([await depth(), await rowShown('LENGTH_PRECISION'), await rowShown('LENGTH_FRACTION')], ['0.375', true, false], `${tag}: Decimal again: 0.375 and the decimal precision row`);
  await pick('INCH_DISPLAY', 'fractional'); await closeSettings();

  // Design: a dimension label and its Parameters row
  await navigate(url('/apps/shaper/index.html')); // (the Fusion host has no Design tab)
  await waitForApp('design-canvas');
  await openMode('design', phone);
  await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Design tab');
  assert.deepStrictEqual([await setting('DOC_UNIT'), await setting('INCH_DISPLAY'), await setting('LENGTH_FRACTION')], ['in', 'fractional', 16], `${tag}: a reload keeps the setting`);
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
    // around the world point at the canvas centre (the view this page restored), so the label is on screen for the picture
    const svg = document.getElementById('design-canvas'), r = svg.getBoundingClientRect(), pt = svg.createSVGPoint();
    pt.x = r.left + r.width / 2; pt.y = r.top + r.height / 2; const c = pt.matrixTransform(svg.getScreenCTM().inverse());
    st.joints.set('a', { x: c.x - ${0.75 * IN}, y: c.y }); st.joints.set('b', { x: c.x + ${0.78 * IN}, y: c.y });
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] });
    st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: ${1.53 * IN}, name: 'd1', glyphPos: { x: c.x, y: c.y - 8 } });
    if (st.triggerDraw) st.triggerDraw();
  })()`);
  await sleep(500);
  await shot(`4a-shaper-label-fractional-${tag}.png`, ['#design-canvas .dim-label']);
  await openParameters();
  await sleep(500);
  const seen = async () => ({ labels: await labels('#design-canvas'), cells: await tableValues() });
  let d = await seen();
  console.log(`${tag} Shaper Design (Fractional 1/16): ` + JSON.stringify(d));
  assert.ok(d.labels.includes('1 1/2"'), `${tag}: the dimension label (1.53 in at 1/16): ` + JSON.stringify(d.labels));
  assert.deepStrictEqual(d.cells, ['1 1/2'], `${tag}: the Parameters row's value (the Unit column says in)`);
  await shot(`4b-shaper-parameters-fractional-${tag}.png`, ['.sk-pwin']);
  await openSettings(); await pick('INCH_DISPLAY', 'decimal'); await closeSettings(); await sleep(500);
  d = await seen();
  assert.ok(d.labels.includes('1.53') && d.cells[0] === '1.53', `${tag}: Decimal restores 1.53: ` + JSON.stringify(d));
  await shot(`5-shaper-parameters-decimal-${tag}.png`, ['.sk-pwin']);
  assert.ok(Math.abs((await evalJs(`window.__designController.state.constraints[0].value`)) - 1.53 * IN) < 1e-9, `${tag}: the stored value never changed (display only)`);
  // a mm document: no Inch display row, decimals even with Fractional stored
  await setSettings({ INCH_DISPLAY: 'fractional', DOC_UNIT: 'mm' }); await sleep(500);
  await openSettings();
  assert.deepStrictEqual([await rowShown('INCH_DISPLAY'), await rowShown('LENGTH_FRACTION'), await rowShown('LENGTH_PRECISION')], [false, false, true], `${tag}: mm: the Inch display row is hidden, the decimal precision row shown`);
  await closeSettings();
  assert.ok((await labels('#design-canvas')).includes(Number((1.53 * IN).toFixed(3)).toString()), `${tag}: mm: the label is decimal mm (3 decimals)`);
  await setSettings({ DOC_UNIT: 'in' });
}

// ── SketchStudio: a dimension typed 1 1/2" ──
async function studio(phone) {
  const tag = phone ? 'phone' : 'desktop';
  await resetBufferLive(cdp);
  await navigate(url('/apps/sketchstudio/index.html'), 8000);
  await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('dimInput'); })()`, 'SketchStudio to load');
  await waitForApp('svgCanvas');
  await setSettings({ DOC_UNIT: 'in', INCH_DISPLAY: 'fractional', LENGTH_FRACTION: 16, LENGTH_PRECISION: 3, ANGLE_PRECISION: 1, TRAILING_ZEROS: false });
  const cv = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const A = { x: cv.x - (phone ? 120 : 300), y: cv.y + 20 }, B = { x: cv.x + (phone ? 100 : 108), y: cv.y + 20 };
  await clickEl('#tool-line');
  await click(A.x, A.y); await click(B.x, B.y); await key('Escape', 'Escape', 27); await sleep(300);
  await clickEl('#tool-dim');
  await click(A.x, A.y); await click(B.x, B.y);
  await mouse('mouseMoved', (A.x + B.x) / 2, A.y - 60); await sleep(200); await click((A.x + B.x) / 2, A.y - 60);
  await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension box', 8000);
  await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
  await send('Input.insertText', { text: '1 1/4 * 0.2' }); await sleep(150); // a mixed number in a formula: 0.25 in (the line stays on screen at this zoom)
  await key('Enter', 'Enter', 13, 0, '\r'); await sleep(600);
  let lab = await labels('#svgCanvas');
  assert.ok(lab.includes('fx: 1/4"'), `${tag} SketchStudio: typed 1 1/4 * 0.2 -> the label reads fx: 1/4": ` + JSON.stringify(lab));
  await shot(`6a-studio-label-fractional-${tag}.png`, ['#svgCanvas .dim-label']);
  await openParameters(); await sleep(400);
  assert.deepStrictEqual(await tableValues(), ['1/4'], `${tag} SketchStudio: the Parameters row`);
  await shot(`6b-studio-parameters-fractional-${tag}.png`, ['.sk-pwin']);
  await openSettings(); await pick('INCH_DISPLAY', 'decimal'); await closeSettings(); await sleep(500);
  lab = await labels('#svgCanvas');
  assert.ok(lab.includes('fx: 0.25'), `${tag} SketchStudio: Decimal -> fx: 0.25: ` + JSON.stringify(lab));
  assert.deepStrictEqual(await tableValues(), ['0.25'], `${tag} SketchStudio: the Parameters row in Decimal`);
  await shot(`7-studio-parameters-decimal-${tag}.png`, ['.sk-pwin']);
}

try {
  await shaper(false);
  await studio(false);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await resetBufferLive(cdp);
  await shaper(true);
  await studio(true);
  assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, 'no page overflow at 390 px');
  await setSettings({ DOC_UNIT: 'mm', INCH_DISPLAY: 'decimal', LENGTH_FRACTION: 16 });
  console.log('inch-fractions-728-live.test.js: ok');
} finally {
  await close();
}
