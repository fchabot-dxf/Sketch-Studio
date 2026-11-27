// TASK 1039: the Arc tool runs in the tool session (#ui/tool-session.js); drawing-tools no longer dispatches it. Rewritten from
// handleDrawingPointerDown / Move / Up to the normal flow it has now: setupDrawingTools (it gives the Arc its default variant), then the shared
// desktop translator (#ui/input-translate-desktop.js) feeding the Arc's session, with the same pointer sequence. The assertions are the old ones
// (the press is handled and starts the draw, the click's release is handled, the last release places the arc), plus the default variant.
(async () => {
  const { setupDrawingTools } = await import('#ui/input-handlers/drawing-tools.js');
  const { toolSession } = await import('#ui/tool-session.js');
  const { ARC } = await import('#ui/input-handlers/arc-tool.js');
  const { desktopTranslator: T } = await import('#ui/input-translate-desktop.js');
  const { TOOL_MODES, ARC_MODES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal app state
  let counter = 1;
  const state = {
    onDrawCancelled: () => {}, // the creation tools register their box cleanup here (TASK 596)
    joints: new Map(),
    shapes: [],
    constraints: [],
    genJ: () => 'j' + (counter++),
    beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}),
    endUndoGroup: () => {},
    saveState: () => {}
  };

  // Run setup through the normal flow: it gives the Arc tool its default variant
  setupDrawingTools(null, state);
  assert(state.arcMode === ARC_MODES.CENTER_START_END, 'setupDrawingTools gives the Arc tool its default variant (Center Point Arc)');

  // Simulate selecting the arc tool in the UI
  state.currentTool = TOOL_MODES.ARC;
  const session = toolSession(state, ARC);
  const ev = (x, y) => ({ clientX: x, clientY: y });

  // Simulate first click (the centre)
  const w = { x: 100, y: 100 };
  const okDown = T.down(ev(100, 100), state, session, null, w);
  assert(okDown === true, 'the translator should handle the Arc pointerdown');
  assert(state.active && state.active.mode === TOOL_MODES.ARC, 'Arc tool should set active state on down');

  // Simulate a small move (no drag) then up - should not finalize because it's a click
  T.move(ev(101, 101), state, session, { x: 101, y: 101 });
  const okUp = T.up(ev(101, 101), state, session, null, { x: 101, y: 101 });
  assert(okUp === true, 'the pointerup should be handled');

  // Now a press + drag: its release places the start
  T.down(ev(100, 100), state, session, null, w);
  T.move(ev(150, 100), state, session, { x: 150, y: 100 });
  T.up(ev(150, 100), state, session, null, { x: 150, y: 100 });

  // The end via another press + release
  T.down(ev(175, 125), state, session, null, { x: 175, y: 125 });
  T.move(ev(175, 125), state, session, { x: 175, y: 125 });
  const okUp2 = T.up(ev(175, 125), state, session, null, { x: 175, y: 125 });
  assert(okUp2 === true, 'Final pointerUp should finalize the arc');
  assert(state.shapes.length === 1, 'Arc shape should be created through drawing flow');

  console.log('arc-integration tests passed ✅');
})().catch(e => { console.error('arc-integration tests failed ❌', e); process.exit(1); });
