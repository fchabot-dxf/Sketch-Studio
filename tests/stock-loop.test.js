// tests/stock-loop.test.js — TASK 472: STOCK as a declared cut type. A closed loop marked Stock IS the board in the Review (any shape,
// holes from an explicit combined profile), extruded to the thickness set on it; the old rectangle is the fallback; the export writes
// it as a GUIDE; it persists and undoes with the cut plan.
// (EXPORT: the owner's final call is a GUIDE: Shaper's docs call a guide uncuttable; the thickness rides in cutDepth.)
import assert from 'node:assert';
import { buildRelief, DEFAULT_STOCK } from '#core/relief-model.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { makeProfile } from '#core/profile-model.js';
import { CUT_TYPES, STOCK_TYPE_ID, exportEncoding, classify, extractCutRecord, effectiveCutRecord, availableTypes } from '../apps/shaper/src/shaper.js';
import { CUT_PLAN, planReliefItems, planStockProfile, stockKeyOf, keyOf } from '../apps/shaper/src/cut-plan.js';
import { resolveStock } from '../apps/shaper/src/stock.js';
import { captureShaperDoc, applyShaperDoc, captureCutPlan, applyCutPlan } from '../apps/shaper/src/shaper-doc.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const ptIn = (g, x, y) => { let c = false; for (let i = 0, j = g.length - 1; i < g.length; j = i++) { if ((g[i][1] > y) !== (g[j][1] > y) && x < (g[j][0] - g[i][0]) * (y - g[i][1]) / (g[j][1] - g[i][1]) + g[i][0]) c = !c; } return c; };
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const fp = (rings, fillRule = 'nonzero') => [{ rings, fillRule }];

// a sketch state from closed polygons: [{ id, pts:[[x,y],...] }]
function sketch(polys) {
  const st = { joints: new Map(), shapes: [], constraints: [], profiles: [] };
  for (const { id, pts } of polys) {
    pts.forEach(([x, y], i) => st.joints.set(`${id}${i}`, { x, y }));
    pts.forEach((_, i) => st.shapes.push({ id: `${id}s${i}`, type: 'line', joints: [`${id}${i}`, `${id}${(i + 1) % pts.length}`] }));
  }
  return st;
}
const loopAt = (st, x, y) => findLoops(st).find((l) => l.edges.some((e) => { const s = st.shapes.find((q) => q.id === e); return s && st.joints.get(s.joints[0]).x === x && st.joints.get(s.joints[0]).y === y; }));

// ── the declaration ──
{
  const t = CUT_TYPES.find((c) => c.id === STOCK_TYPE_ID);
  assert.ok(t, 'Stock is a declared cut type');
  assert.deepStrictEqual(t.params, ['cutDepth'], 'its one field is the depth row (thickness): no offset / bit rows');
  assert.strictEqual(t.depthLabel, 'Thickness'); assert.strictEqual(t.targetKind, 'region', 'closed loops only');
  assert.ok(availableTypes('loop').some((c) => c.id === 'stock') && availableTypes('profile').some((c) => c.id === 'stock'));
  assert.ok(!availableTypes('chain').some((c) => c.id === 'stock'), 'an open chain cannot be the stock');
  assert.strictEqual(t.cutType, 'guide', 'its export encoding is the Guide'); assert.strictEqual(t.fill, '#0068FF');
  assert.ok(CUT_TYPES.findIndex((c) => c.id === 'stock') > CUT_TYPES.findIndex((c) => c.id === 'guide'), 'declared after the guide');
  assert.strictEqual(effectiveCutRecord({ cutType: 'stock', cutDepth: 19, cutOffset: 3, toolDia: 6 }).cutOffset, 0, 'the preview ignores an offset on a Stock');
}

