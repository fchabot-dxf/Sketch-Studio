// tests/stepped-cut-714-live.test.js — TASK 714: the STEPPED cut types in the real page, in Fusion mode (Shaper ?host=fusion, window.adsk stubbed, the
// advisor's live SA-7 payloads (tests/fixtures/sa7-slope) through window.fusionJavaScriptHandler.handle('selection_data') as the add-in sends them),
// with real mouse clicks on the Prepare canvas and the cut card:
//   1. the 10-degree drafted pocket (02): the Review with the pocket as imported (Pocket, straight) -> screenshot straight;
//   2. Prepare: the cut menu offers Stepped pocket on the pocket (not on the outline); pick it -> the card shows the Step depth row (1) and the note;
//      the Review shows 8 terraces (its levels: 1..8 + the through outline) -> screenshot stepped; its info says the steps;
//   3. the Export step's Generate Shaper SVG: the downloaded file holds the outline + 8 PLAIN pockets at 1..8 mm;
//   4. the outline chamfered top and bottom (x2): Stepped outside -> the Review (2 outside cuts: 1 mm, then 0..120 through) and its undercut note.
// Screenshots (.evidence/714/): review-drafted-straight.png, review-drafted-stepped.png, prepare-stepped-menu.png, prepare-stepped-card.png,
// review-x2-stepped-outside.png; the downloaded export: export-drafted-stepped.svg.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { clickOpenLive, stepLive } from './helpers/prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed
import { reviewBuilt } from './helpers/review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)
import { pressExportAction } from './helpers/export-actions.js'; // TASK 880: the Export actions are the header's (the drawer's on a phone)

