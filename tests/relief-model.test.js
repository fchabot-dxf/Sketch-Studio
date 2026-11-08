// tests/relief-model.test.js — TASK 459: the 3D Review terrace model (pure #core, no WebGL).
import assert from 'node:assert';
import { buildRelief, reliefDepth, DEFAULT_STOCK, meshArea } from '#core/relief-model.js';
import { regionsFromRings, unionRegions, diffRegions } from '#core/plot/clip.js';
import { deriveCutFootprint } from '#core/profile-model.js';
import { effectiveCutRecord } from '../apps/shaper/src/shaper.js';

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const fp = (rings, fillRule = 'nonzero') => [{ rings, fillRule }];
const T = 19.05;
const stock = { thickness: T, width: 100, height: 100, margin: 0 };
const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const area = (x) => x.reduce((s, r) => s + Math.abs(ring2(r.outer)) - r.holes.reduce((q, h) => q + Math.abs(ring2(h)), 0), 0);
function ring2(g) { let s = 0; for (let i = 0; i < g.length - 1; i++) s += g[i][0] * g[i + 1][1] - g[i + 1][0] * g[i][1]; return s / 2; }

// (0) depth rules, declared once
assert.deepStrictEqual(reliefDepth('inside', 'unset', T), { kind: 'cut', depth: T, through: true, depthUnset: true });
assert.strictEqual(reliefDepth('pocket', 'unset', T).kind, 'skip');
assert.strictEqual(reliefDepth('online', 5, T).kind, 'cut', 'On Line is a groove at its depth');
assert.strictEqual(reliefDepth('online', 'unset', T).reason, 'no-depth', 'On Line with no depth: not shown, never guessed');
assert.strictEqual(reliefDepth('guide', 5, T).reason, 'unsupported', 'a Guide is never cut');
assert.strictEqual(reliefDepth('pocket', 30, T).through, true, 'pocket deeper than the board = through');
assert.strictEqual(reliefDepth('interior', 'unset', T).through, true, 'CUT_TYPES id interior = inside');
assert.strictEqual(reliefDepth('exterior', 4, T).depth, 4);
assert.strictEqual(DEFAULT_STOCK.thickness, 19.05);

// (1) a THROUGH cut (inside, 20x20, depth >= T) is an OPEN hole: top and bottom both lose the hole area, no floor, wall = perimeter x T
{
  const r = buildRelief({ stock, bounds, items: [{ key: 'a', cutType: 'inside', cutDepth: T, footprints: fp([rect(40, 40, 20, 20)]) }] });
  near(r.stats.areas.top, 10000 - 400, 1e-3, 'top = board - hole');
  near(r.stats.areas.bottom, 10000 - 400, 1e-3, 'bottom = board - hole (open)');
  assert.strictEqual(r.meshes.floor.indices.length, 0, 'a through cut has NO floor');
  near(r.stats.areas.wall, 80 * T, 1e-3, 'wall = perimeter x thickness');
  near(r.stats.areas.side, 4 * 100 * T, 1e-3, 'four stock sides');
  assert.strictEqual(r.levels.length, 1); assert.strictEqual(r.levels[0].through, true);
}

// (2) a POCKET to depth 6: a floor at -6 with the region's area, walls 6 deep, the bottom is whole
{
  const r = buildRelief({ stock, bounds, items: [{ key: 'p', cutType: 'pocket', cutDepth: 6, footprints: fp([rect(10, 10, 30, 20)]) }] });
  near(r.stats.areas.floor, 600, 1e-3, 'floor area');
  near(r.stats.areas.wall, 100 * 6, 1e-3, 'wall = perimeter x depth');
  near(r.stats.areas.top, 10000 - 600, 1e-3, 'top has the pocket cut out');
  near(r.stats.areas.bottom, 10000, 1e-3, 'bottom is whole');
  const ys = new Set(); for (let i = 1; i < r.meshes.floor.positions.length; i += 3) ys.add(r.meshes.floor.positions[i].toFixed(4));
  assert.deepStrictEqual([...ys], ['-6.0000'], 'every floor vertex sits at height -6');
  // every top-face triangle faces +Y, every floor triangle faces +Y, bottom -Y
  const ny = (g) => new Set([...g.normals].filter((_, i) => i % 3 === 1));
  assert.deepStrictEqual([...ny(r.meshes.top)], [1]); assert.deepStrictEqual([...ny(r.meshes.bottom)], [-1]);
}

