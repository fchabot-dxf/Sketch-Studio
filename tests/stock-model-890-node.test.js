// tests/stock-model-890-node.test.js — TASK 894 = STOCK step T1 (docs/STOCK-MODEL-890.md 2.1, 2.3, 2.4, section 5 row T1): ONE resolver of the board, resolveStock,
// reads the Stock OPERATION. Every row of the 2.1 table (a Stock with a shape / an EMPTY Stock / no Stock) x its thickness (typed / 'model' / 'unset'):
//   * `board` = { kind, key, thickness, thicknessFrom } (it replaces `fromLoop`);
//   * a Stock's 'model' = the PARTS' thickness, the largest of the selection entries' thicknessMm (cut-plan.js recordOf, the one place 'model' is read), the declared
//     record's when no part has one;
//   * an EMPTY Stock's own thickness is the board's (F1);
//   * a part's new thicknessMm (the same selection sent again, as the add-in does after a Fusion edit) -> a new board and a new rebuild signature (F2: stockSig, the
//     Review's reviewSig carries it);
//   * an SA-37 several-body payload (each body region's thicknessMm, stock.thicknessMm = the thickest) -> the thickest.
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { buildRelief, DEFAULT_STOCK } from '#core/relief-model.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf, setStock as setStockOp, setOpFields, changeOpType, getPlanRecord, stockKeyOf, setRegionSource } from '../apps/shaper/src/cut-plan.js';
import { storeOps, setOpSettings } from '../apps/shaper/src/operations-store.js';
import { STOCK_TYPE_ID } from '../apps/shaper/src/shaper.js';
import { getStock, setStock, resolveStock, stockSig } from '../apps/shaper/src/stock.js';
import { createStockCard, boardOf } from '../apps/shaper/src/stock-card.js';
import { setSelections, getSelections } from '../apps/shaper/src/selection-list.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { V2_PLAN } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) <= 1e-9, `${m}: ${a} vs ${b}`); checks++; };

// a sketch state from closed polygons (stock-loop.test.js)
function sketch(polys) {
  const st = { joints: new Map(), shapes: [], constraints: [], profiles: [] };
  for (const { id, pts } of polys) {
    pts.forEach(([x, y], i) => st.joints.set(`${id}${i}`, { x, y }));
    pts.forEach((_, i) => st.shapes.push({ id: `${id}s${i}`, type: 'line', joints: [`${id}${i}`, `${id}${(i + 1) % pts.length}`] }));
  }
  return st;
}
const loopAt = (st, x, y) => findLoops(st).find((l) => l.edges.some((e) => { const s = st.shapes.find((q) => q.id === e); return s && st.joints.get(s.joints[0]).x === x && st.joints.get(s.joints[0]).y === y; }));
const entry = (id, thicknessMm) => ({ id, text: id, thicknessMm }); // a selection entry (selection-list.js): only its part thickness is read here
const stockOp = () => storeOps().find((o) => o.type === STOCK_TYPE_ID) || null;
const setThickness = (v) => setOpSettings(stockOp(), { ...stockOp().settings, cutDepth: v }); // the stored form as a document has it (the writers' own rules are checked below)

// ── the pure resolution: every row of 2.1 x typed / model / unset ──
const st = sketch([{ id: 'A', pts: [[0, 0], [60, 0], [60, 40], [0, 40]] }, { id: 'C', pts: [[100, 0], [140, 0], [140, 40], [100, 40]] }]);
const keyA = keyOf('loop', loopAt(st, 0, 0).id), keyC = keyOf('loop', loopAt(st, 100, 0).id);
const RECORD = 22; // the declared record's typed thickness (the card)
const PARTS = [entry('p12', 12), entry('p25', 25), entry('sketch-only', null)]; // parts of 2 thicknesses (+ a sketch-only part: no thickness) -> 25
const resolveWith = (parts, thickness) => { setSelections(parts); if (thickness !== undefined) setThickness(thickness); return resolveStock(st); };

V2_PLAN.use(st); V2_PLAN.clear(); setSelections([]);
setStock({ ...DEFAULT_STOCK, thickness: RECORD });
V2_PLAN.set(keyC, { cutType: 'pocket', cutDepth: 5, toolDia: 3.175, cutOffset: 0 });

// row 3: no Stock op: the bounds + margin, the declared record's thickness, whatever the parts are
{
  for (const parts of [[], PARTS]) {
    const r = resolveWith(parts);
    eq(r.board, { kind: 'bounds', key: null, thickness: RECORD, thicknessFrom: 'default' }, `no Stock (${parts.length} parts): the record's thickness`);
    eq(r.stock, getStock(), 'no Stock: the stock IS the declared record (byte-identical to before)');
  }
}

