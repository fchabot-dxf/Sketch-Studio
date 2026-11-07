import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

console.log('Running tests for line-to-line distance (verifier must measure what the solver row measures)...');
setConstraintNotifier(() => {});

function twoParallelLines() {
  const engine = createEngine(null); engine.init();
  const state = { joints: engine.getJoints(), shapes: engine.getShapes(), constraints: engine.getConstraints(), engine, genJ: engine.genJ };
  const mkLine = (x1, y1, x2, y2, fixed) => {
    const a = engine.genJ(); engine.addJoint(a, x1, y1, fixed);
    const b = engine.genJ(); engine.addJoint(b, x2, y2, fixed);
    const id = 'L_' + a; engine.addShape({ id, type: 'line', joints: [a, b] });
    return id;
  };
  const l1 = mkLine(0, 0, 0, 40, true);
  const l2 = mkLine(60, 0, 60, 40, false);
  return { engine, state, l1, l2 };
}

// 1. Already-satisfied line-line distance is reported converged (was: residual == value, converged=false)
{
  const { engine, state, l1, l2 } = twoParallelLines();
  state.constraints.push({ type: 'distance', shapes: [l1, l2], value: 60, isDriven: false });
  const r = engine.solve(500);
  assert.strictEqual(r.converged, true, 'lines already 60 apart must be converged, got ' + JSON.stringify(r.conflicts));
  assert.strictEqual(r.conflicts.length, 0, 'no conflicts');
}

// 2. Through the ConstraintManager the dim stays DRIVING and an edit to 70 moves the free line
{
  const { engine, state, l1, l2 } = twoParallelLines();
  const c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shapes: [l1, l2], value: 60 }, { source: 'test' });
  assert.ok(c, 'constraint created');
  assert.ok(!c.isDriven && !c.driven, 'dimension must stay driving (was demoted to reference with sandbox-conflict)');
  const res = commitDimensionEdit(state, c, 70);
  assert.strictEqual(res.reverted, false, 'edit must not be refused');
  const x = state.joints.get(state.shapes.find((s) => s.id === l2).joints[0]).x;
  assert.ok(Math.abs(x - 70) < 1e-3, 'free line moved to x=70, got ' + x);
}

// 3. A genuinely wrong value is still reported (the verifier is not silently permissive)
{
  const { engine, state, l1, l2 } = twoParallelLines();
  state.constraints.push({ type: 'distance', shapes: [l1, l2], value: 60, isDriven: false });
  // pin the free line too so the solver cannot move it, then ask for 50
  for (const j of state.shapes.find((s) => s.id === l2).joints) state.joints.get(j).fixed = true;
  state.constraints[0].value = 50;
  const r = engine.solve(500);
  assert.strictEqual(r.converged, false, 'unsatisfiable (both lines pinned 60 apart, asked 50) must not converge');
  assert.ok(Math.abs(r.error - 10) < 1e-3, 'residual should be 10, got ' + r.error);
}

console.log('line-line distance tests passed.');
