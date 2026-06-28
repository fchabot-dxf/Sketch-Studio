// NOTE: legacy iterative relaxation solver has been removed. This module now delegates
// to the deterministic Newton–Raphson (Levenberg–Marquardt) solver implemented under
// `src/core/solver/*`. Keeping a thin compatibility wrapper (`solveConstraints`) so
// existing call-sites (tests and older modules) keep working unchanged.

import { createNewtonSolver } from './solver/engine.js';

/**
 * solveConstraints(joints, shapes, constraints, iter)
 * Backwards-compatible façade that delegates to the Newton–LM solver.
 * - joints: Map<string,{x,y,fixed,...}>
 * - shapes: Array
 * - constraints: Array
 * - iter: maximum solver iterations (optional)
 */
export function solveConstraints(joints, shapes, constraints, iter = 2500) {
  // Build Newton solver using the same data structures and run it.
  const engine = createNewtonSolver(joints, constraints, shapes, { maxIter: Math.max(1, Math.min(iter, 2000)) });
  // If the caller passed a very large iter count, the engine will cap at its own maxIter.
  const result = engine.solve(iter);
  // For backward compatibility the legacy function mutated `joints` in-place; Newton also does.
  return result; // { converged, error }
}

          // Distribute the error based on freedom
          // If line 1 is fixed (w1=0), line 2 takes 100% of the correction.
          // If both are free, they share 50/50.
          const share1 = w1 / (w1 + w2); 
          const share2 = w2 / (w1 + w2);

          // Apply correction to Line 1 (Target: shorten/lengthen to targetL)
          if (w1 > 0 && l1 > 0.0001) {
              const delta1 = -diff * share2; // Inverse share: if L2 is stiffer, L1 moves more
              const u1 = dx1 / l1, u2 = dy1 / l1; // Unit vector
              
              // Apply to endpoints based on their individual freedom
              // If A is fixed, B takes the full expansion
              const moveA = -delta1 * (wa / w1) * 0.5 * k;
              const moveB =  delta1 * (wb / w1) * 0.5 * k;
              
              // Push outwards/inwards from center logic
              // Actually simpler: just move along the line vector
              if (!a.fixed) { a.x -= u1 * moveA * 2; a.y -= u2 * moveA * 2; }
              if (!b.fixed) { b.x += u1 * moveB * 2; b.y += u2 * moveB * 2; }
          }

          // Apply correction to Line 2
          if (w2 > 0 && l2 > 0.0001) {
              const delta2 = diff * share1; // If L1 is stiff, L2 moves more
              const u1 = dx2 / l2, u2 = dy2 / l2;
              
              const moveP = -delta2 * (wp / w2) * 0.5 * k;
              const moveQ =  delta2 * (wq / w2) * 0.5 * k;
              
              if (!p.fixed) { p.x -= u1 * moveP * 2; p.y -= u2 * moveP * 2; }
              if (!q.fixed) { q.x += u1 * moveQ * 2; q.y += u2 * moveQ * 2; }
          }
        }
        else if((s1.type === 'circle' || s1.type === 'arc') && (s2.type === 'circle' || s2.type === 'arc')){
          const getRadius = (s) => {
            if(typeof s.radius === 'number') return s.radius;
            if(s.joints && s.joints.length >= 2){ 
                const c = joints.get(s.joints[0]); 
                // For Arc, average start and end distance to be robust
                if(s.type === 'arc' && s.joints.length >= 3){
                    const start = joints.get(s.joints[1]);
                    const end = joints.get(s.joints[2]);
                    if(c && start && end) return (Math.hypot(start.x - c.x, start.y - c.y) + Math.hypot(end.x - c.x, end.y - c.y)) / 2;
                }
                const rj = joints.get(s.joints[1]); 
                if(c && rj) return Math.hypot(rj.x - c.x, rj.y - c.y); 
            }
            return 0;
          };
          const r1 = getRadius(s1); const r2 = getRadius(s2);
          const targetR = (r1 + r2) / 2;
          
          const applyRadius = (s, target) => {
              if(typeof s.radius === 'number'){
                  s.radius += (target - s.radius) * 0.5;
              } else if(s.joints && s.joints.length >= 2){
                  const center = joints.get(s.joints[0]);
                  if(!center) return;
                  const adjust = (pid) => {
                      const p = joints.get(pid);
                      if(!p || p.fixed) return;
                      const dx = p.x - center.x, dy = p.y - center.y;
                      const d = Math.hypot(dx, dy);
                      if(d < 1e-6) return;
                      const f = 0.5 * (1 - target / d) * k;
                      p.x -= dx * f; p.y -= dy * f;
                  };
                  if(s.type === 'circle') adjust(s.joints[1]);
                  else if(s.type === 'arc' && s.joints.length >= 3) { adjust(s.joints[1]); adjust(s.joints[2]); }
              }
          };
          applyRadius(s1, targetR);
          applyRadius(s2, targetR);
        }
      }
    }
    else if(c.type==='angle'){
      if(c.shapes && c.shapes.length === 2){
        const s1 = shapes.find(s => s.id === c.shapes[0]);
        const s2 = shapes.find(s => s.id === c.shapes[1]);
        if(s1 && s2 && s1.type === 'line' && s2.type === 'line'){
           const aId = s1.joints[0], bId = s1.joints[1];
           const pId = s2.joints[0], qId = s2.joints[1];
           const a = joints.get(aId), b = joints.get(bId);
           const p = joints.get(pId), q = joints.get(qId);
           if(a && b && p && q){
              const isFixedById = (id, j) => {
                if (j && j.fixed) return true;
                if (jointDOFs && typeof id !== 'undefined' && jointDOFs.has(id)) {
                  return jointDOFs.get(id) <= 0;
                }
                return false;
              };
              const s1Fixed = isFixedById(aId, a) && isFixedById(bId, b);
              const s2Fixed = isFixedById(pId, p) && isFixedById(qId, q);
              if (s1Fixed && s2Fixed) return;

              // Calculate current angles
              const ang1 = Math.atan2(b.y - a.y, b.x - a.x);
              const ang2 = Math.atan2(q.y - p.y, q.x - p.x);
              
              // Target angle in radians
              const target = c.value * Math.PI / 180;
              let diff = ang1 - ang2;
              
              // Normalize diff to [-PI, PI]
              while(diff <= -Math.PI) diff += 2*Math.PI;
              while(diff > Math.PI) diff -= 2*Math.PI;
              
              // Find closest canonical difference (handling 180 degree ambiguity of lines)
              const candidates = [target, -target, target + Math.PI, -target + Math.PI, target - Math.PI, -target - Math.PI];
              let bestErr = 0;
              let minAbsErr = Infinity;
              
              for(const cand of candidates){
                  const err = diff - cand;
                  if(Math.abs(err) < minAbsErr){ minAbsErr = Math.abs(err); bestErr = err; }
              }
              
              // Distribute correction: rotate s1 by -err/2, s2 by +err/2
              const correction = bestErr * 0.5 * k;
              const rot = (j1, j2, f1, f2, ang) => {
                  if(f1 && f2) return;
                  const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
                  const dx = j2.x - j1.x, dy = j2.y - j1.y;
                  const l = Math.hypot(dx, dy);
                  const a = Math.atan2(dy, dx) + ang;
                  if(f1 && !f2){ j2.x = j1.x + Math.cos(a)*l; j2.y = j1.y + Math.sin(a)*l; return; }
                  if(!f1 && f2){ j1.x = j2.x - Math.cos(a)*l; j1.y = j2.y - Math.sin(a)*l; return; }
                  if(!f1){ j1.x = mx - Math.cos(a)*l*0.5; j1.y = my - Math.sin(a)*l*0.5; }
                  if(!f2){ j2.x = mx + Math.cos(a)*l*0.5; j2.y = my + Math.sin(a)*l*0.5; }
              };

              if (!s1Fixed && s2Fixed) {
                rot(a, b, isFixedById(aId, a), isFixedById(bId, b), -bestErr * k);
              } else if (s1Fixed && !s2Fixed) {
                rot(p, q, isFixedById(pId, p), isFixedById(qId, q), bestErr * k);
              } else {
                rot(a, b, isFixedById(aId, a), isFixedById(bId, b), -correction);
                rot(p, q, isFixedById(pId, p), isFixedById(qId, q), correction);
              }
           }
        }
      }
    }
    else if(c.type==='midpoint'){
      const pts = resolveJoints(joints, c.joints);
      if(!pts || pts.length < 3) return;
      const [ep1, ep2, mid] = pts;
      const tx = (ep1.x + ep2.x) / 2;
      const ty = (ep1.y + ep2.y) / 2;
      const dx = tx - mid.x;
      const dy = ty - mid.y;

      const isFixedById = (id, j) => {
        if (j && j.fixed) return true;
        if (jointDOFs && typeof id !== 'undefined' && jointDOFs.has(id)) {
          return jointDOFs.get(id) <= 0;
        }
        return false;
      };

      // FIX: Check .fixed directly (ignore DOF-derived "implied fixed"), so solver can still move the midpoint into place
      const wMid = mid.fixed ? 0 : 1;
      const wEp1 = ep1.fixed ? 0 : 1;
      const wEp2 = ep2.fixed ? 0 : 1;
      const total = wMid + wEp1 + wEp2;
      if(total === 0) return;

      if(wMid){
        const share = (wEp1 || wEp2) ? 0.8 : 1.0;
        mid.x += dx * k * share;
        mid.y += dy * k * share;
      }
      if(wEp1 || wEp2){
        const epShare = wMid ? 0.2 : 1.0;
        if(wEp1){ ep1.x -= dx * k * epShare * 0.5; ep1.y -= dy * k * epShare * 0.5; }
        if(wEp2){ ep2.x -= dx * k * epShare * 0.5; ep2.y -= dy * k * epShare * 0.5; }
      }
    }
}

