// tests/selection-mirror-795c-live.test.js — TASK 795c: Live CDP tests (desktop 1280x800 + phone 390x844) for SA-15 selection mirroring:
// two summary.items rows from one payload, Row X sending clear_selection { selectionId, group } without local deletion, stub re-send updating
// rows and leaving emptied op EMPTY, Undo sending restore_selection, Redo re-sending clear_selection, Clear all, and Stock-card edit as its own undo step.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/795c');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];

const INITIAL = {
  action: 'selection_data',
  version: 1,
  selectionId: 'sel-sa15-live',
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'face', name: 'Tray', documentName: 'Tray v1' },
  stock: { thicknessMm: 12 },
  summary: {
    mode: 'Faces',
    items: [
      { kind: 'face', count: 2, names: ['Tray'] },
      { kind: 'sloped-face', count: 4, names: ['Tray'] },
    ],
    text: 'Tray · 2 faces, 4 sloped faces',
  },
  regions: [
    { id: 'reg_0', label: 'Outline', cutType: 'outside', depthMm: 12, through: true, outer: { closed: true, segments: rectSegs(0, 0, 60, 40) }, holes: [] },
    { id: 'reg_1', label: 'Pocket 1 (8mm)', cutType: 'pocket', depthMm: 8, through: false, outer: { closed: true, segments: rectSegs(10, 10, 20, 15) }, holes: [] },
  ],
  chains: [],
  warnings: [],
};

const AFTER_X = {
  ...INITIAL,
  summary: {
    mode: 'Faces',
    items: [{ kind: 'face', count: 2, names: ['Tray'] }],
    text: 'Tray · 2 faces',
  },
  regions: [
    { id: 'reg_0', label: 'Outline', cutType: 'outside', depthMm: 12, through: true, outer: { closed: true, segments: rectSegs(0, 0, 60, 40) }, holes: [] },
  ],
};

