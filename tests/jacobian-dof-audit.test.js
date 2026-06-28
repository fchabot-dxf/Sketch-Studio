(async () => {
  const { Definitions } = await import('#core/solver/definitions.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  function numericJacobian(def, params, positions, eps = 1e-7) {
    const base = def.computeError(params, positions);
    const nVars = positions.length;
    const isVector = Array.isArray(base);
    const nRows = isVector ? base.length : 1;
    const rows = Array.from({ length: nRows }, () => new Float64Array(nVars).fill(0));

    for (let j = 0; j < nVars; ++j) {
      const pPlus = positions.slice(); pPlus[j] += eps;
      const pMinus = positions.slice(); pMinus[j] -= eps;
      const fPlus = def.computeError(params, pPlus);
      const fMinus = def.computeError(params, pMinus);
      if (isVector) {
        for (let r = 0; r < nRows; ++r) rows[r][j] = (fPlus[r] - fMinus[r]) / (2 * eps);
      } else {
        rows[0][j] = (fPlus - fMinus) / (2 * eps);
      }
    }
    return rows;
  }

  function analyticJacobian(def, params, positions) {
    const base = def.computeError(params, positions);
    const isVector = Array.isArray(base);
    const denseLen = positions.length;
    if (isVector) {
      const outRows = Array.from({ length: base.length }, () => new Float64Array(denseLen).fill(0));
      def.computeJacobian(params, positions, outRows);
      return outRows;
    } else {
      const out = new Float64Array(denseLen).fill(0);
      def.computeJacobian(params, positions, out);
      return [out];
    }
  }

  function maxAbsDiff(rowsA, rowsB) {
    let m = 0.0;
    for (let i = 0; i < rowsA.length; ++i) {
      const a = rowsA[i], b = rowsB[i];
      for (let j = 0; j < a.length; ++j) m = Math.max(m, Math.abs(a[j] - b[j]));
    }
    return m;
  }

  // Tests for each constraint type
  // 1) distance
  {
    const def = Definitions.distance;
    const positions = new Float64Array([0,0, 3,4]); // a=(0,0), b=(3,4)
    const params = { joints: [0,1], value: 5 };
    const num = numericJacobian(def, params, positions);
    const ana = analyticJacobian(def, params, positions);
    const diff = maxAbsDiff(ana, num);
    assert(diff < 1e-6, `distance Jacobian mismatch: ${diff}`);
  }

  // 2) coincident (2 rows)
  {
    const def = Definitions.coincident;
    const positions = new Float64Array([1.0,2.0, 1.5,2.1]);
    const params = { joints: [0,1] };
    const num = numericJacobian(def, params, positions);
    const ana = analyticJacobian(def, params, positions);
    const diff = maxAbsDiff(ana, num);
    assert(diff < 1e-6, `coincident Jacobian mismatch: ${diff}`);
  }

  // 3) point_on_line
  // The analytic Jacobian is deliberately ASYMMETRIC: line-endpoint columns
  // (A, B) are zeroed so the solver only moves the point onto the line and
  // never drags the line to meet the point. The true mathematical derivative
  // is nonzero for A and B, so a strict analytic-vs-numeric check fails by
  // design. Audit only the columns the solver actually uses (the point P).
  {
    const def = Definitions.point_on_line;
    const positions = new Float64Array([1,1, 0,0, 2,0]); // P(1,1), A(0,0), B(2,0)
    const params = { joints: [0,1,2] };
    const num = numericJacobian(def, params, positions);
    const ana = analyticJacobian(def, params, positions);
    // Compare only the P columns (positions 0 and 1).
    const POINT_COLS = [0, 1];
    let diff = 0;
    for (let r = 0; r < ana.length; ++r)
      for (const c of POINT_COLS)
        diff = Math.max(diff, Math.abs(ana[r][c] - num[r][c]));
    assert(diff < 1e-6, `point_on_line Jacobian mismatch on P columns: ${diff}`);
    // Confirm the line-endpoint columns are intentionally zero in the analytic.
    for (let r = 0; r < ana.length; ++r)
      for (const c of [2, 3, 4, 5])
        assert(ana[r][c] === 0, `point_on_line analytic should zero line-endpoint col ${c}, got ${ana[r][c]}`);
  }

  // 4) perpendicular
  {
    const def = Definitions.perpendicular;
    // Line AB: (0,0)->(1,0); Line CD: (0,0)->(0,1) -> dot=0
    const positions = new Float64Array([0,0, 1,0, 2,0, 2,1]);
    const params = { joints: [0,1,2,3] };
    const num = numericJacobian(def, params, positions);
    const ana = analyticJacobian(def, params, positions);
    const diff = maxAbsDiff(ana, num);
    assert(diff < 1e-6, `perpendicular Jacobian mismatch: ${diff}`);
  }

  // 5) parallel (more tolerant — simplified analytic used)
  {
    const def = Definitions.parallel;
    const positions = new Float64Array([0,0, 1,1, 0,0, 2,2]); // similar directions
    const params = { joints: [0,1,2,3] };
    const num = numericJacobian(def, params, positions);
    const ana = analyticJacobian(def, params, positions);
    const diff = maxAbsDiff(ana, num);
    assert(diff < 1e-4, `parallel Jacobian mismatch (tolerant): ${diff}`);
  }

  // 6) tangent (approximate analytic — check consistency)
  {
    const def = Definitions.tangent;
    const positions = new Float64Array([1,1, 0,0, 2,0]); // C=(1,1), A=(0,0), B=(2,0)
    const params = { joints: [0,1,2] };
    const num = numericJacobian(def, params, positions);
    const ana = analyticJacobian(def, params, positions);
    const diff = maxAbsDiff(ana, num);
    assert(diff < 1e-4, `tangent Jacobian mismatch (tolerant): ${diff}`);
  }

  // DOF packing: ensure j_origin and fixed joints excluded
  {
    const jointsMap = new Map();
    jointsMap.set('j_origin', { x: 0, y: 0, fixed: true });
    jointsMap.set('a', { x: 1, y: 2, fixed: true });
    jointsMap.set('b', { x: 3, y: 4, fixed: false });
    const solver = createNewtonSolver(jointsMap, [], [], { maxIter: 1 });
    const x = solver._pack();
    // only one free joint 'b' => vector length 2
    assert(x.length === 2, `DOF packing wrong, expected 2 got ${x.length}`);
    // ensure _freeIds does not include fixed/j_origin
    assert(!solver._freeIds.includes('j_origin') && !solver._freeIds.includes('a') && solver._freeIds.includes('b'), 'Packing included fixed/j_origin incorrectly');
  }

  console.log('Jacobian & DOF audit passed ✅');
})().catch(e => { console.error('Jacobian & DOF audit failed ❌', e); process.exit(1); });