// tests/mirror-fusion-node.test.js - TASK 585: the MIRROR tool reproduces Fusion's Create > Mirror on the advisor's measured sketch, through the node
// kit (tests/helpers/node-app.js: SketchStudio's own page, ribbon, pointer / key listeners, autosave and restore).
// FUSION (measured by the advisor, real UI, cm; ours is mm, x10): a construction line x = 0 from (0,-1) to (0,5); line A (0,4)->(-3,4) horizontal, its
// start on the construction line, length dimension 3; line B (-3,4)->(-3,1) vertical, sharing A's end; a circle at (-1.5,2), diameter dimension 1.
// Mirror {A, B, circle} about the construction line ->
//   new curves  Line (0,4)->(3,4), Line (3,4)->(3,1) (the corner SHARED), Circle (1.5,2) r 0.5
//   new constraints, symmetry only: Sym(Pt(0,4), its OWN copy point (0,4)), Sym(Pt(-3,4), Pt(3,4)), Sym(Pt(-3,1), Pt(3,1)), Sym(Circle, Circle')
//   not copied: the horizontal, the vertical, the point-on-line, both dimensions (2 stay 2); points 7 -> 11 (4 new); ONE undo step
//   3 -> 4 cm and diameter 1 -> 1.6 move the copy to (4,4), (4,1), r 0.8.
// Ours: the circle's dimension is a RADIUS dimension (our dimension tool's circle form): diameter 1 -> 1.6 cm = radius 5 -> 8 mm. A's start is held on the
// construction line by a point-on-line (our coincident-to-line). The line tool joins a chain's corner with a coincident (two joints), not one shared
// joint: the copy's corner is ONE shared joint (the cluster rule, #core/mirror.js). Point counts differ from Fusion's for that reason: ours adds 4 (as
// Fusion), from our own total.
// The construction line is HELD on x = 0 here (vertical + its start on the Y axis), as a line drawn along the Y axis is: the measurement does not
// say how it was held, and Fusion's line did not move under the edits. A FREE construction line turns under our dimension edit, mirror or no
// mirror (the edit's least-change solve, task 528; measured in WORK-LOG TURN 585): reported as a divergence, not asserted here.
// The flow, as a user does it: the ribbon's Mirror (nothing selected: the OBJECTS step), click A, B and the circle, Enter (the LINE step), click the
// construction line, Enter. Then Ctrl+Z / Ctrl+Y, the panel DOF, a save + reload (the autosave and the app's own restore), the dimension edits (the
// dimension box's seam, commitDimensionEdits) in the reloaded app.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { serializeDocument } from '#core/document.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { mirrorPoint } from '#core/symmetric.js';
import { commitDimensionEdits } from '#ui/dimension-seams.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (p, q, tol = 1e-6) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;

