// tests/dimension-preselection-workflow.test.js
// Verification for Dimension Pre-selection Workflow:
// 1. Pre-selection + DIM click/shortcut immediately creates dimension in placing mode (placingConstraint).
// 2. Interactive positioning: cursor position picks horizontal, vertical, or aligned.
// 3. Enter (or canvas click) anchors dimension and opens inline edit pre-filled with measured value.
// 4. Enter in input commits value as driving dimension and solves.
// 5. Esc cancels cleanly with no phantom undo steps.

(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const { createEngine } = await import('#core/constraint-solver.js');
  const { createSketchState } = await import('#ui/sketch-state.js');
  const { CONSTRAINT_TYPES, TOOL_MODES } = await import('#core/constants.js');
  const {
    startDimensionFromSelection,
    handleDimensionPointerMove,
    handleDimensionPointerDown,
    anchorPlacingDimension,
    isDimensionPlacing,
    getPlacingConstraint,
    resetDimensionState
  } = await import('#ui/input-handlers/dimension-tool.js');
  const { switchToTool, setupInput } = await import('#ui/input-manager.js');
  const { setupNumericInput, showEditInput, hideInput, isInputActive } = await import('#ui/numeric-input-manager.js');

  // Minimal DOM & fake input mocks
  const listeners = new Map();
  const dimInput = {
    id: 'dimInput',
    classList: {
      _set: new Set(['hidden']),
      add(s) { this._set.add(s); },
      remove(s) { this._set.delete(s); },
      contains(s) { return this._set.has(s); }
    },
    style: {},
    value: '',
    focus() { this._focused = true; },
    select() { this._selected = true; },
    addEventListener(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener(ev, fn) {
      if (!listeners.has(ev)) return;
      const arr = listeners.get(ev);
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    dispatchEvent(ev) {
      const arr = listeners.get(ev.type) || [];
      for (const fn of arr) fn(ev);
    }
  };

  const docListeners = new Map();
  globalThis.document = {
    body: { appendChild: () => {}, insertBefore: () => {} },
    head: { appendChild: () => {} },
    getElementById: (id) => (id === 'dimInput' ? dimInput : (id === 'cursor-symbols' ? { querySelector: () => null, appendChild: () => {} } : null)),
    querySelector: (sel) => (sel === 'svg' ? svg : null),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, addEventListener: () => {}, querySelector: () => null }),
    createElementNS: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {}, querySelector: () => null }),
    addEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) return;
      const arr = docListeners.get(ev);
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    dispatchEvent: (ev) => {
      const arr = docListeners.get(ev.type) || [];
      for (const fn of arr) fn(ev);
    }
  };

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {}
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  function createTestSketch() {
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    // Add two joints forming a diagonal line (0,0) to (100, 100)
    const j1 = engine.genJ();
    engine.addJoint(j1, 0, 0, false);
    const j2 = engine.genJ();
    engine.addJoint(j2, 100, 100, false);
    const lineShape = { id: 's_line1', type: 'line', joints: [j1, j2] };
    state.shapes.push(lineShape);
    setupNumericInput(svg, state);
    return { engine, state, j1, j2, lineShape };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Single Line Pre-selection + DIM -> placingConstraint
  // ─────────────────────────────────────────────────────────────────────────
  {
    const { state, lineShape } = createTestSketch();
    state.selectedShapes.add(lineShape.id);
    assert(state.selectedShapes.size === 1, 'Line is selected');

    const started = startDimensionFromSelection(svg, state);
    assert(started === true, 'startDimensionFromSelection should succeed for single line');
    assert(isDimensionPlacing(state), 'Dimension must be in placing mode');
    const c = getPlacingConstraint(state);
    assert(c !== null, 'Placing constraint must be active');
    assert(c.__placing === true, 'c.__placing must be true');
    assert(c.__newlyPlaced === true, 'c.__newlyPlaced must be true');
    assert(!c.isDriven && !c.driven, 'Initial placing constraint must be driving (isDriven=false)');
    assert(state.selectedShapes.size === 0, 'Selection must be cleared upon placing');
    resetDimensionState(state);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Two Selected Joints + DIM -> placingConstraint
  // ─────────────────────────────────────────────────────────────────────────
  {
    const { state, j1, j2 } = createTestSketch();
    state.selectedJoints.add(j1);
    state.selectedJoints.add(j2);
    assert(state.selectedJoints.size === 2, 'Two joints selected');

    const started = startDimensionFromSelection(svg, state);
    assert(started === true, 'startDimensionFromSelection should succeed for 2 joints');
    assert(isDimensionPlacing(state), 'Dimension must be in placing mode');
    const c = getPlacingConstraint(state);
    assert(c !== null, 'Placing constraint must be active');
    assert(c.joints[0] === j1 && c.joints[1] === j2, 'Constraint must connect j1 and j2');
    assert(state.selectedJoints.size === 0, 'Joint selection must be cleared');
    resetDimensionState(state);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Interactive Positioning (Aligned, Horizontal, Vertical)
  // ─────────────────────────────────────────────────────────────────────────
  {
    const { state, lineShape } = createTestSketch();
    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    const c = getPlacingConstraint(state);

    // Diagonal line from (0,0) to (100,100).
    // Perpendicular midpoint offset -> Aligned
    handleDimensionPointerMove({ clientX: 30, clientY: 70 }, svg, state, { x: 30, y: 70 });
    assert(c.dimMode === 'aligned', `Expected aligned mode in perpendicular band, got ${c.dimMode}`);
    assert(Math.abs(c.value - Math.hypot(100, 100)) < 1e-4, 'Aligned value should be Euclidean length');
    assert(c.glyphPos !== null && typeof c.glyphPos.x === 'number', 'glyphPos must be updated');

    // Pulled horizontally past endpoint (e.g. x = -40, y = 10) -> Vertical dimension
    handleDimensionPointerMove({ clientX: -40, clientY: 10 }, svg, state, { x: -40, y: 10 });
    assert(c.dimMode === 'vertical', `Expected vertical mode when pulling sideways past endpoint, got ${c.dimMode}`);
    assert(Math.abs(c.value - 100) < 1e-4, 'Vertical value should be dy = 100');

    // Pulled vertically past endpoint (e.g. x = 10, y = -50) -> Horizontal dimension
    handleDimensionPointerMove({ clientX: 10, clientY: -50 }, svg, state, { x: 10, y: -50 });
    assert(c.dimMode === 'horizontal', `Expected horizontal mode when pulling vertically past endpoint, got ${c.dimMode}`);
    assert(Math.abs(c.value - 100) < 1e-4, 'Horizontal value should be dx = 100');

    resetDimensionState(state);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: Enter (or Canvas Click) Anchors & Opens Edit Pre-filled
  // ─────────────────────────────────────────────────────────────────────────
  {
    const { state, lineShape } = createTestSketch();
    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    const c = getPlacingConstraint(state);

    // Move to horizontal placement
    handleDimensionPointerMove({ clientX: 10, clientY: -50 }, svg, state, { x: 10, y: -50 });
    assert(c.dimMode === 'horizontal');

    // Anchor via anchorPlacingDimension (what Enter key and canvas click call)
    const anchored = anchorPlacingDimension(svg, state);
    await new Promise(r => setTimeout(r, 10));
    assert(anchored === true, 'anchorPlacingDimension must return true');
    assert(c.__placing === false, 'c.__placing must be false after anchor');
    assert(!isDimensionPlacing(state), 'Placing state must be cleared');
    assert(c.dimMode === 'horizontal', 'dimMode must remain horizontal');
    assert(Math.abs(c.value - 100) < 1e-4, 'Value must be anchored to projected distance');

    // Edit input must be open and prefilled
    assert(isInputActive(), 'Numeric input manager must be active');
    assert(!dimInput.classList.contains('hidden'), '#dimInput must not be hidden');
    assert(parseFloat(dimInput.value) === 100, `Input must be pre-filled with 100, got '${dimInput.value}'`);
    assert(dimInput._selected === true, 'Input text must be selected for immediate typing');

    hideInput();
    resetDimensionState(state);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: Enter in Input Commits Value as Driving Dimension & Solves
  // ─────────────────────────────────────────────────────────────────────────
  {
    const { engine, state, lineShape, j1, j2 } = createTestSketch();
    // Fix j1 at origin so j2 moves when dimension changes
    state.joints.get(j1).fixed = true;

    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    const c = getPlacingConstraint(state);

    // Anchor
    anchorPlacingDimension(svg, state);

    // Change input value to 150
    dimInput.value = '150';

    const historyBefore = state.history.length;

    // Simulate Enter key on dimInput
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(!isInputActive(), 'Input should be closed after Enter');
    assert(c.isDriven === false && c.driven === false, 'Committed constraint must be DRIVING');
    assert(c.value === 150, 'Constraint value must be 150');
    assert(c.__newlyPlaced === false, '__newlyPlaced must be cleared on commit');

    // Verify solver ran and updated j2
    const pt2 = state.joints.get(j2);
    assert(Math.abs(Math.hypot(pt2.x, pt2.y) - 150) < 1e-3, `j2 distance should solve to 150, got ${Math.hypot(pt2.x, pt2.y)}`);

    // Verify undo stack: exactly 1 undo step was added
    assert(state.history.length === historyBefore + 1, `Expected 1 undo step added, had ${historyBefore}, now ${state.history.length}`);

    // Undo should restore previous state cleanly
    state.undo();
    assert(state.history.length === historyBefore, 'Undo restored history length');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: Esc Cancels Cleanly with NO Phantom Undo Steps
  // ─────────────────────────────────────────────────────────────────────────
  {
    // Part A: Esc while cursor-placing (before anchor)
    const { state, lineShape } = createTestSketch();
    const historyBefore = state.history.length;
    const constraintsBefore = state.constraints.length;

    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    assert(state.constraints.length === constraintsBefore + 1, 'Temporary constraint added');

    // Simulate Escape key
    resetDimensionState(state);

    assert(state.constraints.length === constraintsBefore, 'Constraint must be removed on cancel');
    assert(state.history.length === historyBefore, 'Zero phantom undo steps added to history');
    assert(!isDimensionPlacing(state), 'Placing state must be cleared');

    // Part B: Esc while inline edit box is open (before commit)
    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input must be active');
    assert(state.constraints.length === constraintsBefore + 1, 'Constraint is in state waiting for commit');

    // Simulate Escape on dimInput
    dimInput.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => {} });

    assert(!isInputActive(), 'Input should close on Escape');
    assert(state.constraints.length === constraintsBefore, 'Newly placed constraint must be removed on Escape');
    assert(state.history.length === historyBefore, 'Zero phantom undo steps in history after Escape');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: Activation via switchToTool('dim') with pre-selection
  // ─────────────────────────────────────────────────────────────────────────
  {
    const { state, lineShape } = createTestSketch();
    state.selectedShapes.add(lineShape.id);

    setupInput(svg, state);
    switchToTool(state, 'dim');

    assert(state.currentTool === TOOL_MODES.DIMENSION, 'Tool must be DIMENSION');
    assert(isDimensionPlacing(state), 'switchToTool("dim") with line pre-selected must start placing dimension');
    resetDimensionState(state);
  }

  console.log('dimension-preselection-workflow tests passed ✅');
})().catch(e => {
  console.error('dimension-preselection-workflow test failed ❌', e);
  process.exit(1);
});
