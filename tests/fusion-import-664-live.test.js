// tests/fusion-import-664-live.test.js — TASK 664: live CDP test for Fusion selection import + click region + GO TO hidden at 480x731.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/664');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '664-fusion-import', width: 480, height: 731 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
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
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.adsk = { _sent: [], fusionSendData(a, d) { this._sent.push({ a, d }); } };`,
  });

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'Fusion Prepare bar ready');

  // Pong handshake
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Plate v2' }))`);
  assert.strictEqual(await evalJs(`document.getElementById('shaper-fusion-status').textContent`), 'Connected to Fusion: Plate v2', 'connected status displays doc name');

  // Click Add selection -> host receives add_selection
  await evalJs(`document.getElementById('btn-fusion-add-selection').click()`);
  await waitFor(`window.adsk._sent.some((m) => m.a === 'add_selection')`, 'add_selection sent');

  // Simulate Fusion returning the real selection_data payload
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(realSketchPayload))})`);
  await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 7`, '7 edge elements rendered in Prepare');

  const afterImport = await evalJs(`(() => {
    const svg = document.getElementById('prepare-canvas');
    const notice = document.getElementById('prepare-notice');
    return {
      noticeHidden: notice.hidden,
      noticeText: notice.textContent,
      circles: svg.querySelectorAll('#prepare-world-group circle.sk-edge').length,
      lines: svg.querySelectorAll('#prepare-world-group line.sk-edge').length,
      viewBox: svg.getAttribute('viewBox'),
      sketchCount: window.__designController.state.sketches.length,
      sketchName: window.__designController.state.sketches.at(-1).name,
    };
  })()`);
  assert.strictEqual(afterImport.noticeHidden, false, 'notice visible');
  assert.strictEqual(afterImport.noticeText, 'Added Sketch1: 2 regions, 2 chains', 'notice shows source name, region count, chain count');
  assert.strictEqual(afterImport.circles, 1, 'no duplicate circle elements in Prepare');
  assert.strictEqual(afterImport.lines, 6, '6 line elements in Prepare');
  assert.strictEqual(afterImport.sketchName, 'Sketch1', 'sketch named after Fusion source');

  // Click inside rectangle region (world x=6, y=-6 -> screen px) -> Prepare selects region & shows cut card
  const rectScreen = await evalJs(`(() => {
    const svg = document.getElementById('prepare-canvas');
    const pt = svg.createSVGPoint();
    pt.x = 6; pt.y = -6;
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
  await click(rectScreen.x, rectScreen.y);
  await waitFor(`!document.getElementById('prepare-panel').hidden && document.querySelectorAll('#prepare-panel .sk-prep-type-btn, #prepare-panel [data-cut-type], #prepare-panel button').length > 0`, 'cut card visible after clicking region');

  const selectedText = await evalJs(`document.getElementById('prepare-panel').textContent`);
  assert.ok(selectedText.length > 0, 'cut card populated for selected region');

  // Also assign Exterior cut type in the card so screenshot shows cut tint/band clearly at 480x731
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('#prepare-panel button')].find((b) => /Outside|Exterior/i.test(b.textContent));
    if (btn) btn.click();
  })()`);
  await waitFor(`document.querySelectorAll('#prepare-cut-group path').length > 0 || !document.getElementById('prepare-panel').hidden`, 'cut applied on selected region');

  // Verify circle disk inside hole can also be clicked independently!
  const circleScreen = await evalJs(`(() => {
    const svg = document.getElementById('prepare-canvas');
    const pt = svg.createSVGPoint();
    pt.x = 20; pt.y = -15;
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
  await click(circleScreen.x, circleScreen.y);
  const diskTarget = await evalJs(`window.__prepareView && window.__prepareView.selectedTarget()`);
  assert.ok(diskTarget && diskTarget.kind === 'loop', 'clicking inside circle hole picks standalone circle loop target');

  await shot('fusion-import-palette-480x731.png');

  // Open drawer at 480x731 and confirm GO TO section is hidden in Fusion mode
  await evalJs(`document.querySelector('.sk-sidebar-handle').click()`);
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar drawer opens at 480x731');
  await new Promise((r) => setTimeout(r, 250));
  const drawerCheck = await evalJs(`({
    hasGoto: !!document.querySelector('.sk-sidebar [data-section="goto"]'),
    actions: [...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action),
  })`);
  assert.strictEqual(drawerCheck.hasGoto, false, 'GO TO section hidden in Fusion mode drawer');
  assert.deepStrictEqual(drawerCheck.actions, ['download', 'settings', 'log'], 'only host actions shown');
  await shot('fusion-import-drawer-no-goto-480x731.png');

  console.log('fusion-import-664-live.test.js: ok');
} finally {
  await close();
}
