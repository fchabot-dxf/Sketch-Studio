// tests/stepped-adaptive-717-node.test.js — TASK 717: ADAPTIVE stepping for the stepped cut types: a per-record checkbox "Adaptive stepping" (default OFF);
// ON, the Step depth row is replaced by a "Resolution" row (Coarse 0.5 / Medium 0.25 / Fine 0.1 mm presets, a typed value = Custom, no minimum) = the
// MAXIMUM DEVIATION of the stair from the true slope; each next step is at the deepest depth whose step stays within it (#core/stepped-cut.js
// steppedTerraces with `deviation`, the deviation = stepDeviation: the distance from the step's inner corner to the wall, the CAM scallop height).
//  1. #core: the R3 floor fillet at Coarse / Medium / Fine (more steps each time, every step within the level, checked against an independent
//     computation from the fixture's ring insets and against the true R3 arc), the 10 deg drafted pocket (a straight wall: deviation h * sin 10 deg,
//     so ONE constant step depth), the 45 deg chamfers (pocket / countersink: h * sin 45; the outline's convex corners: the hip, h * sin(atan sqrt 2)),
//     OFF = the 716 result (options without a deviation).
//  2. the app (the real card): the checkbox, the rows, the presets, Custom, the note "Pocket 1 (8mm): adaptive, Medium (0.25 mm): 7 steps at ...",
//     the same text in the Review info, export == Review (plain pockets at their own depths), one undo step per change, the last value remembered,
//     a vertical pocket offers no stepped type, OFF exports byte-identically to a 716 record, inches.
//  3. save + reload keep the adaptive record and the export byte-identical.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { steppedTerraces, stepDeviation, terraceOptions, STEP_RESOLUTION, resolutionLevel } from '#core/stepped-cut.js';
import { CUT_PLAN, cutPlanEntries, planReliefItems, planSteppedNotes, lastAdaptiveSteps, lastStepDeviation } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection, slopeFromRegion } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding, availableTypes } from '../apps/shaper/src/shaper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const payload = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', FIX), 'utf8'));
const slopeOf = (name, kind) => { for (const r of payload(name).regions) { const s = slopeFromRegion(r, { scale: 1, yUp: true }, []); if (s && s.kind === kind) return s; } return null; };
const LEVELS = { coarse: 0.5, medium: 0.25, fine: 0.1 };
eq([STEP_RESOLUTION.levels.map((l) => [l.label, l.mm]), STEP_RESOLUTION.defaultMm, 'minMm' in STEP_RESOLUTION], [[['Coarse', 0.5], ['Medium', 0.25], ['Fine', 0.1]], 0.25, false], 'the levels: Coarse 0.5, Medium 0.25, Fine 0.1 mm; default Medium; no minimum');
eq([resolutionLevel(0.25).label, resolutionLevel(0.3)], ['Medium', null], 'a typed value that is no level = Custom');

