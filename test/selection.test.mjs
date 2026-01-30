import assert from 'assert';
import { test } from 'node:test';
import { attachSelection } from '../sketch-studio-unified/src/selection.js';

// Basic unit tests for selection.js

test('selection add/remove/toggle shapes', () => {
  const state = { constraints: [], shapes: [], joints: new Map() };
  attachSelection(state);

  state.selectItem('shape', { id: 's1' });
  assert(state.selectedShapes.has('s1'));

  state.selectItem('shape', { id: 's2' }, { add: true });
  assert(state.selectedShapes.has('s1') && state.selectedShapes.has('s2'));

  state.selectItem('shape', { id: 's1' }, { add: true }); // toggles off
  assert(!state.selectedShapes.has('s1'));
});

test('selection constraint add/remove', () => {
  const state = { constraints: [], shapes: [], joints: new Map() };
  attachSelection(state);

  const c1 = { type: 'coincident', joints: ['j1','j2'] };
  const c2 = { type: 'coincident', joints: ['j3','j4'] };
  state.constraints.push(c1, c2);

  state.selectItem('constraint', c1);
  assert(state.selectedConstraints.has(c1));

  state.selectItem('constraint', c2, { add: true });
  assert(state.selectedConstraints.has(c1) && state.selectedConstraints.has(c2));

  state.selectItem('constraint', c1, { add: true }); // toggle off
  assert(!state.selectedConstraints.has(c1));
});

test('selection joints cluster add/toggle', () => {
  const state = { constraints: [], shapes: [], joints: new Map() };
  attachSelection(state);

  state.selectItem('joints', ['j1','j2']);
  assert(state.selectedJoints.has('j1') && state.selectedJoints.has('j2'));

  state.selectItem('joints', ['j1','j2']); // toggle off
  assert(!state.selectedJoints.has('j1') && !state.selectedJoints.has('j2'));
});

// Simulate deletion of a selected constraint using selection API
test('simulate delete selected constraint', () => {
  const state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: ()=>{}, endUndoGroup: ()=>{} };
  attachSelection(state);
  const c1 = { type: 'coincident', joints: ['j1','j2'], __selected: true };
  state.constraints.push(c1);
  state.selectItem('constraint', c1);

  // Simulate deletion handler (uses selection API semantics)
  const sel = state.selectionGet();
  if(sel && sel.type === 'constraint'){
    const c = sel.payload;
    const idx = state.constraints.indexOf(c);
    if(idx !== -1){
      if(c.__selected) c.__selected = false;
      state.constraints.splice(idx, 1);
      state.clearSelection();
    }
  }

  assert(state.constraints.length === 0);
  assert(!state.selectedConstraints.size);
});
