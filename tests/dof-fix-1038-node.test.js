// TASK 1038: the solver / glyph bugs of the recipe parity audit 1037 (docs/RECIPE-PARITY-1037.md, appendix N-A, N-B, N-C and D-7;
// BUG-380..383). Each part draws through the app's own tools in the node kit (tests/helpers/node-app.js) or builds the smallest engine
// case, and asserts the TRUE degrees of freedom (counted by hand in each comment) against the solver's nullspace, which is what the Design
// panel shows (analyzeConstraintStatus().dof = engine.jointFreedom().nullity).
//   N-A  a branch-locked perpendicular that holds exactly is a real row (a 3-point rectangle as built: DOF 5, was 8)
//   N-B  an arc-arc tangent at a shared end is a real row (two arcs: DOF 7, was 8; and it keeps its side: external / internal)
//   N-C  a tangent between two circles / arcs (and a line-circle tangent stored as shapes) draws its glyph
//   D-7  a new arc slot has Fusion's 4 tangents (DOF 5, none redundant); a saved 3-tangent slot loads exactly and solves
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { createEngine } from '#core/constraint-solver.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { unsatisfiedConstraints } from '#core/constraint-verifier.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { showNotification } from '#ui/notification-manager.js';
import { glyphAt } from '#ui/hover-manager.js';

setConstraintNotifier(showNotification); // as apps/sketchstudio/main.js: a redundant / over-constrained notice would show
await loadGlyphSheetFromDisk(); // task 603: a glyph is picked where its icon is drawn
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
const DEG = Math.PI / 180;

// ------------------------------------------------------------------------------------------------ engine cases
function engineWith(points, shapes, constraints) {
  const engine = createEngine(null); engine.init();
  const id = {};
  for (const [name, x, y, fixed] of points) { id[name] = engine.genJ(); engine.addJoint(id[name], x, y, !!fixed); }
  for (const s of shapes) engine.addShape({ ...s, joints: s.joints.map((n) => id[n]) });
  for (const c of constraints) engine.addConstraint(c.joints ? { ...c, joints: c.joints.map((n) => id[n]) } : c);
  return { engine, id };
}
const at = (engine, id) => engine.getJoints().get(id);

{ // N-A: L1 fixed along X, L2 free (4 unknowns) and exactly perpendicular to it: the perpendicular takes 1, true DOF 3 (was 4: a zero row)
  for (const branch of [1, -1]) {
    const { engine } = engineWith([['a', 0, 0, true], ['b', 10, 0, true], ['c', 20, 5], ['d', 20, 5 + 8 * branch]],
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
      [{ type: 'perpendicular', shapes: ['L1', 'L2'], branch }]);
    check(engine.jointFreedom().nullity === 3, `N-A perpendicular branch ${branch}, exactly perpendicular: DOF ${engine.jointFreedom().nullity} (true 3)`);
  }
  // the branch is still kept: from 60 deg, branch +1 lands on +90 and branch -1 (the other half-plane) on -90
  for (const [branch, want] of [[1, 90], [-1, -90]]) {
    const { engine, id } = engineWith([['a', 0, 0, true], ['b', 10, 0, true], ['c', 20, 5, true], ['d', 20 + 8 * Math.cos(60 * DEG), 5 + 8 * Math.sin(60 * DEG)]],
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
      [{ type: 'perpendicular', shapes: ['L1', 'L2'], branch }]);
    const r = engine.solve(200);
    const c = at(engine, id.c), d = at(engine, id.d);
    const deg = Math.atan2(d.y - c.y, d.x - c.x) / DEG;
    check(r.converged && Math.abs(deg - want) < 1e-3, `N-A perpendicular branch ${branch} from 60 deg: converged ${r.converged}, at ${deg.toFixed(4)} deg (want ${want})`);
  }
}

