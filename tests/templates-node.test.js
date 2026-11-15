// tests/templates-node.test.js -- TASK 651: the bank of template drawings (packages/core/templates.js). Every template builds a valid version-3
// document that loads through the ONE load path (deserializeDocument), is accepted by the solver with 0 conflicts, carries its declared
// number of driving dimensions, keeps its geometry through a solve, and is FULLY constrained (nullity 0, anchored at the origin).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, buildTemplate, templateById } from '#core/templates.js';
import { DOCUMENT_VERSION, deserializeDocument, validateDocument } from '#core/document.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { measureResidual } from '#core/constraint-verifier.js';

assert.ok(TEMPLATES.length >= 6, 'a bank of templates');
const ids = TEMPLATES.map((t) => t.id);
assert.strictEqual(new Set(ids).size, ids.length, 'template ids are unique');
for (const id of ['slot', 'rounded-rectangle', 'keyhole', 'hexagon', 'star', 'arrow', 'l-bracket', 'bolt-circle', 'finger-edge', 'dog-bone-pocket', 't-slot', 'butterfly-key', 'cup-hinge-bore', 'shelf-pin-row', 'box-frame', 'right-angle-corner']) assert.ok(templateById(id), `the bank declares ${id}`);

const isDim = (c) => (c.type === 'distance' || c.type === 'angle') && !c.isDriven && !c.driven;
const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };

