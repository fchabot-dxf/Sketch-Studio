// tests/op-ticks-798-node.test.js — TASK 798 (owner turns 2515-2537): the Operations list's CHECKBOXES decide what is shown and exported, and every export lines up
// on the Origin. On the Shaper node page (tests/helpers/node-app.js: the page's own Prepare stage, operations list and cut card), a drawn design: a Stock board, a
// part outline (Outside, ⅛ in), a pocket and a hole inside it (Pocket and Inside, ¼ in):
//  1. every row and every tool heading has a checkbox, ticked by default; the Stock's is ticked and disabled (it is in every file);
//  2. a row's box unticks its operation (`on` false): ONE undo step (Undo ticks it again, Redo unticks it), saved in the version 3 document and read back;
//  3. a heading's box: all / some / none, a tap ticks all (or unticks all when all were ticked);
//  4. the EXPORT (export-payload.js exportFileOf, the Export step's one file): the ticked operations' elements only, each byte-identical to its element in the
//     everything-ticked file (attributes and d), the page (width / height / viewBox) and the Stock guide identical in every partial export; everything ticked =
//     the plain whole-plan export (today's bytes); nothing ticked = no file;
//  5. the views follow the same filter: Prepare draws no band / tool path for a selected unticked operation (its card still opens), the 3D Review's items and the
//     2D preview's operations are the ticked ones; the Export line names the unticked ones;
//  6. a design with no Stock (advisor turn 2705, option b): a partial file starts with the FRAME GUIDE, a rectangle = the full file's drawn extent, in the Stock
//     guide's encoding; the everything-ticked file has none (unchanged); the Paths view skips it.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { planEntries, planReliefItems, keyOf } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { shaperSvgOf, exportFileOf, exportTickLine, bitCentrePaths } from '../apps/shaper/src/export-payload.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

