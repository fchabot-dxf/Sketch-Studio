// tests/pocket-auto-angle-853-node.test.js — TASK 853: AUTO raster angle (#core/pocket-clearing.js autoRasterAngle, clearingSettings, planClearing;
// apps/shaper: cut-panel, cut-plan, prepare-view, operations).
//  1. Declared POCKET_CLEARING.rasterAngle ({ default: 'auto', fallback: 0, min: 0, max: 180 }); clearingSettings preserves 'auto', numbers, and falls back to 0 for omitted legacy records.
//  2. autoRasterAngle: stable (vertex-rotation and winding invariant), rectangle = its long side (0°, 90°, 35°, 135°), bow-ties = horizontal (0°; 30° when rotated 30°);
//     all 13 shapes of the 835 tests (Loop on & off) resolve cleanly with 0 stray crossings.
//  3. App: new Raster pockets start on Auto; Angle row offers Auto + 0°/45°/90°; card note & Operations row show "raster auto (30°)"; two pockets in one Auto operation resolve per pocket;
//     existing documents keep their number (no change on load); document save/reload round-trips 'auto'; Prepare's paths regenerate on OK / Preview (817).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { deserializeDocument } from '#core/document.js';
import { createSketchState as sketchState } from '#core/sketch-state.js';
import { createEngine } from '#core/constraint-solver.js';
import { POCKET_CLEARING, planClearing, clearingSettings, pocketRings, strayCrossings, autoRasterAngle } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { deriveProfileCuts } from '#core/profile-model.js';
import { planEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { V2_PLAN } from './helpers/plan-v2.js';
import { clickOpen, editStep } from './helpers/prepare-open.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };

const IN = 25.4, close = (pts) => [...pts, pts[0]];
const rot = (pts, deg) => {
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = -Math.sin(th); // ON SCREEN CCW (world y down)
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

// ── 1. Declared defaults & clearingSettings ──
eq(POCKET_CLEARING.rasterAngle, { default: 'auto', fallback: 0, min: 0, max: 180 }, 'POCKET_CLEARING.rasterAngle declared');
eq(clearingSettings({ cutType: 'pocket', clearing: 'raster', toolDia: 6, rasterAngle: 'auto' }).angle, 'auto', 'clearingSettings keeps auto');
eq(clearingSettings({ cutType: 'pocket', clearing: 'raster', toolDia: 6, rasterAngle: 45 }).angle, 45, 'clearingSettings keeps explicit number');
eq(clearingSettings({ cutType: 'pocket', clearing: 'raster', toolDia: 6 }).angle, 0, 'clearingSettings falls back to 0 when omitted (existing doc)');

// ── 2. autoRasterAngle & planClearing on rectangles, bow-ties, and 13 shapes ──
const rectH = close([[0, 0], [120, 0], [120, 40], [0, 40]]);
const rectV = close([[0, 0], [40, 0], [40, 120], [0, 120]]);
const rect35 = rot(rectH, 35);
const rect135 = rot(rectH, 135);
eq(autoRasterAngle(rectH), 0, 'horizontal rectangle -> 0°');
eq(autoRasterAngle(rectV), 90, 'vertical rectangle -> 90°');
near(autoRasterAngle(rect35), 35, 1e-4, '35° rectangle -> 35°');
near(autoRasterAngle(rect135), 135, 1e-4, '135° rectangle -> 135°');

// Stability: shifted starting vertex and reversed winding produce the exact same angle
const shifted = close([...rect35.slice(2, -1), ...rect35.slice(0, 2)]);
const reversed = close(rect35.slice(0, -1).reverse());
eq(autoRasterAngle(shifted), autoRasterAngle(rect35), 'stable under vertex cycle');
eq(autoRasterAngle(reversed), autoRasterAngle(rect35), 'stable under reversed winding');

const ownerBowtie = { outer: close([[-1.5, -1], [0, -0.25], [1.5, -1], [1.5, 1], [0, 0.25], [-1.5, 1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN };
const SHAPES = { ownerBowtie, ...SHAPES_804 };
eq(autoRasterAngle(ownerBowtie.outer), 0, 'ownerBowtie -> horizontal (0°)');
eq(autoRasterAngle(SHAPES_804.bowtie.outer), 0, '804 bowtie -> horizontal (0°)');
near(autoRasterAngle(rot(ownerBowtie.outer, 30)), 30, 1e-4, '30°-rotated bowtie -> 30°');

for (const [name, sh] of Object.entries(SHAPES)) {
  const stOff = clearingSettings({ cutType: 'pocket', clearing: 'raster', toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 'auto', loop: false });
  const stOn = { ...stOff, loop: true };
  const pOff = planClearing({ outer: sh.outer, holes: sh.holes || [] }, stOff);
  const pOn = planClearing({ outer: sh.outer, holes: sh.holes || [] }, stOn);
  eq([pOff.refused, pOn.refused, pOn.loopRefused], [null, null, null], `${name}: Auto resolves cleanly for Loop off and Loop on`);
  ok(Number.isFinite(pOff.angle) && pOff.angle >= 0 && pOff.angle < 180, `${name}: resolved angle in [0, 180): ${pOff.angle}`);
  eq(pOn.angle, pOff.angle, `${name}: Loop on and Loop off resolve to the same angle`);
  eq(strayCrossings(pOn.clear.map((c) => ({ points: c.points, closed: true, turns: c.turns }))).length, 0, `${name}: Loop on 0 stray crossings`);
  eq(pathCrossings(pOff.clear.filter((c) => c.role === 'raster').map((c) => ({ points: c.points, closed: false }))).count, 0, `${name}: Loop off 0 crossings`);
  // Verify passes actually run along pOff.angle
  const dir = { x: Math.cos((pOff.angle * Math.PI) / 180), y: -Math.sin((pOff.angle * Math.PI) / 180) };
  ok(pOff.passLines.every((l) => {
    const a = l.points[0], b = l.points.at(-1), L = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.abs(Math.abs(((b.x - a.x) * dir.x + (b.y - a.y) * dir.y) / L) - 1) < 1e-5;
  }), `${name}: all passes run along resolved angle ${pOff.angle}°`);
}

// ── 3. App integration (node-app): defaults, UI, multi-pocket op, save/reload, legacy doc, 817 regen ──
function polyState(loops) {
  const joints = new Map(), shapes = [];
  loops.forEach((pts, li) => pts.forEach((p, i) => {
    joints.set(`j${li}_${i}`, { x: p[0], y: p[1] });
    shapes.push({ id: `s${li}_${i}`, type: 'line', joints: [`j${li}_${i}`, `j${li}_${(i + 1) % pts.length}`] });
  }));
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const drawInto = (app, st0) => {
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  for (const [k, v] of st0.joints) st.joints.set(k, v);
  st.shapes.push(...st0.shapes);
};
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
const keyAt = (st, x, y) => { const loops = findLoops(st), lp = polysOf(st); const l = loops.find((l0) => inPoly({ x, y }, lp[l0.id])); return keyOf('loop', l.id); };

SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
SettingsManager.set('ANGLE_PRECISION', null);

const profile = await createProfile();
await createNamedDesign(profile, 'shaper', 'AutoAngle 853');
let savedPlan = null, savedSvg = null;
{
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const doc = app.document, q = (s) => doc.querySelector(s);
    const pressEl = (s) => editStep(app, () => { const e = typeof s === 'string' ? q(s) : s; assert(e, s + ' not found'); app.press(e); });
    const clickRaw = (x, y) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
    const clickAt = (x, y) => clickOpen(app, () => clickRaw(x, y));
    const typed = (cls, v) => editStep(app, () => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); });
    const clearing = (id) => { pressEl('.cut-clear-trigger'); pressEl(`.cut-clear-opt[data-clearing="${id}"]`); };
    const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
    const facts = (n) => n.filter((l) => !/^Leftover: |^Sharp inside corners|of it missed between passes/.test(l));
    const ops = () => [...doc.querySelectorAll('#prepare-ops .ops-row')].map((r) => `${r.querySelector('.ops-name').textContent} | ${r.querySelector('.ops-sub').textContent}`);

    app.press(q('.sk-header-tab[data-tab="design"]'));
    // 30-degree rotated 120 x 40 rectangle (centred around 60, 40) + a vertical 40 x 120 rectangle (at x 160..200)
    const r30 = rot([[-60, -20], [60, -20], [60, 20], [-60, 20]], 30).map(([x, y]) => [x + 60, y + 40]);
    const rV = [[160, -20], [200, -20], [200, 100], [160, 100]];
    drawInto(app, polyState([r30, rV]));
    app.state.saveState('draw');
    app.press(q('.sk-header-tab[data-tab="prepare"]'));

    clickAt(60, 40);
    pressEl('#op-type-pocket');
    typed('.cut-depth', '6');
    typed('.cut-bit', '6');
    clearing('raster');

    const k30 = keyAt(app.state, 60, 40);
    eq(V2_PLAN.get(k30).rasterAngle, 'auto', 'new Raster pocket starts on auto');
    eq([...q('.cut-angle-presets').querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), ['Auto*', '0°', '45°', '90°'], 'Angle presets offer Auto (active) + 0/45/90');
    eq([q('.cut-raster-angle').value, q('.cut-raster-angle').placeholder], ['', 'Auto (30°)'], 'Auto shows resolved angle in placeholder');
    ok(/^Pocket: raster auto \(30°\): \d+ passes \+ 1 ring \+ wall/.test(facts(note())[0]), 'card note shows raster auto (30°): ' + facts(note())[0]);
    ok(ops().some((t) => /· raster auto \(30°\): \d+ passes \+ 1 ring \+ wall$/.test(t)), 'Operations row shows raster auto (30°): ' + JSON.stringify(ops()));

    // Switch to 45° and verify paths/note update; then Undo back to Auto; then type 15 and clear back to Auto
    pressEl('.cut-angle-presets .cut-preset[data-value="45"]');
    eq(V2_PLAN.get(k30).rasterAngle, 45, 'preset 45 stores 45');
    ok(/^Pocket: raster 45°:/.test(facts(note())[0]), 'note updates to raster 45°');
    app.undo();
    eq(V2_PLAN.get(k30).rasterAngle, 'auto', 'Undo returns to auto');
    ok(/^Pocket: raster auto \(30°\):/.test(facts(note())[0]), 'Undo note returns to raster auto (30°)');

    // Typing empty or 'auto' restores 'auto'
    typed('.cut-raster-angle', '15');
    eq(V2_PLAN.get(k30).rasterAngle, 15, 'typing 15 sets 15');
    typed('.cut-raster-angle', 'auto');
    eq(V2_PLAN.get(k30).rasterAngle, 'auto', 'typing auto sets auto');

    // Add vertical rectangle to the SAME operation: each pocket resolves its own angle (30° and 90°)
    app.prepare.ok();
    app.prepare.edit(doc.querySelector('#prepare-ops .ops-row').dataset.id);
    clickRaw(180, 40);
    app.prepare.ok();
    const kV = keyAt(app.state, 180, 40);
    eq(V2_PLAN.get(kV).rasterAngle, 'auto', 'second pocket in op also has auto');
    const opListText = ops()[0];
    ok(opListText.includes('raster auto (30°)') && opListText.includes('raster auto (90°)'), 'two-pocket Auto op resolves per pocket (30° and 90°): ' + opListText);

    // Loop on also uses Auto
    app.prepare.edit(doc.querySelector('#prepare-ops .ops-row').dataset.id);
    editStep(app, () => { const i = q('.cut-loop'); i.checked = true; i.dispatchEvent(new app.window.Event('change')); });
    ok(/^Pocket: raster auto \(30°\): \d+ passes \+ 1 ring \+ wall: one closed loop/.test(facts(note())[0]), 'Loop on uses auto (30°): ' + facts(note())[0]);

    // 817 regeneration behavior: while open, changing angle to 0 does not regenerate until Preview or OK
    const pv = app.prepare;
    pv.view().setOpField('rasterAngle', 0);
    app.prepare.cutPanel.update({ ...app.prepare.view().factsOf(app.prepare.view().activeOp(), k30), mode: 'op', title: 'test', shapes: [] });
    eq(facts(note()).length, 0, '817: unpreviewed open edit clears note until Preview / OK');
    pv.preview();
    ok(/^Pocket: raster 0°:/.test(facts(note())[0]), '817: Preview regenerates with 0°');
    pv.cancel();
    eq(V2_PLAN.get(k30).rasterAngle, 'auto', 'Cancel restores auto');

    savedPlan = JSON.stringify([...V2_PLAN]);
    savedSvg = shaperSvgOf(app.state, planEntries());
    const d = await app.storedDoc();
    ok(JSON.stringify(d.hosts.shaper).includes('"rasterAngle":"auto"'), 'autosave stores rasterAngle: "auto"');
  } finally { await app.close(); }
}

// Reload round-trips 'auto'
V2_PLAN.clear(); V2_PLAN.setOrder([]);
{
  const app = await open({ host: 'shaper', profile });
  try {
    eq(JSON.stringify([...V2_PLAN]), savedPlan, 'reload round-trips auto');
    eq(shaperSvgOf(app.state, planEntries()), savedSvg, 'reload export is byte-identical');
  } finally { await app.close(); }
}

// Existing document with explicit numeric rasterAngle (e.g. 15) or omitted rasterAngle keeps its number (no change on load)
{
  const createSketchState = () => { const e = createEngine(null); e.init(); return sketchState(e, { x: 0, y: 0, w: 100, h: 100 }); };
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]], shapes = [];
  const poly = (p, pts) => { pts.forEach(([x, y], i) => joints.push([p + i, { x, y, sketchId: 'sketch-1' }])); pts.forEach((_, i) => shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)], sketchId: 'sketch-1' })); };
  poly('A', [[0, 0], [40, 0], [40, 120], [0, 120]]); // vertical rect (Auto would be 90°, legacy number 0 or 15 must stay)
  const scratch = createSketchState();
  deserializeDocument({ version: 3, geometry: { joints, shapes, constraints: [] } }, scratch);
  const lid = findLoops(scratch)[0].id;
  for (const [label, recExtra, expectAngle] of [
    ['explicit 15', { rasterAngle: 15 }, 15],
    ['explicit 0', { rasterAngle: 0 }, 0],
    ['omitted', {}, undefined],
  ]) {
    V2_PLAN.clear(); V2_PLAN.setOrder([]);
    const doc = {
      version: 3,
      geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] },
      hosts: { shaper: { version: 3, operations: [{ id: 'op-1', type: 'pocket', on: true, settings: { cutDepth: 6, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', clearing: 'raster', stepover: 40, finishAllowance: 0.5, loop: false, ...recExtra }, geometry: [{ key: keyOf('loop', lid), seq: 1 }] }], regions: {}, nextSeq: 2, listOrder: 'default' } },
    };
    const pf = await createProfile(); await createNamedDesign(pf, 'shaper', 'Legacy ' + label, doc);
    const app = await open({ host: 'shaper', profile: pf });
    try {
      const r = V2_PLAN.get(keyOf('loop', lid));
      eq(r.rasterAngle, expectAngle, `existing doc (${label}) keeps rasterAngle=${expectAngle} (not overwritten with 'auto')`);
      const svgNow = shaperSvgOf(app.state, planEntries());
      const svgDirect = exportShaperSVG({ state: app.state, entries: [{ target: { kind: 'loop', id: lid }, rec: { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', clearing: 'raster', stepover: 40, finishAllowance: 0.5, loop: false, rasterAngle: expectAngle ?? 0 } }], encoding: exportEncoding(), docUnit: 'mm', loopPolys: polysOf(app.state) });
      eq(svgNow, svgDirect, `existing doc (${label}) exports with its number (${expectAngle ?? 0}°)`);
    } finally { await app.close(); }
  }
}

console.log(`pocket-auto-angle-853-node.test.js: ok (${checks} checks)`);
