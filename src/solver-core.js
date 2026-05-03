// Compatibility façade: `solveConstraints` now delegates to the Newton–Raphson (LM) solver.
// The legacy iterative relaxation implementation was archived to `solver-core.legacy.js`.

import { createNewtonSolver } from './core/solver/engine.js';

/**
 * solveConstraints(joints, shapes, constraints, iter)
 * - Delegates to `NewtonSolver.solve()` and returns { converged, error }
 */
export function solveConstraints(joints, shapes, constraints, iter = 2500) {
  const engine = createNewtonSolver(joints, constraints, shapes, { maxIter: Math.max(1, Math.min(iter, 2000)) });
  return engine.solve(iter);
}
