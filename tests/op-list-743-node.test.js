// tests/op-list-743-node.test.js — TASK 743: Shaper's OPERATIONS (apps/shaper/src/operations.js): a DISPLAY grouping of the cut plan (owner ruling on the
// send-back: "I didn't mean to use actual SVG groups, just display groups as toolpaths"). The downloaded file never changes.
//  1. derivation: records -> operations on a drawn plate with mixed tools (⅛ in / ¼ in end mills, a 6 mm ball nose, a ¼ in 60° V-bit), types (Guide, On line,
//     Pocket, Inside, Outside with Tabs) and settings (two equal pockets = ONE operation of 2 regions; the same pocket with an offset = another); the labels;
//     the default order (Not cut first; then tools by the highest rank of their cuts, so the bit that frees the part is last; in a tool on line, pockets,
//     inside, outside, shallow before deep); a stored order is kept and a NEW operation slots in by the default rule (with its tool's operations when the
//     order has some, else after its default-order predecessor);
//  2. a stepped operation (the SA-7 R3 floor fillet as a Stepped pocket, adaptive Coarse) shows its steps;
//  3. the DOWNLOAD is byte-identical to the pre-743 export (the exporter called as export-payload.js called it on main 10b923f: plan entries, groupByCut) on
//     the mixed plate, the real Fusion solid (711), the R3 stepped pocket and a tabbed plate, before AND after a reorder; the PREVIEW copy (the 2D view's)
//     is the pre-743 preview copy plus data-op="<operation id>" on each element, and maps every element to its operation (previewRows with the operations);
//  5. the app: the list (tool headings, rows), a tap selects the operation's regions, ↓ reorders as ONE undo step (Ctrl+Z / Ctrl+Y), the autosave stores the
//     order, a reload restores it; the download unchanged by the reorders.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { CUT_PLAN, cutPlanEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { planOperations, defaultOpOrder, opOrder, setOpOrder } from '../apps/shaper/src/operations.js';
import { shaperSvgOf, shaperPreviewOf } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems, previewRows } from '../apps/shaper/src/export-preview.js';
import { captureShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ── the drawn design: a 300 x 150 plate, two holes, four pockets, a slot line, a guide line ──
function design() {
  const joints = new Map(), shapes = [];
  const rect = (name, x0, y0, x1, y1) => { [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => joints.set(name + 'j' + i, { x, y }));
    for (let i = 0; i < 4; i++) shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % 4)] }); };
  const circle = (id, x, y, r) => { joints.set(id + 'o', { x, y }); shapes.push({ id, type: 'circle', joints: [id + 'o'], radius: r }); };
  const line = (id, a, b) => { joints.set(id + 'a', { x: a[0], y: a[1] }); joints.set(id + 'b', { x: b[0], y: b[1] }); shapes.push({ id, type: 'line', joints: [id + 'a', id + 'b'] }); };
  rect('PL', 0, 0, 300, 150);
  rect('PA', 20, 20, 70, 60); rect('PB', 90, 20, 140, 60); rect('PC', 230, 20, 280, 60); rect('PD', 160, 20, 210, 60);
  circle('HA', 40, 110, 8); circle('HB', 260, 110, 8);
  line('SL', [100, 110], [200, 110]); line('GL', [100, 135], [200, 135]);
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const keysOf = (st) => {
  const loops = findLoops(st), chains = findOpenChains(st, loops);
  const loop = (shapeId) => keyOf('loop', loops.find((l) => l.edges.includes(shapeId)).id);
  const chain = (shapeId) => keyOf('chain', chains.find((c) => c.shapes.some((s) => s.id === shapeId)).id);
  return { plate: loop('PLs0'), ha: loop('HA'), hb: loop('HB'), pa: loop('PAs0'), pb: loop('PBs0'), pc: loop('PCs0'), pd: loop('PDs0'), slot: chain('SL'), guide: chain('GL') };
};
const rec = (cutType, cutDepth, toolDia, more = {}) => ({ cutType, cutDepth, cutOffset: 0, toolDia, cutterShape: 'endmill', cutterAngle: 90, ...more });
function plan(K) {
  CUT_PLAN.clear();
  CUT_PLAN.set(K.plate, rec('exterior', 19.05, 6.35, { holdPart: 'tabs', tabCount: 'auto', tabWidth: 10, holdThickness: 2 }));
  CUT_PLAN.set(K.ha, rec('interior', 19.05, 3.175));
  CUT_PLAN.set(K.pa, rec('pocket', 6.35, 6.35));
  CUT_PLAN.set(K.guide, rec('guide', 'unset', 3.175));
  CUT_PLAN.set(K.pb, rec('pocket', 6.35, 6.35, { cutOffset: 0.5 }));
  CUT_PLAN.set(K.hb, rec('interior', 19.05, 3.175));
  CUT_PLAN.set(K.pd, rec('pocket', 3.175, 6, { cutterShape: 'ballnose' }));
  CUT_PLAN.set(K.pc, rec('pocket', 6.35, 6.35));
  CUT_PLAN.set(K.slot, rec('online', 1.5875, 6.35, { cutterShape: 'vbit', cutterAngle: 60 }));
}
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
// the export written as before task 743: the plan's entries in plan order, groupByCut (the page's call, export-payload.js before this task)
const before743 = (st) => exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: SettingsManager.get('DOC_UNIT'), options: { groupByCut: true }, loopPolys: polysOf(st) });
// the pre-743 PREVIEW copy (TASK 718's call with preview: true)
const before743Preview = (st) => exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: SettingsManager.get('DOC_UNIT'), options: { groupByCut: true, previewData: true }, loopPolys: polysOf(st) });
const stripOp = (svg) => svg.replace(/ data-op="[^"]*"/g, '');
// the download and the preview copy against the pre-743 calls, before and after reversing the operation order; the preview's elements map to the operations
function checkFiles(name, st, documentForParse) {
  setOpOrder([]);
  const old = before743(st), oldPv = before743Preview(st);
  const ops = planOperations(st, cutPlanEntries());
  eq(shaperSvgOf(st, cutPlanEntries()), old, `${name}: the download is byte-identical to the pre-743 export`);
  const pv = shaperPreviewOf(st, cutPlanEntries());
  eq(stripOp(pv.svg), oldPv, `${name}: the preview copy is the pre-743 preview copy + data-op only`);
  ok(!/<title>|<g id=/.test(old) && !/data-/.test(shaperSvgOf(st, cutPlanEntries())), `${name}: no <g id>, no <title>, no data-* in the download`);
  // every element carries the id of the operation its record belongs to; the list groups them in the operation order
  const items = previewItems(parseShaperSvg(pv.svg, documentForParse));
  ok(items.length > 0 && items.every((it) => ops.some((o) => o.id === it.op)), `${name}: every preview element names its operation (data-op)`);
  const rows = previewRows(items, pv.ops);
  eq(rows.map((g) => g.op && g.op.id), ops.map((o) => o.id), `${name}: the 2D list = the operations, in their order`);
  for (const g of rows) eq(g.count, g.op.records.reduce((n, r) => n + r.cuts.length, 0), `${name}: ${g.op.label}: its elements = the cuts of its records`);
  // a reorder: the download and the preview copy do not change at all; the list follows the new order
  setOpOrder(ops.map((o) => o.key).reverse());
  eq(shaperSvgOf(st, cutPlanEntries()), old, `${name}: after a reorder the download is byte-identical`);
  const pv2 = shaperPreviewOf(st, cutPlanEntries());
  eq(pv2.svg, pv.svg, `${name}: after a reorder the preview copy is byte-identical`);
  eq(previewRows(previewItems(parseShaperSvg(pv2.svg, documentForParse)), pv2.ops).map((g) => g.op.id), ops.map((o) => o.id).reverse(), `${name}: the 2D list follows the new order`);
  setOpOrder([]);
  console.log(`${name}: download == pre-743 (${old.length} bytes), ${ops.length} operations, ${items.length} elements`);
  return old;
}

