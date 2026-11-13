import { undoStub } from './helpers/undo-stub.js';
(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('#ui/input-handlers/selection-tools.js');
  const { TOOL_MODES } = await import('#core/constants.js');

  // Mock SVG with minimal API
  const svg = { setPointerCapture: () => {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } } };

  // Create state with an arc (center + start + end)
  const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT, ...undoStub() };
  state.joints.set('c', { x: 100, y: 100 });
  state.joints.set('s', { x: 110, y: 100 });
  state.joints.set('e', { x: 100, y: 110 });
  state.shapes.push({ id: 's_arc_1', type: 'arc', subType: 'CENTER', joints: ['c','s','e'] });

  const down = (id, x, y) => handleSelectionPointerDown({ clientX: x, clientY: y, pointerId: 1, target: { closest: () => null } }, svg, state, { id, j: state.joints.get(id) }, null, null);

  // TASK 578 (Fusion): a pointer-down on a RIM joint drags that joint alone; the solver moves what its constraints require
  down('s', 110, 100);
  assert(state.drag, 'Drag state should be set');
  assert(JSON.stringify(state.drag.jointIds) === JSON.stringify(['s']), 'Dragging a rim holds that joint alone: ' + JSON.stringify(state.drag.jointIds));
  state.drag = null;

  // Dragging the arc CENTRE still translates the arc: the centre and both rims move together
  down('c', 100, 100);
  assert(state.drag, 'Drag state should be set');
  const ids = new Set(state.drag.jointIds);
  assert(ids.has('c') && ids.has('s') && ids.has('e'), 'Dragging the centre should include center and both rim joints');
  const init = Object.fromEntries(['c', 's', 'e'].map((k) => [k, { x: state.joints.get(k).x, y: state.joints.get(k).y }]));
  handleSelectionPointerMove({ clientX: 110, clientY: 110, pointerId: 1 }, svg, state);
  const moved = (k) => { const d = state.joints.get(k).dragTarget; assert(d, 'dragTarget should be set for ' + k); return Math.hypot(d.x - init[k].x, d.y - init[k].y); };
  const mc = moved('c');
  assert(mc > 0.5 && Math.abs(mc - moved('s')) < 1e-6 && Math.abs(mc - moved('e')) < 1e-6, 'Center and rim joints should translate together (via dragTarget)');

  console.log('selection arc translate test passed ✅');
})().catch(e => { console.error('selection arc translate test failed ❌', e); process.exit(1); });