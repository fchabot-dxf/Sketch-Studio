// tests/fusion-toolpaths-799-live.test.js — TASK 799 (SA-13): live CDP verification of automatic Fusion toolpaths
// sync in ?host=fusion: debounced single `toolpaths` event with ticked operations & real Z depths, loading spinner
// shown then hidden, edit+OK / untick / undo / remove selection -> toolpaths_clear, older add-in error ignored,
// and normal Shaper unchanged. Saves screenshots to .evidence/799/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/799');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '799-fusionpaths', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});

async function shot(name, sel = null, scale = 2) {
  const clip = sel ? await evalJs(`(() => {
    const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    return { x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 4), width: Math.max(1, r.width + 8), height: Math.max(1, r.height + 8), scale: ${scale} };
  })()`) : null;
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const outPath = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log('screenshot', outPath);
}

try {
  const stubSource = `(() => {
    const sent = [];
    window.adsk = {
      _sent: sent,
      _holdPromise: false,
      _resolveHold: null,
      fusionSendData(action, data) {
        sent.push({ action, payload: JSON.parse(data) });
        if (window.adsk._holdPromise && action === 'toolpaths') {
          return new Promise((res) => { window.adsk._resolveHold = res; });
        }
      },
    };
  })();`;
  const { identifier: stubId } = await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource });

  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('shaper-fusion-spin') && !!document.getElementById('btn-fusion-add-selection')`, 'Fusion Prepare bar and spinner mounted');

  // Boot state: spinner is hidden at rest.
  assert.strictEqual(await evalJs(`document.getElementById('shaper-fusion-spin').hidden`), true, 'spinner hidden at rest');

  // Send pong.
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Tray v1', lengthUnits: 'mm' }))`);
  await waitFor(`document.getElementById('shaper-fusion-status').textContent === 'Connected to Fusion: Tray v1'`, 'pong connected');

  // Hold promise on toolpaths briefly so we can capture the spinner reliably.
  await evalJs(`window.adsk._holdPromise = true`);

  const rectSegs = (x0, y0, x1, y1) => [
    { type: 'line', x1: x0, y1: y0, x2: x1, y2: y0 },
    { type: 'line', x1: x1, y1: y0, x2: x1, y2: y1 },
    { type: 'line', x1: x1, y1: y1, x2: x0, y2: y1 },
    { type: 'line', x1: x0, y1: y1, x2: x0, y2: y0 },
  ];
  const selPayload = {
    action: 'selection_data',
    version: 1,
    selectionId: 'sel-live-799',
    summary: { mode: 'Single Solid Body', items: [{ kind: 'body', count: 1, names: ['Tray'] }], text: 'Tray · top face' },
    units: 'mm',
    coordSystem: { yAxis: 'up', frame: 'plane-2d' },
    frame: { units: 'mm', yAxis: 'up', originMm: [0, 0, 19], uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1], topHeightMm: 19 },
    source: { kind: 'face', name: 'Tray', documentName: 'TrayDoc v1' },
    stock: { thicknessMm: 19 },
    regions: [
      { id: 'reg_0', label: 'Outline', cutType: 'outside', depthMm: 19, through: true, outer: { closed: true, segments: rectSegs(0, 0, 120, 80) }, holes: [] },
      { id: 'reg_1', label: 'Pocket 1 (8mm)', cutType: 'pocket', depthMm: 8, through: false, outer: { closed: true, segments: rectSegs(15, 15, 75, 65) }, holes: [] },
      { id: 'reg_2', label: 'Through Hole 1', cutType: 'inside', depthMm: 19, through: true, outer: { closed: true, segments: [{ type: 'circle', cx: 98, cy: 40, r: 8 }] }, holes: [] },
    ],
    chains: [],
    warnings: [],
  };

  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(selPayload))})`);

  // Immediately during debounce / in-flight send, spinner must be visible.
  await waitFor(`document.getElementById('shaper-fusion-spin').hidden === false && document.getElementById('shaper-fusion-bar').dataset.syncing === 'true'`, 'spinner visible while syncing');
  await shot('fusion-bar-spinner.png', '#shaper-fusion-bar', 2);

  // Wait for toolpaths event (debounced 300ms + worker finish), then resolve Fusion promise.
  await waitFor(`window.adsk._sent.some((m) => m.action === 'toolpaths')`, 'first toolpaths event sent after debounce');
  await evalJs(`window.adsk._holdPromise = false; if (window.adsk._resolveHold) window.adsk._resolveHold();`);
  await waitFor(`document.getElementById('shaper-fusion-spin').hidden === true`, 'spinner hides after Fusion send finishes');
  await shot('fusion-bar-synced.png', '#shaper-fusion-bar', 2);

  const tp1 = await evalJs(`window.adsk._sent.filter((m) => m.action === 'toolpaths')`);
  assert.strictEqual(tp1.length, 1, 'exactly ONE toolpaths event after debounce');
  assert.strictEqual(tp1[0].payload.revision, 1, 'revision 1');
  assert.strictEqual(tp1[0].payload.frame.topHeightMm, 19, 'frame topHeightMm preserved');
  assert.ok(tp1[0].payload.paths.some((p) => p.cutType === 'pocket' && p.z === 8 && p.toolDia === 3.175 && p.clearing === 'freehand' && p.role === 'wall'), 'pocket path at z=8 with toolDia, clearing=freehand, role=wall');
  assert.ok(tp1[0].payload.paths.some((p) => p.cutType === 'interior' && p.z === 19 && p.toolDia === 3.175 && p.clearing === undefined && p.role === 'outline'), 'hole path at z=19 with toolDia, role=outline');
  assert.ok(tp1[0].payload.paths.some((p) => p.cutType === 'exterior' && p.z === 19 && p.toolDia === 3.175 && p.clearing === undefined && p.role === 'outline'), 'outline path at z=19 with toolDia, role=outline');

  // Untick Pocket in Prepare Operations list -> debounced ONE toolpaths event with ticked operations only!
  const pocketId = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'pocket').id)`);
  await evalJs(`window.adsk._sent.length = 0`);
  await evalJs(`document.querySelector('#prepare-ops .ops-row[data-id="${pocketId}"] .ops-tick').click()`);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'toolpaths')`, 'toolpaths sent after untick');
  await sleep(100);
  const tp2 = await evalJs(`window.adsk._sent.filter((m) => m.action === 'toolpaths')`);
  assert.strictEqual(tp2.length, 1, 'untick sends one toolpaths event');
  assert.strictEqual(tp2[0].payload.revision, 2, 'revision 2');
  assert.ok(!tp2[0].payload.paths.some((p) => p.op === pocketId), 'unticked pocket omitted');
  assert.ok(tp2[0].payload.paths.length >= 2, 'ticked hole and outline kept');

  // Undo -> restores pocket!
  await evalJs(`window.adsk._sent.length = 0`);
  await evalJs(`document.getElementById('btn-undo').click()`);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'toolpaths')`, 'toolpaths sent after undo');
  const tp3 = await evalJs(`window.adsk._sent.filter((m) => m.action === 'toolpaths')`);
  assert.strictEqual(tp3[0].payload.revision, 3, 'revision 3');
  assert.ok(tp3[0].payload.paths.some((p) => p.op === pocketId), 'undo restores pocket toolpath');

  // Edit Pocket -> Spiral clearing + OK -> clearing lines + start mark cross sent!
  await evalJs(`window.adsk._sent.length = 0`);
  await evalJs(`(() => {
    document.querySelector('#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick').click();
    document.querySelector('#prepare-ops .ops-row[data-id="${pocketId}"] .ops-edit').click();
    document.querySelector('.cut-clear-trigger').click();
    document.querySelector('.cut-clear-opt[data-clearing="linked"]').click();
    document.querySelector('.cut-ok').click();
  })()`);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'toolpaths')`, 'toolpaths sent after Spiral + OK');
  const tp4 = await evalJs(`window.adsk._sent.filter((m) => m.action === 'toolpaths')`);
  assert.strictEqual(tp4[0].payload.revision, 4, 'revision 4');
  assert.strictEqual(tp4[0].payload.paths.filter((p) => p.op === pocketId && p.cutType === 'guide' && p.points.length === 2 && p.clearing === 'linked' && p.role === 'start').length, 2, 'pocket start mark cross sent with clearing=linked and role=start');
  assert.ok(tp4[0].payload.paths.some((p) => p.op === pocketId && p.cutType === 'pocket' && p.clearing === 'linked' && p.role === 'clearing'), 'spiral clearing path sent with clearing=linked and role=clearing');
  assert.ok(tp4[0].payload.paths.some((p) => p.op === pocketId && p.cutType === 'pocket' && p.clearing === 'linked' && p.role === 'wall'), 'spiral wall path sent with clearing=linked and role=wall');

  // Older add-in replying Unknown action for toolpaths -> no error banner shown.
  await evalJs(`document.getElementById('prepare-notice').hidden = true; document.getElementById('prepare-notice').textContent = '';`);
  await evalJs(`window.fusionJavaScriptHandler.handle('error', JSON.stringify({ action: 'error', receivedAction: 'toolpaths', message: "Unknown action: 'toolpaths'" }))`);
  assert.strictEqual(await evalJs(`document.getElementById('prepare-notice').hidden`), true, 'older add-in Unknown action error for toolpaths stays hidden');

  // Remove selection via X button -> add-in echoes empty selection_data -> design empties -> toolpaths_clear sent!
  await evalJs(`window.adsk._sent.length = 0`);
  await evalJs(`document.querySelector('.shaper-fusion-sel-x').click()`);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'clear_selection')`, 'clear_selection sent');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', JSON.stringify({
    action: 'selection_data', version: 1, selectionId: 'sel-live-799',
    summary: { mode: 'Single Solid Body', items: [], text: '' },
    units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
    source: { kind: 'unsupported', name: '', documentName: 'TrayDoc v1' },
    stock: null, regions: [], chains: [], warnings: [],
  }))`);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'toolpaths_clear')`, 'toolpaths_clear sent when design empties');
  const clears = await evalJs(`window.adsk._sent.map((m) => m.action)`);
  assert.ok(clears.includes('clear_selection') && clears.includes('toolpaths_clear'), 'both clear_selection and toolpaths_clear sent');

  // Normal Shaper (no ?host=fusion) has no Fusion spinner and sends nothing.
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  assert.strictEqual(await evalJs(`document.getElementById('shaper-fusion-spin')`), null, 'no Fusion spinner outside Fusion mode');

  assert.deepStrictEqual(problems, [], 'no console errors or uncaught exceptions');
  console.log('fusion-toolpaths-799-live: ok');
} finally {
  await close();
}
