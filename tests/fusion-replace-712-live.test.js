// tests/fusion-replace-712-live.test.js — TASK 712 (owner ruling "Replace"): in the Fusion palette (Shaper ?host=fusion, window.adsk stubbed,
// selection_data through window.fusionJavaScriptHandler.handle) a selection REPLACES what the palette shows. Run at the palette's size (480 x 731)
// and on a desktop (1280 x 800), mouse:
//   1. a first selection; the user sets Pocket on it in the Prepare cut card (real clicks);
//   2. a second selection: only it shows (Prepare edges, sketches, CUT_PLAN), the notice says "Replaced with ...";
//   3. the footer Undo (a real click): the first selection with its Pocket; Ctrl+Y (a real key): the second again;
//   4. ONE payload with a body's regions AND sketch chains lands as one plan;
//   5. a reload in Fusion mode shows the last selection (the stored design);
//   6. (palette size only) an older pile-up: the normal Shaper app (no ?host) imports two SVG files by a drop, each a NEW sketch (unchanged), back in
//      Fusion mode the pile shows, the next selection replaces it whole, the footer Undo gives the whole pile back.
// Screenshot after step 2 at 480 x 731: .evidence/712/second-selection-480x731.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/712');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];
const msg = (name, regions, chains = [], kind = 'sketch', stock = null) => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind, name }, stock, regions, chains, warnings: [],
});
const FIRST = msg('Test plate', [{ id: 'r1', cutType: null, depthMm: null, outer: { closed: true, segments: rectSegs(0, 0, 40, 30) }, holes: [] }]);
const SECOND = msg('Body1', [
  { id: 'o', label: 'Outline', cutType: 'outside', depthMm: 12, outer: { closed: true, segments: rectSegs(100, 0, 30, 20) },
    holes: [{ closed: true, segments: [{ type: 'circle', cx: 115, cy: 10, r: 4 }] }] },
  { id: 'h', label: 'Hole', cutType: 'inside', depthMm: 12, outer: { closed: true, segments: [{ type: 'circle', cx: 115, cy: 10, r: 4 }] }, holes: [] },
], [], 'body', { thicknessMm: 12 });
const COMBINED = msg('Body2 + lines', [
  { id: 'o', cutType: 'outside', depthMm: 18, outer: { closed: true, segments: rectSegs(0, 0, 60, 40) },
    holes: [{ closed: true, segments: [{ type: 'circle', cx: 30, cy: 20, r: 5 }] }] },
  { id: 'h', cutType: 'inside', depthMm: 18, outer: { closed: true, segments: [{ type: 'circle', cx: 30, cy: 20, r: 5 }] }, holes: [] },
], [
  { id: 'c0', cutType: null, depthMm: null, closed: false, segments: [{ type: 'line', x1: 70, y1: 0, x2: 90, y2: 20 }, { type: 'line', x1: 90, y1: 20, x2: 110, y2: 0 }] },
  { id: 'c1', cutType: null, depthMm: null, closed: false, segments: [{ type: 'line', x1: 0, y1: 50, x2: 60, y2: 50, construction: true }] },
], 'body', { thicknessMm: 18 });
const SVG = (x) => `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="${x}" y="10" width="30" height="20" fill="none" stroke="#000"/></svg>`;

