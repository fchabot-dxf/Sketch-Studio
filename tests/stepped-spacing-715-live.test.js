// tests/stepped-spacing-715-live.test.js — TASK 715: Min spacing + the Step depth / Min spacing preset rows in the real page (Fusion mode, adsk stubbed,
// the SA-7 drafted pocket): tap each preset -> the field, its highlight, the Review depths and the downloaded export follow; inches show fractions.
// Screenshots to .evidence/715/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
const EVIDENCE_DIR = path.resolve('.evidence/715');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');
const cdp = await launchBrowser({ tag: '715-stepped', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-715-dl-'));
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
const cardState = () => evalJs(`({ step: document.querySelector('.cut-step-depth').value, spacing: document.querySelector('.cut-step-spacing').value,
  stepLabels: [...document.querySelectorAll('.cut-row[data-row="stepDepth"] .cut-preset')].map((b) => b.textContent), stepActive: [...document.querySelectorAll('.cut-row[data-row="stepDepth"] .cut-preset.is-active')].map((b) => b.textContent),
  spacingLabels: [...document.querySelectorAll('.cut-row[data-row="stepSpacing"] .cut-preset')].map((b) => b.textContent), spacingActive: [...document.querySelectorAll('.cut-row[data-row="stepSpacing"] .cut-preset.is-active')].map((b) => b.textContent),
  bitActive: [...document.querySelectorAll('.cut-row[data-param="toolDia"] .cut-preset.is-active')].map((b) => b.textContent), note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);
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
const preset = (row, value) => clickEl(`.cut-row[data-row="${row}"] .cut-preset[data-value="${value}"]`);
try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the drafted pocket imported');
  await clickWorld(60, -40);
  await clickEl('#prepare-panel .cut-type-trigger');
  await clickEl('.cut-type-opt[data-id="stepped-pocket"]');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.cutType === 'stepped-pocket'))`, 'Stepped pocket set');
  // the card with the default 1/16 in spacing (mm document): both rows with their preset rows
  let c = await cardState();
  console.log('card: ' + JSON.stringify(c));
  assert.deepStrictEqual([c.step, c.spacing, c.stepLabels, c.spacingLabels], ['1.000', '1.5875', ['0.5', '1', '2', '3'], ['0', '0.5', '1', '2']], 'mm presets; spacing 1/16 in = 1.5875');
  assert.deepStrictEqual([c.stepActive, c.spacingActive, c.bitActive], [['1'], [], ['⅛']], 'Step 1 highlighted, 1.5875 matches no preset, the bit row still highlights 1/8');
  assert.deepStrictEqual(c.note, ['Pocket 1 (8mm): 1 step (spacing 1.5875 mm skips 7), 8 mm'], 'the note');
  await shot('card-presets-mm.png', '#prepare-panel .cut-card');
  assert.deepStrictEqual(await exportDepths(), ['8.000 mm'], 'export: ONE pocket');
  assert.deepStrictEqual(await reviewDepths(), ['8.000 mm'], 'Review: the same');
  const rev0 = await review(2);
  console.log('Review (1/16 in): ' + JSON.stringify(rev0));
  await zoomReview();
  await shot('review-spacing-default.png', '#review-canvas-host');
  await openStage('prepare');
  await clickWorld(60, -40);
  // tap each Min spacing preset: the field, the highlight, the Review, the export
  const seen = {};
  for (const v of ['0', '0.5', '1', '2']) {
    await preset('stepSpacing', v);
    c = await cardState();
    assert.deepStrictEqual([Number(c.spacing), c.spacingActive], [Number(v), [v]], `spacing preset ${v}: the field and the highlight`);
    const ex = await exportDepths();
    assert.deepStrictEqual(ex, await reviewDepths(), `spacing ${v}: export == Review`);
    seen[v] = ex;
    console.log(`spacing ${v}: ${JSON.stringify(ex)}  note ${JSON.stringify(c.note)}`);
  }
  assert.strictEqual(seen['0'].length, 8, 'spacing 0: all 8 steps');
  assert.ok(seen['0.5'].length < 8 && seen['1'].length < seen['0.5'].length && seen['2'].length <= seen['1'].length && seen['2'].at(-1) === '8.000 mm', 'a larger spacing keeps fewer steps, the floor always');
  // tap each Step depth preset (spacing 0: every step)
  await preset('stepSpacing', '0');
  for (const v of ['0.5', '1', '2', '3']) {
    await preset('stepDepth', v);
    c = await cardState();
    assert.deepStrictEqual([Number(c.step), c.stepActive], [Number(v), [v]], `step preset ${v}: the field and the highlight`);
    const ex = await exportDepths();
    assert.deepStrictEqual(ex, await reviewDepths(), `step ${v}: export == Review`);
    console.log(`step ${v}: ${ex.length} pockets ${JSON.stringify(ex)}`);
    assert.strictEqual(ex.length, Math.ceil(8 / Number(v)), `step ${v}: ${Math.ceil(8 / Number(v))} pockets`);
  }
  // typing still works
  await evalJs(`(() => { const i = document.querySelector('.cut-step-spacing'); i.value = '0.3'; i.dispatchEvent(new Event('change')); })()`);
  c = await cardState();
  assert.deepStrictEqual([c.spacing, c.spacingActive], ['0.3', []], 'a typed 0.3 matches no preset');
  await shot('card-presets-typed.png', '#prepare-panel .cut-card');
  const ex3 = await exportDepths();
  assert.deepStrictEqual(ex3, await reviewDepths(), 'step 3, spacing 0.3: export == Review');
  console.log('step 3 spacing 0.3: ' + JSON.stringify(ex3));
  const rev = await review(ex3.length + 1);
  console.log('Review (step 3, spacing 0.3): ' + JSON.stringify(rev));
  await zoomReview();
  await shot('review-spacing-typed.png', '#review-canvas-host');
  await openStage('prepare');
  await clickWorld(60, -40);
  // inches: the presets follow the document unit
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'in'))`);
  await preset('stepSpacing', String(25.4 / 16));
  c = await cardState();
  assert.deepStrictEqual([c.stepLabels, c.spacingLabels, c.spacingActive, c.spacing], [['1/32', '1/16', '1/8', '1/4'], ['0', '1/32', '1/16', '1/8'], ['1/16'], '0.0625'], 'inch presets; 1/16 active, field 0.0625');
  await shot('card-presets-in.png', '#prepare-panel .cut-card');
  console.log('stepped-spacing-715-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
