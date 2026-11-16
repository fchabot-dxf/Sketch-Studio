// tests/templates-674.test.js -- TASK 674: frame-calc's other frames become templates (trapezoid, parallelogram, any triangle) and every frame
// template takes a joint PER CORNER, against the owner's frame-calc (fchabot-dxf/triangular-frame-calc @ b59816f: tests/fixtures/frame-calc-674.json,
// made ONCE by running the frame-calc source, its sha in the file).
//   1. the PORTS (#core/frame-geometry.js) give frame-calc's numbers: mapTrapezoidVertices + computeEffectiveOffset (every variant) +
//      trapezoidSetbacks, mapParallelogramVertices, solveArbitraryTriangle (every case), obliqueTriangleVertices; THE per-vertex engine
//      (calculatePolygonFrameGeometry) on those vertices = frame-calc's boards for every joint list (the trapezoid / parallelogram: the quad
//      engine; the triangle: frame-calc's own oblique calculator, through obliqueVertexJoints; the polygon frame with a joint per vertex: the
//      regular and the quad engine)
//   2. the SKETCHES are exactly frame-calc's boards (every solid line a piece of a board edge, each once, after the solve, in mm), 0 conflicts,
//      0 DOF: trapezoid (2 input sets x 4 variants x 14 joint lists), parallelogram (2 x 14), triangle (2 x 27), polygon frame and box frame
//      (both layouts) with a joint per corner; the defaults are among them (the geometry at its defaults solves to the authored joints)
//   3. a per-corner pick changes ONLY that corner's two boards (frame-calc's boards for that joint list: the others identical)
//   4. every live param x1.3 and x0.7 through THE parameter path: the solved sketch is frame-calc's boards at the new value (no board folds:
//      every board keeps its outline and orientation), 0 DOF; each new template, each variant, each joint for all, and mixed joint lists
//   5. corners(): every frame template's declared corners are joints of its drawing (the start modal's glyphs sit on real corners), as many as
//      the frame has; fitCorners follows a count; per-corner lists and `when` params through the one value rule
import assert from 'node:assert';
import fs from 'node:fs';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, buildTemplate, templateById, defaultParams, paramRefusal, paramName, templateCorners, fitCorners } from '#core/templates.js';
import {
  calculatePolygonFrameGeometry, regularPolygonVertices, mapTrapezoidVertices, trapezoidSetbacks, computeEffectiveOffset, TRAPEZOID_VARIANTS,
  mapParallelogramVertices, solveArbitraryTriangle, obliqueTriangleVertices, obliqueVertexJoints, BRACE_JOINTS, POLYGON_JOINT_TYPES,
} from '#core/frame-geometry.js';
import { cornerJointPoints } from '#core/corner-joint.js';
import { deserializeDocument } from '#core/document.js';
import { planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/frame-calc-674.json', import.meta.url), 'utf8'));
assert.strictEqual(FX.source, 'fchabot-dxf/triangular-frame-calc @ b59816f', 'the fixtures come from frame-calc b59816f');
const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
const open = (t, params = {}) => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(t, params))), S.state));
  assert.ok(res.ok, `${t.id}: loads (${res.reason})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${t.id} ${JSON.stringify(params)}: 0 conflicts`);
  return S;
};
const near = (a, b, m, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`);
const samePoints = (got, want, m, tol = 1e-9) => { assert.strictEqual(got.length, want.length, m + ': point count'); got.forEach((p, i) => { near(p[0], want[i][0], m + ` [${i}].x`, tol); near(p[1], want[i][1], m + ` [${i}].y`, tol); }); };
const sortPts = (list) => [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const xy = (p) => [p.x, p.y];
const boardPts = (b) => [b.p1, b.p2, b.p3, b.p4].map(xy);
const variantOf = (trapVariant, rightSide) => TRAPEZOID_VARIANTS.find((o) => o.trapVariant === trapVariant && (trapVariant !== 'right' || o.rightSide === rightSide)).value;
let checks = 0;

// ---- 1. the ports = frame-calc
for (const c of FX.trapezoid) {
  const { bottomWidth, topWidth, height, thick, trapVariant, rightSide, freeOffset, joints } = c.inputs, m = `trapezoid ${JSON.stringify(c.inputs)}`;
  const offset = computeEffectiveOffset({ trapVariant, rightSide, bottomWidth, topWidth, freeOffset });
  near(offset, c.offset, m + ': computeEffectiveOffset');
  assert.deepStrictEqual(trapezoidSetbacks({ bottomWidth, topWidth, offset }), c.setbacks, m + ': trapezoidSetbacks');
  const P = mapTrapezoidVertices({ bottomWidth, topWidth, height, offset });
  samePoints(P.map(xy), c.P, m + ': mapTrapezoidVertices');
  const g = calculatePolygonFrameGeometry({ P, thick, joints });
  g.boards.forEach((b, k) => samePoints(boardPts(b), c.boards[k], `${m}: board ${k} = calculateQuadFrameGeometry's`, 1e-12));
  checks++;
}
for (const c of FX.parallelogram) {
  const { base, side, angleA, thick, joints } = c.inputs, m = `parallelogram ${JSON.stringify(c.inputs)}`;
  const P = mapParallelogramVertices({ base, side, angleA });
  samePoints(P.map(xy), c.P, m + ': mapParallelogramVertices', 1e-12);
  calculatePolygonFrameGeometry({ P, thick, joints }).boards.forEach((b, k) => samePoints(boardPts(b), c.boards[k], `${m}: board ${k}`, 1e-12));
  checks++;
}
for (const c of FX.solve) {
  const got = solveArbitraryTriangle(c.triplet);
  if (c.solved === null) assert.strictEqual(got, null, `solveArbitraryTriangle ${JSON.stringify(c.triplet)}: no triangle`);
  else for (const k of ['a', 'b', 'c', 'A', 'B', 'C']) near(got[k], c.solved[k], `solveArbitraryTriangle ${JSON.stringify(c.triplet)} ${k}`, 1e-12);
  checks++;
}
for (const c of FX.triangle) { // the oblique calculator's boards = THE engine's on [P1, P3, P2] (boards A = P1 P3, C = P3 P2, B = P2 P1), as point sets
  const { a, b, c: cc, thick, jointA, jointB, jointC } = c.inputs, m = `triangle ${JSON.stringify(c.inputs)}`;
  const s = solveArbitraryTriangle([{ key: 'a', val: a }, { key: 'b', val: b }, { key: 'c', val: cc }]);
  for (const k of ['a', 'b', 'c', 'A', 'B', 'C']) near(s[k], c.solved[k], `${m}: solved ${k}`, 1e-12);
  const { P1, P2, P3 } = obliqueTriangleVertices(s);
  samePoints([P1, P2, P3].map(xy), [c.P1, c.P2, c.P3], m + ': obliqueTriangleVertices', 1e-12);
  const g = calculatePolygonFrameGeometry({ P: [P1, P3, P2], thick, joints: obliqueVertexJoints({ jointA, jointB, jointC }) });
  [c.A, c.C, c.B].forEach((want, k) => samePoints(sortPts(boardPts(g.boards[k])), sortPts(want), `${m}: board ${'ACB'[k]} = calculateObliqueFramingGeometry's`, 1e-9));
  checks++;
}
for (const c of FX.polygon) {
  const { N, sideLength, thick, joints } = c.inputs, m = `polygon N ${N} ${joints}`;
  const g = calculatePolygonFrameGeometry({ P: regularPolygonVertices(N, sideLength), thick, joints });
  g.boards.forEach((b, k) => { samePoints(boardPts(b), c.quad[k], `${m}: board ${k} = the quad engine's`, 1e-12); samePoints(boardPts(b), c.regular[k], `${m}: board ${k} = the regular engine's`, 1e-9); });
  checks++;
}