// ============================================================================
// DECOUPLED SOLVER ARCHITECTURE
// ============================================================================
// The solver is split into two distinct passes:
//   1. Interaction Pass - Applies user input (drag targets) as an "impulse"
//   2. Geometric Pass   - Enforces mathematical constraints (pure geometry)
//
// This separation allows:
//   - Tuning drag "feel" without affecting constraint math
//   - Debugging geometry in isolation (no interaction state leaking)
//   - Performance gains (interaction runs once, not per iteration)
// ============================================================================

/**
 * INTERACTION PASS: Apply user drag forces as initial position guess.
 * Runs ONCE per frame, before geometric iterations begin.
 * 
 * @param {Map} joints - Joint map to mutate
 * @param {number} dragStrength - Force multiplier from SolverConfig.DRAG_STRENGTH
 */
function applyInteractionPass(joints, dragStrength) {
    for (const [id, j] of joints) {
        if (j.dragTarget && !j.fixed) {
            j.x += (j.dragTarget.x - j.x) * dragStrength;
            j.y += (j.dragTarget.y - j.y) * dragStrength;
        }
    }
}

/**
 * GEOMETRIC PASS: Enforce all mathematical constraints.
 * Runs MULTIPLE times per frame (iterative relaxation).
 * 
 * This pass contains:
 *   1. Implicit arc constraints (radius equality)
 *   2. Standard pass (all constraints by priority)
 *   3. Hard pass (structural constraints repeated for dominance)
 * 
 * @param {Map} joints - Joint map to mutate
 * @param {Array} shapes - Shape definitions
 * @param {Array} sortedConstraints - Constraints sorted by priority
 * @param {Array} structuralConstraints - Hard constraints for final pass
 * @param {Map} jointDOFs - Degrees of freedom per joint
 */
