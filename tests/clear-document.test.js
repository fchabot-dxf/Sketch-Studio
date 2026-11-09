// tests/clear-document.test.js — TASK 498: state.clearDocument() (the one function behind Clear All) resets EVERY part of the
// shared sketch state, so a cleared state deep-equals a freshly constructed one (after the same initStore()).
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';

const make = () => {
  const engine = createEngine(null);
  const state = createSketchState(engine, { x: 0, y: 0, w: 20, h: 20 });
  state.initStore();
  return state;
};
// Plain-data projection: drop functions and the engine handle so deepStrictEqual compares state, not closures.
const project = (state) => {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === 'function' || k === 'engine' || k === 'model' || k === '_historyListeners') continue;
    out[k] = v;
  }
  return out;
};

const state = make();
state.joints.set('a', { x: 1, y: 1 }); state.joints.set('b', { x: 5, y: 1 }); state.joints.set('c', { x: 5, y: 5 });
state.shapes.push({ id: 's1', type: 'line', joints: ['a', 'b'] }, { id: 's2', type: 'line', joints: ['b', 'c'] });
state.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 4 });
state.groups.push({ id: 'g1', name: 'G', shapeIds: ['s1', 's2'] });
state.profiles.push({ id: 'p1', outer: ['s1'], holes: [] });
state.vcarves.push({ id: 'v1', region: 'p1', vbit: { angle: 60 } });
state.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
state.activeSketchId = 'sketch-2';
state.selectedShapes.add('s1'); state.selectedJoints.add('a'); state.selectedConstraints.add(state.constraints[0]);
state.active = { id: 'a' }; state.hoveredShape = 's1'; state.hoveredJoint = 'a'; state.snapTarget = { id: 'b' }; state.pendingConstraint = { type: 'parallel' };
state.saveState();
assert.ok(state.canUndo(), 'precondition: history exists');
let notified = 0;
state.addHistoryListener(() => { notified++; });

state.clearDocument();

assert.deepStrictEqual(project(state), project(make()), 'a cleared state deep-equals a fresh state');
assert.strictEqual(state.shapes.length, 0);
assert.strictEqual(state.groups.length + state.profiles.length + state.vcarves.length, 0, 'groups/profiles/vcarves are cleared too');
assert.strictEqual(state.sketches.length, 1, 'sketches reset to the single default sketch');
assert.strictEqual(state.activeSketchId, state.sketches[0].id);
assert.ok(!state.canUndo() && !state.canRedo(), 'Clear All is not undoable');
assert.ok(notified >= 1, 'history listeners (ribbon undo/redo) are told');

// Repeated on an empty board is harmless.
state.clearDocument();
assert.deepStrictEqual(project(state), project(make()), 'clearing an already-empty state is a no-op');

console.log('clear-document.test.js: ok');
