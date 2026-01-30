import assert from 'assert';
import { test } from 'node:test';
import { attachSelection } from '../sketch-studio-unified/src/selection.js';
import { attachHistory } from '../sketch-studio-unified/src/history.js';
import { deleteSelected } from '../sketch-studio-unified/src/delete.js';

// Test deleting a single selected constraint
test('delete selected constraint removes it and clears selection', () => {
  const state = { constraints: [], shapes: [], joints: new Map() };
  attachSelection(state);
  attachHistory(state);

  const c1 = { type: 'coincident', joints: ['j1','j2'], __selected: true };
  state.constraints.push(c1);
  state.selectItem('constraint', c1);

  deleteSelected(state);

  assert(state.constraints.length === 0, 'constraint should be removed');
  assert(!(state.selectedConstraints && state.selectedConstraints.size), 'selectedConstraints should be empty');
  assert(!state.selectionGet().type, 'selection should be cleared');
});

// Test delete + undo
test('delete then undo restores state', () => {
  const state = { constraints: [], shapes: [], joints: new Map() };
  attachSelection(state);
  attachHistory(state);

  // initial content
  const s1 = { id: 's1', type: 'line', joints: ['j1','j2'] };
  // Make a constraint that references the shape so it will be deleted when that shape is removed
  const c1 = {type: 'pointOnLine', joint: 'j1', shape: 's1'};
  state.shapes.push(s1);
  state.constraints.push(c1);

  // Save baseline
  state.saveState();
  // history snapshot count pre-delete
  const beforeCount = state.history ? state.history.length : 0;

  // Select shape and delete
  state.selectItem('shape', s1);
  deleteSelected(state);
  assert(state.shapes.length === 0, 'shape removed');
  assert(state.constraints.length === 0, 'dependent constraint removed');

  // Inspect history after delete
  const afterCount = state.history ? state.history.length : 0;
  // The top snapshot should represent pre-delete state
  const topSnapshot = state.history && state.history.length ? state.history[state.history.length - 1] : null;
  if(!topSnapshot) throw new Error('No snapshot found after delete');
  // Ensure snapshot had both shapes and constraints
  if(!(topSnapshot.shapes && topSnapshot.shapes.length > 0)) throw new Error('Snapshot missing shapes');
  if(!(topSnapshot.constraints && topSnapshot.constraints.length > 0)) throw new Error('Snapshot missing constraints');

  // Undo should restore
  state.undo();
  assert(state.shapes.length === 1, 'shape restored on undo');
  assert(state.constraints.length === 1, 'constraint restored on undo');
});
