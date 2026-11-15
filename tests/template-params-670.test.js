// tests/template-params-670.test.js -- TASK 670: a template opens with its parameters in the Parameters table.
//   1. every template's LENGTH / ANGLE params are USER PARAMETERS of the opened document (name = snake_case key, value = the default, unit mm / deg,
//      comment = the label); counts, choices and `atOpen` lengths are not (nothing in the drawing could follow them).
//   2. every driving dimension is a FORMULA reading only those parameters, already in the parameter model's canonical text and equal to its value
//      (planChange of its own expression changes nothing); every user parameter is read by at least one dimension (none does nothing).
//   3. the default geometry is IDENTICAL to the code before task 670 (tests/fixtures/templates-default-geometry-670.json, captured on main 788f7f4).
//   4. changing each parameter x1.3 AND x0.7 through THE path (planChange setParameter -> applyParameterChange -> solve) keeps 0 conflicts and 0 DOF
//      and lands EXACTLY on the template built at the new value (no fold); box-frame length 1500 -> 600 too, and the advisor's direct dimension edits.
//   5. box-frame: no board folds (each board's two edges in order, every level in order 0 < ... < length) in both layouts; Horizontal = Vertical
//      mirrored in the diagonal (same boards, side by side); thickness 18 -> 12 changes every board.
//   6. right-angle-corner: for each of the 3 joints the two board polygons equal frame-calc's points (cornerJointPoints + CornerJointGlyph's
//      polygons, computed from the frame-calc source for T 18, lengths 300 / 200), and the sketch's lines are exactly those outlines (seam once).
import assert from 'node:assert';
import fs from 'node:fs';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, buildTemplate, templateById, paramName, paramKind, paramUnit, isLiveParam, paramRefusal, defaultParams } from '#core/templates.js';
import { cornerJointPoints, cornerBoards, CORNER_JOINT_TYPES } from '#core/corner-joint.js';
import { deserializeDocument } from '#core/document.js';
import { planChange, isDimension, isReferenceDimension } from '#core/parameters.js';
import { parseInput, dependencies, validateName } from '#core/expression.js';
import { applyParameterChange } from '#ui/dimension-seams.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
const R = (v) => Math.round(v * 1e6) / 1e6 || 0; // no -0 (deepStrictEqual tells it from 0)
const open = (t, params = {}) => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(t, params))), S.state));
  assert.ok(res.ok, `${t.id}: loads (${res.reason})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${t.id} ${JSON.stringify(params)}: 0 conflicts`);
  return S;
};
const coords = (S) => [...S.state.joints.values()].map((j) => [R(j.x), R(j.y)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const radii = (S) => S.state.shapes.filter((s) => typeof s.radius === 'number').map((s) => R(s.radius)).sort((a, b) => a - b);
// NOTE: the harness engine has ONE module-level store (tests/harness/audit/lib.js): a sketch is read to a plain snapshot BEFORE the next one opens
const geo = (S) => ({ c: coords(S), r: radii(S) });
const sameGeometry = (A, B, m) => {
  const a = A.c, b = B.c;
  assert.strictEqual(a.length, b.length, `${m}: joint count`);
  a.forEach((p, i) => assert.ok(Math.abs(p[0] - b[i][0]) < 1e-3 && Math.abs(p[1] - b[i][1]) < 1e-3, `${m}: joint ${JSON.stringify(p)} vs ${JSON.stringify(b[i])}`));
  const ra = A.r, rb = B.r;
  ra.forEach((r, i) => assert.ok(Math.abs(r - rb[i]) < 1e-3, `${m}: radius ${r} vs ${rb[i]}`));
};
const drivingDims = (S) => S.state.constraints.filter((c) => isDimension(c) && !isReferenceDimension(c));
// THE parameter path: what a parameter edit does (planChange is the model, applyParameterChange the one commit seam), then the solve
const setParameter = (S, name, text) => {
  const plan = planChange(S.state, { type: 'setParameter', name, text });
  assert.ok(plan.ok, `setParameter ${name} = ${text}: ${plan.message}`);
  const res = muted(() => applyParameterChange(S.state, plan, 'change parameter'));
  assert.ok(res.ok, `${name} = ${text} applied (${JSON.stringify(res.culprit || res.clash || '')})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${name} = ${text}: 0 conflicts`);
  return plan;
};
// TASK 672: every joint option of the new frame templates and of the box frame (both layouts) goes through the same checks
const choices = (t, k) => t.params[k].options.map((o) => o.value);
const variants = (t) => {
  if (t.id === 'box-frame') return ['Vertical', 'Horizontal'].flatMap((layout) => choices(t, 'joint').map((joint) => (layout === 'Vertical' && joint === 'V-Through' ? {} : { layout, joint })));
  if (t.id === 'right-angle-corner' || t.id === 'polygon-frame') return choices(t, 'joint').map((joint) => ({ joint }));
  if (t.id === 'right-angle-brace') return choices(t, 'topJoint').flatMap((topJoint) => choices(t, 'blJoint').flatMap((blJoint) => choices(t, 'brJoint').map((brJoint) => ({ topJoint, blJoint, brJoint }))));
  return [{}];
};

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/templates-default-geometry-670.json', import.meta.url), 'utf8'));
let checks = 0;
for (const t of TEMPLATES) {
  // ---- 1. the user parameters
  const doc = buildTemplate(t);
  const live = Object.entries(t.params).filter(([, spec]) => isLiveParam(spec));
  assert.deepStrictEqual(doc.geometry.parameters.map((p) => p.name), live.map(([k]) => paramName(k)), `${t.id}: one user parameter per length / angle param, in order`);
  for (const [k, spec] of live) {
    const p = doc.geometry.parameters.find((x) => x.name === paramName(k));
    assert.ok(validateName(p.name).ok, `${t.id}: ${p.name} is a valid parameter name`);
    assert.ok(/^[a-z][a-z0-9_]*$/.test(p.name), `${t.id}: ${p.name} is readable snake_case`);
    assert.strictEqual(p.unit, paramKind(spec) === 'angle' ? 'deg' : 'mm', `${t.id}: ${p.name} unit`);
    assert.strictEqual(p.comment, spec.label, `${t.id}: ${p.name} comment = its label`);
    checks++;
  }
  for (const [k, spec] of Object.entries(t.params)) if (!isLiveParam(spec)) assert.ok(!doc.geometry.parameters.some((p) => p.name === paramName(k)), `${t.id}: ${k} (${paramKind(spec)}${spec.atOpen ? ', atOpen' : ''}) is NOT in the table: nothing could follow it`);

  for (const extra of variants(t)) {
    const m = `${t.id} ${JSON.stringify(extra)}`;
    const S = open(t, extra);
    assert.strictEqual(L.nullity(S), 0, `${m}: 0 DOF`);
    // the table's values: evaluate the loaded parameters (the same evaluation the Parameters table shows)
    const ev = planChange(S.state, { type: 'setComment', name: S.state.parameters[0].name, comment: S.state.parameters[0].comment });
    assert.ok(ev.ok, `${m}: the parameters evaluate`);
    for (const [k] of live) {
      const p = S.state.parameters.find((x) => x.name === paramName(k));
      assert.strictEqual(p.expression, `${defaultParams(t)[k]} ${paramUnit(t.params[k])}`, `${m}: ${p.name} = its default`);
    }
    // ---- 2. every driving dimension is a formula of the user parameters, canonical and consistent
    const names = new Set(S.state.parameters.map((p) => p.name));
    const read = new Set();
    const dims = drivingDims(S);
    const dimNames = new Map(dims.map((c) => [c.name, c]));
    const reads = (c) => dependencies(parseInput(c.expression, { allowAssign: false }));
    const params = (c, seen = new Set()) => reads(c).flatMap((d) => (names.has(d) ? [d] : seen.has(d) ? [] : (seen.add(d), params(dimNames.get(d), seen)))); // through earlier dimensions
    assert.strictEqual(dims.length, t.dimensions, `${m}: ${t.dimensions} driving dimensions`);
    for (const c of dims) {
      assert.ok(typeof c.expression === 'string' && c.expression, `${m}: dimension ${c.name} has a formula`);
      const deps = reads(c);
      assert.ok(deps.length > 0 && deps.every((d) => names.has(d) || (dimNames.has(d) && d !== c.name)), `${m}: ${c.name} = ${c.expression} reads only user parameters and other driving dimensions`);
      const ps = params(c);
      assert.ok(ps.length > 0, `${m}: ${c.name} = ${c.expression} is a formula of the user parameters (directly or through ${deps})`);
      ps.forEach((d) => read.add(d));
      const plan = planChange(S.state, { type: 'setDimension', name: c.name, text: c.expression });
      assert.ok(plan.ok && plan.edits.length === 0, `${m}: ${c.name} = ${c.expression} is canonical and equals its value ${c.value} (${JSON.stringify(plan.edits && plan.edits.map((e) => [e.name, e.value, e.expression]))})`);
      checks++;
    }
    for (const n of names) assert.ok(read.has(n), `${m}: the user parameter ${n} drives at least one dimension`);
    // ---- 3. the default geometry is the code before task 670 (the new template and the new layout have no "before")
    if (golden[t.id] && !extra.layout && !extra.joint) {
      assert.deepStrictEqual(coords(S), golden[t.id].joints, `${m}: the default joints are identical to main 788f7f4`);
      assert.deepStrictEqual(radii(S), golden[t.id].radii, `${m}: the default radii are identical to main 788f7f4`);
      checks++;
    }
    // ---- 4. every parameter x1.3 and x0.7 through the parameter path = the template built at that value, 0 DOF
    for (const [k] of live) for (const f of [1.3, 0.7]) {
      const E = open(t, extra), v = R(defaultParams(t)[k] * f);
      const plan = setParameter(E, paramName(k), `${v} ${paramUnit(t.params[k])}`);
      assert.ok(plan.solve && plan.affected.length > 0, `${m}: ${paramName(k)} x${f} moves dimensions (${plan.affected})`);
      assert.strictEqual(L.nullity(E), 0, `${m}: ${paramName(k)} x${f}: 0 DOF`);
      sameGeometry(geo(E), geo(open(t, { ...extra, [k]: v })), `${m}: ${paramName(k)} x${f} = the template built at ${v} (no fold)`);
      checks++;
    }
  }
}

// ---- 5. box-frame: the fold the advisor found (length shrunk: the top end board flipped above the top edge). Both layouts.
const boxLevels = (S, horizontal) => { // the cross boards' levels along the long direction (user coordinates), from the inner columns
  const pts = [...S.state.joints.values()].map((j) => ({ x: R(j.x), y: R(-j.y) }));
  const along = (p) => (horizontal ? p.x : p.y), side = (p) => (horizontal ? p.y : p.x);
  const t0 = Math.min(...pts.filter((p) => side(p) > 0).map(side)); // the inner column (x = t in the vertical layout)
  return [...new Set(pts.filter((p) => Math.abs(side(p) - t0) < 1e-6).map(along))];
};
const noFold = (S, horizontal, Lg, th, n, m) => {
  const lv = boxLevels(S, horizontal); // in the order the levels come: must already be sorted and spaced board, opening, board, ...
  assert.strictEqual(lv.length, 2 * (n + 1), `${m}: ${2 * (n + 1)} levels`);
  const sorted = [...lv].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i++) assert.ok(sorted[i + 1] - sorted[i] > 1e-6, `${m}: levels strictly in order (${sorted})`);
  assert.ok(Math.abs(sorted[0]) < 1e-6 && Math.abs(sorted[sorted.length - 1] - Lg) < 1e-6, `${m}: the levels run 0 .. ${Lg} (${sorted[0]} .. ${sorted[sorted.length - 1]})`);
  const g = (Lg - (n + 1) * th) / n;
  for (let k = 0; k <= n; k++) {
    assert.ok(Math.abs(sorted[2 * k + 1] - sorted[2 * k] - th) < 1e-6, `${m}: board ${k} is ${th} thick, its lower edge below its upper edge`);
    if (k < n) assert.ok(Math.abs(sorted[2 * k + 2] - sorted[2 * k + 1] - g) < 1e-6, `${m}: opening ${k} = ${g}`);
  }
  // the boards are inside the frame: every joint between 0 and the overall length along the long direction
  for (const j of S.state.joints.values()) { const a = horizontal ? j.x : -j.y; assert.ok(a > -1e-6 && a < Lg + 1e-6, `${m}: a joint at ${a} is outside the frame`); }
};
{
  const t = templateById('box-frame');
  for (const layout of ['Vertical', 'Horizontal']) {
    const H = layout === 'Horizontal';
    noFold(open(t, { layout }), H, 1500, 18, 5, `${layout} defaults`);
    // the owner's case: the length shrunk through the parameter, 1500 -> 600, and then other values in a row
    const chain = [600, 1200, 900, 750, 591, 400, 2500], got = [];
    const S = open(t, { layout });
    for (const Lg of chain) {
      setParameter(S, 'length', `${Lg} mm`);
      noFold(S, H, Lg, 18, 5, `${layout} length -> ${Lg} (parameter)`);
      got.push(geo(S));
    }
    chain.forEach((Lg, i) => sameGeometry(got[i], geo(open(t, { layout, length: Lg })), `${layout} length -> ${Lg} = built at ${Lg}`));
    // the advisor's repro, through the length DIMENSION's box (previewDimensionInput's planChange setDimension -> applyParameterChange) then solve
    // 500, from the default each time. TASK 672 (owner ruling, turn 1729): no dimension is a "driver" box, every one reads the user parameter, so
    // the box sets the PARAMETER (`length = 1200`, the dimension box's assignment); a plain number would detach that one dimension only
    const typeIntoDimension = (D, expr, text) => {
      const c = drivingDims(D).find((x) => x.expression === expr);
      const plan = planChange(D.state, { type: 'setDimension', name: c.name, text });
      assert.ok(plan.ok && muted(() => applyParameterChange(D.state, plan)).ok, `${layout}: ${c.name} takes ${text}`);
      muted(() => D.engine.solve(500));
    };
    for (const Lg of [1200, 900, 750, 591, 600]) {
      const D = open(t, { layout });
      typeIntoDimension(D, 'length', `length = ${Lg}`);
      noFold(D, H, Lg, 18, 5, `${layout} length dimension -> ${Lg}`);
    }
    const D = open(t, { layout });
    typeIntoDimension(D, 'thickness', 'thickness = 12');
    noFold(D, H, 1500, 12, 5, `${layout} thickness dimension -> 12: every board follows`);
    // five small steps 1500 -> 591
    const F = open(t, { layout });
    for (const Lg of [1318, 1136, 954, 772, 591]) setParameter(F, 'length', `${Lg} mm`);
    noFold(F, H, 591, 18, 5, `${layout} five steps to 591`);
    // thickness 18 -> 12: every board changes
    const T = open(t, { layout });
    setParameter(T, 'thickness', '12 mm');
    noFold(T, H, 1500, 12, 5, `${layout} thickness 12`);
    sameGeometry(geo(T), geo(open(t, { layout, thickness: 12 })), `${layout} thickness 12 = built at 12`);
    for (const n of [1, 2, 3]) noFold(open(t, { layout, compartments: n }), H, 1500, 18, n, `${layout} ${n} compartments`);
  }
  // Horizontal = Vertical mirrored in the diagonal through the origin: (x, y) -> (y, x) in user coordinates, joint by joint (same builder, same ids)
  const V = new Map([...open(t, { compartments: 3 }).state.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));
  const Hz = open(t, { compartments: 3, layout: 'Horizontal' });
  for (const [id, j] of V) {
    const k = Hz.state.joints.get(id);
    assert.ok(k && Math.abs(k.x - -j.y) < 1e-6 && Math.abs(-k.y - j.x) < 1e-6, `Horizontal: joint ${id} is the vertical layout's mirrored (${JSON.stringify([j, k])})`);
  }
  const extent = (S) => { const p = [...(S instanceof Map ? S : S.state.joints).values()]; return [Math.max(...p.map((j) => j.x)) - Math.min(...p.map((j) => j.x)), Math.max(...p.map((j) => -j.y)) - Math.min(...p.map((j) => -j.y))]; };
  assert.deepStrictEqual(extent(Hz).map(R), [1500, 400], 'Horizontal: 1500 wide, 400 tall (the long direction horizontal)');
  assert.deepStrictEqual(extent(V).map(R), [400, 1500], 'Vertical: 400 wide, 1500 tall');
  const lv = boxLevels(Hz, true).sort((a, b) => a - b);
  assert.ok(lv.length === 8 && lv.every((x, i) => i === 0 || x > lv[i - 1]), 'Horizontal: the ends and the dividers stand side by side along x');
  checks++;
}

// ---- 6. right-angle-corner: the frame-calc points (frame-calc shared/utils/geometry.js cornerJointPoints and CornerJointGlyph.js's polygons,
// run on the frame-calc source for ox = oy = 0, hx = vy = 1, T = 18, horizontal board 300 long, vertical board 200 long; frame-calc's Y is down)
const FRAME_CALC = {
  'V-Through': { h: [[18, 0], [300, 0], [300, 18], [18, 18]], v: [[0, 0], [0, 200], [18, 200], [18, 0]] },
  'H-Through': { h: [[0, 0], [300, 0], [300, 18], [0, 18]], v: [[0, 18], [0, 200], [18, 200], [18, 18]] },
  'Miter': { h: [[0, 0], [300, 0], [300, 18], [18, 18]], v: [[0, 0], [0, 200], [18, 200], [18, 18]] },
};
{
  const t = templateById('right-angle-corner');
  assert.deepStrictEqual(CORNER_JOINT_TYPES.map((o) => [o.value, o.label]), [['V-Through', 'Vertical through'], ['H-Through', 'Horizontal through'], ['Miter', 'Mitered']], 'the 3 joint types and their names');
  for (const [type, want] of Object.entries(FRAME_CALC)) {
    const b = cornerBoards(0, 0, 1, 1, 18, 300, 200, type);
    assert.deepStrictEqual({ h: b.h.map((p) => [p.x, p.y]), v: b.v.map((p) => [p.x, p.y]) }, want, `${type}: cornerBoards = frame-calc's polygons`);
    const cj = cornerJointPoints(0, 0, 1, 1, 18, type);
    assert.deepStrictEqual([cj.hOuter, cj.hInner, cj.vOuter, cj.vInner].map((p) => [p.x, p.y]), [want.h[0], want.h[3], want.v[0], want.v[3]], `${type}: cornerJointPoints = frame-calc's`);
    // the sketch: its lines are exactly the two outlines' edges, split at the other board's corners, the seam drawn once (world = frame-calc frame)
    const S = open(t, { joint: type });
    const key = (a, c) => [a, c].map((p) => `${R(p[0])},${R(p[1])}`).sort().join('|');
    const corners = [...want.h, ...want.v];
    const expected = new Set();
    for (const poly of [want.h, want.v]) poly.forEach((a, i) => {
      const c = poly[(i + 1) % 4], dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy;
      const on = corners.filter((q) => Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) < 1e-9).map((q) => [q, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2])
        .filter(([, u]) => u > -1e-9 && u < 1 + 1e-9).sort((p, q) => p[1] - q[1]).map(([q]) => q);
      const uniq = on.filter((q, k) => k === 0 || q[0] !== on[k - 1][0] || q[1] !== on[k - 1][1]);
      for (let k = 0; k + 1 < uniq.length; k++) expected.add(key(uniq[k], uniq[k + 1]));
    });
    const lines = S.state.shapes.filter((s) => s.type === 'line').map((s) => s.joints.map((id) => { const j = S.state.joints.get(id); return [j.x, j.y]; }));
    const got = lines.map(([a, c]) => key(a, c));
    assert.strictEqual(new Set(got).size, got.length, `${type}: no edge drawn twice (the seam is shared)`);
    assert.deepStrictEqual([...got].sort(), [...expected].sort(), `${type}: the sketch is exactly frame-calc's two board outlines`);
    assert.strictEqual(L.nullity(S), 0, `${type}: 0 DOF`);
    checks++;
  }
  // the miter seam is the 45 degree diagonal from the outer corner to the inner corner, at any thickness
  const S = open(t, { joint: 'Miter' });
  setParameter(S, 'thickness', '30 mm');
  const diag = S.state.shapes.filter((s) => s.type === 'line').map((s) => s.joints.map((id) => S.state.joints.get(id))).find(([a, c]) => Math.abs(a.x - c.x) > 1e-6 && Math.abs(a.y - c.y) > 1e-6);
  assert.ok(diag && Math.abs(Math.abs(diag[0].x - diag[1].x) - 30) < 1e-6 && Math.abs(Math.abs(diag[0].y - diag[1].y) - 30) < 1e-6, 'Miter at thickness 30: the seam runs from (0, 0) to (30, 30)');
}

