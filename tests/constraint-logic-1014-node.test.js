// tests/constraint-logic-1014-node.test.js — TASK 1014 fail-first & regression suite:
//   UX-21: conflict in one component must not block constraints/dims on unrelated components
//   UX-02: shrinking 500x40 rect width to 4 mm must not falsely trigger 1% collapse rule
//   B-11:  Coincident on an arc's own centre or endpoints refuses identically to a line (no bogus pointOnLine)
//   B-17:  Tangent tie rule (circle:sized + line:free, tie:"second") moves second-picked shape
//   B-16:  Double-clicking a pattern label in Dimension tool opens the pattern dialog like Select tool

import assert from 'node:assert/strict';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { findLabel, labelEl } from './helpers/node-dom-read.js';

const boxOpen = (app) => {
  const el = app.document.getElementById('dimInput');
  return !!(el && !el.classList.contains('hidden'));
};
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';
import SettingsManager from '#core/settings-manager.js';
import { showNotification } from '#ui/notification-manager.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const realLog = console.log;
async function quiet(fn) {
  console.log = () => {};
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.log = realLog; console.warn = w; }
}

function makeDoc(joints, shapes, constraints = [], parameters = []) {
  return {
    version: 3,
    hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
      constraints,
      parameters,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1',
      groups: [],
      profiles: [],
    },
  };
}

async function openDoc(doc, { centre = { x: 40, y: 20 }, w = 260 } = {}) {
  const profile = await createProfile();
  let app;
  await quiet(async () => {
    await createNamedDesign(profile, 'sketchstudio', 'Task 1014', doc);
    app = await open({ host: 'sketchstudio', profile, width: 1600, height: 900 });
  });
  setConstraintNotifier(showNotification);
  app.tool('select');
  const st = app.state;
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();
  return app;
}

function readToasts(app) {
  return [...app.document.querySelectorAll('#notification-container [data-level]')]
    .map((el) => `[${el.dataset.level}] ${el.textContent.trim().replace(/\s+/g, ' ')}`)
    .filter(Boolean);
}

function clearToasts(app) {
  for (const el of app.document.querySelectorAll('#notification-container [data-level]')) el.remove();
}

async function clickWorld(app, x, y) {
  const p = app.toScreen(x, y);
  await quiet(async () => { app.move(p.x, p.y); app.down(p.x, p.y); app.up(p.x, p.y); });
}

// ---------------------------------------------------------------------------
// 1. UX-21: Conflict on triangle must NOT block unrelated free geometry
// ---------------------------------------------------------------------------
{
  const doc = makeDoc(
    { a: [0, 0, true], b: [50, 0], c: [25, 30], p: [0, 80], q: [40, 95], r: [0, 120], s: [30, 120] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'a'] },
      { id: 'L4', type: 'line', joints: ['p', 'q'] },
      { id: 'L5', type: 'line', joints: ['r', 's'] },
    ],
    [
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a', 'b'] },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 50, name: 'd1' },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['b', 'c'], value: 40, name: 'd2' },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['c', 'a'], value: 120, name: 'd3' },
    ],
  );
  const app = await openDoc(doc, { centre: { x: 40, y: 50 }, w: 300 });
  await quiet(async () => { app.state.engine.solve(500); });
  clearToasts(app);

  // Horizontal on unrelated L4 succeeds and satisfies L4
  const hRes = await quiet(async () => ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: ['p', 'q'] }, { source: 'toolbar' }));
  assert.ok(hRes, 'UX-21: Horizontal on unrelated L4 must succeed despite triangle conflict');
  assert.equal(readToasts(app).length, 0, 'UX-21: no over-constrained toast on unrelated L4');
  const jp = app.state.joints.get('p'), jq = app.state.joints.get('q');
  assert.ok(Math.abs(jp.y - jq.y) < 1e-4, `UX-21: L4 must be horizontal (|dy|=${Math.abs(jp.y - jq.y)})`);

  // Driving dimension on unrelated L5 succeeds as driving (not demoted to reference)
  const dRes = await quiet(async () => ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['r', 's'], value: 45, name: 'd4' }, { source: 'toolbar' }));
  assert.ok(dRes && !dRes.isDriven && !dRes.driven, 'UX-21: Distance on unrelated L5 stays driving');
  assert.ok(measureResidual(dRes, app.state.joints, app.state.shapes) < 1e-4, 'UX-21: L5 distance converged');

  // Conflicting constraint directly on L4 itself MUST still be refused
  clearToasts(app);
  const vRes = await quiet(async () => ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.VERTICAL, { joints: ['p', 'q'] }, { source: 'toolbar' }));
  assert.equal(vRes, null, 'UX-21: conflicting Vertical on already-Horizontal L4 must still be refused');
  await app.close();
}

