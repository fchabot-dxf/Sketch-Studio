// tests/pocket-clearing-745-live.test.js — TASK 745: the PROGRAMMED POCKET in the real Shaper page.
//  A. desktop 1280 x 800, real mouse, mm, the standalone app: a 120 x 70 pocket, an L pocket and a pocket with an island drawn; Prepare: Pocket, the Clearing
//     dropdown (each choice with its icon), Concentric (the rings drawn as thin tool paths, the note), the stepover + and a smaller bit (the rings redraw, the
//     note follows), Raster (0, then the 45 preset), Morphed spiral; the island pocket: the spiral greyed with its reason; the operations list: one row per
//     programmed pocket; Export 2D ("ring k of N", "wall") == the downloaded SVG element by element; Export 3D built with the cleared pockets.
//  B. phone 390 x 844, real touch, inches: the same, by touch (card, dropdown, presets), each pattern; Export 2D / 3D; the download matches.
//  C. Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 payload of the drafted pocket through fusionJavaScriptHandler, as 714's live test): the imported
//     pocket switched to Concentric, Raster and Morphed spiral, each in the download.
// Screenshots to .evidence/745/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/745');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '745-pocket', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-745-dl-'));

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  let phone = false;
  const shot = async (name, sels = null, scale = 1, margin = 6) => {
    let clip = null;
    if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - ${margin}), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - ${margin});
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + ${margin}) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + ${margin}) - y, scale: ${scale} }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  // a screenshot of the world box (x0, y0)-(x1, y1) on the Prepare canvas, at `scale`
  const shotWorld = async (name, b, scale = 2) => {
    // on the phone the card covers the right of the canvas and the drawer handle its left edge: zoom the Prepare view so the box fills the free strip between
    // them (upper part of the canvas), shoot, then put the view back
    const before = phone ? await evalJs(`(() => { const v = window.__prepareView, svg = document.getElementById('prepare-canvas'), c = svg.getBoundingClientRect(), card = document.querySelector('#prepare-panel').getBoundingClientRect();
      const old = { x: v.view.x, y: v.view.y, w: v.view.w }; const left = 52, right = card.left - 8, bw = ${b[2] - b[0]}, bh = ${b[3] - b[1]};
      const k = Math.min((right - left) / bw, (c.height * 0.4) / bh); // css px per world unit
      const w = c.width / k, cx = ${b[0]} - (left - c.left) / k + w / 2, cy = ${(b[1] + b[3]) / 2} + (c.height / 2 - (c.height * 0.3)) / k;
      v.setView({ x: cx, y: cy, w }); return old; })()`) : null;
    if (phone) await sleep(250);
    const clip = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'), m = svg.getScreenCTM(); const p = (x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
      const a = p(${b[0]}, ${b[1]}), c = p(${b[2]}, ${b[3]}); const x = Math.max(0, Math.min(a.x, c.x) - 12), y = Math.max(0, Math.min(a.y, c.y) - 12);
      return { x, y, width: Math.min(innerWidth, Math.max(a.x, c.x) + 12) - x, height: Math.min(innerHeight, Math.max(a.y, c.y) + 12) - y, scale: ${scale} }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
    if (phone) { const full = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVIDENCE_DIR, name.replace('.png', '-screen.png')), Buffer.from(full.data, 'base64')); } // the whole phone screen, as zoomed
    if (before) await evalJs(`window.__prepareView.setView(${JSON.stringify(before)})`);
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const press = async (x, y) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
    await sleep(250);
  };
  const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => {
    const p = await boxOf(sel);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
    return p;
  };
  const clickWorld = async (x, y) => {
    const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
      const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
    await press(p.x, p.y);
  };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-handle');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
      } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  const draw = () => evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const poly = (name, pts) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] })); };
    poly('A', [[0, 0], [120, 0], [120, 70], [0, 70]]);
    poly('L', [[140, 0], [240, 0], [240, 40], [180, 40], [180, 100], [140, 100]]);
    poly('I', [[0, 90], [120, 90], [120, 150], [0, 150]]);
    poly('Ii', [[50, 110], [70, 110], [70, 130], [50, 130]]);
    st.saveState('draw');
    return st.shapes.length; })()`);
  const card = () => evalJs(`({ type: document.querySelector('.cut-type-cur').textContent, clearing: document.querySelector('.cut-clear-cur').textContent,
    rows: [...document.querySelectorAll('.cut-row[data-row="stepover"], .cut-row[data-row="wallAllowance"], .cut-row[data-row="passDepth"], .cut-row[data-row="rasterAngle"]')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.row),
    stepover: document.querySelector('.cut-stepover').value, len: document.querySelector('.cut-stepover-len').textContent, note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);
  const look = () => evalJs(`({ paths: document.querySelectorAll('#prepare-toolpath-group .sk-clear-path').length, cleanup: document.querySelectorAll('#prepare-toolpath-group .sk-clear-cleanup').length,
    leftover: document.querySelectorAll('#prepare-cut-group .sk-leftover').length, band: document.querySelectorAll('#prepare-cut-group .sk-band').length,
    d: [...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].map((p) => p.getAttribute('d').length).reduce((a, b) => a + b, 0) })`);
  const pickType = async (id) => { await clickEl('#prepare-panel .cut-type-trigger'); await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu'); await clickEl(`.cut-type-opt[data-id="${id}"]`); };
  const typeField = async (cls, v) => { await evalJs(`(() => { const i = document.querySelector('${cls}'); i.value = '${v}'; i.dispatchEvent(new Event('change')); })()`); await sleep(200); };
  const openClearing = async () => { await clickEl('#prepare-panel .cut-clear-trigger'); await waitFor(`!document.querySelector('.cut-clear-pop').hidden`, 'the Clearing popover'); };
  const pickClearing = async (id) => { await openClearing(); await clickEl(`.cut-clear-opt[data-clearing="${id}"]`); await waitFor(`document.querySelector('.cut-clear-pop').hidden`, 'the popover closes'); await sleep(300); };
  const rec = (x, y) => evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js'), import('/apps/shaper/src/cut-plan.js')]).then(([L, G, C]) => {
    const st = window.__designController.state, by = new Map(st.shapes.map((s) => [s.id, s]));
    const l = L.findLoops(st).map((l) => ({ l, p: G.loopPolygon(l, st, by) })).filter((o) => G.pointInPolygon(o.p, { x: ${x}, y: ${y} })).sort((a, b) => Math.abs(G.polyArea(a.p)) - Math.abs(G.polyArea(b.p)))[0];
    const r = C.CUT_PLAN.get('loop:' + l.l.id); return r ? { cutType: r.cutType, clearing: r.clearing ?? null, stepover: r.stepover ?? null, wallAllowance: r.wallAllowance ?? null, rasterAngle: r.rasterAngle ?? null, toolDia: r.toolDia } : null; })`);
  const download = async () => {
    await openMode('review');
    for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
    await clickEl('#btn-generate-svg');
    let file = null;
    for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
    assert.ok(file, 'the export downloaded');
    return fs.readFileSync(file, 'utf8');
  };
  // the file's drawn elements: tag + geometry + resolved cut attributes (a <g> hoists the shared ones)
  const fileElements = (svg) => {
    const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const out = []; let group = null;
    for (const line of svg.split('\n').map((l) => l.trim())) {
      if (line.startsWith('<g')) { group = attrs(line); continue; }
      if (line.startsWith('</g')) { group = null; continue; }
      const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
      if (!m || /fill="#FF0000"/.test(line)) continue;
      const a = { ...(group || {}), ...attrs(m[2]) };
      out.push([m[1], a.d || `${a.cx},${a.cy},${a.r}`, a['shaper:cutType'], a['shaper:cutDepth'], a['shaper:toolDia']]);
    }
    return out;
  };
  // Export 2D: the list rows, an element's label, and the mounted elements (file order: data-* dropped) to compare with the download
  const export2d = async (label) => {
    await openMode('review');
    if (await evalJs(`document.getElementById('review-view-2d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-2d');
    await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-op').length > 0`, label + ': the 2D list');
    await evalJs(`document.getElementById('review-side').scrollTop = 0`);
    await sleep(300);
    return evalJs(`(() => {
      const rows = [...document.querySelectorAll('#review-cuts-list > *')].filter((e) => e.matches('.rv2d-op, .rv2d-row')).map((e) => (e.matches('.rv2d-op') ? '# ' : '') + e.firstChild.textContent.trim() + (e.matches('.rv2d-row') ? ' (' + e.lastChild.textContent + ')' : ''));
      const els = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc *')].filter((e) => ['path', 'circle', 'polygon'].includes(e.localName) && e.getAttribute('fill') !== '#FF0000');
      const cut = (e, n) => { for (let x = e; x && x.nodeType === 1; x = x.parentNode) { const v = x.getAttribute('shaper:' + n); if (v) return v; } return null; };
      const ord = els.map((e) => ({ e, i: Number(e.dataset.fileIndex) }));
      return { rows, count: els.length, clears: els.map((e) => e.getAttribute('data-clear')).filter(Boolean) };
    })()`);
  };
  const preview2dElements = () => evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/apps/shaper/src/cut-plan.js').then((C) => m.shaperPreviewOf(window.__designController.state, C.cutPlanEntries()).svg))`);

  // ── A / B: the standalone app ──
  const phase = async (label) => {
    const D = phone ? 'phone' : 'desktop';
    const inch = await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit() === 'in')`);
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
    assert.strictEqual(await draw(), 18, label + ': drawn');
    await openMode('prepare');
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head'); // the folded bar keeps the card free
    // the rectangle pocket: Pocket, depth, bit 6 mm (1/4 in on the phone)
    await clickWorld(60, 10);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the card');
    await pickType('pocket');
    await typeField('.cut-depth', inch ? '0.25' : '6');
    await typeField('.cut-bit', inch ? '0.25' : '6');
    const c0 = await card();
    assert.deepStrictEqual([c0.type, c0.clearing, c0.rows, c0.note], ['Pocket', 'Freehand', [], []], label + ': Pocket, Clearing Freehand, no clearing rows, no note');
    await openClearing();
    const opts = await evalJs(`[...document.querySelectorAll('.cut-clear-opt')].map((o) => [o.dataset.clearing, o.querySelector('.cut-clear-name').textContent, !!o.querySelector('svg.cut-ic path, svg.cut-ic rect'), o.disabled])`);
    assert.deepStrictEqual(opts, [['freehand', 'Freehand', true, false], ['concentric', 'Concentric', true, false], ['raster', 'Raster', true, false], ['spiral', 'Morphed spiral', true, false]], label + ': the 4 choices, each with its pattern icon');
    const pop = await evalJs(`(() => { const p = document.querySelector('.cut-clear-pop').getBoundingClientRect(); return { left: Math.round(p.left), right: Math.round(p.right), w: Math.round(p.width), optH: Math.round(document.querySelector('.cut-clear-opt').getBoundingClientRect().height) }; })()`);
    console.log(label + ' popover: ' + JSON.stringify(pop));
    assert.ok(pop.left >= 0 && pop.right <= (phone ? 390 : 1280), label + ': the popover is on screen');
    if (phone) assert.ok(pop.optH >= 40, label + ': its choices are 40 px touch rows');
    await shot(`${D}-card-clearing-menu.png`, ['#prepare-panel .cut-card', '.cut-clear-pop'], 2);
    await clickEl('#prepare-panel .cut-clear-trigger'); // close
    // Concentric
    await pickClearing('concentric');
    const r1 = await rec(60, 10);
    assert.deepStrictEqual([r1.cutType, r1.clearing, r1.stepover, r1.wallAllowance, r1.rasterAngle], ['pocket', 'concentric', 40, inch ? 0.508 : 0.5, 0], label + ': Concentric with the defaults');
    const c1 = await card();
    console.log(label + ' concentric card: ' + JSON.stringify(c1));
    assert.deepStrictEqual(c1.rows, ['stepover', 'wallAllowance', 'passDepth'], label + ': Stepover, Wall allowance, Depth per pass');
    assert.ok(new RegExp(`^Pocket: \\d+ rings \\+ wall, stepover ${inch ? '0\\.1 in' : '2\\.4 mm'}, [\\d.]+ ${inch ? 'ft' : 'm'} of path, about \\d+ min at ${inch ? '39 in' : '1000 mm'}/min$`).test(c1.note[0]), label + ': the note ' + c1.note[0]);
    assert.ok(c1.note.some((t) => t.startsWith('Drawn for a ' + (inch ? '0.25 in' : '6 mm') + ' bit')), label + ': the bit the rings are drawn for');
    const l1 = await look();
    console.log(label + ' concentric look: ' + JSON.stringify(l1));
    assert.ok(l1.paths >= 10 && l1.leftover === 1 && l1.band >= 1, label + ': the rings drawn as thin tool paths, the cleared area and the leftover corners');
    await shot(`${D}-card-concentric.png`, '#prepare-panel .cut-card', 2);
    await shotWorld(`${D}-prepare-concentric.png`, [0, 0, 120, 70]);
    // the stepover + : the rings redraw, the note follows
    await clickEl('.cut-row[data-row="stepover"] .cut-step[data-d="1"]');
    await sleep(300);
    const c2 = await card(), l2 = await look();
    assert.strictEqual(c2.stepover, '45', label + ': stepover + -> 45 %');
    assert.ok(l2.paths < l1.paths && c2.note[0] !== c1.note[0], label + `: the rings redraw (${l1.paths} -> ${l2.paths} paths), the note follows: ${c2.note[0]}`);
    // a smaller bit: more rings
    await clickEl('#prepare-panel .cut-row[data-param="toolDia"] .cut-preset[data-value="3.175"]');
    await sleep(400);
    const c3 = await card(), l3 = await look();
    assert.ok(l3.paths > l2.paths && /Drawn for a (3\.175 mm|0\.125 in|1\/8 in) bit/.test(c3.note.join(' | ')), label + `: a smaller bit: more rings (${l3.paths}), the note names it: ${c3.note.join(' | ')}`);
    await clickEl('#prepare-panel .cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]');
    await sleep(300);
    // Raster, then 45
    await pickClearing('raster');
    const c4 = await card();
    assert.deepStrictEqual(c4.rows, ['stepover', 'wallAllowance', 'passDepth', 'rasterAngle'], label + ': Raster adds the Raster angle row');
    assert.ok(/^Pocket: raster 0°: \d+ passes \+ 1 ring \+ wall/.test(c4.note[0]), label + ': raster note ' + c4.note[0]);
    const l4 = await look();
    assert.ok(l4.cleanup === 1 && l4.paths > 5, label + ': the passes + the dashed clean-up ring');
    await shotWorld(`${D}-prepare-raster-0.png`, [0, 0, 120, 70]);
    await clickEl('.cut-row[data-row="rasterAngle"] .cut-preset[data-value="45"]');
    await sleep(300);
    assert.ok(/^Pocket: raster 45°/.test((await card()).note[0]), label + ': raster 45');
    await shotWorld(`${D}-prepare-raster-45.png`, [0, 0, 120, 70]);
    await shot(`${D}-card-raster.png`, '#prepare-panel .cut-card', 2);
    // Morphed spiral
    await pickClearing('spiral');
    const c5 = await card(), l5 = await look();
    assert.ok(/^Pocket: morphed spiral: \d+ turns \+ wall/.test(c5.note[0]) && l5.paths === 1, label + ': the spiral is one path: ' + c5.note[0]);
    await shotWorld(`${D}-prepare-spiral.png`, [0, 0, 120, 70]);
    // the L pocket: Concentric; the island pocket: the spiral greyed with its reason, Concentric
    const quarter = () => clickEl('#prepare-panel .cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]'); // the 1/4 in preset (as the rectangle's now)
    await clickWorld(150, 90);
    await pickType('pocket'); await typeField('.cut-depth', inch ? '0.25' : '6'); await quarter();
    await pickClearing('spiral');
    assert.strictEqual((await rec(150, 90)).clearing, 'spiral', label + ': the L takes the spiral');
    await shotWorld(`${D}-prepare-spiral-L.png`, [140, 0, 240, 100]);
    await clickWorld(10, 100);
    await pickType('pocket'); await typeField('.cut-depth', inch ? '0.25' : '6'); await quarter();
    await openClearing();
    const sp = await evalJs(`(() => { const o = document.querySelector('.cut-clear-opt[data-clearing="spiral"]'); return [o.disabled, o.classList.contains('is-disabled'), o.querySelector('.cut-clear-why') && o.querySelector('.cut-clear-why').textContent]; })()`);
    assert.deepStrictEqual(sp, [true, true, 'has islands: use Concentric or Raster'], label + ': the island pocket: Morphed spiral greyed with its reason');
    await shot(`${D}-card-spiral-disabled.png`, ['#prepare-panel .cut-card', '.cut-clear-pop'], 2);
    await clickEl('.cut-clear-opt[data-clearing="concentric"]');
    await sleep(300);
    await shotWorld(`${D}-prepare-island-concentric.png`, [0, 90, 120, 150]);
    // the operations list: one row per programmed pocket
    if (phone) await clickEl('#prepare-ops .ops-head');
    const ops = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => r.querySelector('.ops-name').textContent + ' | ' + r.querySelector('.ops-sub').textContent)`);
    console.log(label + ' ops: ' + JSON.stringify(ops));
    assert.strictEqual(ops.length, 2, label + ': 2 operations: the two spiral pockets (same tool, type and settings) and the concentric one');
    assert.ok(/^Pocket \(morphed spiral\) · .* \| 2 regions · morphed spiral: \d+ turns \+ wall; morphed spiral: \d+ turns \+ wall$/.test(ops[0]), label + ': the spiral pockets are ONE row: ' + ops[0]);
    assert.ok(/^Pocket \(concentric\) · .* \| 1 region · \d+ rings \(\d+ loops\) \+ wall$/.test(ops[1]), label + ': the island pocket is ONE row: its rings + wall');
    await shot(`${D}-ops-list.png`, '#prepare-ops', phone ? 2 : 2);
    if (phone) await clickEl('#prepare-ops .ops-head');
    // Export 2D == the download, element by element
    const e2 = await export2d(label);
    console.log(label + ' 2D rows: ' + JSON.stringify(e2.rows));
    assert.ok(e2.rows.some((t) => /· rings \(\d+\)$/.test(t)) && e2.rows.some((t) => /· wall \(2\)$/.test(t)) && e2.rows.some((t) => /· spiral \(2\)$/.test(t)) && e2.rows.some((t) => /· islands \(1\)$/.test(t)), label + ': 2D lists the spirals, walls, rings, the island');
    await clickEl('#review-cuts-list .rv2d-row');
    const lab = await evalJs(`document.getElementById('review-2d-info').textContent`);
    console.log(label + ' 2D label: ' + lab);
    await shot(`${D}-export-2d.png`, phone ? null : ['#review-stage', '#review-side']);
    const pv = await preview2dElements();
    const file = await download();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-download.svg`), file);
    assert.deepStrictEqual(fileElements(pv), fileElements(file), label + ': Export 2D shows the downloaded file, element by element (geometry + cut attributes)');
    assert.strictEqual(e2.count, fileElements(file).length, label + ': every element of the file is on the 2D canvas');
    assert.ok(!/data-/.test(file), label + ': no data-* in the download');
    const kinds = fileElements(file).map((e) => e[2]);
    assert.ok(kinds.filter((k) => k === 'online').length >= 3 && kinds.filter((k) => k === 'inside').length === 3 && kinds.filter((k) => k === 'outside').length === 1 && !kinds.includes('pocket'),
      label + ': the download: on-line clearing paths, 3 walls (inside), the island (outside), no pocket element');
    // Export 3D: built, the cleared pockets
    if (await evalJs(`document.getElementById('review-view-3d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-3d');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the Review built');
    await sleep(800);
    const info = await evalJs(`[...document.getElementById('review-info').children].map((d) => d.textContent)`);
    console.log(label + ' 3D info: ' + JSON.stringify(info));
    assert.ok(info.some((t) => /^Pocket: morphed spiral: \d+ turns \+ wall/.test(t)) && info.some((t) => /^Pocket: \d+ rings \(\d+ loops\) \+ wall/.test(t)), label + ': the 3D info says the clearing');
    await shot(`${D}-export-3d.png`, '#review-canvas-host');
    await openMode('prepare');
  };

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await setUnit('mm');
  await phase('desktop (mm)');

  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-sidebar-handle')`, 'shaper app ready (phone)');
  await setUnit('in');
  await phase('phone (in)');
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
  phone = false;

  // ── C: Fusion mode, the imported pocket ──
  await resetBufferLive(cdp);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await setUnit('mm');
  await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: the drafted pocket imported');
  await clickWorld(60, -40);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion: the imported pocket\'s card');
  const fusion = {};
  for (const id of ['concentric', 'raster', 'spiral']) {
    await pickClearing(id);
    const c = await card();
    assert.ok(new RegExp(`^Pocket: ${id === 'concentric' ? '\\d+ rings' : id === 'raster' ? 'raster 0°: \\d+ passes \\+ 1 ring' : 'morphed spiral: \\d+ turns'} \\+ wall`).test(c.note[0]), `Fusion ${id}: the note ${c.note[0]}`);
    const l = await look();
    assert.ok(l.paths >= 1, `Fusion ${id}: drawn`);
    const b = await evalJs(`(() => { const r = [...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].map((p) => p.getBBox()); return [Math.min(...r.map((q) => q.x)) - 8, Math.min(...r.map((q) => q.y)) - 8, Math.max(...r.map((q) => q.x + q.width)) + 8, Math.max(...r.map((q) => q.y + q.height)) + 8]; })()`);
    await shotWorld(`fusion-prepare-${id}.png`, b);
    const svg = await evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/apps/shaper/src/cut-plan.js').then((C) => m.shaperSvgOf(window.__designController.state, C.cutPlanEntries())))`);
    const els = fileElements(svg).map((e) => e[2]);
    fusion[id] = els.reduce((o, k) => ({ ...o, [k]: (o[k] || 0) + 1 }), {});
    assert.ok(els.includes('online') && els.includes('inside') && !els.includes('pocket'), `Fusion ${id}: the export has the clearing paths and the wall: ${JSON.stringify(fusion[id])}`);
    await clickWorld(60, -40);
  }
  console.log('Fusion exports: ' + JSON.stringify(fusion));
  await shot('fusion-card.png', '#prepare-panel .cut-card', 2);
  console.log('pocket-clearing-745-live: ok');
} finally { await close(); }
