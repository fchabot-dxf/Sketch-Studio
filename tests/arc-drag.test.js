// TASK 1039: the Arc tool runs in the tool session (#ui/tool-session.js). Rewritten from handleArcPointerDown / Move / Up (gone) to the shared
// desktop translator (#ui/input-translate-desktop.js), the ONE place a pointer's press / move / release becomes the session's steps, with the same
// pointer sequence. The assertions are the old ones: a click alone (press + release, no drag) places no shape; the presses and releases that follow
// progress the arc and the last release places it.
(async () => {
  const { toolSession } = await import('#ui/tool-session.js');
  const { ARC } = await import('#ui/input-handlers/arc-tool.js');
  const { desktopTranslator: T } = await import('#ui/input-translate-desktop.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal state
  let counter = 1;
  const createState = () => ({
    joints: new Map(),
    shapes: [],
    constraints: [],
    arcMode: 'arc-cse',
    genJ: () => 'j' + (counter++),
    beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}),
    endUndoGroup: () => {},
    onDrawCancelled: () => {},
    saveState: () => {}
  });
  const ev = (x, y) => ({ clientX: x, clientY: y });

  // 1) Click (no drag) should set the centre without creating a shape
  const state1 = createState();
  const s1 = toolSession(state1, ARC);
  const w = { x: 100, y: 100 };
  const okDown = T.down(ev(100, 100), state1, s1, null, w);
  assert(okDown === true, 'PointerDown should be handled');
  // Immediately pointer up without move => should not finalize the arc
  const okUp = T.up(ev(100, 100), state1, s1, null, w);
  assert(okUp === true, 'PointerUp should be handled (the centre placed, the radius box up)');
  assert(state1.shapes.length === 0, 'No shapes should be created on click');

  // 2) The presses and releases that follow should progress the steps and create an arc shape
  const state2 = createState();
  const s2 = toolSession(state2, ARC);
  // First click: the centre
  T.down(ev(100, 100), state2, s2, null, w);
  T.up(ev(100, 100), state2, s2, null, w);

  // Second press + release: the start
  T.down(ev(160, 100), state2, s2, null, { x: 160, y: 100 });
  T.move(ev(160, 100), state2, s2, { x: 160, y: 100 });
  T.up(ev(160, 100), state2, s2, null, { x: 160, y: 100 });

  // Third press + release: the end, the arc is placed
  T.down(ev(180, 140), state2, s2, null, { x: 180, y: 140 });
  T.move(ev(180, 140), state2, s2, { x: 180, y: 140 });
  const okUp2 = T.up(ev(180, 140), state2, s2, null, { x: 180, y: 140 });
  assert(okUp2 === true, 'PointerUp after drag should be handled');
  assert(state2.shapes.length === 1, 'An arc shape should be created after drags');

  console.log('arc-drag tests passed ✅');
})().catch(e => { console.error('arc-drag tests failed ❌', e); process.exit(1); });
