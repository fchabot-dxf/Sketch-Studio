// H/V dimensions through the real app path (ConstraintManager + engine): they DRIVE, an edit moves only that axis,
// and the verifier's |dx| / |dy| agrees with the solver's signed residual (value >= 0, sign locked).
globalThis.document = globalThis.document || { getElementById: () => null };
(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const { createEngine } = await import('#core/constraint-solver.js');
  const { createSketchState } = await import('#ui/sketch-state.js');
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const { measureResidual } = await import('#core/constraint-verifier.js');
  const { commitDimensionEdit } = await import('#ui/dimension-seams.js');

  for (const [mode, value, key] of [['horizontal', 10, 'x'], ['vertical', 5, 'y']]) {
    const engine = createEngine(null); engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 120, h: 90 });
    const a = engine.genJ(); engine.addJoint(a, 0, 0, true);
    const b = engine.genJ(); engine.addJoint(b, 10, 5, false);
    // value chosen so the old Euclidean solver would have had to move b off-axis
    const c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [a, b], value: mode === 'horizontal' ? 7 : 3, dimMode: mode }, { source: 'dim' });
    assert(c && !c.isDriven && !c.driven, `${mode}: the dim is a DRIVING dim (not demoted to reference)`);
    const r = engine.solve(300);
    assert(r.converged !== false, `${mode}: converges`);
    const q = state.joints.get(b);
    if (mode === 'horizontal') assert(Math.abs(q.x - 7) < 1e-6 && Math.abs(q.y - 5) < 1e-6, `H: expected (7,5), got (${q.x},${q.y})`);
    else assert(Math.abs(q.y - 3) < 1e-6 && Math.abs(q.x - 10) < 1e-6, `V: expected (10,3), got (${q.x},${q.y})`);
    assert(measureResidual(c, state.joints, state.shapes) < 1e-6, `${mode}: verifier measures |d${key}| and agrees`);
    // an edit through the app's seam moves only that axis
    const e = commitDimensionEdit(state, c, mode === 'horizontal' ? 12 : 8);
    assert(!e.reverted, `${mode}: edit accepted`);
    const q2 = state.joints.get(b);
    if (mode === 'horizontal') assert(Math.abs(q2.x - 12) < 1e-6 && Math.abs(q2.y - 5) < 1e-6, `H edit: got (${q2.x},${q2.y})`);
    else assert(Math.abs(q2.y - 8) < 1e-6 && Math.abs(q2.x - 10) < 1e-6, `V edit: got (${q2.x},${q2.y})`);
    assert(measureResidual(c, state.joints, state.shapes) < 1e-6, `${mode}: verifier still agrees after the edit`);
  }
  console.log('distance-hv-dims test passed ✅');
})().catch(e => { console.error('distance-hv-dims test failed ❌', e.message); process.exit(1); });
