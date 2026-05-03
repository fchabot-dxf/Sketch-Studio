(async () => {
  const { ConstraintManager } = await import('../src/core/constraint-manager.js');
  const { createNewtonSolver } = await import('../src/core/solver/engine.js');
  const { Definitions } = await import('../src/core/solver/definitions.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // ─── lockTangentBranch: external configuration (already near-tangent) ─
  {
    const state = { joints: new Map(), shapes: [] };
    state.joints.set('c1', { x: 0, y: 0 });
    state.joints.set('r1', { x: 5, y: 0 });   // r1 = 5
    state.joints.set('c2', { x: 12, y: 0 });   // dist = 12 = 5 + 7 (external, exact)
    state.joints.set('r2', { x: 19, y: 0 });   // r2 = 7
    state.shapes.push({ id: 's1', type: 'circle', joints: ['c1', 'r1'] });
    state.shapes.push({ id: 's2', type: 'circle', joints: ['c2', 'r2'] });
    const params = { shapes: ['s1', 's2'] };
    ConstraintManager.lockTangentBranch(state, params);
    assert(params.branch === 'external', `expected branch='external', got ${params.branch}`);
  }

  // ─── lockTangentBranch: internal configuration (already near-tangent) ─
  {
    const state = { joints: new Map(), shapes: [] };
    state.joints.set('c1', { x: 0, y: 0 });
    state.joints.set('r1', { x: 10, y: 0 });   // r1 = 10
    state.joints.set('c2', { x: 3, y: 0 });    // dist = 3 = |10 - 7| (internal)
    state.joints.set('r2', { x: 10, y: 0 });   // r2 = 7 (distance from c2)
    state.shapes.push({ id: 's1', type: 'circle', joints: ['c1', 'r1'] });
    state.shapes.push({ id: 's2', type: 'circle', joints: ['c2', 'r2'] });
    const params = { shapes: ['s1', 's2'] };
    ConstraintManager.lockTangentBranch(state, params);
    assert(params.branch === 'internal', `expected branch='internal', got ${params.branch}`);
  }

  // ─── lockTangentBranch: far from any tangent → DO NOT lock ──────────
  // Regression test for the "tangent locks everything" report. If the user
  // adds a tangent constraint with circles nowhere near tangent, locking a
  // branch forces the geometry into a config they didn't ask for. Leave the
  // branch unset so the solver picks freely on first solve.
  {
    const state = { joints: new Map(), shapes: [] };
    state.joints.set('c1', { x: 0, y: 0 });
    state.joints.set('r1', { x: 5, y: 0 });    // r1 = 5
    state.joints.set('c2', { x: 50, y: 30 });  // dist ≈ 58 — not near ext (12) or int (2)
    state.joints.set('r2', { x: 57, y: 30 });  // r2 = 7
    state.shapes.push({ id: 's1', type: 'circle', joints: ['c1', 'r1'] });
    state.shapes.push({ id: 's2', type: 'circle', joints: ['c2', 'r2'] });
    const params = { shapes: ['s1', 's2'] };
    ConstraintManager.lockTangentBranch(state, params);
    assert(params.branch == null, `far-from-tangent geometry should NOT lock branch, got ${params.branch}`);
  }

  // ─── tangent residual respects branch ───────────────────────────────
  {
    // Same geometry, same params — only branch differs.
    const positions = new Float64Array([0, 0,  3, 0]); // C1 at (0,0), C2 at (3,0); dist = 3
    const r1 = 10, r2 = 7;
    const baseParams = { joints: [0, 1], radii: [r1, r2] };
    const ext = Definitions.tangent.computeError({ ...baseParams, branch: 'external' }, positions);
    const intr = Definitions.tangent.computeError({ ...baseParams, branch: 'internal' }, positions);
    // External: residual = 3 - (10+7) = -14
    assert(Math.abs(ext - (3 - (r1 + r2))) < 1e-9, `external residual mismatch: ${ext}`);
    // Internal: residual = 3 - |10-7| = 0
    assert(Math.abs(intr - (3 - Math.abs(r1 - r2))) < 1e-9, `internal residual mismatch: ${intr}`);
  }

  // ─── lockPerpendicularBranch: positive cross ────────────────────────
  {
    const state = { joints: new Map(), shapes: [] };
    state.joints.set('a', { x: 0, y: 0 });
    state.joints.set('b', { x: 10, y: 0 });    // line1 along +x
    state.joints.set('c', { x: 0, y: 0 });
    state.joints.set('d', { x: 0, y: 10 });    // line2 along +y → cross > 0
    state.shapes.push({ id: 's1', type: 'line', joints: ['a', 'b'] });
    state.shapes.push({ id: 's2', type: 'line', joints: ['c', 'd'] });
    const params = { shapes: ['s1', 's2'] };
    ConstraintManager.lockPerpendicularBranch(state, params);
    assert(params.branch === 1, `expected branch=+1, got ${params.branch}`);
  }

  // ─── lockPerpendicularBranch: negative cross ────────────────────────
  {
    const state = { joints: new Map(), shapes: [] };
    state.joints.set('a', { x: 0, y: 0 });
    state.joints.set('b', { x: 10, y: 0 });
    state.joints.set('c', { x: 0, y: 0 });
    state.joints.set('d', { x: 0, y: -10 });    // line2 along -y → cross < 0
    state.shapes.push({ id: 's1', type: 'line', joints: ['a', 'b'] });
    state.shapes.push({ id: 's2', type: 'line', joints: ['c', 'd'] });
    const params = { shapes: ['s1', 's2'] };
    ConstraintManager.lockPerpendicularBranch(state, params);
    assert(params.branch === -1, `expected branch=-1, got ${params.branch}`);
  }

  // ─── lockPerpendicularBranch: skipped when near-parallel ────────────
  {
    const state = { joints: new Map(), shapes: [] };
    state.joints.set('a', { x: 0, y: 0 });
    state.joints.set('b', { x: 10, y: 0 });
    state.joints.set('c', { x: 0, y: 0 });
    state.joints.set('d', { x: 10, y: 0.01 });    // nearly parallel — sin θ ~ 1e-3
    state.shapes.push({ id: 's1', type: 'line', joints: ['a', 'b'] });
    state.shapes.push({ id: 's2', type: 'line', joints: ['c', 'd'] });
    const params = { shapes: ['s1', 's2'] };
    ConstraintManager.lockPerpendicularBranch(state, params);
    assert(params.branch == null, `expected branch unset for near-parallel, got ${params.branch}`);
  }

  // ─── perpendicular branch lock prevents sketch flip during solve ────
  // Set up two perpendicular lines; lock branch = +1; then perturb one line
  // PAST the perpendicular plane into the "wrong" half. The branched solver
  // should pull it back to the +1 side, not the -1 side.
  // Pin line-2's start endpoint so the solver can't exploit translation
  // symmetry to collapse the line to zero length.
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 10, y: 0, fixed: true });   // line1 fixed along +x
    joints.set('c', { x: 5, y: 0, fixed: true });    // line2 anchored at (5, 0)
    joints.set('d', { x: 6, y: -10, fixed: false }); // tip mostly along -y → cross < 0 (wrong half)
    // Also pin |d - c| ≈ original length so the solver can't scale to zero.
    // (Distance constraint to a fixed length acts as the implicit "line stays a line" rule
    // that a real sketch would have via shape definitions.)
    const lenInit = Math.hypot(6 - 5, -10);
    const constraints = [
      { type: 'perpendicular', joints: ['a', 'b', 'c', 'd'], branch: 1 },
      { type: 'distance',      joints: ['c', 'd'],           value: lenInit }
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 200, tol: 1e-6 });
    solver.solve();
    const c = joints.get('c'), d = joints.get('d');
    const ux = 10 - 0, uy = 0;
    const vx = d.x - c.x, vy = d.y - c.y;
    const cross = ux * vy - uy * vx;
    assert(cross > 0, `branch lock should drive cross > 0, got cross=${cross} (d=${d.x},${d.y})`);
    const dot = ux * vx + uy * vy;
    const lenU = 10, lenV = Math.hypot(vx, vy);
    // Relative dot — true perpendicularity is dot/(|u||v|) → 0 (cos θ → 0).
    const relDot = Math.abs(dot) / (lenU * lenV);
    assert(relDot < 1e-3, `should still be perpendicular, relDot=${relDot} (dot=${dot})`);
  }

  // ─── perpendicular without branch lock CAN flip ─────────────────────
  // Same geometry as above but no branch field. The solver picks the closer
  // half (in this case the -1 / wrong-from-our-prior-test half). This is the
  // pre-existing behavior we are now opting out of.
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 10, y: 0, fixed: true });
    joints.set('c', { x: 5, y: 0, fixed: true });
    joints.set('d', { x: 6, y: -10, fixed: false });
    const lenInit = Math.hypot(6 - 5, -10);
    const constraints = [
      { type: 'perpendicular', joints: ['a', 'b', 'c', 'd'] },         // no branch
      { type: 'distance',      joints: ['c', 'd'], value: lenInit }
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 200, tol: 1e-6 });
    solver.solve();
    const c = joints.get('c'), d = joints.get('d');
    const cross = (10) * (d.y - c.y) - 0 * (d.x - c.x);
    // Without lock, it will end up negative (closest perpendicular from (1,-10) is (0,-something)).
    assert(cross < 0, `unbranched perp from a -y start should land in -1 half, got cross=${cross}`);
  }

  // ─── tangent branch lock holds internal configuration ───────────────
  // Two circles starting in internal tangent; constraint pushes them to internal.
  // Without the branch field, the solver would push to the closer external target.
  // Use explicit-radius circles so r1 and r2 stay constant during the solve
  // (the engine reads `shape.radius` directly when it's a number).
  {
    const joints = new Map();
    joints.set('c1', { x: 0, y: 0, fixed: true });
    joints.set('c2', { x: 4, y: 0, fixed: false });   // start near internal target |10-7|=3
    const shapes = [
      { id: 's1', type: 'circle', joints: ['c1'], radius: 10 },
      { id: 's2', type: 'circle', joints: ['c2'], radius: 7 }
    ];
    const constraints = [{
      type: 'tangent',
      shapes: ['s1', 's2'],
      branch: 'internal'
    }];
    const solver = createNewtonSolver(joints, constraints, shapes, { maxIter: 100, tol: 1e-6 });
    solver.solve();
    const c1 = joints.get('c1'), c2 = joints.get('c2');
    const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    assert(Math.abs(dist - Math.abs(10 - 7)) < 1e-3,
      `internal tangent: expected dist≈|r1-r2|=3, got dist=${dist} (c2=${c2.x},${c2.y})`);
  }

  // ─── tangent branch lock: external default still works ──────────────
  {
    const joints = new Map();
    joints.set('c1', { x: 0, y: 0, fixed: true });
    joints.set('c2', { x: 25, y: 0, fixed: false });  // far apart — pull toward external target r1+r2=17
    const shapes = [
      { id: 's1', type: 'circle', joints: ['c1'], radius: 10 },
      { id: 's2', type: 'circle', joints: ['c2'], radius: 7 }
    ];
    const constraints = [{
      type: 'tangent',
      shapes: ['s1', 's2'],
      branch: 'external'
    }];
    const solver = createNewtonSolver(joints, constraints, shapes, { maxIter: 100, tol: 1e-6 });
    solver.solve();
    const c2 = joints.get('c2');
    const dist = Math.hypot(c2.x, c2.y);
    assert(Math.abs(dist - (10 + 7)) < 1e-3,
      `external tangent: expected dist≈r1+r2=17, got dist=${dist}`);
  }

  console.log('solver-branch-lock tests passed ✅');
})().catch(e => { console.error('solver-branch-lock tests failed ❌', e); process.exit(1); });
