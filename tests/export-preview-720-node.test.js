// tests/export-preview-720-node.test.js — TASK 720: a stepped INSIDE's terraces (the 06 countersink, Stepped inside, Step 1 mm and adaptive Fine) in the preview: the downloaded
// string stays byte-identical to the plain pre-719 exporter call; insideStepShades: lightness 90% (shallowest) .. 60% for every step but the deepest, which keeps white;
// a plain (non-stepped) inside gets no shade.
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
import { parseShaperSvg, previewItems, insideStepShades } from '../apps/shaper/src/export-preview.js';


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
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/06-countersink.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  const hole = [...CUT_PLAN.entries()].find(([, r]) => r.slope);
  for (const [name, patch] of [['Step 1 mm', { stepDepth: 1 }], ['adaptive Fine', { stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.1 }]]) {
    CUT_PLAN.set(hole[0], { ...hole[1], cutType: 'stepped-inside', ...patch });
    const download = shaperSvgOf(app.state, cutPlanEntries());
    eq(download, plainExport(app.state), name + ': the downloaded file is byte-identical to the pre-719 exporter call');
    ok(!/hsl\(|data-/.test(download), name + ': no preview styling in the file');
    const items = previewItems(parseShaperSvg(shaperSvgOf(app.state, cutPlanEntries(), { preview: true }), app.document));
    const { shades } = insideStepShades(items);
    const ds = [...shades.keys()].sort((a, b) => parseFloat(a) - parseFloat(b));
    const ls = ds.slice(0, -1).map((d) => L(shades.get(d)));
    console.log(name + ': ' + ds.length + ' steps, lightness ' + JSON.stringify(ls) + ', through ' + shades.get(ds[ds.length - 1]));
    ok(ds.length >= 2 && ls.every((v, i) => i === 0 || v < ls[i - 1]), name + ': deeper steps darker');
    eq(shades.get(ds[ds.length - 1]), '#FFFFFF', name + ': the deepest step (through) is white');
    eq(ls.length === 1 ? ls[0] : [ls[0], ls[ls.length - 1]], ls.length === 1 ? 75 : [90, 60], name + ': scale');
    eq(insideStepShades(items.map((i) => ({ ...i, step: null }))).shades.size, 0, name + ': a plain inside gets no shade');
  }
} finally {
  CUT_PLAN.clear();
  app.close();
}
console.log(`export-preview-720-node.test.js: ok (${checks} checks)`);
