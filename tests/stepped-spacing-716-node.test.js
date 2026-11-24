// tests/stepped-spacing-716-node.test.js — TASK 716: a stepped cut has ONE control, the Step depth; the card note SHOWS the resulting outline spacing.
//  1. #core/stepped-cut.js: stepGaps (the closest approach of each kept step's outline to the next); no spacing setting: every distinct step is kept.
//  2. the app (the real cut card): no Min spacing row, the note "... · outlines 0.18 mm apart" (a range "min–max" when uneven), the part under 1/16 in is
//     flagged (warning colour + title), the same text in the Review info, a 715-era record (stepSpacing 1.5875) is cut as before 715 (8 steps),
//     export == Review, in a metric and in an inch document.
//  3. save + reload keep the record and the export byte-identical.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import * as steppedCut from '#core/stepped-cut.js';
import { steppedTerraces, stepGaps } from '#core/stepped-cut.js';
import { planEntries, planReliefItems, steppedNoteItems, planSteppedNotes } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection, slopeFromRegion } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { V2_PLAN, storedRecords } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const payload = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', FIX), 'utf8'));
const slopeOf = (name, kind) => { const p = payload(name); for (const r of p.regions) { const s = slopeFromRegion(r, { scale: 1, yUp: true }, []); if (s && s.kind === kind) return s; } return null; };
eq([steppedCut.STEP_SPACING, Object.keys(steppedTerraces(slopeOf('02-drafted-pocket', 'pocket'), { kind: 'pocket', step: 1 })).sort()], [undefined, ['error', 'steps', 'undercutBelow', 'zMax', 'zTop']], 'no STEP_SPACING export; no skipped / spacing in the result');

// ── 1. the gaps ──
const T = (name, kind, o = {}) => steppedTerraces(slopeOf(name, kind), { kind, step: 1, ...o });
{
  const dr = T('02-drafted-pocket', 'pocket');
  eq(dr.steps.map((s) => s.depth), [1, 2, 3, 4, 5, 6, 7, 8], 'drafted pocket, step 1: 8 steps');
  const g = stepGaps(dr.steps);
  eq(g.length, 7, '7 gaps between 8 steps');
  ok(g.every((x) => Math.abs(x - 1 * Math.tan(10 * Math.PI / 180)) < 1e-3), 'every gap is tan(10 deg) = 0.176 mm: evenly spaced');
  eq(T('02-drafted-pocket', 'pocket', { spacing: 1.5875 }).steps.map((s) => s.depth), [1, 2, 3, 4, 5, 6, 7, 8], 'a spacing option (a 715 record) is ignored');
  const ff = stepGaps(T('03-pocket-floor-fillet', 'pocket').steps).map((x) => +x.toFixed(2));
  console.log('R3 floor fillet gaps ' + JSON.stringify(ff));
  eq(ff.length, 3, 'R3 floor fillet: 4 steps, 3 gaps');
  ok(new Set(ff).size === 3 && ff[0] < ff[1] && ff[1] < ff[2], 'the gaps grow toward the flat floor: a range');
  eq(stepGaps(T('02-drafted-pocket', 'pocket', { step: 20 }).steps), [], 'one step: no gap');
  eq(stepGaps(T('01-chamfer-outline', 'outside').steps).map((x) => +x.toFixed(2)), [1, 1], '45 deg chamfer outline: steps 1 mm apart');
}

