// tests/op-list-743-node.test.js — TASK 743: Shaper's OPERATIONS (apps/shaper/src/operations.js), each one <g> of Origin paths in the exported SVG.
//  1. derivation: records -> operations on a drawn plate with mixed tools (⅛ in / ¼ in end mills, a 6 mm ball nose, a ¼ in 60° V-bit), types (Guide, On line,
//     Pocket, Inside, Outside with Tabs) and settings (two equal pockets = ONE operation of 2 regions; the same pocket with an offset = another); the labels;
//     the default order (Not cut first; then tools by the highest rank of their cuts, so the bit that frees the part is last; in a tool on line, pockets,
//     inside, outside, shallow before deep); a stored order is kept and a NEW operation slots in after its default-order predecessor;
//  2. a stepped operation (the SA-7 R3 floor fillet as a Stepped pocket, adaptive Coarse) shows its steps;
//  3. the export: one <g id><title> per operation, in the order; a reorder changes ONLY the order of the groups (each byte-identical); every element and its
//     encoding is the one the pre-743 export wrote (same multiset of element + resolved attributes);
//  4. a document with ONE operation exports as before except the group wrapper: exactly `<g id="…">` + `<title>…</title>` after the header, the old body
//     two spaces deeper, `</g>` before `</svg>`;
//  5. the app: the list (tool headings, rows), a tap selects the operation's regions, ↓ reorders as ONE undo step (Ctrl+Z / Ctrl+Y), the autosave stores the
//     order, a reload restores it (list + export byte-identical).
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
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
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
// the operation groups of a file, in order: { id, title, lines } (lines = the group's lines verbatim)
function fileOps(svg) {
  const out = []; let cur = null;
  for (const line of svg.split('\n')) {
    const g = /^ {2}<g id="([^"]+)">$/.exec(line);
    if (g) { cur = { id: g[1], title: null, lines: [line] }; continue; }
    if (cur) { cur.lines.push(line); const t = /^ {4}<title>(.*)<\/title>$/.exec(line); if (t && cur.title === null) cur.title = t[1]; }
    if (cur && line === '  </g>') { out.push(cur); cur = null; }
  }
  return out;
}
// every drawn element of a file with its RESOLVED attributes (its own + the <g> ancestors' that carry cut attributes), as sorted strings (a multiset)
function resolvedElements(svg) {
  const attrs = (s) => [...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]);
  const stack = [], out = [];
  for (const raw of svg.split('\n')) {
    const line = raw.trim();
    if (/^<g[\s>]/.test(line)) { stack.push(attrs(line).filter(([k]) => k !== 'id')); continue; }
    if (line === '</g>') { stack.pop(); continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = Object.fromEntries([...stack.flat(), ...attrs(m[2])]);
    out.push(m[1] + ' ' + Object.keys(a).sort().map((k) => `${k}=${a[k]}`).join(' '));
  }
  return out.sort();
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
  // a NEW operation (a ⅛ in pocket at 1/16 in on pocket C, taken out of the ¼ in pocket operation) slots in after its default-order predecessor
  CUT_PLAN.set(K.pc, rec('pocket', 1.5875, 3.175));
  const after = planOperations(st, cutPlanEntries());
  const fresh = after.find((o) => o.label.startsWith('⅛″ end mill · Pocket'));
  ok(fresh, 'the new ⅛ in pocket operation');
  const def = defaultOpOrder(after.slice());
  const pred = def[def.findIndex((o) => o.key === fresh.key) - 1];
  console.log('new op: ' + fresh.label + ' | default predecessor: ' + pred.label + ' | order: ' + after.map((o) => o.label.split(' (')[0]).join(' > '));
  eq(after.findIndex((o) => o.key === fresh.key), after.findIndex((o) => o.key === pred.key) + 1, 'the new operation sits right after its default-order predecessor in the stored order');
  eq(after.filter((o) => o !== fresh).map((o) => o.key), stored, 'the stored operations keep their order');
  eq(after.find((o) => o.label.startsWith('¼″ end mill · Pocket · 0.25 in (1 region)') && !o.detail).records.map((r) => r.planKey), [K.pa], 'pocket A alone in its operation now');
  setOpOrder([]);
}

