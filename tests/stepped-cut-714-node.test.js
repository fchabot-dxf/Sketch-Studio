// tests/stepped-cut-714-node.test.js — TASK 714: the STEPPED cut types (Stepped pocket / Stepped inside / Stepped outside) from a Fusion
// region's `slope` (SA-7). Fixtures: tests/fixtures/sa7-slope/*.json, the advisor's live SA-7 payloads (turn 1950), unchanged.
//  1. the ONE terrace function (#core/stepped-cut.js steppedTerraces, on the record's slope as fusion-import.js stores it): a 10-degree drafted
//     pocket 60 x 40 x 8 at step 1 = 8 pockets, outlines shrinking ~0.176 mm per side per step, depths 1..8; an R3 floor fillet (one pocket
//     for the vertical part + steps in the fillet only); a chamfered top; a countersink (steps through the countersink, then ONE full-depth
//     inside cut); an outline chamfered top AND bottom (the undercut: ONE full-depth outside cut at 0..120, the warning); interpolation
//     between read rings (step 0.3, rounded corners); identical consecutive steps merged.
//  2. the app (Shaper's declared Prepare stage through tests/helpers/node-app.js, the real cut card): the menu offers a stepped type only on a
//     target with a slope of its kind (not on a vertical pocket), switching gives the default step 1 mm, the export writes N plain pockets at
//     their depths (the Origin sees plain pockets), the Review items have the terrace depths, the step row changes them live, undo / redo
//     restore type and step, the last step used is the next stepped cut's default, a slope on a plain Pocket changes nothing in its export.
//  3. save + reload keep the stepped record (type, step, slope) and the export byte-identical.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { buildRelief } from '#core/relief-model.js';
import { steppedTerraces, sameOutline, STEP_DEPTH, SAME_OUTLINE_TOL_MM } from '#core/stepped-cut.js';
import { planEntries, planReliefItems, lastStepDepth } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection, slopeFromRegion } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding, CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { typeRefusal } from '../apps/shaper/src/cut-plan.js'; // TASK S2: the one compatibility rule
import { V2_PLAN, storedRecords } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen, editStep } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };

