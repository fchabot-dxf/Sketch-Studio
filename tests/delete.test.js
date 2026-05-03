(async () => {
  const { deleteConstraints, deleteShapes, deleteJoints } = await import('../src/core/delete-manager.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Test 1: deleteConstraints removes constraint and clears selection
  let state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedConstraints: new Set() };
  const c = { type: 'distance', joints: ['j1','j2'], value: 100 };
  state.constraints.push(c);
  state.selectedConstraints.add(c);
  const removedC = deleteConstraints(state, [c]);
  assert(removedC === 1 && state.constraints.length === 0, 'Constraint should be removed');
  assert(state.selectedConstraints.size === 0, 'Selected constraints should be cleared');

  // Test 2: deleteShapes removes shape and related constraints, and cleans orphan joints
  state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedShapes: new Set() };
  state.joints.set('j1', {x:0,y:0}); state.joints.set('j2',{x:10,y:0});
  state.shapes.push({ id: 's1', type: 'line', joints: ['j1','j2'] });
  state.constraints.push({ type: 'distance', shape: 's1', value: 10 });
  const removedS = deleteShapes(state, ['s1']);
  assert(removedS >= 1, 'Shape should be removed');
  assert(state.shapes.length === 0, 'Shapes should be empty');
  assert(state.constraints.length === 0, 'Constraints referencing shape should be removed');
  // Joints should be cleaned if orphaned
  assert(!state.joints.has('j1') && !state.joints.has('j2'), 'Orphan joints should be removed');

  // Test 3: deleteJoints removes joints, shapes referencing them, and constraints referencing them
  state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedJoints: new Set() };
  state.joints.set('a',{x:0,y:0}); state.joints.set('b',{x:10,y:0}); state.joints.set('c',{x:20,y:0});
  state.shapes.push({ id: 'line1', type: 'line', joints: ['a','b'] });
  state.shapes.push({ id: 'line2', type: 'line', joints: ['b','c'] });
  state.constraints.push({ type: 'coincident', joints: ['a','b'] });
  const removedJ = deleteJoints(state, ['b']);
  assert(removedJ >= 1, 'Joint should be removed');
  // Shapes referencing 'b' should be removed
  assert(!state.shapes.find(s => s.joints && s.joints.includes('b')), 'Shapes referencing deleted joint should be removed');
  // Constraints referencing 'b' removed
  assert(!state.constraints.find(c => (c.joints && c.joints.includes('b'))), 'Constraints referencing deleted joint should be removed');

  console.log('delete manager tests passed ✅');
})().catch(e => { console.error('delete tests failed ❌', e); process.exit(1); });