// (3) a pocket ISLAND stays at FULL HEIGHT: derived by the REAL deriveCutFootprint (evenodd rings), not hand-made rings
{
  const D = 6.35;
  const rec = effectiveCutRecord({ cutType: 'pocket', toolDia: D, cutOffset: 0, cutDepth: 6 });
  const cut = { isCompound: true, outerPoly: rect(10, 10, 80, 60), holePolys: [rect(40, 30, 20, 20)] };
  const [f] = deriveCutFootprint([cut], rec, null);
  assert.strictEqual(f.fillRule, 'evenodd');
  const r = buildRelief({ stock, bounds, items: [{ key: 'p', cutType: 'pocket', cutDepth: 6, footprints: [f] }] });
  // the island centre (50,40) is NOT in the removed region: the floor has a hole there and the top keeps it
  const removed = r.levels[0].regions;
  const inside = (x, y) => removed.some((g) => ptIn(g.outer, x, y) && !g.holes.some((h) => ptIn(h, x, y)));
  assert.strictEqual(inside(50, 40), false, 'island centre is uncut');
  assert.strictEqual(inside(20, 20), true, 'pocket body is cut');
  // top face area = board - removed area; floor area = removed area (so the island is NOT in the floor)
  const removedArea = area(removed);
  near(r.stats.areas.floor, removedArea, 1e-2, 'floor = removed region');
  near(r.stats.areas.top, 10000 - removedArea, 1e-2, 'top keeps the island');
  assert.ok(removedArea < 80 * 60 - 20 * 20 + 1e-6, 'removed area excludes the island');
  // NON-VACUOUS: the flat nonzero union (the pre-459 helper) fills the island -> larger area
  const naive = regionsFromRings(f.rings.map((g) => g.map((p) => [p.x, p.y])), 'nonzero');
  assert.ok(area(naive) > removedArea + 300, `nonzero would fill the island (${area(naive)} vs ${removedArea})`);
}
function ptIn(g, x, y) { let c = false; for (let i = 0, j = g.length - 1; i < g.length; j = i++) { if ((g[i][1] > y) !== (g[j][1] > y) && x < (g[j][0] - g[i][0]) * (y - g[i][1]) / (g[j][1] - g[i][1]) + g[i][0]) c = !c; } return c; }

// (4) nested depths: pocket 3 deep inside-overlapping pocket 8 deep -> two levels, floors partition the union, walls stack to 8
{
  const items = [
    { key: 'a', cutType: 'pocket', cutDepth: 3, footprints: fp([rect(10, 10, 40, 40)]) },
    { key: 'b', cutType: 'pocket', cutDepth: 8, footprints: fp([rect(30, 30, 40, 40)]) },
  ];
  const r = buildRelief({ stock, bounds, items });
  assert.strictEqual(r.levels.length, 2);
  const union = 40 * 40 + 40 * 40 - 20 * 20;
  near(r.stats.areas.floor, union, 1e-3, 'floors partition the union (3-deep part + 8-deep part)');
  near(r.stats.areas.top, 10000 - union, 1e-3, 'top');
  // walls stack: boundary of the union (perimeter 240) 0..3 deep = 720, boundary of the deep square (perimeter 160) 3..8 = 5 high = 800
  near(r.stats.areas.wall, 240 * 3 + 160 * 5, 1e-3, 'wall strips stack from the previous level, not from the top');
}

