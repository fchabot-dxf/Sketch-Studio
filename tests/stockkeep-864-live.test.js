// tests/stockkeep-864-live.test.js — TASK 864: Stock operation keeps its geometry across:
// (1) Select in Fusion -> Update on another op (SA-16 assign / keepTokens),
// (2) editing another op's cut card settings, and
// (3) new Add selection (Body1 single solid, then Body1 top face),
// in the live plan, in the save_project bridge payload, and after per-design project reload.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { fileSourceTypesAndRemount } from './helpers/file-fusion-types-live.js'; // TASK 882

const EVIDENCE_DIR = path.resolve('.evidence/864');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const FIXTURE_DIR = path.resolve('tests/fixtures/864');
const SKETCH2 = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'sketch2-entire.json'), 'utf8'));
const BODY1 = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'body1-single-solid.json'), 'utf8'));
const BODY1_TOP_FACE = (() => {
  const f = structuredClone(BODY1);
  f.selectionId = 'CLAUDE_TEST_901_body1-top-face';
  f.summary = { mode: 'Faces', items: [{ kind: 'face', count: 1, names: ['Body1'], detail: '1 face' }], text: 'Body1 · 1 face' };
  f.source = { kind: 'face', label: 'Body1 · Face 1' };
  f.stock = null;
  f.regions[0].label = 'Body1 · Face 1';
  f.regions[0].depthMm = null;
  f.regions[0].through = false;
  return f;
})();

