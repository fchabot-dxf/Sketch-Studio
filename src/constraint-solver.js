import { findSnap as snapFind, hitJointAtScreen as snapHit } from './snap-detection.js';
import { measureResidual } from './core/constraint-verifier.js';
import { SolverConfig } from './core/solver-config.js';
import { createNewtonSolver } from './core/solver/engine.js';


// Embedded store (was store.js)
const joints = new Map();
const shapes = [];
const constraints = [];
let jid = 0;

// Solver metrics for tuning wizard
let lastSolveStats = { maxDelta: 0, iterations: 0, converged: false, constraintErrors: [] };

function _genJ(){ return 'j'+(++jid)+'_'+Date.now(); }
function _initStore(){
  joints.clear();
  shapes.length = 0;
  constraints.length = 0;
  jid = 0;
  joints.set('j_origin', { x: 0, y: 0, fixed: true });
}

export function createEngine(svg){
  const solver = createNewtonSolver(joints, constraints, shapes, {
    maxIter: SolverConfig.ITERATIONS || 500,
    tol: SolverConfig.LM_TOL || 1e-6,
    lambdaInit: SolverConfig.LM_LAMBDA_INIT || 1e-3,
    lambdaUp: SolverConfig.LM_LAMBDA_UP || 10,
    lambdaDown: SolverConfig.LM_LAMBDA_DOWN || 0.1,
    prepassEnabled: SolverConfig.RELAX_PREPASS_ENABLED !== false,
    prepassIters: SolverConfig.RELAX_PREPASS_ITERS != null ? SolverConfig.RELAX_PREPASS_ITERS : 10,
    prepassResidualSkip: SolverConfig.RELAX_PREPASS_SKIP_RESIDUAL != null ? SolverConfig.RELAX_PREPASS_SKIP_RESIDUAL : 1e-3,
    prepassHandoffResidual: SolverConfig.RELAX_PREPASS_HANDOFF != null ? SolverConfig.RELAX_PREPASS_HANDOFF : 1e-2
  });
  function init(){ _initStore(); }
  function genJ(){ return _genJ(); }
  function getJoints(){ return joints; }
  function getShapes(){ return shapes; }
  function getConstraints(){ return constraints; }
  function addJoint(id,x,y,fixed=false){ joints.set(id,{x,y,fixed}); }
  function addShape(shape){ shapes.push(shape); }
  function addConstraint(c){ constraints.push(c); }
  function mergeJoints(fromId,toId){ if(!joints.has(fromId)||!joints.has(toId)||fromId===toId) return; for(const s of shapes){ for(let i=0;i<s.joints.length;i++) if(s.joints[i]===fromId) s.joints[i]=toId; } joints.delete(fromId); }
  
  function solve(iter=20, options = {}){ 
    const result = solver.solve(iter, options);
    
    // Per-constraint GEOMETRIC residuals are the ground truth for convergence.
    // The engine's `converged` flag is step/least-squares based and can report
    // success while a constraint is unsatisfied (over-constrained or zero-DOF
    // cases). Re-check every non-driven constraint and let geometry — not the
    // engine — decide convergence, so the returned result never lies to callers.
    const tolerance = SolverConfig.VERIFIER_TOLERANCE || 0.001;
    const constraintErrors = [];
    const conflicts = [];
    let maxResidual = 0;

    for (const c of constraints) {
      if (c.isDriven || c.driven) continue; // Skip driven dimensions
      const residual = measureResidual(c, joints, shapes);
      if (residual > maxResidual) maxResidual = residual;
      const entry = {
        id: c.id,
        type: c.type,
        residual: residual,
        satisfied: residual <= tolerance,
        joints: c.joints || [],
        shapes: c.shapes || [],
        value: c.value
      };
      if (!entry.satisfied) conflicts.push(entry);
      if (residual > tolerance || options.showAll) constraintErrors.push(entry);
    }

    // Sort by residual (worst first)
    constraintErrors.sort((a, b) => b.residual - a.residual);
    conflicts.sort((a, b) => b.residual - a.residual);

    // Geometry decides convergence: satisfied iff no constraint exceeds tolerance.
    const converged = conflicts.length === 0;

    // Update metrics for tuning wizard
    lastSolveStats = {
      maxDelta: result.error || 0,
      iterations: iter,
      converged: converged,
      // Sketch is under-constrained (rank(J) < n). May still be "converged" if
      // a valid configuration was found; the flag tells UI the configuration
      // is non-unique so it can prompt the user to add more constraints.
      rankDeficient: result.rankDeficient === true,
      constraintErrors: constraintErrors
    };

    // Emit to tuning wizard if available
    if (typeof window !== 'undefined' && window.__updateSolverMetrics) {
      window.__updateSolverMetrics(lastSolveStats);
    }
    // Authoritative result: geometry-derived `converged` + `conflicts` list, with
    // `error` reported as the max geometric residual (world units / radians),
    // not the engine's internal step norm.
    return { ...result, converged, error: maxResidual, conflicts, constraintErrors, rankDeficient: result.rankDeficient === true };
  }
  
  function getSolveStats() { return lastSolveStats; }
  function findSnap(lastMouse){ return snapFind(joints, shapes, svg, lastMouse); }
  function hitJointAtScreen(screenX,screenY,threshold=10){ return snapHit(joints, svg, screenX, screenY, threshold); }

  return { init, genJ, getJoints, getShapes, getConstraints, addJoint, addShape, addConstraint, mergeJoints, solve, getSolveStats, findSnap, hitJointAtScreen };
}