{ // N-B: arc 1 (centre C1, rim s1, P) and arc 2 (centre C2, P, rim e2) share P; each arc's equal + the tangent: 10 unknowns - 3 rows = DOF 7
  const arcs = (c2x, r2, branch) => engineWith([['C1', 0, 0], ['s1', 0, 10], ['P', 10, 0], ['C2', c2x, 0], ['e2', c2x, r2]],
    [{ id: 'A1', type: 'arc', joints: ['C1', 's1', 'P'] }, { id: 'A2', type: 'arc', joints: ['C2', 'P', 'e2'] }],
    [{ type: 'equal', joints: ['C1', 's1', 'C1', 'P'] }, { type: 'equal', joints: ['C2', 'P', 'C2', 'e2'] }, { type: 'tangent', shapes: ['A1', 'A2'], branch }]);
  for (const [branch, c2x] of [['external', 15], ['internal', 5]]) {
    const { engine } = arcs(c2x, 5, branch);
    check(engine.jointFreedom().nullity === 7, `N-B arc-arc tangent ${branch} at a shared end: DOF ${engine.jointFreedom().nullity} (true 7)`);
  }
  // the line-arc shared end (the fillet's form, already regular) is unchanged: C, s1, P, A = 8 unknowns - equal - tangent = 6
  const { engine: la } = engineWith([['C', 0, 0], ['s1', 0, 10], ['P', 10, 0], ['A', 10, -10]],
    [{ id: 'A1', type: 'arc', joints: ['C', 's1', 'P'] }, { id: 'L1', type: 'line', joints: ['A', 'P'] }],
    [{ type: 'equal', joints: ['C', 's1', 'C', 'P'] }, { type: 'tangent', line: 'L1', circle: 'A1' }]);
  check(la.jointFreedom().nullity === 6, `N-B line-arc tangent at a shared end: DOF ${la.jointFreedom().nullity} (true 6)`);
  // the side is kept: two arcs meeting at a corner (C2 off the line C1-P) solve to their locked side, the centres apart (external) or one side (internal)
  for (const branch of ['external', 'internal']) {
    const { engine, id } = engineWith([['C1', 0, 0, true], ['s1', 0, 10, true], ['P', 10, 0, true], ['C2', branch === 'external' ? 14 : 6, 3], ['e2', branch === 'external' ? 14 : 6, 8]],
      [{ id: 'A1', type: 'arc', joints: ['C1', 's1', 'P'] }, { id: 'A2', type: 'arc', joints: ['C2', 'P', 'e2'] }],
      [{ type: 'equal', joints: ['C2', 'P', 'C2', 'e2'] }, { type: 'tangent', shapes: ['A1', 'A2'], branch }]);
    const r = engine.solve(200);
    const C1 = at(engine, id.C1), P = at(engine, id.P), C2 = at(engine, id.C2);
    const a = [P.x - C1.x, P.y - C1.y], b = [P.x - C2.x, P.y - C2.y];
    const sin = (a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b)), dot = a[0] * b[0] + a[1] * b[1];
    check(r.converged && Math.abs(sin) < 1e-6 && (branch === 'external' ? dot < 0 : dot > 0),
      `N-B arc-arc tangent ${branch} from a corner: converged ${r.converged}, sin ${sin.toExponential(1)}, centres ${dot < 0 ? 'either side of P' : 'one side of P'}`);
  }
}