// (5) skipped items are reported, never guessed; an unset Inside is THROUGH and listed
{
  const r = buildRelief({ stock, bounds, items: [
    { key: 'pk', cutType: 'pocket', cutDepth: 'unset', footprints: fp([rect(5, 5, 10, 10)]) },
    { key: 'ol', cutType: 'online', cutDepth: 'unset', footprints: fp([rect(5, 5, 10, 10)]) },
    { key: 'gd', cutType: 'guide', cutDepth: 3, footprints: fp([rect(5, 5, 10, 10)]) },
    { key: 'in', cutType: 'inside', cutDepth: 'unset', footprints: fp([rect(40, 40, 10, 10)]) },
  ] });
  assert.deepStrictEqual(r.stats.skipped.map((s) => s.key + ':' + s.reason), ['pk:no-depth', 'ol:no-depth', 'gd:unsupported']);
  assert.deepStrictEqual(r.stats.unsetThrough, ['in']);
  // the unset mark is in the scene: ONE per cut, ON the cut (a vertex of the cut's own outer ring)
  assert.strictEqual(r.marks.length, 1); assert.strictEqual(r.marks[0].kind, 'depth-unset'); assert.strictEqual(r.marks[0].key, 'in');
  assert.ok(r.marks[0].point[0] >= 40 && r.marks[0].point[0] <= 50 && r.marks[0].point[1] >= 40 && r.marks[0].point[1] <= 50, 'mark sits on the cut: ' + r.marks[0].point);
  // a profile's several footprints (outer + hole cuts share a key) give ONE mark
  const twin = buildRelief({ stock, bounds, items: [0, 1].map((i) => ({ key: 'x', cutType: 'inside', cutDepth: 'unset', footprints: fp([rect(10 + i * 30, 10, 10, 10)]) })) });
  assert.strictEqual(twin.marks.length, 1); assert.deepStrictEqual(twin.stats.unsetThrough, ['x']);
  // a depth that IS set draws no mark
  assert.strictEqual(buildRelief({ stock, bounds, items: [{ key: 'q', cutType: 'inside', cutDepth: 5, footprints: fp([rect(10, 10, 10, 10)]) }] }).marks.length, 0);
  near(r.stats.areas.bottom, 10000 - 100, 1e-3, 'unset Inside is open');
}

// (6) derived stock size = bounds + margin both sides; an explicit size is centred
{
  const r = buildRelief({ stock: { thickness: T, margin: 12.7 }, items: [{ key: 'a', cutType: 'inside', cutDepth: 'unset', footprints: fp([rect(0, 0, 50, 30)]) }] });
  near(r.stockBox.maxX - r.stockBox.minX, 50 + 25.4, 1e-9, 'width'); near(r.stockBox.maxY - r.stockBox.minY, 30 + 25.4, 1e-9, 'height');
}

// (7) budget: a realistic 8x11 in sheet (203.2 x 279.4 mm): 40 slots (rounded ends, 16-step arcs), 6 pockets, 12 holes
{
  const slot = (x, y, w, h) => { const r = h / 2, pts = []; for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 + Math.PI * k / 16; pts.push({ x: x + w - r + r * Math.cos(a), y: y + r + r * Math.sin(a) }); } for (let k = 0; k <= 16; k++) { const a = Math.PI / 2 + Math.PI * k / 16; pts.push({ x: x + r + r * Math.cos(a), y: y + r + r * Math.sin(a) }); } return pts; };
  const items = [];
  for (let i = 0; i < 40; i++) items.push({ key: 's' + i, cutType: 'inside', cutDepth: 'unset', footprints: fp([slot(10 + (i % 5) * 36, 10 + Math.floor(i / 5) * 12, 30, 8)]) });
  for (let i = 0; i < 6; i++) items.push({ key: 'p' + i, cutType: 'pocket', cutDepth: 3 + i, footprints: fp([rect(10 + i * 30, 150, 25, 40)]) });
  const t0 = performance.now();
  const r = buildRelief({ stock: { thickness: T, margin: 12.7 }, items });
  const ms = performance.now() - t0;
  console.log(`relief budget: ${r.stats.triangles} triangles, ${r.stats.levels} levels, ${ms.toFixed(0)} ms`);
  assert.ok(r.stats.triangles <= 100000, `triangles ${r.stats.triangles}`);
  assert.ok(ms <= 1500, `build ${ms} ms (node, generous; the browser target is 150 ms)`);
}