async function run({ width, height }) {
  const label = `${width}x${height}`;
  const cdp = await launchBrowser({ tag: '795c-mirror', width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const url = `http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`;

  const mouseTo = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  const centre = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `[${label}] ${sel} visible and clickable: ${JSON.stringify(p)}`);
    return p;
  };
  const click = async (sel) => {
    const p = await centre(sel);
    await mouseTo(p.x, p.y);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const rowsInfo = () => evalJs(`[...document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel')].map((e) => ({ id: e.dataset.selectionId, group: e.dataset.group || null, text: e.querySelector('.shaper-fusion-sel-text').textContent }))`);
  const opsInfo = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((M) => M.storeOps().map((o) => ({ id: o.id, type: o.type, count: o.geometry.length })))`);
  const stockVal = () => evalJs(`import('/apps/shaper/src/stock.js').then((S) => S.getStock().thickness)`);
  const shot = async (name) => {
    const r = await evalJs(`(() => { const b = document.getElementById('shaper-fusion-bar').getBoundingClientRect(); return { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.ceil(b.width), height: Math.ceil(b.height + 14) }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot', path.join(EVIDENCE_DIR, name));
  };
  const pushSelection = (payload) => evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(payload))})`);

  try {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `if (new URLSearchParams(location.search).get('host') === 'fusion') {
        window.__sent = [];
        window.adsk = { fusionSendData(action, body) { window.__sent.push(JSON.parse(body)); } };
      }`,
    });
    await navigate(url);
    await waitForApp('design-canvas');
    await waitFor(`!!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'Fusion bar mounted');
    await waitFor(`window.__sent.some((s) => s.action === 'ping')`, 'boot ping');

    // 1. Send SA-15 payload with 2 summary.items rows.
    await pushSelection(INITIAL);
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 2`, '2 summary.items rows rendered');
    assert.deepStrictEqual(await rowsInfo(), [
      { id: 'sel-sa15-live', group: 'face', text: 'Tray · 2 faces' },
      { id: 'sel-sa15-live', group: 'sloped-face', text: 'Tray · 4 sloped faces' },
    ], `[${label}] rows mirror summary.items in order`);
    assert.ok(await evalJs(`!!document.getElementById('btn-fusion-clear-selections')`), `[${label}] Clear all shown`);
    await shot(`mirror-two-rows-${label}.png`);

    // 2. Click X on sloped-face row: must send clear_selection with group and NOT edit locally.
    await evalJs(`window.__sent.length = 0`);
    await click('.shaper-fusion-sel[data-group="sloped-face"] .shaper-fusion-sel-x');
    await mouseTo(2, height - 2);
    await waitFor(`window.__sent.some((s) => s.action === 'clear_selection')`, 'clear_selection sent');
    const afterClickSent = await evalJs(`window.__sent.filter((s) => s.action === 'clear_selection' || s.action === 'restore_selection')`);
    assert.deepStrictEqual(afterClickSent, [{ action: 'clear_selection', selectionId: 'sel-sa15-live', group: 'sloped-face' }], `[${label}] X sent group clear_selection`);
    assert.strictEqual((await rowsInfo()).length, 2, `[${label}] rows untouched before add-in re-send`);

    // 3. Stub sends AFTER_X: 1 row remains, pocket op stays EMPTY.
    await pushSelection(AFTER_X);
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 1`, '1 row after add-in response');
    assert.deepStrictEqual(await rowsInfo(), [{ id: 'sel-sa15-live', group: 'face', text: 'Tray · 2 faces' }]);
    const opsAfterX = await opsInfo();
    assert.strictEqual(opsAfterX.filter((o) => o.type === 'pocket')[0].count, 0, `[${label}] pocket op kept empty`);
    await shot(`mirror-after-x-${label}.png`);

    // 4. Undo -> sends restore_selection; stub re-sends INITIAL; Redo -> re-sends clear_selection with group.
    await evalJs(`window.__sent.length = 0`);
    await click('#btn-undo');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 2`, 'Undo restores 2 rows');
    const undoSent = await evalJs(`window.__sent.filter((s) => s.action === 'restore_selection' || s.action === 'clear_selection')`);
    assert.deepStrictEqual(undoSent, [{ action: 'restore_selection', selectionId: 'sel-sa15-live' }], `[${label}] Undo sent restore_selection`);
    await pushSelection(INITIAL);
    assert.strictEqual((await opsInfo()).filter((o) => o.type === 'pocket')[0].count, 1, `[${label}] pocket restored`);

    await evalJs(`window.__sent.length = 0`);
    await click('#btn-redo');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 1`, 'Redo re-applies clear');
    const redoSent = await evalJs(`window.__sent.filter((s) => s.action === 'clear_selection' || s.action === 'restore_selection')`);
    assert.deepStrictEqual(redoSent, [{ action: 'clear_selection', selectionId: 'sel-sa15-live', group: 'sloped-face' }], `[${label}] Redo sent clear_selection with group`);

    await click('#btn-undo');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 2`, 'Undo before Clear all');
    await pushSelection(INITIAL);

    // 5. Clear all + Undo
    await evalJs(`window.__sent.length = 0`);
    await click('#btn-fusion-clear-selections');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 0`, 'Clear all empties rows');
    assert.deepStrictEqual(await evalJs(`window.__sent.filter((s) => s.action === 'clear_selection')`), [{ action: 'clear_selection', selectionId: 'all' }]);
    await evalJs(`window.__sent.length = 0`);
    await click('#btn-undo');
    await waitFor(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length === 2`, 'Undo after Clear all restores rows');
    assert.deepStrictEqual(await evalJs(`window.__sent.filter((s) => s.action === 'restore_selection')`), [{ action: 'restore_selection', selectionId: 'sel-sa15-live' }]);

    // 6. Stock-card edit in Export (Review) has its own undo step.
    const goStage = async (tab) => {
      if (width <= 640) {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await click('.sk-sidebar-chevron');
        await waitFor(`(() => { const e = document.querySelector('.sk-sidebar-stage[data-tab="${tab}"]'); return !!e && e.getBoundingClientRect().left >= 0; })()`, 'sidebar drawer settled');
        await click(`.sk-sidebar-stage[data-tab="${tab}"]`);
      } else {
        await click(`.sk-header-tab[data-tab="${tab}"]`);
      }
      await waitFor(`!document.getElementById('view-${tab}').hidden`, `${tab} stage visible`);
    };
    await goStage('review');
    await evalJs(`(() => { const el = document.getElementById('review-stock-thickness'); el.value = '25 mm'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.strictEqual(await stockVal(), 25, `[${label}] stock changed to 25 mm`);
    await goStage('prepare');
    await click('#btn-undo');
    assert.strictEqual(await stockVal(), 12, `[${label}] Undo reverted stock thickness to 12 mm`);
    assert.strictEqual((await rowsInfo()).length, 2, `[${label}] earlier selection remained intact after undoing stock edit`);

    console.log(`[${label}] ok`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800 });
await run({ width: 390, height: 844 });
console.log('selection-mirror-795c-live: ok');