// ------------------------------------------------------------------------------------------------ app cases (SketchStudio, the tools' clicks)
const OX = 50, OY = -40;
const toWorld = ([x, y]) => ({ x: OX + 10 * x, y: OY - 10 * y });
async function openApp(opts = {}) {
  const app = await open({ host: 'sketchstudio', ...opts });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: OX + 20, y: OY - 15, w: 160 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
/** `typed`: a value typed in the last step's box and Enter, at the last click's place (task 1049: a slot's TYPED width is its width dimension) */
function draw(app, tool, variant, clicks, typed = null) {
  app.tool(tool);
  if (variant) { app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${variant}"]`).click(); app.frames(2); }
  clicks.map(toWorld).forEach((w, i) => {
    const p = app.toScreen(w.x, w.y); app.move(p.x, p.y);
    if (typed !== null && i === clicks.length - 1) { app.type(String(typed)); app.enter(); } else app.click(p.x, p.y);
  });
  app.esc(); app.frames(2);
}
const panelDof = (app) => analyzeConstraintStatus({ joints: app.state.joints, shapes: app.state.shapes, constraints: app.state.constraints }).dof;
const nullity = (app) => app.engine.jointFreedom().nullity;
const glyphs = (app, type) => app.svg.querySelectorAll(`g.constraint-glyph[data-ctype="${type}"]`).length;
const notices = (app) => { const c = app.document.getElementById('notification-container'); return c ? c.children.length : 0; };
const len = (app, s) => { const a = app.state.joints.get(s.joints[0]), b = app.state.joints.get(s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };

{ // N-A: the 3-point rectangle as built (4 corners x 2 = 8 unknowns after the shared corners, a rectangle: true DOF 5; was 8)
  const app = await openApp();
  try {
    draw(app, 'rect', 'rect-3pt', [[0, 0], [4, 1], [3.5, 3]]);
    check(panelDof(app) === 5 && nullity(app) === 5, `N-A rect-3pt as built: Design panel DOF ${panelDof(app)}, solver ${nullity(app)} (true 5)`);
    const [L0, L1, L2] = app.state.shapes;
    const d0 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [L0.joints[0], L0.joints[1]], value: len(app, L0) }, { source: 'test' });
    const d2 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [L2.joints[0], L2.joints[1]], value: len(app, L2) }, { source: 'test' });
    check(d0 && !d0.isDriven && d2 && d2.isDriven, `N-A rect-3pt: a side's dimension DRIVING (${d0 && !d0.isDriven}), the opposite side's a reference (${d2 && d2.isDriven}; the rectangle already sets it)`);
    void L1;
  } finally { await app.close(); }
}
{ // N-A: fully define it step by step (true DOF after each: 3, 2, 1, 0; the solver said 6, 1, 1, 0)
  const app = await openApp();
  try {
    draw(app, 'rect', 'rect-3pt', [[0, 0], [4, 1], [3.5, 3]]);
    const [L0, L1] = app.state.shapes;
    const add = (t, p) => { ConstraintManager.createConstraint(app.state, t, p, { source: 'test' }); app.engine.solve(); app.frames(2); return panelDof(app); };
    const got = [
      add(CONSTRAINT_TYPES.COINCIDENT, { joints: [L0.joints[0], 'j_origin'] }),
      add(CONSTRAINT_TYPES.HORIZONTAL, { joints: [L0.joints[0], L0.joints[1]] }),
      add(CONSTRAINT_TYPES.DISTANCE, { joints: [L0.joints[0], L0.joints[1]], value: 40 }),
      add(CONSTRAINT_TYPES.DISTANCE, { joints: [L1.joints[0], L1.joints[1]], value: 20 }),
    ];
    check(JSON.stringify(got) === '[3,2,1,0]', `N-A rect-3pt corner on the origin, + Horizontal, + base 40, + side 20: DOF ${got.join(', ')} (true 3, 2, 1, 0)`);
  } finally { await app.close(); }
}