// ── 3. the export: groups in operation order; a reorder changes only the order of the groups; every element / encoding as before 743 ──
{
  const st = design(), K = keysOf(st);
  plan(K);
  setOpOrder([]);
  const ops = planOperations(st, cutPlanEntries());
  const svg = shaperSvgOf(st, cutPlanEntries());
  const groups = fileOps(svg);
  eq(groups.map((g) => g.title), ops.map((o) => o.title), 'one <g> per operation, in the operation order, its <title> = the operation title');
  eq(ops.map((o) => o.title), ops.map((o) => o.label), 'at Auto precision the title is the label');
  eq(groups.map((g) => g.id), ops.map((o) => o.id), 'the <g> ids');
  const body = svg.split('\n').slice(1, -1);
  eq(body.length, groups.reduce((n, g) => n + g.lines.length, 0), 'every element of the file is inside an operation group (no V-carve here)');
  eq(resolvedElements(svg), resolvedElements(before743(st)), 'the same elements with the same encoding (resolved attributes) as the pre-743 export');
  ok(!/data-/.test(svg), 'no data-* in the downloaded file');
  // a reorder: the reverse order
  setOpOrder(ops.map((o) => o.key).reverse());
  const svg2 = shaperSvgOf(st, cutPlanEntries());
  const groups2 = fileOps(svg2);
  eq(groups2.map((g) => g.id), groups.map((g) => g.id).reverse(), 'the reorder reverses the groups');
  eq(Object.fromEntries(groups2.map((g) => [g.id, g.lines.join('\n')])), Object.fromEntries(groups.map((g) => [g.id, g.lines.join('\n')])), 'each group byte-identical after the reorder');
  eq(svg2.split('\n')[0], svg.split('\n')[0], 'the header unchanged');
  eq(svg2.length, svg.length, 'the file length unchanged');
  setOpOrder([]);
  // the preview copy: the list's words on the group (data-op-heading / data-op-text), never in the download
  const pv = shaperSvgOf(st, cutPlanEntries(), { preview: true });
  ok(pv.includes('<g id="op-interior-19.05mm-endmill-3.175mm" data-op-heading="Change to ⅛″ end mill" data-op-text="Inside · 0.75 in · 2 regions">'), 'the preview copy carries the list words on the group');
  eq(pv.replace(/ data-op-(heading|text)="[^"]*"/g, '').replace(/ data-(step|hold)="[^"]*"/g, ''), svg, 'the preview copy minus its data-* == the download');
  // a display precision changes the lists' words, never the file
  SettingsManager.set('LENGTH_PRECISION', 1);
  eq(shaperSvgOf(st, cutPlanEntries()), svg, 'Length precision 1: the download byte-identical (its <title>s are written at Auto)');
  eq(planOperations(st, cutPlanEntries()).find((o) => o.cutType === 'interior').rowText, 'Inside · 0.8 in', 'Length precision 1: the list writes 0.8 in');
  SettingsManager.set('LENGTH_PRECISION', null);
  fs.mkdirSync('.evidence/743', { recursive: true });
  fs.writeFileSync('.evidence/743/node-mixed-export.svg', svg);
}

// ── 4. ONE operation: the export as before + the group wrapper, exactly ──
{
  SettingsManager.set('DOC_UNIT', 'mm');
  const st = design(), K = keysOf(st);
  for (const [name, keys] of [['two pockets (hoisted <g>)', [K.pa, K.pc]], ['one pocket', [K.pa]]]) {
    CUT_PLAN.clear();
    for (const k of keys) CUT_PLAN.set(k, rec('pocket', 6, 6.35));
    setOpOrder([]);
    const old = before743(st), now = shaperSvgOf(st, cutPlanEntries());
    const [op] = planOperations(st, cutPlanEntries());
    const lines = old.split('\n');
    const expected = [lines[0], `  <g id="${op.id}">`, `    <title>${op.title}</title>`, ...lines.slice(1, -1).map((l) => '  ' + l), '  </g>', lines[lines.length - 1]].join('\n');
    console.log(`one operation, ${name}: before 743\n${old}\nnow\n${now}`);
    eq(now, expected, `one operation, ${name}: the old file + <g id="${op.id}"><title>${op.title}</title> around its body (two spaces deeper)`);
  }
  SettingsManager.set('DOC_UNIT', 'in');
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
      // ↓ on the first row: ONE undo step; Ctrl+Z / Ctrl+Y
      const n0 = st.history.length;
      app.press(app.document.querySelector('#prepare-ops .ops-row .ops-down'));
      const l1 = listOf(app);
      eq(l1.filter((t) => !t.startsWith('# ')).slice(0, 2).map((t) => t.split(' | ')[0]), ['1. On line · 0.0625 in', '2. Guide'], '↓ moved Guide below On line');
      eq(st.history.length, n0 + 1, 'the reorder is ONE undo step');
      eq(opOrder().length, 7, 'the order is stored');
      app.undo();
      eq(listOf(app), l0, 'Ctrl+Z: the default order again');
      eq(opOrder(), [], 'Ctrl+Z: no stored order');
      app.redo();
      eq(listOf(app), l1, 'Ctrl+Y: the reorder again');
      // ↑ on the last (the Outside) twice: above both ¼ in pockets
      app.press([...app.document.querySelectorAll('#prepare-ops .ops-row .ops-up')].at(-1));
      app.press([...app.document.querySelectorAll('#prepare-ops .ops-row .ops-up')].at(-2));
      listBefore = listOf(app);
      console.log('app list after reorders: ' + JSON.stringify(listBefore));
      eq(listBefore.slice(-4), ['# Change to ¼″ end mill', listBefore.at(-3), listBefore.at(-2), listBefore.at(-1)], 'still one ¼ in heading');
      ok(/^5\. Outside/.test(listBefore.at(-3)), 'the Outside is first of the ¼ in bit now');
      orderBefore = opOrder();
      svgBefore = shaperSvgOf(st, cutPlanEntries());
      eq(fileOps(svgBefore).map((g) => g.title.split(' (')[0]), planOperations(st, cutPlanEntries()).map((o) => o.label.split(' (')[0]), 'the export follows the list');
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
