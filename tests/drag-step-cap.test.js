// tests/drag-step-cap.test.js -- the drag step (SolverConfig.MAX_DRAG_STEP, world units), TASK 548. A joint drag's target never moves
// farther than MAX_DRAG_STEP in one go: a longer pointer jump in ONE pointer event is walked as straight sub-moves of at most that length
// from the last pointer position, each solved to convergence (SolverConfig.ITERATIONS), then the pointer itself (the quick solve, the
// app's frame solve follows). The joint ends at the cursor in that same event. Until task 548 the target was CLAMPED to MAX_DRAG_STEP from
// the joint instead, so a free joint trailed the cursor and stayed behind when the cursor stopped (tests/drag-follow.test.js measures
// that per frame; tests/drag-fling-safety.test.js shows a fling across constrained sketches stays safe).
// The solver is a stub that records every pass (its iteration count and target) and moves the dragged joint onto the target (a free joint).
import { undoStub } from './helpers/undo-stub.js';
(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('#ui/input-handlers/selection-tools.js');
  const { TOOL_MODES } = await import('#core/constants.js');
  const { SolverConfig } = await import('#core/solver-config.js');
  const QUICK = SolverConfig.QUICK_SOLVE || 8, FULL = SolverConfig.ITERATIONS || 500;

  const svg = {
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }
  };
  const quiet = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
  // a free joint 'a' at the origin of the screen, grabbed; the stub solver puts the dragged joint on each target it is given
  const freeJointDrag = () => {
    const calls = [];
    const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT, ...undoStub() };
    state.joints.set('a', { x: 0, y: 0 });
    state.engine = { solve(iters, opts) { const t = opts && opts.dragTarget; calls.push({ iters, x: t.x, y: t.y }); const j = state.joints.get(t.jointId); j.x = t.x; j.y = t.y; return {}; } };
    handleSelectionPointerDown({ clientX: 0, clientY: 0, pointerId: 1, target: { closest: () => null } }, svg, state, { id: 'a', j: state.joints.get('a') }, null, null);
    return { state, calls, move: (x, y) => quiet(() => handleSelectionPointerMove({ clientX: x, clientY: y, pointerId: 1 }, svg, state)) };
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  // 1. a far pointer jump (1000 units in one event, MAX_DRAG_STEP 100): ten sub-moves of 100, the last one AT the pointer; the target and
  //    the joint are at the cursor after this one event
  {
    const cap = SolverConfig.MAX_DRAG_STEP;
    assert(cap === 100, 'the default drag step is 100 world units, got ' + cap);
    const d = freeJointDrag();
    d.move(1000, 0);
    assert(d.calls.length === 10, `ten solver passes (1000 / 100), got ${d.calls.length}`);
    d.calls.forEach((c, k) => assert(near(c.x, 100 * (k + 1)) && near(c.y, 0), `sub-move ${k + 1} targets x=${100 * (k + 1)}, got (${c.x}, ${c.y})`));
    d.calls.slice(0, -1).forEach((c, k) => assert(c.iters === FULL, `sub-move ${k + 1} is solved to convergence (${FULL} iterations), got ${c.iters}`));
    assert(d.calls[9].iters === QUICK, `the pass at the pointer is the quick solve (${QUICK}), got ${d.calls[9].iters}`);
    const dt = d.state.joints.get('a').dragTarget, j = d.state.joints.get('a');
    assert(near(dt.x, 1000) && near(dt.y, 0), `the drag target is the cursor (1000, 0), got (${dt.x}, ${dt.y})`);
    assert(near(j.x, 1000) && near(j.y, 0), `the joint is under the cursor after the event, got (${j.x}, ${j.y})`);
    assert(near(d.state.drag.lastTarget.x, 1000), 'lastTarget is the cursor');
    // 2. the next event walks on from the LAST POINTER position (1000 -> 1150: two sub-moves of 75)
    d.calls.length = 0;
    d.move(1150, 0);
    assert(d.calls.length === 2 && near(d.calls[0].x, 1075) && near(d.calls[1].x, 1150), 'the next jump starts at the last pointer: ' + JSON.stringify(d.calls));
  }

  // 3. a small pointer move is one pass straight at the pointer, unchanged
  {
    const d = freeJointDrag();
    d.move(5, 7);
    assert(d.calls.length === 1 && d.calls[0].iters === QUICK, 'one quick pass: ' + JSON.stringify(d.calls));
    const dt = d.state.joints.get('a').dragTarget;
    assert(near(dt.x, 5) && near(dt.y, 7), `a small move passes through unchanged, got (${dt.x}, ${dt.y})`);
  }

  // 4. the step honours SolverConfig.MAX_DRAG_STEP at runtime (25: forty sub-moves, none longer than 25), and 0 disables it (one pass)
  for (const [cap, n] of [[25, 40], [0, 1]]) {
    const original = SolverConfig.MAX_DRAG_STEP;
    SolverConfig.MAX_DRAG_STEP = cap;
    try {
      const d = freeJointDrag();
      d.move(1000, 0);
      assert(d.calls.length === n, `MAX_DRAG_STEP ${cap}: ${n} passes, got ${d.calls.length}`);
      let prev = 0;
      for (const c of d.calls) { if (cap) assert(c.x - prev <= cap + 1e-9, `MAX_DRAG_STEP ${cap}: a step of ${c.x - prev}`); prev = c.x; }
      assert(near(d.state.joints.get('a').dragTarget.x, 1000), `MAX_DRAG_STEP ${cap}: the target ends at the cursor`);
    } finally {
      SolverConfig.MAX_DRAG_STEP = original;
    }
  }

  // 5. a BODY drag (task 538) never had the step: one pass at the pointer whatever the jump
  {
    const calls = [];
    const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 20, y: 0 }]]), shapes: [{ id: 'L', type: 'line', joints: ['a', 'b'] }], currentTool: TOOL_MODES.SELECT, ...undoStub() };
    state.engine = {
      bodyDragTarget: (body, c) => ({ body: { shape: body.shape, param: body.param, hold: [] }, x: c.x, y: c.y }),
      solve(iters, opts) { calls.push({ iters, x: opts.dragTarget.x }); return {}; }
    };
    handleSelectionPointerDown({ clientX: 10, clientY: 0, pointerId: 1, target: { closest: () => null } }, svg, state, null, { shape: state.shapes[0], pt: { x: 10, y: 0 } }, null);
    assert(state.drag && state.drag.body, 'a body drag started');
    quiet(() => handleSelectionPointerMove({ clientX: 1010, clientY: 0, pointerId: 1 }, svg, state));
    assert(calls.length === 1 && calls[0].iters === QUICK && near(calls[0].x, 1010), 'a body drag: one quick pass at the pointer: ' + JSON.stringify(calls));
  }

  console.log('drag step tests passed ✅');
})().catch(e => { console.error('drag step tests failed ❌', e); process.exit(1); });
