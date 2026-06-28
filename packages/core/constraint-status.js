import { CONSTRAINT_TYPES } from './constants.js';
import { getCoincidentJoints } from './joints.js';

export function analyzeConstraintStatus({ joints, shapes, constraints }) {
    // 1. Data Structures
    const jointDOFs = new Map(); // Default 2
    const processingQueue = [];
    const fixedJoints = new Set();
    const constrainedJoints = new Set();
    const fixedShapes = new Set();
    const constrainedShapes = new Set();
    const processedConstraints = new Set(); // To prevent double-counting non-idempotent constraints
    const dofSources = new Map(); // jointId -> Array<string> describing which constraint(s) removed DOF

    // Helper to get current DOF, defaulting to 2
    const getDOF = (id) => jointDOFs.has(id) ? jointDOFs.get(id) : 2;
    const setDOF = (id, val) => jointDOFs.set(id, Math.max(0, Math.min(2, val)));
    const decDOF = (id) => setDOF(id, getDOF(id) - 1);

    // Track which constraints have already caused a DOF reduction on each joint
    // to avoid double-decrementing from the same constraint (idempotency per-constraint).
    const reductionApplied = new Map(); // jointId -> Set<constraint>
    const isReductionApplied = (c, jid) => reductionApplied.has(jid) && reductionApplied.get(jid).has(c);
    const markReductionApplied = (c, jid) => {
        if (!reductionApplied.has(jid)) reductionApplied.set(jid, new Set());
        reductionApplied.get(jid).add(c);
    };

    // Convenience: record that constraint `c` would remove one DOF from `jid`.
    // IMPORTANT: do not mutate numeric DOF during propagation; numeric DOF is
    // derived from axis locks + radial/constraint counts in the final pass.
    const applyDecIfNeeded = (c, jid) => {
        if (!jid) return false;
        if (isReductionApplied(c, jid)) return false;
        // Record provenance for the reduction (do not change numeric DOF here)
        try {
            const fallback = (c.joints && c.joints.length) ? c.joints.join('-') : (c.shape || 'auto');
            const src = `${c.type}:${c.id || fallback}`;
            if (!dofSources.has(jid)) dofSources.set(jid, []);
            dofSources.get(jid).push(src);
        } catch(_) {}
        markReductionApplied(c, jid);
        return true;
    };

    // Clamp DOF downwards to a maximum value (never increases DOF)
    const clampDOF = (id, maxVal) => {
        const cur = getDOF(id);
        const nv = Math.min(cur, maxVal);
        if (nv !== cur) {
            setDOF(id, nv);
            // if we've clamped to 0, make sure it enters the processing queue so propagation continues
            if (nv <= 0 && !visitedInQueue.has(id)) {
                processingQueue.push(id);
                visitedInQueue.add(id);
            }
        }
    };

    // Pre-index constraints by joint for performance
    const constraintsByJoint = new Map();
    if (constraints) {
        for (const c of constraints) {
            const ids = [];
            if (c.joints) ids.push(...c.joints);
            if (c.joint) ids.push(c.joint);
            // Include shapes' joints if constraint references shape
            if (c.shape) {
                const s = shapes.find(sh => sh.id === c.shape);
                if (s && s.joints) ids.push(...s.joints);
            }
            if (c.shapes) {
                c.shapes.forEach(sid => {
                    const s = shapes.find(sh => sh.id === sid);
                    if (s && s.joints) ids.push(...s.joints);
                });
            }
            if (c.line) {
                 const s = shapes.find(sh => sh.id === c.line);
                 if (s && s.joints) ids.push(...s.joints);
            }
            if (c.circle) {
                 const s = shapes.find(sh => sh.id === c.circle);
                 if (s && s.joints) ids.push(...s.joints);
            }

            const uniqueIds = [...new Set(ids)];
            for (const id of uniqueIds) {
                if (!constraintsByJoint.has(id)) constraintsByJoint.set(id, []);
                constraintsByJoint.get(id).push(c);
            }
        }
    }

    // 2. Phase 1: Grounding (Origins & Fixed Joints)
    // Initialize axis locks container and radial locks (radialConstraints tracks unique radial grounding constraints)
    const lockedAxisX = new Set();
    const lockedAxisY = new Set();
    const radialLocked = new Set();
    const radialConstraints = new Map(); // jointId -> Set<sourceId> (counts unique radial constraints)

    for (const [id, joint] of joints) {
        jointDOFs.set(id, 2); // Initialize all to 2

        if (joint.fixed || id === 'j_origin') {
            // Grounded joints are locked on both axes
            jointDOFs.set(id, 0);
            lockedAxisX.add(id);
            lockedAxisY.add(id);
            radialLocked.add(id);
            fixedJoints.add(id);
            constrainedJoints.add(id);
            processingQueue.push(id);
            // trace explicit grounding
            if (id === 'j_origin') dofSources.set(id, ['origin']);
            else if (joint.fixed) dofSources.set(id, ['fixed']);
            // Treat explicit grounding as a radial source for completeness
            radialConstraints.set(id, new Set([id === 'j_origin' ? 'origin' : 'fixed']));
        }
    }

    // 3. Phase 2: Propagation Loop (BFS)
    // Track visited in queue to prevent redundant processing of the same fixed joint
    const visitedInQueue = new Set(processingQueue);
    let head = 0;

    const checkAndEnqueue = (jid) => {
        if (getDOF(jid) <= 0) {
            constrainedJoints.add(jid);
            if (!visitedInQueue.has(jid)) {
                processingQueue.push(jid);
                visitedInQueue.add(jid);
            }
        }
    };

    // Compute a provisional DOF from the current lock/radial state (used by strict propagation).
    const provisionalDOFFromLocks = (jid) => {
        const xLocked = lockedAxisX.has(jid) ? 1 : 0;
        const yLocked = lockedAxisY.has(jid) ? 1 : 0;
        const base = Math.max(0, 2 - (xLocked + yLocked));
        const rCount = radialConstraints.has(jid) ? radialConstraints.get(jid).size : 0;
        // Count other reductions recorded in dofSources (exclude sources that are
        // already accounted for by axis locks or radialConstraints — see the
        // identical skip list in the Phase-3 final pass below for rationale).
        let other = 0;
        if (dofSources.has(jid)) {
            for (const s of dofSources.get(jid)) {
                const t = (s && s.split) ? s.split(':')[0] : s;
                if (t === 'distance' || t === 'radius' || t === 'origin' || t === 'ground'
                    || t === 'fixed' || t === 'anchor' || t === 'horizontal' || t === 'vertical') continue;
                other++;
            }
        }
        const afterRadial = Math.max(0, base - Math.max(0, Math.min(rCount, base)));
        const computed = Math.max(0, afterRadial - Math.max(0, Math.min(other, afterRadial)));
        return computed;
    };

    const isEffectivelyGrounded = (jid) => {
        if (jid === 'j_origin') return true;
        if (fixedJoints.has(jid)) return true;
        const pd = provisionalDOFFromLocks(jid);
        return pd === 0;
    };

    while(head < processingQueue.length){
        const currentId = processingQueue[head++];
        const relevantConstraints = constraintsByJoint.get(currentId) || [];

        for (const c of relevantConstraints) {
            switch (c.type) {
                case CONSTRAINT_TYPES.COINCIDENT:
                    // Coincident cluster handling — DO NOT blindly ground entire clusters.
                    // Goal: 1) merge directional axis locks across the cluster (union),
                    //       2) synchronize numeric DOF only when the cluster-minimum > 0
                    //          or when a member is explicitly grounded. This prevents
                    //          "false 0-DOF" propagation from j_origin to floating members.
                    if (c.joints && c.joints.includes(currentId)) {
                        // compute the minimum DOF among cluster members
                        let minD = Infinity;
                        for (const jid of c.joints) minD = Math.min(minD, getDOF(jid));

                        // First: merge axis locks across the cluster (idempotent union)
                        for (const a of c.joints) {
                            for (const b of c.joints) {
                                if (lockedAxisX.has(a)) lockedAxisX.add(b);
                                if (lockedAxisY.has(a)) lockedAxisY.add(b);
                            }
                        }

                        // If the cluster-minimum is 0, only *explicitly grounded* members
                        // (j_origin or joints with `fixed: true`) should be forced to 0 here.
                        // Floating members keep their numeric DOF and inherit axis/radial locks
                        // so their final freedom is computed from those locks later.
                        if (minD === 0) {
                            for (const memberId of c.joints) {
                                const isExplicitlyGrounded = memberId === 'j_origin' || (joints.get(memberId) && joints.get(memberId).fixed);
                                if (isExplicitlyGrounded && getDOF(memberId) > 0) {
                                    setDOF(memberId, 0);
                                    fixedJoints.add(memberId);
                                    constrainedJoints.add(memberId);
                                    if (!visitedInQueue.has(memberId)) {
                                        processingQueue.push(memberId);
                                        visitedInQueue.add(memberId);
                                    }
                                }
                            }
                        }

                        // Numeric sync for non-grounded clusters (preserve existing behavior)
                        for (const nId of c.joints) {
                            if (minD > 0) {
                                if (getDOF(nId) > minD) {
                                    setDOF(nId, minD);
                                    constrainedJoints.add(nId);
                                    if (minD === 0) fixedJoints.add(nId);
                                    if (!visitedInQueue.has(nId)) { processingQueue.push(nId); visitedInQueue.add(nId); }
                                }
                            }

                            // Ensure any axis locks on the current processing node propagate to neighbors
                            if (lockedAxisX.has(currentId)) lockedAxisX.add(nId);
                            if (lockedAxisY.has(currentId)) lockedAxisY.add(nId);

                            // If the current processing node is fully grounded, mark it as a radial
                            // source for coincident neighbors so radial constraint counting works
                            // for floating members that are coincident with a grounded member.
                            if (isEffectivelyGrounded(currentId) && currentId !== nId) {
                                if (!radialConstraints.has(nId)) radialConstraints.set(nId, new Set());
                                radialConstraints.get(nId).add(`ground:${currentId}`);
                                radialLocked.add(nId);
                                if (!visitedInQueue.has(nId)) { processingQueue.push(nId); visitedInQueue.add(nId); }
                            }
                        }
                    }
                    break;

                case CONSTRAINT_TYPES.DISTANCE:
                case 'distance': 
                    // Linear Distance: if one joint is fixed (DOF 0), decrement neighbor DOF by 1 (2→1, 1→0)
                    if (c.joints && c.joints.length === 2 && c.joints.includes(currentId)) {
                        if (isEffectivelyGrounded(currentId)) {
                            const nId = c.joints.find(id => id !== currentId);
                            if (nId) {
                                // Mark radial (arc) 1DOF lock and register radial constraint source
                                radialLocked.add(nId);
                                if (!radialConstraints.has(nId)) radialConstraints.set(nId, new Set());
                                const fid = c.id || (`distance:${(c.joints || []).join('-')}`);
                                radialConstraints.get(nId).add(fid);
                                // Record provenance + anchor joint id for downstream consumers (AI Vision needs anchor)
                                try {
                                    if (!dofSources.has(nId)) dofSources.set(nId, []);
                                    dofSources.get(nId).push(`anchor:${currentId}`);
                                } catch(_) {}
                                if (applyDecIfNeeded(c, nId)) {
                                    constrainedJoints.add(nId);
                                    if (!visitedInQueue.has(nId)) { processingQueue.push(nId); visitedInQueue.add(nId); }
                                }
                            }
                        }
                    }

                    // Radius Distance (center-rim): propagate radial lock between center/rim when one end is fixed
                    if (c.isRadius && c.shape) {
                        const s = shapes.find(sh => sh.id === c.shape);
                        if (s && s.joints && s.joints.length > 1) {
                            const centerId = s.joints[0];
                            const rimId = s.joints[1];
                            const nId = (currentId === centerId) ? rimId : (currentId === rimId ? centerId : null);
                            if (nId) {
                                radialLocked.add(nId);
                                if (!radialConstraints.has(nId)) radialConstraints.set(nId, new Set());
                                const fid = c.id || (`radius:${c.shape || (c.joints || []).join('-')}`);
                                radialConstraints.get(nId).add(fid);
                                // Record provenance + anchor joint id for downstream consumers
                                try {
                                    if (!dofSources.has(nId)) dofSources.set(nId, []);
                                    dofSources.get(nId).push(`anchor:${centerId}`);
                                } catch(_) {}
                                if (applyDecIfNeeded(c, nId)) {
                                    constrainedJoints.add(nId);
                                    if (!visitedInQueue.has(nId)) { processingQueue.push(nId); visitedInQueue.add(nId); }
                                }
                            }
                        }
                    }
                    break;

                case CONSTRAINT_TYPES.HORIZONTAL:
                case CONSTRAINT_TYPES.VERTICAL:
                    // Strict propagation: only propagate axis locks if the *source* joint
                    // already has that lock (i.e. the lock traces back to a grounded root).
                    if (c.joints && c.joints.includes(currentId)) {
                        const nId = c.joints.find(id => id !== currentId);
                        if (!nId) break;

                        if (c.type === CONSTRAINT_TYPES.HORIZONTAL) {
                            // propagate Y-lock only when the source has Y locked
                            if (lockedAxisY.has(currentId) && !lockedAxisY.has(nId)) {
                                lockedAxisY.add(nId);
                                constrainedJoints.add(nId);
                                if (!visitedInQueue.has(nId)) { processingQueue.push(nId); visitedInQueue.add(nId); }
                            }
                        } else {
                            // vertical -> propagate X-lock only from source
                            if (lockedAxisX.has(currentId) && !lockedAxisX.has(nId)) {
                                lockedAxisX.add(nId);
                                constrainedJoints.add(nId);
                                if (!visitedInQueue.has(nId)) { processingQueue.push(nId); visitedInQueue.add(nId); }
                            }
                        }
                    }
                    break;

                case CONSTRAINT_TYPES.POINT_ON_LINE:
                    // If the line (defined by 2 joints) is fully fixed, decrement target joint
                    if (c.shape && c.joint) {
                        const s = shapes.find(sh => sh.id === c.shape);
                        if (s && s.type === 'line' && s.joints) {
                            const [j1, j2] = s.joints;
                            // Check if BOTH endpoints are fixed (Green)
                            if (fixedJoints.has(j1) && fixedJoints.has(j2)) {
                                if (!processedConstraints.has(c)) {
                                    const targetId = c.joint;
                                    if (targetId && getDOF(targetId) > 0) {
                                        // register radial/source provenance for point-on-line reductions
                                        if (!radialConstraints.has(targetId)) radialConstraints.set(targetId, new Set());
                                        radialConstraints.get(targetId).add(c.id || (`pointOnLine:${c.shape || 'auto'}`));
                                        radialLocked.add(targetId);
                                        if (applyDecIfNeeded(c, targetId)) {
                                            if (!visitedInQueue.has(targetId)) { processingQueue.push(targetId); visitedInQueue.add(targetId); }
                                            constrainedJoints.add(targetId);
                                        }
                                        processedConstraints.add(c);
                                    }
                                }
                            }
                        }
                    }
                    break;

                case CONSTRAINT_TYPES.MIDPOINT:
                    if (c.joints && c.joints.length === 3) {
                        const fixedCount = c.joints.reduce((acc, id) => acc + (getDOF(id) <= 0 ? 1 : 0), 0);
                        if (fixedCount >= 2) {
                            for (const id of c.joints) {
                                if (getDOF(id) > 0) {
                                    setDOF(id, 0);
                                    // record source (midpoint constraint forced this joint)
                                    try { dofSources.set(id, (dofSources.get(id) || []).concat(`${c.type}:${c.id || 'auto'}`)); } catch(_) {}
                                    checkAndEnqueue(id);
                                }
                            }
                        }
                    }
                    break;

                case CONSTRAINT_TYPES.PARALLEL:
                case CONSTRAINT_TYPES.PERPENDICULAR:
                case CONSTRAINT_TYPES.COLLINEAR:
                    // If one line is fully fixed, the other's orientation is constrained
                    if (c.shapes && c.shapes.length === 2) {
                        const s1 = shapes.find(sh => sh.id === c.shapes[0]);
                        const s2 = shapes.find(sh => sh.id === c.shapes[1]);
                        if (s1 && s2 && s1.joints && s2.joints) {
                            const s1Fixed = s1.joints.every(jid => fixedJoints.has(jid));
                            const s2Fixed = s2.joints.every(jid => fixedJoints.has(jid));
                            const propagate = (freeShape) => {
                                if (!processedConstraints.has(c)) {
                                    for (const jid of freeShape.joints) {
                                        if (getDOF(jid) > 0 && applyDecIfNeeded(c, jid)) {
                                            constrainedJoints.add(jid);
                                            if (!visitedInQueue.has(jid)) { processingQueue.push(jid); visitedInQueue.add(jid); }
                                        }
                                    }
                                    processedConstraints.add(c);
                                }
                            };
                            if (s1Fixed && !s2Fixed) propagate(s2);
                            else if (s2Fixed && !s1Fixed) propagate(s1);
                        }
                    }
                    break;

                case CONSTRAINT_TYPES.EQUAL:
                    // Equal removes 1 DOF (length is determined by other shape)
                    if (c.shapes && c.shapes.length === 2) {
                        const s1 = shapes.find(sh => sh.id === c.shapes[0]);
                        const s2 = shapes.find(sh => sh.id === c.shapes[1]);
                        if (s1 && s2 && s1.joints && s2.joints) {
                            const s1Fixed = s1.joints.every(jid => fixedJoints.has(jid));
                            const s2Fixed = s2.joints.every(jid => fixedJoints.has(jid));
                            const propagate = (freeShape) => {
                                if (!processedConstraints.has(c)) {
                                    for (const jid of freeShape.joints) {
                                        if (getDOF(jid) > 0 && applyDecIfNeeded(c, jid)) {
                                            constrainedJoints.add(jid);
                                            if (!visitedInQueue.has(jid)) { processingQueue.push(jid); visitedInQueue.add(jid); }
                                            processedConstraints.add(c);
                                            break; // equal only removes 1 DOF
                                        }
                                    }
                                }
                            };
                            if (s1Fixed && !s2Fixed) propagate(s2);
                            else if (s2Fixed && !s1Fixed) propagate(s1);
                        }
                    }
                    break;
            }
        }
    }

    // Additional Phase: Shape-level propagation
    // - H/V on a line clamps its member joints to at most 1 DOF
    // - Mark shapes that contain any 0-DOF joint as constrained for downstream UI logic
    if (Array.isArray(shapes)) {
        for (const s of shapes) {
            if (!s || s.type !== 'line' || !Array.isArray(s.joints) || s.joints.length < 2) continue;

            // If there exists an explicit H/V constraint on the same pair of joints, we treat it as
            // a *relative* constraint. Do NOT reduce absolute DOF for a floating assembly.
            // Only clamp member joints to 1 DOF when the shape/assembly is grounded (i.e. has at least
            // one joint with absolute DOF 0). This preserves the "assembly moves as a unit" behavior.
            const hvConstraint = (constraints || []).find(c => (c.type === CONSTRAINT_TYPES.HORIZONTAL || c.type === CONSTRAINT_TYPES.VERTICAL) && c.joints && c.joints.length >= 2 && s.joints.includes(c.joints[0]) && s.joints.includes(c.joints[1]));
            if (hvConstraint) {
                const shapeGrounded = s.joints.some(jid => (getDOF(jid) <= 0) || fixedJoints.has(jid) || jid === 'j_origin');
                if (shapeGrounded) {
                    // If the assembly/shape is grounded, record reductions for member joints (additive)
                    for (const jid of s.joints) {
                        if (getDOF(jid) > 0 && applyDecIfNeeded(hvConstraint, jid)) {
                            constrainedJoints.add(jid);
                            if (!visitedInQueue.has(jid)) { processingQueue.push(jid); visitedInQueue.add(jid); }
                        }
                    }
                }
            }

            // If ANY joint of the shape is fully fixed, treat the shape as constrained (rigid) for UI purposes
            if (s.joints.some(jid => getDOF(jid) <= 0)) {
                constrainedShapes.add(s.id);
            }
        }
    }

    // Cluster finalization: merge axis locks and compute numeric DOF from directional locks
    // NOTE: Phase 2 enforces cluster grounding when cluster-min DOF === 0; this final pass
    // only merges directional locks and clamps numeric DOF downward (never increases it).
    if (constraints && Array.isArray(constraints)) {
        for (const c of constraints) {
            if (!c || c.type !== CONSTRAINT_TYPES.COINCIDENT || !Array.isArray(c.joints) || c.joints.length < 2) continue;
            const members = c.joints;

            // Merge axis + radial locks across the cluster (union)
            for (const a of members) {
                for (const b of members) {
                    if (lockedAxisX.has(a)) lockedAxisX.add(b);
                    if (lockedAxisY.has(a)) lockedAxisY.add(b);
                    if (radialLocked.has(a)) radialLocked.add(b);
                }
            }

            // Numeric sync policy:
            // - If cluster min DOF > 0, synchronize numeric DOF to that min.
            // - If min DOF == 0 (cluster contains grounded joint), DO NOT force floating
            //   members to 0 here — leave numeric resolution to the axis/radial final pass.
            let minD = Infinity;
            for (const jid of members) minD = Math.min(minD, getDOF(jid));

            for (const jid of members) {
                const isGrounded = jid === 'j_origin' || (joints.get(jid) && joints.get(jid).fixed);
                if (minD > 0) {
                    if (getDOF(jid) !== minD) {
                        setDOF(jid, minD);
                        constrainedJoints.add(jid);
                        if (minD === 0) fixedJoints.add(jid);
                    }
                } else {
                    // minD === 0: only enforce 0 on truly grounded members; otherwise
                    // leave numeric DOF to be resolved by final axis/radial computation.
                    if (isGrounded) {
                        if (getDOF(jid) !== 0) {
                            setDOF(jid, 0);
                            constrainedJoints.add(jid);
                            fixedJoints.add(jid);
                        }
                    }
                }
            }
        }
    }

    // After cluster unification: ensure distance constraints rooted at newly-grounded joints
    // contribute radialSources to their neighbors (handles cases where grounding occurred
    // during cluster-finalization rather than BFS propagation).
    if (Array.isArray(constraints)) {
        for (const c of constraints) {
            if (!c || c.type !== CONSTRAINT_TYPES.DISTANCE || !c.joints || c.joints.length !== 2) continue;
            const [a, b] = c.joints;
            const aDOF = getDOF(a);
            const bDOF = getDOF(b);
            const srcId = c.id || (`distance:${(c.joints || []).join('-')}`);
            // If either endpoint is (or became) grounded, register this distance as a
            // radial source for both endpoints (counts toward radialConstraints).
            if (aDOF <= 0 || bDOF <= 0) {
                if (!radialConstraints.has(a)) radialConstraints.set(a, new Set());
                if (!radialConstraints.has(b)) radialConstraints.set(b, new Set());
                radialConstraints.get(a).add(srcId);
                radialConstraints.get(b).add(srcId);
                radialLocked.add(a); radialLocked.add(b);
            }
        }
    }

    // 4. Phase 3: Status Evaluation
    // Recompute numeric DOF from axis/radial locks so reported DOF is consistent with directional locks.
    // IMPORTANT: do NOT increase a joint's DOF here — only clamp it downward to reflect additional axis/radial locks.
    for (const [id, j] of joints) {
        const xLocked = lockedAxisX.has(id) ? 1 : 0;
        const yLocked = lockedAxisY.has(id) ? 1 : 0;
        // Base freedom after directional locks
        let base = Math.max(0, 2 - (xLocked + yLocked));

        // Radial constraints remove remaining freedom (count unique radial sources)
        const rCount = radialConstraints.has(id) ? radialConstraints.get(id).size : 0;
        // Consume radial constraints first (only up to the available base freedom)
        const afterRadial = Math.max(0, base - Math.max(0, Math.min(rCount, base)));

        // Additional DOF reductions from other constraint types (equal, midpoint, point_on_line, etc.)
        // Skip-list rationale:
        //   distance / radius — already counted in radialConstraints (rCount above).
        //   ground / origin / fixed — already reflected in axis locks; double-counting would
        //     drive a fixed joint's neighbors below their true freedom.
        //   anchor — pure metadata pushed by the DISTANCE handler alongside the real
        //     'distance:...' source; counts the same physical constraint twice.
        //   horizontal / vertical — already reflected in lockedAxisY / lockedAxisX
        //     (the BFS H/V handler propagates the axis lock); counting them again
        //     would subtract a DOF that's already gone.
        let otherReductions = 0;
        if (dofSources.has(id)) {
            for (const s of dofSources.get(id)) {
                const type = (s && s.split && s.split(':')[0]) ? s.split(':')[0] : s;
                if (type === 'distance' || type === 'radius' || type === 'ground' || type === 'origin'
                    || type === 'fixed' || type === 'anchor' || type === 'horizontal' || type === 'vertical') continue;
                // Count 'equal', 'midpoint', 'point_on_line', 'parallel', 'perpendicular', 'collinear', etc.
                otherReductions++;
            }
        }

        const computed = Math.max(0, afterRadial - Math.max(0, Math.min(otherReductions, afterRadial)));

        // Keep radialLocked in sync for legacy consumers
        if (rCount > 0) radialLocked.add(id);

        // Clamp downward only — preserve any earlier reductions (cluster sync, distance, etc.)
        const finalDOF = Math.min(getDOF(id), computed);
        jointDOFs.set(id, finalDOF);
        if (finalDOF <= 0) constrainedJoints.add(id);
        if (finalDOF === 0) fixedJoints.add(id);
    }

    // Final Cluster Unification: ensure coincident clusters report a uniform minimum DOF
    if (Array.isArray(constraints)) {
        const _processedClusters = new Set();
        for (const c of constraints) {
            if (!c || c.type !== CONSTRAINT_TYPES.COINCIDENT || !Array.isArray(c.joints) || c.joints.length < 2) continue;
            // Use the helper to obtain the full transitive cluster (handles multi-hop coincident chains)
            const seed = c.joints[0];
            const cluster = getCoincidentJoints(seed, constraints); // Set<string>
            const key = [...cluster].sort().join('|');
            if (_processedClusters.has(key)) continue;
            _processedClusters.add(key);

            // Propagate any axis/radial locks across the entire cluster BEFORE computing numeric DOF
            let anyX = false, anyY = false, anyR = false;
            for (const jid of cluster) {
                if (lockedAxisX.has(jid)) anyX = true;
                if (lockedAxisY.has(jid)) anyY = true;
                if (radialLocked.has(jid)) anyR = true;
            }
            if (anyX) for (const jid of cluster) lockedAxisX.add(jid);
            if (anyY) for (const jid of cluster) lockedAxisY.add(jid);
            if (anyR) for (const jid of cluster) radialLocked.add(jid);

            // Hybrid Cluster Unification: compute each member's DOF from merged locks
            // (axis locks + radial constraint counts), then force the entire cluster to the
            // absolute minimum of those computed DOFs (so clusters behave as single rigid bodies).

            // First, merge radialConstraints across the cluster (union) so counting is consistent.
            // Filter out 'ground:<X>' sources where X itself is in the cluster — those are
            // self-referential within the cluster (one member's coincident-with-grounded marker
            // pointing at another member that's only provisionally grounded). Keeping them
            // would double-count each member's own grounding when the merged set is broadcast
            // back to every cluster member.
            const mergedRadial = new Set();
            for (const jid of cluster) {
                if (!radialConstraints.has(jid)) continue;
                for (const s of radialConstraints.get(jid)) {
                    if (typeof s === 'string' && s.startsWith('ground:')) {
                        const target = s.substring('ground:'.length);
                        if (cluster.has(target)) continue;
                    }
                    mergedRadial.add(s);
                }
            }
            if (mergedRadial.size > 0) {
                for (const jid of cluster) radialConstraints.set(jid, new Set(mergedRadial));
            }

            // Compute DOF-from-locks for each member and pick the cluster minimum
            let clusterMin = 2;
            const clusterComputed = new Map();
            for (const jid of cluster) {
                const xLocked = lockedAxisX.has(jid) ? 1 : 0;
                const yLocked = lockedAxisY.has(jid) ? 1 : 0;
                const base = Math.max(0, 2 - (xLocked + yLocked));
                const rCount = radialConstraints.has(jid) ? radialConstraints.get(jid).size : 0;
                const computed = Math.max(0, base - Math.max(0, Math.min(rCount, base)));
                clusterComputed.set(jid, computed);
                clusterMin = Math.min(clusterMin, computed);
            }

            // Merge dofSources from any member that is at the clusterMin (propagate provenance)
            const clusterSources = new Set();
            for (const jid of cluster) {
                if (clusterComputed.get(jid) === clusterMin && dofSources.has(jid)) {
                    for (const s of dofSources.get(jid)) clusterSources.add(s);
                }
            }

            // Finally, enforce uniform cluster DOF and copy merged sources
            for (const jid of cluster) {
                jointDOFs.set(jid, clusterMin);
                if (clusterSources.size > 0) dofSources.set(jid, Array.from(clusterSources));
                if (clusterMin <= 0) { fixedJoints.add(jid); constrainedJoints.add(jid); }
                else if (clusterMin === 1) constrainedJoints.add(jid);
            }
        }
    }

    // Shape Logic — all shape types (lines, circles, arcs)
    for (const s of shapes) {
        if (!s.joints || s.joints.length === 0) continue;
        
        const allFixed = s.joints.every(jid => fixedJoints.has(jid));
        if (allFixed) fixedShapes.add(s.id);

        const allConstrained = s.joints.every(jid => constrainedJoints.has(jid));
        if (allConstrained) constrainedShapes.add(s.id);
    }

    return { 
        fixedJoints, 
        constrainedJoints, 
        fixedShapes, 
        constrainedShapes, 
        jointDOFs,
        // Expose axis-specific locks so UI can apply directional masking
        lockedAxisX: lockedAxisX, 
        lockedAxisY: lockedAxisY,
        // radial/arc-based 1DOF reductions (distance/radius)
        radialLocked: (typeof radialLocked !== 'undefined') ? radialLocked : new Set(),
        radialConstraints: radialConstraints,
        dofSources: dofSources
    };
}