// (S2) ON LINE grooves from the REAL deriveCutFootprint: a closed square loop and an OPEN chain, 6 mm bit, depth 4
{
  const D = 6, r = D / 2, depth = 4;
  const rec = effectiveCutRecord({ cutType: 'online', toolDia: D, cutOffset: 0, cutDepth: depth });
  // closed loop 40x40: the band is the loop swept by the bit (round corners), centred ON the line
  const sq = rect(20, 20, 40, 40);
  const [fc] = deriveCutFootprint([{ kind: 'loop', polygon: sq, cutType: 'online', offsetSide: 0, isCompound: false }], rec, null);
  assert.strictEqual(fc.cutType, 'online');
  const rc = buildRelief({ stock, bounds, items: [{ key: 'c', cutType: 'online', cutDepth: depth, footprints: [fc] }] });
  const band = 4 * 40 * D + Math.PI * r * r - 4 * r * r;              // 4 straight bands + 4 outer quarter discs - 4 inner overlap squares
  near(rc.stats.areas.floor, band, band * 0.01, 'closed groove floor = the swept band');
  near(rc.stats.areas.top, 10000 - rc.stats.areas.floor, 1e-2, 'top loses the groove, keeps the plug inside');
  assert.ok(rc.stats.areas.top > 10000 - band - 1, 'the plug (loop interior) stays at full height');
  const ys = new Set(); for (let i = 1; i < rc.meshes.floor.positions.length; i += 3) ys.add(rc.meshes.floor.positions[i].toFixed(4));
  assert.deepStrictEqual([...ys], ['-4.0000'], 'groove floor at the cut depth');
  // width = the bit: across the top edge (y = 20) the groove spans y in [20 - r, 20 + r]
  const inGroove = (x, y) => rc.levels[0].regions.some((g) => ptIn(g.outer, x, y) && !g.holes.some((h) => ptIn(h, x, y)));
  assert.ok(inGroove(40, 20 - r + 0.05) && inGroove(40, 20 + r - 0.05), 'groove spans the bit width, centred on the line');
  assert.ok(!inGroove(40, 20 - r - 0.1) && !inGroove(40, 20 + r + 0.1), 'and no wider');
  assert.ok(!inGroove(40, 40), 'the plug is not cut');
  // an open chain (one 40 mm line) -> a groove with ROUND ends, from deriveCutFootprint's chain branch
  const st = { joints: new Map([['a', { x: 30, y: 70 }], ['b', { x: 70, y: 70 }]]), shapes: [{ id: 's', type: 'line', joints: ['a', 'b'] }], constraints: [] };
  const [fo] = deriveCutFootprint([{ kind: 'chain', chain: { shapes: st.shapes }, cutType: 'online', offsetSide: 0, isCompound: false }], rec, st);
  const ro = buildRelief({ stock, bounds, items: [{ key: 'o', cutType: 'online', cutDepth: depth, footprints: [fo] }] });
  const groove = 40 * D + Math.PI * r * r;
  near(ro.stats.areas.floor, groove, groove * 0.01, 'open groove = rectangle + two half discs');
  const inO = (x, y) => ro.levels[0].regions.some((g) => ptIn(g.outer, x, y));
  assert.ok(inO(30 - r + 0.2, 70), 'the end cap reaches r past the end point');
  assert.ok(!inO(30 - r + 0.2, 70 + r - 0.2), 'but the end is ROUND (a square end would contain this corner point)');
  assert.ok(!inO(30 - r - 0.2, 70), 'and stops at r');
  // an On Line groove deeper than the board is a slot all the way through (no floor)
  const rt = buildRelief({ stock, bounds, items: [{ key: 'o', cutType: 'online', cutDepth: T, footprints: [fo] }] });
  assert.strictEqual(rt.meshes.floor.indices.length, 0); near(rt.stats.areas.bottom, 10000 - groove, groove * 0.01, 'through slot opens the bottom');
}

// (8) determinism
{
  const items = [{ key: 'a', cutType: 'pocket', cutDepth: 5, footprints: fp([rect(10, 10, 30, 30)]) }];
  const a = buildRelief({ stock, bounds, items }), b = buildRelief({ stock, bounds, items });
  assert.deepStrictEqual(Array.from(a.meshes.wall.positions), Array.from(b.meshes.wall.positions));
}

// region helpers: difference of a donut from a square keeps the hole nesting
{
  const donut = regionsFromRings([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]], 'evenodd');
  assert.strictEqual(donut.length, 1); assert.strictEqual(donut[0].holes.length, 1);
  near(area(donut), 100 - 16, 1e-9, 'donut area');
  near(area(diffRegions(donut, regionsFromRings([[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]], 'nonzero'))), 42 - 0, 1e-6, 'half the donut');
  near(area(unionRegions(donut, regionsFromRings([[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]], 'nonzero'))), 84 + 4, 1e-6, 'island filled back');
}
console.log('relief-model OK');
