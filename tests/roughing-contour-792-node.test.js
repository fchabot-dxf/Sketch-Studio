// tests/roughing-contour-792-node.test.js — TASK 792: ROUGHING and CONTOUR for any part with depth information (#core/stepped-cut.js, its TASK 792 header).
//  1. LEVELS: an STL's material sections (#core/stl-slice.js `levels` on the outline region, synthetic meshes of tests/helpers/stl-mesh.js: a boss on a
//     plate, a dome) read into the record (fusion-import.js -> #core readLevels), and a Fusion-style payload that sends `levels` itself (two raised squares
//     on a plate); a Fusion part without them cuts from its regions + slope rings (02-drafted-pocket).
//  2. ROUGHING from levels: one pocket per level (count, depth), the work area = the outline + 2 bits, every material island a hole, the allowance
//     measured (each hole within 0.01 mm of the material grown by the allowance), identical levels merged; from a slope: the stepped terraces with the
//     allowance as offset; a drawn pocket: ONE level (the pocket, its offset + the allowance).
//  3. CONTOUR from levels: an Outside cut along each material loop / an Inside cut along each hole, the bit centre at the bit radius on the waste side;
//     from a slope (the drafted pocket, Pocket + Contour): every contour pass lies on the wall at its depth, none on the floor or past it; a drawn pocket:
//     its wall (Inside) + its island (Outside).
//  4. MIGRATION: a saved Stepped pocket / inside / outside record opens as Roughing with its step, allowance 0, and exports exactly what the same record
//     exported as a stepped cut (the stepped engine, unchanged); a stored operation key with the old type is mapped too.
//  5. the app (Shaper through tests/helpers/node-app.js, the real cut card): Roughing in the menu of every region, its rows, the Contour row (On adds the
//     Contour record and sets the allowance to the finish allowance; Off removes it and sets 0), Edit contour shows the Contour's card (its step, bit,
//     cutter shape), the Operations list (two operations, two bit groups, the Contour after the Roughing), undo / redo, save + reload, a design without
//     these operations exports the same with or without `levels` on its records.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import * as M from './helpers/stl-mesh.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { parseStl, sliceStl } from '#core/stl-slice.js';
import { readLevels, levelsRoughing, levelsContour, deriveCuts, LEVELS, steppedTerraces, sameOutline } from '#core/stepped-cut.js';
import { regionsFromRings, offsetRegions, diffRegions, regionsArea } from '#core/plot/clip.js';
import { buildRelief } from '#core/relief-model.js';
import { CUT_PLAN, cutPlanEntries, planReliefItems, contourKeyOf, contourOf, setContour, resolveEntry } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { planOperations, opOrder, setOpOrder } from '../apps/shaper/src/operations.js';
import { effectiveCutRecord, availableTypes } from '../apps/shaper/src/shaper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
SettingsManager.set('DOC_UNIT', 'mm');

const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const payload = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', FIX), 'utf8'));
const sliced = (tris, name = 'part.stl') => { const r = sliceStl(tris, { name }); assert.ok(r.ok, r.message); return r.payload; };
const ring = (pts) => [...pts.map((p) => [p.x, p.y]), [pts[0].x, pts[0].y]];
const distToPoly = (p, poly) => { let m = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], b = poly[i], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; let t = L ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L : 0; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy)); } return m; };
const box = (poly) => { const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(3)); };
// the written elements in file order; a grouped element (groupByCut) takes its <g>'s cut attributes
const elems = (svg) => { let g = ''; return svg.split('\n').flatMap((line) => { if (/^\s*<g[ >]/.test(line)) { g = line; return []; } if (/^\s*<\/g>/.test(line)) { g = ''; return []; } const m = /<(path|circle) ([^>]*?)\/>/.exec(line); return m ? [m[2] + ' ' + g] : []; })
  .map((a) => ({ type: (/shaper:cutType="([^"]+)"/.exec(a) || [])[1], depth: (/shaper:cutDepth="([^"]+)"/.exec(a) || [])[1], offset: (/shaper:cutOffset="([^"]+)"/.exec(a) || [])[1], dia: (/shaper:toolDia="([^"]+)"/.exec(a) || [])[1], attrs: a })); };

