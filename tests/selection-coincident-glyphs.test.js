(async () => {
  const { handleSelectionPointerDown } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const { TOOL_MODES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const makeSVG = () => ({ viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), innerHTML: '', setPointerCapture: () => {}, releasePointerCapture: () => {} });

  function makeState(){
    return { currentTool: TOOL_MODES.SELECT, joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), beginUndoGroup: () => {}, saveState: () => {}, endUndoGroup: () => {}, selectedConstraints: new Set() };
  }

  // Create a simple cluster: pair of coincident joints a1/a2 and pair b1/b2
  const state = makeState();
  state.joints.set('a1', { x: 50, y: 50 }); state.joints.set('a2', { x: 50, y: 50 });
  state.joints.set('b1', { x: 150, y: 50 }); state.joints.set('b2', { x: 150, y: 50 });
  state.shapes.push({ id: 's1', type: 'line', joints: ['a1','b1'] });

  const c1 = { type: 'coincident', joints: ['a1','a2'] };
  const c2 = { type: 'coincident', joints: ['b1','b2'] };
  state.constraints = [c1, c2];

  const svg = makeSVG();

  // Select joint 'a1' by simulating pointer down on it
  const eDown = { clientX: 50, clientY: 50, pointerId: 1, target: { closest: () => null }, shiftKey: false };
  handleSelectionPointerDown(eDown, svg, state, { id: 'a1', j: state.joints.get('a1') }, null, null);

  // After selection, the coincident constraint that pairs the cluster should have __showGlyph = true
  assert(c1.__showGlyph === true, 'Coincident constraint glyph should be flagged visible when its cluster is selected');

  // The renderer should now render at least one visible constraint glyph (opacity:1)
  svg.innerHTML = '';
  draw(state.joints, state.shapes, svg, null, null, state.constraints, state.selectedJoints, state.selectedConstraints, null, null, new Set(), null, null, null, null, false, null);
  const glyphVisible = /class="constraint-glyph"[\s\S]*opacity:1/.test(svg.innerHTML);
  assert(glyphVisible, 'Selecting a joint in a coincident cluster should make its coincident glyph visible (opacity:1)');

  // Clicking empty space should clear selection and reset the glyph flag
  const eEmpty = { clientX: 400, clientY: 400, pointerId: 2, target: { closest: () => null }, shiftKey: false };
  handleSelectionPointerDown(eEmpty, svg, state, null, null, null);
  assert(!c1.__showGlyph, 'Coincident glyph flag should be cleared when selection changes/clears');

  console.log('selection-coincident-glyphs tests passed ✅');
})().catch(e => { console.error('selection-coincident-glyphs tests failed ❌', e); process.exit(1); });