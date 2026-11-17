// tests/export-preview-718-node.test.js — TASK 718: the Export step's 2D view shows the file the user downloads. Through Shaper's ONE exporter call
// (apps/shaper/src/export-payload.js shaperSvgOf, the page's generateShaperSvgPayload) on the real Fusion solid (tests/fixtures/real-solid-plate-711.json;
// Node samples its arcs as chords, so its plan here differs from the browser's: tests/export-preview-718-live.test.js checks the browser's file)
// and the SA-7 R3 floor fillet pocket (tests/fixtures/sa7-slope/03-pocket-floor-fillet.json) as a Stepped pocket (adaptive, Coarse = 4 steps):
//  1. the downloaded string is byte-identical to the exporter's own output without the preview option (the 711 / 714 call), and the PREVIEW copy is that
//     string plus data-step="k/N" on the stepped cut's elements only (removing them gives the download back, byte for byte);
//  2. the preview's element list (apps/shaper/src/export-preview.js previewItems on the parsed preview copy: type + depth from the element or its <g>)
//     == the export's element list (the downloaded string read line by line, as the 711 test reads it): same count, same order, same type + depth;
//  3. the stepped pocket's elements say "step k of N" in order (1..4 of 4), the label reads "pocket · 7.333 mm · step 2 of 4", the list groups by OPERATION (TASK 743).
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { CUT_PLAN, cutPlanEntries } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { planOperations, opEntries } from '../apps/shaper/src/operations.js'; // TASK 743
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems, previewRows, itemLabel } from '../apps/shaper/src/export-preview.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// The export's elements read from the downloaded string, line by line (a <g> hoists shared attributes; its children inherit them): the 711 test's reader.
function exportElements(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) { group = attrs(line); continue; }
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ tag: m[1], cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'] });
  }
  return out;
}
// the exporter called the way the page called it before task 718 (main.js generateShaperSvgPayload, 711 / 714 tests)
const plainExport = (st) => {
  const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
  for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
  const entries = cutPlanEntries(); // TASK 743: the page's call groups the elements by operation (operations.js), in the operation order
  return exportShaperSVG({ state: st, entries: opEntries(planOperations(st, entries), entries), encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true, groupByOp: true }, loopPolys: lp });
};
const stripPreview = (s) => s.replace(/ data-step="\d+\/\d+"/g, '').replace(/ data-op-(heading|text)="[^"]*"/g, ''); // TASK 743: + the operation groups' list words

