// tests/line-start-snap-click-682-node.test.js — TASK 682: Line tool click vs drag compares raw screen pointer movement against SNAP.DRAG_THRESHOLD (not raw world release vs snapped startPt).
import assert from 'node:assert';
import { SNAP, TOOL_MODES } from '#core/constants.js';
import { handleLinePointerDown, handleLinePointerMove, handleLinePointerUp, resetLineState } from '#ui/input-handlers/line-tool.js';

function makeState() {
  let c = 1;
  return {
    currentTool: TOOL_MODES.LINE,
    activeSketchId: 'sketch-1',
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }, { id: 'sketch-2', name: 'Sketch 2', visible: true }],
    joints: new Map([
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['j_act', { x: 10, y: 10, fixed: false, sketchId: 'sketch-1' }],
      ['j_oth', { x: 40, y: 20, fixed: false, sketchId: 'sketch-2' }],
    ]),
    shapes: [],
    constraints: [],
    active: null,
    snapTarget: null,
    activeSnap: null,
    genJ: () => 'j_new_' + (c++),
    beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none',
    isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}),
    endUndoGroup: () => {}, saveState: () => {}, onDrawCancelled: () => {},
  };
}

// 1. Active-sketch joint clicked 3.5 px (~1.1 mm > 0.5) off-center without drag: stays active at j_act, then second click creates line
{
  const state = makeState();
  resetLineState(state);
  const hitSnap = { type: 'joint', targetId: 'j_act', pt: { x: 10, y: 10 }, isLocked: true };
  handleLinePointerDown({ clientX: 103.5, clientY: 100 }, null, state, hitSnap, { x: 11.1, y: 10 });
  assert.strictEqual(state.active?.start, 'j_act', 'pointerdown snaps active start to j_act');
  // Pointerup at same raw screen location (0 px moved, even though raw world w is 1.1 mm from snapped startPt)
  handleLinePointerUp({ clientX: 103.5, clientY: 100 }, null, state, hitSnap, { x: 11.1, y: 10 }, false);
  assert(state.active && state.active.start === 'j_act', 'click off-center on active joint must keep Line active (not abortLine)');
  assert.strictEqual(state.shapes.length, 0, 'first click does not commit a shape yet');

  handleLinePointerDown({ clientX: 200, clientY: 100 }, null, state, null, { x: 30, y: 10 });
  handleLinePointerUp({ clientX: 200, clientY: 100 }, null, state, null, { x: 30, y: 10 }, false);
  assert.strictEqual(state.shapes.length, 1, 'second click commits the line');
  assert.strictEqual(state.shapes[0].joints[0], 'j_act', 'line starts at j_act (coincident, no new start joint)');
  assert.strictEqual(state.joints.has('j_new_1'), true, 'end joint created');
}

// 2. Other visible sketch joint clicked 3.5 px off-center with tiny 1 px (< SNAP.DRAG_THRESHOLD) release jitter: still a click
{
  const state = makeState();
  resetLineState(state);
  const hitSnap = { type: 'joint', targetId: 'j_oth', pt: { x: 40, y: 20 }, isLocked: true };
  handleLinePointerDown({ clientX: 203.5, clientY: 140 }, null, state, hitSnap, { x: 41.1, y: 20 });
  handleLinePointerMove({ clientX: 204.5, clientY: 140.5 }, null, state, { x: 41.4, y: 20.1 });
  handleLinePointerUp({ clientX: 204.5, clientY: 140.5 }, null, state, hitSnap, { x: 41.4, y: 20.1 }, false);
  assert(state.active && state.active.start === 'j_oth', 'jitter <= SNAP.DRAG_THRESHOLD keeps Line active on j_oth');
  handleLinePointerDown({ clientX: 280, clientY: 140 }, null, state, null, { x: 65, y: 20 });
  handleLinePointerUp({ clientX: 280, clientY: 140 }, null, state, null, { x: 65, y: 20 }, false);
  assert.strictEqual(state.shapes.length, 1, 'second click commits line from j_oth');
  assert.strictEqual(state.shapes[0].joints[0], 'j_oth', 'line starts directly at j_oth');
}

// 3. Real drag from a snapped joint (> SNAP.DRAG_THRESHOLD px): creates line in one gesture (with move OR direct up)
{
  const state = makeState();
  resetLineState(state);
  const hitSnap = { type: 'joint', targetId: 'j_act', pt: { x: 10, y: 10 }, isLocked: true };
  handleLinePointerDown({ clientX: 103.5, clientY: 100 }, null, state, hitSnap, { x: 11.1, y: 10 });
  handleLinePointerMove({ clientX: 150, clientY: 100 }, null, state, { x: 25, y: 10 });
  handleLinePointerUp({ clientX: 150, clientY: 100 }, null, state, null, { x: 25, y: 10 }, true);
  assert.strictEqual(state.shapes.length, 1, 'drag with move creates line in one gesture');
  assert.strictEqual(state.shapes[0].joints[0], 'j_act', 'dragged line starts at j_act');
}

// 4. Synthetic fast drag (> SNAP.DRAG_THRESHOLD px between down and up without intermediate move) also creates line
{
  const state = makeState();
  resetLineState(state);
  const hitSnap = { type: 'joint', targetId: 'j_act', pt: { x: 10, y: 10 }, isLocked: true };
  assert(Math.hypot(10, 0) > (SNAP.DRAG_THRESHOLD || 2), 'sanity: test move exceeds SNAP.DRAG_THRESHOLD');
  handleLinePointerDown({ clientX: 100, clientY: 100 }, null, state, hitSnap, { x: 10, y: 10 });
  handleLinePointerUp({ clientX: 110, clientY: 100 }, null, state, null, { x: 13, y: 10 }, false);
  assert.strictEqual(state.shapes.length, 1, 'fast drag exceeding SNAP.DRAG_THRESHOLD without pointerMove creates line');
  assert.strictEqual(state.shapes[0].joints[0], 'j_act', 'fast dragged line starts at j_act');
}

console.log('line-start-snap-click-682-node.test.js: ok');