{ // N-A placement (#core/creation-placement.js PLACE.perpendicular): a new branch-locked perpendicular turns the mover RIGIDLY to 90 deg (Fusion),
  // as the fusion-oracle cell perpendicular|LR|0,0 (main's least-change solve shortened that line 61.85 -> 45.26; the dot row alone -> 15.00)
  const app = await openApp();
  try {
    app.tool('line'); for (const w of [{ x: 40, y: -40 }, { x: 110, y: -40 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.esc(); app.tool('line'); for (const w of [{ x: 45, y: -60 }, { x: 105, y: -75 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.esc(); app.frames(2);
    const [A, B] = app.state.shapes.filter((s) => s.type === 'line');
    const before = [len(app, A), len(app, B)];
    const c = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.PERPENDICULAR, { shapes: [A.id, B.id] }, { source: 'toolbar' });
    app.engine.solve(); app.frames(2);
    const dir = (s) => { const a = app.state.joints.get(s.joints[0]), b = app.state.joints.get(s.joints[1]); return [b.x - a.x, b.y - a.y]; };
    const [u, v] = [dir(A), dir(B)], cosAB = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)), cross = u[0] * v[1] - u[1] * v[0];
    const after = [len(app, A), len(app, B)];
    check(!!c && Math.abs(cosAB) < 1e-9 && Math.sign(cross) === c.branch && Math.abs(after[0] - before[0]) < 1e-6 && Math.abs(after[1] - before[1]) < 1e-6,
      `N-A placement: perpendicular (branch ${c && c.branch}) cos ${cosAB.toExponential(1)}; lengths ${before.map((l) => l.toFixed(6)).join(', ')} -> ${after.map((l) => l.toFixed(6)).join(', ')} (kept: a rigid turn)`);
  } finally { await app.close(); }
}

{ // N-C: two circles + the Tangent tool's seam (shapes, branch) draws its glyph; a line-circle tangent stored as shapes only (an older form) too
  const app = await openApp();
  try {
    app.tool('circle'); for (const w of [{ x: 60, y: -50 }, { x: 70, y: -50 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.tool('circle'); for (const w of [{ x: 85, y: -50 }, { x: 90, y: -50 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.esc();
    const [a, b] = app.state.shapes;
    const t = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.TANGENT, { shapes: [a.id, b.id] }, { source: 'toolbar' });
    app.engine.solve(); app.frames(2);
    check(!!t && glyphs(app, 'tangent') === 1, `N-C circle-circle tangent: created ${!!t}, tangent glyphs ${glyphs(app, 'tangent')} (want 1)`);
    const g = t && t.glyphPos, A = app.state.joints.get(a.joints[0]), B = app.state.joints.get(b.joints[0]);
    // external: the touch point is on the line of centres, a.radius from A; the glyph sits near it (within the glyph offset + icon spot search)
    const touch = A && B && { x: A.x + (B.x - A.x) * a.radius / Math.hypot(B.x - A.x, B.y - A.y), y: A.y + (B.y - A.y) * a.radius / Math.hypot(B.x - A.x, B.y - A.y) };
    const off = g && touch ? Math.hypot(g.x - touch.x, g.y - touch.y) : Infinity;
    check(off < 5, `N-C circle-circle tangent glyph ${off.toFixed(3)} world units from the touch point`);
    // a line + a circle tangent stored with shapes only (no line / circle fields): its glyph too
    app.state.constraints.splice(app.state.constraints.indexOf(t), 1);
    app.tool('line'); for (const w of [{ x: 40, y: -40 }, { x: 110, y: -40 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.esc(); app.frames(2);
    const line = app.state.shapes.find((s) => s.type === 'line');
    app.state.constraints.push({ type: CONSTRAINT_TYPES.TANGENT, shapes: [line.id, a.id] });
    app.engine.solve(); app.frames(2);
    check(glyphs(app, 'tangent') === 1, `N-C line-circle tangent stored as shapes: tangent glyphs ${glyphs(app, 'tangent')} (want 1)`);
  } finally { await app.close(); }
}

// D-7 + N-B + N-C on both arc slots (as drawn by the Slot tool): centre (2) + radius + 2 end angles + width = 6, the width dimension 1: true DOF 5
// (task 1049: the width TYPED, 8, so the slot has its width dimension; a clicked width has none, as Fusion: tests/recipes-1049-node.test.js)
const ARC_SLOTS = [['slot-arc-3pt', [[0, 0], [4, 0], [2, 1.5], [2, 1.9]]], ['slot-arc-center', [[2, 0], [4, 0], [2, 2], [2, 2.4]]]];
for (const [variant, clicks] of ARC_SLOTS) {
  const app = await openApp();
  try {
    draw(app, 'slot', variant, clicks, 8);
    const tangents = app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.TANGENT);
    check(tangents.length === 4, `D-7 ${variant}: tangents ${tangents.length} (Fusion 4)`);
    check(panelDof(app) === 5 && nullity(app) === 5, `D-7/N-B ${variant}: Design panel DOF ${panelDof(app)}, solver ${nullity(app)} (true 5)`);
    const bad = unsatisfiedConstraints(app.state.constraints, app.state.joints, app.state.shapes);
    check(bad.length === 0 && notices(app) === 0, `D-7 ${variant}: unsatisfied constraints ${bad.length}, notices ${notices(app)} (no conflict, no redundant warning)`);
    // none of the 4 is redundant: without any one of them the count is one higher (6, the first-order count of a 3-tangent slot)
    const without = tangents.map((t) => { const i = app.state.constraints.indexOf(t); app.state.constraints.splice(i, 1); const n = nullity(app); app.state.constraints.splice(i, 0, t); return n; });
    check(without.every((n) => n === 6), `D-7 ${variant}: DOF without each tangent ${without.join(', ')} (each 6: every tangent counts)`);
    check(glyphs(app, 'tangent') === 4, `N-C ${variant}: tangent glyphs ${glyphs(app, 'tangent')} (want 4)`);
    // each glyph is a pick target of its own tangent (hover-manager glyphAt: hover, click, right click read it)
    const picked = tangents.map((t) => { const p = app.toScreen(t.glyphPos.x, t.glyphPos.y); return glyphAt(app.svg, app.state, p.x, p.y) === t; });
    check(picked.every(Boolean), `N-C ${variant}: glyphAt at each tangent glyph picks that tangent: ${picked.join(', ')}`);
    // a width edit keeps every corner tangent (the solve converges, nothing unsatisfied)
    const w = app.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.DISTANCE);
    const res = commitDimensionEdit(app.state, w, w.value * 1.6); app.frames(2);
    const bad2 = unsatisfiedConstraints(app.state.constraints, app.state.joints, app.state.shapes);
    check(!(res && res.reverted) && bad2.length === 0, `D-7 ${variant}: width x1.6 ${res && res.reverted ? 'reverted' : 'applied'}, unsatisfied after ${bad2.length}`);
  } finally { await app.close(); }
}

{ // D-7: a saved arc slot (the PRE-1038 recipe: 3 tangents, drawn by the Slot tool at origin/main 66458035) loads exactly and solves
  const doc = JSON.parse(fs.readFileSync(new URL('./fixtures/arc-slots-3-tangents-1038.document.json', import.meta.url), 'utf8'));
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'arc slots 1038', doc);
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const saved = doc.geometry.constraints.filter((c) => c.type === CONSTRAINT_TYPES.TANGENT).length;
    const loaded = app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.TANGENT).length;
    const moved = doc.geometry.joints.reduce((m, [id, j]) => { const k = app.state.joints.get(id); return Math.max(m, k ? Math.hypot(k.x - j.x, k.y - j.y) : Infinity); }, 0);
    check(saved === 6 && loaded === 6 && moved < 1e-9, `D-7 saved 3-tangent arc slots: tangents saved ${saved}, loaded ${loaded}; joints moved by the load ${moved}`);
    const r = app.engine.solve();
    const bad = unsatisfiedConstraints(app.state.constraints, app.state.joints, app.state.shapes);
    check(r.converged && bad.length === 0, `D-7 saved 3-tangent arc slots solve: converged ${r.converged}, unsatisfied ${bad.length}`);
    check(glyphs(app, 'tangent') === 6, `N-C saved arc slots: tangent glyphs ${glyphs(app, 'tangent')} (want 6)`);
    // two 3-tangent slots: 6 each by the first-order count (one more than can move, the missing 4th tangent: the reason for D-7); was 9 each
    check(panelDof(app) === 12, `D-7 saved 3-tangent arc slots: Design panel DOF ${panelDof(app)} (2 x 6, the 3-tangent recipe's first-order count)`);
  } finally { await app.close(); }
}

if (fails.length) { console.error(`\n${fails.length} FAILED:\n  ` + fails.join('\n  ')); process.exit(1); }
console.log('\ndof-fix-1038 node tests passed.');
