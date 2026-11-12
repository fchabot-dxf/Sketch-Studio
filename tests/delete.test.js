(async () => {
  const { deleteConstraints, deleteShapes, deleteJoints } = await import('#core/delete-manager.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Test 1: deleteConstraints removes constraint and clears selection
  let state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}), endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedConstraints: new Set() };
  const c = { type: 'distance', joints: ['j1','j2'], value: 100 };
  state.constraints.push(c);
  state.selectedConstraints.add(c);
  const removedC = deleteConstraints(state, [c]);
  assert(removedC === 1 && state.constraints.length === 0, 'Constraint should be removed');
  assert(state.selectedConstraints.size === 0, 'Selected constraints should be cleared');

  // Test 2: deleteShapes removes shape and related constraints, and cleans orphan joints
  state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}), endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedShapes: new Set() };
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
  state = { constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}), endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedJoints: new Set() };
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


  // ---- TURN 401 item 1: deleting a shape must never delete a neighbour that merely shares a joint ----
  const mk = () => ({ constraints: [], shapes: [], joints: new Map(), beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}), endUndoGroup: () => {}, saveState: () => {}, engine: { solve: () => {} }, selectedShapes: new Set() });
  {
    // 1. shared-joint lines: delete one, the other survives (and the shared joint stays)
    const s = mk();
    ['a','b','c'].forEach((k, i) => s.joints.set(k, { x: i, y: 0 }));
    s.shapes.push({ id: 'l1', type: 'line', joints: ['a','b'] }, { id: 'l2', type: 'line', joints: ['b','c'] });
    deleteShapes(s, ['l1']);
    assert(s.shapes.length === 1 && s.shapes[0].id === 'l2', 'neighbour line sharing a joint must survive');
    assert(s.joints.has('b') && s.joints.has('c') && !s.joints.has('a'), 'shared joint stays, exclusive joint goes');
  }
  {
    // 2. the fillet case: delete the arc, both lines survive, rim joints stay, centre goes
    const { makeRectFromTwoJoints } = await import('#core/shapes.js');
    const { findCornerAtPoint, applyFillet } = await import('#core/fillet.js');
    const joints = new Map(); let n = 0; const g = () => 'jt_' + (++n);
    const a = g(), b = g();
    joints.set(a, { x: 0, y: 0 }); joints.set(b, { x: 80, y: 60 });
    const { shapes, constraints } = makeRectFromTwoJoints(joints, a, b, g);
    const s = Object.assign(mk(), { joints, shapes, constraints });
    const res = applyFillet(s, findCornerAtPoint(s, { x: 80, y: 0 }, 5), 10);
    const [centre, rimA, rimB] = res.arc.joints;
    assert(s.shapes.length === 5, 'rect + arc = 5 shapes');
    deleteShapes(s, [res.arc.id]);
    assert(s.shapes.length === 4 && !s.shapes.some(x => x.type === 'arc'), 'only the arc is removed (was 5 -> 2)');
    assert(s.joints.has(rimA) && s.joints.has(rimB), 'rim joints stay (the lines use them)');
    assert(!s.joints.has(centre), 'centre joint goes');
    assert(!s.constraints.some(c => (c.joints || []).includes(centre) || c.circle === res.arc.id || c.shape === res.arc.id), 'no constraint dangles on the arc');
  }
  {
    // 3. invariant under random deletes: no shape references a missing joint, no orphan joints remain
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 40; trial++) {
      const s = mk();
      for (let i = 0; i < 8; i++) s.joints.set('j' + i, { x: i, y: i % 3 });
      for (let i = 0; i < 7; i++) s.shapes.push({ id: 's' + i, type: 'line', joints: ['j' + i, 'j' + (i + 1)] });
      s.shapes.push({ id: 'arc', type: 'arc', joints: ['j0', 'j3', 'j5'] });
      s.constraints.push({ type: 'equal', joints: ['j0', 'j3', 'j0', 'j5'] }, { type: 'coincident', joints: ['j2', 'j6'] });
      const kill = s.shapes.filter(() => rnd() < 0.4).map(x => x.id);
      deleteShapes(s, kill);
      const used = new Set(); s.shapes.forEach(x => x.joints.forEach(j => used.add(j)));
      for (const j of used) assert(s.joints.has(j), 'shape references a missing joint ' + j + ' (trial ' + trial + ')');
      for (const c of s.constraints) for (const j of (c.joints || [])) assert(s.joints.has(j), 'constraint references a missing joint');
      const refd = new Set(used); s.constraints.forEach(c => (c.joints || []).forEach(j => refd.add(j)));
      for (const j of s.joints.keys()) assert(refd.has(j), 'orphan joint ' + j + ' remains (trial ' + trial + ')');
      assert(s.shapes.length === 8 - kill.length, 'exactly the requested shapes were removed (trial ' + trial + ')');
    }
  }

  console.log('delete manager tests passed ✅');
})().catch(e => { console.error('delete tests failed ❌', e); process.exit(1); });