for (const t of TEMPLATES) {
  assert.ok(t.name && t.description && typeof t.build === 'function', `${t.id}: name, description, build`);
  const doc = buildTemplate(t);
  assert.strictEqual(doc.version, DOCUMENT_VERSION, `${t.id}: a version-${DOCUMENT_VERSION} document`);
  assert.ok(validateDocument(doc).ok, `${t.id}: the document is valid`);
  assert.ok(doc.geometry.shapes.length > 0, `${t.id}: has shapes`);
  assert.strictEqual(doc.geometry.constraints.filter(isDim).length, t.dimensions, `${t.id}: ${t.dimensions} driving dimensions`);

  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state));
  assert.ok(res.ok, `${t.id}: loads (${res.reason})`);
  assert.strictEqual(S.state.constraints.length, doc.geometry.constraints.length, `${t.id}: every constraint loaded (none dropped)`);
  const before = L.snapshot(S);
  const r = muted(() => S.engine.solve(L.ITER));
  assert.deepStrictEqual(r.conflicts || [], [], `${t.id}: 0 conflicts`);
  assert.ok(r.converged !== false, `${t.id}: converged`);
  assert.ok(!L.hasNaN(S), `${t.id}: no NaN`);
  assert.ok(L.maxDeviation(S, before) < 1e-3, `${t.id}: the authored geometry already satisfies its constraints (moved ${L.maxDeviation(S, before)})`);
  for (const c of S.state.constraints) assert.ok(!(measureResidual(c, S.state.joints, S.state.shapes) > 1e-4), `${t.id}: ${c.type} ${c.name || ''} residual`);
  assert.strictEqual(L.nullity(S), 0, `${t.id}: fully constrained (nullity ${L.nullity(S)})`);
  // editable after it opens: every driving dimension takes a new value (x 1.1) without a refusal and the sketch still solves
  for (const d of S.state.constraints.filter(isDim)) {
    const res2 = muted(() => commitDimensionEdit(S.state, d, d.value * 1.1));
    assert.ok(!res2.reverted, `${t.id}: dimension ${d.name} accepts ${d.value}`);
  }
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${t.id}: 0 conflicts after editing every dimension`);
  const o = S.state.joints.get('j_origin');
  assert.ok(o && Math.hypot(o.x, o.y) < 1e-9, `${t.id}: the origin stays at 0,0`);
}

// ---- TASK 669: every parameter changes the geometry, and the changed drawing is still fully constrained (0 conflicts, nullity 0)
const solved = (t, params = {}) => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(t, params))), S.state));
  assert.ok(res.ok, `${t.id}: loads (${res.reason})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${t.id}: 0 conflicts`);
  return S;
};
const sig = (S) => JSON.stringify([...S.state.joints.values()].map((j) => [Math.round(j.x * 1e4), Math.round(j.y * 1e4)]).sort()) + JSON.stringify(S.state.shapes.map((s) => s.radius || 0));
for (const t of TEMPLATES) {
  const base = sig(solved(t));
  for (const [k, v] of Object.entries(t.params)) {
    const val = v.kind === 'choice' ? v.options.find((o) => o.value !== v.default).value : v.kind === 'count' ? v.default - 1 : v.default * 1.3; // TASK 670: declared kinds
    const S = solved(t, { [k]: val });
    assert.notStrictEqual(sig(S), base, `${t.id}: param ${k} changes the geometry`);
    assert.strictEqual(L.nullity(S), 0, `${t.id}: param ${k} = ${val} still fully constrained`);
  }
}

// ---- TASK 669: the geometry of the new templates, read from the SOLVED drawing (user y = -world y)
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-3, `${m}: ${a} vs ${b}`);
const J = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: -j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const real = (S, type) => S.state.shapes.filter((x) => x.type === type && !x.isConstruction);
{ // dog-bone pocket: each relief circle passes through its pocket corner, ONE closed loop
  const t = templateById('dog-bone-pocket');
  for (const [w, h, d] of [[60, 40, 6.35], [80, 50, 10]]) {
    const S = solved(t, { width: w, height: h, bitDiameter: d });
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    const arcs = real(S, 'arc');
    assert.strictEqual(arcs.length, 4, 'dog-bone: four relief arcs');
    const used = new Set();
    for (const a of arcs) {
      const K = J(S, a.joints[0]);
      near(dist(K, J(S, a.joints[1])), d / 2, 'relief radius = bit radius');
      const c = corners.map(([x, y]) => dist(K, { x, y }));
      const k = c.findIndex((v) => Math.abs(v - d / 2) < 1e-3);
      assert.ok(k >= 0, 'the relief circle passes through a pocket corner (its centre is one radius from it)');
      used.add(k);
      near(Math.abs(K.x - corners[k][0]), d / 2 / Math.SQRT2, 'centre on the corner diagonal: x offset r / sqrt 2');
      near(Math.abs(K.y - corners[k][1]), d / 2 / Math.SQRT2, 'centre on the corner diagonal: y offset r / sqrt 2');
    }
    assert.strictEqual(used.size, 4, 'dog-bone: one relief per corner');
    const deg = new Map();
    for (const sh of S.state.shapes.filter((x) => !x.isConstruction)) for (const j of (sh.type === 'arc' ? [sh.joints[1], sh.joints[2]] : sh.joints)) deg.set(j, (deg.get(j) || 0) + 1);
    assert.ok([...deg.values()].every((n) => n === 2) && deg.size === 8, 'dog-bone: ONE closed loop (8 joints, each on exactly two pieces)');
  }
}
{ // T-slot: 19 wide x 9.5 deep over 25 wide, 16 deep in all
  const S = solved(templateById('t-slot'));
  const pts = real(S, 'line').flatMap((l) => l.joints).map((j) => J(S, j));
  const at = (y) => pts.filter((p) => Math.abs(p.y - y) < 1e-3).map((p) => p.x);
  const span = (a) => Math.max(...a) - Math.min(...a);
  near(span(at(0)), 19, 'top width'); near(span(at(-9.5)), 25, 'shoulder level: the wide part'); near(span(at(-16)), 25, 'bottom width');
  near(Math.min(...pts.map((p) => p.y)), -16, 'total depth'); near(Math.max(...at(0)) + Math.min(...at(0)), 0, 'centred on the origin');
}
{ // butterfly key: 50 long, 25 at the ends, 10 at the waist, straight sides
  const S = solved(templateById('butterfly-key'));
  const pts = real(S, 'line').flatMap((l) => l.joints).map((j) => J(S, j));
  const at = (x) => pts.filter((p) => Math.abs(p.x - x) < 1e-3).map((p) => p.y);
  near(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), 50, 'length');
  for (const x of [-25, 25]) near(Math.max(...at(x)) - Math.min(...at(x)), 25, 'end width');
  near(Math.max(...at(0)) - Math.min(...at(0)), 10, 'waist width');
  assert.strictEqual(real(S, 'line').length, 6, 'straight sides: six lines');
}
{ // cup hinge bore: 35 cup, two 8 mm holes 45 apart on a line 9.5 from the cup centre
  const S = solved(templateById('cup-hinge-bore'));
  const cs = real(S, 'circle').sort((a, b) => b.radius - a.radius);
  assert.strictEqual(cs.length, 3, 'a cup and two screw holes');
  near(cs[0].radius * 2, 35, 'cup diameter'); near(cs[1].radius * 2, 8, 'screw diameter'); near(cs[2].radius * 2, 8, 'screw diameter');
  const cup = J(S, cs[0].joints[0]), a = J(S, cs[1].joints[0]), b = J(S, cs[2].joints[0]);
  near(dist(a, b), 45, 'screw spacing'); near(Math.abs(a.y - b.y), 0, 'screws on one horizontal line');
  near(Math.abs(cup.y - a.y), 9.5, 'screw line 9.5 mm from the cup centre'); near((a.x + b.x) / 2, cup.x, 'centred on the cup');
}
{ // shelf-pin row: ONE rectangularPattern constraint, five 5 mm holes on 32 mm centres
  const t = templateById('shelf-pin-row'), S = solved(t);
  assert.strictEqual(S.state.constraints.filter((c) => c.type === 'rectangularPattern').length, 1, 'ONE rectangularPattern constraint');
  const cs = real(S, 'circle');
  assert.strictEqual(cs.length, 5, 'five holes');
  const xs = cs.map((c) => J(S, c.joints[0]).x).sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) near(xs[i + 1] - xs[i], 32, 'spacing');
  for (const c of cs) near(c.radius * 2, 5, 'hole diameter');
  const S2 = solved(t, { count: 7, spacing: 40, holeDiameter: 6 });
  const xs2 = real(S2, 'circle').map((c) => J(S2, c.joints[0]).x).sort((a, b) => a - b);
  assert.strictEqual(xs2.length, 7, 'count 7 -> seven holes');
  near(xs2[6] - xs2[0], 240, 'spacing 40 x 6');
  for (const c of real(S2, 'circle')) near(c.radius * 2, 6, 'hole diameter 6');
}
{ // box frame: 2 sides + 2 ends + (N - 1) dividers; sides the overall length, ends / dividers W - 2t, N equal openings
  const t = templateById('box-frame');
  for (const n of [5, 1, 3]) {
    const [Lg, W, th] = [1500, 400, 18], S = solved(t, { compartments: n });
    const lines = real(S, 'line').map((l) => [J(S, l.joints[0]), J(S, l.joints[1])]);
    const sides = lines.filter(([a, b]) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(Math.abs(a.y - b.y) - Lg) < 1e-3);
    assert.strictEqual(sides.length, 2, `N=${n}: two sides, each the overall length`);
    const cross = lines.filter(([a, b]) => Math.abs(a.y - b.y) < 1e-3 && Math.abs(dist(a, b) - (W - 2 * th)) < 1e-3);
    const levels = [...new Set(cross.map(([a]) => Math.round(a.y * 1e3) / 1e3))].sort((a, b) => a - b);
    assert.strictEqual(levels.length / 2, 2 + (n - 1), `N=${n}: board count = 2 ends + ${n - 1} dividers (a bottom and a top edge each, W - 2t long)`);
    const gaps = [], thick = [];
    for (let i = 0; i < levels.length - 1; i++) (i % 2 ? gaps : thick).push(levels[i + 1] - levels[i]);
    for (const x of thick) near(x, th, 'board thickness');
    for (const x of gaps) near(x, (Lg - (n + 1) * th) / n, 'equal compartments');
    assert.strictEqual(gaps.length, n, `N=${n}: ${n} openings`);
    near(levels[0], 0, 'bottom end at 0'); near(levels[levels.length - 1], Lg, 'top end at the overall length');
    const xs = lines.flatMap(([a, b]) => [a.x, b.x]);
    near(Math.max(...xs) - Math.min(...xs), W, 'overall width');
    const keys = lines.map(([a, b]) => [a, b].map((p) => p.x.toFixed(3) + ',' + p.y.toFixed(3)).sort().join('|'));
    assert.strictEqual(new Set(keys).size, keys.length, `N=${n}: no edge drawn twice (the boards share their edges)`);
  }
}
console.log(`templates-node: ${TEMPLATES.length} templates ok`);