// a rectangle of 4 lines, named n
function rect(st, n, x0, y0, x1, y1) {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
}
const target = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };
const header = (svg) => svg.split('\n')[0];
const elements = (svg) => svg.split('\n').slice(1, -1);

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  rect(st, 'S', 0, 0, 160, 100); rect(st, 'P', 20, 20, 140, 80); rect(st, 'Q', 40, 35, 70, 65); rect(st, 'H', 90, 35, 120, 65);
  const loops = findLoops(st);
  const K = Object.fromEntries(['S', 'P', 'Q', 'H'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
  app.modes.showMode('prepare');
  let pv = app.prepare.view();
  // TASK S2: the shape picked, its type (a NEW operation, open), its fields set in it, OK
  const edit = (k, o) => { app.prepare.ok(); pv.setSelection([target(K[k])]); for (const [f, v] of Object.entries(o)) (f === 'cutType' ? app.prepare.pickType(v) : pv.setOpField(f, v)); app.prepare.ok(); };
  edit('S', { cutType: 'stock' });
  edit('Q', { cutType: 'pocket', toolDia: 6.35, cutDepth: 6 });
  edit('H', { cutType: 'interior', toolDia: 6.35, cutDepth: 19 });
  edit('P', { cutType: 'exterior', toolDia: 3.175, cutDepth: 19 });
  pv.setSelection([]);
  const list = app.prepare.opList;
  list.refresh();
  const opsNow = () => describeOperations(st);
  const idOf = (type) => storeOps().find((o) => o.type === type).id;
  const rowBox = (id) => [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === id).querySelector('.ops-tick input');
  const headBox = (heading) => [...app.document.querySelectorAll('#prepare-ops .ops-tool')].find((h) => h.textContent === heading).querySelector('.ops-tick input');
  const ticks = () => list.inspectTicks();
  const full = shaperSvgOf(st, planEntries()); // the everything-ticked file (the plain whole-plan export = today's)

  // 1. the boxes
  eq(opsNow().map((o) => `${o.heading} | ${o.rowText}`), ['Not cut | Stock', 'Change to ¼″ end mill | Pocket · 6 mm', 'Change to ¼″ end mill | Inside · 19 mm', 'Change to ⅛″ end mill | Outside · 19 mm'], '1: the design: Stock, ¼ in Pocket + Inside, ⅛ in Outside');
  eq(ticks(), {
    rows: [{ id: idOf('stock'), on: true, disabled: true, off: false }, { id: idOf('pocket'), on: true, disabled: false, off: false }, { id: idOf('interior'), on: true, disabled: false, off: false }, { id: idOf('exterior'), on: true, disabled: false, off: false }],
    groups: [{ heading: 'Not cut', state: 'all', disabled: true }, { heading: 'Change to ¼″ end mill', state: 'all', disabled: false }, { heading: 'Change to ⅛″ end mill', state: 'all', disabled: false }],
  }, '1: every row and heading has a box, ticked by default; the Stock\'s (and its heading\'s, Stock alone) is disabled');
  eq(storeOps().map((o) => o.on), [true, true, true, true], '1: every operation is stored ticked');
  eq(exportFileOf(st).svg, full, '1: everything ticked: the Export step\'s file is the plain whole-plan export, byte for byte');
  eq(exportTickLine(opsNow()), '', '1: no Export line while everything is ticked');

  // 2. a row's box: one undo step, saved, read back
  const hist = st.history.length;
  app.press(rowBox(idOf('exterior')));
  eq(storeOps().find((o) => o.type === 'exterior').on, false, '2: the Outside\'s box unticks its operation');
  eq(st.history.length, hist + 1, '2: ONE undo step');
  eq(ticks().rows.find((r) => r.id === idOf('exterior')), { id: idOf('exterior'), on: false, disabled: false, off: true }, '2: its row: box empty, dimmed (is-off)');
  eq(ticks().groups.find((g) => g.heading === 'Change to ⅛″ end mill').state, 'none', '2: its heading (one operation): none');
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  eq(saved.operations.map((o) => [o.type, o.on]), [['stock', true], ['pocket', true], ['interior', true], ['exterior', false]], '2: the tick is saved in the version 3 document');
  app.undo();
  eq(storeOps().find((o) => o.type === 'exterior').on, true, '2: Undo ticks it again');
  eq(ticks().rows.find((r) => r.id === idOf('exterior')).on, true, '2: and its box shows it');
  app.redo();
  eq(storeOps().find((o) => o.type === 'exterior').on, false, '2: Redo unticks it');
  app.press(rowBox(idOf('exterior')));
  eq(storeOps().find((o) => o.type === 'exterior').on, true, '2: ticked again by its box');
  applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
  eq(storeOps().map((o) => o.on), [true, true, true, false], '2: the saved document read back: the Outside unticked');
  eq(JSON.parse(JSON.stringify(captureShaperDoc())), saved, '2: saved -> read -> saved: the same document');
  app.prepare.mount(); // (as a document restore does)
  pv = app.prepare.view();
  list.refresh();
  app.press(rowBox(idOf('exterior'))); // ticked again (the state of 3)

  // 3. a heading's box: all / some / none
  app.press(rowBox(idOf('pocket')));
  eq(ticks().groups.find((g) => g.heading === 'Change to ¼″ end mill').state, 'some', '3: one of the ¼ in run unticked: the heading is mixed');
  ok(headBox('Change to ¼″ end mill').indeterminate, '3: (the box is indeterminate)');
  app.press(headBox('Change to ¼″ end mill'));
  eq([storeOps().find((o) => o.type === 'pocket').on, storeOps().find((o) => o.type === 'interior').on], [true, true], '3: a tap on a mixed heading ticks all its operations');
  eq(ticks().groups.find((g) => g.heading === 'Change to ¼″ end mill').state, 'all', '3: heading all');
  const h3 = st.history.length;
  app.press(headBox('Change to ¼″ end mill'));
  eq([storeOps().find((o) => o.type === 'pocket').on, storeOps().find((o) => o.type === 'interior').on], [false, false], '3: a tap on an all-ticked heading unticks them all');
  eq([st.history.length, ticks().groups.find((g) => g.heading === 'Change to ¼″ end mill').state], [h3 + 1, 'none'], '3: one undo step; heading none');
  eq(storeOps().find((o) => o.type === 'exterior').on, true, '3: the other run is untouched');

  // 4. the export (the owner's two files: the ¼ in pocket alone, then the ⅛ in outline alone)
  const fullEls = elements(full);
  const elsOf = (type) => fullEls.filter((l) => l.includes(`shaper:cutType="${type}"`) && !l.includes('fill="#0068FF"'));
  const stockEl = fullEls.filter((l) => l.includes('fill="#0068FF"'));
  eq(stockEl.length, 1, '4: the full file has one Stock guide');
  const tickOnly = (types) => { for (const o of storeOps()) { const want = o.type === 'stock' || types.includes(o.type); if (o.on !== want) app.press(rowBox(o.id)); } };
  tickOnly(['pocket']);
  const fileA = exportFileOf(st).svg;
  tickOnly(['exterior']);
  const fileB = exportFileOf(st).svg;
  tickOnly(['interior', 'exterior']);
  const fileC = exportFileOf(st).svg;
  eq(elements(fileA), [...stockEl, ...elsOf('pocket')], '4: the ¼ in pocket alone: the Stock guide + the pocket, each byte-identical to the full file\'s');
  eq(elements(fileB), [...stockEl, ...elsOf('outside')], '4: the ⅛ in outline alone: the Stock guide + the outline, byte-identical');
  eq(elements(fileC), fullEls.filter((l) => !elsOf('pocket').includes(l)), '4: the hole + the outline: the full file without the pocket, in its order, byte-identical');
  eq([header(fileA), header(fileB), header(fileC)], [header(full), header(full), header(full)], '4: the same page (width / height / viewBox) in every partial export = the full file\'s');
  ok(fileA !== fileB && fileA !== full, '4: (the files differ)');
  tickOnly(['pocket', 'interior', 'exterior']);
  eq(exportFileOf(st).svg, full, '4: everything ticked again: the full file, byte for byte');
  for (const o of storeOps()) if (o.on) app.press(rowBox(o.id)); // untick all (the Stock cannot be)
  eq(storeOps().find((o) => o.type === 'stock').on, true, '4: the Stock cannot be unticked (its box is disabled)');
  eq(elements(exportFileOf(st).svg), stockEl, '4: nothing ticked: the file is the Stock guide alone (the Stock is always ticked)');
  tickOnly(['pocket', 'interior', 'exterior']);

  // 5. the views: Prepare, the 3D Review's items, the 2D preview's operations, the Export line
  tickOnly(['pocket', 'interior']);
  pv.setSelection([target(K.P)]); pv.refreshLook();
  eq([app.document.getElementById('prepare-cut-group').innerHTML, app.document.getElementById('prepare-toolpath-group').querySelectorAll('path, polyline, line').length], ['', 0], '5: Prepare: the selected unticked Outside draws no band and no tool path');
  ok(app.document.querySelector('#prepare-panel') && pv.recordFor(target(K.P)).cutType === 'exterior', '5: its card still shows its settings (Outside)');
  pv.setSelection([target(K.Q)]); pv.refreshLook();
  ok(app.document.getElementById('prepare-cut-group').innerHTML.length > 0, '5: a selected ticked Pocket draws its band');
  app.press(rowBox(idOf('exterior'))); pv.setSelection([target(K.P)]); pv.refreshLook();
  ok(app.document.getElementById('prepare-toolpath-group').innerHTML.includes('<path'), '5: the Outside ticked again: selected, it draws its tool path');
  app.press(rowBox(idOf('exterior')));
  pv.setSelection([]);
  const keysOf = (items) => [...new Set(items.map((i) => i.key))].sort();
  eq(keysOf(planReliefItems(st, { ticked: true })), [K.H, K.Q].sort(), '5: the 3D Review\'s items: the ticked Pocket and Inside only');
  eq(keysOf(planReliefItems(st)), [K.H, K.P, K.Q].sort(), '5: (every operation without the filter)');
  eq(exportFileOf(st, { preview: true }).ops.map((o) => o.cutType), ['stock', 'pocket', 'interior'], '5: the 2D / Paths preview lists the ticked operations');
  eq(exportTickLine(opsNow()), 'Exporting 2 of 3 operations (unticked: 4. Outside · 19 mm (⅛″ end mill)). Place it with the same anchor as the earlier file.', '5: the Export line names the unticked one');
  tickOnly([]);
  eq(exportTickLine(opsNow()), 'Exporting 0 of 3 operations: every one is unticked. Tick one in Prepare\'s Operations list.', '5: everything unticked: the line says so');
  tickOnly(['pocket', 'interior', 'exterior']);

  // 6. a design with NO Stock (advisor turn 2705, option b): a PARTIAL file starts with the frame guide = the full file's drawn extent (the union of its elements'
  //    boxes), in the Stock guide's encoding; the everything-ticked file is unchanged (no guide); the Paths view skips the guide
  const stockRow = () => [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === idOf('stock'));
  app.press(stockRow().querySelector('.ops-pick')); app.press(stockRow().querySelector('.ops-del')); // TASK S2: the row selected, then its X
  eq(storeOps().map((o) => o.type), ['pocket', 'interior', 'exterior'], '6: the Stock binned: no Stock');
  const fullNs = shaperSvgOf(st, planEntries());
  eq(exportFileOf(st).svg, fullNs, '6: everything ticked: the plain whole-plan file (no frame guide)');
  ok(!fullNs.includes('shaper:cutType="guide"'), '6: (it has no guide)');
  const extentOf = (lines) => {
    let b = null;
    for (const l of lines) {
      const n = (k) => Number(new RegExp(` ${k}="([^"]*)"`).exec(l)[1]);
      let x;
      if (l.trim().startsWith('<circle')) x = { minX: n('cx') - n('r'), minY: n('cy') - n('r'), maxX: n('cx') + n('r'), maxY: n('cy') + n('r') };
      else { const v = /d="([^"]*)"/.exec(l)[1].match(/-?\d+(\.\d+)?/g).map(Number); const xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2 === 1); x = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }; } // straight lines only in this design
      b = b ? { minX: Math.min(b.minX, x.minX), minY: Math.min(b.minY, x.minY), maxX: Math.max(b.maxX, x.maxX), maxY: Math.max(b.maxY, x.maxY) } : x;
    }
    return b;
  };
  const ext = extentOf(elements(fullNs));
  eq(ext, { minX: 20, minY: 20, maxX: 140, maxY: 80 }, '6: the full file\'s drawn extent (the outline)');
  const guide = `  <path d="M ${ext.minX} ${ext.minY} L ${ext.maxX} ${ext.minY} L ${ext.maxX} ${ext.maxY} L ${ext.minX} ${ext.maxY} Z" fill="#0068FF" stroke="#0068FF" shaper:cutType="guide" shaper:cutOffset="0mm"/>`; // (mm document)
  tickOnly(['pocket']);
  const nsA = exportFileOf(st).svg;
  tickOnly(['exterior']);
  const nsB = exportFileOf(st).svg;
  eq(elements(nsA), [guide, ...elements(fullNs).filter((l) => l.includes('shaper:cutType="pocket"'))], '6: the pocket alone: the frame guide (= the full file\'s drawn extent, the Stock guide\'s encoding) + the pocket, byte-identical');
  eq(elements(nsB), [guide, ...elements(fullNs).filter((l) => l.includes('shaper:cutType="outside"'))], '6: the outline alone: the same frame guide + the outline');
  eq([header(nsA), header(nsB)], [header(fullNs), header(fullNs)], '6: the full file\'s page in both');
  tickOnly(['pocket']);
  const pv6 = exportFileOf(st, { preview: true });
  const paths6 = bitCentrePaths(st, pv6.written);
  eq([pv6.written[0].cut, paths6.some((p) => p.index === 0), paths6.length > 0], [null, false, true], '6: the Paths view: the frame guide (element 0) is no cut and has no bit-centre path; the pocket\'s is there');
  tickOnly(['pocket', 'interior', 'exterior']);
  eq(exportFileOf(st).svg, fullNs, '6: everything ticked again: the plain file');
} finally { await app.close(); }
console.log(`op-ticks-798: ${checks} checks passed`);
