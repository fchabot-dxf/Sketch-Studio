// tests/relief-model.test.js — TASK 459: the 3D Review terrace model (pure #core, no WebGL).
import assert from 'node:assert';
import { buildRelief, reliefDepth, DEFAULT_STOCK, meshArea } from '#core/relief-model.js';
import { regionsFromRings, unionRegions, diffRegions } from '#core/plot/clip.js';
import { deriveCutFootprint, deriveCutFootprintAt } from '#core/profile-model.js';
import { cutterTerraces, cutterProfile, SHAPE_SLICES } from '#core/cutter-profile.js';
import { planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { findLoops } from '#core/loop-finder.js';
import { vbitHalfAngleTan } from '#core/vcarve.js';
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

// (S4) CUTTER SHAPES: real derivation (deriveCutFootprintAt = the same derivation at another half-width); sample the depth across the width
{
  const depthAtPoint = (rel, x, y) => rel.levels.reduce((m, l) => (l.regions.some((g) => ptIn(g.outer, x, y) && !g.holes.some((h) => ptIn(h, x, y))) ? Math.max(m, l.depth) : m), 0);
  const groove = (shape, D, depth, angle) => {
    const rec = effectiveCutRecord({ cutType: 'online', toolDia: D, cutOffset: 0, cutDepth: depth, cutterShape: shape, cutterAngle: angle });
    const st = { joints: new Map([['a', { x: 20, y: 50 }], ['b', { x: 80, y: 50 }]]), shapes: [{ id: 's', type: 'line', joints: ['a', 'b'] }], constraints: [] };
    const cuts = [{ kind: 'chain', chain: { shapes: st.shapes }, cutType: 'online', offsetSide: 0, isCompound: false }];
    const fps = deriveCutFootprint(cuts, rec, st);
    return buildRelief({ stock, bounds, items: [{ key: 'g', cutType: 'online', cutDepth: depth, footprints: fps, shape: { cutterShape: shape, cutterAngle: angle, toolDia: D }, footprintsAt: (w) => deriveCutFootprintAt(cuts, rec, st, w) }] });
  };
  // the declared profile maths
  {
    const t = cutterTerraces('ballnose', 6, 90, 4);
    assert.strictEqual(t.length, SHAPE_SLICES.ballnose); assert.strictEqual(t[0].depth, 4, 'innermost terrace = the cut depth');
    for (let i = 1; i < t.length; i++) assert.ok(t[i].depth < t[i - 1].depth && t[i].halfWidth > t[i - 1].halfWidth, 'wider = shallower');
    near(t[t.length - 1].halfWidth, 3, 1e-9, 'a deep-enough ball-nose reaches its radius');
  }
  near(cutterProfile('ballnose', 6, 90, 1).xMax, Math.sqrt(9 - 4), 1e-9, 'a 1 mm deep cut of a 6 mm ball is only sqrt(r^2-(r-d)^2) wide at the surface');
  assert.strictEqual(cutterProfile('endmill', 6, 90, 4), null, 'an end mill is flat: no terraces');

  // BALL NOSE 6 mm, 4 deep: the cross-section is ROUND. Centre = 4 deep; at x = r/2 the ball is still ~3.6 deep (a V would be 2.5)
  const ball = groove('ballnose', 6, 4);
  near(depthAtPoint(ball, 50, 50), 4, 1e-6, 'ball: centre at the cut depth');
  assert.ok(depthAtPoint(ball, 50, 50 + 1.5) > 3.2, 'ball: still deep at half the radius (round, not a V): ' + depthAtPoint(ball, 50, 51.5));
  assert.ok(depthAtPoint(ball, 50, 50 + 2.9) < 2.2 && depthAtPoint(ball, 50, 50 + 2.9) > 0, 'ball: shallow at the rim');
  assert.strictEqual(depthAtPoint(ball, 50, 50 + 3.2), 0, 'and nothing beyond the radius');
  let prev = Infinity;
  for (let x = 0.013; x <= 2.95; x += 0.25) { // off the exact terrace edges
    const d = depthAtPoint(ball, 50, 50 + x);
    assert.ok(d <= prev + 1e-9, 'depth never rises away from the centre line'); prev = d;
    assert.strictEqual(depthAtPoint(ball, 50, 50 - x), d, 'symmetric about the line');
  }
  {
    let worst = 0;
    for (let x = 0; x <= 2.95; x += 0.1) worst = Math.max(worst, Math.abs(depthAtPoint(ball, 50, 50 + x) - (1 + Math.sqrt(9 - x * x))));
    assert.ok(worst < 1.1, 'within one terrace step of the true circle (worst ' + worst.toFixed(2) + ')');
  }

  // V-BIT: the depth falls LINEARLY with distance from the line, slope = 1 / tan(halfAngle)
  for (const angle of [90, 60]) {
    const D = 10, depth = 4, t = vbitHalfAngleTan(angle);
    const v = groove('vbit', D, depth, angle);
    near(depthAtPoint(v, 50, 50), depth, 1e-6, `vbit ${angle}: tip at the cut depth`);
    const xs = []; for (let x = 0.03; x < Math.min(D / 2, depth * t) - 0.05; x += 0.07) xs.push(x); // across the whole V (staircase: fit a line)
    const ds = xs.map((x) => depthAtPoint(v, 50, 50 + x));
    const mx = xs.reduce((a, c) => a + c, 0) / xs.length, md = ds.reduce((a, c) => a + c, 0) / ds.length;
    const slope = -xs.reduce((a, x, i) => a + (x - mx) * (ds[i] - md), 0) / xs.reduce((a, x) => a + (x - mx) * (x - mx), 0);
    near(slope, 1 / t, 0.12 / t, `vbit ${angle}: fitted slope ${slope.toFixed(2)} vs 1/tan(half) = ${(1 / t).toFixed(2)} (depth falls linearly with distance)`);
    xs.forEach((x, i) => near(ds[i], depth - x / t, depth / SHAPE_SLICES.vbit * 1.01, `vbit ${angle}: depth at ${x.toFixed(2)} mm off the line`));
  }
  assert.ok(depthAtPoint(groove('vbit', 10, 4, 60), 50, 51) < depthAtPoint(groove('vbit', 10, 4, 90), 50, 51), 'a 60 deg V is narrower: its depth falls faster with distance than a 90 deg V');

  // an END MILL stays flat; budgets
  const flat = groove('endmill', 6, 4);
  assert.strictEqual(flat.levels.length, 1, 'end mill = one level');
  assert.ok(ball.stats.triangles < 3000 && ball.stats.levels === SHAPE_SLICES.ballnose, `ball groove budget: ${ball.stats.triangles} triangles, ${ball.stats.levels} levels`);
  console.log(`cutter shapes: end mill ${flat.stats.triangles} tris, ball ${ball.stats.triangles}, ${ball.stats.levels} levels`);
  // a through cut is cleared at full width (no terraces)
  const thru = buildRelief({ stock, bounds, items: [{ key: 't', cutType: 'inside', cutDepth: T, footprints: fp([rect(40, 40, 20, 20)]), shape: { cutterShape: 'ballnose', toolDia: 6 }, footprintsAt: () => { throw new Error('must not be asked'); } }] });
  assert.strictEqual(thru.levels.length, 1);
  // deriveCutFootprintAt: at the nominal radius it IS deriveCutFootprint; narrower = reaches the wall less (centre path fixed)
  const D = 6, rec = effectiveCutRecord({ cutType: 'pocket', toolDia: D, cutOffset: 0, cutDepth: 5, cutterShape: 'ballnose' });
  const cut = { isCompound: true, outerPoly: rect(10, 10, 60, 40), holePolys: [] };
  const wide = deriveCutFootprintAt([cut], rec, null, D / 2)[0], narrow = deriveCutFootprintAt([cut], rec, null, 1)[0], nominal = deriveCutFootprint([cut], rec, null)[0];
  assert.deepStrictEqual(wide.rings, nominal.rings, 'deriveCutFootprintAt at the nominal radius IS deriveCutFootprint');
  const minX = (f) => Math.min(...f.rings[0].map((p) => p.x));
  assert.ok(minX(narrow) > minX(wide) + 1.9, 'a narrower cutter (w=1) reaches the wall less: ' + minX(narrow) + ' vs ' + minX(wide));
}

// (S3) V-CARVE: every contour ring is a V-bit pass at its own depth (the exporter emits the same rings as On Line cuts)
{
  const st = { joints: new Map([['a', { x: 20, y: 40 }], ['b', { x: 60, y: 40 }], ['c', { x: 60, y: 60 }], ['d', { x: 20, y: 60 }]]), constraints: [],
    shapes: [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })) };
  const loop = findLoops(st)[0];
  st.vcarves = [{ id: 'vc', region: 'loop:' + loop.id, vbit: { angle: 90 }, dStep: 0.5, maxDepth: 3 }];
  const items = planReliefItems(st, new Map());
  assert.strictEqual(items.length, 6, 'maxDepth 3 / dStep 0.5 at 90 deg = 6 contour rings');
  assert.deepStrictEqual(items.map((i) => Math.round(i.cutDepth * 1000) / 1000), [0.5, 1, 1.5, 2, 2.5, 3], 'each ring has its own depth');
  const t0 = performance.now();
  const rel = buildRelief({ stock, bounds, items });
  const ms = performance.now() - t0;
  for (const d of [0.5, 1, 1.5, 2, 2.5, 3]) assert.ok(rel.levels.some((l) => Math.abs(l.depth - d) < 1e-6), `a floor at the ring depth ${d}`);
  const depthAt = (x, y) => rel.levels.reduce((m, l) => (l.regions.some((g) => ptIn(g.outer, x, y) && !g.holes.some((h) => ptIn(h, x, y))) ? Math.max(m, l.depth) : m), 0);
  for (const inset of [1, 2, 3]) assert.ok(Math.abs(depthAt(20.03 + inset, 50) - inset) <= 1.01, /* 3 slices per ring: within one 1 mm step of the true V */ `V-carve depth ~ inset: ${inset} mm in -> ${depthAt(20.03 + inset, 50)}`);
  assert.ok(depthAt(20 + 1, 50) < depthAt(20 + 3, 50), 'deeper toward the middle (a stepped V)');
  assert.strictEqual(depthAt(40, 50), 0, 'beyond the last ring the middle is uncut (maxDepth reached)');
  assert.strictEqual(depthAt(10, 50), 0, 'nothing outside the shape');
  console.log(`vcarve stack: ${rel.stats.triangles} triangles, ${rel.stats.levels} levels, ${ms.toFixed(0)} ms`);
  assert.ok(rel.stats.triangles < 30000);
  // the unset labels: one per SPOT
  const two = buildRelief({ stock, bounds, items: [
    { key: 'o', cutType: 'outside', cutDepth: 'unset', footprints: fp([rect(40, 40, 22, 22)]) },
    { key: 'i', cutType: 'inside', cutDepth: 'unset', footprints: fp([rect(41, 41, 20, 20)]) },
    { key: 'far', cutType: 'inside', cutDepth: 'unset', footprints: fp([rect(5, 5, 10, 10)]) },
  ] });
  assert.strictEqual(two.marks.length, 2, 'an Outside + an Inside on one hole share ONE label; a far cut has its own');
  assert.deepStrictEqual(two.marks[0].keys, ['o', 'i']); assert.deepStrictEqual(two.stats.unsetThrough, ['o', 'i', 'far']);
}

// far-apart cuts at different depths: the deeper cut must stay in every shallower level (the bbox pre-filter carries it over)
{
  const r = buildRelief({ stock, bounds, items: [
    { key: 'a', cutType: 'pocket', cutDepth: 3, footprints: fp([rect(5, 5, 20, 20)]) },
    { key: 'b', cutType: 'pocket', cutDepth: 8, footprints: fp([rect(70, 70, 20, 20)]) },
  ] });
  near(r.stats.areas.floor, 800, 1e-3, 'both floors present');
  near(r.stats.areas.top, 10000 - 800, 1e-3, 'top loses BOTH pockets');
  near(r.stats.areas.wall, 80 * 3 + 80 * 8, 1e-3, 'each pocket wall at its own depth');
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
