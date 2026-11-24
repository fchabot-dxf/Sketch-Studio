// tests/noautocut-882-live.test.js — TASK 882 (owner turn 3530: "adding a selection from fusion shouldnt create toolpath ever"): in Fusion mode (?host=fusion, a fake
// window.adsk bridge as tests/fusion-mode-663-live.test.js), a body selection_data (an Outside outline + an Inside hole, each with Fusion's cutType / depthMm) adds its
// REGIONS to Prepare and makes NO operation: the Operations list is empty. Desktop 1280x800 and phone 390x844. Screenshots in .evidence/882/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/882');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const cdp = await launchBrowser({ tag: '882-noautocut', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

const rect = (x, y, w, h) => ({ closed: true, segments: [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y }, { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h }, { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
] });
const circ = { closed: true, segments: [{ type: 'circle', cx: 20, cy: 10, r: 4 }] };
const PAYLOAD = { action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { kind: 'body', name: 'Body1' },
  stock: { thicknessMm: 12 }, selectionId: 'sel-882',
  regions: [
    { id: 'o', label: 'Outline', cutType: 'outside', depthMm: 12, outer: rect(0, 0, 40, 20), holes: [circ] },
    { id: 'h', label: 'Hole', cutType: 'inside', depthMm: 12, outer: circ, holes: [] },
  ], chains: [], warnings: [] };

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
}

try {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.adsk = { _sent: [], fusionSendData(a, d) { this._sent.push({ action: a, data: d }); } };` });
  for (const phase of [{ name: 'desktop', w: 1280, h: 800, mobile: false }, { name: 'phone390', w: 390, h: 844, mobile: true }]) {
    await resetBufferLive({ port, navigate, waitFor }); // the four apps share one list of open tabs: a clean start per phase
    await send('Emulation.setDeviceMetricsOverride', { width: phase.w, height: phase.h, deviceScaleFactor: 1, mobile: phase.mobile });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
    await waitForApp('design-canvas');
    await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'Fusion Prepare bar mounted');
    await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0', documentName: 'Bracket v3' }))`);
    await evalJs(`document.getElementById('btn-fusion-add-selection').click()`);
    await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(PAYLOAD))})`);
    await waitFor(`document.querySelectorAll('.shaper-fusion-sel').length === 1`, `${phase.name}: the selection row is listed`);
    const st = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => ({ ops: m.storeOps().length, regions: m.regionKeys().length, types: m.regionKeys().map((k) => m.regionOf(k).source.cutType + ':' + m.regionOf(k).source.cutDepth).sort() }))`);
    const dom = await evalJs(`({ rows: document.querySelectorAll('#prepare-ops .ops-row').length, notice: document.getElementById('prepare-notice').textContent })`);
    assert.strictEqual(st.ops, 0, `${phase.name}: Add selection made 0 operations (store)`);
    assert.strictEqual(dom.rows, 0, `${phase.name}: the Operations list shows 0 rows`);
    assert.strictEqual(st.regions, 2, `${phase.name}: the 2 regions are in Prepare`);
    assert.deepStrictEqual(st.types, ['exterior:12', 'interior:12'], `${phase.name}: Fusion's cut type / depth kept as each region's source`);
    assert.strictEqual(dom.notice, 'Added Body1: 2 regions', `${phase.name}: the notice is the plain count`);
    await shot(`noautocut-${phase.name}.png`);
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  console.log('noautocut-882-live.test.js: ok');
} finally {
  await close();
}