function applyGeometricPass(joints, shapes, sortedConstraints, structuralConstraints, jointDOFs) {
    // 1. Implicit Arc Constraints: Enforce constant radius for arc legs
    for (const s of shapes) {
        if (s.type === 'arc' && s.joints && s.joints.length === 3) {
            const center = joints.get(s.joints[0]);
            const start = joints.get(s.joints[1]);
            const end = joints.get(s.joints[2]);
            if (center && start && end) {
                const r1 = getDist(center, start);
                const r2 = getDist(center, end);
                if (Math.abs(r1 - r2) > 1e-4) {
                    const targetR = (r1 + r2) / 2;

                    // Leg 1: Center-Start
                    if (r1 > 1e-6) {
                        const err1 = r1 - targetR;
                        const dx = (start.x - center.x) / r1 * err1 * 0.5;
                        const dy = (start.y - center.y) / r1 * err1 * 0.5;
                        if (!start.fixed) { start.x -= dx; start.y -= dy; }
                        if (!center.fixed) { center.x += dx; center.y += dy; }
                    }
                    // Leg 2: Center-End
                    if (r2 > 1e-6) {
                        const err2 = r2 - targetR;
                        const dx = (end.x - center.x) / r2 * err2 * 0.5;
                        const dy = (end.y - center.y) / r2 * err2 * 0.5;
                        if (!end.fixed) { end.x -= dx; end.y -= dy; }
                        if (!center.fixed) { center.x += dx; center.y += dy; }
                    }
                }
            }
        }
    }

    // 2. Standard Pass: Apply all constraints in priority order
    for (const c of sortedConstraints) {
        applyConstraint(c, joints, shapes, jointDOFs);
    }

    // 3. Hard Pass: Re-apply structural constraints
    // Ensures geometry wins over dimensions in conflict scenarios
    for (const c of structuralConstraints) {
        applyConstraint(c, joints, shapes, jointDOFs);
    }
}

// Structural constraint types that get priority in hard pass
const HARD_CONSTRAINTS = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'pointOnLine', 'tangent'];

/**
 * Main solver entry point: Iterative relaxation with decoupled passes.
 * 
 * Architecture:
 *   1. applyInteractionPass() - ONCE (user drag as impulse)
 *   2. for(k iterations):
 *        applyGeometricPass() - REPEATED (pure math convergence)
 * 
 * @param {Map} joints - Joint positions to solve
 * @param {Array} shapes - Shape definitions
 * @param {Array} constraints - Constraint definitions
 * @param {number} iter - Maximum iterations (default 2500)
 * @returns {{ converged: boolean, error: number }}
 */
