// tests/polish-757-live.test.js — TASK 757: the promo-screenshot polish of the Shaper app in the real page, DESKTOP 1280 x 800, real mouse clicks
// (the phone 390 x 844 is tests/polish-757-phone-live.test.js; the node parts are tests/polish-757-node.test.js). A 16 x 8 in tray drawn in the page:
// the Stock board, the part (Outside with Tabs), a slot (Inside) with a construction centre line, a programmed pocket (finish allowance 0.02 in) and a
// dish (a Stepped pocket over a cove slope, adaptive: 25+ close outlines).
//  6. an empty design in Export 3D: the Export step's empty-state message in the info, no mesh (it was a wood cube)
//  2. Prepare draws no edge for the construction line
//  7. the dish's travel marks are thinned: fewer marked outlines than steps, every two marked ones >= 12 px apart on screen; zoomed in, more are marked
//  3. Fractional inches: the 0.02 in finish allowance reads 0.02 on the card (not 0); no operation word has 4 decimals in Decimal
//  4. the tab count's longest text "Auto (99)" fits its field beside the Auto button; every Settings select is as wide as its longest option, inside the panel
//  5. desktop: the 3D info is NOT folded (every line shown)
//  1. Export 2D: the Stock guide is its outline behind the cuts: a point inside the part hits the part's outside cut, not the guide
// Screenshots to .evidence/757/live/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { drawTray, selectWidths } from './polish-757-tray.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/757/live');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '757-polish', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  const shot = async (name, sel = null) => {
    const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 4), width: r.width + 8, height: r.height + 8, scale: 1 }; })()`) : null;
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  const press = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
  };
  const clickEl = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
  };
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await evalJs(`(document.querySelector('.sk-header-tab.active') || {}).dataset?.tab`) === mode) return;
      await clickEl(`.sk-header-tab[data-tab="${mode}"]`); await sleep(300);
    }
    assert.fail('could not open ' + mode);
  };
  const toScreen = (x, y) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const clickWorld = async (x, y) => { const p = await toScreen(x, y); await press(p.x, p.y); };
  const setting = (k, v) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set(${JSON.stringify(k)}, ${JSON.stringify(v)}); })`);

  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?analytics=off`, 10000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await evalJs(`localStorage.setItem('shaper-review-view', '3d')`);
  await setting('DOC_UNIT', 'in'); await setting('INCH_DISPLAY', 'decimal');

  // ── 6. an empty design in Export 3D ──
  await openMode('review');
  if (await evalJs(`document.getElementById('review-view-3d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-3d');
  await waitFor(`/No cuts assigned/.test(document.getElementById('review-info').textContent)`, 'the empty-state message', 30000);
  const empty = await evalJs(`import('/apps/shaper/src/main.js').then((m) => { const v = m.currentReviewView(); return { info: document.getElementById('review-info').textContent, meshes: v.inspect().meshes.length, board: v.lastBuild.board }; })`);
  console.log('empty design 3D: ' + JSON.stringify(empty));
  assert.deepStrictEqual(empty, { info: 'No cuts assigned — assign cut types in Prepare first.', meshes: 0, board: 'none' }, '6: an empty design shows the message and no mesh');
  await shot('desktop-6-empty-export-3d.png');

  // ── the tray ──
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  const plan = await evalJs(`(${drawTray})()`);
  console.log('plan: ' + JSON.stringify(plan));
  await openMode('prepare');
  await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare view drawn');

  // ── 2. no edge for the construction line ──
  const edges = await evalJs(`({ all: document.querySelectorAll('#prepare-canvas [data-shape-id]').length, cl: document.querySelectorAll('#prepare-canvas [data-shape-id="CL"]').length })`);
  console.log('2 prepare edges: ' + JSON.stringify(edges));
  assert.strictEqual(edges.cl, 0, '2: the construction line is not drawn as an edge in Prepare');

  // ── 7. the dish's travel marks thinned ──
  await evalJs(`window.__prepareView.setView({ x: 200, y: 100, w: 560 })`); await sleep(200);
  await clickWorld(300, 100);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && /roughing/i.test(document.querySelector('.cut-type-cur').textContent)`, 'the dish card'); // TASK 792: Roughing replaced the stepped types
  const travel = () => evalJs(`(() => { const s = document.getElementById('prepare-canvas'), k = Math.hypot(s.getScreenCTM().a, s.getScreenCTM().b);
    const rs = [...document.querySelectorAll('#prepare-canvas .sk-travel-steps .sk-travel')].map((p) => p.getBBox().width / 2 * k).sort((a, b) => b - a);
    return { marked: rs.length, minGapPx: rs.length > 1 ? Math.min(...rs.slice(1).map((r, i) => rs[i] - r)) : null }; })()`);
  const steps = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.steppedSummary([...m.CUT_PLAN.values()].find((r) => r.cutType === 'roughing')).count)`);
  const t1 = await travel();
  console.log(`7 dish: ${steps} steps, ${JSON.stringify(t1)}`);
  assert.ok(steps >= 20, '7: the dish has many close outlines: ' + steps);
  assert.ok(t1.marked >= 1 && t1.marked < steps, `7: the travel marks thin out: ${t1.marked} of ${steps} outlines marked`);
  assert.ok(t1.minGapPx === null || t1.minGapPx >= 12 - 0.5, '7: marked outlines are at least 12 px apart on screen: ' + t1.minGapPx);
  await shot('desktop-7-dish-travel.png', '#prepare-canvas');
  await evalJs(`window.__prepareView.setView({ x: 300, y: 100, w: 120 })`); await sleep(200);
  const t2 = await travel();
  console.log('7 zoomed in: ' + JSON.stringify(t2));
  assert.ok(t2.marked > t1.marked && (t2.minGapPx === null || t2.minGapPx >= 12 - 0.5), '7: zoomed in, more outlines carry marks, still >= 12 px apart');
  await shot('desktop-7-dish-travel-zoomed.png', '#prepare-canvas');
  await evalJs(`window.__prepareView.setView({ x: 200, y: 100, w: 560 })`); await sleep(200);

  // ── 3. lengths ──
  const opWords = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-name, #prepare-ops .ops-sub')].map((e) => e.textContent)`);
  console.log('3 operations (decimal): ' + JSON.stringify(opWords));
  assert.ok(opWords.every((t) => !/\d\.\d{4}/.test(t)), '3: no operation word shows 4 decimals (the card precision): ' + JSON.stringify(opWords));
  await setting('INCH_DISPLAY', 'fractional');
  await clickWorld(100, 50);
  await waitFor(`/pocket/i.test(document.querySelector('.cut-type-cur').textContent) && !document.querySelector('.cut-row[data-row="finishAllowance"]').hidden`, 'the pocket card');
  const wall = await evalJs(`document.querySelector('.cut-row[data-row="finishAllowance"] input').value`);
  console.log('3 fractional finish allowance: ' + wall);
  assert.strictEqual(wall, '0.02', '3: Fractional: the 0.02 in finish allowance reads 0.02, not 0');
  await shot('desktop-3-fractional-card.png', '#prepare-panel .cut-card');
  await setting('INCH_DISPLAY', 'decimal');

  // ── 4. the tab count field ──
  await clickWorld(60, 100); // the part, between the slot and the pocket
  await waitFor(`!document.querySelector('.cut-row[data-row="tabCount"]').hidden && document.querySelector('.cut-row[data-row="tabCount"]').style.display !== 'none' && !('off' in document.querySelector('.cut-row[data-row="tabCount"]').dataset)`, 'the tab count row');
  const fit = await evalJs(`(() => { const i = document.querySelector('.cut-tab-count'), cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const box = i.closest('.cut-box');
    return { placeholder: i.placeholder, room: i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), longest: c.measureText('Auto (99)').width, shown: c.measureText(i.placeholder).width, boxOverflow: box.scrollWidth - box.clientWidth }; })()`);
  console.log('4 tab count: ' + JSON.stringify(fit));
  assert.ok(/^Auto \(\d+\)$/.test(fit.placeholder), '4: the count shows Auto (n)');
  assert.ok(fit.longest <= fit.room && fit.boxOverflow <= 0, `4: "Auto (99)" (${fit.longest.toFixed(1)} px) fits the count field (${fit.room} px) beside Auto, the box does not overflow`);
  await shot('desktop-4-tab-count.png', '.cut-row[data-row="tabCount"]');

  // ── 4. the Settings selects ──
  await clickEl('#btn-settings');
  await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'the Settings panel');
  const sel = await evalJs(`(${selectWidths})()`);
  console.log('4 settings selects: ' + JSON.stringify(sel));
  assert.ok(sel.length >= 8, '4: the Settings selects were measured: ' + sel.length);
  for (const s of sel) assert.ok(s.width >= s.needed - 0.5 && s.right <= s.panelRight + 0.5, `4: the ${s.key} select is as wide as its longest option and inside the panel: ${JSON.stringify(s)}`);
  await clickEl('#sk-style-tab-units');
  await shot('desktop-4-settings-units.png', '.sk-style-panel');
  await clickEl('.sk-style-close');

  // ── 5. desktop: the 3D info is not folded ──
  await openMode('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'the 3D part built', 60000);
  const info = await evalJs(`({ head: !!document.querySelector('#review-info .review-info-head'), lines: document.querySelectorAll('#review-info > div').length })`);
  console.log('5 desktop info: ' + JSON.stringify(info));
  assert.ok(!info.head && info.lines >= 3, '5: desktop: every info line shown, no fold');

  // ── 1. Export 2D: the Stock guide behind the cuts ──
  await clickEl('#review-view-2d');
  await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-op').length > 0`, 'the 2D list');
  await clickEl('#review-fit'); await sleep(300);
  const hit = await evalJs(`(() => { const g = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc *')].find((e) => e.getAttribute('shaper:cutType') === 'guide');
    const out = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc *')].find((e) => (e.getAttribute('shaper:cutType') || (e.parentNode.getAttribute && e.parentNode.getAttribute('shaper:cutType'))) === 'outside');
    const b = out.getBoundingClientRect(); const x = b.left + b.width * 0.55, y = b.top + b.height * 0.5; const at = document.elementFromPoint(x, y); // inside the part, between the pocket and the dish
    const type = (e) => e && (e.getAttribute('shaper:cutType') || (e.parentNode && e.parentNode.getAttribute && e.parentNode.getAttribute('shaper:cutType')));
    return { guideFill: g && g.getAttribute('fill'), guideStroke: g && g.getAttribute('stroke'), hitType: type(at), guideFirst: !!g && [...document.querySelectorAll('#review-2d-canvas .rv2d-doc *')].indexOf(g) < [...document.querySelectorAll('#review-2d-canvas .rv2d-doc *')].indexOf(out) }; })()`);
  console.log('1 export 2D: ' + JSON.stringify(hit));
  assert.deepStrictEqual(hit, { guideFill: 'none', guideStroke: '#0068FF', hitType: 'outside', guideFirst: true }, '1: the Stock guide is its outline behind the cuts; inside the part the part shows');
  await shot('desktop-1-export-2d.png', '#review-2d');

  // ── 2 in FUSION mode (757b): the add-in's selection with a Fusion CONSTRUCTION line (construction: true, as tests/fusion-import-664-live sends it).
  // The rule: Prepare draws only what can be a cut target; a construction shape is never a loop or a chain (loop-finder, TASK 478; fusion-import keeps
  // it isConstruction only), so it is not drawn, and every other imported shape is drawn and stays pickable.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await resetBufferLive(cdp);
  await evalJs(`localStorage.removeItem('shaper-mode')`);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion&analytics=off`, 10000);
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection')`, 'the Fusion Prepare bar');
  const line = (x1, y1, x2, y2, more = {}) => ({ type: 'line', x1, y1, x2, y2, ...more });
  const payload = { action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { kind: 'sketch', name: 'Sketch1' }, stock: { thicknessMm: null },
    regions: [{ id: 'reg_0', label: 'Profile 1', cutType: null, depthMm: null, outer: { closed: true, segments: [line(0, 0, 40, 0), line(40, 0, 40, 30), line(40, 30, 0, 30), line(0, 30, 0, 0)] }, holes: [] }],
    chains: [{ id: 'chain_0', label: 'Chain 1', cutType: null, depthMm: null, closed: false, segments: [line(50, 0, 70, 10)] },
      { id: 'chain_1', label: 'Chain 2', cutType: null, depthMm: null, closed: false, segments: [line(0, 15, 40, 15, { construction: true })] }],
    warnings: [] };
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(payload))})`);
  await waitFor(`/Added Sketch1/.test(document.getElementById('prepare-notice').textContent) && document.querySelectorAll('#prepare-world-group .sk-edge').length > 0`, 'the Fusion selection in Prepare');
  const fz = await evalJs(`(() => { const st = window.__designController.state, drawn = new Set([...document.querySelectorAll('#prepare-world-group [data-shape-id]')].map((e) => e.getAttribute('data-shape-id')));
    const con = st.shapes.filter((s) => s.isConstruction), cut = st.shapes.filter((s) => !s.isConstruction);
    return { shapes: st.shapes.length, construction: con.length, drawn: drawn.size, constructionDrawn: con.filter((s) => drawn.has(s.id)).length, cutDrawn: cut.filter((s) => drawn.has(s.id)).length, cutShapes: cut.length }; })()`);
  const pickAt = async (x, y) => { await evalJs(`window.__prepareView.setSelection([])`); await clickWorld(x, y); await sleep(150); return evalJs(`window.__prepareView.selectedTargets().map((t) => t.kind)`); };
  const pickOnConstruction = await pickAt(8, -15), pickChain = await pickAt(60, -5);
  console.log('2 fusion: ' + JSON.stringify({ ...fz, pickOnConstruction, pickChain }));
  assert.ok(fz.construction === 1 && fz.constructionDrawn === 0, '2 fusion: the imported construction line is not drawn in Prepare');
  assert.ok(fz.cutDrawn === fz.cutShapes && fz.drawn === fz.cutShapes, `2 fusion: every non-construction shape is drawn (${fz.cutDrawn} of ${fz.cutShapes})`);
  assert.deepStrictEqual([pickOnConstruction, pickChain], [['loop'], ['chain']], '2 fusion: a tap on the construction line picks the region under it (as before: it is no target), the open chain stays pickable');
  await shot('desktop-2-fusion-prepare.png', '#prepare-canvas');
  console.log('polish-757-live: ok');
} finally { await close(); }
