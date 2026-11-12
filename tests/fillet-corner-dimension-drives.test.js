import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { findCornerAtPoint, applyFillet } from '#core/fillet.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

// TASK 486 (2nd bug): a distance between the two top fillet corners (virtual sharps) must DRIVE while the sketch still has
// freedom, even though the per-joint DOF heuristic reads 0 for those joints. A second one (now determined) stays driven.
(async () => {
  const dimInput = {
    classList: { _set: new Set(), add(s) { this._set.add(s); }, remove(s) { this._set.delete(s); }, contains(s) { return this._set.has(s); } },
    style: {}, focus() {}, select() {}, value: '', addEventListener() {}, removeEventListener() {}
  };
  global.document = { getElementById: (id) => (id === 'dimInput' ? dimInput : null) };
  global.window = global.window || {};
  global.requestAnimationFrame = global.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
  global.cancelAnimationFrame = global.cancelAnimationFrame || ((id) => clearTimeout(id));
  const { showEditInput, hideInput, setupNumericInput } = await import('#ui/numeric-input-manager.js');

  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const engine = createEngine(null);
  engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
  state.saveState = () => {};
  setupNumericInput(svg, state);
  // the 'already determined -> driven' notice is raised for real (no swallowed error): give it a DOM that can build its toast container (it is never found again, so no toast is drawn)
  global.document.createElement = () => ({ style: {} });
  global.document.body = { appendChild() {} };
  const J = (id, x, y, fixed = false) => { engine.addJoint(id, x, y, fixed); state.joints.set(id, { x, y, fixed }); };
  const L = (id, a, b) => engine.addShape({ id, type: 'line', joints: [a, b] });
  const C = (type, o) => ConstraintManager.createConstraint(state, type, o, { source: 'test' });

  J('tl', -20, 0); J('tr', 20, 0); J('bl', -10, 60); J('br', 10, 60); J('mv', 0, 0); J('c', 0, 23.6, true);
  L('top', 'tl', 'tr'); L('left', 'tl', 'bl'); L('right', 'tr', 'br'); L('mid', 'mv', 'c');
  C(CONSTRAINT_TYPES.HORIZONTAL, { joints: ['tl', 'tr'] });
  C(CONSTRAINT_TYPES.HORIZONTAL, { joints: ['bl', 'br'] });
  C(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: 'mv', shape: 'top' });
  C(CONSTRAINT_TYPES.VERTICAL, { joints: ['mv', 'c'] });
  C(CONSTRAINT_TYPES.DISTANCE, { joints: ['mv', 'c'], value: 23.6 });
  assert(engine.solve(500).converged, 'initial solve converged');

  const vs = [];
  for (const [x, y] of [[-20, 0], [20, 0]]) {
    const r = applyFillet(state, findCornerAtPoint(state, { x, y }, 3), 0.8);
    assert(r && r.success, 'fillet applied');
    vs.push(r.virtualSharp);
    await new Promise(res => setTimeout(res, 5)); // arc ids are Date.now()-based
  }
  assert(engine.solve(500).converged, 'solve after fillets converged');

  const dist = () => { const a = state.joints.get(vs[0]), b = state.joints.get(vs[1]); return Math.hypot(a.x - b.x, a.y - b.y); };

  // 1. width between the corners is NOT yet determined: it must drive and move geometry when edited
  const dim = { type: CONSTRAINT_TYPES.DISTANCE, joints: [...vs], value: 15.7, dimMode: 'aligned', isDriven: false };
  state.constraints.push(dim);
  showEditInput(svg, state, dim);
  assert(!dim.isDriven && !dim.driven, 'corner-to-corner dimension on a sketch with free width must be DRIVING');
  hideInput();
  const r = commitDimensionEdit(state, dim, 15.7);
  assert(!r.reverted, 'commit converged: ' + r.clash);
  assert(Math.abs(dist() - 15.7) < 1e-3, 'corner distance moved to 15.7, got ' + dist());
  const r2 = commitDimensionEdit(state, dim, 22);
  assert(!r2.reverted && Math.abs(dist() - 22) < 1e-3, 'edit to 22 moves the geometry, got ' + dist());

  // 2. a second dimension on the same pair is now genuinely determined: still reference
  const dim2 = { type: CONSTRAINT_TYPES.DISTANCE, joints: [...vs], value: 22, dimMode: 'aligned', isDriven: false };
  state.constraints.push(dim2);
  showEditInput(svg, state, dim2);
  assert(dim2.isDriven === true, 'a second dimension on an already-determined pair stays driven');
  hideInput();

  console.log('fillet-corner-dimension-drives passed');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