// ── 1. the placement ──
const adaptive = (s, kind, tol, depth) => steppedTerraces(s, { kind, deviation: tol, depth });
const depthsOf = (T) => T.steps.map((x) => x.depth);
const devs = (s, kind, ds) => ds.map((d, i) => stepDeviation(s, { kind, from: i ? ds[i - 1] : 0, to: d }));
{
  // the R3 floor fillet (03): vertical to 5 mm, then a quarter arc R3 to the floor at 8 mm
  const s = slopeOf('03-pocket-floor-fillet', 'pocket');
  const minX = (ring) => Math.min(...ring.segments.flatMap((q) => [q.x1, q.x2]));
  const rings = s.rings.map((r) => ({ z: r.z, inset: minX(r) - minX(s.rings[0]) })); // the rings' inward offset (a rectangle: the same on every side)
  const arcInset = (t) => (t <= 5 ? 0 : 3 - Math.sqrt(9 - (t - 5) ** 2));
  ok(rings.every((r) => Math.abs(r.inset - arcInset(r.z)) < 1e-4), 'the fixture: every ring is on the R3 arc (inset 3 - sqrt(9 - (z - 5)^2) from 5 mm)');
  const insetAt = (t) => { for (let i = 1; i < rings.length; i++) if (t <= rings[i].z + 1e-12) { const A = rings[i - 1], B = rings[i]; return A.inset + (B.inset - A.inset) * (t - A.z) / (B.z - A.z); } return rings[rings.length - 1].inset; };
  // INDEPENDENT of #core: the step a -> b's deviation from the ring insets (the model: rings linear between reads). At a corner q of the step's rectangle the
  // wall is (u, t) = (inset(b) - inset(t), t) and the stair's inner corner is (0, a): the min distance from it to the wall polyline.
  const segDist = (p, q) => { const vx = q[0] - p[0], vy = q[1] - p[1], L = vx * vx + vy * vy; let k = L ? -(p[0] * vx + p[1] * vy) / L : 0; k = Math.max(0, Math.min(1, k)); return Math.hypot(p[0] + k * vx, p[1] + k * vy); };
  const modelDev = (a, b) => {
    const ts = [a, ...rings.map((r) => r.z).filter((z) => z > a && z < b), b], pts = ts.map((t) => [insetAt(b) - insetAt(t), t - a]);
    return Math.min(...pts.slice(1).map((p, i) => segDist(pts[i], p)));
  };
  // against the TRUE R3 arc: the corner (inset(b), a) to the wall (the vertical part above 5 mm, the arc centred at inset 3, depth 5)
  const trueDev = (a, b) => {
    const w = arcInset(b), vert = a <= 5 ? w : Math.hypot(w, a - 5);
    const arc = a >= 5 ? 3 - Math.hypot(w - 3, a - 5) : Math.min(Math.hypot(w, a - 5), Math.hypot(w - 3, a - 8));
    return Math.min(vert, arc);
  };
  const sagitta = Math.max(...rings.slice(1).map((r, i) => { const A = rings[i]; if (A.z < 5) return 0; const p1 = Math.asin((A.z - 5) / 3), p2 = Math.asin((r.z - 5) / 3); return 3 * (1 - Math.cos((p2 - p1) / 2)); }));
  const counts = [];
  for (const [name, tol] of Object.entries(LEVELS)) {
    const T = adaptive(s, 'pocket', tol, 8), ds = depthsOf(T), dv = devs(s, 'pocket', ds);
    const md = ds.map((d, i) => modelDev(i ? ds[i - 1] : 0, d)), td = ds.map((d, i) => trueDev(i ? ds[i - 1] : 0, d));
    console.log(`R3 floor fillet ${name} (${tol} mm): ${ds.length} steps at ${ds.join(' ')}; deviation per step ${dv.map((x) => x.toFixed(4)).join(' ')}; independent (rings) ${md.map((x) => x.toFixed(4)).join(' ')}; vs the true arc ${td.map((x) => x.toFixed(4)).join(' ')}`);
    eq(T.deviation, tol, `${name}: the result says its deviation`);
    eq(ds[ds.length - 1], 8, `${name}: the floor (8 mm) is the last step`);
    ok(dv.every((x) => x <= tol + 1e-9), `${name}: every step's deviation <= ${tol} mm`);
    ok(md.every((x, i) => Math.abs(x - dv[i]) < 1e-6), `${name}: the independent computation from the ring insets gives the same deviations`);
    ok(md.slice(0, -1).every((x) => x > tol * 0.97), `${name}: every step but the last is placed at the DEEPEST depth (its deviation within 3% of the level)`);
    ok(td.every((x) => x <= tol + sagitta + 1e-9), `${name}: against the true R3 arc every step is within the level + the rings' largest chord sagitta (${sagitta.toFixed(4)} mm)`);
    counts.push(ds.length);
  }
  eq(counts, [4, 7, 16], 'R3 floor fillet: Coarse 4, Medium 7, Fine 16 steps: finer = more steps');
  const med = depthsOf(adaptive(s, 'pocket', 0.25, 8));
  ok(med[0] > 5 + 1e-9, `the vertical stretch adds no step: the first step (${med[0]} mm) is below the 5 mm where the fillet starts`);
  const gaps = med.slice(1).map((d, i) => d - med[i]);
  ok(gaps.slice(0, -1).every((g, i) => i === 0 || g <= gaps[i - 1] + 1e-9), `steep part tall steps, flat part close steps: the step heights shrink toward the floor (${gaps.map((g) => g.toFixed(3)).join(' ')})`);
}
{
  // the 10 deg drafted pocket (02): a STRAIGHT wall. A step of height h: the stair's inner corner is h * tan(10) from the riser's foot... the wall line
  // through the tread end (h tan 10, 0) and the riser foot (0, h): its distance from the corner (0, 0) = h tan10 * h / sqrt(h^2 tan^2 10 + h^2) = h sin 10.
  // So deviation <= tol <=> h <= tol / sin 10: ONE constant step depth (to 0.001 mm, rounded down), the last step = the floor.
  const s = slopeOf('02-drafted-pocket', 'pocket');
  for (const [name, tol] of Object.entries(LEVELS)) {
    const ds = depthsOf(adaptive(s, 'pocket', tol, 8)), h = Math.floor(tol / Math.sin(10 * Math.PI / 180) * 1000) / 1000;
    const steps = ds.map((d, i) => +(d - (i ? ds[i - 1] : 0)).toFixed(6));
    console.log(`drafted 10 deg ${name}: h = ${tol} / sin 10 = ${(tol / Math.sin(10 * Math.PI / 180)).toFixed(4)} -> ${h}; steps at ${ds.join(' ')}`);
    ok(steps.slice(0, -1).every((x) => Math.abs(x - h) < 1e-9) && steps[steps.length - 1] <= h + 1e-9, `${name}: every step is ${h} mm (the last: the rest to 8 mm)`);
    ok(devs(s, 'pocket', ds).slice(0, -1).every((x) => Math.abs(x - h * Math.sin(10 * Math.PI / 180)) < 1e-6), `${name}: each full step's deviation = h * sin 10 deg`);
  }
  eq(depthsOf(adaptive(s, 'pocket', 0.25, 8)), [1.439, 2.878, 4.317, 5.756, 7.195, 8], 'Medium: 6 steps, 1.439 mm apart (0.25 / sin 10 = 1.4397)');
}
{
  // 45 deg chamfers: a pocket's chamfered top (x1) and a countersink (06): h * sin 45 -> h = 0.25 * sqrt 2 = 0.3536 -> 0.353 at Medium.
  const x1 = depthsOf(adaptive(slopeOf('x1-pocket-chamfer-top-fillet-floor', 'pocket'), 'pocket', 0.25, 8));
  console.log('x1 chamfer top + floor fillet, Medium: ' + x1.join(' '));
  eq(x1.slice(0, 5), [0.353, 0.706, 1.059, 1.412, 1.765], 'x1 45 deg chamfer (2 mm): steps 0.353 mm (0.25 / sin 45 = 0.3536)');
  ok(x1[5] > 5, `x1: the vertical stretch 2..5 mm adds no step (the next step is at ${x1[5]} mm, in the floor fillet)`);
  const cs = depthsOf(adaptive(slopeOf('06-countersink', 'inside'), 'inside', 0.25, 19));
  eq(cs, [0.353, 0.706, 1.059, 1.412, 1.765, 19], 'the 90 deg countersink (45 deg wall, inside): 0.353 mm steps, then ONE cut to 19 mm');
  // a 45 deg chamfer on an OUTSIDE rectangle (01): at its convex corners the stair's corner faces the chamfer's HIP (the two chamfer faces meet on a
  // line going sqrt 2 out per 1 down), so the 3D distance is h * sin(atan sqrt 2) = h * 0.8165 -> 0.25 / 0.8165 = 0.3062 -> 0.306 mm steps.
  const ch = depthsOf(adaptive(slopeOf('01-chamfer-outline', 'outside'), 'outside', 0.25, 19));
  console.log('01 chamfer outline, Medium: ' + ch.join(' '));
  eq(ch.slice(0, 9), [0.306, 0.612, 0.918, 1.224, 1.53, 1.836, 2.142, 2.448, 2.754], 'outside 45 deg chamfer: 0.306 mm steps (the corner hip: 0.25 / sin(atan sqrt 2))');
  eq(ch[ch.length - 1], 19, 'then one cut to the full depth (vertical below 3 mm)');
}
{
  // OFF: no deviation in the options = the task 716 result (the step depth); a record with adaptiveSteps false maps to the same options
  for (const [name, kind] of [['03-pocket-floor-fillet', 'pocket'], ['02-drafted-pocket', 'pocket'], ['x2-outline-chamfer-top-bottom', 'outside'], ['06-countersink', 'inside']]) {
    const s = slopeOf(name, kind), terraceAs = { pocket: 'pocket', inside: 'interior', outside: 'exterior' }[kind];
    const plain = JSON.stringify(steppedTerraces(s, { kind, step: 1 }));
    eq(JSON.stringify(steppedTerraces(s, terraceOptions({ terraceAs, stepDepth: 1, cutDepth: 'unset', adaptiveSteps: false, stepDeviation: 0.1 }))), plain, `${name}: adaptive OFF = the step-depth result`);
    eq(JSON.stringify(steppedTerraces(s, terraceOptions({ terraceAs, stepDepth: 1, cutDepth: 'unset' }))), plain, `${name}: a 716 record (no adaptive fields) = the same`);
  }
  eq(terraceOptions({ terraceAs: 'pocket', stepDepth: 1, cutDepth: 8, adaptiveSteps: true }).deviation, 0.25, 'ON with no stored resolution: Medium');
  eq(adaptive(slopeOf('02-drafted-pocket', 'pocket'), 'pocket', 0.001, 8).deviation, 0.001, 'a deviation of 0.001 mm is kept as given');
}

