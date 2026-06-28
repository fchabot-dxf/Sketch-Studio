(async () => {
  const { solveConstraints } = await import('#core/solver-core.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Helper to run the scenario and basic sanity checks
  const runScenario = (jointsMap, shapes, constraints, opts = {}) => {
    const joints = new Map(Object.entries(jointsMap));
    solveConstraints(joints, shapes, constraints, 500);
    return Object.fromEntries(Array.from(joints.entries()).map(([k, v]) => [k, { x: v.x, y: v.y, fixed: !!v.fixed }]));
  };

  // ---------- Scenario A: anchored midpoint (expected stable) ----------
  const jointsA = {
    o: { x: 0, y: 0, fixed: true },
    bl: { x: -10, y: 0 }, br: { x: 10, y: 0 },
    tl: { x: -10, y: 50 }, tr: { x: 10, y: 40 }
  };
  const shapesA = [
    { id: 'h', type: 'line', joints: ['bl', 'br'] },
    { id: 'L1', type: 'line', joints: ['bl', 'tl'] },
    { id: 'L2', type: 'line', joints: ['br', 'tr'] }
  ];
  const constraintsA = [
    { type: CONSTRAINT_TYPES.MIDPOINT, joints: ['bl', 'br', 'o'] },
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['bl', 'br'] },
    { type: CONSTRAINT_TYPES.EQUAL, shapes: ['L1', 'L2'] }
  ];

  const afterA = runScenario(jointsA, shapesA, constraintsA);
  // Findings: anchored midpoint — system remains stable, bottoms distinct, midpoint unchanged, lengths equalized
  console.log('Scenario A (anchored midpoint) joints after solve:', afterA);
  assert(Math.hypot(afterA.bl.x - afterA.br.x, afterA.bl.y - afterA.br.y) > 1e-2, 'A: bottom endpoints collapsed');
  assert(Math.hypot(afterA.o.x, afterA.o.y) < 1e-3, 'A: anchored midpoint moved');
  const lenAL = Math.hypot(afterA.tl.x - afterA.bl.x, afterA.tl.y - afterA.bl.y);
  const lenAR = Math.hypot(afterA.tr.x - afterA.br.x, afterA.tr.y - afterA.br.y);
  assert(Math.abs(lenAL - lenAR) < 0.5, `A: lengths not equalized (L=${lenAL.toFixed(2)} R=${lenAR.toFixed(2)})`);

  // ---------- Scenario B: midpoint NOT anchored (midpoint joint free) ----------
  // This is often a user source of collapse if the assembly isn't sufficiently constrained.
  const jointsB = { ...jointsA, o: { x: 0, y: 0 /* not fixed */ } };
  const afterB = runScenario(jointsB, shapesA, constraintsA);
  console.log('Scenario B (midpoint not anchored) joints after solve:', afterB);
  // Sanity: bottoms should still remain distinct (no collapse to a single point)
  assert(Math.hypot(afterB.bl.x - afterB.br.x, afterB.bl.y - afterB.br.y) > 1e-2, 'B: bottom endpoints collapsed');
  // Equal should try to equalize lengths — allow larger tolerance since midpoint free permits more motion
  const lenBL = Math.hypot(afterB.tl.x - afterB.bl.x, afterB.tl.y - afterB.bl.y);
  const lenBR = Math.hypot(afterB.tr.x - afterB.br.x, afterB.tr.y - afterB.br.y);
  assert(Math.abs(lenBL - lenBR) < 2.0, `B: lengths diverged unexpectedly (L=${lenBL.toFixed(2)} R=${lenBR.toFixed(2)})`);

  // ---------- Scenario C: anchored midpoint + extra unconstrained top geometry ----------
  // User mentioned "add extra lines unconstrained at the top" — ensure Equal doesn't collapse when tops have extra free attachments.
  const jointsC = {
    o: { x: 0, y: 0, fixed: true },
    bl: { x: -10, y: 0 }, br: { x: 10, y: 0 },
    tl: { x: -10, y: 50 }, tr: { x: 10, y: 40 },
    // extra free joints attached to the top ends
    tlex: { x: -8, y: 52 }, trex: { x: 12, y: 42 }
  };
  const shapesC = [
    { id: 'h', type: 'line', joints: ['bl', 'br'] },
    { id: 'L1', type: 'line', joints: ['bl', 'tl'] },
    { id: 'L2', type: 'line', joints: ['br', 'tr'] },
    // extra unconstrained small segments attached to the top joints
    { id: 'lex', type: 'line', joints: ['tl', 'tlex'] },
    { id: 'rex', type: 'line', joints: ['tr', 'trex'] }
  ];
  const constraintsC = [
    { type: CONSTRAINT_TYPES.MIDPOINT, joints: ['bl', 'br', 'o'] },
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['bl', 'br'] },
    { type: CONSTRAINT_TYPES.EQUAL, shapes: ['L1', 'L2'] }
  ];

  const afterC = runScenario(jointsC, shapesC, constraintsC);
  console.log('Scenario C (anchored midpoint + extra top segments) joints after solve:', afterC);
  // Ensure no collapse and lengths equalized
  assert(Math.hypot(afterC.bl.x - afterC.br.x, afterC.bl.y - afterC.br.y) > 1e-2, 'C: bottom endpoints collapsed');
  const lenCL = Math.hypot(afterC.tl.x - afterC.bl.x, afterC.tl.y - afterC.bl.y);
  const lenCR = Math.hypot(afterC.tr.x - afterC.br.x, afterC.tr.y - afterC.br.y);
  assert(Math.abs(lenCL - lenCR) < 0.5, `C: lengths not equalized (L=${lenCL.toFixed(2)} R=${lenCR.toFixed(2)})`);

  console.log('\nAll equal+midpoint variant checks passed ✅');
})().catch(e => { console.error('equal-midpoint-crush variant tests failed ❌', e); process.exit(1); });