// a boss on a plate (60 x 40 x 10, the boss 20 x 20 standing 4 mm: z 6..10) and a Fusion-style payload that sends `levels` itself
const bossPlate = () => M.lofted({ outer: [{ z: 10, pts: M.rect(20, 10, 40, 30) }, { z: 6, pts: M.rect(20, 10, 40, 30) }, { z: 6, pts: M.rect(0, 0, 60, 40) }, { z: 0, pts: M.rect(0, 0, 60, 40) }] });
const sq = (x0, y0, x1, y1) => ({ closed: true, segments: [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]].map(([a, b, c, d]) => ({ type: 'line', x1: a, y1: b, x2: c, y2: d })) });
const twoSquaresPayload = () => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { name: 'Body1', documentName: 'relief' }, stock: { thicknessMm: 6 },
  regions: [{ id: 'reg_0', label: 'Outline', cutType: 'outside', depthMm: 6, through: true, outer: sq(0, 0, 80, 50), holes: [],
    levels: [
      { zFromTopMm: 1, loops: [sq(10, 10, 20, 20), sq(50, 10, 52, 40)] },   // two raised parts: a 10 x 10 square and a 2 mm wide rib (narrower than the bit)
      { zFromTopMm: 2, loops: [sq(10, 10, 20, 20), sq(50, 10, 52, 40)] },   // the same (merged into the deeper level)
      { zFromTopMm: 3, loops: [sq(0, 0, 80, 50), sq(30, 15, 40, 35)] },     // the plate with a pocket in it (a hole in the material)
      { zFromTopMm: 6, loops: [sq(0, 0, 80, 50)] },                         // the pocket's floor at 3..6: the plate
    ] }],
  chains: [], warnings: [],
});

