// tests/templates-672.test.js -- TASK 672: four more templates (stair stringer, curved bench seat, right-angle brace, polygon frame) and the box
// frame's corner joint, against the owner's frame-calc (fchabot-dxf/triangular-frame-calc @ b59816f: tests/fixtures/frame-calc-672.json, made
// ONCE by running the frame-calc source, its sha in the file).
//   1. the PORTS (#core/frame-geometry.js) give frame-calc's numbers: calculateFramingGeometry (every joint combination, two input sets),
//      calculatePolygonFrameGeometry on regularPolygonVertices = BOTH calculatePolygonFramingGeometry's and calculateQuadFrameGeometry's
//      boards (N 3..12, each joint), cornerJointPoints (each corner, each joint)
//   2. the SKETCHES are exactly frame-calc's boards: every solid line is a piece of a board edge split at the board corners on it, each once,
//      after the solve, in mm (brace: 27 joint combinations x 2 input sets; polygon frame: N 3..12 x 3 joints; box frame: 4 input sets x 3
//      joints x both layouts), 0 conflicts and 0 DOF each
//   3. no fold in the polygon frame at other N: side length and thickness x1.3 / x0.7 through the parameter path = built at that value (the
//      task 670 test, tests/template-params-670.test.js, does every live param of every template and every joint option at the default N)
//   4. stair stringer and curved bench seat: their geometry from the solved drawing (steps, cuts, throat, board; arcs, identical slats, gaps)
//   5. (owner ruling, turn 1729: no dimension is a "driver" box) EVERY template's every driving dimension reads only USER PARAMETERS and numbers,
//      never another dimension's name (d1, d2, ...), in every joint / layout option
//   6. (owner, turn 1732: "template dimension should be offset further away") EVERY template's every linear dimension label (where the canvas
//      draws it: #core/dim-label.js frame, mid + normal * offset) is at least the rule's distance (dimensionGap: 15 % of the larger side, at
//      least 10 mm) from every solid line, circle and arc of the outline, in every choice option; and no two labels of a side share a spot
import assert from 'node:assert';
import fs from 'node:fs';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, buildTemplate, templateById, defaultParams, dimensionGap, DIM_FRACTION, DIM_FLOOR } from '#core/templates.js';
import { resolveDimEndpoints, linearDimFrame } from '#core/dim-label.js';
import { arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { parseInput, dependencies } from '#core/expression.js';
import { calculateFramingGeometry, calculatePolygonFrameGeometry, regularPolygonVertices, BRACE_JOINTS, POLYGON_JOINT_TYPES } from '#core/frame-geometry.js';
import { cornerJointPoints, CORNER_JOINT_TYPES } from '#core/corner-joint.js';
import { deserializeDocument } from '#core/document.js';
import { planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/frame-calc-672.json', import.meta.url), 'utf8'));
assert.strictEqual(FX.source, 'fchabot-dxf/triangular-frame-calc @ b59816f', 'the fixtures come from frame-calc b59816f');
const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
const open = (t, params = {}) => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(t, params))), S.state));
  assert.ok(res.ok, `${t.id}: loads (${res.reason})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${t.id} ${JSON.stringify(params)}: 0 conflicts`);
  return S;
};
const near = (a, b, m, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`);
const samePoints = (got, want, m, tol = 1e-9) => { assert.strictEqual(got.length, want.length, m + ': point count'); got.forEach((p, i) => { near(p[0], want[i][0], m + ` [${i}].x`, tol); near(p[1], want[i][1], m + ` [${i}].y`, tol); }); };
const xy = (p) => [p.x, p.y];
let checks = 0;

// ---- 1. the ports = frame-calc
for (const c of FX.brace) {
  const g = calculateFramingGeometry(c.inputs), m = `calculateFramingGeometry ${JSON.stringify(c.inputs)}`;
  samePoints(Object.values(g.points.V).map(xy), c.V, m + ' V'); samePoints(Object.values(g.points.H).map(xy), c.H, m + ' H'); samePoints(Object.values(g.points.D).map(xy), c.D, m + ' D');
  checks++;
}
for (const c of FX.polygon) {
  const { N, sideLength, thick, joint } = c.inputs, m = `polygon N ${N} ${joint}`;
  const P = regularPolygonVertices(N, sideLength);
  samePoints(P.map(xy), c.P, m + ': regularPolygonVertices = calculatePolygonFramingGeometry P');
  const g = calculatePolygonFrameGeometry({ P, thick, joints: Array(N).fill(joint) });
  g.boards.forEach((b, k) => {
    const pts = [b.p1, b.p2, b.p3, b.p4].map(xy);
    samePoints(pts, c.quad[k], `${m}: board ${k} = calculateQuadFrameGeometry's`, 1e-12);
    samePoints(pts, c.regular[k], `${m}: board ${k} = calculatePolygonFramingGeometry's (the regular engine)`, 1e-9);
  });
  checks++;
}
for (const c of FX.corners) {
  const { ox, oy, hx, vy, T, joint } = c.inputs, p = cornerJointPoints(ox, oy, hx, vy, T, joint);
  assert.deepStrictEqual([p.hOuter, p.hInner, p.vOuter, p.vInner].map(xy), [c.hOuter, c.hInner, c.vOuter, c.vInner], `cornerJointPoints ${JSON.stringify(c.inputs)}`);
  checks++;
}
assert.deepStrictEqual(Object.fromEntries(Object.entries(BRACE_JOINTS).map(([k, o]) => [k, o.map((x) => x.value)])),
  { top: ['V-Through', 'D-Through', 'Miter'], bl: ['V-Through', 'H-Through', 'Miter'], br: ['H-Through', 'D-Through', 'Miter'] }, "the brace's joint options per corner, frame-calc's order");
