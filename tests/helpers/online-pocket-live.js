// tests/helpers/online-pocket-live.js — TASK 775: On line TABS, a plain On line outline and the Loop's dots / the pocket START MARK in the real Shaper page, shared
// by the split live files (each a fresh headless browser + server, well under 40 s alone). (Renamed from tests/helpers/leadin-live.js in TASK 836: its lead-in
// parts went with the lead-in, owner ruling 2026-11-20.)
//   tests/online-tabs-775-live.test.js         desktop 1280 x 800, mouse, INCHES: linePhase (a plain On line outline and On line tabs; Generate; Export 2D / 3D)
//   tests/online-tabs-775-phone-live.test.js   phone 390 x 844, touch, mm: linePhase
//   tests/pocket-startmark-775-live.test.js    desktop, mm: pocketPhase (Spiral / Raster / Morphed spiral + Loop: no dot, 1 start mark; an island pocket; an open line)
//   tests/pocket-startmark-775-phone-live.test.js  phone: pocketPhase (Spiral)
//   tests/pocket-startmark-775-fusion-live.test.js Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 drafted-pocket payload): fusionPhase
//   tests/note-units-775-live.test.js          desktop: unitsPhase (the card's note follows a document-unit change)
// The page tools are tests/helpers/pocket-live.js openPocketPage's. Screenshots to .evidence/775/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { openPocketPage } from './pocket-live.js';
import { sleep } from './cdp-browser.js';
import { REVIEW_BUILT } from './review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)

const IN = 25.4;