// ---------------------------------------------------------------------------
// 2. UX-02: Shrinking 500x40 rectangle width to 4 mm succeeds (not collapse)
// ---------------------------------------------------------------------------
{
  const doc = makeDoc(
    { a: [0, 0, true], b: [500, 0], c: [500, 40], d: [0, 40] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'd'] },
      { id: 'L4', type: 'line', joints: ['d', 'a'] },
    ],
    [
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a', 'b'] },
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['d', 'c'] },
      { type: CONSTRAINT_TYPES.VERTICAL, joints: ['b', 'c'] },
      { type: CONSTRAINT_TYPES.VERTICAL, joints: ['a', 'd'] },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 500, dimMode: 'horizontal', offset: -30, name: 'd1' },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['b', 'c'], value: 40, dimMode: 'vertical', offset: 30, name: 'd2' },
    ],
  );
  const app = await openDoc(doc, { centre: { x: 250, y: 20 }, w: 700 });
  const d1 = app.state.constraints.find((c) => c.name === 'd1');
  clearToasts(app);
  const editRes = await quiet(async () => commitDimensionEdit(app.state, d1, 4));
  assert.equal(editRes.reverted, false, `UX-02: shrinking 500x40 -> 4 must succeed (reason=${editRes.reason})`);
  assert.equal(d1.value, 4, 'UX-02: d1.value updated to 4');
  const ja = app.state.joints.get('a'), jb = app.state.joints.get('b');
  const jc = app.state.joints.get('c'), jd = app.state.joints.get('d');
  assert.ok(Math.abs(Math.hypot(jb.x - ja.x, jb.y - ja.y) - 4) < 1e-4, 'UX-02: top side L1 shrunk to 4');
  assert.ok(Math.abs(Math.hypot(jc.x - jd.x, jc.y - jd.y) - 4) < 1e-4, 'UX-02: opposite side L3 shrunk to 4');
  await app.close();
}

// ---------------------------------------------------------------------------
// 3. B-11: Coincident on an arc's own endpoint or centre refuses like a line
// ---------------------------------------------------------------------------
{
  const makeArcDoc = () => makeDoc(
    { a: [0, 0], b: [60, 0], ac: [120, 0], as: [150, 0], ae: [120, 30], fp: [160, 40] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
    ],
    [{ type: CONSTRAINT_TYPES.EQUAL, joints: ['ac', 'as', 'ac', 'ae'] }],
  );

  // Arc own end
  {
    const app = await openDoc(makeArcDoc(), { centre: { x: 90, y: 15 }, w: 280 });
    const polCount = () => app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE).length;
    app.tool('coincident');
    clearToasts(app);
    await clickWorld(app, 120 + 30 * Math.SQRT1_2, 30 * Math.SQRT1_2);
    await clickWorld(app, 150, 0);
    assert.equal(polCount(), 0, 'B-11: Coincident on arc rim + arc own end must NOT add pointOnLine');
    assert.ok(readToasts(app).some((t) => /over constrained/i.test(t)), `B-11: arc own end must announce over constrained, got ${JSON.stringify(readToasts(app))}`);
    await app.close();
  }

  // Arc own centre
  {
    const app = await openDoc(makeArcDoc(), { centre: { x: 90, y: 15 }, w: 280 });
    const polCount = () => app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE).length;
    app.tool('coincident');
    clearToasts(app);
    await clickWorld(app, 120 + 30 * Math.SQRT1_2, 30 * Math.SQRT1_2);
    await clickWorld(app, 120, 0);
    assert.equal(polCount(), 0, 'B-11: Coincident on arc rim + arc own centre must NOT add pointOnLine');
    assert.ok(readToasts(app).some((t) => /over constrained/i.test(t)), `B-11: arc own centre must announce over constrained, got ${JSON.stringify(readToasts(app))}`);
    await app.close();
  }

  // External free point onto arc rim STILL succeeds
  {
    const app = await openDoc(makeArcDoc(), { centre: { x: 90, y: 15 }, w: 280 });
    const polCount = () => app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE).length;
    app.tool('coincident');
    clearToasts(app);
    await clickWorld(app, 160, 40);
    await clickWorld(app, 120 + 30 * Math.SQRT1_2, 30 * Math.SQRT1_2);
    assert.equal(polCount(), 1, 'B-11: free point onto arc still adds pointOnLine');
    await app.close();
  }
}