const EVIDENCE_DIR = path.resolve('.evidence/714');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '714-stepped', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-714-dl-'));

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
const plan = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].map((r) => ({ cutType: r.cutType, stepDepth: r.stepDepth ?? null, slope: r.slope ? r.slope.kind : null })))`);
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
  await waitFor(reviewBuilt({ levels: expectLevels }), `the Review built with ${expectLevels} levels`);
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

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // 1. the drafted pocket as imported: Pocket (straight)
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the drafted pocket imported');
  const imported = await plan();
  console.log('imported plan: ' + JSON.stringify(imported));
  assert.deepStrictEqual(imported, [{ cutType: 'exterior', stepDepth: null, slope: null }, { cutType: 'pocket', stepDepth: null, slope: 'pocket' }], 'the pocket stays Pocket (straight), with its slope');
  const straightInfo = await review(2);
  console.log('Review (straight): ' + JSON.stringify(straightInfo));
  await zoomReview();
  await shot('review-drafted-straight.png', '#review-canvas-host');

  // 2. Prepare: Stepped pocket is offered on the pocket only; pick it
  await openStage('prepare');
  await clickWorld(10, -10); // the outline (no slope)
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'the cut card for the outline');
  const outlineMenu = await menuIds();
  assert.ok(!outlineMenu.some((id) => id.startsWith('stepped')), 'no stepped type on the outline (no slope): ' + outlineMenu);
  assert.strictEqual(await evalJs(`document.querySelector('.cut-type-menu').getBoundingClientRect().width`), 134, 'a menu without a stepped type keeps its 134 px width (TASK 805: the rows are one line again, the 220 px of the laid-out hints (TASK 770) is gone; .cut-type-menu min-width 134)');
  await clickEl('#prepare-panel .cut-type-trigger'); // close
  await clickWorld(60, -40); // the pocket
  const pocketMenu = await menuIds();
  assert.deepStrictEqual(pocketMenu, ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock'] /* TASK S2: the Contour in the menus */, 'the sloped pocket: Stepped pocket after Pocket');
  await shot('prepare-stepped-menu.png', ['#prepare-panel .cut-card', '.cut-type-menu']);
  const wide = await evalJs(`(() => { const m = document.querySelector('.cut-type-menu').getBoundingClientRect(), o = document.querySelector('.cut-type-opt[data-id="roughing"] .cut-opt-name'); return { menu: m.width, oneLine: o.getBoundingClientRect().height <= 22 }; })()`);
  console.log('menu with Stepped pocket: ' + JSON.stringify(wide));
  assert.ok(wide.menu >= 134 && wide.oneLine, 'the menu grows to keep "stepped pocket" on one line');
  await clickEl('.cut-type-opt[data-id="roughing"]');
  await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.cutType === 'roughing'))`, 'Stepped pocket set');
  await clickEl('.cut-tab[data-tab="passes"]'); await sleep(150); // TASK 810: the Roughing card is tabbed: the Step depth row is in Passes
  const card = await evalJs(`({ type: document.querySelector('.cut-type-cur').textContent, step: document.querySelector('.cut-step-depth').value,
    stepShown: !('off' in document.querySelector('.cut-row[data-row="stepDepth"]').dataset), note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);
  console.log('card: ' + JSON.stringify(card));
  assert.deepStrictEqual(card, { type: 'Roughing', step: '1', stepShown: true, note: ['Pocket 1 (8mm): 8 steps, 1 to 8 mm \u00b7 outlines 0.176 mm apart'] }, 'the card: Stepped pocket, Step depth 1, the note');
  await shot('prepare-stepped-card.png');
  const steppedInfo = await review(9);
  console.log('Review (stepped): ' + JSON.stringify(steppedInfo));
  assert.ok(steppedInfo.includes('Pocket 1 (8mm): 8 steps, 1 to 8 mm \u00b7 outlines 0.176 mm apart'), 'the Review info says the steps');
  const levels = await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.planReliefItems(window.__designController.state).map((i) => i.cutType + '@' + i.cutDepth))`);
  assert.deepStrictEqual(levels, ['exterior@19', 'pocket@1', 'pocket@2', 'pocket@3', 'pocket@4', 'pocket@5', 'pocket@6', 'pocket@7', 'pocket@8'], 'the Review input: 8 terrace pockets');
  await zoomReview();
  await shot('review-drafted-stepped.png', '#review-canvas-host');

  // 3. Generate Shaper SVG: the outline + 8 plain pockets
  await pressExportAction({ evalJs, waitFor }, clickEl, 'btn-generate-svg');
  let file = null;
  for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  const svg = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'export-drafted-stepped.svg'), svg);
  const els = [...svg.matchAll(/<(path|circle) [^>]*shaper:cutType="([^"]+)"[^>]*shaper:cutDepth="([^"]+)"/g)].map((m) => `${m[2]} ${m[3]}`);
  console.log('EXPORT ' + JSON.stringify(els));
  assert.deepStrictEqual(els, ['outside 19.000 mm', ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `pocket ${k}.000 mm`)], 'the export: the outline + 8 plain pockets at 1..8 mm');

  // 4. the outline chamfered top and bottom: Stepped outside, the undercut cut straight
  await openStage('prepare');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('x2-outline-chamfer-top-bottom'))})`);
  await waitFor(`/Replaced with Body1: 1 region/.test(document.getElementById('prepare-notice').textContent)`, 'x2 imported');
  await clickWorld(60, -40);
  const x2Menu = await menuIds();
  assert.ok(x2Menu.includes('roughing') && !x2Menu.some((id) => id.startsWith('stepped')), 'x2 outline: Roughing (TASK 792: in place of Stepped outside): ' + x2Menu);
  await clickEl('.cut-type-opt[data-id="roughing"]');
  await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.cutType === 'roughing'))`, 'Stepped outside set');
  const x2Info = await review(2);
  console.log('Review (x2 stepped outside): ' + JSON.stringify(x2Info));
  assert.ok(x2Info.includes('Outline: 2 steps, 1 to 19 mm \u00b7 outlines 1 mm apart') && x2Info.includes('Outline: undercut below 17 mm cut straight'), 'the Review says the steps and the undercut');
  await zoomReview();
  await shot('review-x2-stepped-outside.png', '#review-canvas-host');
  console.log('stepped-cut-714-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