// row 1: a Stock WITH a shape (the loop A): its profile, its thickness
{
  V2_PLAN.set(keyA, { cutType: 'stock', cutDepth: 15 });
  eq(stockKeyOf(), keyA, 'the Stock holds A');
  let r = resolveWith([], 15);
  eq(r.board, { kind: 'profile', key: keyA, thickness: 15, thicknessFrom: 'typed' }, 'Stock loop, typed 15');
  ok(r.stock.profile && r.stock.profile.outer.length === 5 && r.stock.thickness === 15, 'Stock loop, typed: the profile at 15');
  r = resolveWith(PARTS, 15);
  eq(r.board.thickness, 15, 'Stock loop, typed: the parts do not change a typed thickness');
  r = resolveWith(PARTS, 'model');
  eq(r.board, { kind: 'profile', key: keyA, thickness: 25, thicknessFrom: 'model' }, "Stock loop, 'model': the parts' largest thickness (12 / 25 / none -> 25)");
  eq(r.stock.thickness, 25, "Stock loop, 'model': the board is 25 thick");
  eq(getPlanRecord(keyA).cutDepth, 25, "recordOf: a Stock's 'model' reads the parts' thickness (the exported guide's cutDepth too)");
  r = resolveWith([], 'model');
  eq(r.board, { kind: 'profile', key: keyA, thickness: RECORD, thicknessFrom: 'default' }, "Stock loop, 'model' with no part thickness: the record's");
  r = resolveWith(PARTS, 'unset');
  eq(r.board, { kind: 'profile', key: keyA, thickness: RECORD, thicknessFrom: 'default' }, 'Stock loop, unset: the record\'s');
  eq([boardOf(resolveWith([], 15).board), boardOf(resolveWith([], 'unset').board), boardOf(null)], ['loop-set', 'loop-unset', 'bounds'], 'boardOf reads the board (the tooltip\'s note, unchanged)');
}

// row 2: an EMPTY Stock (the toolbar's Stock with nothing selected): the bounds + margin, ITS thickness (F1)
{
  V2_PLAN.delete(keyA);
  setStockOp(null, st);
  ok(stockOp() && stockOp().geometry.length === 0 && stockKeyOf() === null, 'an EMPTY Stock op');
  let r = resolveWith([], 38.1);
  eq(r.board, { kind: 'bounds', key: null, thickness: 38.1, thicknessFrom: 'typed' }, 'EMPTY Stock, typed 38.1: the board reads it (F1)');
  eq(r.stock, { ...getStock(), thickness: 38.1 }, 'EMPTY Stock, typed: the record with the op\'s thickness, no profile');
  r = resolveWith(PARTS, 'model');
  eq(r.board, { kind: 'bounds', key: null, thickness: 25, thicknessFrom: 'model' }, "EMPTY Stock, 'model': the parts' largest thickness");
  r = resolveWith([], 'model');
  eq(r.board, { kind: 'bounds', key: null, thickness: RECORD, thicknessFrom: 'default' }, "EMPTY Stock, 'model' with no part thickness: the record's");
  r = resolveWith(PARTS, 'unset');
  eq(r.board, { kind: 'bounds', key: null, thickness: RECORD, thicknessFrom: 'default' }, 'EMPTY Stock, unset: the record\'s');
  eq(r.stock, getStock(), 'EMPTY Stock, unset: the stock is the record');
  // the board itself (buildRelief, packages/core unchanged): the EMPTY Stock's thickness is the 3D board's
  const box = (thickness) => buildRelief({ stock: resolveWith([], thickness).stock, items: [], bounds: { minX: 0, minY: 0, maxX: 140, maxY: 40 } }).stockBox.thickness;
  eq([box(38.1), box('unset')], [38.1, RECORD], 'buildRelief: the EMPTY Stock\'s typed thickness / the record\'s');
}

// the writers agree with the reader: 'model' is stored for a Stock only when the value IS the parts' thickness
{
  setSelections(PARTS);
  setOpFields(stockOp(), { cutDepth: 25 }, st);
  eq(stockOp().settings.cutDepth, 'model', "a Stock typed equal to the parts' thickness is stored 'model' (the Depth rule, normalizeDepth)");
  setOpFields(stockOp(), { cutDepth: 30 }, st);
  eq(stockOp().settings.cutDepth, 30, 'any other typed value stays typed');
  setSelections([]);
  setOpFields(stockOp(), { cutDepth: 25 }, st);
  eq(stockOp().settings.cutDepth, 25, 'no part thickness: a typed value stays typed');
  // a type change across the Stock keeps the VALUE 'model' read (a Pocket's 'model' = its shape's imported depth, a Stock's = the parts')
  setRegionSource(keyC, { cutType: 'pocket', cutDepth: 8 }); // C's imported depth: 8
  const pocket = storeOps().find((o) => o.type === 'pocket');
  setOpSettings(pocket, { ...pocket.settings, cutDepth: 'model' });
  eq(getPlanRecord(keyC).cutDepth, 8, "a Pocket's 'model' = its shape's imported depth (unchanged)");
  setSelections(PARTS);
  changeOpType(pocket, STOCK_TYPE_ID, st);
  eq([pocket.settings.cutDepth, storeOps().filter((o) => o.type === STOCK_TYPE_ID).length], [8, 1], "Pocket 'model' (8) -> Stock: the Stock is 8 thick, typed (not the parts' 25); one Stock");
  eq(resolveStock(st).board, { kind: 'profile', key: keyC, thickness: 8, thicknessFrom: 'typed' }, 'the board after the type change: C at 8');
  setThickness('model');
  changeOpType(pocket, 'pocket', st);
  eq(pocket.settings.cutDepth, 25, "Stock 'model' (the parts' 25) -> Pocket: 25 typed (not C's imported 8)");
  setSelections([]);
}

