// tests/helpers/leadin-live.js — TASK 775: LEAD-IN, On line TABS and the Loop's dots in the real Shaper page, shared by the split live files (each a fresh
// headless browser + server, well under 40 s alone):
//   tests/leadin-775-live.test.js         desktop 1280 x 800, mouse, INCHES: linePhase (the On line lead-in and tabs; the owner's test file by Generate;
//                                         Export 2D / 3D)
//   tests/leadin-775-pocket-live.test.js  desktop, mm: pocketPhase (Spiral / Raster / Morphed spiral + Loop + Lead-in; an island pocket; an open line)
//   tests/leadin-775-phone-live.test.js   phone 390 x 844, touch, mm: linePhase (44 px choices)
//   tests/leadin-775-phone-pocket-live.test.js  phone: pocketPhase (Spiral)
//   tests/leadin-775-fusion-live.test.js  Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 drafted-pocket payload): fusionPhase
// The page tools are tests/helpers/pocket-live.js openPocketPage's. Screenshots to .evidence/775/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { openPocketPage } from './pocket-live.js';
import { sleep } from './cdp-browser.js';

export const TRADE_OFF = "Lead-in: you start at the arc's end; AutoPass then reverses at each end, so the cutting direction alternates.";
const IN = 25.4;

/** The page (EVIDENCE_DIR .evidence/775; the 3D view needs swiftshader in headless). */
export const openLeadinPage = (o) => openPocketPage({ ...o, evidenceDir: path.resolve('.evidence/775'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// a path's end points (M / L / A / C) and whether it closes
export function pathPoints(d) {
  const tok = d.trim().split(/\s+/), pts = [];
  let i = 0, closed = false, subpaths = 0;
  while (i < tok.length) {
    const c = tok[i++];
    if (c === 'Z') { closed = true; continue; }
    const n = c === 'A' ? 7 : c === 'C' ? 6 : 2;
    const v = tok.slice(i, i + n).map(Number); i += n;
    if (c === 'M') subpaths++;
    pts.push({ x: v[n - 2], y: v[n - 1] });
  }
  return { pts, closed, subpaths };
}

function tools(t) {
  const { evalJs, waitFor, clickEl, clickWorld } = t;
  const D = t.phone ? 'phone' : 'desktop';
  // centre the Prepare view on a world point (left of the card on a phone), then tap / click it: the target's card
  const pick = async (x, y, w = 160) => {
    await evalJs(`window.__prepareView.setView({ x: ${x} + ${t.phone ? 0.22 : 0} * ${w}, y: ${y}, w: ${w} })`);
    await sleep(200);
    await clickWorld(x, y);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, `the card at ${x}, ${y}`);
  };
  const rows = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-row[data-row]')].filter((r) => getComputedStyle(r).display !== 'none' && !('off' in r.dataset)).map((r) => r.dataset.row)`);
  const note = () => evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  const count = (sel) => evalJs(`document.querySelectorAll('#prepare-toolpath-group ${sel}').length`);
  const preset = async (row, v) => { await clickEl(`#prepare-panel .cut-row[data-row="${row}"] .cut-preset[data-value="${v}"]`); await sleep(250); };
  const presetBoxes = (row) => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-row[data-row="${row}"] .cut-preset')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent + (b.classList.contains('is-active') ? '*' : ''), Math.round(r.width), Math.round(r.height)]; })`);
  const pageSvg = () => evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/apps/shaper/src/cut-plan.js').then((C) => m.shaperSvgOf(window.__designController.state, C.cutPlanEntries())))`);
  const unit = () => evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit())`);
  return { D, pick, rows, note, count, preset, presetBoxes, pageSvg, unit };
}

async function drawShapes(t, js) {
  const { evalJs, waitFor, openMode } = t;
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const poly = (name, pts, closed = true) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] }); };
    ${js}
    st.saveState('draw');
  })()`);
  await openMode('prepare');
  if (t.phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await t.clickEl('#prepare-ops .ops-head'); // the folded bar keeps the card free
}

/** The On line outline: Lead-in (Off | On, Length, Side), then Tabs on a second outline; Generate = the owner's test file (desktop, inches); Export 2D / 3D. */
export async function linePhase(t, label, { ownerFile = null } = {}) {
  const { evalJs, waitFor, clickEl, pickType, typeField, shot, shotWorld, download, openMode, fileElements } = t;
  const { D, pick, rows, note, count, preset, presetBoxes, pageSvg, unit } = tools(t);
  // two 1 in squares (the owner's machine test): A at 0..1 in, B at 1.5..2.5 in
  await drawShapes(t, `poly('A', [[0, 0], [${IN}, 0], [${IN}, ${IN}], [0, ${IN}]]); poly('B', [[${1.5 * IN}, 0], [${2.5 * IN}, 0], [${2.5 * IN}, ${IN}], [${1.5 * IN}, ${IN}]]);`);
  const inch = (await unit()) === 'in';
  const u = inch ? 'in' : 'mm';
  // A: On line, depth 1/8 in (3 mm), the bit 1/8 in (the default)
  await pick(IN / 2, IN / 2);
  await pickType('online');
  await typeField('.cut-depth', inch ? '0.125' : '3');
  let r = await rows();
  assert.ok(r.includes('leadIn') && r.includes('holdPart') && !r.includes('leadInRadius') && !r.includes('leadInSweep') && !r.includes('leadInLength') && !r.includes('leadInSide') && !r.includes('tabCount'), label + ': On line outline: the Lead-in and Hold part rows, Off: ' + JSON.stringify(r));
  assert.strictEqual(await count('circle'), 0, label + ': a closed line: no dot (no start point on the Origin)');
  let boxes = await presetBoxes('leadIn');
  console.log(label + ' Lead-in choice: ' + JSON.stringify(boxes));
  assert.deepStrictEqual(boxes.map((b) => b[0]), ['Off*', 'On'], label + ': Off | On, Off active');
  if (t.phone) for (const [n, w, h] of boxes) assert.ok(w >= 44 && h >= 44, `${label}: the ${n} button is ${w} x ${h} (44 px on a phone)`);
  await preset('leadIn', 'true');
  r = await rows();
  assert.ok(r.includes('leadInRadius') && r.includes('leadInSweep') && r.includes('leadInLength') && r.includes('leadInSide') && r.includes('leadInAt'), label + ': On: Radius + Sweep + Length + Side + Position');
  boxes = await presetBoxes('leadInSide');
  assert.deepStrictEqual(boxes.map((b) => b[0]), ['Outside*', 'Inside'], label + ': Side Outside | Inside');
  if (t.phone) for (const [n, w, h] of boxes) assert.ok(w >= 44 && h >= 44, `${label}: the ${n} button is ${w} x ${h}`);
  await typeField('.cut-lead-radius', inch ? '0.25' : '6');
  const len = inch ? '0.25' : '6';
  await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => d.textContent.includes('lead-in arc, radius ${len} ${u}'))`, label + ': the lead-in note');
  assert.deepStrictEqual(await note(), [`On line: lead-in arc, radius ${len} ${u}, 90° outside, from the middle of the longest straight edge`, TRADE_OFF], label + ': the note: the arc and the trade-off');
  assert.deepStrictEqual([await count('.sk-lead-leg'), await count('.sk-lead-tip'), await count('.sk-lead-end')], [1, 1, 1], label + ': Prepare: the arc, its tip (the start) and the junction (the other end)');
  await shotWorld(`${D}-prepare-leadin-outside.png`, [-10, -10, IN + 10, IN + 10], 2);
  await shot(`${D}-card-leadin.png`, '#prepare-panel .cut-card', 2);
  await preset('leadInSide', 'inside');
  const insideD = fileElements(await pageSvg())[0][1];
  const ip = pathPoints(insideD).pts[0];
  assert.ok(ip.x > 0 && ip.x < IN && ip.y > 0 && ip.y < IN, label + ': Inside: the tip is inside the square ' + JSON.stringify(ip));
  await shotWorld(`${D}-prepare-leadin-inside.png`, [-10, -10, IN + 10, IN + 10], 2);
  await preset('leadInSide', 'outside');
  // B: On line + Tabs (3)
  await pick(2 * IN, IN / 2);
  await pickType('online');
  await typeField('.cut-depth', inch ? '0.125' : '3');
  await preset('holdPart', 'tabs');
  await typeField('.cut-tab-count', '3');
  r = await rows();
  assert.ok(r.includes('tabCount') && r.includes('tabWidth') && !r.includes('holdThickness') && !r.includes('leadIn'), label + ': On line Tabs: count + width, no thickness, no Lead-in: ' + JSON.stringify(r));
  const tw = inch ? '0.375' : '10', left = inch ? '0.25' : '6.825', bit = inch ? '0.125' : '3.175';
  await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => d.textContent.startsWith('Tabs: 3 gaps'))`, label + ': the tabs note');
  assert.deepStrictEqual(await note(), [`Tabs: 3 gaps of ${tw} ${u} left uncut; cut them by hand afterwards`, `Each gap keeps ${left} ${u} of wood with a ${bit} ${u} bit (the gap minus the bit)`], label + ': the tabs note');
  assert.deepStrictEqual([await count('.sk-stroke'), await count('.sk-tab-mark')], [3, 3], label + ': Prepare: 3 strokes, 3 tab marks');
  await shotWorld(`${D}-prepare-tabs.png`, [1.5 * IN - 10, -10, 2.5 * IN + 10, IN + 10], 2);
  await shot(`${D}-card-tabs.png`, '#prepare-panel .cut-card', 2);
  // Generate: the downloaded file == the page's derivation; A = ONE open path (M tip A ... junction, round, back), B = 3 open strokes
  const file = await download();
  assert.strictEqual(file, await pageSvg(), label + ': the downloaded file is the one derivation\'s');
  fs.writeFileSync(path.join(t.EVIDENCE_DIR, `${D}-download.svg`), file);
  if (ownerFile) { fs.writeFileSync(ownerFile, file); console.log('owner test file ' + ownerFile); }
  const els = fileElements(file);
  const depth = inch ? '0.125 in' : '3.000 mm';
  assert.deepStrictEqual(els.map((e) => [e[2], e[3]]), Array(4).fill(['online', depth]), label + ': 4 on-line paths at ' + depth);
  const a = pathPoints(els[0][1]);
  assert.ok(!a.closed && a.subpaths === 1 && els[0][1].includes(' A ') && Math.abs(Math.hypot(a.pts[0].x - a.pts[1].x, a.pts[0].y - a.pts[1].y) - (inch ? 6.35 : 6) * Math.SQRT2) < 1e-3 && a.pts.at(-1).x === a.pts[1].x && a.pts.at(-1).y === a.pts[1].y,
    label + ': A = ONE open path: M tip A ... junction, round, back to the junction: ' + els[0][1]);
  assert.ok(els.slice(1).every((e) => { const p = pathPoints(e[1]); return !p.closed && p.subpaths === 1; }), label + ': B = 3 open strokes');
  assert.ok(!/data-/.test(file), label + ': no data-* in the file');
  console.log(label + ' download: ' + file);
  // Export 2D: the labels and rows say lead-in arc / strokes (tabs); its elements == the file's
  const ex = await t.export2d(label);
  console.log(label + ' 2D rows: ' + JSON.stringify(ex.rows));
  const labels = await evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).map((it) => [m.itemLabel(it), it.el.getAttribute('d')]))`);
  console.log(label + ' 2D labels: ' + JSON.stringify(labels.map((l) => l[0])));
  assert.ok(labels.some((l) => /lead-in arc$/.test(l[0])) && labels.filter((l) => /stroke \d of 3 \(tabs\)$/.test(l[0])).length === 3, label + ': 2D labels: lead-in arc, stroke k of 3 (tabs)');
  assert.deepStrictEqual(labels.map((l) => l[1]).sort(), els.map((e) => e[1]).sort(), label + ': the 2D elements are the file\'s (geometry)');
  assert.ok(ex.rows.some((t0) => /lead-in arc/.test(t0)) && ex.rows.some((t0) => /strokes \(tabs\)/.test(t0)), label + ': the 2D list rows');
  await shot(`${D}-export-2d.png`, t.phone ? null : '#review-stage', t.phone ? 1 : 1.5);
  // Export 3D: the info has the lead-in and the tabs notes; the tabs stand
  await clickEl('#review-view-3d');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the 3D board');
  const info = await evalJs(`document.getElementById('review-info').textContent`);
  console.log(label + ' 3D info: ' + info);
  assert.ok(info.includes(TRADE_OFF) && info.includes(`Tabs: 3 gaps of ${tw} ${u} left uncut`), label + ': the 3D info: the lead-in and the tabs');
  await clickEl('#review-top');
  await sleep(600);
  await shot(`${D}-export-3d.png`, t.phone ? null : '#review-stage', t.phone ? 1 : 1.5);
  await openMode('prepare');
}

/** TASK 778: A programmed pocket with Loop on has NO Lead-in row and stays closed; it shows 1 pocket start mark target in Prepare and 1 guide start mark in export;
 *  Spiral / Raster / Morphed spiral; an island pocket; an open line has no Lead-in row. */
export async function pocketPhase(t, label, { patterns = ['linked', 'raster', 'morphed'], island = true } = {}) {
  const { evalJs, pickType, typeField, shot, shotWorld, pickClearing, setLoop, fileElements } = t;
  const { D, pick, rows, note, count, pageSvg, unit } = tools(t);
  await drawShapes(t, `poly('P', [[0, 0], [100, 0], [100, 60], [0, 60]]); poly('I', [[0, 80], [100, 80], [100, 140], [0, 140]]); poly('Ii', [[40, 100], [60, 100], [60, 120], [40, 120]]);
    poly('C', [[120, 0], [170, 0], [170, 40]], false);`);
  const u = await unit();
  await pick(10, 10);
  await pickType('pocket');
  await typeField('.cut-depth', u === 'in' ? '0.25' : '6');
  await typeField('.cut-bit', u === 'in' ? '0.25' : '6');
  for (const pat of patterns) {
    await pickClearing(pat);
    await setLoop(true);
    const r = await rows();
    assert.ok(!r.includes('leadIn') && !r.includes('leadInRadius') && !r.includes('leadInLength'), label + ` ${pat}: pocket has NO Lead-in row: ` + JSON.stringify(r));
    assert.strictEqual(await count('circle'), 0, label + ` ${pat}: a closed loop: no dot (no start point)`);
    assert.strictEqual(await count('.sk-pocket-start'), 1, label + ` ${pat}: 1 pocket start mark target in Prepare`);
    assert.ok(/\+ wall: one closed loop,/.test((await note())[0]), label + ` ${pat}: the note says one closed loop, nothing about where it starts: ` + (await note())[0]);
    const els = fileElements(await pageSvg());
    const online = els.filter((e) => e[2] === 'online'), guides = els.filter((e) => e[2] === 'guide');
    assert.ok(online.length === 1 && /Z$/.test(online[0][1]) && guides.length === 1, label + ` ${pat}: ONE closed on-line loop + 1 guide start mark`);
    await shotWorld(`${D}-prepare-pocket-${pat}-startmark.png`, [-6, -6, 106, 66], 2);
  }
  await shot(`${D}-card-pocket-startmark.png`, '#prepare-panel .cut-card', 2);
  if (island) {
    await pick(10, 90);
    await pickType('pocket');
    await typeField('.cut-depth', u === 'in' ? '0.25' : '6');
    await typeField('.cut-bit', u === 'in' ? '0.25' : '6');
    await pickClearing('linked');
    await setLoop(true);
    const n = await note();
    const loops = Number((/(\d+) closed loops/.exec(n[0]) || [])[1]);
    assert.ok(loops > 1 && await count('.sk-pocket-start') === 1, label + `: the island pocket: ${loops} closed loops, 1 start mark on the selected pocket: ` + n[0]);
    await shotWorld(`${D}-prepare-pocket-island-startmark.png`, [-6, 74, 106, 146], 2);
  }
  // an open line: it has its ends: no Lead-in row
  await pick(145, 0, 120);
  await pickType('online');
  const r = await rows();
  assert.ok(!r.includes('leadIn') && r.includes('holdPart'), label + ': an open line: no Lead-in row, the Hold part row: ' + JSON.stringify(r));
}

/** Fusion mode: the drafted-pocket payload; the pocket with Spiral + Loop (no Lead-in row, 1 start mark), the outline On line with a lead-in arc; the download. */
export async function fusionPhase(t) {
  const { evalJs, waitFor, setUnit, clickWorld, pickClearing, setLoop, pickType, shotWorld, shot, fileElements } = t;
  const { count, preset, rows, pageSvg } = tools(t);
  await setUnit('mm');
  await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fs.readFileSync(new URL('../fixtures/sa7-slope/02-drafted-pocket.json', import.meta.url), 'utf8'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: the drafted pocket imported');
  await clickWorld(60, -40);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion: the pocket\'s card');
  await pickClearing('linked');
  await setLoop(true);
  assert.ok(!(await rows()).includes('leadIn'), 'Fusion: pocket has NO Lead-in row');
  assert.strictEqual(await count('circle'), 0, 'Fusion: a closed loop: no dot');
  assert.strictEqual(await count('.sk-pocket-start'), 1, 'Fusion: 1 pocket start mark');
  await shotWorld('fusion-prepare-pocket-startmark.png', [24, -66, 96, -14], 2);
  await clickWorld(10, -10); // the outline region
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Outside'`, 'Fusion: the outline\'s card');
  await pickType('online');
  assert.ok((await rows()).includes('leadIn'), 'Fusion: On line outline: the Lead-in row');
  await preset('leadIn', 'true');
  assert.deepStrictEqual([await count('.sk-lead-tip'), await count('.sk-lead-leg')], [1, 1], 'Fusion: the outline\'s arc and tip');
  await shot('fusion-card-leadin.png', '#prepare-panel .cut-card', 2);
  await shotWorld('fusion-prepare-outline-leadin.png', [-12, -92, 132, 12], 2);
  const all = fileElements(await pageSvg());
  const online = all.filter((e) => e[2] === 'online'), guides = all.filter((e) => e[2] === 'guide');
  console.log('Fusion download (on line paths): ' + JSON.stringify(online.map((e) => e[1].slice(0, 60))));
  assert.ok(online.length === 2 && online.filter((e) => /Z$/.test(e[1])).length === 1 && online.filter((e) => !/Z$/.test(e[1]) && e[1].includes(' A ')).length === 1 && guides.length === 1,
    'Fusion: 1 closed pocket loop + 1 open outline lead-in arc + 1 guide start mark');
}