assert.deepStrictEqual(POLYGON_JOINT_TYPES.map((o) => [o.value, o.label]), [['CW-Through', 'Clockwise Through'], ['CCW-Through', 'Counter-Clockwise Through'], ['Miter', 'Mitered Joint']], "the polygon joints, frame-calc's names");

// ---- 2. the sketches = frame-calc's boards (world = frame-calc's frame moved: solid lines, each a piece of a board edge, after the solve)
const K = (p) => `${Math.round(p[0] * 1e4) / 1e4},${Math.round(p[1] * 1e4) / 1e4}`;
const edgeKey = (a, b) => [K(a), K(b)].sort().join('|');
// the board outlines -> every edge split at the corners lying on it, each piece once (the drawing frame-calc's boards make)
function boardPieces(polys) {
  const corners = [];
  for (const poly of polys) for (const q of poly) if (!corners.some((c) => Math.hypot(c[0] - q[0], c[1] - q[1]) < 1e-6)) corners.push(q);
  const out = new Set();
  for (const poly of polys) poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return;
    const on = corners.filter((q) => Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / Math.sqrt(l2) < 1e-6)
      .map((q) => [q, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2]).filter(([, u]) => u > -1e-9 && u < 1 + 1e-9).sort((p, q) => p[1] - q[1]).map(([q]) => q);
    for (let k = 0; k + 1 < on.length; k++) out.add(edgeKey(on[k], on[k + 1]));
  });
  return out;
}
const solidLines = (S) => S.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction).map((s) => s.joints.map((id) => { const j = S.state.joints.get(id); return [j.x, j.y]; }));
const sameDrawing = (S, polys, m) => {
  const got = solidLines(S).map(([a, b]) => edgeKey(a, b));
  assert.strictEqual(new Set(got).size, got.length, `${m}: no edge drawn twice (shared seams once)`);
  assert.deepStrictEqual([...got].sort(), [...boardPieces(polys)].sort(), `${m}: the sketch is exactly frame-calc's boards`);
  assert.strictEqual(L.nullity(S), 0, `${m}: 0 DOF`);
  checks++;
};
{ // the right-angle brace: frame-calc's frame has the apex at (0, 0) and the right angle at (0, H); the template's origin is that corner
  const t = templateById('right-angle-brace');
  for (const c of FX.brace) {
    const { width, height, thickV, thickH, thickD, topJoint, blJoint, brJoint } = c.inputs;
    const S = open(t, { width, height, thickV, thickH, thickD, topJoint, blJoint, brJoint });
    sameDrawing(S, [c.V, c.H, c.D].map((b) => b.map(([x, y]) => [x, y - height])), `brace ${JSON.stringify(c.inputs)}`);
  }
}
{ // the polygon frame: centred on the origin as frame-calc's
  const t = templateById('polygon-frame');
  for (const c of FX.polygon) {
    const { N, sideLength, thick, joint } = c.inputs;
    sameDrawing(open(t, { sides: N, sideLength, thickness: thick, joint }), c.regular, `polygon frame N ${N} ${joint}`);
  }
}
{ // the box frame: frame-calc's stud-layout frame (origin top-left, Y down) = the vertical layout (origin bottom-left); the horizontal layout is
  // the vertical one mirrored in its diagonal (user (x, y) -> (y, x))
  const t = templateById('box-frame');
  for (const c of FX.box) {
    const { frameWidth: W, frameHeight: Lg, frameThickness: th, compartments, joint } = c.inputs;
    const vertical = c.boards.map((b) => b.map(([x, y]) => [x, y - Lg])); // world y = -user y = frame-calc y - Lg
    const horizontal = vertical.map((b) => b.map(([x, y]) => [-y, -x])); // world (x, y) = user (x, -y) -> user (-y, x) -> world (-y, -x)
    sameDrawing(open(t, { length: Lg, width: W, thickness: th, compartments, joint }), vertical, `box frame ${JSON.stringify(c.inputs)} Vertical`);
    sameDrawing(open(t, { length: Lg, width: W, thickness: th, compartments, joint, layout: 'Horizontal' }), horizontal, `box frame ${JSON.stringify(c.inputs)} Horizontal`);
  }
  // every joint has the same 14 dimensions (2 N + 4), the ones of today's box frame
  for (const o of CORNER_JOINT_TYPES) {
    const S = open(t, { joint: o.value });
    assert.strictEqual(S.state.constraints.filter((x) => x.type === 'distance' && !x.isDriven).length, 14, `box frame ${o.value}: 14 dimensions`);
    assert.deepStrictEqual(S.state.parameters.map((p) => p.name), ['length', 'width', 'thickness'], `box frame ${o.value}: the same user parameters`);
  }
  // the default is today's build: 'V-Through' (the sides run the full length), the joint changes nothing else
  assert.strictEqual(t.params.joint.default, 'V-Through', 'box frame: the default joint is Vertical through');
  const pts = (doc) => doc.geometry.joints.map(([, j]) => [j.x, j.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); // TASK 680: ids are minted per build
  assert.deepStrictEqual(pts(buildTemplate(t)), pts(buildTemplate(t, { joint: 'V-Through' })), 'box frame: the default = Vertical through');
}

// ---- 3. the polygon frame at other N: no fold for side length / thickness x1.3, x0.7 (the task 670 path)
const R = (v) => Math.round(v * 1e6) / 1e6 || 0;
const coords = (S) => [...S.state.joints.values()].map((j) => [R(j.x), R(j.y)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const setParameter = (S, name, text) => {
  const plan = planChange(S.state, { type: 'setParameter', name, text });
  assert.ok(plan.ok, `setParameter ${name} = ${text}: ${plan.message}`);
  assert.ok(muted(() => applyParameterChange(S.state, plan, 'change parameter')).ok, `${name} = ${text} applied`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${name} = ${text}: 0 conflicts`);
};
{
  const t = templateById('polygon-frame');
  for (const N of [3, 4, 5, 8, 12]) for (const o of POLYGON_JOINT_TYPES) for (const [k, name] of [['sideLength', 'side_length'], ['thickness', 'thickness']]) for (const f of [1.3, 0.7]) {
    const v = R(defaultParams(t)[k] * f), m = `polygon N ${N} ${o.value} ${name} x${f}`;
    const E = open(t, { sides: N, joint: o.value });
    setParameter(E, name, `${v} mm`);
    assert.strictEqual(L.nullity(E), 0, `${m}: 0 DOF`);
    const want = coords(open(t, { sides: N, joint: o.value, [k]: v })), got = coords(E);
    assert.strictEqual(got.length, want.length, m + ': joints');
    got.forEach((p, i) => assert.ok(Math.abs(p[0] - want[i][0]) < 1e-3 && Math.abs(p[1] - want[i][1]) < 1e-3, `${m}: = built at ${v} (no fold): ${p} vs ${want[i]}`));
    checks++;
  }
}

// ---- 4. the stair stringer and the curved bench seat, read from the solved drawing (user y = -world y)
const U = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: -j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lineDist = (p, a, b) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / dist(a, b);
const loopOk = (S, m) => { // ONE closed outline: every POINT of the solid pieces on exactly two of them
  // TASK 680: drawn with the tools, a piece's end is its own joint tied to the next piece's by a coincident: a point = joints joined by coincidents
  const point = new Map();
  const root = (j) => { while (point.has(j) && point.get(j) !== j) j = point.get(j); return j; };
  for (const c of S.state.constraints.filter((k) => k.type === 'coincident')) { const [a, b] = c.joints.map(root); if (a !== b) point.set(a < b ? b : a, a < b ? a : b); }
  const deg = new Map();
  for (const sh of S.state.shapes.filter((x) => !x.isConstruction)) for (const j of (sh.type === 'arc' ? [sh.joints[1], sh.joints[2]] : sh.joints)) deg.set(root(j), (deg.get(root(j)) || 0) + 1);
  assert.ok([...deg.values()].every((n) => n === 2), `${m}: closed outlines (each point on two pieces)`);
};
{
  const t = templateById('stair-stringer');
  for (const p of [{}, { steps: 2 }, { steps: 7, rise: 175, run: 280, boardWidth: 300, throat: 110 }]) {
    const v = { ...defaultParams(t), ...p }, m = `stringer ${JSON.stringify(p)}`, S = open(t, p);
    assert.strictEqual(L.nullity(S), 0, `${m}: 0 DOF`);
    const lines = S.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction).map((s) => s.joints.map((id) => U(S, id)));
    const ver = lines.filter(([a, b]) => Math.abs(a.x - b.x) < 1e-6), hor = lines.filter(([a, b]) => Math.abs(a.y - b.y) < 1e-6);
    const risers = ver.filter(([a, b]) => Math.abs(Math.abs(a.y - b.y) - v.rise) < 1e-6), treads = hor.filter(([a, b]) => a.y > 1e-6 && Math.abs(Math.abs(a.x - b.x) - v.run) < 1e-6);
    assert.strictEqual(risers.length, v.steps, `${m}: ${v.steps} risers, each ${v.rise}`);
    assert.strictEqual(treads.length, v.steps, `${m}: ${v.steps} treads, each ${v.run}`);
    const tops = treads.map(([a]) => a.y).sort((a, b) => a - b);
    tops.forEach((y, k) => near(y, (k + 1) * v.rise, `${m}: tread ${k + 1} level`));
    const level = hor.filter(([a, b]) => Math.abs(a.y) < 1e-6 && Math.abs(b.y) < 1e-6);
    assert.strictEqual(level.length, 1, `${m}: one level cut on the floor`);
    const plumb = ver.filter(([a, b]) => Math.abs(a.x - v.steps * v.run) < 1e-6);
    assert.strictEqual(plumb.length, 1, `${m}: one plumb cut, at the back of the last tread`);
    near(Math.max(...plumb[0].map((q) => q.y)), v.steps * v.rise, `${m}: the plumb cut starts at the top tread`);
    const slanted = lines.filter(([a, b]) => Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6);
    assert.strictEqual(slanted.length, 1, `${m}: one lower edge`);
    const [la, lb] = slanted[0];
    near((lb.y - la.y) / (lb.x - la.x), v.rise / v.run, `${m}: the lower edge parallel to the pitch`);
    for (let k = 1; k <= v.steps; k++) near(lineDist({ x: k * v.run, y: k * v.rise }, la, lb), v.throat, `${m}: the throat under inner corner ${k}`);
    near(lineDist({ x: 0, y: 0 }, la, lb), v.throat, `${m}: the throat under the first riser's foot`);
    const board = S.state.shapes.filter((s) => s.isConstruction).map((s) => s.joints.map((id) => U(S, id))).find(([a, b]) => Math.abs(lineDist(a, la, lb) - v.boardWidth) < 1e-6 && Math.abs(lineDist(b, la, lb) - v.boardWidth) < 1e-6);
    assert.ok(board, `${m}: the board's top edge, board width from the lower edge`);
    loopOk(S, m);
    checks++;
  }
}
{
  const t = templateById('curved-bench-seat');
  for (const p of [{}, { slats: 2 }, { slats: 5, outerRadius: 1500, innerRadius: 1100, sweepAngle: 40, gap: 8 }, { slats: 12, sweepAngle: 150 }]) {
    const v = { ...defaultParams(t), ...p }, n = v.slats, m = `bench seat ${JSON.stringify(p)}`, S = open(t, p);
    assert.strictEqual(L.nullity(S), 0, `${m}: 0 DOF`);
    const C = { x: 0, y: 0 };
    const arcs = S.state.shapes.filter((s) => s.type === 'arc'), lines = S.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
    assert.strictEqual(arcs.length, 2 * n, `${m}: the ring's edges are ${2 * n} real arcs`);
    assert.strictEqual(lines.length, 2 * n, `${m}: two straight sides per slat, nothing else (no polyline)`);
    const rad = arcs.map((a) => dist(U(S, a.joints[0]), U(S, a.joints[1])));
    for (const r of rad) assert.ok(Math.abs(r - v.outerRadius) < 1e-6 || Math.abs(r - v.innerRadius) < 1e-6, `${m}: an arc of radius ${r}`);
    for (const a of arcs) { near(dist(U(S, a.joints[0]), U(S, a.joints[1])), dist(U(S, a.joints[0]), U(S, a.joints[2])), `${m}: arc ends on one circle`); assert.ok(dist(U(S, a.joints[0]), C) < 1e-6, `${m}: arcs about the centre`); }
    // every side gap / 2 from the centre: each slat between two radial lines, its sides parallel to them, gap / 2 in
    const sides = lines.map((s) => s.joints.map((id) => U(S, id)));
    for (const [a, b] of sides) near(lineDist(C, a, b), v.gap / 2, `${m}: a side gap / 2 from the centre`);
    // identical slats: sorted corner-to-corner distances of each slat equal
    const slatOf = (k) => { const A = sides[2 * k], B = sides[2 * k + 1]; return [dist(A[0], A[1]), dist(B[0], B[1]), dist(A[1], B[1]), dist(A[0], B[0]), dist(A[1], B[0]), dist(A[0], B[1])].map((x) => Math.round(x * 1e5) / 1e5); };
    const s0 = slatOf(0);
    for (let k = 1; k < n; k++) assert.deepStrictEqual(slatOf(k), s0, `${m}: slat ${k} is slat 0`);
    // each gap a parallel strip `gap` wide
    for (let k = 0; k + 1 < n; k++) {
      const B = sides[2 * k + 1], A = sides[2 * k + 2];
      near(((B[1].x - B[0].x) * (A[1].y - A[0].y) - (B[1].y - B[0].y) * (A[1].x - A[0].x)) / (dist(...B) * dist(...A)), 0, `${m}: gap ${k} sides parallel`);
      near(lineDist(A[0], B[0], B[1]), v.gap, `${m}: gap ${k} is ${v.gap} wide`);
    }
    // the sweep: the angle between the two end sides; the seat symmetric about the Y axis
    const dir = ([a, b]) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    near(dir(sides[2 * n - 1]) - dir(sides[0]), v.sweepAngle, `${m}: the sweep between the end sides`);
    const xs = sides.flat().map((q) => q.x);
    near(Math.max(...xs) + Math.min(...xs), 0, `${m}: symmetric about the Y axis`);
    assert.ok(sides.flat().every((q) => q.y > 0), `${m}: the seat above the centre`);
    loopOk(S, m);
    checks++;
  }
}
// ---- 5. every dimension reads the user parameters directly
for (const t of TEMPLATES) {
  const opts = Object.entries(t.params).filter(([, spec]) => spec.kind === 'choice').flatMap(([k, spec]) => spec.options.map((o) => ({ [k]: o.value })));
  for (const extra of [{}, ...opts]) {
    const g = buildTemplate(t, extra).geometry, params = new Set(g.parameters.map((p) => p.name));
    const dims = g.constraints.filter((c) => (c.type === 'distance' || c.type === 'angle') && !c.isDriven && !c.driven);
    const dimNames = new Set(dims.map((c) => c.name));
    for (const c of dims) {
      const deps = dependencies(parseInput(c.expression, { allowAssign: false }));
      assert.ok(deps.length > 0 && deps.every((d) => params.has(d) && !dimNames.has(d)), `${t.id} ${JSON.stringify(extra)}: ${c.name} = ${c.expression} reads only user parameters (${[...params]}), no dimension`);
      checks++;
    }
  }
}
// ---- 6. the dimension placement rule
assert.deepStrictEqual([DIM_FRACTION, DIM_FLOOR], [0.15, 10], 'the rule: 15 % of the larger side, at least 10 mm');
const segDist = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy); };
for (const t of TEMPLATES) {
  const opts = Object.entries(t.params).filter(([, spec]) => spec.kind === 'choice').flatMap(([k, spec]) => spec.options.map((o) => ({ [k]: o.value })));
  for (const extra of [{}, ...opts]) {
    const g = buildTemplate(t, extra).geometry, J = new Map(g.joints), solid = g.shapes.filter((x) => !x.isConstruction);
    const gap = dimensionGap(J, g.shapes), m = `${t.id} ${JSON.stringify(extra)}`;
    const outlineDist = (p) => Math.min(...solid.map((sh) => {
      const P = sh.joints.map((id) => J.get(id));
      if (sh.type === 'line') return segDist(p, P[0], P[1]);
      const d = Math.hypot(p.x - P[0].x, p.y - P[0].y);
      if (sh.type === 'circle') return Math.abs(d - sh.radius);
      const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
      return angleInArcSweep(arcSweepInfo(P[0], P[1], P[2], { sweep: sh.sweep }), Math.atan2(p.y - P[0].y, p.x - P[0].x)) ? Math.abs(d - r) : Math.min(Math.hypot(p.x - P[1].x, p.y - P[1].y), Math.hypot(p.x - P[2].x, p.y - P[2].y));
    }));
    const labels = [];
    for (const c of g.constraints.filter((x) => x.type === 'distance' && !x.isRadius && !x.isDriven)) {
      const { j1, j2 } = resolveDimEndpoints(c, J, g.shapes), f = linearDimFrame(c, j1, j2);
      const at = { x: f.mid.x + f.nx * c.offset, y: f.mid.y + f.ny * c.offset };
      const d = outlineDist(at);
      assert.ok(d >= gap - 1e-6, `${m}: ${c.name}'s label is ${d.toFixed(2)} from the outline, the rule says at least ${gap.toFixed(2)}`);
      assert.ok(!labels.some((q) => Math.hypot(q.x - at.x, q.y - at.y) < 1e-6), `${m}: ${c.name}'s label on another one`);
      labels.push(at);
      checks++;
    }
  }
}
console.log(`templates-672: ${checks} checks ok`);