// ── 2. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
const exportOf = (app, unit = 'mm') => exportShaperSVG({ state: app.state, entries: planEntries(), encoding: exportEncoding(), docUnit: unit, options: {} });
const pocketDepths = (svg) => [...svg.matchAll(/<(?:path|circle) ([^>]*?)\/>/g)].filter((m) => /shaper:cutType="pocket"/.test(m[1])).map((m) => (/shaper:cutDepth="([^"]+)"/.exec(m[1]) || [])[1]);
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pc = doc.getElementById('prepare-canvas');
  const clickRaw = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const clickAt = (x, y) => clickOpen(app, () => clickRaw(x, y)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const warn = () => [...doc.querySelectorAll('.cut-note-warn')].map((d) => [d.textContent, d.title]);
  const set = (cls, text) => { const inp = q(cls); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
  const rows = () => [...doc.querySelectorAll('.cut-row')].filter((r) => r.style.display !== 'none' && !('off' in r.dataset)).map((r) => r.dataset.row || r.dataset.param);
  return { q, clickAt, pick, note, warn, set, rows };
};
const recAt = (cutType) => [...V2_PLAN.entries()].find(([, r]) => r.cutType === cutType);
const reviewDepths = (app) => planReliefItems(app.state).filter((i) => i.cutType === 'pocket').map((i) => i.cutDepth);
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const h = harness(app);
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare, file: true });
    const [pk] = recAt('pocket');
    h.clickAt(60, -40);
    h.pick('roughing');
    ok(!app.document.querySelector('[data-row="stepSpacing"]') && !app.document.querySelector('.cut-step-spacing'), 'the card has NO Min spacing row');
    ok(h.rows().includes('stepDepth'), 'the Step depth row is there');
    eq(V2_PLAN.get(pk).stepSpacing, undefined, 'a new stepped record stores no spacing');
    eq(h.note(), ['Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.176 mm apart'], 'the note shows the spacing: 0.176 mm');
    eq(h.warn(), [[' · outlines 0.176 mm apart', 'outlines this close may be hard to pick on the Origin: try a bigger step']], 'under 1/16 in: the spacing part is flagged, with its title');
    eq(pocketDepths(exportOf(app)).length, 8, 'export: 8 pockets');
    eq(reviewDepths(app), [1, 2, 3, 4, 5, 6, 7, 8], 'Review: the same 8');
    eq(planSteppedNotes(V2_PLAN), ['Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.176 mm apart'], 'the Review info gets the same text');
    // a bigger step: the spacing grows
    h.set('.cut-step-depth', '9');
    eq([h.note(), h.warn()], [['Pocket 1 (8mm): 1 step, 8 mm'], []], 'one step: no spacing, no warning');
    h.set('.cut-step-depth', '4');
    eq(h.note(), ['Pocket 1 (8mm): 2 steps, 4 to 8 mm · outlines 0.705 mm apart'], 'step 4: 0.705 mm apart (4 x tan 10 deg)');
    eq(h.warn().length, 1, '0.7 mm is still under 1/16 in (1.5875 mm): flagged');
    h.set('.cut-step-depth', '1');
    // a 715-era record: a stepSpacing and nothing else: cut as before 715
    V2_PLAN.get(pk).stepSpacing = 25.4 / 16;
    eq(reviewDepths(app), [1, 2, 3, 4, 5, 6, 7, 8], 'a 715-era record (stepSpacing 1.5875): 8 steps, the spacing is ignored');
    eq(pocketDepths(exportOf(app)).length, 8, 'its export: 8 pockets');
    delete V2_PLAN.get(pk).stepSpacing;
    // the R3 floor fillet: a range
    importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare, file: true });
    h.clickAt(60, -40);
    h.pick('roughing');
    const n = steppedNoteItems(recAt('roughing')[1]);
    console.log('floor fillet note: ' + JSON.stringify(n));
    ok(/outlines \d\.\d+–\d\.\d+ mm apart/.test(n[0].text), 'R3 floor fillet: "min–max" range');
    // inches
    SettingsManager.set('DOC_UNIT', 'in');
    const ni = steppedNoteItems(recAt('roughing')[1]);
    console.log('floor fillet note (in): ' + JSON.stringify(ni));
    ok(/outlines \d\.\d+–\d\.\d+ in apart/.test(ni[0].text), 'inch document: the range in inches');
    SettingsManager.set('DOC_UNIT', 'mm');
  } finally { await app.close(); }
}

// ── 3. save + reload ──
{
  V2_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Stepped 716');
  let planBefore, svgBefore;
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      const h = harness(app);
      importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare, file: true });
      h.clickAt(60, -40);
      h.pick('roughing');
      planBefore = JSON.stringify([...V2_PLAN.entries()]);
      svgBefore = exportOf(app);
      eq(pocketDepths(svgBefore).length, 4, 'floor fillet, step 1: 4 pockets (5, 6, 7, 8)');
      const d = await app.storedDoc();
      ok(storedRecords(d.hosts.shaper).some(([, r]) => r.cutType === 'roughing' && r.stepSpacing === undefined), 'the autosave stores the stepped record, with no spacing');
    } finally { await app.close(); }
  }
  V2_PLAN.clear();
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      eq(JSON.stringify([...V2_PLAN.entries()]), planBefore, 'after a reload the plan is equal');
      eq(exportOf(app), svgBefore, 'and the export is byte-identical');
    } finally { await app.close(); }
  }
}
console.log(`stepped-spacing-716-node: ok (${checks} checks)`);