/** TASK 775 (added): the card's note (and the operations row) follow a document-unit change made in the Settings panel, without reselecting. */
export async function unitsPhase(t, label) {
  const { evalJs, waitFor, clickEl, pickType, typeField, pickClearing, shot } = t;
  const { pick, note } = tools(t);
  await drawShapes(t, `poly('P', [[0, 0], [100, 0], [100, 60], [0, 60]]);`);
  await pick(10, 10);
  await pickType('pocket');
  await typeField('.cut-depth', '0.25');
  await typeField('.cut-bit', '0.25');
  await pickClearing('linked');
  const before = await note();
  console.log(label + ' note (in): ' + JSON.stringify(before));
  assert.ok(/stepover 0\.1 in/.test(before[0]) && /in\/min/.test(before[0]) && before.includes('Drawn for a 0.25 in bit: a smaller bit leaves ridges'), label + ': the note in inches');
  await shot('units-before-note.png', '#prepare-panel .cut-card', 2);
  // Settings > Units > Document Unit = mm (the real control)
  const P = '.sk-style-panel';
  await clickEl('.sk-sidebar-btn'); await sleep(300);
  await clickEl('.sk-sidebar [data-action="settings"], .sk-sidebar [data-action="style"]');
  await waitFor(`!!document.querySelector('${P}') && !document.querySelector('${P}').classList.contains('sk-hidden')`, label + ': the Settings panel');
  await clickEl(`${P} .sk-style-tab[data-tab="units"]`);
  await evalJs(`(() => { const s = document.querySelector('${P} [data-key="DOC_UNIT"]'); s.value = 'mm'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(400);
  await clickEl(`${P} .sk-style-foot .sk-style-btn:last-child`); // close the panel; the pocket stays selected
  await sleep(300);
  const after = await note();
  console.log(label + ' note (mm, no reselect): ' + JSON.stringify(after));
  assert.strictEqual(await evalJs(`document.querySelector('.cut-bit').value`), '6.35', label + ': the bit field reads mm');
  assert.ok(/stepover 2\.54 mm/.test(after[0]) && /mm\/min/.test(after[0]) && after.includes('Drawn for a 6.35 mm bit: a smaller bit leaves ridges') && !after.some((x) => /\d in\b|in\/min|in²/.test(x)), label + ': the note reads mm at once: ' + JSON.stringify(after));
  const ops = await evalJs(`[...document.querySelectorAll('#prepare-ops [data-id]')].map((e) => e.textContent).join(' | ')`);
  assert.ok(/6\.35 mm/.test(ops) && !/\d in\b/.test(ops), label + ': the operations row reads mm: ' + ops);
  await shot('units-after-note.png', '#prepare-panel .cut-card', 2);
  // a key-less settings change (a load / a reset / settings from another device): back to the defaults (mm) from cm
  await t.setUnit('cm');
  await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => / cm/.test(d.textContent))`, label + ': the note in cm');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.resetToDefaults())`);
  await sleep(400);
  const reset = await note();
  console.log(label + ' note after a key-less change: ' + JSON.stringify(reset));
  assert.ok(!reset.some((x) => / cm\b/.test(x)), label + ': a key-less settings change rebuilds the note too');
}
