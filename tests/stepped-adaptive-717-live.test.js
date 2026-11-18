// tests/stepped-adaptive-717-live.test.js — TASK 717: in the real page (Fusion mode, adsk stubbed, the SA-7 R3 floor fillet pocket) the stepped card's
// "Adaptive stepping" checkbox replaces the Step depth row by the Resolution row (Coarse / Medium / Fine presets); switching Coarse -> Fine updates the
// card note, the 3D Review (its levels and info) and the downloaded export (export == Review). Real clicks. Screenshots to .evidence/717/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
const EVIDENCE_DIR = path.resolve('.evidence/717');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');
const cdp = await launchBrowser({ tag: '717-adaptive', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-717-dl-'));
// a screenshot of the whole page, or of the box around the element `sel` (8 px margin)
const shot = async (name, sel = null) => {
  let clip = null;
  if (sel) clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};
// a real click on the element's centre, after checking nothing covers it there
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await mouse(p.x, p.y);
};
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await mouse(p.x, p.y);
};
const openStage = async (id) => {
  await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`);
};
// the Review, built: its info lines (the relief's levels = the distinct depths: the outline's 19 mm + one per step)
const review = async (expectLevels) => {
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent) && /${expectLevels} level/.test(document.getElementById('review-info').textContent)`, `the Review built with ${expectLevels} levels`);
  await sleep(600); // the wood textures arrive asynchronously (the board re-renders when they do)
  return evalJs(`[...document.getElementById('review-info').children].map((d) => d.textContent)`);
};
const zoomReview = async () => {
  const c = await evalJs(`(() => { const r = document.getElementById('review-canvas-host').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await clickEl('#review-reset');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 });
  for (let i = 0; i < 11; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -300 }); await sleep(150); }
  await sleep(300);
};
const cardState = () => evalJs(`({ checked: document.querySelector('.cut-adaptive').checked,
  rows: [...document.querySelectorAll('.cut-rows .cut-row')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.row || r.dataset.param),
  resolution: document.querySelector('.cut-step-deviation').value,
  presets: [...document.querySelectorAll('.cut-row[data-row="stepDeviation"] .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')),
  note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);
const exportDepths = async () => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await openStage('review');
  await clickEl('#btn-generate-svg');
  let file = null;
  for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  const svg = fs.readFileSync(file, 'utf8');
  await openStage('prepare');
  await clickWorld(60, -40); // the selection is gone after a stage change: select the pocket again
  return [...svg.matchAll(/<(path|circle) [^>]*shaper:cutType="pocket"[^>]*shaper:cutDepth="([^"]+)"/g)].map((m) => m[2]);
};
const reviewDepths = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.planReliefItems(window.__designController.state).filter((i) => i.cutType === 'pocket').map((i) => i.cutDepth.toFixed(3) + ' mm'))`);
const preset = (value) => clickEl(`.cut-row[data-row="stepDeviation"] .cut-preset[data-value="${value}"]`);
try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('03-pocket-floor-fillet'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the R3 floor fillet pocket imported');
  await clickWorld(60, -40);
  await clickEl('#prepare-panel .cut-type-trigger');
  await clickEl('.cut-type-opt[data-id="stepped-pocket"]');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.cutType === 'stepped-pocket'))`, 'Stepped pocket set');
  // OFF: the 716 card
  let c = await cardState();
  console.log('OFF: ' + JSON.stringify(c));
  assert.deepStrictEqual([c.checked, c.rows.slice(0, 3)], [false, ['cutDepth', 'adaptiveSteps', 'stepDepth']], 'OFF: the checkbox (unchecked), then the Step depth row');
  assert.deepStrictEqual(c.note, ['Pocket 1 (8mm): 4 steps, 5 to 8 mm · outlines 0.172–2.236 mm apart'], 'OFF: the 716 note');
  await shot('card-off.png', '#prepare-panel .cut-card');
  // ON (a real click on the checkbox): Medium
  await clickEl('.cut-adaptive');
  await waitFor(`document.querySelector('.cut-adaptive').checked && getComputedStyle(document.querySelector('.cut-row[data-row="stepDeviation"]')).display !== 'none'`, 'the Resolution row');
  c = await cardState();
  console.log('ON: ' + JSON.stringify(c));
  assert.deepStrictEqual([c.rows.slice(0, 3), c.resolution, c.presets], [['cutDepth', 'adaptiveSteps', 'stepDeviation'], '0.25', ['Coarse', 'Medium*', 'Fine']], 'ON: Resolution 0.25 mm, Medium active, no Step depth row');
  assert.deepStrictEqual(c.note, ['Pocket 1 (8mm): adaptive, Medium (0.25 mm): 7 steps at 6.193 · 6.69 · 7.071 · 7.386 · 7.67 · 7.925 · 8 mm · outlines 0.275–0.986 mm apart'], 'the Medium note');
  await shot('card-medium.png', '#prepare-panel .cut-card');
  // Coarse: card, Review, export
  await preset('0.5');
  c = await cardState();
  console.log('Coarse: ' + JSON.stringify(c.note));
  assert.deepStrictEqual(c.presets, ['Coarse*', 'Medium', 'Fine'], 'Coarse active');
  assert.ok(c.note[0].startsWith('Pocket 1 (8mm): adaptive, Coarse (0.5 mm): 4 steps at 6.651 · 7.333 · 7.843 · 8 mm'), 'the Coarse note');
  await shot('card-coarse.png', '#prepare-panel .cut-card');
  const exCoarse = await exportDepths();
  console.log('Coarse export: ' + JSON.stringify(exCoarse));
  assert.deepStrictEqual(exCoarse, ['6.651 mm', '7.333 mm', '7.843 mm', '8.000 mm'], 'Coarse export: 4 plain pockets');
  assert.deepStrictEqual(await reviewDepths(), exCoarse, 'Coarse: export == Review');
  let rev = await review(5);
  console.log('Coarse Review info: ' + JSON.stringify(rev));
  assert.ok(rev.includes(c.note[0]), 'the Review info has the card\'s text');
  await zoomReview();
  await shot('review-r3-coarse.png', '#review-canvas-host');
  await openStage('prepare');
  await clickWorld(60, -40);
  // Fine
  await preset('0.1');
  c = await cardState();
  console.log('Fine: ' + JSON.stringify(c.note));
  assert.deepStrictEqual(c.presets, ['Coarse', 'Medium', 'Fine*'], 'Fine active');
  assert.ok(/^Pocket 1 \(8mm\): adaptive, Fine \(0\.1 mm\): 16 steps at 5\.7\d* · 6\.0\d*/.test(c.note[0]), 'the Fine note');
  await shot('card-fine.png', '#prepare-panel .cut-card');
  const exFine = await exportDepths();
  console.log('Fine export: ' + JSON.stringify(exFine));
  assert.strictEqual(exFine.length, 16, 'Fine export: 16 plain pockets');
  assert.deepStrictEqual(await reviewDepths(), exFine, 'Fine: export == Review');
  rev = await review(17);
  console.log('Fine Review info: ' + JSON.stringify(rev));
  assert.ok(rev.includes(c.note[0]), 'the Review info has the card\'s text');
  await zoomReview();
  await shot('review-r3-fine.png', '#review-canvas-host');
  console.log('stepped-adaptive-717-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