// ── through the app: the card, a Fusion selection sent again with a new thickness, an SA-37 several-body payload ──
const app = await open({ host: 'shaper' });
try {
  const doc = app.document;
  const S = app.state;
  for (const k of [...S.joints.keys()]) S.joints.delete(k);
  S.shapes.length = 0; S.constraints.length = 0; V2_PLAN.use(S); V2_PLAN.clear(); setSelections([]);
  setStock({ ...DEFAULT_STOCK, thickness: RECORD });
  const segs = (x, y, w, h) => [{ type: 'line', x1: x, y1: y, x2: x + w, y2: y }, { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h }, { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h }, { type: 'line', x1: x, y1: y + h, x2: x, y2: y }];
  const body = (thicknessMm, regionThickness = null) => ({
    action: 'selection_data', version: 1, units: 'mm', selectionId: 'sel-body-894', coordSystem: { yAxis: 'up', frame: 'model' },
    source: { kind: 'body', name: 'Part' }, stock: { thicknessMm },
    regions: regionThickness ? regionThickness.map((t, i) => ({ id: 'reg_' + i, label: 'Body ' + i, cutType: 'outside', depthMm: t, thicknessMm: t, outer: { closed: true, segments: segs(i * 60, 0, 40, 30) }, holes: [] }))
      : [{ id: 'reg_0', label: 'Outline', cutType: 'outside', depthMm: thicknessMm, outer: { closed: true, segments: segs(0, 0, 40, 30) }, holes: [] }],
    chains: [], warnings: [],
  });
  const imp = (payload) => { const res = importFusionSelection(payload, { controller: app.controller, prepare: app.prepare }); ok(res.ok, 'import ok: ' + res.message); };
  imp(body(12));
  eq(getSelections().map((e) => e.thicknessMm), [12], 'the part entry carries its thickness');
  setStockOp(null, S); setThickness('model'); // an EMPTY Stock from the part (what T2 will write on the first import)
  const r1 = resolveStock(S), sig1 = JSON.stringify(stockSig(S));
  eq(r1.board, { kind: 'bounds', key: null, thickness: 12, thicknessFrom: 'model' }, "a Fusion part 12 thick: the EMPTY Stock's 'model' = 12");
  // the card shows the board's thickness; it edits the record, so it is disabled while the board reads the Stock op
  const input = doc.createElement('input'); doc.body.appendChild(input);
  const boards = [];
  const card = createStockCard({ input, getController: () => app.controller, onBoard: (b) => boards.push(b) });
  near(Number.parseFloat(input.value), 12, 'the card shows the board\'s thickness (12 mm)');
  eq([input.disabled, boards.at(-1)], [true, 'bounds'], "the card: disabled while the EMPTY Stock's own thickness is the board's; the board = bounds");
  // the part changes in Fusion: the add-in sends the selection again (same selectionId) with its new thickness
  imp(body(30));
  eq(getSelections().map((e) => e.thicknessMm), [30], 'the entry is replaced (upsert): 30');
  const r2 = resolveStock(S), sig2 = JSON.stringify(stockSig(S));
  eq(r2.board.thickness, 30, "the part's new thickness: the board is 30 thick (re-read, never copied)");
  ok(sig2 !== sig1, "the part's new thickness: a new stock signature (reviewSig rebuilds the 3D board, F2)");
  const thickOf = (r) => buildRelief({ stock: r.stock, items: [], bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 } }).stockBox.thickness;
  eq([thickOf(r1), thickOf(r2)], [12, 30], 'buildRelief: the new board');
  card.show(); near(Number.parseFloat(input.value), 30, 'the card follows the part (30 mm)');
  // SA-37: a several-body selection: each body region carries its thicknessMm, stock.thicknessMm = the thickest
  imp(body(25, [12, 25]));
  eq(getSelections().map((e) => e.thicknessMm), [25], 'SA-37: the entry carries the thickest body (25)');
  eq(resolveStock(S).board.thickness, 25, "SA-37: the Stock's 'model' = the thickest body");
  // no Stock op, an empty Stock unset: the card edits the record as before
  setThickness('unset'); setStock({ ...getStock(), thickness: RECORD }); card.show(); // (the import still writes the record's thickness, until T2)
  eq([input.disabled, Number.parseFloat(input.value)], [false, RECORD], 'an EMPTY Stock unset: the card edits the record (enabled, the record\'s 22)');
} finally {
  await app.close();
}

// reviewSig (shaper-app.js, the page's closure) carries the RESOLVED stock, not the record (F2)
{
  const src = fs.readFileSync(new URL('../apps/shaper/src/shaper-app.js', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => l.includes('const reviewSig = '));
  ok(line && line.includes('stockSig(st)') && !line.includes('getStock()'), 'reviewSig is built from stockSig(st) (the resolved stock), not getStock()');
}

console.log(`stock-model-890-node: ${checks} checks passed`);
