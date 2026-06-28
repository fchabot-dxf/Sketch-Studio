import assert from 'assert';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

// Horizontal case (dx > dy)
{
  const state = { joints: new Map(), constraints: [], shapes: [], engine: undefined };
  state.joints.set('a', { x: 0, y: 0 });
  state.joints.set('b', { x: 10, y: 0.1 });
  const res = ConstraintManager.addHorizontalOrVertical(state, ['a','b']);
  assert.ok(res, 'Constraint should be added');
  const last = state.constraints[state.constraints.length - 1];
  assert.ok(last && (last.type === CONSTRAINT_TYPES.HORIZONTAL || last.type === CONSTRAINT_TYPES.VERTICAL), 'Constraint type should be H/V');
}

// Vertical case (dy > dx)
{
  const state = { joints: new Map(), constraints: [], shapes: [], engine: undefined };
  state.joints.set('a', { x: 0, y: 0 });
  state.joints.set('b', { x: 0.1, y: 10 });
  const res = ConstraintManager.addHorizontalOrVertical(state, ['a','b']);
  assert.ok(res, 'Constraint should be added');
  const last = state.constraints[state.constraints.length - 1];
  assert.ok(last && (last.type === CONSTRAINT_TYPES.HORIZONTAL || last.type === CONSTRAINT_TYPES.VERTICAL), 'Constraint type should be H/V');
}

console.log('Horizontal/Vertical constraint tests passed ✅');
