// tests/stepped-spacing-715-node.test.js — TASK 715: the MIN SPACING between kept step outlines of the stepped cut types.
//  1. the ONE rule in #core/stepped-cut.js steppedTerraces({ spacing }): a step is kept only if its outline's closest approach to the previous KEPT
//     outline (the first: the opening) is >= spacing; the last step always; spacing 0 / none = the task 714 steps. Counts on the SA-7 fixtures.
//  2. the app (the real cut card): picking a stepped type stores 1/16 in (1.5875 mm), the Min spacing row, the card note, the export == the Review
//     depths, 0 keeps every step, undo / redo, the last value used is the next stepped cut's default, a plain Pocket has no spacing.
//  3. save + reload keep the spacing and the export byte-identical.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { steppedTerraces, STEP_SPACING } from '#core/stepped-cut.js';
import { CUT_PLAN, cutPlanEntries, planReliefItems, lastStepSpacing, rememberStepSpacing } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection, slopeFromRegion } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const payload = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', FIX), 'utf8'));
const slopeOf = (name, kind) => { const p = payload(name); for (const r of p.regions) { const s = slopeFromRegion(r, { scale: 1, yUp: true }, []); if (s && s.kind === kind) return s; } return null; };
const SIXTEENTH = 25.4 / 16;
eq(STEP_SPACING.defaultMm, SIXTEENTH, 'the default Min spacing is 1/16 in = 1.5875 mm');
eq(STEP_SPACING.minMm, 0, 'the minimum is 0 (keep every step)');

// ── 1. the rule ──
const depthsOf = (name, kind, spacing, step = 1) => steppedTerraces(slopeOf(name, kind), { kind, step, spacing }).steps.map((s) => s.depth);
{
  const draft = (sp, st) => depthsOf('02-drafted-pocket', 'pocket', sp, st);
  eq(draft(0), [1, 2, 3, 4, 5, 6, 7, 8], '10 deg pocket 60x40x8, step 1, spacing 0: 8 steps (task 714 unchanged)');
  eq(draft(undefined), [1, 2, 3, 4, 5, 6, 7, 8], 'no spacing = 0 (task 714 unchanged)');
  eq(draft(SIXTEENTH), [8], 'spacing 1/16 in: only the floor step (0.176 mm per step < 1.5875 mm)');
  eq(draft(0.3), [2, 4, 6, 8], 'spacing 0.3 mm: every 2nd step (2 x 0.176 = 0.353 >= 0.3)');
  eq(draft(0.176), [1, 2, 3, 4, 5, 6, 7, 8], 'spacing just under one step (0.176 < 0.17633): every step kept');
  const T = steppedTerraces(slopeOf('02-drafted-pocket', 'pocket'), { kind: 'pocket', step: 1, spacing: SIXTEENTH });
  eq([T.skipped, T.spacing], [7, SIXTEENTH], 'skipped 7, the spacing used');
  eq(depthsOf('03-pocket-floor-fillet', 'pocket', 0), [5, 6, 7, 8], 'R3 floor fillet, spacing 0: 5, 6, 7, 8 (the vertical part first)');
  eq(depthsOf('03-pocket-floor-fillet', 'pocket', SIXTEENTH), [5, 8], 'R3 floor fillet, 1/16 in: the vertical part and the floor (6 and 7 skipped)');
  eq(depthsOf('06-countersink', 'inside', 0), [1, 19], 'countersink, spacing 0: the countersink step + the straight hole');
  eq(depthsOf('06-countersink', 'inside', SIXTEENTH), [19], 'countersink, 1/16 in: the countersink step (1 mm, 1.0 mm in from the opening) skipped, the full depth kept');
  eq(depthsOf('01-chamfer-outline', 'outside', 0), [1, 2, 19], 'the outline chamfer (outside), spacing 0: 3 steps');
  eq(depthsOf('01-chamfer-outline', 'outside', SIXTEENTH), [2, 19], 'the outline chamfer, 1/16 in: the 1 mm step skipped (outside case)');
  eq(depthsOf('x2-outline-chamfer-top-bottom', 'outside', SIXTEENTH), [19], 'outline chamfered top and bottom, 1/16 in: the full-depth cut only');
  ok(draft(0.3).at(-1) === 8 && draft(SIXTEENTH).at(-1) === 8, 'the last step (the full depth) is always kept');
  eq(depthsOf('x4-pocket-rounded-corners-floor-fillet', 'pocket', SIXTEENTH), [6, 8], 'rounded corners + floor fillet, 1/16 in: the vertical part, the floor');
}