// ---- the start modal's value rule (the ONE rule; buildTemplate refuses what it refuses)
{
  const box = templateById('box-frame'), pins = templateById('shelf-pin-row'), corner = templateById('right-angle-corner');
  assert.strictEqual(paramRefusal(box.params.width, 0), 'Width must be a number more than 0');
  assert.strictEqual(paramRefusal(box.params.width, 'abc'), 'Width must be a number more than 0');
  assert.strictEqual(paramRefusal(box.params.width, 12.5), null);
  assert.strictEqual(paramRefusal(box.params.compartments, 2.5), 'Compartments must be a whole number');
  assert.strictEqual(paramRefusal(box.params.compartments, 0), 'Compartments must be from 1 to 100');
  assert.strictEqual(paramRefusal(pins.params.count, 1), 'Holes must be from 2 to 100');
  assert.strictEqual(paramRefusal(corner.params.joint, 'Dovetail'), 'Corner joint: pick one of the options');
  assert.strictEqual(paramRefusal(box.params.layout, 'Horizontal'), null);
  assert.throws(() => buildTemplate(box, { thickness: -3 }), /Plywood thickness must be a number more than 0/);
  // a count / an atOpen length chosen at open builds that drawing (the shelf-pin spacing and count are the pattern's values)
  const P = open(pins, { count: 7, spacing: 40 });
  assert.strictEqual(P.state.shapes.filter((s) => s.type === 'circle').length, 7, 'shelf pins: 7 holes');
  assert.deepStrictEqual(P.state.parameters.map((p) => p.name), ['hole_diameter'], 'shelf pins: only the hole diameter is a live parameter');
}
console.log(`template-params-670: ${TEMPLATES.length} templates, ${checks} checks ok`);