/** The page (EVIDENCE_DIR .evidence/775; the 3D view needs swiftshader in headless). */
export const openOnlinePocketPage = (o) => openPocketPage({ ...o, evidenceDir: path.resolve('.evidence/775'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

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
  // centre the Prepare view on a world point (left of the card on a phone), then tap / click it: the target SELECTED (TASK S3: a shape with no operation shows no card;
  // pocket-live.js clickWorld opens the operation of a shape that has one; a new one is the toolbar's, pickType)
  const pick = async (x, y, w = 160) => {
    await evalJs(`window.__prepareView.setView({ x: ${x} + ${t.phone ? 0.22 : 0} * ${w}, y: ${y}, w: ${w} })`);
    await sleep(200);
    await clickWorld(x, y);
    await waitFor(`window.__prepareView.selectedTargets().length > 0`, `the shape at ${x}, ${y} selected`);
  };
  const rows = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-row[data-row]')].filter((r) => getComputedStyle(r).display !== 'none' && !('off' in r.dataset)).map((r) => r.dataset.row)`);
  const note = () => evalJs(`[...document.querySelectorAll('.cut-note div')].sort((a, b) => !!a.querySelector('.cut-note-warn') - !!b.querySelector('.cut-note-warn')).map((d) => d.textContent)`); // TASK 825: the card lists its warning lines FIRST; read the facts first, the warnings after (a stable sort), as these tests were written
  const count = (sel) => evalJs(`document.querySelectorAll('#prepare-toolpath-group ${sel}').length`);
  const preset = async (row, v) => { await clickEl(`#prepare-panel .cut-row[data-row="${row}"] .cut-preset[data-value="${v}"]`); await sleep(250); };
  const presetBoxes = (row) => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-row[data-row="${row}"] .cut-preset')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent + (b.classList.contains('is-active') ? '*' : ''), Math.round(r.width), Math.round(r.height)]; })`);
  const pageSvg = () => evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/tests/helpers/plan-v2.js').then((C) => m.shaperSvgOf(window.__designController.state, C.planEntries())))`);
  const unit = () => evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit())`);
  return { D, pick, rows, note, count, preset, presetBoxes, pageSvg, unit };
}

async function drawShapes(t, js) {
  const { evalJs, waitFor, openMode } = t;
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
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

/** A plain On line outline (no Lead-in row: TASK 836), then Tabs on a second outline; Generate; Export 2D / 3D. */
export async function linePhase(t, label) {
  const { evalJs, waitFor, clickEl, pickType, typeField, shot, shotWorld, download, openMode, fileElements } = t;
  const { D, pick, rows, note, count, preset, pageSvg, unit } = tools(t);
  // two 1 in squares (the owner's machine test): A at 0..1 in, B at 1.5..2.5 in
  await drawShapes(t, `poly('A', [[0, 0], [${IN}, 0], [${IN}, ${IN}], [0, ${IN}]]); poly('B', [[${1.5 * IN}, 0], [${2.5 * IN}, 0], [${2.5 * IN}, ${IN}], [${1.5 * IN}, ${IN}]]);`);
  const inch = (await unit()) === 'in';
  const u = inch ? 'in' : 'mm';
  // A: On line, depth 1/8 in (3 mm), the bit 1/8 in (the default): the Hold part row, no Lead-in row (TASK 836)
  await pick(IN / 2, IN / 2);
  await pickType('online');
  await typeField('.cut-depth', inch ? '0.125' : '3');
  let r = await rows();
  assert.ok(r.includes('holdPart') && !r.some((x) => /^leadIn/.test(x)) && !r.includes('tabCount'), label + ': On line outline: the Hold part row (Off), no Lead-in row: ' + JSON.stringify(r));
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-panel .cut-row[data-row^="leadIn"]').length`), 0, label + ': no Lead-in row in the card (TASK 836)');
  assert.strictEqual(await count('circle'), 0, label + ': a closed line: no dot (no start point on the Origin)');
  await shot(`${D}-card-online.png`, '#prepare-panel .cut-card', 2);
  // B: On line + Tabs (3)
  await pick(2 * IN, IN / 2);
  await pickType('online');
  await typeField('.cut-depth', inch ? '0.125' : '3');
  await preset('holdPart', 'tabs');
  await typeField('.cut-tab-count', '3');
  r = await rows();
  assert.ok(r.includes('tabCount') && r.includes('tabWidth') && !r.includes('holdThickness'), label + ': On line Tabs: count + width, no thickness: ' + JSON.stringify(r));
  const tw = inch ? '0.375' : '10', left = inch ? '0.25' : '6.825', bit = inch ? '0.125' : '3.175';
  await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => d.textContent.startsWith('Tabs: 3 gaps'))`, label + ': the tabs note');
  assert.deepStrictEqual(await note(), [`Tabs: 3 gaps of ${tw} ${u} left uncut; cut them by hand afterwards`, `Each gap keeps ${left} ${u} of wood with a ${bit} ${u} bit (the gap minus the bit)`], label + ': the tabs note');
  assert.deepStrictEqual([await count('.sk-stroke'), await count('.sk-tab-mark')], [3, 3], label + ': Prepare: 3 strokes, 3 tab marks');
  await shotWorld(`${D}-prepare-tabs.png`, [1.5 * IN - 10, -10, 2.5 * IN + 10, IN + 10], 2);
  await shot(`${D}-card-tabs.png`, '#prepare-panel .cut-card', 2);
  // Generate: the downloaded file == the page's derivation; A = ONE closed path, B = 3 open strokes
  const file = await download();
  assert.strictEqual(file, await pageSvg(), label + ': the downloaded file is the one derivation\'s');
  fs.writeFileSync(path.join(t.EVIDENCE_DIR, `${D}-download.svg`), file);
  const els = fileElements(file);
  const depth = inch ? '0.125 in' : '3.000 mm';
  assert.deepStrictEqual(els.map((e) => [e[2], e[3]]), Array(4).fill(['online', depth]), label + ': 4 on-line paths at ' + depth);
  const a = pathPoints(els[0][1]);
  assert.ok(a.closed && a.subpaths === 1 && !els[0][1].includes(' A '), label + ': A = ONE closed path, the plain loop (no lead-in): ' + els[0][1]);
  assert.ok(els.slice(1).every((e) => { const p = pathPoints(e[1]); return !p.closed && p.subpaths === 1; }), label + ': B = 3 open strokes');
  assert.ok(!/data-/.test(file), label + ': no data-* in the file');
  console.log(label + ' download: ' + file);
  // Export 2D: the labels and rows say strokes (tabs), nothing of a lead-in; its elements == the file's
  const ex = await t.export2d(label);
  console.log(label + ' 2D rows: ' + JSON.stringify(ex.rows));
  const labels = await evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).map((it) => [m.itemLabel(it), it.el.getAttribute('d')]))`);
  console.log(label + ' 2D labels: ' + JSON.stringify(labels.map((l) => l[0])));
  assert.ok(!labels.some((l) => /lead/.test(l[0])) && labels.filter((l) => /stroke \d of 3 \(tabs\)$/.test(l[0])).length === 3, label + ': 2D labels: stroke k of 3 (tabs), no lead-in');
  assert.deepStrictEqual(labels.map((l) => l[1]).sort(), els.map((e) => e[1]).sort(), label + ': the 2D elements are the file\'s (geometry)');
  assert.ok(!ex.rows.some((t0) => /lead/.test(t0)) && ex.rows.some((t0) => /strokes \(tabs\)/.test(t0)), label + ': the 2D list rows');
  await shot(`${D}-export-2d.png`, t.phone ? null : '#review-stage', t.phone ? 1 : 1.5);
  // Export 3D: the info has the tabs note, nothing of a lead-in; the tabs stand
  await clickEl('#review-view-3d');
  await waitFor(REVIEW_BUILT, label + ': the 3D board');
  const info = await evalJs(`document.getElementById('review-info').textContent`);
  console.log(label + ' 3D info: ' + info);
  assert.ok(!/lead-in/i.test(info) && info.includes(`Tabs: 3 gaps of ${tw} ${u} left uncut`), label + ': the 3D info: the tabs, no lead-in');
  await clickEl('#review-top');
  await sleep(600);
  await shot(`${D}-export-3d.png`, t.phone ? null : '#review-stage', t.phone ? 1 : 1.5);
  await openMode('prepare');
}

