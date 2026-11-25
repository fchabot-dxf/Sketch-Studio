// tests/stock-placement-898-node.test.js — TASK 898 = STOCK step T2 (docs/STOCK-MODEL-890.md section 5 row T2) + the SCULPTED PART'S PLACEMENT in a thicker stock
// (owner turn 3703: "2 allow to choose"), on the Shaper node page (tests/helpers/node-app.js):
//  1. T2: a Fusion selection (fusion-import.js, the `stock` option null) ensures ONE EMPTY Stock operation whose thickness is FROM THE PART ('model'): no number is
//     written into the declared record; a thicker part added re-reads it; a TYPED Stock thickness survives an add, and the notice says the part is taller (the
//     stl-import.js rule); a selection that replaces the design (no selection id) gets its own one Stock again. Open STL (the website) makes no Stock row and still
//     sets the record (its 'part' option).
//  2. The placement (the Stock card's "Sculpted parts sit on": Floor | Top, default Floor; cut-plan.js reliefDrop, the ONE place): a 20 mm relief in a 30 mm stock:
//     Floor = the part's bottom on the stock's bottom: the Roughing runs 10 .. 30 mm, its first level (10 mm) clears the 10 mm of stock above the part's top, every
//     other level is Top's 10 mm deeper; Top = the part's top at the stock's top: 1 .. 20 mm, the Shaper SVG byte for byte the one of today (the part in a 20 mm
//     stock); a Contour follows (no pass above the part's top, its deepest at 30 mm); a flat cut (a Pocket on a drawn shape, a Pocket on the relief's own region)
//     ignores it; stock == part: Floor and Top write the same file, byte for byte.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { DEFAULT_STOCK } from '#core/relief-model.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { rect } from '#core/tool-ops.js';
import { findLoops } from '#core/loop-finder.js';
import * as M from './helpers/stl-mesh.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { keyOf, planEntries, setStock as setStockOp, setOpFields, newOperation, loopsWithPolygons, planOwnedLoops, getPlanRecord } from '../apps/shaper/src/cut-plan.js';
import { STOCK_TYPE_ID, CUT_TYPES, SCULPTED_ON, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { getStock, setStock, resolveStock } from '../apps/shaper/src/stock.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { applyPrepare } from '../apps/shaper/src/shaper-doc.js';
import { hintLabel, hintText } from '../apps/shaper/src/param-hints.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

const rectSegs = (x, y, w, h) => [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]].map(([x1, y1, x2, y2]) => ({ type: 'line', x1, y1, x2, y2 }));
// a Fusion body as the add-in sends it with its Add selection (a selection id): one Outside region, the body's thickness
const body = (id, name, t, x) => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, selectionId: id, source: { kind: 'body', name },
  stock: { thicknessMm: t }, regions: [{ id: `reg_${id}`, label: 'Outer', cutType: 'outside', depthMm: t, outer: { closed: true, segments: rectSegs(x, 0, 30, 20) }, holes: [] }],
  chains: [], warnings: [],
});
// the relief: a 20 mm tall frustum (a 40 x 40 base, a 20 x 20 top), built here
const FRUSTUM = M.binaryStl(M.lofted({ outer: [{ z: 20, pts: M.rect(10, 10, 30, 30) }, { z: 0, pts: M.rect(0, 0, 40, 40) }] }));

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  const stocks = () => storeOps().filter((o) => o.type === STOCK_TYPE_ID);
  const fresh = () => { app.modes.showMode('design'); app.prepare.ok(); st.clearDocument(); applyPrepare(null); app.modes.showMode('prepare'); };

  // ── 1. T2: the Fusion selection's Stock row ──
  {
    fresh();
    setStock({ ...DEFAULT_STOCK, thickness: 25 }); // the declared record holds a typed 25 mm (the website's card)
    const r1 = importFusionSelection(body('sel-a', 'Body A', 20, 0), { controller: app.controller, prepare: app.prepare });
    ok(r1.ok && r1.imported, `1: body A imported (${r1.message})`);
    eq(stocks().map((o) => [o.geometry.length, o.settings.cutDepth]), [[0, 'model']], '1: ONE EMPTY Stock operation, its thickness from the part (model)');
    eq(getStock().thickness, 25, '1: no number written into the declared record');
    eq(resolveStock(st).board, { kind: 'bounds', key: null, thickness: 20, thicknessFrom: 'model' }, '1: the board = the part bounds + margin, 20 mm from the part');
    const stockId = stocks()[0].id;
    const r2 = importFusionSelection(body('sel-b', 'Body B', 30, 50), { controller: app.controller, prepare: app.prepare });
    ok(r2.ok && r2.imported, `1: body B added (${r2.message})`);
    eq(stocks().map((o) => [o.id, o.settings.cutDepth]), [[stockId, 'model']], '1: still ONE Stock (the same), from the part');
    eq(resolveStock(st).board.thickness, 30, '1: a thicker part added: the board re-reads it (30 mm)');
    eq(getStock().thickness, 25, '1: the record still untouched');
    setOpFields(stocks()[0], { cutDepth: 40 }, st); // the user types 40 mm on the Stock
    eq(resolveStock(st).board, { kind: 'bounds', key: null, thickness: 40, thicknessFrom: 'typed' }, '1: a typed Stock thickness');
    const r3 = importFusionSelection(body('sel-c', 'Body C', 50, 100), { controller: app.controller, prepare: app.prepare });
    eq(r3.message, 'Added Body C: 1 region · Body C is 50 mm tall: the stock is 40 mm', '1: an add of a taller part says so');
    eq([stocks().length, stocks()[0].settings.cutDepth, resolveStock(st).board.thickness], [1, 40, 40], '1: the typed thickness survives the add (not raised)');
    const r4 = importFusionSelection(body('sel-d', 'Body D', 10, 150), { controller: app.controller, prepare: app.prepare });
    eq(r4.message, 'Added Body D: 1 region', '1: a part not taller: no note');
    const { selectionId, ...replacing } = body('x', 'Body E', 12, 0);
    const r5 = importFusionSelection(replacing, { controller: app.controller, prepare: app.prepare });
    eq(r5.message, 'Replaced with Body E: 1 region', '1: a selection with no id replaces the design');
    eq(stocks().map((o) => [o.geometry.length, o.settings.cutDepth]), [[0, 'model']], '1: the new design: its own ONE EMPTY Stock from the part');
    eq([resolveStock(st).board.thickness, getStock().thickness], [12, 25], '1: board 12 mm from the part; the record untouched');
    // the website: Open STL makes no Stock row and sets the record to the part's height (its own 'part' option, as before)
    fresh();
    const o = app.stl.openFile(FRUSTUM, 'frustum.stl');
    ok(o.ok && o.imported, `1: Open STL (${o.message})`);
    eq([stocks().length, getStock().thickness], [0, 20], '1: Open STL: no Stock row, the record = the part height (unchanged)');
  }

  // ── 2. the placement of a sculpted part ──
  {
    // the declaration: ONE setting on the Stock's card
    eq(SCULPTED_ON.choices.map((c) => c.id), ['floor', 'top'], '2: the choices: Floor | Top');
    eq(SCULPTED_ON.defaultId, 'floor', '2: default Floor');
    ok(CUT_TYPES.find((t) => t.id === STOCK_TYPE_ID).params.includes('sculptedOn'), "2: a row of the Stock's card");
    eq(CUT_TYPES.filter((t) => (t.params || []).includes('sculptedOn')).map((t) => t.id), [STOCK_TYPE_ID], '2: on no other card');
    eq(hintLabel('sculptedOn'), 'Sculpted parts sit on', '2: its label');
    eq([hintLabel('sculptedOn:floor'), hintLabel('sculptedOn:top')], ['Floor', 'Top'], '2: its choices');
    ok(hintText('sculptedOn').length > 20, '2: its hint');

    fresh();
    ok(app.stl.openFile(FRUSTUM, 'frustum.stl').ok, '2: the relief opened');
    const key = getSelections()[0].cutKeys[0];
    const rough = storeOps().find((op) => op.type === 'roughing');
    setOpFields(rough, { stepDepth: 1, smoothing: 0 }, st);
    // a drawn square next to it, in a Pocket 5 mm deep (a flat cut)
    app.modes.showMode('design');
    const sq = rect(st, 80, -30, 100, -10);
    app.engine.solve(500);
    app.modes.showMode('prepare');
    const sqKey = keyOf('loop', findLoops(st).find((l) => l.edges.length === 4 && sq.lines.every((e) => l.edges.includes(e))).id);
    const pocket = newOperation('pocket', [sqKey], st);
    setOpFields(pocket, { cutDepth: 5 }, st);
    const flatOnRelief = newOperation('pocket', [key], st); // a FLAT cut on the relief's own region: its depth from the model
    eq(flatOnRelief.settings.cutDepth, 'model', '2: a Pocket on the relief region, its depth from the model');
    const svg = () => shaperSvgOf(st, planEntries());
    const pocketEls = (s) => [...s.matchAll(/<path [^>]*shaper:cutType="pocket"[^>]*\/>/g)].map((x) => x[0]).filter((x) => x.includes('d="M 80 -30 ')); // the drawn square's
    const cutsOf = (type) => {
      const { loops, loopPolys } = loopsWithPolygons(st), owned = planOwnedLoops(st, loops, loopPolys);
      return planEntries().filter((e) => e.rec.cutType === type).flatMap((e) => deriveCuts(e.target, effectiveCutRecord(e.rec), st, loops, loopPolys, owned));
    };
    const depths = (cuts) => [...new Set(cuts.map((c) => c.terrace.depth))].sort((a, b) => a - b);
    const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; };
    const sitsOn = (v) => setOpFields(stocks()[0], { sculptedOn: v }, st);

    // stock == part (20 mm, the record Open STL set; no Stock operation: the default, Floor)
    const S20 = svg();
    const top20 = depths(cutsOf('roughing'));
    eq([top20[0], top20[top20.length - 1]], [1, 20], '2: stock = part: the Roughing runs 1 .. 20 mm');
    setStockOp(null, st); // an EMPTY Stock (its thickness unset: the record's 20 mm)
    sitsOn('top');
    eq(svg(), S20, '2: stock = part: Top writes the same file, byte for byte');
    sitsOn('floor');
    eq(svg(), S20, '2: stock = part: Floor writes the same file, byte for byte');
    const flatDepth = getPlanRecord(key) && planEntries().find((e) => e.opId === flatOnRelief.id).rec.cutDepth;

    // stock 30 mm, part 20 mm
    setStock({ ...getStock(), thickness: 30 });
    eq(resolveStock(st).board.thickness, 30, '2: the board is 30 mm');
    sitsOn('top');
    const S30T = svg(), topCuts = cutsOf('roughing'), topD = depths(topCuts);
    eq(S30T, S20, "2: Top: the part's top at the stock's top: the file of today, byte for byte");
    eq([topD[0], topD[topD.length - 1]], [1, 20], '2: Top: 1 .. 20 mm');
    sitsOn('floor');
    const S30F = svg(), floorCuts = cutsOf('roughing'), floorD = depths(floorCuts);
    ok(S30F !== S20, '2: Floor: another file');
    eq([floorD[0], floorD[floorD.length - 1]], [10, 30], '2: Floor: the Roughing runs 10 .. 30 mm (to the stock bottom)');
    eq(floorD.filter((d) => d < 10), [], '2: Floor: the 10 mm above the part are ONE level (identical levels: one cut at the deeper depth)');
    const first = floorCuts.filter((c) => c.terrace.depth === 10);
    const firstArea = first.reduce((s, c) => s + polyArea(c.isCompound ? c.outerPoly : c.polygon), 0);
    ok(firstArea >= 400 - 1e-6, `2: Floor: the first level (10 mm) clears over the part's 20 x 20 top: ${firstArea.toFixed(1)} mm²`);
    const sig = (c) => JSON.stringify([c.isCompound ? c.outerPoly : c.polygon, c.holePolys || null]);
    eq(floorCuts.filter((c) => c.terrace.depth > 10).map((c) => [c.terrace.depth, sig(c)]), topCuts.map((c) => [c.terrace.depth + 10, sig(c)]),
      "2: Floor: every other level is Top's, 10 mm deeper, the same paths");
    eq(pocketEls(S30F), pocketEls(S30T), '2: the flat Pocket on the drawn square: the same element on Floor and Top');
    eq(pocketEls(S30F).length, 1, '2: (it is there)');
    eq(planEntries().find((e) => e.opId === flatOnRelief.id).rec.cutDepth, flatDepth, "2: the flat Pocket on the relief's region: the part's own depth on Floor too");
    eq(flatDepth, 20, '2: (20 mm)');

    // a Contour on the part follows
    const contour = newOperation('contour', [key], st);
    setOpFields(contour, { smoothing: 0 }, st);
    const cF = depths(cutsOf('contour'));
    ok(cF[0] > 10 && cF[cF.length - 1] === 30, `2: Floor: the Contour has no pass above the part's top, its deepest at 30 mm (${cF[0]} .. ${cF[cF.length - 1]})`);
    sitsOn('top');
    const cT = depths(cutsOf('contour'));
    ok(cT[0] > 0 && cT[cT.length - 1] === 20, `2: Top: the Contour ${cT[0]} .. ${cT[cT.length - 1]}`);
    eq(cF, cT.map((d) => Math.round((d + 10) * 1e9) / 1e9), "2: Floor: the Contour's levels are Top's, 10 mm deeper");
  }
  console.log(`stock-placement-898-node: ${checks} checks OK`);
} finally {
  await app.close();
}