SettingsManager.set('DOC_UNIT', 'mm');
const app = await open({ host: 'shaper' });
const preview = (svg) => previewItems(parseShaperSvg(svg, app.document));
try {
  app.modes.showMode('prepare');

  // ── the real Fusion solid (711): 1 outside, 3 inside, 4 pockets ──
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  {
    const download = shaperSvgOf(app.state, cutPlanEntries());
    const copy = shaperSvgOf(app.state, cutPlanEntries(), { preview: true });
    eq(download, plainExport(app.state), 'real solid: the downloaded file is byte-identical to the exporter\'s output before task 718');
    eq(stripPreview(copy), download, 'real solid: no stepped cut, so the preview copy minus its operation words IS the downloaded string');
    const ex = exportElements(download);
    const pv = preview(copy);
    console.log('real solid, export: ' + JSON.stringify(ex.map((e) => `${e.cutType} ${e.depth}`)));
    console.log('real solid, preview: ' + JSON.stringify(pv.map((e) => `${e.cutType} ${e.depth}`)));
    // (Node samples the outline's arcs as chords, so its plan of this solid is not the browser's 711 result: the live test checks that file; here
    // the claim is preview == export, whatever the export holds)
    ok(pv.length === ex.length && pv.length > 0, `real solid: ${pv.length} elements in the preview, ${ex.length} in the export`);
    eq(pv.map((e) => ({ tag: e.tag, cutType: e.cutType, depth: e.depth })), ex, 'real solid: the preview\'s element list == the export\'s (tag, type, depth, order)');
    ok(pv.every((e) => e.step === null), 'real solid: no element has a step');
    const rows = previewRows(pv);
    console.log('real solid, list: ' + JSON.stringify(rows.map((g) => [g.op.heading, g.op.text, g.count, g.rows.map((r) => `${r.cutType} ${r.depth} x${r.items.length}`)])));
    eq(rows.reduce((n, g) => n + g.count, 0), pv.length, 'the list counts every element once');
    // TASK 743: the list is the operations list: one group per operation (file order = the operation order), rows by cut type + depth
    eq(rows.map((g) => g.op.text.split(' · ').slice(0, 2).join(' · ')), ['Pocket · 4 mm', 'Pocket · 6 mm', 'Pocket · 8 mm', 'Pocket · 10 mm', 'Inside · 19 mm', 'Outside · 19 mm'], 'the list: the operations, pockets shallow to deep, the holes, the outside last');
    ok(rows.every((g) => g.op.heading === 'Change to ⅛″ end mill'), 'one bit: every operation under "Change to ⅛″ end mill"');
  }

  // ── the SA-7 R3 floor fillet pocket as a Stepped pocket, adaptive Coarse (717: 4 steps at 6.651 7.333 7.843 8) ──
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  {
    const [pk, rec] = [...CUT_PLAN.entries()].find(([, r]) => r.cutType === 'pocket');
    ok(rec.slope, 'the imported pocket has its slope');
    CUT_PLAN.set(pk, { ...rec, cutType: 'stepped-pocket', stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.5 });
    const download = shaperSvgOf(app.state, cutPlanEntries());
    const copy = shaperSvgOf(app.state, cutPlanEntries(), { preview: true });
    eq(download, plainExport(app.state), 'R3 fillet: the downloaded file is byte-identical to the exporter\'s output before task 718');
    ok(!/data-/.test(download), 'R3 fillet: the downloaded file carries no data-* attribute');
    eq(stripPreview(copy), download, 'R3 fillet: the preview copy minus its data-step attributes == the downloaded file, byte for byte');
    eq((copy.match(/ data-step="/g) || []).length, 4, 'R3 fillet: data-step on the 4 terrace pockets only');
    const ex = exportElements(download);
    const pv = preview(copy);
    console.log('R3 fillet, export: ' + JSON.stringify(ex.map((e) => `${e.cutType} ${e.depth}`)));
    console.log('R3 fillet, preview: ' + JSON.stringify(pv.map(itemLabel)));
    eq(pv.map((e) => ({ tag: e.tag, cutType: e.cutType, depth: e.depth })), ex, 'R3 fillet: the preview\'s element list == the export\'s (tag, type, depth, order)');
    eq(pv.map(itemLabel), ['pocket · 6.651 mm · step 1 of 4', 'pocket · 7.333 mm · step 2 of 4', 'pocket · 7.843 mm · step 3 of 4', 'pocket · 8.000 mm · step 4 of 4', 'outside · 19.000 mm'],
      'R3 fillet: the labels: the 4 steps in order, then the outline (TASK 743: the operation order, the outside cut last)');
    const rows = previewRows(pv);
    eq(rows.map((g) => [g.op.text, g.count, g.rows.length]), [['Stepped pocket · 6.651–8 mm · 1 region · 4 steps, adaptive Coarse', 4, 4], ['Outside · 19 mm · 1 region', 1, 1]], 'the list (TASK 743: operations): the stepped pocket (4 elements, 4 rows), then the outside (1 element)');
  }
  // a file that does not parse throws (never an empty view that hides the error)
  assert.throws(() => parseShaperSvg('<svg', app.document), /does not parse/); checks++;
} finally {
  CUT_PLAN.clear();
  app.close();
}
console.log(`export-preview-718-node.test.js: ok (${checks} checks)`);