const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const payload = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', FIX), 'utf8'));
const regionOf = (p, label) => p.regions.find((r) => r.label === label);
const slopeOf = (name, label) => slopeFromRegion(regionOf(payload(name), label), { scale: 1, yUp: true }, []);
const box = (poly) => { const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const TAN10 = Math.tan((10 * Math.PI) / 180); // 0.17633 mm per mm of depth

// ── 1. the terrace function ──
{
  // 10-degree drafted pocket 60 x 40 x 8 (x 30..90, y 20..60 Y-up = world y -60..-20), step 1
  const slope = slopeOf('02-drafted-pocket', 'Pocket 1 (8mm)');
  eq([slope.kind, slope.label, slope.rings.length], ['pocket', 'Pocket 1 (8mm)', 33], 'the stored slope: kind, label, 33 rings');
  const T = steppedTerraces(slope, { kind: 'pocket', step: 1, depth: 8 });
  eq(T.steps.map((s) => s.depth), [1, 2, 3, 4, 5, 6, 7, 8], 'drafted pocket at step 1: 8 pockets at depths 1..8');
  eq([T.undercutBelow, T.error], [null, null], 'no undercut, no error');
  T.steps.forEach((s, i) => {
    const k = i + 1, b = box(s.outlines[0].polygon);
    eq(s.outlines.length, 1, `step ${k}: one outline`);
    ok(s.outlines[0].walk && s.outlines[0].walk.every((g) => g.type === 'line'), `step ${k}: the exact ring (4 lines) is kept`);
    near(b[0], 30 + k * TAN10, 0.002, `step ${k}: the left side moves in ${(k * TAN10).toFixed(3)} mm (the ring at the BOTTOM of the step)`);
    near(b[2], 90 - k * TAN10, 0.002, `step ${k}: the right side`);
    near(b[1], -60 + k * TAN10, 0.002, `step ${k}: the far side`);
    near(b[3], -20 - k * TAN10, 0.002, `step ${k}: the near side`);
  });
  near(box(T.steps[0].outlines[0].polygon)[0], 30.176, 0.001, 'live example: 1 mm = 30.176..89.824');
  near(box(T.steps[7].outlines[0].polygon)[0], 31.411, 0.001, 'live example: floor = 31.411..88.589');

  // interpolation between read rings: step 0.3 -> depths 0.3, 0.6, ... (0.3 is between the rings at 0.25 and 0.5)
  const T3 = steppedTerraces(slope, { kind: 'pocket', step: 0.3, depth: 8 });
  eq(T3.steps.length, 27, 'step 0.3 over 8 mm: 26 steps of 0.3 + the floor');
  near(box(T3.steps[0].outlines[0].polygon)[0], 30 + 0.3 * TAN10, 0.002, 'a ring between two read rings is interpolated (exact for a draft)');
  ok(T3.steps[0].outlines[0].walk, 'the interpolated ring keeps an exact walk');
  near(T3.steps.at(-1).depth, 8, 1e-12, 'the last step is at the floor');
  for (let i = 1; i < T3.steps.length; i++) ok(!sameOutline(T3.steps[i - 1].outlines[0].polygon, T3.steps[i].outlines[0].polygon), `drafted: every step differs from the one above (${i})`);
  // no step depth: STEP_DEPTH.defaultMm (a small step is kept as given: TASK 736 removed the 0.1 mm floor; the merge compares with the run's FIRST outline)
  eq(steppedTerraces(slope, { kind: 'pocket', step: 0.01, depth: 8 }).steps.length, 160, 'a step of 0.01 mm is kept as given: 160 steps (each merged step drifts <= 0.01 mm from its first outline: 8 mm x tan 10 deg / 0.01 mm ~ 141 runs, plus run-boundary rounding)');
  eq(steppedTerraces(slope, { kind: 'pocket', depth: 8 }).steps.length, 8, `no step depth: ${STEP_DEPTH.defaultMm} mm`);
}
{
  // R3 floor fillet: vertical 0..5 mm, fillet 5..8 -> ONE pocket for the vertical part, steps only in the fillet
  const T = steppedTerraces(slopeOf('03-pocket-floor-fillet', 'Pocket 1 (8mm)'), { kind: 'pocket', step: 1, depth: 8 });
  eq(T.steps.map((s) => s.depth), [5, 6, 7, 8], 'floor fillet: one pocket at 5 (depths 1..5 merged: identical outlines), then 6, 7, 8');
  const inset = T.steps.map((s) => +(box(s.outlines[0].polygon)[0] - 30).toFixed(3));
  eq(inset, [0, 0.172, 0.764, 3], 'floor fillet insets: 0 (the vertical wall), 0.172 at 6 mm, 0.764 at 7 mm, 3 at the floor (live example)');
}
{
  // chamfered top + floor fillet pocket (x1): the 1 mm step is WIDER than the vertical wall (the chamfer), then the vertical part, then the fillet
  const T = steppedTerraces(slopeOf('x1-pocket-chamfer-top-fillet-floor', 'Pocket 1 (8mm)'), { kind: 'pocket', step: 1, depth: 8 });
  eq(T.steps.map((s) => [s.depth, +box(s.outlines[0].polygon)[0].toFixed(3)]), [[1, 29], [5, 30], [6, 30.172], [7, 30.764], [8, 33]], 'chamfered top: 29 at 1 mm, 30 down to 5 mm (merged), then the fillet');
  // chamfered outline top (01, outside): wider each step down to 3 mm, then ONE full-depth outside cut
  const O = steppedTerraces(slopeOf('01-chamfer-outline', 'Outline'), { kind: 'outside', step: 1, depth: 19 });
  eq(O.steps.map((s) => [s.depth, box(s.outlines[0].polygon).map((v) => +v.toFixed(3))]), [[1, [2, -78, 118, -2]], [2, [1, -79, 119, -1]], [19, [0, -80, 120, 0]]], 'chamfered outline: outside cuts at the ring at the bottom of each step (material kept outside the chamfer), then 0..120 through');
}
{
  // countersink d10 -> d6 by 2 mm then straight (06, inside): steps through the countersink only, then ONE full-depth inside cut, exact circles
  const T = steppedTerraces(slopeOf('06-countersink', 'Through Hole 1'), { kind: 'inside', step: 1, depth: 19 });
  eq(T.steps.map((s) => [s.depth, s.outlines[0].walk.length, s.outlines[0].walk[0].type, +s.outlines[0].walk[0].r.toFixed(6)]), [[1, 1, 'circle', 4], [19, 1, 'circle', 3]], 'countersink: r 4 at 1 mm, then r 3 through (19 mm), exact circles');
  // a filleted hole top (x3): r 5.268 at 1 mm, then r 5 through
  const F = steppedTerraces(slopeOf('x3-hole-filleted-top', 'Through Hole 1'), { kind: 'inside', step: 1, depth: 19 });
  eq(F.steps.map((s) => [s.depth, +s.outlines[0].walk[0].r.toFixed(6)]), [[1, 5.267949], [19, 5]], 'filleted hole top: r 5.267949 at 1 mm, then r 5 through');
}
{
  // UNDERCUT (advisor): the outline chamfered top AND bottom (x2). Outside = the UNION of the rings above: steps through the top 2 mm, then ONE
  // full-depth outside cut at 0..120 (never at the bottom ring 2..118: the Origin cuts from the top), and the warning depth 17.
  const T = steppedTerraces(slopeOf('x2-outline-chamfer-top-bottom', 'Outline'), { kind: 'outside', step: 1, depth: 19 });
  eq(T.steps.map((s) => [s.depth, box(s.outlines[0].polygon).map((v) => +v.toFixed(3))]), [[1, [1, -79, 119, -1]], [19, [0, -80, 120, 0]]], 'x2: 1..119 at 1 mm, then ONE cut at 0..120 to 19 mm');
  eq(T.undercutBelow, 17, 'x2: undercut below 17 mm (cut straight)');
  // the same rings as a POCKET take the INTERSECTION: narrowing below 17 mm is reachable, widening at the top is not
  const P = steppedTerraces(slopeOf('x2-outline-chamfer-top-bottom', 'Outline'), { kind: 'pocket', step: 1, depth: 19 });
  eq(P.steps.map((s) => [s.depth, box(s.outlines[0].polygon).map((v) => +v.toFixed(3))]), [[19, [2, -78, 118, -2]]], 'as a pocket: the top ring (2..118) is the narrowest, so every step is it: ONE cut to 19 mm');
  eq(P.undercutBelow, 0, 'as a pocket the rings widen right below the top: undercut below 0 mm');
}
{
  // rounded corners + floor fillet (x4): arcs move with the fillet; an interpolated ring (step 0.3) keeps arcs
  const s = slopeOf('x4-pocket-rounded-corners-floor-fillet', 'Pocket 1 (8mm)');
  const T = steppedTerraces(s, { kind: 'pocket', step: 1, depth: 8 });
  eq(T.steps.map((x) => [x.depth, +box(x.outlines[0].polygon)[0].toFixed(3)]), [[6, 30], [7, 30.268], [8, 32]], 'rounded pocket: the vertical part to 6 mm, then the fillet');
  const T3 = steppedTerraces(s, { kind: 'pocket', step: 0.3, depth: 8 });
  const mid = T3.steps.find((x) => Math.abs(x.depth - 6.3) < 1e-9);
  ok(mid && mid.outlines[0].walk && mid.outlines[0].walk.filter((g) => g.type === 'arc').length === 4, 'step 0.3: the ring at 6.3 mm (between 6.25 and 6.5) is interpolated with its 4 corner arcs');
  const r625 = 4.984313, r65 = 4.936492;
  near(mid.outlines[0].walk.find((g) => g.type === 'arc').r, r625 + (r65 - r625) * 0.2, 1e-6, 'its corner radius is interpolated');
}
eq(SAME_OUTLINE_TOL_MM, 0.01, 'the stated tolerance for identical steps: 0.01 mm');

// ── 2. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
const exportOf = (app) => exportShaperSVG({ state: app.state, entries: planEntries(), encoding: exportEncoding(), docUnit: 'mm', options: {} });
const elems = (svg) => [...svg.matchAll(/<(path|circle) ([^>]*?)\/>/g)].map((m) => ({ tag: m[1], type: /shaper:cutType="([^"]+)"/.exec(m[2])[1], depth: (/shaper:cutDepth="([^"]+)"/.exec(m[2]) || [])[1], geom: m[2].replace(/ fill=.*$/, '') }));
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressElRaw = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pressEl = (s) => editStep(app, () => pressElRaw(s)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const pc = doc.getElementById('prepare-canvas');
  const clickRaw = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const clickAt = (x, y) => clickOpen(app, () => clickRaw(x, y)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)
  const menu = () => { pressEl('.cut-type-trigger'); const ids = [...doc.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id + (o.disabled ? ':off' : '')); pressEl('.cut-type-trigger'); return ids; };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const stepRowShown = () => q('.cut-row[data-row="stepDepth"]').style.display !== 'none';
  const setStep = (text) => editStep(app, () => { const inp = q('.cut-step-depth'); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); }); // TASK S2: its own step
  return { q, pressEl, clickAt, menu, pick, note, stepRowShown, setStep };
};
const recAt = (cutType) => [...V2_PLAN.entries()].find(([, r]) => r.cutType === cutType);

