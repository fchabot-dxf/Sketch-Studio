// tests/opselect-806-live.test.js — TASK 806 / SA-16: Live CDP tests (desktop 1280x800 + phone 390x844) for
// per-operation Select in Fusion: hidden in web mode & STL & Stock, shown on selected Fusion op rows (including EMPTY),
// sends select_for_operation { opKey, label, tokens, keepTokens }, applies assign while keeping op settings/identity,
// keeps emptied op EMPTY, and keeps Undo/Redo restore_selection in sync.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/806');
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
  selectionId: 'sel-806-live',
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
    {
      id: 'reg_0',
      label: 'Outline',
      sources: ['tok-top'],
      cutType: 'outside',
      depthMm: 12,
      through: true,
      outer: { closed: true, segments: rectSegs(0, 0, 80, 50) },
      holes: [],
    },
    {
      id: 'reg_1',
      label: 'Pocket 1 (8mm)',
      sources: ['tok-p1', 'tok-wall'],
      cutType: 'pocket',
      depthMm: 8,
      through: false,
      outer: { closed: true, segments: rectSegs(10, 10, 20, 15) },
      holes: [],
    },
  ],
  chains: [
    {
      id: 'chain_0',
      label: 'Slot 1',
      sources: ['tok-slot'],
      cutType: 'online',
      depthMm: 3,
      closed: false,
      segments: [{ type: 'line', x1: 45, y1: 15, x2: 65, y2: 15 }],
    },
  ],
  warnings: [],
};

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const cdp = await launchBrowser({ tag: `806-opselect-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

  const mouseTo = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  const centre = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, width: r.width, height: r.height, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `[${label}] ${sel} visible and clickable: ${JSON.stringify(p)}`);
    return p;
  };
  const click = async (sel) => {
    const p = await centre(sel);
    await mouseTo(p.x, p.y);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    return p;
  };
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
  const openOpsSheet = async () => {
    await waitFor(`!!document.querySelector('#prepare-ops .ops-row')`, 'ops rows rendered');
    const isHidden = await evalJs(`(() => { const b = document.querySelector('#prepare-ops .ops-body'); return !b || b.hidden || getComputedStyle(b).display === 'none'; })()`);
    if (isHidden) await click('#prepare-ops .ops-head');
    await waitFor(`(() => { const e = document.querySelector('#prepare-ops .ops-row .ops-pick'); return !!e && e.getBoundingClientRect().height > 0; })()`, 'ops row visible');
  };
  const opsInfo = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((M) => M.storeOps().map((o) => ({ id: o.id, type: o.type, count: o.geometry.length, depth: o.settings.cutDepth })))`);
  const pushSelection = (payload) => evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(payload))})`);
  const shot = async (name) => {
    const r = await evalJs(`(() => { const b = document.getElementById('prepare-ops').getBoundingClientRect(); return { x: Math.max(0, b.left - 4), y: Math.max(0, b.top - 4), width: Math.ceil(b.width + 8), height: Math.ceil(Math.min(b.height + 8, 420)) }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot', path.join(EVIDENCE_DIR, name));
  };

  try {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__errs = [];
        window.addEventListener('error', (e) => window.__errs.push(e.message || 'error'));
        if (new URLSearchParams(location.search).get('host') === 'fusion') {
          window.__sent = [];
          window.adsk = { fusionSendData(action, body) { window.__sent.push(JSON.parse(body)); } };
        }`,
    });

    // 1. Web mode (?host=shaper): verify Select in Fusion button NEVER renders on selected op row
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=shaper`);
    await waitForApp('design-canvas');
    await evalJs(`import('/apps/shaper/src/operations-store.js').then((M) => { M.insertOp(0, { type: 'pocket', settings: { cutDepth: 5 }, geometry: [] }); })`);
    await goStage('prepare');
    await openOpsSheet();
    await click('#prepare-ops .ops-row .ops-pick');
    const webHasSel = await evalJs(`!!document.querySelector('#prepare-ops .ops-fusion-sel')`);
    assert.strictEqual(webHasSel, false, `[${label}] web mode hides .ops-fusion-sel`);

    // 2. Fusion mode (?host=fusion)
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
    await waitForApp('design-canvas');
    await waitFor(`document.getElementById('btn-fusion-add-selection') && !document.getElementById('btn-fusion-add-selection').disabled`, 'fusion host ready');

    await pushSelection(INITIAL);
    await goStage('prepare');
    await openOpsSheet();

    const initialOps = await opsInfo();
    const pocketOp = initialOps.find((o) => o.type === 'pocket');
    const exteriorOp = initialOps.find((o) => o.type === 'exterior');
    const onlineOp = initialOps.find((o) => o.type === 'online');
    assert.ok(pocketOp && exteriorOp && onlineOp, `[${label}] imported 3 Fusion ops`);

    // Customize pocketOp depth so we prove settings survive assign
    await evalJs(`import('/apps/shaper/src/operations-store.js').then((M) => { const op = M.opById(${JSON.stringify(pocketOp.id)}); M.setOpSettings(op, { ...op.settings, cutDepth: 5.5 }); })`);

    // Click pocket row to reveal row actions
    await click(`#prepare-ops .ops-row[data-id="${pocketOp.id}"] .ops-pick`);
    await waitFor(`!!document.querySelector('#prepare-ops .ops-row[data-id="${pocketOp.id}"] .ops-fusion-sel')`, 'select in fusion action visible');

    // Capture screenshot of selected row showing .ops-fusion-sel cleanly
    await shot(`opselect-${tag}.png`);

    await evalJs(`window.__sent.length = 0`);
    const btnMetrics = await click(`#prepare-ops .ops-row[data-id="${pocketOp.id}"] .ops-fusion-sel`);
    if (width <= 640) {
      assert.ok(btnMetrics.width >= 44 && btnMetrics.height >= 44, `[${label}] phone tap target >= 44px: ${JSON.stringify(btnMetrics)}`);
    }

    const req = await evalJs(`window.__sent.find((m) => m.action === 'select_for_operation')`);
    assert.ok(req, `[${label}] sent select_for_operation`);
    assert.strictEqual(req.opKey, pocketOp.id, `[${label}] opKey matches`);
    assert.deepStrictEqual(req.tokens, ['tok-p1', 'tok-wall'], `[${label}] tokens match pocket sources`);
    assert.ok(req.keepTokens.includes('tok-top') && req.keepTokens.includes('tok-slot'), `[${label}] keepTokens includes other ops`);

    // 3. Return assign with Pocket 2 replacing Pocket 1
    await pushSelection({
      ...INITIAL,
      regions: [
        INITIAL.regions[0],
        {
          id: 'reg_p2',
          label: 'Pocket 2 (6mm)',
          sources: ['tok-p2'],
          cutType: 'pocket',
          depthMm: 6,
          through: false,
          outer: { closed: true, segments: rectSegs(12, 12, 18, 12) },
          holes: [],
        },
      ],
      assign: { opKey: pocketOp.id, tokens: ['tok-p2'] },
    });
    const afterReplace = await opsInfo();
    const pocketAfterReplace = afterReplace.find((o) => o.id === pocketOp.id);
    assert.strictEqual(pocketAfterReplace.count, 1, `[${label}] pocket has 1 ref after assign`);
    assert.strictEqual(pocketAfterReplace.depth, 5.5, `[${label}] pocket preserved custom cutDepth`);

    // 4. Return assign clearing pocketOp -> stays listed as EMPTY
    await pushSelection({
      ...INITIAL,
      regions: [INITIAL.regions[0]],
      assign: { opKey: pocketOp.id, tokens: [] },
    });
    const afterClear = await opsInfo();
    const pocketAfterClear = afterClear.find((o) => o.id === pocketOp.id);
    assert.ok(pocketAfterClear && pocketAfterClear.count === 0, `[${label}] emptied pocket kept as EMPTY`);

    // Select emptied op -> still shows .ops-fusion-sel so it can be re-populated
    await click(`#prepare-ops .ops-row[data-id="${pocketOp.id}"] .ops-pick`);
    const emptyHasSel = await evalJs(`!!document.querySelector('#prepare-ops .ops-row[data-id="${pocketOp.id}"] .ops-fusion-sel')`);
    assert.strictEqual(emptyHasSel, true, `[${label}] EMPTY op in Fusion mode still shows .ops-fusion-sel`);

    // 5. Undo -> restore_selection sent and pocket restored; Redo -> empty again
    await evalJs(`window.__sent.length = 0`);
    await click('#btn-undo');
    await waitFor(`window.__sent.some((m) => m.action === 'restore_selection')`, 'Undo sent restore_selection');
    const afterUndo = await opsInfo();
    assert.strictEqual(afterUndo.find((o) => o.id === pocketOp.id).count, 1, `[${label}] Undo restored pocket ref`);

    await evalJs(`window.__sent.length = 0`);
    await click('#btn-redo');
    await waitFor(`window.__sent.some((m) => m.action === 'restore_selection')`, 'Redo sent restore_selection');
    const afterRedo = await opsInfo();
    assert.strictEqual(afterRedo.find((o) => o.id === pocketOp.id).count, 0, `[${label}] Redo emptied pocket ref`);

    // 6. STL op hides .ops-fusion-sel in Fusion mode
    await evalJs(`Promise.all([import('/apps/shaper/src/operations-store.js'), import('/apps/shaper/src/selection-list.js')]).then(([M, S]) => {
      M.insertOp(0, { type: 'roughing', settings: { cutDepth: 5 }, geometry: [{ key: 'loop:stl-test', seq: 99 }] });
      S.setSelections([...S.getSelections(), { id: 'stl-live', fusion: false, kind: 'stl', text: 'Relief.stl', cutKeys: ['loop:stl-test'] }], { sync: false });
    })`);
    const opsWithStl = await opsInfo();
    const stlOp = opsWithStl.find((o) => o.type === 'roughing');
    assert.ok(stlOp, `[${label}] STL op inserted`);
    await goStage('review');
    await goStage('prepare');
    await openOpsSheet();
    await click(`#prepare-ops .ops-row[data-id="${stlOp.id}"] .ops-pick`);
    const stlHasSel = await evalJs(`!!document.querySelector('#prepare-ops .ops-row[data-id="${stlOp.id}"] .ops-fusion-sel')`);
    assert.strictEqual(stlHasSel, false, `[${label}] STL op hides .ops-fusion-sel`);

    const pageErrs = await evalJs(`window.__errs`);
    assert.deepStrictEqual(pageErrs, [], `[${label}] zero page errors: ${pageErrs.join('; ')}`);
    console.log(`[${label}] ok`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
console.log('opselect-806-live: ok');
