(async () => {
  const { setupDimensionInput, showDimInput, resetDimensionInputState } = await import('../apps/sketchstudio/ui/input-handlers/dimension-input.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Provide a minimal document with a fake #dimInput element
  const dimInput = {
    classList: { _set: new Set(), add(s){ this._set.add(s); }, remove(s){ this._set.delete(s); }, contains(s){ return this._set.has(s); } },
    style: {},
    focus: () => { dimInput._focused = true; },
    // selection helpers for tests
    selected: false,
    selectedRange: null,
    select: () => { dimInput.selected = true; dimInput.selectedRange = { start: 0, end: dimInput.value.length }; },
    setSelectionRange: (start, end) => { dimInput.selected = true; dimInput.selectedRange = { start, end }; },
    value: '',
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  global.document = { getElementById: (id) => id === 'dimInput' ? dimInput : null };

  // Mock svg with viewBox and getBoundingClientRect so worldToScreen works
  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
  };

  // Minimal appState
  const appState = { joints: new Map(), shapes: [], placingConstraint: null, saveState: () => {}, engine: null };

  // Minimal window shim for Node tests
  global.window = global.window || {};

  // Setup the input system
  setupDimensionInput(svg, appState);

  // Constraint with a glyphPos so showDimInput can position the input
  const c = { glyphPos: { x: 100, y: 80 }, value: 234.4 };

// Show input (no initial key) => should select the current value
  showDimInput(svg, appState, c);
  
  // The fake dimInput should be visible and the editing flag set
  assert(!dimInput.classList.contains('hidden'), 'dimInput should be visible after showDimInput');
  assert(window.__dimensionInput && window.__dimensionInput.currentConstraint === c, 'currentConstraint must be set');
  assert(c.__editing === true, 'constraint.__editing must be true while editing');
  // Because we opened without an initial key, the input's text should be selected
  assert(dimInput.selected === true, 'Input text should be selected/highlighted when opened without initial key');
  
  // Reset and validate cleanup
  resetDimensionInputState();
  assert(dimInput.classList.contains('hidden'), 'dimInput should be hidden after reset');
  assert(window.__dimensionInput && window.__dimensionInput.currentConstraint === null, 'currentConstraint must be null after reset');
  assert(c.__editing === false, 'constraint.__editing must be false after reset');

  // Show input with initial key => caret placed at end, not full selection
  showDimInput(svg, appState, c, '1');
  assert(!dimInput.classList.contains('hidden'), 'dimInput should be visible after showDimInput with key');
  // selection range should be set to the end (same start/end)
  assert(dimInput.selected === true && dimInput.selectedRange && dimInput.selectedRange.start === dimInput.selectedRange.end, 'Input should have caret at end when opened with an initial key');
  resetDimensionInputState();
  assert(dimInput.classList.contains('hidden'), 'dimInput should be hidden after reset (2)');

  console.log('dimension-inline-edit tests passed ✅');
})().catch(e => { console.error('dimension-inline-edit tests failed ❌', e); process.exit(1); });