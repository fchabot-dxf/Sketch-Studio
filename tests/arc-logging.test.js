// TASK 1039: the Arc tool runs in the tool session (#ui/tool-session.js). Its old debug buffer (window.__arcLog: a hidden global written by the
// pointer handlers) is gone with the handlers; THE record of what the tool did is the session's step log (session.log: every step picked or
// ignored, every build). Rewritten from setupDrawingTools + handleDrawingPointer* to the shared desktop translator with the same pointer sequence
// (a drag from the centre whose release sets the start, then a press + release for the end). The old assertions, read from the step log:
//   'pointerDown' / 'active-set' (the tool engaged)        -> the centre step was picked
//   'create-start-point'                                    -> the start step was picked
//   'pointerUp-result shapes 1' (TASK 1033 A-1, BUG-351)    -> the second release built the arc (one build), and one arc is drawn
(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { setupDrawingTools } = await import('#ui/input-handlers/drawing-tools.js');
  const { toolSession } = await import('#ui/tool-session.js');
  const { ARC } = await import('#ui/input-handlers/arc-tool.js');
  const { desktopTranslator: T } = await import('#ui/input-translate-desktop.js');
  const { TOOL_MODES } = await import('#core/constants.js');

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

  // Setup tools and select arc tool
  setupDrawingTools(null, state);
  state.currentTool = TOOL_MODES.ARC;
  const session = toolSession(state, ARC);
  const ev = (x, y) => ({ clientX: x, clientY: y });

  // A drag from the centre: its release sets the start
  T.down(ev(100, 100), state, session, null, { x: 100, y: 100 });
  T.move(ev(160, 100), state, session, { x: 160, y: 100 });
  T.up(ev(160, 100), state, session, null, { x: 160, y: 100 });

  // Continue arc (second press for the end)
  T.down(ev(180, 140), state, session, null, { x: 180, y: 140 });
  T.move(ev(180, 140), state, session, { x: 180, y: 140 });
  T.up(ev(180, 140), state, session, null, { x: 180, y: 140 });

  const picked = session.log.filter((e) => e.result === 'picked').map((e) => e.step);
  // Ensure we saw something
  assert(session.log.length > 0, 'No arc log entries found');
  assert(picked.includes('centre'), 'the centre step should be logged (the tool engaged)');
  assert(picked.includes('start'), 'the start step should be logged');
  // TASK 1033 (A-1, BUG-351): after the drag set the start, the second press-release places the arc (it was swallowed before 1033)
  assert(session.log.some((e) => e.build === TOOL_MODES.ARC) && session.builds === 1, 'the second release built the arc (one build)');
  assert(state.shapes.length === 1 && state.shapes[0].type === 'arc', 'one arc is drawn');

  console.log('arc-logging tests passed ✅');
})().catch(e => { console.error('arc-logging tests failed ❌', e); process.exit(1); });