// ── 2. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
const exportOf = (app) => exportShaperSVG({ state: app.state, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true } });
const pocketDepths = (svg) => [...svg.matchAll(/<(?:path|circle) ([^>]*?)\/>/g)].filter((m) => /shaper:cutType="pocket"/.test(m[1])).map((m) => (/shaper:cutDepth="([^"]+)"/.exec(m[1]) || [])[1]);
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pc = doc.getElementById('prepare-canvas');
  const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const set = (cls, text) => { const inp = q(cls); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
  const shown = (row) => q(`.cut-row[data-row="${row}"]`).style.display !== 'none';
  return { q, clickAt, pick, note, set, shown };
};
const recAt = (cutType) => [...CUT_PLAN.entries()].find(([, r]) => r.cutType === cutType);
{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const h = harness(app);
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare });
    const [pk] = recAt('pocket');
    h.clickAt(60, -40);
    ok(!h.shown('stepSpacing') && CUT_PLAN.get(pk).stepSpacing === undefined, 'a plain Pocket: no Min spacing row, no spacing on its record');
    h.pick('stepped-pocket');
    eq(CUT_PLAN.get(pk).stepSpacing, SIXTEENTH, 'Stepped pocket: Min spacing 1/16 in (1.5875 mm) stored on the record');
    ok(h.shown('stepSpacing') && h.shown('stepDepth'), 'the card shows both rows');
    const rows = [...app.document.querySelectorAll('.cut-row')].map((r) => r.dataset.row || r.dataset.param);
    eq(rows.indexOf('stepSpacing'), rows.indexOf('stepDepth') + 1, 'Min spacing is the row right after Step depth');
    eq(h.q('.cut-step-spacing').value, '1.5875', 'the row shows 1.5875 (document unit mm)');
    eq(h.note(), ['Pocket 1 (8mm): 1 step (spacing 1.5875 mm skips 7), 8 mm'], 'the note says how many steps are kept and why');
    eq(pocketDepths(exportOf(app)), ['8.000 mm'], 'export: ONE pocket at 8 mm');
    eq(planReliefItems(app.state).filter((i) => i.cutType === 'pocket').map((i) => i.cutDepth), [8], 'Review: the same ONE pocket');

    const hist = app.state.history.length;
    h.set('.cut-step-spacing', '0.3');
    eq([CUT_PLAN.get(pk).stepSpacing, lastStepSpacing()], [0.3, 0.3], 'Min spacing 0.3 stored and remembered');
    eq(app.state.history.length, hist + 1, 'the change is ONE undo step');
    eq(pocketDepths(exportOf(app)), ['2.000 mm', '4.000 mm', '6.000 mm', '8.000 mm'], 'export at 0.3: every 2nd step');
    eq(planReliefItems(app.state).filter((i) => i.cutType === 'pocket').map((i) => i.cutDepth), [2, 4, 6, 8], 'Review == export');
    eq(h.note(), ['Pocket 1 (8mm): 4 steps (spacing 0.3 mm skips 4), 2 to 8 mm'], 'the note follows');
    h.set('.cut-step-spacing', '0');
    eq(CUT_PLAN.get(pk).stepSpacing, 0, '0 is stored (min 0)');
    eq(pocketDepths(exportOf(app)).length, 8, 'spacing 0: all 8 steps');
    eq(h.note(), ['Pocket 1 (8mm): 8 steps, 1 to 8 mm'], 'spacing 0: the 714 note');
    h.set('.cut-step-spacing', '-1');
    eq(CUT_PLAN.get(pk).stepSpacing, 0, 'a negative value is refused');
    app.key('z', { ctrl: true });
    eq([CUT_PLAN.get(pk).stepSpacing, pocketDepths(exportOf(app)).length], [0.3, 4], 'Ctrl+Z: 0.3 again, 4 pockets');
    app.key('z', { ctrl: true });
    eq(CUT_PLAN.get(pk).stepSpacing, SIXTEENTH, 'Ctrl+Z: 1/16 in again');
    app.key('y', { ctrl: true });
    eq(CUT_PLAN.get(pk).stepSpacing, 0.3, 'Ctrl+Y: 0.3');

    // the last value used is the next stepped cut's default
    h.set('.cut-step-spacing', '0.5');
    importFusionSelection(payload('06-countersink'), { controller: app.controller, prepare: app.prepare });
    h.clickAt(60, -40);
    h.pick('stepped-inside');
    eq(recAt('stepped-inside')[1].stepSpacing, 0.5, 'the next stepped cut starts with the last spacing used (0.5 mm)');
  } finally { await app.close(); }
}

// ── 3. save + reload ──
{
  CUT_PLAN.clear();
  rememberStepSpacing(SIXTEENTH);
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Stepped 715');
  let planBefore, svgBefore;
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      const h = harness(app);
      importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare });
      h.clickAt(60, -40);
      h.pick('stepped-pocket');
      planBefore = JSON.stringify([...CUT_PLAN.entries()]);
      svgBefore = exportOf(app);
      eq(pocketDepths(svgBefore), ['5.000 mm', '8.000 mm'], 'floor fillet at 1/16 in: pocket to 5, then the floor');
      const d = await app.storedDoc();
      ok(d.hosts.shaper.cutPlan.some(([, r]) => r.cutType === 'stepped-pocket' && Number.isFinite(r.stepSpacing)), 'the autosave stores the spacing');
    } finally { await app.close(); }
  }
  CUT_PLAN.clear();
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      eq(JSON.stringify([...CUT_PLAN.entries()]), planBefore, 'after a reload the plan is equal (spacing included)');
      eq(exportOf(app), svgBefore, 'and the export is byte-identical');
    } finally { await app.close(); }
  }
}
console.log(`stepped-spacing-715-node: ok (${checks} checks)`);
