// tests/dimension-delete.test.js — TASK 485 (owner: "deleting a dimension will delete geometry sometimes"): the DELETE PATH itself, for every
// dimension kind. deleteSelection with ONLY a dimension selected removes that constraint and NOTHING else: no shape, no joint, no other
// constraint. (The reported bug was upstream: the selection. Clicking a dimension left an earlier geometry selection alive, so the
// selection was "dimension + line"; tests/dimension-delete-live.test.js drives that with real pointer / key events.)
import assert from 'node:assert';
import { deleteSelection } from '#core/delete-manager.js';

function scene() {
  const state = {
    joints: new Map([['j_origin', { x: 0, y: 0 }], ['a', { x: 0, y: 0 }], ['b', { x: 40, y: 0 }], ['c', { x: 40, y: 30 }], ['cc', { x: 80, y: 0 }], ['cr', { x: 88, y: 0 }],
      ['ac', { x: 0, y: 60 }], ['as', { x: 10, y: 60 }], ['ae', { x: 0, y: 50 }], ['p1', { x: -30, y: -30 }], ['p2', { x: -10, y: -30 }], ['v', { x: 40, y: 0, virtualSharp: true }]]),
    shapes: [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'C1', type: 'circle', joints: ['cc', 'cr'], radius: 8 },
      { id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] }],
    constraints: [],
    selectedConstraints: new Set(), selectedShapes: new Set(), selectedJoints: new Set(),
    beginUndoGroup() {}, endUndoGroup() {}, saveState() {}, engine: { solve() {} },
  };
  const KINDS = {
    'distance (two points)': { type: 'distance', joints: ['a', 'b'], value: 40 },
    'distance (two standalone points)': { type: 'distance', joints: ['p1', 'p2'], value: 20 },
    'angle (two lines)': { type: 'angle', shapes: ['L1', 'L2'], value: 90 },
    'radius (circle)': { type: 'distance', shape: 'C1', value: 8, isRadius: true },
    'radius (arc)': { type: 'distance', shape: 'A1', value: 10, isRadius: true },
    'driven / reference distance': { type: 'distance', joints: ['b', 'c'], value: 30, isDriven: true },
    'overall distance held on a fillet virtual-sharp joint': { type: 'distance', joints: ['v', 'c'], value: 30 },
    'equal (joint form)': { type: 'equal', joints: ['a', 'b', 'b', 'c'] },
  };
  for (const c of Object.values(KINDS)) state.constraints.push(c);
  return { state, KINDS };
}
const snapshot = (s) => JSON.stringify({ shapes: s.shapes, joints: [...s.joints.entries()] });

for (const kind of Object.keys(scene().KINDS)) {
  const { state, KINDS } = scene();
  const before = snapshot(state), n = state.constraints.length, target = KINDS[kind];
  state.selectedConstraints.add(target);
  deleteSelection(state);
  assert.strictEqual(state.constraints.length, n - 1, kind + ': exactly one constraint removed');
  assert.ok(!state.constraints.includes(target), kind + ': and it is the selected one');
  assert.strictEqual(snapshot(state), before, kind + ': no shape or joint removed or moved');
}

// the intended case: a MIXED selection (a line + a dimension) removes both
{
  const { state, KINDS } = scene();
  state.selectedConstraints.add(KINDS['distance (two points)']); state.selectedShapes.add('L2');
  deleteSelection(state);
  assert.ok(!state.shapes.some((s) => s.id === 'L2'), 'the selected line is removed');
  assert.ok(!state.constraints.includes(KINDS['distance (two points)']), 'and the dimension');
  assert.ok(state.shapes.some((s) => s.id === 'L1') && state.shapes.some((s) => s.id === 'C1'), 'the rest of the geometry stays');
}
console.log('dimension-delete: ok');