const STOCK_TOKEN = SKETCH2.regions[0].sources[0];

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const cdp = await launchBrowser({ tag: `864-stockkeep-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

  const mouseTo = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  const clickPt = async (x, y) => {
    await mouseTo(x, y);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  };
  const centre = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, width: r.width, height: r.height, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `[${label}] ${sel} visible and clickable: ${JSON.stringify(p)}`);
    return p;
  };
  const click = async (sel) => {
    const p = await centre(sel);
    await clickPt(p.x, p.y);
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
  const handleFusion = (action, payload) => evalJs(`window.fusionJavaScriptHandler.handle(${JSON.stringify(action)}, ${JSON.stringify(JSON.stringify(payload))})`);
  const opsInfo = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((M) => M.storeOps().map((o) => ({
    id: o.id,
    type: o.type,
    count: o.geometry.length,
    keys: o.geometry.map((r) => r.key),
    depth: o.settings.cutDepth,
    sources: o.geometry.flatMap((g) => (M.regionOf(g.key)?.sources || [])),
  })))`);

  const clickPrepareButton = async (id) => {
    const direct = await evalJs(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
    if (direct) { await click(`#${id}`); return; }
    // On phone narrow viewport, the Operations ribbon section collapses into its section label dropdown
    await click('#prepare-ribbon .sk-ribbon-group[data-section="operations"] button.sk-ribbon-group-label');
    await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="${id}"]')`, `${id} in dropdown`);
    await click(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="${id}"]`);
  };

  const shot = async (name) => {
    const r = await evalJs(`(() => { const b = document.getElementById('prepare-ops').getBoundingClientRect();
      return { x: Math.max(0, b.left - 8), y: Math.max(0, b.top - 8), width: Math.ceil(Math.min(b.width + 260, window.innerWidth - Math.max(0, b.left - 8))), height: Math.ceil(Math.min(b.height + 24, window.innerHeight - Math.max(0, b.top - 8))) }; })()`);
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

    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion&project=design`);
    await waitForApp('design-canvas');
    await waitFor(`document.getElementById('btn-fusion-add-selection') && !document.getElementById('btn-fusion-add-selection').disabled`, 'fusion host ready');

    // Boot per-design Fusion bridge on bromont
    await handleFusion('pong', { action: 'pong', fusionVersion: '2.0', documentName: 'bromont v1', lengthUnits: 'mm', projectBridge: true });
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-bromont-1',
      designKey: 'dk-bromont',
      docName: 'bromont v1',
      lengthUnits: 'mm',
      hasSelection: false,
      project: null,
    });

    // Dismiss one-time legacy offer if shown
    if (await evalJs(`!!document.getElementById('btn-fusion-dismiss-legacy')`)) {
      await click('#btn-fusion-dismiss-legacy');
    }

    // Import Sketch2 (Profile 1 outer rectangle + chain_1)
    await handleFusion('selection_data', { ...SKETCH2, docToken: 'tok-bromont-1' });
    await goStage('prepare');
    await waitFor(`document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas rendered');

    // Pick Sketch2 Profile 1 loop on the canvas and create the Stock operation from the Prepare toolbar
    const prof1Pt = await evalJs(`Promise.all([import('/packages/ui/coords.js'), import('/apps/shaper/src/operations-store.js')]).then(([C, M]) => {
      const pc = document.getElementById('prepare-canvas');
      const k = Object.keys(M.captureStore().regions).find((key) => key.startsWith('loop:'));
      window.__prepareView.setSelection([{ kind: 'loop', id: k.slice(5) }]);
      const p = C.worldToScreen(pc, { x: 60, y: -1065 });
      return { x: Math.round(p.x), y: Math.round(p.y), key: k };
    })`);
    assert.ok(prof1Pt && prof1Pt.key, `[${label}] Sketch2 Profile 1 loop present`);
    await clickPrepareButton('op-type-stock');
    await waitFor(`!!document.querySelector('#prepare-panel .cut-ok')`, 'Stock card opened');
    await click('#prepare-panel .cut-ok');
    await openOpsSheet();

    // Verify Stock holds Sketch2 Profile 1
    let ops = await opsInfo();
    let stockOp = ops.find((o) => o.type === 'stock');
    assert.ok(stockOp && stockOp.count === 1 && stockOp.sources.includes(STOCK_TOKEN), `[${label}] Stock set to Sketch2 Profile 1`);

    // Create an empty Online op (the user will populate it via Select in Fusion -> Update)
    await evalJs(`window.__prepareView.setSelection([])`);
    await clickPrepareButton('op-type-online');
    await waitFor(`!!document.querySelector('#prepare-panel .cut-ok')`, 'Online card opened');
    await click('#prepare-panel .cut-ok');

    // Candidate action (3a): Add selection Body1 (Single Solid Body) and convert its Outside op to an Inside cut
    await handleFusion('selection_data', { ...BODY1, docToken: 'tok-bromont-1' });
    await fileSourceTypesAndRemount({ evalJs, waitFor }); // TASK 882: the import makes no operation: file the types Fusion hinted (what the old import did)
    await openOpsSheet();
    ops = await opsInfo();
    stockOp = ops.find((o) => o.type === 'stock');
    const bodyOpInitial = ops.find((o) => o.type === 'exterior');
    assert.ok(stockOp && stockOp.count === 1, `[${label}] Stock kept geometry after Add selection (Body1)`);
    assert.ok(bodyOpInitial && bodyOpInitial.count === 1, `[${label}] Body1 op imported`);

    // Convert Body1's op to an Inside ('interior') cut via Edit card -> type trigger -> Inside -> OK
    await click(`#prepare-ops .ops-row[data-id="${bodyOpInitial.id}"] .ops-pick`);
    await click(`#prepare-ops .ops-row[data-id="${bodyOpInitial.id}"] .ops-edit`);
    await waitFor(`!!document.querySelector('#prepare-panel .cut-type-trigger')`, 'cut card open for Body1 op');
    await click('#prepare-panel .cut-type-trigger');
    await waitFor(`!!document.querySelector('.cut-type-opt[data-id="interior"]')`, 'Inside option visible');
    await click('.cut-type-opt[data-id="interior"]');
    await click('#prepare-panel .cut-ok');

    // Candidate action (3b): Add selection Body1 Top Face
    await handleFusion('selection_data', { ...BODY1_TOP_FACE, docToken: 'tok-bromont-1' });
    await fileSourceTypesAndRemount({ evalJs, waitFor }); // TASK 882: the import makes no operation: file the types Fusion hinted (what the old import did)
    await openOpsSheet();
    ops = await opsInfo();
    stockOp = ops.find((o) => o.type === 'stock');
    let insideOp = ops.find((o) => o.type === 'interior');
    const onlineOp = ops.find((o) => o.type === 'online');
    const topFaceOp = ops.find((o) => o.type === 'exterior');
    assert.ok(stockOp && stockOp.count === 1, `[${label}] Stock kept geometry after Add selection (Body1 Top Face)`);
    assert.ok(insideOp && insideOp.count === 1, `[${label}] Inside kept geometry after Add selection (Body1 Top Face)`);
    assert.ok(onlineOp && topFaceOp, `[${label}] Online and Top Face ops present`);

    // Candidate action (2): Edit Inside op's cut card settings (depth -> 12 mm) and confirm OK
    await click(`#prepare-ops .ops-row[data-id="${insideOp.id}"] .ops-pick`);
    await click(`#prepare-ops .ops-row[data-id="${insideOp.id}"] .ops-edit`);
    await waitFor(`!!document.querySelector('#prepare-panel .cut-depth')`, 'Inside cutDepth field ready');
    await evalJs(`(() => { const inp = document.querySelector('#prepare-panel .cut-depth'); inp.value = '12'; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click('#prepare-panel .cut-ok');

    ops = await opsInfo();
    stockOp = ops.find((o) => o.type === 'stock');
    insideOp = ops.find((o) => o.type === 'interior');
    assert.strictEqual(stockOp.count, 1, `[${label}] Stock kept geometry after editing Inside cut card settings`);
    assert.strictEqual(insideOp.count, 1, `[${label}] Inside kept geometry after editing its cut card settings`);

    // Candidate action (1): Select in Fusion -> Update on another op (Online op sharing Sketch2 selection with Stock)
    await click(`#prepare-ops .ops-row[data-id="${onlineOp.id}"] .ops-pick`);
    await waitFor(`!!document.querySelector('#prepare-ops .ops-row[data-id="${onlineOp.id}"] .ops-fusion-sel')`, 'Select in Fusion visible on Online op');
    await evalJs(`window.__sent.length = 0`);
    await click(`#prepare-ops .ops-row[data-id="${onlineOp.id}"] .ops-fusion-sel`);
    await waitFor(`window.__sent.some((m) => m.action === 'select_for_operation')`, 'select_for_operation sent');
    const selReq = await evalJs(`window.__sent.find((m) => m.action === 'select_for_operation')`);
    assert.strictEqual(selReq.opKey, onlineOp.id, `[${label}] select_for_operation targets Online op`);
    assert.ok(selReq.keepTokens.includes(STOCK_TOKEN), `[${label}] select_for_operation keepTokens preserves Stock source token`);

    // Simulate Fusion add-in Select in Fusion -> Update on Sketch2 keeping ONLY (assign.tokens + req.keepTokens)
    const assignTok = SKETCH2.chains[1].sources[0];
    const keepSet = new Set([assignTok, ...selReq.keepTokens]);
    const updatedSketch2 = structuredClone(SKETCH2);
    updatedSketch2.docToken = 'tok-bromont-1';
    updatedSketch2.regions = updatedSketch2.regions.filter((r) => r.sources.some((t) => keepSet.has(t)));
    updatedSketch2.chains = updatedSketch2.chains.filter((c) => c.sources.some((t) => keepSet.has(t)));
    updatedSketch2.assign = { opKey: onlineOp.id, tokens: [assignTok] };
    await handleFusion('selection_data', updatedSketch2);

    ops = await opsInfo();
    stockOp = ops.find((o) => o.type === 'stock');
    insideOp = ops.find((o) => o.type === 'interior');
    const updatedOnlineOp = ops.find((o) => o.id === onlineOp.id);
    assert.ok(stockOp && stockOp.count === 1 && stockOp.sources.includes(STOCK_TOKEN),
      `[${label}] Stock MUST keep geometry after Select in Fusion -> Update on another op (got count=${stockOp?.count})`);
    assert.ok(updatedOnlineOp && updatedOnlineOp.count === 1, `[${label}] Online op received assigned chain`);
    assert.ok(insideOp && insideOp.count === 1, `[${label}] Inside kept geometry after Select in Fusion -> Update`);

    await shot(`stockkeep-${tag}.png`);

    // Check save_project payload sent over the bridge (switch away flushes save_project synchronously)
    await evalJs(`window.__sent.length = 0`);
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-other',
      designKey: 'dk-other',
      docName: 'OtherDesign v1',
      lengthUnits: 'mm',
      hasSelection: false,
      project: null,
    });
    const saved = await evalJs(`window.__sent.find((m) => m.action === 'save_project' && m.docToken === 'tok-bromont-1') || null`);
    assert.ok(saved && saved.project, `[${label}] save_project flushed for bromont`);
    const savedStock = saved.project.operations.find((o) => o.type === 'stock');
    const savedInside = saved.project.operations.find((o) => o.type === 'interior');
    assert.ok(savedStock && savedStock.geometry.length === 1, `[${label}] save_project preserves Stock geometry`);
    assert.ok(savedInside && savedInside.geometry.length === 1, `[${label}] save_project preserves Inside geometry`);

    // Reload per-design project (design_context with saved.project + hasSelection: true, then replay selections)
    await handleFusion('design_context', {
      action: 'design_context',
      docToken: 'tok-bromont-2',
      designKey: 'dk-bromont',
      docName: 'bromont v2',
      lengthUnits: 'mm',
      hasSelection: true,
      project: saved.project,
    });
    const replaySketch2 = structuredClone(updatedSketch2);
    delete replaySketch2.assign;
    replaySketch2.docToken = 'tok-bromont-2';
    await handleFusion('selection_data', replaySketch2);
    await handleFusion('selection_data', { ...BODY1, docToken: 'tok-bromont-2' });
    await handleFusion('selection_data', { ...BODY1_TOP_FACE, docToken: 'tok-bromont-2' });
    await openOpsSheet();

    const reloadedOps = await opsInfo();
    const reloadedStock = reloadedOps.find((o) => o.type === 'stock');
    const reloadedInside = reloadedOps.find((o) => o.type === 'interior');
    assert.ok(reloadedStock && reloadedStock.count === 1 && reloadedStock.sources.includes(STOCK_TOKEN),
      `[${label}] Stock keeps geometry after per-design project reload`);
    assert.ok(reloadedInside && reloadedInside.count === 1,
      `[${label}] Inside keeps geometry after per-design project reload`);

    const errs = await evalJs(`window.__errs`);
    assert.deepStrictEqual(errs, [], `[${label}] no uncaught page errors`);
    console.log(`[${label}] PASS`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