// ── the relief from a Stock loop: an irregular L-shape with a hole ──
const L = [[0, 0], [60, 0], [60, 30], [30, 30], [30, 60], [0, 60], [0, 0]];                // the L (area 2700)
const HOLE = [[8, 8], [22, 8], [22, 22], [8, 22], [8, 8]];                                 // a 14x14 hole (area 196)
const T = 19.05;
const board = { thickness: T, profile: { outer: L, holes: [HOLE] } };
const areaL = 60 * 30 + 30 * 30, areaHole = 14 * 14;
{
  const r = buildRelief({ stock: board, items: [] });
  assert.strictEqual(r.stats.board, 'profile');
  near(r.stats.areas.top, areaL - areaHole, 1e-6, 'top = the L minus its hole'); near(r.stats.areas.bottom, areaL - areaHole, 1e-6, 'bottom the same');
  near(r.stats.areas.side, (240 + 56) * T, 1e-2, 'the board edge: outer perimeter 240 + hole 56, all x thickness');
  assert.deepStrictEqual([r.stockBox.minX, r.stockBox.maxX, r.stockBox.minY, r.stockBox.maxY], [0, 60, 0, 60]);
  // NO top / bottom triangle outside the board: every centroid is inside the L and outside the hole
  for (const name of ['top', 'bottom']) {
    const m = r.meshes[name];
    for (let t = 0; t < m.indices.length; t += 3) {
      let cx = 0, cz = 0; for (let v = 0; v < 3; v++) { cx += m.positions[m.indices[t + v] * 3] / 3; cz += m.positions[m.indices[t + v] * 3 + 2] / 3; }
      assert.ok(ptIn(L, cx, cz) && !ptIn(HOLE, cx, cz), `${name}: a triangle centroid (${cx.toFixed(2)}, ${cz.toFixed(2)}) lies off the board`);
    }
  }
  // the cut-out corner of the L is empty: a point in it is in no triangle's bbox... check via areas above and via the box corner
  assert.ok(!ptIn(L, 45, 45) && r.stats.areas.top < 60 * 60);
  // every wall faces away from the material: its normal points to the board OUTSIDE (a probe just past the wall is off the board)
  const sd = r.meshes.side;
  for (let t = 0; t < sd.indices.length; t += 3) {
    const a = sd.indices[t] * 3; let mx = 0, mz = 0; for (let v = 0; v < 3; v++) { mx += sd.positions[sd.indices[t + v] * 3] / 3; mz += sd.positions[sd.indices[t + v] * 3 + 2] / 3; } // the triangle centroid: off any corner
    const px = mx + sd.normals[a] * 0.05, pz = mz + sd.normals[a + 2] * 0.05;
    const onBoard = ptIn(L, px, pz) && !ptIn(HOLE, px, pz);
    assert.ok(!onBoard, `side wall at (${mx.toFixed(1)}, ${mz.toFixed(1)}) must face OUT of the material`);
  }
  // a pocket that leaves the board: only the part ON the board is cut; a cut wholly off the board is reported, nothing is cut there
  const pk = { key: 'p', cutType: 'pocket', cutDepth: 5, footprints: fp([rect(40, 10, 40, 10)]) };   // x 40..80: only 40..60 is on the board
  const off = { key: 'o', cutType: 'pocket', cutDepth: 5, footprints: fp([rect(40, 40, 10, 10)]) };  // inside the L's missing corner
  const hole = { key: 'h', cutType: 'pocket', cutDepth: 5, footprints: fp([rect(10, 10, 10, 10)]) }; // wholly inside the stock's HOLE
  const r2 = buildRelief({ stock: board, items: [pk, off, hole] });
  near(r2.stats.areas.floor, 20 * 10, 1e-6, 'only the on-board 20x10 of the pocket is cut');
  assert.deepStrictEqual(r2.stats.partlyOutside, ['p']); assert.deepStrictEqual(r2.stats.outsideStock, ['o', 'h']);
  for (let t = 0; t < r2.meshes.floor.indices.length; t += 3) { let cx = 0, cz = 0; for (let v = 0; v < 3; v++) { cx += r2.meshes.floor.positions[r2.meshes.floor.indices[t + v] * 3] / 3; cz += r2.meshes.floor.positions[r2.meshes.floor.indices[t + v] * 3 + 2] / 3; } assert.ok(ptIn(L, cx, cz) && !ptIn(HOLE, cx, cz), 'a floor triangle lies off the board'); }
  // a through cut across the board's edge leaves the edge intact outside it
  const thr = buildRelief({ stock: board, items: [{ key: 't', cutType: 'inside', cutDepth: T, footprints: fp([rect(50, 5, 20, 10)]) }] });
  near(thr.stats.areas.bottom, areaL - areaHole - 10 * 10, 1e-6, 'a through cut on the board edge opens only the part on the board');
  // cached builds agree with cold builds for a profile board too
  const items = [{ key: 'p', sig: 's1', cutType: 'pocket', cutDepth: 5, footprints: fp([rect(40, 10, 40, 10)]) }];
  const { createReliefCache } = await import('#core/relief-model.js');
  const cache = createReliefCache();
  const cold = buildRelief({ stock: board, items }), c1 = buildRelief({ stock: board, items, cache }), c2 = buildRelief({ stock: board, items, cache });
  assert.deepStrictEqual(Array.from(c2.meshes.top.positions), Array.from(cold.meshes.top.positions)); assert.strictEqual(c2.stats.cache.misses, 0); assert.ok(c1.stats.cache.misses > 0);
  // another board shape must not reuse the cached clip of the first
  const board2 = { thickness: T, profile: { outer: [[0, 0], [60, 0], [60, 60], [0, 60], [0, 0]], holes: [] } };
  const other = buildRelief({ stock: board2, items, cache });
  near(other.stats.areas.floor, 20 * 10, 1e-6, 'on the full square board the pocket (x 40..80) shows its 20x10 on-board part (not the first board clip)');
}
// FALLBACK UNCHANGED: with no Stock loop the rectangle meshes are byte-identical to the build before this task (golden hashes taken from the previous code)
{
  const fnv = (h, arr) => { const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
  const H = (r) => Object.fromEntries(['top', 'floor', 'wall', 'bottom', 'side'].map((k) => { let h = 2166136261; const m = r.meshes[k]; h = fnv(h, m.positions); h = fnv(h, m.normals); h = fnv(h, m.indices); return [k, h.toString(16)]; }));
  const items = [
    { key: 'a', cutType: 'inside', cutDepth: 19.05, footprints: fp([rect(10, 10, 20, 20)]) },
    { key: 'p', cutType: 'pocket', cutDepth: 5, footprints: fp([rect(50, 10, 30, 30), rect(60, 20, 10, 10)], 'evenodd') },
    { key: 'q', cutType: 'pocket', cutDepth: 9, footprints: fp([rect(55, 15, 8, 8)]) },
    { key: 'u', cutType: 'outside', cutDepth: 'unset', footprints: fp([rect(10, 60, 15, 15)]) },
  ];
  const r = buildRelief({ stock: { thickness: 19.05, margin: 12.7 }, items });
  assert.strictEqual(r.stats.board, 'rectangle'); assert.strictEqual(r.stats.triangles, 102);
  assert.deepStrictEqual(H(r), { top: '2b6c2019', floor: 'c7b50f90', wall: '15d4851d', bottom: '293f1619', side: 'deb7d885' }, 'the rectangle board is byte-identical to before');
  assert.deepStrictEqual(r.stats.outsideStock, []); assert.deepStrictEqual(r.stats.partlyOutside, []);
}

// ── from the real cut plan: a Stock loop -> profile + thickness; holes only from an explicit combined profile ──
{
  const st = sketch([{ id: 'A', pts: [[0, 0], [60, 0], [60, 30], [30, 30], [30, 60], [0, 60]] }, { id: 'B', pts: [[8, 8], [22, 8], [22, 22], [8, 22]] }, { id: 'C', pts: [[100, 0], [140, 0], [140, 40], [100, 40]] }]);
  const la = loopAt(st, 0, 0), lb = loopAt(st, 8, 8);
  const plan = new Map();
  assert.strictEqual(stockKeyOf(plan), null); assert.strictEqual(planStockProfile(st, plan), null);
  // a PLAIN Stock loop with another loop merely drawn inside it: that inner loop is a part to cut, NOT a hole of the board
  plan.set(keyOf('loop', la.id), { cutType: 'stock', cutDepth: 15 });
  const sp = planStockProfile(st, plan);
  assert.strictEqual(sp.thickness, 15); assert.strictEqual(sp.holes.length, 0, 'loops drawn inside a plain Stock loop are not holes'); assert.strictEqual(sp.outer.length, 7);
  plan.set(keyOf('loop', la.id), { cutType: 'stock', cutDepth: 'unset' });
  assert.strictEqual(planStockProfile(st, plan).thickness, null, 'thickness unset -> null (the declared default applies)');
  // an explicit combined profile: the inner loop IS a hole
  const prof = makeProfile(st, la, [lb]);
  plan.clear(); plan.set(keyOf('profile', prof.id), { cutType: 'stock', cutDepth: 20 });
  const sp2 = planStockProfile(st, plan);
  assert.strictEqual(sp2.holes.length, 1); assert.strictEqual(sp2.thickness, 20);
  // the planned CUTS never include the Stock loop
  plan.set(keyOf('loop', loopAt(st, 100, 0).id), { cutType: 'pocket', cutDepth: 5, toolDia: 3.175, cutOffset: 0 });
  assert.ok(planReliefItems(st, plan).every((i) => i.key !== keyOf('profile', prof.id)), 'a Stock loop is not a cut item');
  // resolveStock: the loop form carries the profile + thickness; with no Stock loop it is the declared record
  const rs = resolveStock(st, plan);
  assert.strictEqual(rs.fromLoop.thickness, 20); assert.ok(rs.stock.profile && rs.stock.profile.holes.length === 1);
  const none = resolveStock(st, new Map([[keyOf('loop', la.id), { cutType: 'pocket', cutDepth: 5 }]]));
  assert.strictEqual(none.fromLoop, null); assert.strictEqual(none.stock.profile, undefined); assert.strictEqual(none.stock.thickness, DEFAULT_STOCK.thickness);
  // ONE stock: a second Stock record does not make two boards (the first in the plan wins)
  const two = new Map([[keyOf('loop', la.id), { cutType: 'stock', cutDepth: 10 }], [keyOf('loop', loopAt(st, 100, 0).id), { cutType: 'stock', cutDepth: 30 }]]);
  assert.strictEqual(stockKeyOf(two), keyOf('loop', la.id));

  // ── the EXPORT: a GUIDE (Studio guide encoding #0068FF), thickness in cutDepth, same order / format as every other cut ──
  const entries = [{ target: { kind: 'loop', id: la.id }, rec: { cutType: 'stock', cutDepth: 15, cutOffset: 0, toolDia: 3.175 } },
    { target: { kind: 'loop', id: loopAt(st, 100, 0).id }, rec: { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175 } }];
  const svg = exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm' });
  const paths = svg.match(/<path[^>]*>/g) || [];
  const stockPath = paths.find((p) => /d="M\s*0[ ,]0/.test(p));
  assert.ok(stockPath, 'the stock loop is exported: ' + svg);
  assert.ok(/fill="#0068FF"/.test(stockPath) && /stroke="#0068FF"/.test(stockPath), 'the guide colour: ' + stockPath);
  assert.ok(/shaper:cutType="guide"/.test(stockPath), 'shaper:cutType guide: ' + stockPath);
  assert.ok(/shaper:cutDepth="15\.000 mm"/.test(stockPath), 'the thickness rides in cutDepth: ' + stockPath);
  assert.ok(/shaper:cutOffset=/.test(stockPath) && /shaper:toolDia=/.test(stockPath), 'a guide keeps its params');
  assert.ok(/shaper:cutType="guide"[^>]*shaper:cutDepth[^>]*shaper:cutOffset[^>]*shaper:toolDia/.test(stockPath), 'same attribute order as every other cut');
  assert.ok(!/shaper:cutType="stock"/.test(svg), 'no custom stock attribute is invented');
  assert.ok(paths.some((p) => /shaper:cutType="pocket"/.test(p)), 'the other cut keeps its attributes');
  // re-import: that SVG gives a GUIDE (never a Stock; the owner can re-mark it)
  const fake = (attrs) => ({ getAttribute: (n) => attrs[n] || null, attributes: Object.keys(attrs).map((name) => ({ name })) });
  assert.strictEqual(classify(fake({ fill: '#0068FF', stroke: '#0068FF' })), 'guide', 'the guide colour is read back as a Guide, not as Stock');
  const rec = extractCutRecord(fake({ fill: '#0068FF', stroke: '#0068FF', 'shaper:cutType': 'guide', 'shaper:cutDepth': '15.000 mm' }), 'mm');
  assert.strictEqual(rec.cutType, 'guide'); assert.strictEqual(rec.cutDepth, 15, 'the thickness is kept on the re-imported guide');
}

// ── persistence + undo ride the cut plan ──
{
  const saved = [...CUT_PLAN.entries()];
  try {
    CUT_PLAN.clear();
    CUT_PLAN.set('loop:loop_x', { cutType: 'stock', cutDepth: 18.5, cutOffset: 0, toolDia: 3.175 });
    CUT_PLAN.set('loop:loop_y', { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175 });
    const doc = JSON.parse(JSON.stringify(captureShaperDoc()));                 // through JSON, like the sidecar
    CUT_PLAN.clear(); assert.strictEqual(stockKeyOf(), null);
    applyShaperDoc(doc);
    assert.strictEqual(stockKeyOf(), 'loop:loop_x'); assert.strictEqual(CUT_PLAN.get('loop:loop_x').cutDepth, 18.5, 'the Stock loop and its thickness survive a reload');
    // UNDO: the shared snapshots capture / restore the cut plan (hostSnapshot): move the role, then restore
    const before = captureCutPlan();
    CUT_PLAN.get('loop:loop_x').cutType = null; CUT_PLAN.get('loop:loop_y').cutType = 'stock';
    assert.strictEqual(stockKeyOf(), 'loop:loop_y');
    applyCutPlan(before);
    assert.strictEqual(stockKeyOf(), 'loop:loop_x', 'undo restores the Stock role to the previous loop');
  } finally { applyCutPlan(saved); }
}
console.log('stock-loop: ok');