SettingsManager.set('DOC_UNIT', 'in');
SettingsManager.set('LENGTH_PRECISION', null);

// ── 1. derivation, labels, the default order, a stored order + a new operation slotting in ──
{
  const st = design(), K = keysOf(st);
  plan(K);
  setOpOrder([]);
  const ops = planOperations(st, cutPlanEntries());
  const view = ops.map((op) => `${op.heading} | ${op.label} | ${op.records.map((r) => Object.entries(K).find(([, k]) => k === r.planKey)[0]).join(',')}`);
  console.log('operations:\n  ' + view.join('\n  '));
  eq(ops.length, 7, '9 records -> 7 operations (the two holes are one, the two equal pockets are one)');
  eq(view.slice(0, 6), [
    'Not cut | Guide (1 path) | guide',
    'Change to ¼″ 60° V-bit | ¼″ 60° V-bit · On line · 0.0625 in (1 path) | slot',
    'Change to 0.2362 in ball nose | 0.2362 in ball nose · Pocket · 0.125 in (1 region) | pd',
    'Change to ⅛″ end mill | ⅛″ end mill · Inside · 0.75 in (2 regions) | ha,hb',
    'Change to ¼″ end mill | ¼″ end mill · Pocket · 0.25 in (2 regions) | pa,pc',
    'Change to ¼″ end mill | ¼″ end mill · Pocket · 0.25 in (1 region) · offset 0.0197 in | pb',
  ], 'the default order: Not cut; the V-bit (its last cut: on line), the ball nose (a pocket), the ⅛ in bit (holes), the ¼ in bit (it frees the part); pockets before the outside');
  ok(/^Change to ¼″ end mill \| ¼″ end mill · Outside · pass 0\.6713 in \+ gaps 0\.75 in \(1 region\) · \d+ gaps \(tabs 0\.3937 in wide, 0\.0787 in thick\) \| plate$/.test(view[6]),
    'the tabbed Outside: its pass + gaps, last: ' + view[6]);
  eq(ops.map((o) => o.id), ['op-guide', 'op-online-1.5875mm-vbit-6.35mm-60deg', 'op-pocket-3.175mm-ballnose-6mm', 'op-interior-19.05mm-endmill-3.175mm', 'op-pocket-6.35mm-endmill-6.35mm',
    'op-pocket-6.35mm-offset-0.5mm-endmill-6.35mm', 'op-exterior-19.05mm-tabs-endmill-6.35mm'], 'the operation ids: type, depth, the settings off their default, tool');
  eq(ops.find((o) => o.cutType === 'exterior').records[0].cuts.filter((c) => c.hold && c.hold.role === 'strip').length, Number(/(\d+) gaps \(/.exec(view[6])[1]), 'the gap count is the derivation\'s');
  // the same operations whatever order the plan holds its records in
  const shuffled = new Map([...CUT_PLAN].reverse());
  eq(planOperations(st, cutPlanEntries(shuffled)).map((o) => o.key), ops.map((o) => o.key), 'the default order does not depend on the plan\'s order');
  eq(defaultOpOrder(ops.slice().reverse()).map((o) => o.key), ops.map((o) => o.key), 'defaultOpOrder sorts any list into it');
  // a stored order is kept as stored
  const stored = ops.map((o) => o.key).reverse();
  setOpOrder(stored);
  eq(planOperations(st, cutPlanEntries()).map((o) => o.key), stored, 'a stored order is followed');
  // a NEW operation with a tool the order already has (a ⅛ in pocket at 1/16 in on pocket C, out of the ¼ in pocket operation): it joins the ⅛ in bit's
  // operations, placed by the in-tool rule (a pocket before the holes), so the bit is not changed twice
  CUT_PLAN.set(K.pc, rec('pocket', 1.5875, 3.175));
  const after = planOperations(st, cutPlanEntries());
  const fresh = after.find((o) => o.label.startsWith('⅛″ end mill · Pocket'));
  ok(fresh, 'the new ⅛ in pocket operation');
  console.log('new op (known tool): ' + after.map((o) => o.label.split(' (')[0]).join(' > '));
  eq(after.findIndex((o) => o.key === fresh.key) + 1, after.findIndex((o) => o.label.startsWith('⅛″ end mill · Inside')), 'it sits right before the ⅛ in Inside (its tool, the in-tool rule)');
  eq(after.filter((o) => o !== fresh).map((o) => o.key), stored, 'the stored operations keep their order');
  eq(after.find((o) => o.label.startsWith('¼″ end mill · Pocket · 0.25 in (1 region)') && !o.detail).records.map((r) => r.planKey), [K.pa], 'pocket A alone in its operation now');
  // a NEW tool (a ½ in end mill on pocket D): no operation of it in the order, so it goes right after its default-order predecessor
  CUT_PLAN.set(K.pd, rec('pocket', 3.175, 12.7));
  const after2 = planOperations(st, cutPlanEntries());
  const half = after2.find((o) => o.tool && o.tool.label === '½″ end mill');
  const def = defaultOpOrder(after2.slice());
  const pred = def[def.findIndex((o) => o.key === half.key) - 1];
  console.log('new op (new tool): ' + half.label + ' | default predecessor: ' + pred.label + ' | order: ' + after2.map((o) => o.label.split(' (')[0]).join(' > '));
  eq(after2.findIndex((o) => o.key === half.key), after2.findIndex((o) => o.key === pred.key) + 1, 'a new tool sits right after its default-order predecessor');
  setOpOrder([]);
}

// ── 3. the mixed plate: the download unchanged, the preview mapped (fixtures in the app part below) ──
{
  const st = design(), K = keysOf(st);
  plan(K);
  const { Window } = await import('happy-dom');
  const win = new Window();
  const svg = checkFiles('mixed plate (tabs on the Outside)', st, win.document);
  // a display precision changes the lists' words, never a file
  SettingsManager.set('LENGTH_PRECISION', 1);
  eq(shaperSvgOf(st, cutPlanEntries()), svg, 'Length precision 1: the download byte-identical');
  eq(planOperations(st, cutPlanEntries()).find((o) => o.cutType === 'interior').rowText, 'Inside · 0.8 in', 'Length precision 1: the list writes 0.8 in');
  SettingsManager.set('LENGTH_PRECISION', null);
  fs.mkdirSync('.evidence/743', { recursive: true });
  fs.writeFileSync('.evidence/743/node-mixed-export.svg', svg);
  await win.happyDOM.close();
}

// ── 2 + 5. the app: a stepped operation; the list, a tap, the reorder as one undo step, save + reload ──
CUT_PLAN.clear(); setOpOrder([]);
{
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
    const [pk, r] = [...CUT_PLAN.entries()].find(([, x]) => x.cutType === 'pocket');
    CUT_PLAN.set(pk, { ...r, cutType: 'stepped-pocket', stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.5 });
    const ops = planOperations(app.state, cutPlanEntries());
    console.log('stepped: ' + JSON.stringify(ops.map((o) => o.label)));
    const stepped = ops.find((o) => o.cutType === 'stepped-pocket');
    eq(stepped.rowText, 'Stepped pocket · 0.2619–0.315 in', 'the stepped operation\'s depths in the doc unit: its first to its last step (6.651 to 8 mm)');
    eq(stepped.detail, '4 steps, adaptive Coarse', 'the stepped operation shows its steps count');
    eq(ops.map((o) => o.cutType), ['stepped-pocket', 'exterior'], 'the stepped pocket before the outside');
    checkFiles('R3 floor fillet, Stepped pocket adaptive Coarse', app.state, app.document);
    CUT_PLAN.clear();
    importFusionSelection(fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
    checkFiles('real Fusion solid (711)', app.state, app.document);
  } finally { CUT_PLAN.clear(); await app.close(); }
}
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Ops 743');
  let listBefore, svgBefore, orderBefore;
  const listOf = (app) => [...app.document.querySelectorAll('#prepare-ops .ops-body > *')].map((e) => (e.classList.contains('ops-tool') ? '# ' + e.textContent : e.querySelector('.ops-num').textContent + '. ' + e.querySelector('.ops-name').textContent + ' | ' + e.querySelector('.ops-sub').textContent));
  {
    const app = await open({ host: 'shaper', profile });
    try {
      const st = app.state, src = design();
      app.press(app.document.querySelector('.sk-header-tab[data-tab="design"]'));
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      for (const [k, v] of src.joints) st.joints.set(k, v);
      st.shapes.push(...src.shapes);
      st.saveState('draw');
      const K = keysOf(st);
      plan(K);
      app.press(app.document.querySelector('.sk-header-tab[data-tab="prepare"]'));
      const svg0 = shaperSvgOf(st, cutPlanEntries());
      const l0 = listOf(app);
      console.log('app list: ' + JSON.stringify(l0));
      eq(l0.filter((t) => t.startsWith('# ')), ['# Not cut', '# Change to ¼″ 60° V-bit', '# Change to 0.2362 in ball nose', '# Change to ⅛″ end mill', '# Change to ¼″ end mill'], 'the list: one heading per tool run');
      eq(l0.filter((t) => !t.startsWith('# ')).length, 7, 'the list: 7 operations');
      eq(app.document.querySelector('#prepare-ops .ops-count').textContent, '7', 'the header counts them');
      // a tap on the holes' operation selects both holes
      const rowOf = (re) => [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => re.test(r.querySelector('.ops-name').textContent));
      app.press(rowOf(/^Inside/).querySelector('.ops-pick'));
      eq([...app.prepare.view().selection.keys()].sort(), [K.ha, K.hb].sort(), 'a tap selects the operation\'s regions');
      ok(rowOf(/^Inside/).classList.contains('is-picked'), 'its row is marked');
      eq(app.document.querySelector('.cut-type-cur').textContent, 'Inside', 'the card shows them');
      // ArrowDown on the first row's grip (TASK 745: no arrow buttons; the focused grip moves its row): ONE undo step; Ctrl+Z / Ctrl+Y
      const gripKey = (grip, key) => { grip.focus(); grip.dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); };
      eq(app.document.querySelectorAll('#prepare-ops .ops-up, #prepare-ops .ops-down, #prepare-ops .ops-move').length, 0, 'TASK 745: no arrow buttons');
      const n0 = st.history.length;
      gripKey(app.document.querySelector('#prepare-ops .ops-row .ops-grip'), 'ArrowDown');
      const l1 = listOf(app);
      eq(l1.filter((t) => !t.startsWith('# ')).slice(0, 2).map((t) => t.split(' | ')[0]), ['1. On line · 0.0625 in', '2. Guide'], '↓ moved Guide below On line');
      eq(st.history.length, n0 + 1, 'the reorder is ONE undo step');
      eq(opOrder().length, 7, 'the order is stored');
      app.undo();
      eq(listOf(app), l0, 'Ctrl+Z: the default order again');
      eq(opOrder(), [], 'Ctrl+Z: no stored order');
      app.redo();
      eq(listOf(app), l1, 'Ctrl+Y: the reorder again');
      // ArrowUp on the last (the Outside) twice: above both ¼ in pockets (the grip keeps the focus: the second ArrowUp goes to the same, moved row)
      gripKey([...app.document.querySelectorAll('#prepare-ops .ops-row .ops-grip')].at(-1), 'ArrowUp');
      ok(app.document.activeElement === [...app.document.querySelectorAll('#prepare-ops .ops-row .ops-grip')].at(-2), 'the grip of the moved row keeps the focus');
      gripKey(app.document.activeElement, 'ArrowUp');
      listBefore = listOf(app);
      console.log('app list after reorders: ' + JSON.stringify(listBefore));
      eq(listBefore.slice(-4), ['# Change to ¼″ end mill', listBefore.at(-3), listBefore.at(-2), listBefore.at(-1)], 'still one ¼ in heading');
      ok(/^5\. Outside/.test(listBefore.at(-3)), 'the Outside is first of the ¼ in bit now');
      orderBefore = opOrder();
      svgBefore = shaperSvgOf(st, cutPlanEntries());
      eq(svgBefore, svg0, 'the download is byte-identical after the reorders');
      eq(svgBefore, before743(st), 'and equal to the pre-743 export');
      const d = await app.storedDoc();
      eq(d.hosts.shaper.opOrder, orderBefore, 'the autosave stores the operation order');
      eq(captureShaperDoc().opOrder, orderBefore, 'captureShaperDoc carries it');
    } finally { await app.close(); }
  }
  CUT_PLAN.clear(); setOpOrder([]);
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      eq(opOrder(), orderBefore, 'after a reload the order is back');
      eq(listOf(app), listBefore, 'the list is the same');
      eq(shaperSvgOf(app.state, cutPlanEntries()), svgBefore, 'the export is byte-identical');
    } finally { await app.close(); }
  }
}
CUT_PLAN.clear(); setOpOrder([]);
console.log(`op-list-743-node.test.js: ok (${checks} checks)`);
