import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '../apps/sketchstudio/ui/input-handlers/selection-tools.js';
import { findSnap } from '../apps/sketchstudio/snap-detection.js';
import { TOOL_MODES } from '../src/core/constants.js';

const svg = { getBoundingClientRect: () => ({ width: 800, height: 600 }), viewBox: { baseVal: { x:0,y:0,width:800,height:600 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
function makeState(){ return { currentTool: TOOL_MODES.SELECT, joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), beginUndoGroup: () => {}, saveState: () => {}, endUndoGroup: () => {} }; }

(async function(){
  const state = makeState();
  state.joints.set('A', { x: 200, y: 200 });
  state.joints.set('B', { x: 200, y: 200 });
  state.joints.set('C', { x: 200, y: 200 });
  state.constraints = [{ type: 'coincident', joints: ['A','B'] }, { type: 'coincident', joints: ['B','C'] }];
  state.joints.set('D', { x: 300, y: 200 });

  const eDown = { clientX: 300, clientY: 200, pointerId: 5, target: { closest: () => null }, shiftKey: false };
  handleSelectionPointerDown(eDown, svg, state, { id: 'D', j: state.joints.get('D') }, null, null);
  console.log('after down, drag:', state.drag);

  const eMove1 = { clientX: 260, clientY: 200, pointerId: 5 };
  state.lastMouse = { x: eMove1.clientX, y: eMove1.clientY };
  const snap1 = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
  state.snapTarget = snap1 ? { type: snap1.type, targetId: snap1.targetId || snap1.id || null, pt: snap1.pt || (snap1.x !== undefined ? { x: snap1.x, y: snap1.y } : null), x: snap1.x, y: snap1.y, shape: snap1.shape } : null;
  state.activeSnap = state.snapTarget;
  handleSelectionPointerMove(eMove1, svg, state);
  console.log('after move1, activeSnap:', state.activeSnap, 'drag.lockedTo:', state.drag.lockedTo);

  const eMove2 = { clientX: 200, clientY: 200, pointerId: 5 };
  state.lastMouse = { x: eMove2.clientX, y: eMove2.clientY };
  const snap2 = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
  state.snapTarget = snap2 ? { type: snap2.type, targetId: snap2.targetId || snap2.id || null, pt: snap2.pt || (snap2.x !== undefined ? { x: snap2.x, y: snap2.y } : null), x: snap2.x, y: snap2.y, shape: snap2.shape } : null;
  state.activeSnap = state.snapTarget;
  handleSelectionPointerMove(eMove2, svg, state);
  console.log('after move2, activeSnap:', state.activeSnap, 'drag.lockedTo:', state.drag.lockedTo);

  console.log('state.drag before up:', state.drag);
  const eUp = { clientX: 200, clientY: 200, pointerId: 5 };
  handleSelectionPointerUp(eUp, svg, state);
  console.log('after up, constraints:', state.constraints);
})();
