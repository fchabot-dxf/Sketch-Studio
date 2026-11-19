// tests/leadin-arc-778-fusion-live.test.js — TASK 778, Fusion mode (?host=fusion, window.adsk stubbed, SA-7 drafted-pocket payload):
//  - Pocket with Spiral + Loop ON: NO Lead-in row, 1 .sk-pocket-start target, closed loop + guide start mark
//  - Outline switched to On line with Lead-in On: tangential arc, calculated defaults, draggable handle works in Fusion mode
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { sleep } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/778');
const t = await openPocketPage({
  tag: '778-fusion',
  fusion: true,
  evidenceDir: EVIDENCE_DIR,
});
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

try {
  const { send, evalJs, waitFor, setUnit, clickEl, clickWorld, pickClearing, setLoop, pickType, shotWorld, shot, fileElements } = t;
  await setUnit('mm');
  await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
  const payload = fs.readFileSync(new URL('./fixtures/sa7-slope/02-drafted-pocket.json', import.meta.url), 'utf8');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(payload)})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: drafted pocket imported');

  // Pocket: Spiral + Loop ON -> no Lead-in row, 1 start mark
  await clickWorld(60, -40);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion pocket card');
  await pickClearing('linked');
  await setLoop(true);
  assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-row[data-row="leadIn"]')).display`), 'none', 'Fusion pocket: no Lead-in row');
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-pocket-start').length`), 1, 'Fusion pocket: 1 start mark');
  await shotWorld('fusion-pocket-start.png', [24, -66, 96, -14], 2);

  // Outline: On line -> Lead-in On -> tangential arc + draggable handle
  await clickWorld(10, -10);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Outside'`, 'Fusion outline card');
  await pickType('online');
  await clickEl('#prepare-panel .cut-row[data-row="leadIn"] .cut-preset[data-value="true"]');
  await sleep(200);
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-lead-leg').length`), 1, 'Fusion outline: arc drawn');
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-canvas .sk-lead-handle').length`), 1, 'Fusion outline: draggable handle shown');
  const h0 = await evalJs(`(() => { const r = document.querySelector('#prepare-canvas .sk-lead-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  await mouse('mouseMoved', h0.x, h0.y);
  await mouse('mousePressed', h0.x, h0.y, 1);
  await sleep(50);
  await mouse('mouseMoved', h0.x + 35, h0.y, 1);
  await sleep(80);
  await mouse('mouseReleased', h0.x + 35, h0.y, 0);
  await sleep(200);
  assert.strictEqual(await evalJs(`document.querySelector('.cut-pos-state').textContent`), 'moved', 'Fusion drag moves Position to moved');
  await shot('fusion-card-arc.png', '#prepare-panel .cut-card', 2);
  await shotWorld('fusion-outline-arc.png', [-12, -92, 132, 12], 2);

  const svg = await evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/apps/shaper/src/cut-plan.js').then((C) => m.shaperSvgOf(window.__designController.state, C.cutPlanEntries())))`);
  const els = fileElements(svg);
  const online = els.filter((e) => e[2] === 'online'), guides = els.filter((e) => e[2] === 'guide');
  assert.ok(online.length === 2 && online.filter((e) => /Z$/.test(e[1])).length === 1 && online.filter((e) => !/Z$/.test(e[1]) && e[1].includes(' A ')).length === 1 && guides.length === 1,
    'Fusion SVG: 1 closed pocket loop + 1 open arc outline + 1 guide start mark');
  console.log('leadin-arc-778-fusion-live: ok');
} finally {
  await t.close();
}
