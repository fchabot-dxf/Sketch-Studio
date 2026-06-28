(async () => {
  const { showEditInput, hideInput, setupNumericInput } = await import('#ui/numeric-input-manager.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal DOM & SVG mocks (reuse pattern from other tests)
  const dimInput = {
    classList: { _set: new Set(), add(s){ this._set.add(s); }, remove(s){ this._set.delete(s); }, contains(s){ return this._set.has(s); } },
    style: {},
    focus: () => {},
    select: () => {},
    value: '',
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  global.document = { getElementById: (id) => id === 'dimInput' ? dimInput : null };

  // Minimal window + raf polyfills for Node test environment
  global.window = global.window || {};
  global.requestAnimationFrame = global.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
  global.cancelAnimationFrame = global.cancelAnimationFrame || ((id) => clearTimeout(id));

  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  };

  // Minimal appState with joints/shapes/constraints
  const state = {
    joints: new Map(),
    shapes: [],
    constraints: [],
    placingConstraint: null,
    saveState: () => {},
    engine: null
  };

  // Helper to create joints
  const makeJoint = (id, x=0, y=0) => ({ id, x, y, fixed: false });

  // Setup input system
  setupNumericInput(svg, state);

  // Test 1: DISTANCE constraint edit should NOT auto-mark driven because of self-check
  const jA = makeJoint('jA', 0, 0);
  const jB = makeJoint('jB', 10, 0);
  state.joints.set(jA.id, jA);
  state.joints.set(jB.id, jB);

  const distC = { type: 'distance', joints: [jA.id, jB.id], value: 10, glyphPos: { x: 50, y: 50 } };
  state.constraints.push(distC);

  // Call showEditInput for this existing constraint (previously could mark isDriven)
  showEditInput(svg, state, distC);
  // After opening edit, the constraint must NOT be auto-marked as driven
  assert(!distC.isDriven && !distC.driven, 'Distance constraint should not be auto-marked driven when editing (self-inflicted)');
  assert(distC.__editing === true, 'Constraint should be flagged as __editing after showEditInput');
  hideInput();

  // Cleanup for next test
  distC.__editing = false;

  // Test 2: ANGLE constraint edit should behave the same
  // Create two line shapes (each with 2 joints)
  const l1j1 = makeJoint('l1j1', 0, 0);
  const l1j2 = makeJoint('l1j2', 0, 10);
  const l2j1 = makeJoint('l2j1', 0, 0);
  const l2j2 = makeJoint('l2j2', 10, 0);
  state.joints.set(l1j1.id, l1j1);
  state.joints.set(l1j2.id, l1j2);
  state.joints.set(l2j1.id, l2j1);
  state.joints.set(l2j2.id, l2j2);

  const line1 = { id: 'line1', type: 'line', joints: [l1j1.id, l1j2.id] };
  const line2 = { id: 'line2', type: 'line', joints: [l2j1.id, l2j2.id] };
  state.shapes.push(line1, line2);

  const angleC = { type: 'angle', shapes: [line1.id, line2.id], value: 90, glyphPos: { x: 100, y: 80 } };
  state.constraints.push(angleC);

  showEditInput(svg, state, angleC);
  assert(!angleC.isDriven && !angleC.driven, 'Angle constraint should not be auto-marked driven when editing (self-inflicted)');
  assert(angleC.__editing === true, 'Angle constraint should be flagged as __editing after showEditInput');
  hideInput();

  console.log('constraint-edit-driven tests passed ✅');
})().catch(e => { console.error('constraint-edit-driven tests failed ❌', e); process.exit(1); });