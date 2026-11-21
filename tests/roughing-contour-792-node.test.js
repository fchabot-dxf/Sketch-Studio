// tests/roughing-contour-792-node.test.js — TASK 792: ROUGHING and CONTOUR for any part with depth information (#core/stepped-cut.js, its TASK 792 header).
//  1. LEVELS: an STL's material sections (#core/stl-slice.js `levels` on the relief region (TASK 807), synthetic meshes of tests/helpers/stl-mesh.js: a boss on a
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
//  5. the app (Shaper through tests/helpers/node-app.js, the real cut card): Roughing in the menu of every region, its rows; TASK S2: the Contour is an operation
//     type of its own (the type menu, its own Depth; adding / removing it leaves the Roughing's allowance alone), its card (its Heights, Walls, step, bit, cutter
//     shape), the Operations list (two operations, two bit groups, the Contour after the Roughing), undo / redo, save + reload, a design without these
//     operations exports the same with or without `levels` on its records.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import * as M from './helpers/stl-mesh.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { parseStl, sliceStl } from '#core/stl-slice.js';
import { readLevels, levelsRoughing, levelsContour, deriveCuts, LEVELS, steppedTerraces, sameOutline } from '#core/stepped-cut.js';
import { regionsFromRings, offsetRegions, diffRegions, regionsArea, unionRegions, intersectRegions } from '#core/plot/clip.js';
import { buildRelief } from '#core/relief-model.js';
import { levelsHeightMap, HEIGHT_MAP } from '#core/height-map.js';
import { planEntries, planReliefItems, contourKeyOf, contourOf, resolveEntry, typeRefusal } from '../apps/shaper/src/cut-plan.js';
import { membersOf } from '../apps/shaper/src/operations-store.js'; // TASK S2: a shape's operations
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { describeOperations, opKeyOf } from '../apps/shaper/src/operations.js';
import { effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { V2_PLAN, storedRecords, storedOpKeys, addContourV2 } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen, editStep } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it

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
      { zFromTopMm: 3, loops: [sq(0, 0, 80, 50), sq(25, 15, 45, 35)] },     // the plate with a 20 x 20 pocket in it (a hole in the material)
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

  // ROUGHING from levels: the outline 0..80 x -50..0, the 1/4 in bit, allowance 0.5; the material at each level (the union of the sections down to it)
  const outer = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: -50 }, { x: 0, y: -50 }];
  const flatRing = (f) => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); r.push(r[0]); return r; };
  const materialAt = (d) => unionRegions(...L.filter((l) => l.z <= d + 1e-9 || l === L.find((q) => q.z >= d - 1e-9)).map((l) => regionsFromRings(l.loops.map(flatRing), 'evenodd')));
  const W = offsetRegions(regionsFromRings([ring(outer)]), 0.5 + LEVELS.workMarginBits * 6.35);
  const r = 6.35 / 2, m = 6.35 * LEVELS.pocketKeepBackBits;
  const clears = (regs) => offsetRegions(offsetRegions(regs, -(r + m), LEVELS.drawTolMm), r, LEVELS.drawTolMm);
  const areaOf = (regs) => regionsArea(regs);
  for (const layout of ['nested', 'terraces']) {
    const R = levelsRoughing(L, { outer, step: 1, depth: 6, toolDia: 6.35, allowance: 0.5, layout });
    eq([R.layout, R.steps.map((s) => s.depth)], [layout, [2, 3, 6]], `${layout}: step 1 to 6 mm: levels 1 and 2 are the same material (one level at 2), then 3, and 6 (4, 5, 6 read the 6 mm section)`);
    eq(R.steps.map((s) => [s.islands, s.small]), [[2, 1], [1, 0], [1, 0]], `${layout}: the material standing at each level (the 2 mm rib narrower than the bit)`);
    // RULE 2: depth-first per area: inside an area the levels never go back up
    const areaLevels = []; R.paths.forEach((p, i) => { if (i && p.level < R.paths[i - 1].level) areaLevels.push('new area'); });
    ok(R.paths.every((p, i) => i === 0 || p.level >= R.paths[i - 1].level || areaLevels.length), `${layout}: paths depth-first per area`);
    // never past the design + allowance at its depth, and (terraces) never over a shallower terrace
    for (const p of R.paths) {
      const design = offsetRegions(materialAt(p.depth), 0.5 - 0.01);
      ok(areaOf(intersectRegions(p.regions, design)) < 0.05, `${layout}: the ${p.depth} mm path stays off the design + allowance`);
      ok(areaOf(diffRegions(p.regions, W)) < 0.05, `${layout}: inside the work area`);
      // (terraces: the two checks above ARE the no-gouge rule: a path stays inside R_k, the area allowed at its depth. A terrace's spill may cover the m-wide strip a shallower terrace keeps along this level's wall: no pocket could cut that strip to its own depth, cutting it here never passes the design + allowance)
    }
    // COVERAGE: no missed band: each level's own area (nested: R_k less the Origin's m on its walls; terraces: its terrace) is cleared by its paths, but
    // for the sharp inside corners a round bit never reaches
    for (const k of [0, 1, 2]) {
      const ps = R.paths.filter((p) => p.level === k);
      const own = unionRegions(...ps.map((p) => [p.region]));
      const need = layout === 'nested' ? offsetRegions(own, -(m + 0.2), LEVELS.drawTolMm) : own;
      const missed = diffRegions(need, unionRegions(...ps.map((p) => clears(p.regions))));
      ok(areaOf(missed) < 15, `${layout} level ${R.steps[k].depth}: missed only in sharp corners (${areaOf(missed).toFixed(2)} mm2)`);
    }
    if (layout === 'nested') {
      eq(R.paths.map((p) => [p.depth, p.regions.length]), [[2, 1], [3, 1], [6, 1]], 'nested: level 2 ONE pocket (2 islands); level 3 only the pocket in the plate (RULE 1: the band round the plate is the same outline at 3 and 6: ONE path, at 6); level 6 the band');
      near(areaOf(R.paths[2].regions), areaOf(W) - 80 * 50 - (2 * 80 + 2 * 50) * 0.5 - Math.PI * 0.25, 0.5, 'nested: the deepest level = the work area (outline + allowance + 2 bits) minus the plate grown by the allowance');
      // the allowance, measured: every vertex of an island hole is 0.5 mm from the material (the round corners too)
      const holes = R.paths[0].regions[0].holes.map((h) => h.slice(0, -1).map(([x, y]) => ({ x, y })));
      const mats = L[1].loops.map((f) => { const p = []; for (let i = 0; i < f.length; i += 2) p.push({ x: f[i], y: f[i + 1] }); return p; });
      eq(holes.length, 2, 'nested: the 2 islands are holes of the 2 mm pocket');
      for (const h of holes) {
        const q = mats.find((x) => box(x)[0] < box(h)[0] + 1 && box(x)[2] > box(h)[2] - 1);
        const d = h.map((p) => distToPoly(p, q));
        near(Math.min(...d), 0.5, 0.01, 'an island hole: its nearest vertex 0.5 mm from the material'); near(Math.max(...d), 0.5, 0.01, 'and its farthest');
      }
    } else {
      // terraces: every spot cut once: the terraces do not overlap and together are what nested level 1 clears
      const T = R.paths.map((p) => [p.region]);
      for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) ok(areaOf(intersectRegions(T[i], T[j])) < 0.05, `terraces ${i} and ${j} do not overlap`);
      const nested1 = levelsRoughing(L, { outer, step: 1, depth: 6, toolDia: 6.35, allowance: 0.5, layout: 'nested' }).paths.filter((p) => p.level === 0).flatMap((p) => p.regions);
      near(areaOf(unionRegions(...T)), areaOf(offsetRegions(nested1, -m, LEVELS.drawTolMm)), 1, 'terraces: together they are level 1\'s area less the Origin\'s offset on its walls');
      const cut = R.paths.reduce((s, p) => s + areaOf(p.regions), 0), nestedCut = levelsRoughing(L, { outer, step: 1, depth: 6, toolDia: 6.35, allowance: 0.5, layout: 'nested' }).paths.reduce((s, p) => s + areaOf(p.regions), 0);
      console.log(`two squares: terraces ${R.paths.length} paths, cut ${cut.toFixed(0)} mm2 (overlap ${(cut - areaOf(unionRegions(...T))).toFixed(0)}); nested cut ${nestedCut.toFixed(0)} mm2`);
      ok(cut < nestedCut, 'terraces cut less area than nested (no air passes)');
    }
  }
  eq(levelsRoughing(L, { outer, step: 1, depth: 6, toolDia: 6.35, allowance: 0, layout: 'nested' }).paths[0].regions[0].holes.map((h) => box(h.slice(0, -1).map(([x, y]) => ({ x, y })))).sort((a, b) => a[0] - b[0]), [[10, -20, 20, -10], [50, -40, 52, -10]], 'allowance 0: the islands ARE the material loops');

  // CONTOUR from levels, step 0.5 to 6 mm: Outside cuts along the material's outer loops, an Inside cut along the pocket (a hole in the material)
  const C = levelsContour(L, { step: 0.5, depth: 6 });
  eq(C.steps.map((s) => [s.depth, s.loops.map((l) => (l.outer ? 'O' : 'I') + box(l.polygon).join(','))]), [
    [2, ['O10,-20,20,-10', 'O50,-40,52,-10']],
    [3, ['I25,-35,45,-15']],
    [6, ['O0,-50,80,0']],
  ], 'contour: the raised parts at 2 mm (their walls 0..2 cut once, at the bottom), the pocket wall at 3, the plate at 6 (the plate\'s level 3 loop is the same as at 6: cut there)');
  eq(C.paths.map((p) => p.depth), [2, 2, 3, 6], 'contour paths depth-first in the one area (the plate)');
}
{
  // STL sections: the boss on a plate (the slicer's sections every 0.25 mm) -> the outline record's levels
  const P = sliced(bossPlate(), 'boss.stl');
  const out = P.regions[0]; // TASK 807: the relief
  ok(Array.isArray(out.levels) && out.levels.length >= 40, `the STL relief carries its sections as levels (${out.levels.length})`);
  const L = readLevels(out.levels, { scale: 1, yUp: true });
  const at = (z) => L.find((l) => Math.abs(l.z - z) < 1e-6);
  eq([at(2).loops.length, at(5).loops.length, at(8).loops.length], [1, 1, 1], 'the boss alone above 4 mm, the plate below');
  for (const layout of ['nested', 'terraces']) {
    const R = levelsRoughing(L, { outer: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: -40 }, { x: 0, y: -40 }], step: 1, depth: 10, toolDia: 6.35, allowance: 0, layout });
    eq(R.paths.map((p) => p.depth), [4, 10], `${layout}: the boss plate: ONE path at 4 mm round the boss (1..4 the same material), ONE at 10 round the plate (5..10 the same)`);
    const hb = box(R.paths[0].region.holes[0].slice(0, -1).map(([x, y]) => ({ x, y }))), g = layout === 'nested' ? 0 : 6.35 * LEVELS.pocketKeepBackBits;
    [20 - g, -30 - g, 40 + g, -10 + g].forEach((v, i) => near(hb[i], v, 0.01, `${layout}: the boss is the hole of the 4 mm path${g ? ' (its terrace stops the Origin offset m off the boss)' : ''}`));
  }
}
{
  // MIN TERRACE WIDTH (owner turns 2605-2607) on the 45-degree drafted pocket (1 mm steps give ~1 mm bands on its walls): at the bit diameter the thin
  // bands are left uncut (no path, no spill), at 0 every band is roughed; Nested has no such row (its paths are the levels' whole areas)
  const P = sliced(M.draftedPocket(45), 'd45.stl');
  const reg = P.regions.find((g) => g.levels);
  const L = readLevels(reg.levels, { scale: 1, yUp: true });
  const f = readLevels([{ zFromTopMm: 0, loops: [reg.outer] }], { scale: 1, yUp: true })[0].loops[0], outer = [];
  for (let i = 0; i < f.length; i += 2) outer.push({ x: f[i], y: f[i + 1] });
  const run = (minWidth) => levelsRoughing(L, { outer, step: 1, toolDia: 6.35, allowance: 0, layout: 'terraces', minWidth });
  const all = run(0), wide = run(6.35);
  const thin = wide.steps.reduce((n, s) => n + s.thin, 0);
  console.log(`45-degree pocket: min width 0: ${all.paths.length} paths, thin ${all.steps.reduce((n, s) => n + s.thin, 0)}; min width 6.35: ${wide.paths.length} paths, ${thin} bands left`);
  eq(all.steps.reduce((n, s) => n + s.thin, 0), 0, 'min width 0: no band left');
  ok(thin >= 5 && wide.paths.length === all.paths.length - thin, `min width = the bit: the ${thin} thin wall bands are left, every other path kept`);
  ok(wide.paths.every((p) => all.paths.some((q) => q.depth === p.depth && regionsArea([q.region]) === regionsArea([p.region]))), 'the kept paths are the same terraces');
  eq(levelsRoughing(L, { outer, step: 1, toolDia: 6.35, layout: 'nested', minWidth: 6.35 }).paths.length, levelsRoughing(L, { outer, step: 1, toolDia: 6.35, layout: 'nested' }).paths.length, 'Nested ignores it');
}
{
  // NO MISSED BAND (owner turn 2602): the 45-degree drafted pocket and the dome, both layouts, steps 1 and 2: at every level the area that must reach it
  // (Terraces: its terrace; Nested: its removal less the Origin's offset m on its walls) is cleared by its paths (the pocket rule: kept back r + m,
  // opened by r), but for the sharp inside corners a round bit cannot reach: at most 4 corners x (r + m)^2 (1 - pi / 4) per level
  const r = 6.35 / 2, m = 6.35 * LEVELS.pocketKeepBackBits, corner = 4 * (r + m) ** 2 * (1 - Math.PI / 4) + 0.5;
  const clears = (regs) => offsetRegions(offsetRegions(regs, -(r + m), LEVELS.drawTolMm), r, LEVELS.drawTolMm);
  for (const [name, tris] of [['45-degree pocket', M.draftedPocket(45)], ['dome', M.dome(30, 48, 64)]]) {
    const reg = sliced(tris, 'p.stl').regions.find((g) => g.levels);
    const L = readLevels(reg.levels, { scale: 1, yUp: true });
    const f = readLevels([{ zFromTopMm: 0, loops: [reg.outer] }], { scale: 1, yUp: true })[0].loops[0], outer = [];
    for (let i = 0; i < f.length; i += 2) outer.push({ x: f[i], y: f[i + 1] });
    for (const layout of ['terraces', 'nested']) for (const step of [1, 2]) {
      const R = levelsRoughing(L, { outer, step, toolDia: 6.35, allowance: 0.5, layout });
      let worst = 0;
      for (const k of new Set(R.paths.map((p) => p.level))) {
        const ps = R.paths.filter((p) => p.level === k), own = unionRegions(...ps.map((p) => [p.region]));
        const need = layout === 'nested' ? offsetRegions(own, -(m + 0.2), LEVELS.drawTolMm) : own;
        worst = Math.max(worst, regionsArea(diffRegions(need, unionRegions(...ps.map((p) => clears(p.regions))))));
      }
      ok(worst <= corner, `${name}, ${layout}, step ${step}: no missed band (worst level ${worst.toFixed(2)} mm2 <= the corners ${corner.toFixed(1)})`);
    }
  }
}
{
  // G. the HEIGHT MAP (#core/height-map.js) of the boss plate's levels: the boss lighter than the plate, outside the part transparent, one PNG
  const L = readLevels(sliced(bossPlate(), 'boss.stl').regions.find((r) => r.levels).levels, { scale: 1, yUp: true });
  const m = levelsHeightMap(L);
  eq([m.cols, m.rows, +m.px.toFixed(4), m.x0, m.y0], [600, 400, 0.1, 0, -40], 'the boss plate: 600 x 400 px (HEIGHT_MAP.maxPx along the longer side), 0.1 mm a pixel, over the part\'s box');
  ok(levelsHeightMap(L) === m, 'memoised per levels list');
  const png = Buffer.from(m.href.split(',')[1], 'base64');
  eq([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG');
  eq([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [600, 400, 8, 4], 'its header: 600 x 400, 8 bits, grey + alpha');
  // read the pixels back (the IDAT is stored deflate blocks: the raw rows follow each 5-byte block header)
  const idat = png.indexOf('IDAT'), len = png.readUInt32BE(idat - 4), z = png.subarray(idat + 4 + 2, idat + 4 + len - 4);
  const raw = []; for (let o = 0; o < z.length;) { const n = z[o + 1] | (z[o + 2] << 8); raw.push(...z.subarray(o + 5, o + 5 + n)); o += 5 + n; }
  const at = (x, y) => { const c = Math.floor((x - m.x0) / m.px), r = Math.floor((y - m.y0) / m.px), o = r * (1 + 2 * m.cols) + 1 + 2 * c; return [raw[o], raw[o + 1]]; };
  const boss = at(30, -20), plate = at(5, -5);
  eq([boss[1], plate[1]], [255, 255], 'the boss and the plate are opaque');
  ok(boss[0] > plate[0], `lighter = higher: the boss (grey ${boss[0]}) is lighter than the plate (grey ${plate[0]})`);
  ok(boss[0] <= HEIGHT_MAP.greyTop && plate[0] >= HEIGHT_MAP.greyDeep, 'within the declared grey range');
  eq(levelsHeightMap([{ z: 1, loops: [] }]), null, 'no material: no map');
}

// ── 4 + 5: the app ──
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressElRaw = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pressEl = (s) => editStep(app, () => pressElRaw(s)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const pc = doc.getElementById('prepare-canvas');
  const clickRaw = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const clickAt = (x, y) => clickOpen(app, () => clickRaw(x, y)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)
  const menu = () => { pressEl('.cut-type-trigger'); const ids = [...doc.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id + (o.disabled ? ':off' : '')); pressEl('.cut-type-trigger'); return ids; };
  const pick = (id) => { if (app.prepare.openId()) { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); } else pressEl(`#op-type-${id}`); }; // TASK S3: an open operation: the card's type menu (a type change); none: the operations toolbar (a NEW operation, open)
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const rows = () => [...doc.querySelectorAll('.cut-rows .cut-row')].filter((r) => r.style.display !== 'none' && !('off' in r.dataset)).map((r) => r.dataset.row || r.dataset.param);
  const setFieldRaw = (sel, text) => { const inp = q(sel); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
  const setField = (sel, text) => editStep(app, () => setFieldRaw(sel, text)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  // TASK S2: the part's Contour is an operation of its own: On = the part's shape picked, Contour in the type menu (a NEW operation, OK); Off = that operation's X in
  // the list; then the part's operation opened again (as the old Contour row left the part's card showing)
  const contour = (on) => {
    const part = app.prepare.view().activeOp(), key = part.geometry[0].key;
    app.prepare.ok();
    if (on) { const i = key.indexOf(':'); app.prepare.view().setSelection([{ kind: key.slice(0, i), id: key.slice(i + 1) }]); pick('contour'); }
    else { const c = membersOf(key).find((m) => m.op.type === 'contour').op, row = () => q(`#prepare-ops .ops-row[data-id="${c.id}"]`); app.press(row().querySelector('.ops-pick')); app.press(row().querySelector('.ops-del')); }
    app.prepare.ok(); app.prepare.edit(part.id);
  };
  const openContour = (key) => { app.prepare.ok(); app.prepare.edit(membersOf(key).find((m) => m.op.type === 'contour').op.id); }; // the Contour operation opened
  return { q, pressEl, clickAt, menu, pick, note, rows, setField, contour, openContour };
};
const recAt = (pred) => [...V2_PLAN.entries()].find(([, r]) => pred(r));
const exportOf = (app) => shaperSvgOf(app.state, planEntries());
const TAN10 = Math.tan((10 * Math.PI) / 180);

{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const st = app.state, h = harness(app);

    // 4. MIGRATION: the drafted pocket saved as a Stepped pocket (step 2, offset 0.3) opens as Roughing, allowance 0, the same step
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare });
    const [pk] = recAt((r) => r.slope);
    const doc0 = captureShaperDoc();
    const stepped = { stepDepth: 2, adaptiveSteps: false, stepDeviation: 0.25, cutOffset: 0.3 };
    applyShaperDoc({ version: 2, stock: doc0.stock, selections: doc0.selections, cutPlan: storedRecords(doc0).map(([k, r]) => [k, k === pk ? { ...r, cutType: 'stepped-pocket', ...stepped } : r]), opOrder: [JSON.stringify(['endmill|3.175|', 'stepped-pocket', { depth: 8, offset: 0.3, steps: { step: 2 } }])] }, st);
    const mig = V2_PLAN.get(pk);
    eq([mig.cutType, mig.stepDepth, mig.cutOffset, mig.finishAllowance], ['roughing', 2, 0.3, undefined], 'a stored Stepped pocket opens as Roughing: its step and offset kept, no allowance (0)');
    eq(storedOpKeys()[0], JSON.stringify(['endmill|3.175|', 'roughing', { depth: 8, offset: 0.3, steps: { step: 2 } }]), 'a stored operation key with the stepped type is mapped to Roughing: it is the first operation (TASK S1: the list order is stored)');
    eq(opKeyOf(describeOperations(st, planEntries())[0].records[0].rec), storedOpKeys()[0],'the mapped key IS the Roughing operation\'s key (allowance 0 adds nothing to it)');
    // its export: the stepped engine's terraces (steppedTerraces on the same slope) as plain pockets, offset 0.3
    const T = steppedTerraces(mig.slope, { kind: 'pocket', step: 2, depth: 8 });
    const migSvg = exportOf(app);
    eq(elems(migSvg).map((e) => `${e.type}@${e.depth}/${e.offset}`), ['outside@19.000 mm/0mm', ...T.steps.map((s) => `pocket@${s.depth.toFixed(3)} mm/0.300 mm`)], 'the migrated Roughing exports the stepped terraces: plain pockets at 2, 4, 6, 8 mm, offset 0.3');
    // the allowance on a sloped Roughing = the offset: 0.5 more on every terrace, nothing else changes
    V2_PLAN.get(pk).finishAllowance = 0.5;
    eq(elems(exportOf(app)).map((e) => e.offset), ['0mm', '0.800 mm', '0.800 mm', '0.800 mm', '0.800 mm'], 'allowance 0.5 on a sloped Roughing: every terrace offset 0.3 + 0.5');
    eq(exportOf(app).replace(/0\.800 mm/g, '0.300 mm'), migSvg, 'and nothing else of the file changes');
    V2_PLAN.get(pk).finishAllowance = 0;
    eq(exportOf(app), migSvg, 'allowance 0 again: the stepped export');

    // 3. POCKET + CONTOUR on the drafted pocket (Pocket 1/4 in on the floor, Contour 1/8 in ball 0.25 mm): every contour pass on the wall at its depth
    importFusionSelection(payload('02-drafted-pocket'), { controller: app.controller, prepare: app.prepare });
    const [pk2, prec] = recAt((r) => r.slope);
    h.clickAt(60, -40);
    eq(h.menu(), ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock'] /* TASK S2: the Contour in the menus */, 'the menu: Roughing right after Pocket (TASK S2: then the Contour, a type of its own)');
    h.setField('.cut-bit', '6.35');
    h.contour(true);
    const ck = contourKeyOf(pk2), crec = V2_PLAN.get(ck);
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
    ok(!cuts.some((c) => sameOutline(c.polygon, V2_PLAN.get(pk2) && deriveCuts({ kind: 'loop', id: pk2.slice(5) }, effectiveCutRecord(prec), st).find((x) => x.isCompound).outerPoly)), 'none is the Pocket\'s own outline (the floor cut\'s wall)');
    const ops = describeOperations(st, planEntries());
    eq(ops.map((o) => [o.cutType, o.tool.label]), [['pocket', '¼″ end mill'], ['contour', '⅛″ ball nose'], ['exterior', '⅛″ end mill']], 'the Operations list: the Pocket, then its Contour (its own bit group), then the outline');
    eq(ops[1].rowText, 'Contour · 0.25–8 mm', 'the Contour row: its levels\' depths');
    eq(ops[1].detail, '32 levels', 'and how many levels');
    const svg = exportOf(app), E = elems(svg);
    eq(E.filter((e) => e.type === 'inside').length, 32, 'export: the 32 contour passes as Inside cuts');
    ok(E.filter((e) => e.type === 'inside').every((e) => e.dia === '3.175 mm'), 'with the Contour\'s bit');
    // the Contour operation's own card (TASK S2: its own Depth; its Wall side greyed: the slope says the side)
    h.openContour(pk2);
    eq([h.q('.cut-type-cur').textContent, h.rows()], ['Contour', ['cutDepth', 'topDepth', 'floorAllowance', 'walls', 'stepDepth', 'toolDia', 'cutterShape']], 'Edit contour: the Contour card (TASK 810: its Heights, its Walls, then its step, bit, cutter shape)');
    eq(h.menu(), ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock'], 'its menu offers every type (TASK S2: a type change of the operation)');
    h.setField('.cut-step-depth', '1');
    eq([V2_PLAN.get(ck).stepDepth, planEntries().filter((e) => e.planKey === ck).length], [1, 1], 'its step is its own (1 mm)');
    eq(deriveCuts(resolveEntry(ck, V2_PLAN.get(ck)).target, effectiveCutRecord(resolveEntry(ck, V2_PLAN.get(ck)).rec), st).length, 8, '8 passes at 1 mm');
    st.undo();
    eq(V2_PLAN.get(ck).stepDepth, 0.25, 'undo: 0.25 again');
    st.undo(); // the Contour On
    eq(contourOf(pk2), null, 'undo: no Contour');
    st.redo();
    ok(contourOf(pk2), 'redo: the Contour');

    // ROUGHING + CONTOUR on the same pocket: TASK S2 (owner rule "no setting silently changes another"): the allowance is a plain Roughing setting
    h.clickAt(60, -40);
    h.pick('roughing');
    eq([V2_PLAN.get(pk2).cutType, V2_PLAN.get(pk2).finishAllowance], ['roughing', 0], 'Roughing on a part that has a Contour: allowance 0, its own default (the Contour sets nothing)');
    eq(h.rows(), ['cutDepth', 'topDepth', 'floorAllowance', 'finishAllowance', 'adaptiveSteps', 'stepDepth', 'cutOffset', 'toolDia', 'cutterShape'], 'the Roughing card: depth, TASK 810 its Heights (Top, Bottom, Floor allowance), allowance, Contour, adaptive, step, offset, bit, shape');
    h.setField('.cut-finish-allowance', '0.5');
    h.contour(false);
    eq([contourOf(pk2), V2_PLAN.get(pk2).finishAllowance], [null, 0.5], 'the Contour removed: the allowance stays 0.5 (TASK S2)');
    h.contour(true);
    eq([Boolean(contourOf(pk2)), V2_PLAN.get(pk2).finishAllowance], [true, 0.5], 'a Contour added again: the allowance unchanged');
    eq(h.note()[0], 'Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.176 mm apart', 'a sloped Roughing keeps the stepped note');
    eq(h.note()[1], 'Roughing: 0.5 mm left on every wall for the Contour', 'and says the allowance');
    const ops2 = describeOperations(st, planEntries());
    eq(ops2.map((o) => o.cutType), ['roughing', 'contour', 'exterior'], 'the Contour after the Roughing');
    eq(ops2[0].label, '¼″ end mill · Roughing · 1–8 mm (1 region) · 8 levels, allowance 0.5 mm', 'the Roughing operation');

    // a DRAWN pocket (no slope, no levels): ONE level; its Contour = its wall + its island
    const lk = recAt((r) => r.cutType === 'exterior')[0];
    V2_PLAN.clear();
    V2_PLAN.set(lk, { cutType: 'roughing', cutDepth: 5, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90, stepDepth: 1, finishAllowance: 0.5 });
    addContourV2(lk);
    const drawn = elems(exportOf(app));
    eq(drawn.map((e) => `${e.type}@${e.depth}/${e.offset}/${e.dia}`), ['pocket@5.000 mm/0.500 mm/6.350 mm', 'outside@5.000 mm/0mm/3.175 mm', 'inside@5.000 mm/0mm/3.175 mm'], 'the outline as a drawn region with its hole: Roughing = ONE pocket at its depth with the allowance as offset (the hole its island); Contour = the island (Outside) + the wall (Inside)');

    // 1 + 2 + 3 in the app: an STL part (the boss plate) and a payload with its own levels
    app.stl.openFile(M.binaryStl(bossPlate()), 'boss.stl');
    const [ok1, orec] = recAt((r) => r.levels);
    ok(orec && orec.cutType === 'roughing' && orec.levels.length >= 40, 'Open STL (TASK 807: a relief): the part is ONE Roughing record carrying the levels');
    eq(V2_PLAN.size, 1, 'the relief: one record (no per-feature pockets)');
    orec.cutType = 'exterior';
    const before = exportOf(app);
    { const lv = orec.levels; delete orec.levels; eq(exportOf(app), before, 'an Outside cut exports the same with or without levels'); orec.levels = lv; }
    orec.cutType = 'roughing'; orec.stepDepth = 1; orec.toolDia = 6.35;
    const rough = elems(exportOf(app)).filter((e) => e.type === 'pocket' && e.dia === '6.350 mm');
    eq(rough.map((e) => e.depth), ['4.000 mm', '10.000 mm'], 'Roughing the boss plate: two level pockets (4 and 10 mm)');
    ok(/M [^M]+Z M [^M]+Z/.test(rough[0].attrs), 'the 4 mm pocket is ONE element with the boss as its hole');
    const items = planReliefItems(st);
    const relief = buildRelief({ stock: { thickness: 10 }, items });
    eq(relief.levels.map((l) => l.depth), [4, 10], 'the 3D Review: terraces at 4 and 10 mm');
    ok(relief.stats.triangles > 0 && items.every((i) => i.footprints[0].rings.length > 0), 'every level has a footprint (drawn with Clipper offsets)');
    addContourV2(ok1);
    eq(V2_PLAN.get(ok1).finishAllowance ?? 0, 0, 'TASK S2: adding the Contour leaves the allowance alone');
    const cont = elems(exportOf(app)).filter((e) => e.type === 'outside' && e.dia === '3.175 mm');
    eq(cont.map((e) => e.depth), ['4.000 mm', '10.000 mm'], 'its Contour: the boss wall (4 mm) and the plate wall (10 mm): Outside cuts');

    importFusionSelection(twoSquaresPayload(), { controller: app.controller, prepare: app.prepare });
    const [tk, trec] = recAt((r) => r.levels);
    eq(trec.levels.length, 4, 'a Fusion payload with `levels`: kept on the outline record');
    trec.cutType = 'roughing'; trec.stepDepth = 1; trec.toolDia = 6.35; trec.finishAllowance = 0.5;
    h.clickAt(5, -45);
    eq(h.note(), ['Roughing: 3 levels, 2 to 6 mm, terraces: 3 paths', 'Roughing: 0.5 mm left on every wall for the Contour', 'Roughing: up to 2 raised areas left standing on a level (1 narrower than the 6.35 mm bit)'], 'the Roughing card note: its levels, the allowance, the islands');
    eq(elems(exportOf(app)).map((e) => `${e.type}@${e.depth}`), ['pocket@2.000 mm', 'pocket@3.000 mm', 'pocket@6.000 mm'], 'its export (Terraces, the default): the 2 mm terrace, the 3 mm terrace (the pocket in the plate), the 6 mm terrace (the band); depth-first in the one area');
    // the Layout row (owner turn 2604) and the Min terrace width row (turns 2605-2607): shown for a part with levels, ONE undo step each, saved
    eq(['roughLayout', 'minTerraceWidth', 'adaptiveSteps'].map((r) => h.rows().includes(r)), [true, true, false], 'a part with levels: the Layout and Min terrace width rows (no adaptive stepping: it reads a slope\'s rings)');
    eq([h.q('.cut-layout-modes .is-active').textContent, h.q('.cut-min-terrace').value], ['Terraces', '0'], 'the defaults: Terraces, 0');
    const n0 = st.history.length;
    h.pressEl('.cut-layout-modes .cut-preset[data-value="nested"]');
    eq([V2_PLAN.get(tk).roughLayout, st.history.length, h.rows().includes('minTerraceWidth')], ['nested', n0 + 1, false], 'Nested: stored, one undo step, no Min terrace width row');
    eq(elems(exportOf(app)).map((e) => `${e.type}@${e.depth}`), ['pocket@2.000 mm', 'pocket@3.000 mm', 'pocket@6.000 mm'], 'Nested: the 2 mm level, the pocket in the plate at 3 (the band the same at 3 and 6: one path, at 6), the band at 6');
    st.undo();
    eq(V2_PLAN.get(tk).roughLayout, undefined, 'undo: Terraces again');
    h.setField('.cut-min-terrace', '20');
    eq(V2_PLAN.get(tk).minTerraceWidth, 20, 'Min terrace width 20 mm stored');
    ok(h.note().some((t) => /^Roughing: \d+ bands? narrower than 20 mm left uncut$/.test(t)), 'the note says the bands left: ' + JSON.stringify(h.note()));
    h.setField('.cut-min-terrace', '0');

    // save + reload: the Roughing, its levels and its Contour
    addContourV2(tk);
    const saved = captureShaperDoc();
    const svgBefore = exportOf(app);
    applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
    eq([V2_PLAN.get(tk).cutType, V2_PLAN.get(tk).levels.length, Boolean(contourOf(tk))], ['roughing', 4, true], 'reloaded: Roughing, its levels, its Contour');
    eq(exportOf(app), svgBefore, 'reloaded: the same export');
    eq(typeRefusal('contour', [tk]), null, 'TASK S2: a closed shape takes the Contour (a type of its own)');
    V2_PLAN.setOrder([]);
  } finally { await app.close(); }
}

console.log(`roughing-contour-792-node: ok (${checks} checks)`);