async function run({ width, height, pileUp }) {
  const label = `${width}x${height}`;
  const cdp = await launchBrowser({ tag: '712-fusion-replace', width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, flushAutosave, close } = cdp;
  const FUSION_URL = `http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`;
  const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64')); };
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
    assert.ok(p && p.onTop, `[${label}] ${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await mouse(p.x, p.y);
  };
  const clickWorld = async (x, y) => {
    const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
      const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
    await mouse(p.x, p.y);
  };
  const ctrlKey = async (key) => {
    const code = 'Key' + key.toUpperCase(), vk = key.toUpperCase().charCodeAt(0);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key, code, windowsVirtualKeyCode: vk });
  };
  const select = (payload) => evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(payload))})`);
  // what the palette shows: the notice, the Prepare edges, the sketches, the cut plan (key kind + cut type)
  const look = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => {
    const notice = document.getElementById('prepare-notice');
    return {
      notice: notice.hidden ? '' : notice.textContent,
      edges: document.querySelectorAll('#prepare-world-group .sk-edge').length,
      sketches: window.__designController.state.sketches.map((s) => s.name),
      shapes: window.__designController.state.shapes.length,
      plan: [...m.CUT_PLAN.entries()].map(([k, r]) => k.split(':')[0] + ':' + r.cutType).sort(),
    };
  })`);
  // the page's own pagehide flush writes its open tabs to the shared buffer (IndexedDB); wait until the buffer holds the drawing (n shapes) before leaving
  // the page (as tests/shared-tabs-684-live.test.js waits for the write to land)
  const leaveWhenStored = async (n) => {
    await flushAutosave();
    await waitFor(`import('/packages/ui/project-store.js').then((m) => m.getProjectStore().readBuffer({})).then((b) => !!b && b.tabs.some((t) => t.doc && t.doc.geometry && t.doc.geometry.shapes.length === ${n}))`,
      `the shared buffer to hold the ${n} shapes`);
  };
  const openFusion = async () => {
    await navigate(FUSION_URL);
    await waitForApp('design-canvas');
    await waitFor(`!!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  };
  try {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() {} };` });
    await openFusion();

    // 1. the first selection, and the user sets Pocket on it in the cut card
    await select(FIRST);
    await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 4`, 'the first selection in Prepare');
    const first = await look();
    console.log(`[${label}] first:`, JSON.stringify(first));
    assert.deepStrictEqual([first.notice, first.sketches, first.plan], ['Added Test plate: 1 regions, 0 chains', ['Sketch 1', 'Test plate'], ['loop:null']], `[${label}] the first selection`);
    await clickWorld(20, -15);
    await waitFor(`!!document.querySelector('#prepare-panel .cut-card') && !document.querySelector('#prepare-panel .cut-card').hidden`, 'the cut card for the plate');
    await clickEl('#prepare-panel .cut-type-trigger');
    await waitFor(`!!document.querySelector('.cut-type-opt[data-id="pocket"]') && document.querySelector('.cut-type-opt[data-id="pocket"]').getBoundingClientRect().width > 0`, 'the cut type menu');
    await clickEl('.cut-type-opt[data-id="pocket"]');
    await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.cutType === 'pocket'))`, 'Pocket set on the plate');

    // 2. the second selection replaces it
    await select(SECOND);
    await waitFor(`document.getElementById('prepare-notice').textContent.includes('Body1') && document.querySelectorAll('#prepare-world-group .sk-edge').length > 4`, 'the second selection in Prepare');
    const second = await look();
    console.log(`[${label}] second:`, JSON.stringify(second));
    if (width === 480) await shot('second-selection-480x731.png');
    assert.deepStrictEqual(second, { notice: 'Replaced with Body1: 2 regions, 0 chains', edges: 5, sketches: ['Sketch 1', 'Body1'], shapes: 5, plan: ['loop:exterior', 'loop:interior'] },
      `[${label}] only the second selection shows`);

    // 3. the footer Undo -> the first with its Pocket; Ctrl+Y -> the second
    await clickEl('#btn-undo');
    await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 4`, 'Undo: the first selection back');
    const undone = await look();
    console.log(`[${label}] undo:`, JSON.stringify(undone));
    assert.deepStrictEqual([undone.sketches, undone.shapes, undone.plan], [['Sketch 1', 'Test plate'], 4, ['loop:pocket']], `[${label}] Undo: the first selection with its Pocket`);
    await ctrlKey('y');
    await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 5`, 'Ctrl+Y: the second selection again');
    const redone = await look();
    assert.deepStrictEqual([redone.sketches, redone.shapes, redone.plan], [['Sketch 1', 'Body1'], 5, ['loop:exterior', 'loop:interior']], `[${label}] Ctrl+Y: the second selection`);

    // 4. one payload with a body's regions AND chains: one plan
    await select(COMBINED);
    await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 7`, 'the combined selection (7 edges)'); // TASK 757: 8 shapes, the construction line c1 is not drawn in Prepare
    const combined = await look();
    console.log(`[${label}] combined:`, JSON.stringify(combined));
    assert.deepStrictEqual(combined, { notice: 'Replaced with Body2 + lines: 2 regions, 2 chains', edges: 7, sketches: ['Sketch 1', 'Body2 + lines'], shapes: 8, plan: ['chain:null', 'loop:exterior', 'loop:interior'] },
      `[${label}] a body + chains payload lands as one plan`);

    // 5. a reload in Fusion mode shows the last selection (the stored design)
    await leaveWhenStored(8);
    await openFusion();
    await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 7`, 'after a reload: the last selection in Prepare');
    const reloaded = await look();
    console.log(`[${label}] reload:`, JSON.stringify(reloaded));
    assert.deepStrictEqual([reloaded.sketches, reloaded.plan], [['Sketch 1', 'Body2 + lines'], ['chain:null', 'loop:exterior', 'loop:interior']], `[${label}] a reload shows the last selection with its plan`);

    if (pileUp) {
      // 6. an older pile-up: made by the normal app's import (each drop a NEW sketch, unchanged), replaced whole by the next selection
      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
      await waitForApp('design-canvas');
      const drop = (name, text) => evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'image/svg+xml' }));
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
      const n0 = await evalJs(`window.__designController.state.sketches.map((s) => s.name)`);
      await drop('old-a.svg', SVG(10));
      await waitFor(`window.__designController.state.sketches.length === ${n0.length + 1}`, 'the first dropped SVG');
      await drop('old-b.svg', SVG(50));
      await waitFor(`window.__designController.state.sketches.length === ${n0.length + 2}`, 'the second dropped SVG');
      const pile = await evalJs(`({ sketches: window.__designController.state.sketches.map((s) => s.name), shapes: window.__designController.state.shapes.length })`);
      console.log(`[${label}] normal app import, pile:`, JSON.stringify(pile));
      assert.deepStrictEqual(pile.sketches, [...n0, 'old-a', 'old-b'], `[${label}] the normal Import SVG adds a NEW sketch each time, the earlier kept`);
      await leaveWhenStored(pile.shapes);
      await openFusion();
      await waitFor(`window.__designController.state.sketches.length === ${pile.sketches.length}`, 'the pile-up shown in Fusion mode');
      await select(SECOND);
      await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 5`, 'the selection replaces the pile-up');
      const afterPile = await look();
      console.log(`[${label}] selection over the pile:`, JSON.stringify(afterPile));
      assert.deepStrictEqual([afterPile.notice, afterPile.sketches, afterPile.shapes], ['Replaced with Body1: 2 regions, 0 chains', ['Sketch 1', 'Body1'], 5], `[${label}] the pile-up is replaced whole`);
      await clickEl('#btn-undo');
      await waitFor(`window.__designController.state.sketches.length === ${pile.sketches.length}`, 'Undo: the pile-up back');
      const back = await evalJs(`({ sketches: window.__designController.state.sketches.map((s) => s.name), shapes: window.__designController.state.shapes.length })`);
      assert.deepStrictEqual(back, pile, `[${label}] Undo gives the whole pile-up back`);
    }
    console.log(`[${label}] ok`);
  } finally {
    await close();
  }
}

await run({ width: 480, height: 731, pileUp: true });
await run({ width: 1280, height: 800, pileUp: false });
console.log('fusion-replace-712-live.test.js: ok');
