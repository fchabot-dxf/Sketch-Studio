(async () => {
  const { handleSelectionPointerDown } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
  const { draw } = await import('../packages/ui/svg-renderer.js');
  const { TOOL_MODES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const makeSVG = () => ({ viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), innerHTML: '', setPointerCapture: () => {}, releasePointerCapture: () => {} });
  function makeState(){ return { currentTool: TOOL_MODES.SELECT, joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), beginUndoGroup: () => {}, saveState: () => {}, endUndoGroup: () => {}, selectedConstraints: new Set() }; }

  // Build a cluster A-B-C: constraints A-B and B-C
  const state = makeState();
  state.joints.set('A', { x: 100, y: 100 });
  state.joints.set('B', { x: 100, y: 100 });
  state.joints.set('C', { x: 100, y: 100 });
  const c1 = { type: 'coincident', joints: ['A', 'B'] };
  const c2 = { type: 'coincident', joints: ['B', 'C'] };
  state.constraints = [c1, c2];

  const svg = makeSVG();

  // Select joint B - selecting any joint in the cluster should reveal both c1 and c2 glyphs
  const eDown = { clientX: 100, clientY: 100, pointerId: 1, target: { closest: () => null }, shiftKey: false };
  handleSelectionPointerDown(eDown, svg, state, { id: 'B', j: state.joints.get('B') }, null, null);

  // Both constraints internal to cluster should be flagged to show
  assert(c1.__showGlyph === true && c2.__showGlyph === true, 'Selecting cluster joint should flag all internal coincident constraints with __showGlyph');

  // Renderer should draw at least two constraint glyphs (opacity:1)
  svg.innerHTML = '';
  draw(state.joints, state.shapes, svg, null, null, state.constraints, state.selectedJoints, state.selectedConstraints, null, null, new Set(), null, null, null, null, false);
  // Match opening <g> tags for constraint glyphs with style containing opacity:1
  const glyphRegex = /<g[^>]*class=\"constraint-glyph\"[^>]*style=\"[^\"]*opacity:1[^\"]*\"[^>]*>/g;
  const matches = svg.innerHTML.match(glyphRegex) || [];
  assert(matches.length >= 2, `Expected at least 2 visible constraint glyphs for cluster, got ${matches.length}`);

  console.log('selection-coincident-cluster tests passed ✅');
})().catch(e => { console.error('selection-coincident-cluster tests failed ❌', e); process.exit(1); });