(async () => {
  const { handleArcPointerDown, handleArcPointerMove, handleArcPointerUp } = await import('#ui/input-handlers/arc-tool.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal state
  let counter = 1;
  const createState = () => ({
    joints: new Map(),
    shapes: [],
    constraints: [],
    genJ: () => 'j' + (counter++),
    beginUndoGroup: () => {},
    endUndoGroup: () => {},
    saveState: () => {}
  });

  // 1) Click (no drag) should set temporary start without creating a shape
  const state1 = createState();
  const down = { clientX: 100, clientY: 100 };
  const w = { x: 100, y: 100 };
  const okDown = handleArcPointerDown(down, null, state1, null, w);
  assert(okDown === true, 'PointerDown should be handled');
  // Immediately pointer up without move => should not finalize the arc
  const okUp = handleArcPointerUp({ clientX: 100, clientY: 100 }, null, state1, null, w, false);
  assert(okUp === true, 'PointerUp should be handled (temp start cleared)');
  assert(state1.shapes.length === 0, 'No shapes should be created on click');

  // 2) Drag should progress phases and create an arc shape (3-point)
  const state2 = createState();
  // First click to create point1
  handleArcPointerDown(down, null, state2, null, w);
  handleArcPointerUp({ clientX: 100, clientY: 100 }, null, state2, null, w, false);

  // Second press+drag -> create point2
  handleArcPointerDown({ clientX: 160, clientY: 100 }, null, state2, null, { x: 160, y: 100 });
  handleArcPointerMove({ clientX: 160, clientY: 100 }, null, state2, { x: 160, y: 100 });
  handleArcPointerUp({ clientX: 160, clientY: 100 }, null, state2, null, { x: 160, y: 100 }, true);

  // Third press+drag -> create point3 and finalize
  handleArcPointerDown({ clientX: 180, clientY: 140 }, null, state2, null, { x: 180, y: 140 });
  handleArcPointerMove({ clientX: 180, clientY: 140 }, null, state2, { x: 180, y: 140 });
  const okUp2 = handleArcPointerUp({ clientX: 180, clientY: 140 }, null, state2, null, { x: 180, y: 140 }, true);
  assert(okUp2 === true, 'PointerUp after drag should be handled');
  assert(state2.shapes.length === 1, 'An arc shape should be created after drags');

  console.log('arc-drag tests passed ✅');
})().catch(e => { console.error('arc-drag tests failed ❌', e); process.exit(1); });