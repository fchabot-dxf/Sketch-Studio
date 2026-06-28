(async () => {
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const { handleSelectionPointerDown } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
  const { CONSTRAINT_TYPES, TOOL_MODES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Mock SVG element
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } }, getBoundingClientRect: () => ({ x:0,y:0,width:200,height:200 }), innerHTML: '' };

  // Setup a single joint and a line with a POINT_ON_LINE glyph
  const joints = new Map(); joints.set('j1', { x: 50, y: 50 }); joints.set('j2', { x: 150, y: 50 });
  const shapes = [{ id: 's1', type: 'line', joints: ['j1','j2'] }];
  const constraints = [{ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: 'j1', shape: 's1', joints: ['j1'] }];

  const state = { joints, shapes, constraints, selectedJoints: new Set(), selectedShapes: new Set(), selectedConstraints: new Set(), hoveredJoint: null, hoveredConstraint: null };
  // Ensure the tool is in SELECT mode for selection interactions
  state.currentTool = TOOL_MODES.SELECT;

  // Draw once with a selection on the joint to reveal its glyph
  state.selectedJoints.add('j1');
  draw(joints, shapes, svg, null, null, constraints, state.selectedJoints, state.selectedConstraints, null, null, new Set(), null, null, null, null, false, null);

  // Inspect glyph position
  const gp = constraints[0].glyphPos;
  assert(gp, 'Constraint glyph position should be present after draw');

  // Simulate pointerdown directly on the glyph position; expect the glyph to be selected, and no shape selected
  const e = { clientX: gp.x, clientY: gp.y, pointerId: 1, shiftKey: false, target: { closest: () => null }, stopPropagation: () => {}, preventDefault: () => {} };
  const handled = handleSelectionPointerDown(e, svg, state, null, null, null);
  // After handling, selectedConstraints should include the constraint
  const found = Array.from(state.selectedConstraints).some(c => c === constraints[0]);
  assert(found, 'Clicking visible glyph should select the constraint');
  assert(state.selectedShapes.size === 0, 'Clicking glyph should not select the underlying shape');

  console.log('glyph-click-priority test passed ✅');
})().catch(e => { console.error('glyph-click-priority tests failed ❌', e); process.exit(1); });