{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const h = harness(app);
    // a vertical pocket (08: spline walls, no slope): no stepped type
    importFusionSelection(payload('08-spline'), { controller: app.controller, prepare: app.prepare, file: true });
    ok(!recAt('pocket')[1].slope, '08-spline: the pocket carries no slope');
    h.clickAt(60, -40);
    eq(h.menu(), ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock'] /* TASK S2: the Contour in the menus */, 'a vertical pocket: the plain types + Roughing (TASK 792: Roughing, which replaced the stepped types, is offered on every closed region)');
    eq(CUT_TYPES.filter((t) => !typeRefusal(t.id, ['loop:any'])).map((t) => t.id), CUT_TYPES.map((t) => t.id), 'a closed shape takes every type (TASK S2: the Contour too: an operation type of its own)');

    // the drafted pocket (02): Stepped pocket offered on the pocket only
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare, file: true });
    const [pk, pocketRec] = recAt('pocket');
    eq([pocketRec.cutType, pocketRec.cutDepth, pocketRec.slope.kind], ['pocket', 8, 'pocket'], 'Fusion import: the sloped pocket stays a Pocket (straight) and carries its slope');
    const plainSvg = exportOf(app);
    { // a slope on a plain Pocket changes nothing in its export: the same plan without the slope exports byte-identically
      const saved = { ...V2_PLAN.get(pk) }; V2_PLAN.set(pk, { ...saved }); delete V2_PLAN.get(pk).slope;
      eq(exportOf(app), plainSvg, 'a plain Pocket exports the same with or without a slope');
      V2_PLAN.set(pk, saved);
    }
    eq(elems(plainSvg).map((e) => e.type + '@' + e.depth), ['outside@19.000 mm', 'pocket@8.000 mm'], 'plain: the outline + ONE pocket at 8 mm');
    h.clickAt(10, -10); // the outline (no slope)
    eq(h.menu().filter((id) => id.startsWith('stepped')), [], 'TASK 792: no stepped type is offered anywhere any more');
    h.clickAt(60, -40); // the pocket
    eq(h.menu(), ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock'] /* TASK S2: the Contour in the menus */, 'the sloped pocket: Roughing, right after Pocket (TASK 792: it replaced the Stepped pocket)');
    ok(!h.stepRowShown(), 'a Pocket has no step row');

    h.pick('roughing');
    eq([V2_PLAN.get(pk).cutType, V2_PLAN.get(pk).stepDepth, V2_PLAN.get(pk).cutDepth], ['roughing', 1, 8], 'picked: Stepped pocket, step depth 1 mm (the default), depth 8 kept');
    ok(h.stepRowShown() && h.q('.cut-step-depth').value === '1', 'the card shows the Step depth row: 1');
    eq(h.q('.cut-type-cur').textContent, 'Roughing', 'the card names the type');
    ok(h.q('.cut-ic-slot svg') && h.q('.cut-ic-slot svg').innerHTML.includes('M4.5 13.5V10.5h3v-3h3v-3h3'), 'with its own icon (a stair)');
    eq(h.note(), ['Pocket 1 (8mm): 8 steps, 1 to 8 mm \u00b7 outlines 0.176 mm apart'], 'the card note: the steps');
    const stepped = elems(exportOf(app));
    eq(stepped.map((e) => e.tag + ':' + e.type + '@' + e.depth), ['path:outside@19.000 mm', ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `path:pocket@${k}.000 mm`)], 'export: the outline + 8 PLAIN pockets (shaper:cutType="pocket") at 1..8 mm');
    ok(stepped[1].geom.includes('M 89.8237 -20.1763 L 30.1763 -20.1763 L 30.1763 -59.8237 L 89.8237 -59.8237 Z'), 'the 1 mm pocket is the ring at 1 mm (30.176..89.824): ' + stepped[1].geom);
    const items = planReliefItems(app.state);
    eq(items.map((i) => i.cutType + '@' + i.cutDepth), ['exterior@19', ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => 'pocket@' + k)], 'the Review items: the same 8 pockets at their depths');
    eq(buildRelief({ stock: { thickness: 19 }, items }).levels.map((l) => l.depth), [1, 2, 3, 4, 5, 6, 7, 8, 19], 'the relief has a level per terrace');

    // the step row: 2 mm -> 4 pockets, live in the export and the Review; the last step used becomes the default
    const hist = app.state.history.length;
    h.setStep('2');
    eq([V2_PLAN.get(pk).stepDepth, lastStepDepth()], [2, 2], 'step depth 2 stored on the record, and remembered');
    eq(app.state.history.length, hist + 1, 'the step change is ONE undo step');
    eq(elems(exportOf(app)).filter((e) => e.type === 'pocket').map((e) => e.depth), ['2.000 mm', '4.000 mm', '6.000 mm', '8.000 mm'], 'export follows: 4 pockets');
    eq(planReliefItems(app.state).filter((i) => i.cutType === 'pocket').map((i) => i.cutDepth), [2, 4, 6, 8], 'Review follows');
    eq(h.note(), ['Pocket 1 (8mm): 4 steps, 2 to 8 mm \u00b7 outlines 0.353 mm apart'], 'the note follows');
    h.setStep('0.01');
    eq(V2_PLAN.get(pk).stepDepth, 0.01, 'a step of 0.01 mm is stored as typed (no minimum)');
    app.key('z', { ctrl: true });
    eq(V2_PLAN.get(pk).stepDepth, 2, 'Ctrl+Z: step 2 again');
    app.key('z', { ctrl: true });
    eq([V2_PLAN.get(pk).cutType, V2_PLAN.get(pk).stepDepth], ['roughing', 1], 'Ctrl+Z: step 1');
    app.key('z', { ctrl: true });
    eq([V2_PLAN.get(pk).cutType, Boolean(V2_PLAN.get(pk).slope)], ['pocket', true], 'Ctrl+Z: Pocket again, the slope kept');
    eq(exportOf(app), plainSvg, 'and the export is the plain one again');
    app.key('y', { ctrl: true });
    eq([V2_PLAN.get(pk).cutType, V2_PLAN.get(pk).stepDepth], ['roughing', 1], 'Ctrl+Y: Stepped pocket, step 1');
    app.key('y', { ctrl: true });
    eq(V2_PLAN.get(pk).stepDepth, 2, 'Ctrl+Y: step 2');

    // the countersunk hole (06): Stepped inside only, with the last step used as its step
    importFusionSelection(payload('06-countersink'), { controller: app.controller, prepare: app.prepare, file: true });
    h.clickAt(60, -40);
    eq(h.menu().filter((id) => id === 'roughing'), ['roughing'], 'a countersunk hole: Roughing (TASK 792: in place of Stepped inside)');
    h.pick('roughing');
    const [hk] = recAt('roughing');
    eq(V2_PLAN.get(hk).stepDepth, 0.01, 'the next cut switched to a stepped type starts with the last step used (0.01 mm, set above)');
    h.setStep('1');
    eq(elems(exportOf(app)).filter((e) => e.type === 'inside').map((e) => `${e.tag} ${e.geom} @${e.depth}`), ['circle cx="60" cy="-40" r="4" @1.000 mm', 'circle cx="60" cy="-40" r="3" @19.000 mm'], 'export: an inside circle r 4 at 1 mm, then ONE inside circle r 3 at 19 mm');

    // the outline chamfered top and bottom (x2): Stepped outside, the undercut is cut straight and said
    importFusionSelection(payload('x2-outline-chamfer-top-bottom'), { controller: app.controller, prepare: app.prepare, file: true });
    h.clickAt(60, -40);
    eq(h.menu().filter((id) => id === 'roughing'), ['roughing'], 'the chamfered outline: Roughing (TASK 792: in place of Stepped outside)');
    h.pick('roughing');
    eq(h.note(), ['Outline: 2 steps, 1 to 19 mm \u00b7 outlines 1 mm apart', 'Outline: undercut below 17 mm cut straight'], 'the card note: the steps and the undercut warning');
    const out = elems(exportOf(app));
    eq(out.map((e) => e.type + '@' + e.depth), ['outside@1.000 mm', 'outside@19.000 mm'], 'export: 2 PLAIN outside cuts');
    ok(/^d="M (1|119) (-1|-79) /.test(out[0].geom), 'the 1 mm cut is the ring 1..119: ' + out[0].geom);
    ok(/^d="M (0|120) (0|-80) /.test(out[1].geom), 'the full-depth cut is at 0..120 (the widest outline above), not the bottom ring 2..118: ' + out[1].geom);
  } finally {
    await app.close();
  }
}

