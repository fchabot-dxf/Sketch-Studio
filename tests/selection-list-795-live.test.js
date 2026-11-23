// tests/selection-list-795-live.test.js — TASK 795: the SELECTION LIST in the Fusion palette (Shaper ?host=fusion, window.adsk.fusionSendData a recorder). Two selections
// (selection_data with selectionId + summary, through window.fusionJavaScriptHandler.handle) are ADDED and listed in Prepare's bar; a real hover on a row and leaving it
// send nothing to Fusion (TASK 865); a real click on a row's X removes that selection (clear_selection(id)); Clear all (from two rows) removes
// every one (clear_selection('all')); the footer Undo brings it back and sends nothing. Desktop (1280 x 800) and phone (390 x 844).
// Screenshots (the bar, cropped): .evidence/795/list-<w>x<h>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/795');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];
const msg = (name, id, text, regions, stock = null) => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'body', name }, stock, regions, chains: [], warnings: [], selectionId: id, summary: { mode: 'Faces', items: [], text },
});
const A = msg('Tray', 'sel-A', 'Tray · top face', [{ id: 'o', cutType: 'outside', depthMm: 12, outer: { closed: true, segments: rectSegs(0, 0, 60, 40) }, holes: [] }], { thicknessMm: 12 });
const B = msg('Tray', 'sel-B', 'Tray · 4 sloped faces', [{ id: 'p', cutType: 'pocket', depthMm: 6, outer: { closed: true, segments: rectSegs(80, 0, 30, 20) }, holes: [] }]);

async function run({ width, height }) {
  const label = `${width}x${height}`;
  const cdp = await launchBrowser({ tag: '795-selection-list', width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const url = `http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`;
  const mouseTo = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  const centre = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, onTop: !!hit && (hit === e || e.contains(hit)), hit: hit ? hit.tagName + '#' + hit.id + '.' + hit.className : null }; })()`);
    assert.ok(p && p.onTop, `[${label}] ${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    return p;
  };
  const click = async (sel) => {
    const p = await centre(sel);
    await mouseTo(p.x, p.y);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const sent = () => evalJs(`window.__sent.map((s) => s.action + ':' + (s.selectionId === undefined ? '' : s.selectionId))`);
  const rowsText = () => evalJs(`[...document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel-text')].map((e) => e.textContent)`);
  const shot = async (name) => {
    const r = await evalJs(`(() => { const b = document.getElementById('shaper-fusion-bar').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  };
  const select = (payload) => evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(payload))})`);
  try {
    // window.__sent = what the selection list sends. TASK 799's live toolpaths sync ('toolpaths' / 'toolpaths_clear', debounced after every import / plan
    // change, checked by fusion-toolpaths-799-*) is a separate channel: left out, so it can never land inside these exact-sends checks (795d: 1 run in 7 did).
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') { window.__sent = []; window.adsk = { fusionSendData(action, body) { const m = JSON.parse(body); if (m.action !== 'toolpaths' && m.action !== 'toolpaths_clear') window.__sent.push(m); } }; }` });
    await navigate(url);
    await waitForApp('design-canvas');
    await waitFor(`!!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
    await waitFor(`window.__sent.some((s) => s.action === 'ping')`, 'the boot ping');
    await evalJs(`window.__sent.length = 0`);

    await select(A);
    await select(B);
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 2`, 'two rows');
    assert.deepStrictEqual(await rowsText(), ['Tray · top face', 'Tray · 4 sloped faces'], `[${label}] the rows are the summaries`);
    assert.ok(await evalJs(`!!document.getElementById('btn-fusion-clear-selections')`), `[${label}] Clear all shows with two rows`);
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), 8, `[${label}] both selections are in the design`);
    await shot(`list-${label}.png`);

    // a real hover on the first row, then off it sends nothing to Fusion (TASK 865)
    const row = await centre('.shaper-fusion-sel[data-selection-id="sel-A"] .shaper-fusion-sel-text');
    await mouseTo(row.x, row.y);
    await waitFor(`!!document.querySelector('.shaper-fusion-sel[data-selection-id="sel-A"]:hover')`, 'row hovered');
    await mouseTo(2, height - 2);
    await waitFor(`!document.querySelector('.shaper-fusion-sel:hover')`, 'pointer left the row');
    assert.deepStrictEqual(await sent(), [], `[${label}] hover and leaving send nothing to Fusion`);

    // the X of the first row (a real click)
    await evalJs(`window.__sent.length = 0`);
    await click('.shaper-fusion-sel[data-selection-id="sel-A"] .shaper-fusion-sel-x');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 1`, 'one row after the X');
    assert.deepStrictEqual(await rowsText(), ['Tray · 4 sloped faces'], `[${label}] the X removed the first selection`);
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), 4, `[${label}] its geometry is gone`);
    assert.ok(!(await sent()).includes('clear_selection:sel-B'), `[${label}] only A was cleared`);
    assert.ok((await sent()).includes('clear_selection:sel-A'), `[${label}] the X sent clear_selection(sel-A): ${JSON.stringify(await sent())}`);
    assert.ok(await evalJs(`!document.getElementById('btn-fusion-clear-selections')`), `[${label}] Clear all is hidden with one row`);

    // move off the list before testing Undo so no hover state lingers
    await mouseTo(2, height - 2);
    await waitFor(`!document.querySelector('.shaper-fusion-sel:hover')`, 'the pointer left the list');

    // the footer Undo: the row is back, nothing is sent
    await evalJs(`window.__sent.length = 0`);
    await click('#btn-undo');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 2`, 'Undo: two rows');
    assert.deepStrictEqual(await sent(), [], `[${label}] Undo sends nothing to Fusion`);
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), 8, `[${label}] Undo: the geometry is back`);

    // Clear all (a real click)
    await click('#btn-fusion-clear-selections');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 0`, 'no rows after Clear all');
    assert.deepStrictEqual(await sent(), ['clear_selection:all'], `[${label}] Clear all sends clear_selection(all)`);
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), 0, `[${label}] the design is empty`);
    console.log(`[${label}] ok`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800 });
await run({ width: 390, height: 844 });
console.log('selection-list-795-live: ok');