// ── 1 + 2 + 3: pure ──
{
  // the payload's levels -> the record's (world: y negated for a Y-up payload), every loop a closed polygon
  const L = readLevels(twoSquaresPayload().regions[0].levels, { scale: 1, yUp: true });
  eq(L.map((l) => [l.z, l.loops.length]), [[1, 2], [2, 2], [3, 2], [6, 1]], 'readLevels: 4 levels, their loops');
  eq(L[0].loops[0], [10, -10, 20, -10, 20, -20, 10, -20], 'a loop = its polygon as flat x, y in WORLD mm (Y up -> y negated)');
  eq(readLevels([{ zFromTopMm: 1, loops: [{ segments: [{ type: 'line', x1: 0, y1: 0, x2: 5, y2: 0 }] }] }]), null, 'a loop that does not close: no levels (the importer warns)');
  eq(readLevels(null), null, 'no levels field: null');

  // ROUGHING from levels: the outline 0..80 x -50..0, the 1/4 in bit, allowance 0.5
  const outer = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: -50 }, { x: 0, y: -50 }];
  const R = levelsRoughing(L, { outer, step: 1, depth: 6, toolDia: 6.35, allowance: 0.5 });
  eq(R.steps.map((s) => s.depth), [2, 3, 6], 'step 1 to 6 mm: levels 1 and 2 are the same material (one level at 2), then 3, and 6 (4, 5 and 6 read the 6 mm section: one level at 6)');
  eq(R.steps.map((s) => [s.regions.length, s.islands, s.small]), [[1, 2, 1], [2, 1, 0], [1, 1, 0]], 'level 2: ONE pocket with the 2 raised parts as holes (the 2 mm rib narrower than the bit); level 3: the band round the plate (the plate its hole) + the pocket in it; level 6: the band');
  const W = offsetRegions(regionsFromRings([ring(outer)]), 0.5 + LEVELS.workMarginBits * 6.35);
  near(regionsArea(R.steps[2].regions), regionsArea(W) - 80 * 50 - (2 * 80 + 2 * 50) * 0.5 - Math.PI * 0.25, 0.5, 'the deepest level: the work area (outline + allowance + 2 bits) minus the plate grown by the allowance');
  // the allowance, measured: every vertex of an island hole is 0.5 mm from the material (the round corners too)
  const holes = R.steps[0].regions[0].holes.map((h) => h.slice(0, -1).map(([x, y]) => ({ x, y })));
  const mats = L[1].loops.map((f) => { const p = []; for (let i = 0; i < f.length; i += 2) p.push({ x: f[i], y: f[i + 1] }); return p; });
  for (const h of holes) {
    const m = mats.find((q) => box(q)[0] < box(h)[0] + 1 && box(q)[2] > box(h)[2] - 1);
    const d = h.map((p) => distToPoly(p, m));
    near(Math.min(...d), 0.5, 0.01, `an island hole: its nearest vertex 0.5 mm from the material`); near(Math.max(...d), 0.5, 0.01, 'and its farthest');
  }
  eq(levelsRoughing(L, { outer, step: 1, depth: 6, toolDia: 6.35, allowance: 0 }).steps[0].regions[0].holes.map((h) => box(h.slice(0, -1).map(([x, y]) => ({ x, y })))).sort((a, b) => a[0] - b[0]), [[10, -20, 20, -10], [50, -40, 52, -10]], 'allowance 0: the islands ARE the material loops');

  // CONTOUR from levels, step 0.5 to 6 mm: Outside cuts along the material's outer loops, an Inside cut along the pocket (a hole in the material)
  const C = levelsContour(L, { step: 0.5, depth: 6 });
  eq(C.steps.map((s) => [s.depth, s.loops.map((l) => (l.outer ? 'O' : 'I') + box(l.polygon).join(','))]), [
    [2, ['O10,-20,20,-10', 'O50,-40,52,-10']],
    [3, ['I30,-35,40,-15']],
    [6, ['O0,-50,80,0']],
  ], 'contour: the raised parts at 2 mm (their walls 0..2 cut once, at the bottom), the pocket wall at 3, the plate at 6 (the plate\'s level 3 loop is the same as at 6: cut there)');
}
{
  // STL sections: the boss on a plate (the slicer's sections every 0.25 mm) -> the outline record's levels
  const P = sliced(bossPlate(), 'boss.stl');
  const out = P.regions.find((r) => r.cutType === 'outside');
  ok(Array.isArray(out.levels) && out.levels.length >= 40, `the STL outline carries its sections as levels (${out.levels.length})`);
  const L = readLevels(out.levels, { scale: 1, yUp: true });
  const at = (z) => L.find((l) => Math.abs(l.z - z) < 1e-6);
  eq([at(2).loops.length, at(5).loops.length, at(8).loops.length], [1, 1, 1], 'the boss alone above 4 mm, the plate below');
  const R = levelsRoughing(L, { outer: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: -40 }, { x: 0, y: -40 }], step: 1, depth: 10, toolDia: 6.35, allowance: 0 });
  eq(R.steps.map((s) => [s.depth, s.islands]), [[4, 1], [10, 1]], 'the boss plate: ONE level at 4 mm round the boss (1..4 the same material), ONE at 10 round the plate (5..10 the same; the plate its island)');
  eq(box(R.steps[0].regions[0].holes[0].slice(0, -1).map(([x, y]) => ({ x, y }))), [20, -30, 40, -10], 'the boss is the island of the 4 mm pocket');
}

// ── 4 + 5: the app ──
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pc = doc.getElementById('prepare-canvas');
  const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const menu = () => { pressEl('.cut-type-trigger'); const ids = [...doc.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id + (o.disabled ? ':off' : '')); pressEl('.cut-type-trigger'); return ids; };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const rows = () => [...doc.querySelectorAll('.cut-rows .cut-row')].filter((r) => r.style.display !== 'none').map((r) => r.dataset.row || r.dataset.param);
  const setField = (sel, text) => { const inp = q(sel); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
  const contour = (on) => pressEl(`.cut-row[data-row="contour"] .cut-preset[data-value="${on}"]`);
  return { q, pressEl, clickAt, menu, pick, note, rows, setField, contour };
};
const recAt = (pred) => [...CUT_PLAN.entries()].find(([, r]) => pred(r));
const exportOf = (app) => shaperSvgOf(app.state, cutPlanEntries());
const TAN10 = Math.tan((10 * Math.PI) / 180);

