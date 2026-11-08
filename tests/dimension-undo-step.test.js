// tests/dimension-undo-step.test.js
// Verification for Task 438:
// A new dimension (value included) is ONE undo step, and Escape leaves no history entry.
// Click paths are measured and reported without being modified.

(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const { createEngine } = await import('#core/constraint-solver.js');
  const { createSketchState } = await import('#ui/sketch-state.js');
  const { CONSTRAINT_TYPES, TOOL_MODES } = await import('#core/constants.js');
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const {
    startDimensionFromSelection,
    anchorPlacingDimension,
    handleDimensionPointerDown,
    resetDimensionState
  } = await import('#ui/input-handlers/dimension-tool.js');
  const { setupNumericInput, showEditInput, hideInput, isInputActive } = await import('#ui/numeric-input-manager.js');

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
    head: { appendChild: () => {}, querySelector: () => null },
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
    // Add two joints forming a horizontal line (0,0) to (100, 0)
    const j1 = engine.genJ();
    engine.addJoint(j1, 0, 0, false);
    const j2 = engine.genJ();
    engine.addJoint(j2, 100, 0, false);
    const lineShape = { id: 's_line1', type: 'line', joints: [j1, j2] };
    state.shapes.push(lineShape);
    setupNumericInput(svg, state);
    return { engine, state, j1, j2, lineShape };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T1: Line pre-selection -> DIM -> anchor -> commit 50 -> 1 undo removes dim
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running T1: line pre-selection single-undo...');
    const { state, lineShape, j1, j2 } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.selectedShapes.add(lineShape.id);
    const started = startDimensionFromSelection(svg, state);
    assert(started, 'startDimensionFromSelection must succeed');

    const anchored = anchorPlacingDimension(svg, state);
    assert(anchored, 'anchorPlacingDimension must succeed');
    assert(isInputActive(), 'numeric input must be active');

    dimInput.value = '50';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.history.length === historyBefore + 1, `Expected history to grow by exactly 1 (from ${historyBefore} to ${historyBefore + 1}), got ${state.history.length}`);

    const dim = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dim, 'Distance constraint must exist');
    assert(dim.value === 50, `Distance constraint value should be 50, got ${dim.value}`);

    state.undo();

    const dimAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(!dimAfter, `One undo() must leave NO distance constraint, but found: ${JSON.stringify(dimAfter)}`);
    const pt1 = state.joints.get(j1);
    const pt2 = state.joints.get(j2);
    const len = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);
    assert(Math.abs(len - 100) < 1e-3, `Line must be at original length 100, got ${len}`);
    assert(state.history.length === historyBefore, `History length must be restored to ${historyBefore}`);
    console.log('T1 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T2: Two selected joints -> DIM -> anchor -> commit 50 -> 1 undo removes dim
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running T2: two selected joints single-undo...');
    const { state, j1, j2 } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.selectedJoints.add(j1);
    state.selectedJoints.add(j2);
    const started = startDimensionFromSelection(svg, state);
    assert(started, 'startDimensionFromSelection must succeed for 2 joints');

    const anchored = anchorPlacingDimension(svg, state);
    assert(anchored, 'anchorPlacingDimension must succeed');

    dimInput.value = '50';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.history.length === historyBefore + 1, `Expected history to grow by 1, had ${historyBefore}, now ${state.history.length}`);
    const dim = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dim, 'Distance constraint must exist');
    assert(dim.value === 50, 'Distance constraint value must be 50');

    state.undo();

    const dimAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(!dimAfter, 'One undo() must leave NO distance constraint');
    const pt1 = state.joints.get(j1);
    const pt2 = state.joints.get(j2);
    const len = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);
    assert(Math.abs(len - 100) < 1e-3, `Joints must be at original distance 100, got ${len}`);
    assert(state.history.length === historyBefore, `History length must be restored to ${historyBefore}`);
    console.log('T2 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T3: Escape while placing (resetDimensionState)
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running T3: Escape while placing...');
    const { state, lineShape } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    assert(state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'Placing constraint added');

    resetDimensionState(state);

    assert(state.history.length === historyBefore, `History length must be unchanged, had ${historyBefore}, got ${state.history.length}`);
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No distance constraint after resetDimensionState');
    console.log('T3 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T4: Escape in the value box of a new dimension (handleCancel path)
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running T4: Escape in value box...');
    const { state, lineShape } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input must be active');

    dimInput.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => {} });

    assert(!isInputActive(), 'Input must be closed');
    assert(state.history.length === historyBefore, `History length must be unchanged after Escape, had ${historyBefore}, got ${state.history.length}`);
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No distance constraint after Escape');
    console.log('T4 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T5: Editing an EXISTING dimension's value adds exactly 1 history entry,
  //     and one undo restores the old value.
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running T5: editing existing dimension regression...');
    const { state, lineShape } = createTestSketch();
    state.saveState();

    state.selectedShapes.add(lineShape.id);
    startDimensionFromSelection(svg, state);
    anchorPlacingDimension(svg, state);
    dimInput.value = '100';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    const dim = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dim, 'Dimension exists');
    assert(dim.value === 100, 'Initial dimension value is 100');
    assert(dim.__newlyPlaced === false, '__newlyPlaced must be false for existing dimension');

    const historyBeforeEdit = state.history.length;

    showEditInput(svg, state, dim);
    assert(isInputActive(), 'Edit input opened');
    dimInput.value = '120';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.history.length === historyBeforeEdit + 1, `Editing existing dimension must add exactly 1 history entry, had ${historyBeforeEdit}, got ${state.history.length}`);
    assert(dim.value === 120, 'Dimension value updated to 120');

    state.undo();
    assert(state.history.length === historyBeforeEdit, 'Undo restored history length');
    const dimRestored = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dimRestored, 'Dimension must still exist after undoing edit');
    assert(Math.abs(dimRestored.value - 100) < 1e-3, `Old value 100 restored, got ${dimRestored.value}`);
    console.log('T5 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLICK PATH TESTS (TASK 438b)
  // ─────────────────────────────────────────────────────────────────────────

  // C1: Click Line -> create + commit 75 -> 1 undo removes dim
  {
    console.log('Running C1: click line single-undo...');
    const { state, lineShape, j1, j2 } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    handleDimensionPointerDown(pt, svg, state, null, { shape: lineShape }, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');
    dimInput.value = '75';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.history.length === historyBefore + 1, `History should grow by 1, had ${historyBefore}, got ${state.history.length}`);
    const dim = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dim, 'Distance constraint must exist');
    assert(dim.value === 75, `Distance constraint value should be 75, got ${dim.value}`);

    state.undo();

    const dimAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(!dimAfter, `One undo() must leave NO distance constraint, but found: ${JSON.stringify(dimAfter)}`);
    const pt1 = state.joints.get(j1);
    const pt2 = state.joints.get(j2);
    const len = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);
    assert(Math.abs(len - 100) < 1e-3, `Line must be at original length 100, got ${len}`);
    assert(state.history.length === historyBefore, `History length must be restored to ${historyBefore}`);
    console.log('C1 passed ✅');
  }

  // C1-Esc1: Click Line -> Escape while placing (resetDimensionState)
  {
    console.log('Running C1-Esc1: click line Escape while placing...');
    const { state, lineShape } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    handleDimensionPointerDown(pt, svg, state, null, { shape: lineShape }, null);
    assert(state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'Placing constraint added');

    resetDimensionState(state);

    assert(state.history.length === historyBefore, `History length must be unchanged after Escape while placing, had ${historyBefore}, got ${state.history.length}`);
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No distance constraint after resetDimensionState');
    console.log('C1-Esc1 passed ✅');
  }

  // C1-Esc2: Click Line -> anchor -> Escape in value box (handleCancel)
  {
    console.log('Running C1-Esc2: click line Escape in value box...');
    const { state, lineShape } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    handleDimensionPointerDown(pt, svg, state, null, { shape: lineShape }, null);
    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');

    dimInput.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => {} });

    assert(!isInputActive(), 'Input must be closed');
    assert(state.history.length === historyBefore, `History length must be unchanged after Escape in value box, had ${historyBefore}, got ${state.history.length}`);
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No distance constraint after Escape');
    console.log('C1-Esc2 passed ✅');
  }

  // C2: Click Radius (circle shape) -> create + commit 35 -> 1 undo removes dim
  {
    console.log('Running C2: click radius single-undo...');
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    const jc = engine.genJ();
    engine.addJoint(jc, 0, 0, true);
    const jr = engine.genJ();
    engine.addJoint(jr, 20, 0, false);
    const circleShape = { id: 's_circle1', type: 'circle', joints: [jc], radius: 20 };
    state.shapes.push(circleShape);
    setupNumericInput(svg, state);
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt = { clientX: 20, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    handleDimensionPointerDown(pt, svg, state, null, { shape: circleShape }, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');
    dimInput.value = '35';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.history.length === historyBefore + 1, `History should grow by 1, had ${historyBefore}, got ${state.history.length}`);
    const dim = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dim, 'Radius distance constraint must exist');
    assert(dim.value === 35, `Radius value should be 35, got ${dim.value}`);

    state.undo();

    const dimAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(!dimAfter, `One undo() must leave NO radius constraint, but found: ${JSON.stringify(dimAfter)}`);
    assert(state.history.length === historyBefore, `History length must be restored to ${historyBefore}`);
    console.log('C2 passed ✅');
  }

  // C2-Esc: Click Radius -> Escape while placing
  {
    console.log('Running C2-Esc: click radius Escape while placing...');
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    const jc = engine.genJ();
    engine.addJoint(jc, 0, 0, true);
    const jr = engine.genJ();
    engine.addJoint(jr, 20, 0, false);
    const circleShape = { id: 's_circle1', type: 'circle', joints: [jc], radius: 20 };
    state.shapes.push(circleShape);
    setupNumericInput(svg, state);
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt = { clientX: 20, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    handleDimensionPointerDown(pt, svg, state, null, { shape: circleShape }, null);
    assert(state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'Placing constraint added');

    resetDimensionState(state);

    assert(state.history.length === historyBefore, `History length must be unchanged after Escape while placing radius, had ${historyBefore}, got ${state.history.length}`);
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No radius constraint after resetDimensionState');
    console.log('C2-Esc passed ✅');
  }

  // C3: Click Two Points (point-to-point) -> create + commit 60 -> 1 undo removes dim
  {
    console.log('Running C3: click two points single-undo...');
    const { state, j1, j2 } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt1 = { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const pt2 = { clientX: 100, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const joint1 = state.joints.get(j1);
    const joint2 = state.joints.get(j2);

    // Click 1st joint
    handleDimensionPointerDown(pt1, svg, state, { id: j1, j: joint1 }, null, null);
    // Click 2nd joint
    handleDimensionPointerDown(pt2, svg, state, { id: j2, j: joint2 }, null, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');
    dimInput.value = '60';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.history.length === historyBefore + 1, `History should grow by 1, had ${historyBefore}, got ${state.history.length}`);
    const dim = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(dim, 'Point-to-point distance constraint must exist');
    assert(dim.value === 60, `Value should be 60, got ${dim.value}`);

    state.undo();

    const dimAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.DISTANCE);
    assert(!dimAfter, `One undo() must leave NO distance constraint, but found: ${JSON.stringify(dimAfter)}`);
    assert(state.history.length === historyBefore, `History length must be restored to ${historyBefore}`);
    console.log('C3 passed ✅');
  }

  // C3-Esc: Click Two Points -> Escape while placing
  {
    console.log('Running C3-Esc: click two points Escape while placing...');
    const { state, j1, j2 } = createTestSketch();
    state.saveState();
    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt1 = { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const pt2 = { clientX: 100, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const joint1 = state.joints.get(j1);
    const joint2 = state.joints.get(j2);

    handleDimensionPointerDown(pt1, svg, state, { id: j1, j: joint1 }, null, null);
    handleDimensionPointerDown(pt2, svg, state, { id: j2, j: joint2 }, null, null);
    assert(state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'Placing constraint added');

    resetDimensionState(state);

    assert(state.history.length === historyBefore, `History length must be unchanged after Escape while placing 2-point dim, had ${historyBefore}, got ${state.history.length}`);
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No distance constraint after resetDimensionState');
    console.log('C3-Esc passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C4: Click Two Non-Parallel Lines -> Angle -> value -> ONE undo removes it,
  //     and prior action (draw a line first) is still undoable afterwards.
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running C4: click two non-parallel lines single-undo...');
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    setupNumericInput(svg, state);

    // Initial state before prior action
    const historyInitial = state.history.length;

    // Prior action: draw base line 0
    const j0a = engine.genJ(); engine.addJoint(j0a, -50, -50, true);
    const j0b = engine.genJ(); engine.addJoint(j0b, -10, -50, false);
    const line0 = { id: 's_line0', type: 'line', joints: [j0a, j0b] };
    state.shapes.push(line0);
    state.saveState();

    // Draw two non-parallel lines (Line 1 horizontal, Line 2 vertical)
    const j1a = engine.genJ(); engine.addJoint(j1a, 0, 0, true);
    const j1b = engine.genJ(); engine.addJoint(j1b, 100, 0, false);
    const line1 = { id: 's_line1', type: 'line', joints: [j1a, j1b] };
    state.shapes.push(line1);

    const j2a = engine.genJ(); engine.addJoint(j2a, 0, 0, true);
    const j2b = engine.genJ(); engine.addJoint(j2b, 0, 100, false);
    const line2 = { id: 's_line2', type: 'line', joints: [j2a, j2b] };
    state.shapes.push(line2);
    const historyBeforeDim = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt1 = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const pt2 = { clientX: 0, clientY: 50, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };

    // Click line 1 (starts pending length dim)
    handleDimensionPointerDown(pt1, svg, state, null, { shape: line1 }, null);
    // Click line 2 (upgrades to angle dim)
    handleDimensionPointerDown(pt2, svg, state, null, { shape: line2 }, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');
    dimInput.value = '45';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    const ang = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.ANGLE);
    assert(ang, 'Angle constraint must exist');
    assert(ang.value === 45, `Angle value should be 45, got ${ang.value}`);
    assert(state.history.length === historyBeforeDim + 1, `History should grow by 1, had ${historyBeforeDim}, now ${state.history.length}`);

    // Undo 1: angle dimension is removed, Line 1 & Line 2 remain
    state.undo();
    const angAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.ANGLE);
    assert(!angAfter, `One undo() must leave NO angle constraint, but found: ${JSON.stringify(angAfter)}`);
    assert(state.history.length === historyBeforeDim, `History length must be restored to ${historyBeforeDim}, got ${state.history.length}`);
    assert(state.shapes.some(s => s.id === line1.id), 'Line 1 must still exist after undoing angle');
    assert(state.shapes.some(s => s.id === line2.id), 'Line 2 must still exist after undoing angle');

    // Undo 2: prior action (lines 1 & 2) is undone, returning to line 0
    state.undo();
    assert(state.history.length === historyInitial, `Second undo must restore history to ${historyInitial}, got ${state.history.length}`);
    assert(!state.shapes.some(s => s.id === line1.id), 'Line 1 undone');
    assert(!state.shapes.some(s => s.id === line2.id), 'Line 2 undone');
    assert(state.shapes.some(s => s.id === line0.id), 'Line 0 still exists');
    console.log('C4 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C4-Esc: Escape in the angle value box leaves history EXACTLY as before
  //         (length and top snapshot).
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running C4-Esc: Escape in angle value box leaves history unchanged...');
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    setupNumericInput(svg, state);

    // Prior action: line 0
    const j0a = engine.genJ(); engine.addJoint(j0a, -50, -50, true);
    const j0b = engine.genJ(); engine.addJoint(j0b, -10, -50, false);
    state.shapes.push({ id: 's_line0', type: 'line', joints: [j0a, j0b] });
    state.saveState();

    // Lines 1 and 2
    const j1a = engine.genJ(); engine.addJoint(j1a, 0, 0, true);
    const j1b = engine.genJ(); engine.addJoint(j1b, 100, 0, false);
    const line1 = { id: 's_line1', type: 'line', joints: [j1a, j1b] };
    state.shapes.push(line1);

    const j2a = engine.genJ(); engine.addJoint(j2a, 0, 0, true);
    const j2b = engine.genJ(); engine.addJoint(j2b, 0, 100, false);
    const line2 = { id: 's_line2', type: 'line', joints: [j2a, j2b] };
    state.shapes.push(line2);
    state.saveState();

    const historyBeforeDim = state.history.length;
    const topSnapshotBefore = state.history[state.history.length - 1];

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt1 = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const pt2 = { clientX: 0, clientY: 50, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };

    handleDimensionPointerDown(pt1, svg, state, null, { shape: line1 }, null);
    handleDimensionPointerDown(pt2, svg, state, null, { shape: line2 }, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');

    dimInput.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => {} });

    assert(!isInputActive(), 'Input must be closed');
    assert(state.history.length === historyBeforeDim, `History length must be unchanged after Escape, had ${historyBeforeDim}, got ${state.history.length}`);
    assert(state.history[state.history.length - 1] === topSnapshotBefore, 'Top snapshot must be identical reference before and after Escape');
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.ANGLE), 'No angle constraint after Escape');
    assert(!state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'No distance constraint after Escape');
    console.log('C4-Esc passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C5: Dimension two lines that already have an angle dimension -> Escape
  //     in the box -> the existing dimension is STILL there.
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running C5: dimension existing angle dimension -> Escape leaves it intact...');
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    setupNumericInput(svg, state);

    const j1a = engine.genJ(); engine.addJoint(j1a, 0, 0, true);
    const j1b = engine.genJ(); engine.addJoint(j1b, 100, 0, false);
    const line1 = { id: 's_line1', type: 'line', joints: [j1a, j1b] };
    state.shapes.push(line1);

    const j2a = engine.genJ(); engine.addJoint(j2a, 0, 0, true);
    const j2b = engine.genJ(); engine.addJoint(j2b, 0, 100, false);
    const line2 = { id: 's_line2', type: 'line', joints: [j2a, j2b] };
    state.shapes.push(line2);

    // Create existing angle constraint
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.ANGLE, {
      shapes: [line1.id, line2.id],
      value: 90
    });
    const existingAngle = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.ANGLE);
    assert(existingAngle, 'Existing angle constraint created');
    existingAngle.__newlyPlaced = false;
    existingAngle.__placing = false;
    state.saveState();

    const historyBefore = state.history.length;

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt1 = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const pt2 = { clientX: 0, clientY: 50, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };

    // Click line 1 then line 2 (recovers existing angle constraint)
    handleDimensionPointerDown(pt1, svg, state, null, { shape: line1 }, null);
    handleDimensionPointerDown(pt2, svg, state, null, { shape: line2 }, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');

    dimInput.dispatchEvent({ type: 'keydown', key: 'Escape', stopPropagation: () => {} });

    assert(!isInputActive(), 'Input must be closed');
    const angleAfter = state.constraints.find(c => c && c.type === CONSTRAINT_TYPES.ANGLE);
    assert(angleAfter === existingAngle, 'The existing angle dimension must STILL be present after Escape');
    assert(state.history.length === historyBefore, `History length must be unchanged, had ${historyBefore}, got ${state.history.length}`);
    console.log('C5 passed ✅');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MEASURE: Click path dimension undo count (must now be 1)
  // ─────────────────────────────────────────────────────────────────────────
  {
    console.log('Running click-path measurement...');
    const { state, lineShape } = createTestSketch();
    state.saveState();

    state.currentTool = TOOL_MODES.DIMENSION;
    const pt = { clientX: 50, clientY: 0, pointerId: 1, pointerType: 'mouse', target: { closest: () => null } };
    const hitShape = { shape: lineShape };
    handleDimensionPointerDown(pt, svg, state, null, hitShape, null);

    anchorPlacingDimension(svg, state);
    assert(isInputActive(), 'Input active');
    dimInput.value = '75';
    dimInput.dispatchEvent({ type: 'keydown', key: 'Enter', stopPropagation: () => {} });

    assert(state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE), 'Distance constraint exists');

    let undoCount = 0;
    while (state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE) && undoCount < 10) {
      state.undo();
      undoCount++;
    }
    console.log(`CLICK_PATH_UNDO_COUNT: ${undoCount}`);
    assert(undoCount === 1, `CLICK_PATH_UNDO_COUNT must now be 1, got ${undoCount}`);
  }

  console.log('ALL dimension-undo-step tests passed ✅');
})().catch(e => {
  console.error('dimension-undo-step test failed ❌', e);
  process.exit(1);
});
