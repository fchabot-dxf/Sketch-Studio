// tests/perdesign-855-live.test.js — TASK 855 / SA-19: Live CDP tests (desktop 1280x800 + phone 390x844) for
// per-design Shaper project stored in the Fusion Design attribute:
// - Web mode (?host=shaper) untouched
// - One-time offer of legacy browser work when opening an empty Fusion design
// - Switching between Fusion designs (DocA with customized ops -> empty DocB -> back to DocA with saved project + request_selection)
// - 795c regionSig remapping on reopen (kept region retains custom settings, deleted region leaves op EMPTY)
// - Browser openTabsBuffer untouched by Fusion workspace edits
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/855');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];

const DOC_A_SELECTION = {
  action: 'selection_data',
  version: 1,
  selectionId: 'sel-855-docA',
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'face', name: 'TrayA', documentName: 'TrayA v1' },
  stock: { thicknessMm: 15 },
  summary: {
    mode: 'Faces',
    items: [
      { kind: 'face', count: 6, names: ['TrayA'], detail: '2 faces, 4 walls' },
    ],
    text: 'TrayA · 2 faces, 4 walls',
  },
  regions: [
    {
      id: 'reg_0',
      label: 'Outline',
      sources: ['tok-top'],
      cutType: 'outside',
      depthMm: 15,
      through: true,
      outer: { closed: true, segments: rectSegs(0, 0, 90, 60) },
      holes: [],
    },
    {
      id: 'reg_1',
      label: 'Pocket 1 (8mm)',
      sources: ['tok-p1', 'tok-w1'],
      cutType: 'pocket',
      depthMm: 8,
      through: false,
      outer: { closed: true, segments: rectSegs(10, 10, 25, 20) },
      holes: [],
    },
    {
      id: 'reg_2',
      label: 'Pocket 2 (4mm)',
      sources: ['tok-p2', 'tok-w2'],
      cutType: 'pocket',
      depthMm: 4,
      through: false,
      outer: { closed: true, segments: rectSegs(50, 10, 25, 20) },
      holes: [],
    },
  ],
  chains: [],
  warnings: [],
};

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const cdp = await launchBrowser({ tag: `855-perdesign-${tag}`, width, height });
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
  const openOpsSheet = async () => {
    await waitFor(`!!document.querySelector('#prepare-ops .ops-row')`, 'ops rows rendered');
    const isHidden = await evalJs(`(() => { const b = document.querySelector('#prepare-ops .ops-body'); return !b || b.hidden || getComputedStyle(b).display === 'none'; })()`);
    if (isHidden) await click('#prepare-ops .ops-head');
    await waitFor(`(() => { const e = document.querySelector('#prepare-ops .ops-row .ops-pick'); return !!e && e.getBoundingClientRect().height > 0; })()`, 'ops row visible');
  };
  const opsInfo = () => evalJs(`Promise.all([import('/apps/shaper/src/operations-store.js')]).then(([M]) => M.storeOps().map((o) => ({
    id: o.id,
    type: o.type,
    on: o.on,
    count: o.geometry.length,
    depth: o.settings.cutDepth,
    sources: o.geometry.flatMap((g) => (M.regionOf(g.key)?.sources || [])),
  })))`);
  const handleFusion = (action, payload) => evalJs(`window.fusionJavaScriptHandler.handle(${JSON.stringify(action)}, ${JSON.stringify(JSON.stringify(payload))})`);
  const shot = async (name) => {
    const r = await evalJs(`(() => {
      const b = document.getElementById('prepare-ops').getBoundingClientRect();
      return { x: Math.max(0, b.left - 4), y: Math.max(0, b.top - 4), width: Math.ceil(b.width + 8), height: Math.ceil(Math.min(b.height + 8, 420)) };
    })()`);
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

    // 1. Seed pre-855 browser work in openTabsBuffer so we can verify both:
    //    (a) the one-time legacy offer on an empty Fusion design, and
    //    (b) Fusion workspace edits NEVER overwrite the browser's openTabsBuffer.
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=shaper`);
    await waitForApp('design-canvas');
    await evalJs(`Promise.all([import('/packages/ui/project-store.js'), import('/apps/shaper/src/operations-store.js')]).then(async ([PS, OS]) => {
      localStorage.removeItem('shaper-fusion-legacy-offered');
      const doc = PS.emptyDocument();
      doc.hosts = { shaper: { version: 3, operations: [{ id: 'op_legacy', type: 'pocket', on: true, settings: { cutDepth: 9 }, geometry: [] }], regions: {}, nextSeq: 2, listOrder: 'default' } };
      await PS.getProjectStore().updateBuffer(() => ({ v: 2, activeKey: 'tab-legacy', tabs: [{ key: 'tab-legacy', name: 'LegacyWebDoc', designId: null, doc }] }));
    })`);

    // 2. Open Fusion mode as the SA-19 add-in opens it (?host=fusion&project=design: the per-design workspace, TASK 855c)
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion&project=design`);
    await waitForApp('design-canvas');
    await waitFor(`document.getElementById('btn-fusion-add-selection') && !document.getElementById('btn-fusion-add-selection').disabled`, 'fusion host ready');

    // Add-in replies pong with projectBridge: true and sends empty design_context for NewDesign
    await handleFusion('pong', { action: 'pong', fusionVersion: '2.0', documentName: 'NewDesign v1', lengthUnits: 'mm', projectBridge: true });
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-new',
      designKey: null,
      docName: 'NewDesign v1',
      lengthUnits: 'mm',
      hasSelection: false,
      project: null,
    });

    // Verify one-time legacy browser work offer appears in #prepare-notice, then dismiss it
    await waitFor(`!!document.getElementById('btn-fusion-open-legacy')`, 'legacy browser work offer shown once');
    const offerText = await evalJs(`document.getElementById('btn-fusion-open-legacy').textContent`);
    assert.strictEqual(offerText, "Open the panel's previous work", `[${label}] legacy offer button wording`);
    await click('#btn-fusion-dismiss-legacy');

    // 3. Switch to DocA (empty project initially) and import selection
    await evalJs(`window.__sent.length = 0`);
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-A',
      designKey: null,
      docName: 'TrayA v1',
      lengthUnits: 'mm',
      hasSelection: false,
      project: null,
    });
    const hasLegacyAgain = await evalJs(`!!document.getElementById('btn-fusion-open-legacy') && !document.getElementById('prepare-notice').hidden`);
    assert.strictEqual(hasLegacyAgain, false, `[${label}] legacy offer is one-time only`);

    await handleFusion('selection_data', DOC_A_SELECTION);
    await openOpsSheet();
    const noticeAfterImport = await evalJs(`(() => { const n = document.getElementById('prepare-notice'); return { hidden: n.hidden, text: n.textContent }; })()`);
    assert.ok(!noticeAfterImport.hidden && noticeAfterImport.text.length > 0, `[${label}] #prepare-notice shown after DocA import`);

    // Verify SA-18 / 806 chip wording ("TrayA · 2 faces, 4 walls")
    const chipText = await evalJs(`document.querySelector('#shaper-fusion-selections .shaper-fusion-sel-text')?.textContent`);
    assert.strictEqual(chipText, 'TrayA · 2 faces, 4 walls', `[${label}] selection chip uses summary.items[].detail`);

    const opsA = await opsInfo();
    const p1 = opsA.find((o) => o.sources.includes('tok-p1'));
    const p2 = opsA.find((o) => o.sources.includes('tok-p2'));
    assert.ok(p1 && p2, `[${label}] DocA has Pocket 1 and Pocket 2`);

    // Customize Pocket 1 depth (6.5 mm) and untick Pocket 2 via UI (which fires onPlanChange -> notifyProjectChanged)
    await evalJs(`import('/apps/shaper/src/operations-store.js').then((M) => {
      const op1 = M.opById(${JSON.stringify(p1.id)});
      M.setOpSettings(op1, { ...op1.settings, cutDepth: 6.5 });
    })`);
    await evalJs(`import('/apps/shaper/src/stock.js').then((S) => S.setStock({ ...S.getStock(), thickness: 19 }))`);
    await click(`#prepare-ops .ops-row[data-id="${p2.id}"] .ops-tick`);

    // 4. Switch to empty DocB -> flushes save_project for tok-A and wipes workspace cleanly
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-B',
      designKey: null,
      docName: 'BracketB v1',
      lengthUnits: 'mm',
      hasSelection: false,
      project: null,
    });

    const savedForA = await evalJs(`window.__sent.find((m) => m.action === 'save_project' && m.docToken === 'tok-A') || null`);
    assert.ok(savedForA && savedForA.project && savedForA.project.version === 1, `[${label}] switching flushed save_project for DocA`);

    const opsB = await opsInfo();
    const selCountB = await evalJs(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length`);
    const shapesCountB = await evalJs(`window.__designController.state.shapes.length`);
    const histCountB = await evalJs(`window.__designController.state.history.length`);
    assert.strictEqual(opsB.length, 0, `[${label}] DocB has 0 operations`);
    assert.strictEqual(selCountB, 0, `[${label}] DocB has 0 selection chips`);
    assert.strictEqual(shapesCountB, 0, `[${label}] DocB has 0 sketch shapes`);
    assert.strictEqual(histCountB, 0, `[${label}] DocB cleared undo history`);
    const noticeAfterSwitchB = await evalJs(`(() => { const n = document.getElementById('prepare-notice'); return { hidden: n.hidden, text: n.textContent }; })()`);
    assert.deepStrictEqual(noticeAfterSwitchB, { hidden: true, text: '' }, `[${label}] 855d: switching to DocB clears stale #prepare-notice`);

    // 4b. TASK 855b (advisor's Fusion check): DocA's selection arriving AFTER the switch (Fusion executed A's still-open
    // Add to Shaper dialog when the new document pre-empted it) names DocA (docToken tok-A): DocB stays empty, and after the
    // debounce nothing at all is saved into DocB (no key, no project for a design nobody edited in Shaper).
    await evalJs(`window.__sent.length = 0`);
    await handleFusion('selection_data', { ...DOC_A_SELECTION, docToken: 'tok-A' });
    await new Promise((r) => setTimeout(r, 2600));
    const opsBLate = await opsInfo();
    const selCountBLate = await evalJs(`document.querySelectorAll('#shaper-fusion-selections .shaper-fusion-sel').length`);
    const savesB = await evalJs(`window.__sent.filter((m) => m.action === 'save_project').map((m) => m.docToken)`);
    assert.strictEqual(opsBLate.length, 0, `[${label}] DocA's late selection_data is not imported into DocB`);
    assert.strictEqual(selCountBLate, 0, `[${label}] no DocA chip in DocB`);
    assert.deepStrictEqual(savesB, [], `[${label}] nothing saved into DocB (save_project docTokens: ${JSON.stringify(savesB)})`);

    // 5. Switch back to DocA (reopened on another PC / after switch, with Pocket 2 removed in the Fusion model)
    await evalJs(`window.__sent.length = 0`);
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-A2',
      designKey: 'uuid-docA',
      docName: 'TrayA v2',
      lengthUnits: 'mm',
      hasSelection: true,
      project: savedForA.project,
    });

    const reqSel = await evalJs(`window.__sent.find((m) => m.action === 'request_selection') || null`);
    assert.ok(reqSel && reqSel.docToken === 'tok-A2', `[${label}] design_context with hasSelection sends request_selection`);

    // Add-in responds with freshly extracted selection_data (Pocket 2 deleted in Fusion; Outline + Pocket 1 have fresh region ids)
    await handleFusion('selection_data', {
      ...DOC_A_SELECTION,
      docToken: 'tok-A2',
      regions: [
        { ...DOC_A_SELECTION.regions[0], id: 'reg_fresh_0' },
        { ...DOC_A_SELECTION.regions[1], id: 'reg_fresh_1' },
      ],
    });
    await openOpsSheet();

    const opsReopened = await opsInfo();
    const restoredP1 = opsReopened.find((o) => o.id === p1.id);
    const restoredP2 = opsReopened.find((o) => o.id === p2.id);
    assert.ok(restoredP1 && restoredP1.count === 1 && restoredP1.depth === 6.5, `[${label}] Pocket 1 restored via regionSig with 6.5mm depth`);
    assert.ok(restoredP2 && restoredP2.count === 0 && restoredP2.on === false, `[${label}] deleted Pocket 2 kept as EMPTY unticked operation`);

    await shot(`perdesign-${tag}.png`);

    // 5b. TASK 855d: wrong_design select_for_operation error renders friendly Switch back notice
    await handleFusion('error', {
      action: 'error',
      receivedAction: 'select_for_operation',
      code: 'wrong_design',
      docName: 'TrayA v1',
      message: 'raw',
    });
    const wrongDesignNotice = await evalJs(`(() => { const n = document.getElementById('prepare-notice'); return { hidden: n.hidden, err: n.classList.contains('is-error'), text: n.textContent }; })()`);
    assert.deepStrictEqual(wrongDesignNotice, {
      hidden: false,
      err: true,
      text: 'Switch back to TrayA v1 in Fusion to edit this operation.',
    }, `[${label}] 855d: wrong_design error notice displayed in #prepare-notice`);

    // 6. Verify browser openTabsBuffer was NEVER overwritten by Fusion mode
    const webBufStillLegacy = await evalJs(`import('/packages/ui/project-store.js').then(async (PS) => {
      const b = await PS.getProjectStore().readBuffer();
      return b && b.tabs && b.tabs[0] && b.tabs[0].name === 'LegacyWebDoc';
    })`);
    assert.strictEqual(webBufStillLegacy, true, `[${label}] browser openTabsBuffer untouched by Fusion mode`);

    const errs = await evalJs(`window.__errs`);
    assert.deepStrictEqual(errs, [], `[${label}] zero page errors`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
console.log('perdesign-855-live: ok');