{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const st = app.state, h = harness(app);

    // 4. MIGRATION: the drafted pocket saved as a Stepped pocket (step 2, offset 0.3) opens as Roughing, allowance 0, the same step
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare });
    const [pk] = recAt((r) => r.slope);
    const doc0 = captureShaperDoc();
    const stepped = { stepDepth: 2, adaptiveSteps: false, stepDeviation: 0.25, cutOffset: 0.3 };
    applyShaperDoc({ ...doc0, cutPlan: doc0.cutPlan.map(([k, r]) => [k, k === pk ? { ...r, cutType: 'stepped-pocket', ...stepped } : r]), opOrder: [JSON.stringify(['endmill|3.175|', 'stepped-pocket', { depth: 8, offset: 0.3, steps: { step: 2 } }])] }, st);
    const mig = CUT_PLAN.get(pk);
    eq([mig.cutType, mig.stepDepth, mig.cutOffset, mig.finishAllowance], ['roughing', 2, 0.3, undefined], 'a stored Stepped pocket opens as Roughing: its step and offset kept, no allowance (0)');
    eq(opOrder(), [JSON.stringify(['endmill|3.175|', 'roughing', { depth: 8, offset: 0.3, steps: { step: 2 } }])], 'a stored operation key with the stepped type is mapped to Roughing');
    eq(planOperations(st, cutPlanEntries()).map((o) => o.key)[0], opOrder()[0], 'the mapped key IS the Roughing operation\'s key (allowance 0 adds nothing to it)');
    // its export: the stepped engine's terraces (steppedTerraces on the same slope) as plain pockets, offset 0.3
    const T = steppedTerraces(mig.slope, { kind: 'pocket', step: 2, depth: 8 });
    const migSvg = exportOf(app);
    eq(elems(migSvg).map((e) => `${e.type}@${e.depth}/${e.offset}`), ['outside@19.000 mm/0mm', ...T.steps.map((s) => `pocket@${s.depth.toFixed(3)} mm/0.300 mm`)], 'the migrated Roughing exports the stepped terraces: plain pockets at 2, 4, 6, 8 mm, offset 0.3');
    // the allowance on a sloped Roughing = the offset: 0.5 more on every terrace, nothing else changes
    CUT_PLAN.get(pk).finishAllowance = 0.5;
    eq(elems(exportOf(app)).map((e) => e.offset), ['0mm', '0.800 mm', '0.800 mm', '0.800 mm', '0.800 mm'], 'allowance 0.5 on a sloped Roughing: every terrace offset 0.3 + 0.5');
    eq(exportOf(app).replace(/0\.800 mm/g, '0.300 mm'), migSvg, 'and nothing else of the file changes');
    CUT_PLAN.get(pk).finishAllowance = 0;
    eq(exportOf(app), migSvg, 'allowance 0 again: the stepped export');

    // 3. POCKET + CONTOUR on the drafted pocket (Pocket 1/4 in on the floor, Contour 1/8 in ball 0.25 mm): every contour pass on the wall at its depth
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare });
    const [pk2, prec] = recAt((r) => r.slope);
    h.clickAt(60, -40);
    eq(h.menu(), ['online', 'guide', 'interior', 'pocket', 'roughing', 'exterior', 'stock'], 'the menu: Roughing right after Pocket; never the Contour');
    eq(h.rows().includes('contour'), true, 'a sloped Pocket offers the Contour row');
    h.setField('.cut-bit', '6.35');
    h.contour(true);
    const ck = contourKeyOf(pk2), crec = CUT_PLAN.get(ck);
    eq([crec.cutType, crec.toolDia, crec.cutterShape, crec.stepDepth], ['contour', 3.175, 'ballnose', 0.25], 'Contour On: its own record, 1/8 in ball nose, 0.25 mm step (the owner\'s example: the defaults)');
    eq(prec.finishAllowance, undefined, 'a Pocket has no Roughing allowance to set');
    const cuts = deriveCuts(resolveEntry(ck, crec).target, effectiveCutRecord(resolveEntry(ck, crec).rec), st);
    eq(cuts.length, 32, 'the contour: 32 passes, every 0.25 mm down to the 8 mm floor');
    eq([...new Set(cuts.map((c) => c.rec.cutType))], ['interior'], 'each an Inside cut (the bit on the pocket side of the wall)');
    eq(cuts.map((c) => c.terrace.depth), Array.from({ length: 32 }, (_, i) => (i + 1) * 0.25), 'at 0.25, 0.5 ... 8 mm');
    for (const c of cuts) {
      const b = box(c.polygon), k = c.terrace.depth;
      near(b[0], 30 + k * TAN10, 0.002, `the pass at ${k} mm lies on the wall (the drafted ring at its depth)`);
    }
    ok(cuts.every((c) => c.terrace.depth <= 8), 'none below the floor');
    ok(!cuts.some((c) => sameOutline(c.polygon, CUT_PLAN.get(pk2) && deriveCuts({ kind: 'loop', id: pk2.slice(5) }, effectiveCutRecord(prec), st).find((x) => x.isCompound).outerPoly)), 'none is the Pocket\'s own outline (the floor cut\'s wall)');
    const ops = planOperations(st, cutPlanEntries());
    eq(ops.map((o) => [o.cutType, o.tool.label]), [['pocket', '¼″ end mill'], ['contour', '⅛″ ball nose'], ['exterior', '⅛″ end mill']], 'the Operations list: the Pocket, then its Contour (its own bit group), then the outline');
    eq(ops[1].rowText, 'Contour · 0.25–8 mm', 'the Contour row: its levels\' depths');
    eq(ops[1].detail, '32 levels', 'and how many levels');
    const svg = exportOf(app), E = elems(svg);
    eq(E.filter((e) => e.type === 'inside').length, 32, 'export: the 32 contour passes as Inside cuts');
    ok(E.filter((e) => e.type === 'inside').every((e) => e.dia === '3.175 mm'), 'with the Contour\'s bit');
    // Edit contour: the Contour's own card
    h.pressEl('.cut-contour-edit');
    eq([h.q('.cut-type-cur').textContent, h.rows()], ['Contour', ['stepDepth', 'toolDia', 'cutterShape']], 'Edit contour: the Contour card (its step, bit, cutter shape)');
    eq(h.menu(), ['contour'], 'its menu offers the Contour only');
    h.setField('.cut-step-depth', '1');
    eq([CUT_PLAN.get(ck).stepDepth, cutPlanEntries().filter((e) => e.key === ck).length], [1, 1], 'its step is its own (1 mm)');
    eq(deriveCuts(resolveEntry(ck, CUT_PLAN.get(ck)).target, effectiveCutRecord(resolveEntry(ck, CUT_PLAN.get(ck)).rec), st).length, 8, '8 passes at 1 mm');
    st.undo();
    eq(CUT_PLAN.get(ck).stepDepth, 0.25, 'undo: 0.25 again');
    st.undo(); // the Contour On
    eq(contourOf(pk2), null, 'undo: no Contour');
    st.redo();
    ok(contourOf(pk2), 'redo: the Contour');

    // ROUGHING + CONTOUR on the same pocket: the allowance follows the Contour (owner ruling)
    h.clickAt(60, -40);
    h.pick('roughing');
    eq([CUT_PLAN.get(pk2).cutType, CUT_PLAN.get(pk2).finishAllowance], ['roughing', 0.5], 'Roughing on a part that has a Contour: the declared finish allowance (0.5 mm)');
    eq(h.rows(), ['cutDepth', 'finishAllowance', 'contour', 'adaptiveSteps', 'stepDepth', 'cutOffset', 'toolDia', 'cutterShape'], 'the Roughing card: depth, allowance, Contour, adaptive, step, offset, bit, shape');
    h.contour(false);
    eq([contourOf(pk2), CUT_PLAN.get(pk2).finishAllowance], [null, 0], 'Contour Off: no Contour record, allowance 0');
    h.contour(true);
    eq([Boolean(contourOf(pk2)), CUT_PLAN.get(pk2).finishAllowance], [true, 0.5], 'Contour On: the allowance 0.5 again');
    eq(h.note()[0], 'Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.176 mm apart', 'a sloped Roughing keeps the stepped note');
    eq(h.note()[1], 'Roughing: 0.5 mm left on every wall for the Contour', 'and says the allowance');
    const ops2 = planOperations(st, cutPlanEntries());
    eq(ops2.map((o) => o.cutType), ['roughing', 'contour', 'exterior'], 'the Contour after the Roughing');
    eq(ops2[0].label, '¼″ end mill · Roughing · 1–8 mm (1 region) · 8 levels, allowance 0.5 mm', 'the Roughing operation');

    // a DRAWN pocket (no slope, no levels): ONE level; its Contour = its wall + its island
    const lk = recAt((r) => r.cutType === 'exterior')[0];
    CUT_PLAN.clear();
    CUT_PLAN.set(lk, { cutType: 'roughing', cutDepth: 5, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90, stepDepth: 1, finishAllowance: 0.5 });
    setContour(lk, true);
    const drawn = elems(exportOf(app));
    eq(drawn.map((e) => `${e.type}@${e.depth}/${e.offset}/${e.dia}`), ['pocket@5.000 mm/0.500 mm/6.350 mm', 'outside@5.000 mm/0mm/3.175 mm', 'inside@5.000 mm/0mm/3.175 mm'], 'the outline as a drawn region with its hole: Roughing = ONE pocket at its depth with the allowance as offset (the hole its island); Contour = the island (Outside) + the wall (Inside)');

    // 1 + 2 + 3 in the app: an STL part (the boss plate) and a payload with its own levels
    app.stl.openFile(M.binaryStl(bossPlate()), 'boss.stl');
    const [ok1, orec] = recAt((r) => r.levels);
    ok(orec && orec.cutType === 'exterior' && orec.levels.length >= 40, 'Open STL: the outline record carries the levels');
    const before = exportOf(app);
    { const lv = orec.levels; delete orec.levels; eq(exportOf(app), before, 'an Outside cut exports the same with or without levels'); orec.levels = lv; }
    orec.cutType = 'roughing'; orec.stepDepth = 1; orec.toolDia = 6.35;
    const rough = elems(exportOf(app)).filter((e) => e.type === 'pocket' && e.dia === '6.350 mm'); // (the STL's own shoulder pocket round the boss is another record)
    eq(rough.map((e) => e.depth), ['4.000 mm', '10.000 mm'], 'Roughing the boss plate: two level pockets (4 and 10 mm)');
    ok(/M [^M]+Z M [^M]+Z/.test(rough[0].attrs), 'the 4 mm pocket is ONE element with the boss as its hole');
    const items = planReliefItems(st);
    const relief = buildRelief({ stock: { thickness: 10 }, items });
    eq(relief.levels.map((l) => l.depth), [4, 10], 'the 3D Review: terraces at 4 and 10 mm');
    ok(relief.stats.triangles > 0 && items.every((i) => i.footprints[0].rings.length > 0), 'every level has a footprint (drawn with Clipper offsets)');
    setContour(ok1, true);
    eq(CUT_PLAN.get(ok1).finishAllowance, 0.5, 'the Contour sets the allowance');
    const cont = elems(exportOf(app)).filter((e) => e.type === 'outside' && e.dia === '3.175 mm');
    eq(cont.map((e) => e.depth), ['4.000 mm', '10.000 mm'], 'its Contour: the boss wall (4 mm) and the plate wall (10 mm): Outside cuts');

    importFusionSelection(twoSquaresPayload(), { controller: app.controller, prepare: app.prepare });
    const [tk, trec] = recAt((r) => r.levels);
    eq(trec.levels.length, 4, 'a Fusion payload with `levels`: kept on the outline record');
    trec.cutType = 'roughing'; trec.stepDepth = 1; trec.toolDia = 6.35; trec.finishAllowance = 0.5;
    h.clickAt(5, -45);
    eq(h.note(), ['Roughing: 3 levels, 2 to 6 mm', 'Roughing: 0.5 mm left on every wall for the Contour', 'Roughing: up to 2 islands left standing (1 narrower than the 6.35 mm bit)'], 'the Roughing card note: its levels, the allowance, the islands');
    eq(elems(exportOf(app)).map((e) => `${e.type}@${e.depth}`), ['pocket@2.000 mm', 'pocket@3.000 mm', 'pocket@3.000 mm', 'pocket@6.000 mm'], 'its export: level 2 (one pocket, 2 islands), level 3 (the band + the pocket in the plate), level 6 (the band)');

    // save + reload: the Roughing, its levels and its Contour
    setContour(tk, true);
    const saved = captureShaperDoc();
    const svgBefore = exportOf(app);
    applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
    eq([CUT_PLAN.get(tk).cutType, CUT_PLAN.get(tk).levels.length, Boolean(contourOf(tk))], ['roughing', 4, true], 'reloaded: Roughing, its levels, its Contour');
    eq(exportOf(app), svgBefore, 'reloaded: the same export');
    eq(availableTypes('contour').map((t) => t.id), ['contour'], 'a Contour target takes the Contour only');
    setOpOrder([]);
  } finally { await app.close(); }
}

console.log(`roughing-contour-792-node: ok (${checks} checks)`);
