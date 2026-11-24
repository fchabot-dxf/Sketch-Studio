// tests/stepped-spacing-716-live.test.js — TASK 716: in the real page (Fusion mode, adsk stubbed, the SA-7 drafted pocket) the stepped card has NO Min spacing
// row; its note shows the outline spacing, in the warning colour (with a title) under 1/16 in; changing the Step depth updates note, colour, Review, export.
// Screenshots to .evidence/716/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { clickOpenLive, stepLive } from './helpers/prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed
import { fileSourceTypesAndRemount } from './helpers/file-fusion-types-live.js'; // TASK 882: a Fusion selection makes no operation: the set-up files the hinted types
const EVIDENCE_DIR = path.resolve('.evidence/716');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');
const cdp = await launchBrowser({ tag: '716-stepped', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-716-dl-'));
// a screenshot of the whole page, or of the box around the elements `sels` (one selector or several: the union of their boxes, 8 px margin)
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
};
// a real click on the element's centre, after checking nothing covers it there
const clickElRaw = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await mouse(p.x, p.y);
};
const clickWorldRaw = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await mouse(p.x, p.y);
};
// TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the steps of before S2 in today's terms (tests/helpers/prepare-open-live.js): a click on the canvas = OK on the open
// operation, the click, and the clicked shape's operation opened (it is in one); a press / a typed field that changes the open operation = its own step
const s2Steps = { get phone() { return false; }, evalJs, waitFor, clickEl: clickElRaw };
const clickEl = (sel) => stepLive(s2Steps, () => clickElRaw(sel));
const clickWorld = (x, y) => clickOpenLive(s2Steps, () => clickWorldRaw(x, y));
const openStage = async (id) => {
  await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`);
};
const menuIds = async () => {
  await clickEl('#prepare-panel .cut-type-trigger');
  await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the cut type menu');
  return evalJs(`[...document.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id)`);
};
// the Review, built: its levels (the relief's distinct depths) and its info lines
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
  for (let i = 0; i < 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -300 }); await sleep(150); }
  await sleep(300);
};
const cardState = () => evalJs(`({ step: document.querySelector('.cut-step-depth').value, minSpacingRow: !!document.querySelector('[data-row="stepSpacing"], .cut-step-spacing'),
  stepActive: [...document.querySelectorAll('.cut-row[data-row="stepDepth"] .cut-preset.is-active')].map((b) => b.textContent), note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent),
  warn: [...document.querySelectorAll('.cut-note-warn')].map((w) => ({ text: w.textContent, title: w.title, color: getComputedStyle(w).color })), noteColor: getComputedStyle(document.querySelector('.cut-note')).color })`);
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
const reviewDepths = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.planReliefItems(window.__designController.state).filter((i) => i.cutType === 'pocket').map((i) => i.cutDepth.toFixed(3) + ' mm'))`);
const preset = (row, value) => clickEl(`.cut-row[data-row="${row}"] .cut-preset[data-value="${value}"]`);
try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await fileSourceTypesAndRemount({ evalJs, waitFor }); // TASK 882: the import makes no operation: file the types Fusion hinted (what the old import did)
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the drafted pocket imported');
  await clickWorld(60, -40);
  await clickEl('#prepare-panel .cut-type-trigger');
  await clickEl('.cut-type-opt[data-id="roughing"]');
  await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.cutType === 'roughing'))`, 'Stepped pocket set');
  await clickEl('.cut-tab[data-tab="passes"]'); await sleep(150); // TASK 810: the Roughing card is tabbed: the Step depth row is in Passes (the card stays on it)
  // step 1: 8 steps, 0.18 mm apart, flagged
  let c = await cardState();
  console.log('card: ' + JSON.stringify(c));
  assert.strictEqual(c.minSpacingRow, false, 'the card has no Min spacing row');
  assert.deepStrictEqual(c.note, ['Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.176 mm apart'], 'the note shows the spacing');
  assert.strictEqual(c.warn.length, 1, 'the spacing part is flagged');
  assert.strictEqual(c.warn[0].title, 'outlines this close may be hard to pick on the Origin: try a bigger step', 'with its title');
  assert.notStrictEqual(c.warn[0].color, c.noteColor, `the warning colour differs from the note colour (${c.warn[0].color} vs ${c.noteColor})`);
  await shot('card-warn-step1.png', '#prepare-panel .cut-card');
  assert.deepStrictEqual(await exportDepths(), ['1.000 mm', '2.000 mm', '3.000 mm', '4.000 mm', '5.000 mm', '6.000 mm', '7.000 mm', '8.000 mm'], 'export: 8 pockets');
  assert.deepStrictEqual(await reviewDepths(), await exportDepths(), 'export == Review');
  const rev = await review(9);
  console.log('Review info: ' + JSON.stringify(rev));
  assert.ok(rev.includes('Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.176 mm apart'), 'the Review info has the same text');
  await zoomReview();
  await shot('review-step1.png', '#review-canvas-host');
  await openStage('prepare');
  await clickWorld(60, -40);
  // step 3: a range, still flagged; step 8: one step, no spacing, no flag
  await preset('stepDepth', '3');
  c = await cardState();
  console.log('step 3: ' + JSON.stringify(c.note) + ' ' + JSON.stringify(c.warn));
  assert.ok(/steps, 3 to 8 mm · outlines 0\.\d+–0\.\d+ mm apart/.test(c.note[0]) && c.warn.length === 1, 'step 3: a range, flagged');
  await shot('card-warn-step3.png', '#prepare-panel .cut-card');
  const ex3 = await exportDepths();
  assert.deepStrictEqual(ex3, await reviewDepths(), 'step 3: export == Review');
  await evalJs(`(() => { const i = document.querySelector('.cut-step-depth'); i.value = '8'; i.dispatchEvent(new Event('change')); })()`);
  c = await cardState();
  console.log('step 8: ' + JSON.stringify(c.note) + ' ' + JSON.stringify(c.warn));
  assert.deepStrictEqual([c.note, c.warn], [['Pocket 1 (8mm): 1 step, 8 mm'], []], 'step 8: one step, no spacing, no warning');
  await shot('card-nowarn-step8.png', '#prepare-panel .cut-card');
  assert.deepStrictEqual(await exportDepths(), ['8.000 mm'], 'step 8: export one pocket');
  // TASK 736: no minimum: a 0.05 mm bit and a 0.01 mm step depth are kept exactly, 0 is refused, the note follows
  await evalJs(`(() => { for (const [c, v] of [['.cut-bit', '0.05'], ['.cut-step-depth', '0.01']]) { const i = document.querySelector(c); i.value = v; i.dispatchEvent(new Event('change')); } })()`);
  const tiny = await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => { const r = [...m.V2_PLAN.values()].find((x) => x.cutType === 'roughing'); return [r.toolDia, r.stepDepth]; })`);
  assert.deepStrictEqual(tiny, [0.05, 0.01], 'a 0.05 mm bit and a 0.01 mm step depth are kept exactly');
  await evalJs(`(() => { const i = document.querySelector('.cut-step-depth'); i.value = '0'; i.dispatchEvent(new Event('change')); })()`);
  c = await cardState();
  console.log('step 0.01: ' + JSON.stringify(c.note) + ' ' + JSON.stringify(c.warn) + ' box ' + c.step);
  assert.strictEqual(c.step, '0.01', 'typing 0 is refused: the box shows the stored 0.01 again');
  assert.ok(c.note.length === 1 && /^Pocket 1 \(8mm\): \d+ steps?, /.test(c.note[0]), 'the note shows for the 0.01 mm step: ' + c.note[0]);
  await shot('card-tiny-736.png', '#prepare-panel .cut-card');
  // inches
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'in'))`);
  await preset('stepDepth', String(25.4 / 32));
  c = await cardState();
  console.log('inches: ' + JSON.stringify(c.note));
  assert.ok(/ in · outlines 0(?:\.\d+)?–0\.\d+ in apart/.test(c.note[0]), 'the note in inches');
  await shot('card-in.png', '#prepare-panel .cut-card');
  console.log('stepped-spacing-716-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