// ---------------------------------------------------------------------------
// 4. B-17: Tangent tie (line:free + circle:sized -> tie:"second" moves 2nd pick)
// ---------------------------------------------------------------------------
{
  const runOrder = async (order, extraConstraints) => {
    const doc = makeDoc(
      { a: [0, 0], b: [60, 0], cc: [30, 45] },
      [
        { id: 'L1', type: 'line', joints: ['a', 'b'] },
        { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 },
      ],
      extraConstraints,
    );
    const app = await openDoc(doc, { centre: { x: 30, y: 20 }, w: 220 });
    const p0 = {
      a: { ...app.state.joints.get('a') },
      b: { ...app.state.joints.get('b') },
      cc: { ...app.state.joints.get('cc') },
    };
    app.tool('tangent');
    if (order === 'L-then-C') {
      await clickWorld(app, 30, 0);
      await clickWorld(app, 50, 45);
    } else {
      await clickWorld(app, 50, 45);
      await clickWorld(app, 30, 0);
    }
    const ja = app.state.joints.get('a'), jb = app.state.joints.get('b'), jcc = app.state.joints.get('cc');
    const lineMoved = Math.max(Math.hypot(ja.x - p0.a.x, ja.y - p0.a.y), Math.hypot(jb.x - p0.b.x, jb.y - p0.b.y));
    const circleMoved = Math.hypot(jcc.x - p0.cc.x, jcc.y - p0.cc.y);
    const tanC = app.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.TANGENT);
    const res = tanC ? measureResidual(tanC, app.state.joints, app.state.shapes) : Infinity;
    await app.close();
    return { lineMoved, circleMoved, res, hasTan: !!tanC };
  };

  // Same-tier tie: line:free + circle:sized -> second pick moves
  const sizedExtra = [{ type: CONSTRAINT_TYPES.DISTANCE, shape: 'C1', value: 20, isRadius: true, name: 'd1' }];
  const lThenC = await runOrder('L-then-C', sizedExtra);
  assert.ok(lThenC.hasTan && lThenC.res < 1e-4, 'B-17 L-then-C converged');
  assert.ok(lThenC.circleMoved > 1 && lThenC.lineMoved < 1e-4, `B-17 L-then-C tie must move 2nd pick (circle): ${JSON.stringify(lThenC)}`);

  const cThenL = await runOrder('C-then-L', sizedExtra);
  assert.ok(cThenL.hasTan && cThenL.res < 1e-4, 'B-17 C-then-L converged');
  assert.ok(cThenL.lineMoved > 1 && cThenL.circleMoved < 1e-4, `B-17 C-then-L tie must move 2nd pick (line): ${JSON.stringify(cThenL)}`);

  // Tier difference: line:free (tier 0) + circle:free (tier 1) -> line ALWAYS moves
  const freeLC = await runOrder('L-then-C', []);
  const freeCL = await runOrder('C-then-L', []);
  assert.ok(freeLC.lineMoved > 1 && freeLC.circleMoved < 1e-4, `B-17 free L-then-C moves line: ${JSON.stringify(freeLC)}`);
  assert.ok(freeCL.lineMoved > 1 && freeCL.circleMoved < 1e-4, `B-17 free C-then-L moves line: ${JSON.stringify(freeCL)}`);
}

// ---------------------------------------------------------------------------
// 5. B-16: Pattern label double-click matches Select tool in Dimension tool
// ---------------------------------------------------------------------------
{
  const doc = makeDoc({ a: [0, 0], b: [20, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  const app = await openDoc(doc, { centre: { x: 30, y: 10 }, w: 220 });
  const pr = await quiet(async () => applyPattern(
    app.state,
    CONSTRAINT_TYPES.RECTANGULAR_PATTERN,
    { shapes: ['L1'], joints: [] },
    { ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [30, 10] },
  ));
  app.frames();
  const idx = app.state.constraints.indexOf(pr.constraint);
  const lbl = () => app.svg.querySelector(`.pattern-label[data-constraint-idx="${idx}"], .dim-label[data-constraint-idx="${idx}"]`);
  const gp = pr.constraint.glyphPos;
  const p = app.toScreen(gp.x, gp.y);

  // Dimension tool double-click -> opens pattern dialog, NOT numeric dim input
  app.tool('dim');
  await app.pause(550);
  await quiet(async () => { app.dblclick(p.x, p.y, { target: lbl }); });
  assert.equal(boxOpen(app), false, 'B-16: Dimension tool dblclick on pattern label must NOT open #singleInput');
  assert.equal(app.state.pattern && app.state.pattern.step, 'values', `B-16: Dimension tool dblclick must open pattern values dialog (got ${JSON.stringify(app.state.pattern)})`);

  app.esc();
  await app.pause(550);

  // Select tool parity check
  app.tool('select');
  await quiet(async () => { app.dblclick(p.x, p.y, { target: lbl }); });
  assert.equal(boxOpen(app), false, 'B-16: Select tool dblclick on pattern label does not open #singleInput');
  assert.equal(app.state.pattern && app.state.pattern.step, 'values', 'B-16: Select tool opens pattern values dialog');
  await app.close();
}

console.log('constraint-logic-1014-node: ok');