// ---- 2. the sketches = frame-calc's boards
const K = (p) => `${Math.round(p[0] * 1e4) / 1e4},${Math.round(p[1] * 1e4) / 1e4}`;
const edgeKey = (a, b) => [K(a), K(b)].sort().join('|');
function boardPieces(polys) { // the board outlines -> every edge split at the corners lying on it, each piece once (tests/templates-672.test.js)
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
const trapezoid = templateById('trapezoid-frame'), parallelogram = templateById('parallelogram-frame'), triangle = templateById('triangle-frame');
const polygonFrame = templateById('polygon-frame'), boxFrame = templateById('box-frame');
const trapParams = (i) => ({ bottomWidth: i.bottomWidth, topWidth: i.topWidth, height: i.height, thickness: i.thick, setbackLeft: i.setbackLeft, variant: variantOf(i.trapVariant, i.rightSide), joint: i.joints });
for (const c of FX.trapezoid) sameDrawing(open(trapezoid, trapParams(c.inputs)), c.boards, `trapezoid frame ${JSON.stringify(c.inputs)}`); // frame-calc's frame = world (the bottom's middle on the origin)
for (const c of FX.parallelogram) {
  const { base, side, angleA, thick, joints } = c.inputs;
  sameDrawing(open(parallelogram, { base, side, angle: angleA, thickness: thick, joint: joints }), c.boards, `parallelogram frame ${JSON.stringify(c.inputs)}`);
}
const triParams = (i) => ({ base: i.b, leftSide: i.a, rightSide: i.c, thickness: i.thick, jointA: i.jointA, jointB: i.jointB, jointC: i.jointC });
for (const c of FX.triangle) sameDrawing(open(triangle, triParams(c.inputs)), [c.A, c.B, c.C], `triangle frame ${JSON.stringify(c.inputs)}`);
for (const c of FX.polygon) {
  const { N, sideLength, thick, joints } = c.inputs;
  sameDrawing(open(polygonFrame, { sides: N, sideLength, thickness: thick, joint: joints }), c.regular, `polygon frame N ${N} ${joints}`);
}
const boxList = (cj) => [cj.BL, cj.BR, cj.TR, cj.TL]; // the template's corner order (bottom-left, bottom-right, top-right, top-left) <- frame-calc's names
for (const c of FX.box) { // frame-calc's stud-layout frame (origin top-left, Y down) = the vertical layout moved; the horizontal one mirrored in its diagonal
  const { frameWidth: W, frameHeight: Lg, frameThickness: th, compartments, cornerJoints } = c.inputs;
  const vertical = c.boards.map((b) => b.map(([x, y]) => [x, y - Lg])), horizontal = vertical.map((b) => b.map(([x, y]) => [-y, -x]));
  const p = { length: Lg, width: W, thickness: th, compartments, joint: boxList(cornerJoints) };
  sameDrawing(open(boxFrame, p), vertical, `box frame ${JSON.stringify(c.inputs)} Vertical`);
  sameDrawing(open(boxFrame, { ...p, layout: 'Horizontal' }), horizontal, `box frame ${JSON.stringify(c.inputs)} Horizontal`);
}
// the box frame with ONE joint for all four corners is the box frame of task 672 (the same points as before, list or not)
for (const j of ['V-Through', 'H-Through', 'Miter']) {
  const pts = (doc) => doc.geometry.joints.map(([, q]) => [q.x, q.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepStrictEqual(pts(buildTemplate(boxFrame, { joint: [j, j, j, j] })), pts(buildTemplate(boxFrame, { joint: j })), `box frame: [${j} x 4] = ${j} for all`);
  checks++;
}

// ---- 3. a per-corner pick changes only that corner's boards (frame-calc's boards: from all Miter / all V-Through, one corner changed)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const singles = (cases, base) => cases.filter((c) => c.inputs.joints.filter((j) => j !== base).length === 1);
for (const [name, cases] of [['trapezoid', FX.trapezoid], ['parallelogram', FX.parallelogram]]) {
  for (const c of singles(cases, 'Miter')) {
    const k = c.inputs.joints.findIndex((j) => j !== 'Miter');
    const ref = cases.find((x) => same({ ...x.inputs, joints: null }, { ...c.inputs, joints: null }) && x.inputs.joints.every((j) => j === 'Miter'));
    c.boards.forEach((b, i) => {
      const touches = i === k || i === (k + 3) % 4; // board k starts at corner k, board k - 1 ends there
      assert.strictEqual(same(b, ref.boards[i]), !touches, `${name} ${c.inputs.joints}: board ${i} ${touches ? 'changes' : 'is unchanged'} (corner ${k} picked)`);
    });
    checks++;
  }
}
const FX672 = JSON.parse(fs.readFileSync(new URL('./fixtures/frame-calc-672.json', import.meta.url), 'utf8')); // task 672's: one joint for all corners
for (const c of FX.box.filter((x) => Object.values(x.inputs.cornerJoints).filter((j) => j !== 'V-Through').length === 1)) {
  const corner = Object.keys(c.inputs.cornerJoints).find((k) => c.inputs.cornerJoints[k] !== 'V-Through');
  const { frameWidth, frameHeight, frameThickness, compartments } = c.inputs;
  const ref = FX672.box.find((x) => same(x.inputs, { frameWidth, frameHeight, frameThickness, compartments, joint: 'V-Through' }));
  // frame-calc's boards: top plate, bottom plate, left jamb, right jamb, rails; a corner touches one plate and one jamb
  const touch = { TL: [0, 2], TR: [0, 3], BL: [1, 2], BR: [1, 3] }[corner];
  c.boards.forEach((b, i) => assert.strictEqual(same(b, ref.boards[i]), !touch.includes(i), `box ${corner} ${c.inputs.cornerJoints[corner]}: board ${i} ${touch.includes(i) ? 'changes' : 'is unchanged'}`));
  checks++;
}
for (const corner of ['jointA', 'jointB', 'jointC']) { // the triangle: a corner's joint moves only the two boards meeting there (frame-calc's)
  const base = FX.triangle.find((x) => x.inputs.a === 500 && x.inputs.jointA === 'Miter' && x.inputs.jointB === 'Miter' && x.inputs.jointC === 'Miter');
  for (const c of FX.triangle.filter((x) => x.inputs.a === 500 && ['jointA', 'jointB', 'jointC'].every((k) => (k === corner ? x.inputs[k] !== 'Miter' : x.inputs[k] === 'Miter')))) {
    const touch = { jointA: ['A', 'B'], jointB: ['B', 'C'], jointC: ['A', 'C'] }[corner];
    for (const b of ['A', 'B', 'C']) assert.strictEqual(same(c[b], base[b]), !touch.includes(b), `triangle ${corner} ${c.inputs[corner]}: board ${b} ${touch.includes(b) ? 'changes' : 'is unchanged'}`);
    checks++;
  }
}

// ---- 4. every live param x1.3 / x0.7 through the parameter path: the sketch = frame-calc's boards at that value (THE engine, = frame-calc above)
const R = (v) => Math.round(v * 1e6) / 1e6 || 0;
const setParameter = (S, name, text) => {
  const plan = planChange(S.state, { type: 'setParameter', name, text });
  assert.ok(plan.ok, `setParameter ${name} = ${text}: ${plan.message}`);
  const res = muted(() => applyParameterChange(S.state, plan, 'change parameter'));
  assert.ok(res.ok, `${name} = ${text} applied (${JSON.stringify(res.clash || res.culprit || '')})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${name} = ${text}: 0 conflicts`);
};
const boardsAt = { // the template's boards at values v (world): THE engine on frame-calc's vertices, placed as the template places them
  'trapezoid-frame': (v) => {
    const o = TRAPEZOID_VARIANTS.find((x) => x.value === v.variant);
    const offset = computeEffectiveOffset({ trapVariant: o.trapVariant, rightSide: o.rightSide, bottomWidth: v.bottomWidth, topWidth: v.topWidth, freeOffset: v.setbackLeft - (v.bottomWidth - v.topWidth) / 2 });
    const joints = Array.isArray(v.joint) ? v.joint : Array(4).fill(v.joint);
    return calculatePolygonFrameGeometry({ P: mapTrapezoidVertices({ bottomWidth: v.bottomWidth, topWidth: v.topWidth, height: v.height, offset }), thick: v.thickness, joints }).boards.map(boardPts);
  },
  'parallelogram-frame': (v) => calculatePolygonFrameGeometry({ P: mapParallelogramVertices({ base: v.base, side: v.side, angleA: v.angle }), thick: v.thickness, joints: Array.isArray(v.joint) ? v.joint : Array(4).fill(v.joint) }).boards.map(boardPts),
  'triangle-frame': (v) => {
    const { P1, P2, P3 } = obliqueTriangleVertices(solveArbitraryTriangle([{ key: 'a', val: v.leftSide }, { key: 'b', val: v.base }, { key: 'c', val: v.rightSide }]));
    return calculatePolygonFrameGeometry({ P: [P1, P3, P2], thick: v.thickness, joints: obliqueVertexJoints(v) }).boards.map(boardPts);
  },
};
const paramCases = [
  ...TRAPEZOID_VARIANTS.flatMap((o) => POLYGON_JOINT_TYPES.map((j) => [trapezoid, { variant: o.value, joint: j.value }])),
  ...TRAPEZOID_VARIANTS.map((o) => [trapezoid, { variant: o.value, joint: ['CW-Through', 'Miter', 'CCW-Through', 'CW-Through'] }]),
  ...POLYGON_JOINT_TYPES.map((j) => [parallelogram, { joint: j.value }]),
  [parallelogram, { joint: ['Miter', 'CCW-Through', 'CW-Through', 'CCW-Through'] }], [parallelogram, { joint: ['CW-Through', 'CW-Through', 'Miter', 'CCW-Through'] }],
  ...['Miter', 'V-Through'].flatMap((a) => BRACE_JOINTS.br.map((b) => [triangle, { jointA: a, jointB: b.value, jointC: 'Miter' }])),
  ...BRACE_JOINTS.top.map((cj) => [triangle, { jointA: 'H-Through', jointB: 'D-Through', jointC: cj.value }]),
];
for (const [t, extra] of paramCases) {
  const v0 = { ...defaultParams(t), ...extra };
  const S0 = open(t, extra);
  sameDrawing(S0, boardsAt[t.id](v0), `${t.id} ${JSON.stringify(extra)} at its defaults`);
  for (const p of S0.state.parameters) {
    const key = Object.keys(t.params).find((k) => paramName(k) === p.name);
    for (const f of [1.3, 0.7]) {
      const v = R(v0[key] * f), m = `${t.id} ${JSON.stringify(extra)} ${p.name} x${f}`;
      const E = open(t, extra);
      setParameter(E, p.name, `${v} ${p.unit}`);
      sameDrawing(E, boardsAt[t.id]({ ...v0, [key]: v }), `${m} (no fold)`);
    }
  }
}

// ---- 5. corners(): the start modal's corner glyphs sit on the drawing's corners; counts; the value rule
const cornerCases = [
  [templateById('right-angle-corner'), {}, 1], [templateById('right-angle-brace'), {}, 3], [templateById('right-angle-brace'), { width: 450, height: 380 }, 3],
  [polygonFrame, {}, 6], [polygonFrame, { sides: 3 }, 3], [polygonFrame, { sides: 12, sideLength: 150 }, 12],
  [boxFrame, {}, 4], [boxFrame, { layout: 'Horizontal', compartments: 2 }, 4],
  ...TRAPEZOID_VARIANTS.map((o) => [trapezoid, { variant: o.value }, 4]), [parallelogram, { angle: 110 }, 4], [parallelogram, {}, 4], [triangle, {}, 3], [triangle, { base: 300, leftSide: 700, rightSide: 520 }, 3],
];
for (const [t, extra, n] of cornerCases) {
  const m = `${t.id} ${JSON.stringify(extra)}`, list = templateCorners(t, extra), doc = buildTemplate(t, extra);
  assert.strictEqual(list.length, n, `${m}: ${n} corners`);
  const joints = doc.geometry.joints.map(([, q]) => q);
  for (const c of list) {
    assert.ok(joints.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 1e-6), `${m}: corner (${c.x}, ${c.y}) is a point of the drawing`);
    assert.ok(Math.abs(Math.hypot(c.out.x, c.out.y) - 1) < 1e-9 && c.interior > 0 && c.interior < 180, `${m}: a unit outward direction and an interior angle`);
    assert.ok(t.params[c.param] && t.params[c.param].kind === 'choice', `${m}: corner bound to the choice ${c.param}`);
    if (t.params[c.param].perCorner) assert.ok(Number.isInteger(c.index), `${m}: a per-corner choice's corner has its index`);
  }
  checks++;
}
for (const t of TEMPLATES) if (!['right-angle-corner', 'right-angle-brace', 'polygon-frame', 'box-frame', 'trapezoid-frame', 'parallelogram-frame', 'triangle-frame'].includes(t.id)) assert.deepStrictEqual(templateCorners(t), [], `${t.id}: no corners (not a frame)`);
// the corner's outward direction: frame-calc's rule (away from the corners' centroid; TrapezoidCanvasView.js)
{
  const list = templateCorners(trapezoid), cx = list.reduce((s, c) => s + c.x, 0) / 4, cy = list.reduce((s, c) => s + c.y, 0) / 4;
  for (const c of list) near(Math.atan2(c.out.y, c.out.x), Math.atan2(c.y - cy, c.x - cx), 'trapezoid: out = away from the centroid');
  assert.deepStrictEqual(list.map((c) => R(c.interior)), calculatePolygonFrameGeometry({ P: list, thick: 38, joints: [] }).interiorAnglesDeg.map(R), 'trapezoid: each corner its interior angle');
}
// the box frame's corners keep their index in the Horizontal layout (the same board corner, mirrored)
{
  const v = templateCorners(boxFrame), h = templateCorners(boxFrame, { layout: 'Horizontal' });
  v.forEach((c, k) => { near(h[k].x, -c.y, `box corner ${k}: mirrored x`); near(h[k].y, -c.x, `box corner ${k}: mirrored y`); });
  const user = (c) => [c.x, -c.y || 0];
  assert.deepStrictEqual(v.map(user), [[0, 0], [400, 0], [400, 1500], [0, 1500]], 'box corners: bottom-left, bottom-right, top-right, top-left');
  const cj = cornerJointPoints(400, 1500, -1, -1, 18, 'Miter');
  assert.ok(cj.hOuter.x === 400 && cj.hOuter.y === 1500, 'box corner 2 is the top-right corner the builder joins');
  checks++;
}
// fitCorners: counts change -> the corner list follows (kept entries first, new corners take the option last set for all)
{
  const list = ['CW-Through', 'Miter', 'CCW-Through', 'Miter', 'Miter', 'CW-Through'];
  assert.deepStrictEqual(fitCorners(polygonFrame, { ...defaultParams(polygonFrame), sides: 8, joint: list }, { joint: 'CCW-Through' }).joint, [...list, 'CCW-Through', 'CCW-Through'], 'sides 6 -> 8: two corners added');
  assert.deepStrictEqual(fitCorners(polygonFrame, { ...defaultParams(polygonFrame), sides: 4, joint: list }).joint, list.slice(0, 4), 'sides 6 -> 4: the first four kept');
  assert.deepStrictEqual(fitCorners(polygonFrame, { ...defaultParams(polygonFrame), sides: 9, joint: list }).joint.slice(6), ['Miter', 'Miter', 'Miter'], 'no option set for all: the default');
  assert.strictEqual(fitCorners(polygonFrame, { ...defaultParams(polygonFrame), sides: 4 }).joint, 'Miter', 'one option for all stays one option');
  checks++;
}
// the value rule: a per-corner list of options; a list of the wrong length cannot be drawn; `when`: the scalene setback
{
  const spec = polygonFrame.params.joint;
  assert.strictEqual(paramRefusal(spec, ['Miter', 'CW-Through']), null, 'a list of options is a value');
  assert.strictEqual(paramRefusal(spec, ['Miter', 'Dovetail']), 'Corner joint: pick one of the options', 'every entry must be an option');
  assert.strictEqual(paramRefusal(spec, []), 'Corner joint: pick one of the options', 'an empty list is not a value');
  assert.strictEqual(paramRefusal(templateById('right-angle-corner').params.joint, ['Miter']), 'Corner joint: pick one of the options', 'a choice not declared per corner takes one option only');
  assert.throws(() => buildTemplate(polygonFrame, { joint: ['Miter', 'Miter'] }), /Polygon frame cannot be drawn with these values \(2 corner joints for 6 corners\)/);
  const names = (extra) => buildTemplate(trapezoid, extra).geometry.parameters.map((p) => p.name);
  assert.deepStrictEqual(names({}), ['bottom_width', 'top_width', 'height', 'thickness'], 'isosceles: no setback parameter');
  assert.deepStrictEqual(names({ variant: 'scalene' }), ['bottom_width', 'top_width', 'height', 'setback_left', 'thickness'], 'scalene: its left setback is a user parameter');
  assert.doesNotThrow(() => buildTemplate(trapezoid, { setbackLeft: -5 }), 'a param that does not apply is not checked');
  assert.throws(() => buildTemplate(trapezoid, { variant: 'scalene', setbackLeft: -5 }), /Left setback must be a number more than 0/);
  assert.throws(() => buildTemplate(triangle, { leftSide: 100, rightSide: 100 }), /Triangle frame cannot be drawn with these values \(these three sides make no triangle/);
  assert.throws(() => buildTemplate(parallelogram, { angle: 190 }), /Parallelogram frame cannot be drawn with these values \(the angle must be less than 180 degrees\)/);
  checks++;
}
console.log(`templates-674: ${checks} checks ok`);