// ---- the measured sketch (mm), built with the tools' own core calls, stored as the current design (the app restores and frames it)
const S = L.newSketch();
const k0 = L.point(S, 0, -10), k1 = L.point(S, 0, 50);
const CL = L.line(S, k0, k1, true);                                   // the construction line x = 0
const [A, B] = L.polyline(S, [[0, 40], [-30, 40], [-30, 10]], false); // A then B, the line tool's chain (corner = a coincident)
const make = (type, p) => ConstraintManager.createConstraint(S.state, type, p, { source: 'test' });
make('vertical', { joints: [k0, k1] });
make('pointOnLine', { joint: k0, shape: 'ref_axis_y' });
make('pointOnLine', { joint: A.a, shape: CL });
make('horizontal', { joints: [A.a, A.b] });
make('vertical', { joints: [B.a, B.b] });
const K = L.circle(S, -15, 20, 5);
make('distance', { joints: [A.a, A.b], value: 30 });
make('distance', { shape: K.id, value: 5, isRadius: true });
const DOC = serializeDocument(S.state);
const ids = { CL, A: A.id, B: B.id, K: K.id, Aa: A.a, Ab: A.b, Ba: B.a, Bb: B.b, Kc: K.c };

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Mirror 585', DOC);
let app = await open({ host: 'sketchstudio', profile });
try {
  const st = () => app.state;
  const J = (id) => st().joints.get(id);
  const shape = (id) => st().shapes.find((s) => s.id === id);
  const at = (wx, wy) => app.toScreen(wx, wy);
  const click = (p) => app.click(p.x, p.y);
  // the document as saved, keys sorted (an undo restore re-adds a dimension through addConstraintObject, which writes its fields in another
  // order: the same document; the render caches glyphPos / __visible / __pos are left out)
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).filter((k) => !['glyphPos', '__visible', '__pos'].includes(k)).sort().map((k) => [k, canon(v[k])])) : v);
  const docText = () => JSON.stringify(canon(serializeDocument(st())));
  const panelDof = () => analyzeConstraintStatus({ joints: st().joints, shapes: st().shapes, constraints: st().constraints.filter((c) => !c.isDriven && !c.driven) }).dof;
  const nullity = () => app.engine.jointFreedom().nullity;
  const dims = () => st().constraints.filter((c) => c.type === 'distance');

  ok(st().shapes.length === 4 && dims().length === 2, 'the measured sketch is loaded: 3 lines (one construction) + a circle, 2 dimensions');
  const before = { text: docText(), shapes: st().shapes.length, joints: st().joints.size, cons: st().constraints.length, history: st().history.length };
  const dof0 = nullity();
  ok(panelDof() === dof0, `before: panel DOF ${panelDof()} = engine nullity ${dof0}`);

  // ---- the ribbon's Mirror, the objects by clicks, Enter, the mirror line, Enter
  ok(!!app.document.getElementById('tool-mirror'), 'the ribbon has #tool-mirror');
  ok(app.document.getElementById('tool-mirror').closest('.sk-ribbon-group').querySelector('.sk-ribbon-group-label').textContent === 'Create', 'Mirror sits in the Create group');
  st().selectedShapes.clear(); st().selectedJoints.clear();
  app.tool('mirror');
  ok(st().currentTool === 'mirror' && st().mirror.step === 'objects', 'nothing selected: the tool starts at the OBJECTS step');
  click(at(-15, 40)); click(at(-30, 25)); click(at(-10, 20));          // A's middle, B's middle, the circle's rim
  ok([ids.A, ids.B, ids.K].every((id) => st().selectedShapes.has(id)) && st().selectedShapes.size === 3, 'the three clicks select A, B and the circle: ' + [...st().selectedShapes]);
  app.enter();
  ok(st().mirror.step === 'line', 'Enter ends the OBJECTS step: the LINE step');
  click(at(0, 28));                                                    // the construction line, between the origin and A's start (0,40)
  ok(st().mirror.line === ids.CL, 'the click picks the construction line as the mirror line');
  ok(st().shapes.length === before.shapes, 'nothing is made before the confirming Enter');
  app.enter();
  ok(st().currentTool === 'select' && st().selectedShapes.size === 0, 'Enter mirrors, ends the tool (Select) and clears the selection');
  const after = { text: docText() };

  // ---- the result, as measured
  const added = st().shapes.slice(before.shapes);
  ok(added.length === 3, 'three new curves: ' + added.map((s) => s.type));
  const [cA, cB, cK] = added;
  const P = (id) => ({ x: J(id).x, y: J(id).y });
  ok(cA.type === 'line' && near(P(cA.joints[0]), { x: 0, y: 40 }) && near(P(cA.joints[1]), { x: 30, y: 40 }), `Line (0,4)->(3,4): ${JSON.stringify(cA.joints.map(P))}`);
  ok(cB.type === 'line' && near(P(cB.joints[0]), { x: 30, y: 40 }) && near(P(cB.joints[1]), { x: 30, y: 10 }), `Line (3,4)->(3,1): ${JSON.stringify(cB.joints.map(P))}`);
  ok(cA.joints[1] === cB.joints[0], 'the copy\'s corner is SHARED (one joint): the chain stays connected');
  ok(cK.type === 'circle' && near(P(cK.joints[0]), { x: 15, y: 20 }) && Math.abs(cK.radius - 5) < 1e-9, `Circle c=(1.5,2) r=0.5: ${JSON.stringify(P(cK.joints[0]))} r ${cK.radius}`);
  ok(cA.joints[0] !== ids.Aa && near(P(cA.joints[0]), P(ids.Aa)), 'the point ON the mirror line got its OWN copy point (not merged), at the same place');
  ok(added.every((s) => !s.isConstruction) && added.every((s) => s.sketchId === st().activeSketchId), 'the copies are normal geometry in the ACTIVE sketch');
  const newCons = st().constraints.slice(before.cons);
  ok(newCons.length === 4 && newCons.every((c) => c.type === 'symmetric' && c.line === ids.CL), 'four new constraints, all symmetric about the construction line: ' + JSON.stringify(newCons));
  const pairs = newCons.filter((c) => c.joints).map((c) => c.joints.join('>'));
  ok(pairs.includes(`${ids.Aa}>${cA.joints[0]}`), 'Sym(Pt(0,4), its own copy (0,4))');
  ok(pairs.includes(`${ids.Ab}>${cA.joints[1]}`) || pairs.includes(`${ids.Ba}>${cA.joints[1]}`), 'Sym(Pt(-3,4), Pt(3,4)) (the corner: one link)');
  ok(pairs.includes(`${ids.Bb}>${cB.joints[1]}`), 'Sym(Pt(-3,1), Pt(3,1))');
  ok(newCons.some((c) => c.shapes && c.shapes[0] === ids.K && c.shapes[1] === cK.id), 'Sym(Circle, Circle\') (centres + equal radius)');
  const operandsOf = (c) => [...(c.joints || []), c.joint, c.shape, ...(c.shapes || [])].filter(Boolean);
  const copyIds = new Set([...added.map((s) => s.id), ...added.flatMap((s) => s.joints)]);
  ok(st().constraints.filter((c) => operandsOf(c).some((x) => copyIds.has(x))).every((c) => c.type === 'symmetric'),
    'no H/V, point-on-line, coincident or dimension on the copy: only the symmetric links');
  ok(dims().length === 2, 'dimension count stays 2');
  ok(st().joints.size === before.joints + 4, `points: ${before.joints} -> ${st().joints.size} (4 new copy points, the on-line one included)`);
  ok(nullity() === dof0 && panelDof() === dof0, `DOF after = before (${dof0}): the copy adds none (panel ${panelDof()}, engine ${nullity()})`);
  ok(L.fdJacobian({ engine: app.engine, state: st() }).nullity === dof0, 'finite-difference nullity = the same DOF');

  // ---- ONE undo step; redo identical
  ok(st().history.length === before.history + 1, `one undo step (${before.history} -> ${st().history.length}), labelled ${st().history[st().history.length - 1].label}`);
  app.undo();
  ok(docText() === before.text, 'Ctrl+Z: the document is exactly as before the mirror');
  app.redo();
  ok(docText() === after.text, 'Ctrl+Y: the document is identical to the mirrored one');

  // ---- save / load round trip (the autosave, then a fresh page restoring it)
  const stored = await app.storedDoc();
  ok(stored && stored.geometry.constraints.filter((c) => c.type === 'symmetric').length === 4, 'the stored design holds the 4 symmetric links');
  await app.close();
  app = await open({ host: 'sketchstudio', profile });
  ok(docText() === after.text, 'reloaded: the document is identical (save -> load round trip)');

  // ---- driving: Fusion's dimension edits move the copy; the copy has no dimension of its own
  const dimA = dims().find((c) => c.joints && c.joints.includes(ids.Aa)), dimK = dims().find((c) => c.isRadius && c.shape === ids.K);
  const res = commitDimensionEdits(st(), [{ c: dimA, value: 40 }, { c: dimK, value: 8 }]);
  ok(!res.reverted, 'the dimension edits are accepted: ' + JSON.stringify(res));
  app.frames(5);
  const [rA, rB, rK] = st().shapes.slice(before.shapes);
  const fmt = (id) => `(${J(id).x.toFixed(4)},${J(id).y.toFixed(4)})`;
  console.log(`after 30 -> 40, R 5 -> 8: original A ${fmt(ids.Aa)} ${fmt(ids.Ab)}, B end ${fmt(ids.Bb)}; copy ${fmt(rA.joints[0])} ${fmt(rA.joints[1])} ${fmt(rB.joints[1])} r ${rK.radius.toFixed(4)}`);
  const CLends = shape(ids.CL).joints.map(P);
  ok([rA.joints[0], rA.joints[1], rB.joints[1]].every((q, i) => near(P(q), mirrorPoint(P([ids.Aa, ids.Ab, ids.Bb][i]), ...CLends), 1e-6)),
    'the copy is still the exact mirror image of A and B (the on-line copy point included)');
  // Fusion: (4,4), (4,1). x exactly; y within 0.05 mm (our edit's least-change solve lets A's height drift by a few hundredths, mirror or not)
  ok(Math.abs(J(rA.joints[1]).x - 40) < 1e-4 && Math.abs(J(rB.joints[1]).x - 40) < 1e-4, 'the copy\'s corner and end moved to x = 4 cm (Fusion\'s numbers, x10)');
  ok(Math.abs(J(rA.joints[1]).y - 40) < 0.05 && Math.abs(J(rB.joints[1]).y - 10) < 0.05, 'the copy\'s corner is at y = 4 cm and its end at y = 1 cm (within 0.05 mm)');
  ok(Math.abs(rK.radius - 8) < 1e-4 && near(P(rK.joints[0]), { x: 15, y: 20 }, 1e-4), 'the copy circle: r 0.8 (Fusion\'s), centre (1.5,2)');
  ok(dims().length === 2, 'still 2 dimensions: the copy has none of its own');

  // ---- TOUCH: the Done button (task 562's) ends each step as Enter does. Mirror the circle about the X axis with taps only.
  const tap = (p) => app.click(p.x, p.y, { pointerType: 'touch' });
  const done = () => app.document.querySelector('.sk-touch-done');
  const n0 = st().shapes.length, h0 = st().history.length;
  app.tool('mirror');
  tap(at(-15 + 8, 20));                                                // the circle's rim (r 8 now)
  ok(st().selectedShapes.has(ids.K) && done() && !done().hidden && done().getAttribute('aria-label') === 'Mirror: next step', 'touch: the circle tapped, the Done button shows (Mirror: next step)');
  app.press(done());
  ok(st().mirror && st().mirror.step === 'line', 'touch: Done ends the OBJECTS step');
  tap(at(-22, 0));                                                     // the X axis
  ok(st().mirror.line === 'ref_axis_x', 'touch: the X axis tapped as the mirror line');
  app.press(done());
  const kx = st().shapes[n0], kc = P(ids.Kc);
  ok(st().shapes.length === n0 + 1 && kx.type === 'circle' && near(P(kx.joints[0]), { x: kc.x, y: -kc.y }, 1e-9) && kx.radius === shape(ids.K).radius,
    `touch: Done mirrors the circle about the X axis (${JSON.stringify(P(kx.joints[0]))}, r ${kx.radius})`);
  ok(st().history.length === h0 + 1 && st().currentTool === 'select', 'touch: one undo step, the tool ends');
  app.frames(2);
  ok(done().hidden, 'touch: the Done button hides once the tool ends');
  console.log(`mirror-fusion-node: ${checks} checks ok`);
} finally {
  await app.close();
}