// ── 3. save + reload ──
{
  V2_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Stepped 714'); // only a NAMED design autosaves; the next load restores it
  let planBefore, svgBefore;
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      const h = harness(app);
      importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare, file: true });
      h.clickAt(60, -40);
      h.pick('roughing');
      h.setStep('0.5');
      planBefore = JSON.stringify([...V2_PLAN.entries()]);
      svgBefore = exportOf(app);
      eq(elems(svgBefore).filter((e) => e.type === 'pocket').map((e) => e.depth), ['5.000 mm', '5.500 mm', '6.000 mm', '6.500 mm', '7.000 mm', '7.500 mm', '8.000 mm'], 'floor fillet at step 0.5: one pocket to 5 mm, then the fillet steps');
      const d = await app.storedDoc();
      ok(storedRecords(d.hosts.shaper).some(([, r]) => r.cutType === 'roughing' && r.stepDepth === 0.5 && r.slope && r.slope.rings.length === 14), 'the autosave stores the stepped record with its step and slope');
    } finally { await app.close(); }
  }
  V2_PLAN.clear();
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      eq(JSON.stringify([...V2_PLAN.entries()]), planBefore, 'after a reload the plan is equal (type, step, slope)');
      eq(exportOf(app), svgBefore, 'and the export is byte-identical');
    } finally { await app.close(); }
  }
}

console.log(`stepped-cut-714-node: ok (${checks} checks)`);
