// tests/fusion-polish-665-live.test.js — TASK 665: live CDP verification at 480x731 that
// (1) pong.lengthUnits sets session DOC_UNIT (mm in cut card) without overwriting normal Shaper's saved preference, and
// (2) Prepare frames the imported drawing clear of the floating cut card so no edge bbox intersects .cut-card.
// TASK S3: a click on the rectangle only selects it (no card); the card opens for the Pocket the toolbar's button makes (#op-type-pocket: a new operation, open).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/665');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '665-fusion-polish', width: 480, height: 731 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
}

// TASK S3: a button of Prepare's operations toolbar, pressed where it is on screen (it must be uncovered)
async function pressToolbar(id) {
  const p = await evalJs(`(() => { const b = document.getElementById('${id}'); const r = b.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && b.contains(hit) }; })()`);
  assert.ok(p.onTop, `#${id} is on screen and not covered: ${JSON.stringify(p)}`);
  await click(p.x, p.y);
}
async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

const realSketchPayload = {
  action: 'selection_data',
  version: 1,
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'sketch', name: 'Sketch1' },
  stock: { thicknessMm: null },
  regions: [
    {
      id: 'reg_0',
      label: 'Profile 1',
      cutType: null,
      depthMm: null,
      outer: {
        closed: true,
        segments: [
          { type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
          { type: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
          { type: 'line', x1: 40, y1: 30, x2: 0, y2: 30 },
          { type: 'line', x1: 0, y1: 30, x2: 0, y2: 0 },
        ],
      },
      holes: [
        { closed: true, segments: [{ type: 'circle', cx: 20, cy: 15, r: 5 }] },
      ],
    },
    {
      id: 'reg_1',
      label: 'Profile 2',
      cutType: null,
      depthMm: null,
      outer: {
        closed: true,
        segments: [{ type: 'circle', cx: 20, cy: 15, r: 5 }],
      },
      holes: [],
    },
  ],
  chains: [
    {
      id: 'chain_0',
      label: 'Chain 1',
      cutType: null,
      depthMm: null,
      closed: false,
      segments: [{ type: 'line', x1: 50, y1: 0, x2: 70, y2: 10 }],
    },
    {
      id: 'chain_1',
      label: 'Chain 2',
      cutType: null,
      depthMm: null,
      closed: false,
      segments: [{ type: 'line', x1: 0, y1: 15, x2: 40, y2: 15, construction: true }],
    },
  ],
  warnings: [],
};

try {
  // Seed saved user preference DOC_UNIT='in' BEFORE loading Fusion mode; persist this only once so navigating to normal
  // Shaper later reads the same localStorage value.
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await evalJs(`localStorage.setItem('sketch-studio-settings', JSON.stringify({ DOC_UNIT: 'in' }))`);
  await evalJs(`window.__installAdsk = true`);

  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.adsk = { _sent: [], fusionSendData(a, d) { this._sent.push({ a, d }); } };`,
  });

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'Fusion bar ready');

  // Pong with lengthUnits: 'mm'
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Plate v2', lengthUnits: 'mm' }))`);
  assert.strictEqual(await evalJs(`document.getElementById('shaper-fusion-status').textContent`), 'Connected to Fusion: Plate v2');

  // Import real selection
  await evalJs(`document.getElementById('btn-fusion-add-selection').click()`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(realSketchPayload))})`);
  await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 6`, '6 edge elements in Prepare'); // TASK 757: the construction line is not drawn in Prepare

  // Click rectangle region -> opens .cut-card
  const rectScreen = await evalJs(`(() => {
    const svg = document.getElementById('prepare-canvas');
    const pt = svg.createSVGPoint();
    pt.x = 6; pt.y = -6;
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
  await click(rectScreen.x, rectScreen.y);
  await waitFor(`window.__prepareView.selectedTargets().length === 1 && document.querySelector('#prepare-panel .cut-card').hidden`, 'the rectangle selected, no card (TASK S3)');
  await pressToolbar('op-type-pocket');
  await waitFor(`!document.getElementById('prepare-panel').hidden && !document.querySelector('#prepare-panel .cut-card').hidden`, 'cut card open');

  const check = await evalJs(`(() => {
    const card = document.querySelector('#prepare-panel .cut-card');
    const cr = card.getBoundingClientRect();
    const units = [...document.querySelectorAll('#prepare-panel .cut-unit')].map((el) => el.textContent);
    const edges = [...document.querySelectorAll('#prepare-world-group .sk-edge')].map((el) => {
      const r = el.getBoundingClientRect();
      const overlaps = !(r.right <= cr.left || r.left >= cr.right || r.bottom <= cr.top || r.top >= cr.bottom);
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, overlaps };
    });
    const stored = JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}');
    return {
      units,
      card: { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom },
      edges,
      maxEdgeRight: Math.max(...edges.map((e) => e.right)),
      minEdgeLeft: Math.min(...edges.map((e) => e.left)),
      storedUnit: stored.DOC_UNIT,
    };
  })()`);

  assert.ok(check.units.length >= 3, 'cut card unit labels present');
  assert.ok(check.units.every((u) => u === 'mm'), `cut card units are mm: ${JSON.stringify(check.units)}`);
  assert.strictEqual(check.storedUnit, 'in', 'saved user preference in localStorage remained in');
  assert.ok(check.minEdgeLeft >= 0, `leftmost edge visible (${check.minEdgeLeft}px)`);
  assert.ok(check.edges.every((e) => !e.overlaps), `no edge intersects .cut-card: maxEdgeRight=${check.maxEdgeRight}, cardLeft=${check.card.left}`);
  assert.ok(check.maxEdgeRight <= check.card.left, `every edge sits completely left of .cut-card (${check.maxEdgeRight} <= ${check.card.left})`);

  // Also test pong without lengthUnits keeps 'mm' unchanged
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', documentName: 'Plate v2' }))`);
  const unitsAfterBarePong = await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-unit')].map((el) => el.textContent)`);
  assert.ok(unitsAfterBarePong.every((u) => u === 'mm'), 'pong without lengthUnits leaves DOC_UNIT=mm unchanged');

  await shot('after-palette-480x731.png');

  // Verify normal Shaper still opens with user's saved 'in' preference (Fusion session did not overwrite it)
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  const normalUnit = await evalJs(`JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}').DOC_UNIT`);
  assert.strictEqual(normalUnit, 'in', 'normal Shaper localStorage still has DOC_UNIT=in');
  // Switch to Prepare, select imported loop, verify normal Shaper cut card displays 'in'
  await evalJs(`document.querySelector('[data-tab="prepare"]').click()`);
  await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length >= 1`, 'normal Shaper Prepare rendered');
  const normalRectPt = await evalJs(`(() => {
    const svg = document.getElementById('prepare-canvas');
    const pt = svg.createSVGPoint();
    pt.x = 6; pt.y = -6;
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
  await click(normalRectPt.x, normalRectPt.y);
  // (the Pocket left open in the Fusion phase is open again here: TASK S2, the tab's open operation; TASK S3: with none open, the toolbar makes one for the selection)
  if (await evalJs(`document.querySelector('#prepare-panel .cut-card').hidden`)) await pressToolbar('op-type-pocket');
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'normal Shaper cut card opens');
  const normalUnits = await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-unit')].map((el) => el.textContent)`);
  assert.ok(normalUnits.every((u) => u === 'in'), `normal Shaper cut card shows saved DOC_UNIT=in: ${JSON.stringify(normalUnits)}`);

  console.log('PASS fusion-polish-665-live:', JSON.stringify({
    cardLeft: Math.round(check.card.left),
    maxEdgeRight: Math.round(check.maxEdgeRight),
    fusionUnits: check.units,
    normalUnits,
  }));
} finally {
  await close();
}
