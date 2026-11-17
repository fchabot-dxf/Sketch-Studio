// tests/export-preview-719-node.test.js — TASK 719: the 2D preview's pocket shading is the preview's own (export-preview.js pocketShades), never the file's:
//  1. the downloaded string (export-payload.js shaperSvgOf) is byte-identical to the exporter output before 719 (the plain call) for the 711 real solid and
//     the R3 fillet as a Stepped pocket, and holds no shading colour / outline;
//  2. the shades of the preview items run linearly 70% -> 30% lightness from the shallowest to the deepest pocket of THIS export: deeper = darker, equal
//     depths share a shade, outside / inside get none; one depth only = the middle (50%).
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
import { parseShaperSvg, previewItems, pocketShades, outsideStepShades } from '../apps/shaper/src/export-preview.js';


let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
// the exporter called the way the page called it before task 718 (main.js generateShaperSvgPayload, 711 / 714 tests)
const plainExport = (st) => {
  const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
  for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
  const entries = cutPlanEntries(); // TASK 743: the page's call groups the elements by operation (operations.js), in the operation order
  return exportShaperSVG({ state: st, entries: opEntries(planOperations(st, entries), entries), encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true, groupByOp: true }, loopPolys: lp });
};

const L = (shade) => parseFloat(/hsl\(0, 0%, ([\d.]+)%\)/.exec(shade)[1]);
SettingsManager.set('DOC_UNIT', 'mm');
const app = await open({ host: 'shaper' });
try {
  app.modes.showMode('prepare');
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  {
    const download = shaperSvgOf(app.state, cutPlanEntries());
    eq(download, plainExport(app.state), 'real solid: the downloaded file is byte-identical to the exporter output before 719');
    ok(!/hsl\(|stroke="#222"/.test(download), 'real solid: no preview styling in the file');
    const items = previewItems(parseShaperSvg(shaperSvgOf(app.state, cutPlanEntries(), { preview: true }), app.document));
    const { shades } = pocketShades(items);
    const depths = [...shades.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
    eq(depths, ['4.000 mm', '6.000 mm', '8.000 mm', '10.000 mm'], 'real solid: a shade per pocket depth');
    const ls = depths.map((d) => L(shades.get(d)));
    console.log('real solid, lightness by depth: ' + JSON.stringify(ls));
    ok(ls.every((v, i) => i === 0 || v < ls[i - 1]), 'deeper = darker');
    eq([ls[0], ls[3]], [70, 30], 'the scale: shallowest 70%, deepest 30%');
    ok(!shades.has('19.000 mm'), 'outside / inside depths get no shade');
  }
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  {
    const [pk, rec] = [...CUT_PLAN.entries()].find(([, r]) => r.cutType === 'pocket');
    CUT_PLAN.set(pk, { ...rec, cutType: 'stepped-pocket', stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.5 });
    const download = shaperSvgOf(app.state, cutPlanEntries());
    eq(download, plainExport(app.state), 'R3 fillet: the downloaded file is byte-identical to the exporter output before 719');
    ok(!/hsl\(|stroke="#222"|data-/.test(download), 'R3 fillet: no preview styling or data-* in the file');
    const items = previewItems(parseShaperSvg(shaperSvgOf(app.state, cutPlanEntries(), { preview: true }), app.document));
    const { shades } = pocketShades(items);
    const ls = items.filter((i) => i.cutType === 'pocket').map((i) => L(shades.get(i.depth)));
    console.log('R3 fillet, lightness by step: ' + JSON.stringify(ls));
    eq(ls.length, 4, 'R3 fillet: 4 steps');
    ok(ls.every((v, i) => i === 0 || v < ls[i - 1]), 'R3 fillet: each deeper step is darker');
    eq([ls[0], ls[3]], [70, 30], 'R3 fillet: 70% .. 30%');
    // one depth only = the middle
    const one = pocketShades(items.filter((i) => i.step && i.step.k === 2));
    eq(L(one.shades.get('7.333 mm')), 50, 'a single pocket depth = the middle of the scale');
  }
  // a stepped OUTSIDE (x2 outline, Step depth 1 mm): download byte-identical; the terraces' shades run 25% (shallowest) .. 0% (deepest); a plain outside gets none
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/x2-outline-chamfer-top-bottom.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  {
    const [pk, rec] = [...CUT_PLAN.entries()][0];
    CUT_PLAN.set(pk, { ...rec, cutType: 'stepped-outside', stepDepth: 1 });
    const download = shaperSvgOf(app.state, cutPlanEntries());
    eq(download, plainExport(app.state), 'x2 stepped outside: the downloaded file is byte-identical to the pre-719 exporter call');
    ok(!/hsl\(|stroke="#9a9a9a"|data-/.test(download), 'x2: no preview styling in the file');
    const items = previewItems(parseShaperSvg(shaperSvgOf(app.state, cutPlanEntries(), { preview: true }), app.document));
    const o = outsideStepShades(items);
    eq([...o.shades.entries()].map(([d, c]) => [d, L(c)]).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])), [['1.000 mm', 25], ['19.000 mm', 0]], 'x2: terrace shades 25% .. 0%');
    eq(outsideStepShades(items.map((i) => ({ ...i, step: null }))).shades.size, 0, 'a plain (non-stepped) outside gets no shade');
  }
} finally {
  CUT_PLAN.clear();
  app.close();
}
console.log(`export-preview-719-node.test.js: ok (${checks} checks)`);
