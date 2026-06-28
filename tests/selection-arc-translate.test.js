(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('#ui/input-handlers/selection-tools.js');
  const { TOOL_MODES } = await import('#core/constants.js');

  // Mock SVG with minimal API
  const svg = { setPointerCapture: () => {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } } };

  // Create state with an arc (center + start + end)
  const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT };
  state.joints.set('c', { x: 100, y: 100 });
  state.joints.set('s', { x: 110, y: 100 });
  state.joints.set('e', { x: 100, y: 110 });
  state.shapes.push({ id: 's_arc_1', type: 'arc', subType: 'CENTER', joints: ['c','s','e'] });

  // Prepare hit on a rim joint 's'
  const hitJoint = { id: 's', j: state.joints.get('s') };

  // PointerDown on rim joint
  const downEvent = { clientX: 110, clientY: 100, pointerId: 1, target: { closest: () => null } };
  handleSelectionPointerDown(downEvent, svg, state, hitJoint, null, null);

  // Verify drag set contains center and both rims
  assert(state.drag, 'Drag state should be set');
  const ids = new Set(state.drag.jointIds);
  assert(ids.has('c') && ids.has('s') && ids.has('e'), 'Dragging rim should include center and both rim joints');

  // Record initial positions
  const initC = { x: state.joints.get('c').x, y: state.joints.get('c').y };
  const initS = { x: state.joints.get('s').x, y: state.joints.get('s').y };
  const initE = { x: state.joints.get('e').x, y: state.joints.get('e').y };

  // Simulate pointer move to translate by +10,+10
  const moveEvent = { clientX: 120, clientY: 110, pointerId: 1 };
  handleSelectionPointerMove(moveEvent, svg, state);

  // Expect drag targets to be set for all arc joints (solver applies positions)
  const cDrag = state.joints.get('c').dragTarget;
  const sDrag = state.joints.get('s').dragTarget;
  const eDrag = state.joints.get('e').dragTarget;
  assert(cDrag && sDrag && eDrag, 'dragTarget should be set for center and rim joints');

  // All dragTargets should have moved by the same delta relative to their initial positions
  const movedC = Math.hypot(cDrag.x - initC.x, cDrag.y - initC.y);
  const movedS = Math.hypot(sDrag.x - initS.x, sDrag.y - initS.y);
  const movedE = Math.hypot(eDrag.x - initE.x, eDrag.y - initE.y);

  assert(movedC > 0.5 && Math.abs(movedC - movedS) < 1e-6 && Math.abs(movedC - movedE) < 1e-6, 'Center and rim joints should translate together (via dragTarget)');

  console.log('selection arc translate test passed ✅');
})().catch(e => { console.error('selection arc translate test failed ❌', e); process.exit(1); });