// ── 2. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
const exportOf = (app, unit = 'mm') => exportShaperSVG({ state: app.state, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: unit, options: { groupByCut: true } });
const elems = (svg) => [...svg.matchAll(/<(path|circle) ([^>]*?)\/>/g)].map((m) => ({ type: /shaper:cutType="([^"]+)"/.exec(m[2])[1], depth: (/shaper:cutDepth="([^"]+)"/.exec(m[2]) || [])[1] }));
const typeDepths = (svg, type) => elems(svg).filter((e) => e.type === type).map((e) => e.depth);
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pc = doc.getElementById('prepare-canvas');
  const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const menu = () => { pressEl('.cut-type-trigger'); const ids = [...doc.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id); pressEl('.cut-type-trigger'); return ids; };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const set = (cls, text) => { const inp = q(cls); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
  const check = (on) => { const c = q('.cut-adaptive'); c.checked = on; c.dispatchEvent(new app.window.Event('change')); };
  const rows = () => [...doc.querySelectorAll('.cut-rows .cut-row')].filter((r) => r.style.display !== 'none').map((r) => r.dataset.row || r.dataset.param);
  const presets = (row) => [...doc.querySelectorAll(`.cut-row[data-row="${row}"] .cut-preset`)].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : ''));
  return { q, pressEl, clickAt, menu, pick, note, set, check, rows, presets };
};
const recAt = (cutType) => [...CUT_PLAN.entries()].find(([, r]) => r.cutType === cutType);
const reviewDepths = (app, type = 'pocket') => planReliefItems(app.state).filter((i) => i.cutType === type).map((i) => i.cutDepth);
const mmStr = (ds) => ds.map((d) => d.toFixed(3) + ' mm');
{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const h = harness(app);
    // a vertical pocket (08: spline walls, no slope): no stepped type, so no checkbox either
    importFusionSelection(payload('08-spline'), { controller: app.controller, prepare: app.prepare });
    h.clickAt(60, -40);
    eq(h.menu().filter((id) => id.startsWith('stepped')), [], 'a vertical pocket offers no stepped type');
    eq(availableTypes('loop', recAt('pocket')[1]).filter((t) => t.slopeKind).length, 0, 'availableTypes: none for a record without a slope');
    h.pick('pocket');
    eq(h.rows(), ['cutDepth', 'clearing', 'cutOffset', 'toolDia', 'cutterShape'], 'a plain Pocket: no Adaptive stepping, Step depth or Resolution row (TASK 745: its Clearing row, Freehand)');

    // the R3 floor fillet (03), Stepped pocket: OFF by default = 716
    CUT_PLAN.clear();
    importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare });
    const [pk] = recAt('pocket');
    h.clickAt(60, -40);
    h.pick('stepped-pocket');
    const r0 = CUT_PLAN.get(pk);
    eq([r0.stepDepth, r0.adaptiveSteps, r0.stepDeviation], [1, false, 0.25], 'a new stepped record: step 1 mm, Adaptive stepping OFF, resolution Medium (0.25 mm) ready');
    eq(h.rows(), ['cutDepth', 'adaptiveSteps', 'stepDepth', 'cutOffset', 'toolDia', 'cutterShape'], 'OFF: the checkbox, then the Step depth row (no Resolution row)');
    eq([h.q('.cut-adaptive').checked, h.q('.cut-row[data-row="adaptiveSteps"] .cut-check').textContent.trim()], [false, 'Adaptive stepping'], 'the checkbox reads "Adaptive stepping", unchecked');
    eq(h.presets('stepDeviation'), [], 'the hidden Resolution row has no preset buttons');
    eq(h.note(), ['Pocket 1 (8mm): 4 steps, 5 to 8 mm · outlines 0.172–2.236 mm apart'], 'OFF: the 716 note');
    const offSvg = exportOf(app);
    { // OFF exports byte-identically to a 716 record (the same record without the 717 fields)
      const saved = CUT_PLAN.get(pk), old = { ...saved }; delete old.adaptiveSteps; delete old.stepDeviation;
      CUT_PLAN.set(pk, old);
      eq(exportOf(app), offSvg, 'OFF: the export is byte-identical to the 716 record\'s');
      CUT_PLAN.set(pk, saved);
    }
    eq(typeDepths(offSvg, 'pocket'), mmStr([5, 6, 7, 8]), 'OFF export: the 716 pockets at 5, 6, 7, 8 mm');

    // ON: one undo step, the Resolution row replaces the Step depth row, Medium
    const hist = app.state.history.length;
    h.check(true);
    eq([CUT_PLAN.get(pk).adaptiveSteps, lastAdaptiveSteps(), app.state.history.length], [true, true, hist + 1], 'checked: stored on the record, remembered, ONE undo step');
    eq(h.rows(), ['cutDepth', 'adaptiveSteps', 'stepDeviation', 'cutOffset', 'toolDia', 'cutterShape'], 'ON: the Resolution row in place of the Step depth row');
    eq([h.q('.cut-row[data-row="stepDeviation"] .cut-field-label').textContent, h.q('.cut-step-deviation').value, h.presets('stepDeviation'), h.presets('stepDepth')], ['Resolution', '0.25', ['Coarse', 'Medium*', 'Fine'], []], 'Resolution 0.25 mm, presets Coarse / Medium (active) / Fine; the hidden step row has none');
    const medium = depthsOf(adaptive(slopeOf('03-pocket-floor-fillet', 'pocket'), 'pocket', 0.25, 8));
    const noteMedium = h.note();
    console.log('card note, Medium: ' + JSON.stringify(noteMedium));
    ok(noteMedium[0].startsWith('Pocket 1 (8mm): adaptive, Medium (0.25 mm): 7 steps at 6.193 · 6.69 · 7.071 · 7.386 · 7.67 · 7.925 · 8 mm · outlines 0.'), 'the note: adaptive, the level, the steps, the spacing');
    eq([...app.document.querySelectorAll('.cut-note-warn')].map((w) => [w.textContent, w.title]), [[noteMedium[0].slice(noteMedium[0].indexOf(' · outlines ')), 'outlines this close may be hard to pick on the Origin: try a coarser resolution']], 'the spacing under 1/16 in is flagged (716\'s hint)');
    eq(planSteppedNotes(CUT_PLAN), noteMedium, 'the Review info gets the same text');
    let svg = exportOf(app);
    const mediumSvg = svg;
    eq(typeDepths(svg, 'pocket'), mmStr(medium), 'export: 7 PLAIN pockets (shaper:cutType="pocket") at the adaptive depths');
    eq(reviewDepths(app), medium, 'export == Review: the same 7 depths');
    ok(!/stepped/.test(svg) && !/adaptive/i.test(svg), 'nothing "stepped" or "adaptive" in the export: plain cuts only');

    // the presets: Coarse -> 4, Fine -> 16
    h.pressEl('.cut-row[data-row="stepDeviation"] .cut-preset[data-value="0.5"]');
    eq([CUT_PLAN.get(pk).stepDeviation, h.presets('stepDeviation'), reviewDepths(app).length, typeDepths(exportOf(app), 'pocket').length], [0.5, ['Coarse*', 'Medium', 'Fine'], 4, 4], 'Coarse: 4 steps, in the Review and the export');
    ok(h.note()[0].startsWith('Pocket 1 (8mm): adaptive, Coarse (0.5 mm): 4 steps at 6.651 · 7.333 · 7.843 · 8 mm'), 'Coarse note: ' + h.note()[0]);
    h.pressEl('.cut-row[data-row="stepDeviation"] .cut-preset[data-value="0.1"]');
    svg = exportOf(app);
    eq([CUT_PLAN.get(pk).stepDeviation, lastStepDeviation(), reviewDepths(app).length], [0.1, 0.1, 16], 'Fine: 16 steps; remembered');
    eq(typeDepths(svg, 'pocket'), mmStr(reviewDepths(app)), 'Fine: export == Review');
    ok(h.note()[0].startsWith('Pocket 1 (8mm): adaptive, Fine (0.1 mm): 16 steps at 5.765 · 6.081'), 'Fine note: ' + h.note()[0]);

    // Custom: a typed value (doc unit), no preset active; any value above 0 is kept
    h.set('.cut-step-deviation', '0.3');
    eq([CUT_PLAN.get(pk).stepDeviation, h.presets('stepDeviation'), h.q('.cut-step-deviation').value], [0.3, ['Coarse', 'Medium', 'Fine'], '0.3'], 'Custom 0.3 mm: stored, no preset active');
    ok(/^Pocket 1 \(8mm\): adaptive, Custom \(0\.3 mm\): \d+ steps at /.test(h.note()[0]), 'the note names it Custom: ' + h.note()[0]);
    const custom = reviewDepths(app);
    ok(custom.length > 4 && custom.length < 7, `Custom 0.3 mm: between Coarse and Medium (${custom.length} steps)`);
    h.set('.cut-step-deviation', '0.001');
    eq(CUT_PLAN.get(pk).stepDeviation, 0.001, 'a typed 0.001 mm is stored as typed (no minimum)');
    h.set('.cut-step-deviation', 'abc');
    eq([CUT_PLAN.get(pk).stepDeviation, h.q('.cut-step-deviation').value], [0.001, '0.001'], 'an unreadable value changes nothing (the field shows the stored one again)');

    // undo / redo walk back through every change to OFF
    app.key('z', { ctrl: true });
    eq(CUT_PLAN.get(pk).stepDeviation, 0.3, 'Ctrl+Z: Custom 0.3 again');
    app.key('z', { ctrl: true }); app.key('z', { ctrl: true }); app.key('z', { ctrl: true });
    eq([CUT_PLAN.get(pk).adaptiveSteps, CUT_PLAN.get(pk).stepDeviation], [true, 0.25], 'Ctrl+Z x3: Fine, Coarse, back to Medium');
    eq(exportOf(app), mediumSvg, 'and the Medium export again');
    app.key('z', { ctrl: true });
    eq(CUT_PLAN.get(pk).adaptiveSteps, false, 'Ctrl+Z: OFF');
    eq([exportOf(app), h.rows().includes('stepDepth')], [offSvg, true], 'OFF: the 716 export and the Step depth row again');
    app.key('y', { ctrl: true });
    eq([CUT_PLAN.get(pk).adaptiveSteps, reviewDepths(app)], [true, medium], 'Ctrl+Y: ON, Medium');
    app.key('y', { ctrl: true });
    eq(CUT_PLAN.get(pk).stepDeviation, 0.5, 'Ctrl+Y: Coarse');

    // the last value is the next stepped cut's default: the countersunk hole (06), Stepped inside
    h.pressEl('.cut-row[data-row="stepDeviation"] .cut-preset[data-value="0.1"]');
    importFusionSelection(payload('06-countersink'), { controller: app.controller, prepare: app.prepare });
    h.clickAt(60, -40);
    h.pick('stepped-inside');
    const [hk, hr] = recAt('stepped-inside');
    eq([hr.adaptiveSteps, hr.stepDeviation, h.q('.cut-adaptive').checked, h.presets('stepDeviation')], [true, 0.1, true, ['Coarse', 'Medium', 'Fine*']], 'the next stepped cut starts adaptive, at Fine (the last values)');
    eq(typeDepths(exportOf(app), 'inside'), mmStr(reviewDepths(app, 'interior')), 'its export == its Review');
    eq(reviewDepths(app, 'interior').slice(0, 3), [0.141, 0.282, 0.423], 'the 45 deg countersink at Fine: 0.141 mm steps (0.1 / sin 45)');
    // inches
    SettingsManager.set('DOC_UNIT', 'in');
    h.clickAt(60, -40);
    console.log('inches: ' + JSON.stringify(h.note()) + ' field ' + h.q('.cut-step-deviation').value);
    ok(/^Through Hole 1: adaptive, Fine \(0\.004 in\): 15 steps at 0\.006 · /.test(h.note()[0]), 'the note in inches');
    eq(h.q('.cut-step-deviation').value, '0.004', 'the Resolution field in inches (3 decimals)');
    h.set('.cut-step-deviation', '0.02');
    eq(+CUT_PLAN.get(hk).stepDeviation.toFixed(6), 0.508, 'a typed 0.02 in = 0.508 mm (Custom)');
    SettingsManager.set('DOC_UNIT', 'mm');
  } finally { await app.close(); }
}
// ── 3. save + reload ──
{
  CUT_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Adaptive 717');
  let planBefore, svgBefore;
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      const h = harness(app);
      importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare });
      h.clickAt(60, -40);
      h.pick('stepped-pocket');
      h.check(true);
      h.set('.cut-step-deviation', '0.2');
      planBefore = JSON.stringify([...CUT_PLAN.entries()]);
      svgBefore = exportOf(app);
      const d = await app.storedDoc();
      ok(d.hosts.shaper.cutPlan.some(([, r]) => r.cutType === 'stepped-pocket' && r.adaptiveSteps === true && r.stepDeviation === 0.2), 'the autosave stores the record adaptive, at 0.2 mm');
    } finally { await app.close(); }
  }
  CUT_PLAN.clear();
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      eq(JSON.stringify([...CUT_PLAN.entries()]), planBefore, 'after a reload the plan is equal');
      eq(exportOf(app), svgBefore, 'and the export is byte-identical');
      const h = harness(app);
      h.clickAt(60, -40);
      eq([h.q('.cut-adaptive').checked, h.q('.cut-step-deviation').value, h.rows().includes('stepDeviation')], [true, '0.2', true], 'the card shows it adaptive, Custom 0.2 mm');
    } finally { await app.close(); }
  }
}
console.log(`stepped-adaptive-717-node: ok (${checks} checks)`);