/** TASK 778: A programmed pocket with Loop on stays closed; it shows 1 pocket start mark target in Prepare and 1 guide start mark in export;
 *  Spiral / Raster / Morphed spiral; an island pocket; an open line has the Hold part row. */
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
    assert.strictEqual(await count('circle'), 0, label + ` ${pat}: a closed loop: no dot (no start point)`);
    assert.strictEqual(await count('.sk-pocket-start'), 1, label + ` ${pat}: 1 pocket start mark target in Prepare`);
    // TASK 835e: Raster's Loop = one closed loop per area (the rectangle: one), its finish the Origin's native inside cut
    assert.ok(/\+ wall: one closed loop,/.test((await note())[0]), label + ` ${pat}: the note says one closed loop, nothing about where it starts: ` + (await note())[0]);
    const els = fileElements(await pageSvg());
    const online = els.filter((e) => e[2] === 'online'), guides = els.filter((e) => e[2] === 'guide'), inside = els.filter((e) => e[2] === 'inside');
    assert.ok(online.length === 1 && online.every((e) => /Z$/.test(e[1])) && guides.length === 1 && inside.length === 1, label + ` ${pat}: ONE closed on-line loop + 1 guide start mark + the Origin's native inside cut (TASK 835e / 850)`);
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
    assert.ok(/\+ wall: one closed loop,/.test(n[0]) && await count('.sk-pocket-start') === 1, label + `: the island pocket: ONE closed loop (TASK 850), 1 start mark on the selected pocket: ` + n[0]);
    await shotWorld(`${D}-prepare-pocket-island-startmark.png`, [-6, 74, 106, 146], 2);
  }
  // an open line: the Hold part row
  await pick(145, 0, 120);
  await pickType('online');
  const r = await rows();
  assert.ok(r.includes('holdPart'), label + ': an open line: the Hold part row: ' + JSON.stringify(r));
}

/** Fusion mode: the drafted-pocket payload; the pocket with Spiral + Loop (1 start mark), the outline On line (a plain closed loop: TASK 836); the download. */
export async function fusionPhase(t) {
  const { evalJs, waitFor, setUnit, clickWorld, pickClearing, setLoop, pickType, shotWorld, shot, fileElements } = t;
  const { count, pageSvg } = tools(t);
  await setUnit('mm');
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fs.readFileSync(new URL('../fixtures/sa7-slope/02-drafted-pocket.json', import.meta.url), 'utf8'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: the drafted pocket imported');
  await clickWorld(60, -40);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion: the pocket\'s card');
  await pickClearing('linked');
  await setLoop(true);
  assert.strictEqual(await count('circle'), 0, 'Fusion: a closed loop: no dot');
  assert.strictEqual(await count('.sk-pocket-start'), 1, 'Fusion: 1 pocket start mark');
  await shotWorld('fusion-prepare-pocket-startmark.png', [24, -66, 96, -14], 2);
  await clickWorld(10, -10); // the outline region
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Outside'`, 'Fusion: the outline\'s card');
  await pickType('online');
  await shot('fusion-card-online.png', '#prepare-panel .cut-card', 2);
  await shotWorld('fusion-prepare-outline-online.png', [-12, -92, 132, 12], 2);
  const all = fileElements(await pageSvg());
  const online = all.filter((e) => e[2] === 'online'), guides = all.filter((e) => e[2] === 'guide');
  console.log('Fusion download (on line paths): ' + JSON.stringify(online.map((e) => e[1].slice(0, 60))));
  assert.ok(online.length === 2 && online.every((e) => /Z$/.test(e[1])) && guides.length === 1,
    'Fusion: 1 closed pocket loop + 1 closed outline loop + 1 guide start mark');
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
