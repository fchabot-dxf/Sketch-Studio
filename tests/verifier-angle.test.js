import assert from 'node:assert';
import { measureResidual } from '#core/constraint-verifier.js';
import { createEngine } from '#core/constraint-solver.js';

console.log('Running tests for verifier ANGLE (exactly the solver zero set: theta == the sector target mod 360 deg, task 553)...');
const DEG = Math.PI / 180;
// u = (1,0) ; v rotated by `deg` from u
function lines(deg) {
  const joints = new Map([
    ['a', { x: 0, y: 0 }], ['b', { x: 10, y: 0 }],
    ['c', { x: 0, y: 0 }], ['d', { x: 10 * Math.cos(deg * DEG), y: 10 * Math.sin(deg * DEG) }],
  ]);
  const shapes = [{ id: 's1', type: 'line', joints: ['a', 'b'] }, { id: 's2', type: 'line', joints: ['c', 'd'] }];
  return { joints, shapes };
}
const shapeForm = (value) => ({ type: 'angle', shapes: ['s1', 's2'], value });
const jointForm = (value) => ({ type: 'angle', joints: ['a', 'b', 'c', 'd'], value });

for (const form of [shapeForm, jointForm]) {
  const tag = form === shapeForm ? 'shapes' : 'joints';
  const { joints, shapes } = lines(60);
  assert.ok(measureResidual(form(60), joints, shapes) < 1e-9, tag + ': value 60 at theta 60 is satisfied');
  // TASK 553: the sector holds the angle modulo 360: theta == value + 180 is the OTHER pose (it measures 180 deg off), unless the sector
  // names line 2's opposite ray (then 240 from u to -v is exactly theta 60)
  assert.ok(Math.abs(measureResidual(form(240), joints, shapes) - Math.PI) < 1e-9, tag + ': value 240 at theta 60 is 180 deg off (no line direction ambiguity)');
  assert.ok(measureResidual({ ...form(240), sector: { ray1: 1, ray2: -1, turn: 1 } }, joints, shapes) < 1e-9, tag + ': value 240 to the opposite ray of line 2 is theta 60');
  assert.ok(measureResidual({ ...form(300), sector: { ray1: 1, ray2: 1, turn: -1 } }, joints, shapes) < 1e-9, tag + ': value 300 clockwise is theta 60');
  // the looser old check accepted -value; the solver's zero set does not: -60 is 120 deg away from theta +60 (modulo 360, task 553)
  const wrongSign = measureResidual(form(-60), joints, shapes);
  assert.ok(Math.abs(wrongSign - 120 * DEG) < 1e-6, tag + ': value -60 at theta +60 must measure 120 deg (' + (120 * DEG) + '), got ' + wrongSign);
  assert.ok(Math.abs(measureResidual(form(90), joints, shapes) - 30 * DEG) < 1e-6, tag + ': value 90 at theta 60 measures 30 deg');
}

// engine level: pinned lines at theta=+60 with a driving angle of -60 cannot be satisfied and must not read as converged
for (const mode of ['shapes', 'joints']) {
  const engine = createEngine(null); engine.init();
  const mk = (x, y) => { const id = engine.genJ(); engine.addJoint(id, x, y, true); return id; };
  const a = mk(0, 0), b = mk(10, 0), c = mk(0, 0), d = mk(5, 5 * Math.sqrt(3));
  engine.addShape({ id: 's1', type: 'line', joints: [a, b] }); engine.addShape({ id: 's2', type: 'line', joints: [c, d] });
  engine.addConstraint(mode === 'shapes' ? { type: 'angle', shapes: ['s1', 's2'], value: -60 } : { type: 'angle', joints: [a, b, c, d], value: -60 });
  const r = engine.solve(100);
  assert.strictEqual(r.converged, false, mode + ': wrong-sign pinned angle must not read as converged');
}
console.log('verifier ANGLE tests passed.');
