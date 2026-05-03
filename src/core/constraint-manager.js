// Unified constraint creation service
import { dbg } from './debug.js';
import { CONSTRAINT_TYPES } from './constants.js';
import * as constraints from './constraints.js';
import { showNotification } from '../ui/notification-manager.js';
import { SolverConfig } from './solver-config.js';

// Structural constraint types — cannot be driven, must be rejected on conflict
const STRUCTURAL_TYPES = new Set([
    CONSTRAINT_TYPES.COINCIDENT, CONSTRAINT_TYPES.HORIZONTAL, CONSTRAINT_TYPES.VERTICAL,
    CONSTRAINT_TYPES.PARALLEL, CONSTRAINT_TYPES.PERPENDICULAR, CONSTRAINT_TYPES.COLLINEAR,
    CONSTRAINT_TYPES.TANGENT, CONSTRAINT_TYPES.POINT_ON_LINE, CONSTRAINT_TYPES.EQUAL,
    CONSTRAINT_TYPES.MIDPOINT
]);

export class ConstraintManager {
    static canAddConstraint(state, type, params, options = {}) {
        const opts = { full: false, solveIterations: SolverConfig.SANDBOX_ITERATIONS || 20, ...options };
        if (!state || !type || !params) return { ok: false, reason: 'invalid input' };

        if (!this.validateParams(type, params)) {
            return { ok: false, reason: 'invalid params' };
        }

        const normalized = this.normalizeParams(type, params);
        const mathConflict = this._mathPreCheck(state, type, normalized);
        if (mathConflict) return { ok: false, reason: mathConflict, conflictType: 'math' };

        if (opts.full && state.engine && typeof state.engine.solve === 'function') {
            const solverConflict = this._sandboxVerify(state, type, normalized, opts.solveIterations);
            if (solverConflict) return { ok: false, reason: 'creates a conflict', conflictType: 'sandbox' };
        }

        return { ok: true };
    }
    static createConstraint(state, type, params, options = {}) {
        const opts = {
            autoSolve: true,
            solveIterations: 500,
            source: 'unknown',
            skipVerify: false,
            ...options
        };

        // Basic validation
        if (!this.validateParams(type, params)) {
            dbg.warn('constraints', `[ConstraintManager] Invalid params for ${type}:`, params);
            return null;
        }

        // Normalize params
        const normalized = this.normalizeParams(type, params);

        // Pre-process PARALLEL constraints to prevent flipping anti-parallel lines
        if (type === CONSTRAINT_TYPES.PARALLEL && normalized.shapes && normalized.shapes.length === 2) {
            this.alignParallelOrientation(state, normalized.shapes);
        }

        // Branch lock: PERPENDICULAR records the chosen handedness (+1 / -1) so
        // the solver can't rotate one line through 180° mid-drag and snap the
        // sketch inside-out. Skip when geometry is too close to parallel — the
        // branch is undefined there and the user can re-add once it's clearer.
        if (type === CONSTRAINT_TYPES.PERPENDICULAR && normalized.shapes && normalized.shapes.length === 2 && normalized.branch == null) {
            this.lockPerpendicularBranch(state, normalized);
        }

        // Tangent branch auto-detect is intentionally OFF for now. Even with the
        // proximity gate, locking 'external' vs 'internal' at creation time can
        // surprise users — the solver gets pinned to a target distance the user
        // didn't explicitly choose. The lockTangentBranch helper is preserved
        // below so callers can opt in by passing `branch: 'external' | 'internal'`
        // explicitly. Re-enable here once we can detect the user's intent more
        // reliably (e.g. lock AFTER first convergence, not at creation).

        // Check duplicates
        if (constraints.hasConstraint(state.constraints, type, normalized)) {
            dbg.log('constraints', `[ConstraintManager] Duplicate ${type} constraint rejected`);
            return null;
        }

        // ── Conflict detection ─────────────────────────────────────────
        // Two layers:
        //   1. Math pre-check — catches common contradictions instantly (µs)
        //   2. Sandbox fallback — catches complex multi-constraint conflicts (~60 solver iterations)
        if (!opts.skipVerify) {
            // Layer 1: Pure math check against existing constraints
            const mathConflict = this._mathPreCheck(state, type, normalized);
            if (mathConflict) {
                const isStructural = STRUCTURAL_TYPES.has(type);
                if (isStructural) {
                    showNotification(`${this._friendlyName(type)} rejected — ${mathConflict} [ERR-CMATH-01]`, 'error', 3000);
                    dbg.warn('constraints', `[ConstraintManager] ${type} math-rejected: ${mathConflict} [ERR-CMATH-01]`);
                    return null;
                } else {
                    normalized.isDriven = true;
                    normalized.driven = true;
                    normalized.drivenReason = `math-precheck: ${mathConflict} [ERR-CMATH-02]`;
                    showNotification(`Dimension set to reference — ${mathConflict} [ERR-CMATH-02]`, 'warning', 3000);
                    dbg.log('constraints', `[ConstraintManager] ${type} auto-driven: ${mathConflict} [ERR-CMATH-02]`);
                }
            }

            // Layer 2: Sandbox solver check (only if math didn't already catch it)
            if (!mathConflict && state.engine && typeof state.engine.solve === 'function') {
                const solverConflict = this._sandboxVerify(state, type, normalized, opts.solveIterations);
                if (solverConflict) {
                    const isStructural = STRUCTURAL_TYPES.has(type);

                    // Try to gather diagnostic payload from last sandbox run (attached by _sandboxVerify)
                    const diag = (state && state._lastSandboxDiagnostic) ? state._lastSandboxDiagnostic : null;
                    const diagMsg = diag && diag.residual !== undefined ? ` (res: ${Number(diag.residual).toFixed(4)}${diag.id ? `, id: ${diag.id}` : ''})` : '';

                    if (isStructural) {
                        showNotification(`${this._friendlyName(type)} rejected — creates a conflict${diagMsg} [ERR-CSOLVE-01]`, 'error', 3000);
                        dbg.warn('constraints', `[ConstraintManager] ${type} sandbox-rejected [ERR-CSOLVE-01]`, diag || 'no-diag');
                        return null;
                    } else {
                        normalized.isDriven = true;
                        normalized.driven = true;
                        normalized.drivenReason = `sandbox-conflict [ERR-CSOLVE-02]`;
                        showNotification(`Dimension set to reference (conflict)${diagMsg} [ERR-CSOLVE-02]`, 'warning', 3000);
                        dbg.log('constraints', `[ConstraintManager] ${type} auto-driven (sandbox) [ERR-CSOLVE-02]`, diag || 'no-diag');
                    }
                }
            }
        }

        // Use existing canonical addConstraint path to validate and persist
        const added = constraints.addConstraint(state, type, normalized);
        if (!added) {
            dbg.warn('constraints', `[ConstraintManager] Failed to add ${type} constraint via addConstraint()`);
            return null;
        }

        // Find the constraint we just added
        let created = null;
        for (let i = state.constraints.length - 1; i >= 0; i--) {
            const c = state.constraints[i];
            if (c.type !== type) continue;
            // Heuristic match: compare keys
            if (type === CONSTRAINT_TYPES.HORIZONTAL || type === CONSTRAINT_TYPES.VERTICAL || type === CONSTRAINT_TYPES.COINCIDENT) {
                const cSet = new Set(c.joints || []);
                if ((normalized.joints || []).every(j => cSet.has(j))) { created = c; break; }
            } else if (type === CONSTRAINT_TYPES.PARALLEL || type === CONSTRAINT_TYPES.PERPENDICULAR) {
                const [a, b] = c.shapes || [];
                const [x, y] = normalized.shapes || [];
                if ((a === x && b === y) || (a === y && b === x)) { created = c; break; }
            } else {
                created = c; break;
            }
        }

        // Auto-solve if requested
        if (opts.autoSolve && state.engine && typeof state.engine.solve === 'function') {
            try {
                state.engine.solve(opts.solveIterations);
            } catch (e) {
                console.error('[ConstraintManager] Solver error:', e);
            }
        }

        dbg.log('constraints', `[ConstraintManager] Added ${type} constraint from ${opts.source}:`, created || { type, params: normalized });
        return created || true;
    }

    /**
     * Sandbox verification using divergence detection.
     *
     * Instead of running 500 iterations and measuring residuals, we:
     *   1. Snapshot joint positions
     *   2. Add the candidate constraint temporarily
     *   3. Run 3 short bursts of 15 iterations each (45 total)
     *   4. After each burst, measure total constraint error
     *   5. If error is GROWING or STUCK HIGH → conflict detected
     *      If error is SHRINKING toward zero → valid
     *   6. Rollback everything
     *
     * This is ~10x faster than full-solve verification and catches conflicts
     * earlier by detecting the solver fighting itself.
     */
    static _sandboxVerify(state, type, params, _unused) {
        try {
            // 1. Snapshot all joint positions
            const saved = new Map();
            for (const [id, j] of state.joints) saved.set(id, { x: j.x, y: j.y });

                // 2. Temporarily add the constraint
            const tempC = { ...params, type, __sandbox: true };
            state.constraints.push(tempC);

            // 3. Run short bursts and track error trajectory
            const BURSTS = 3;
            const ITERS_PER_BURST = SolverConfig.SANDBOX_ITERATIONS || 20; // Must align with solver's convergence check interval (k%20)
            const CONFLICT_THRESHOLD = SolverConfig.CONFLICT_THRESHOLD; // world units — same as verifier tolerance
            const errors = [];

            let hasConflict = false;
            try {
                for (let b = 0; b < BURSTS; b++) {
                    const result = state.engine.solve(ITERS_PER_BURST);
                    // Defensive: handle engines that return undefined or malformed results
                    if (!result || typeof result.error !== 'number') {
                        // Treat as non-conflict but abort further verification
                        break;
                    }
                    errors.push(result.error);

                    // Early exit: if already converged, no conflict
                    if (result.converged && result.error < 1e-6) break;
                }

                // 4. Analyze trajectory only if we have numeric errors
                if (errors.length > 0) {
                    hasConflict = this._detectConflict(errors, CONFLICT_THRESHOLD);

                    // Attach last-sandbox diagnostic for UI/notifications (residual + best failing constraint id when available)
                    try {
                        const final = errors[errors.length - 1];
                        const diag = { residual: final };
                        if (state && state.engine && typeof state.engine.getSolveStats === 'function') {
                            try {
                                const stats = state.engine.getSolveStats();
                                if (stats && Array.isArray(stats.constraintErrors) && stats.constraintErrors.length > 0) {
                                    diag.id = stats.constraintErrors[0].id;
                                }
                            } catch(_) { /* best-effort */ }
                        }
                        state._lastSandboxDiagnostic = diag;
                    } catch(_) { /* ignore diagnostic attach errors */ }
                } else {
                    hasConflict = false; // Fail-open if engine can't report errors
                    // Clear any previous sandbox diagnostic
                    if (state && state._lastSandboxDiagnostic) delete state._lastSandboxDiagnostic;
                }
            } finally {
                // 5. Remove temp constraint
                const idx = state.constraints.indexOf(tempC);
                if (idx !== -1) state.constraints.splice(idx, 1);

                // 6. Restore joint positions
                for (const [id, j] of state.joints) {
                    const s = saved.get(id);
                    if (s) { j.x = s.x; j.y = s.y; }
                }
            }

            return hasConflict;
        } catch (e) {
            dbg.warn('constraints', '[ConstraintManager] Sandbox verify error:', e);
            return false; // Fail-open
        }
    }

    /**
     * Detect conflict from error trajectory.
     *
     * Conflict signals:
     *   - Error growing between bursts (solver fighting itself)
     *   - Error stuck above threshold (solver can't reduce it)
     *   - Final error still above threshold after all bursts
     *
     * Valid signals:
     *   - Error shrinking toward zero across bursts
     *   - Final error below threshold
     */
    static _detectConflict(errors, threshold) {
        if (errors.length === 0) return false;

        const final = errors[errors.length - 1];

        // Fast path: converged below threshold
        if (final < threshold) return false;

        if (errors.length >= 2) {
            const first = errors[0];
            // Diverging or stagnating: didn't shrink by at least 20%
            const notConverging = final >= first * 0.8;
            if (notConverging && final > threshold) return true;

            // Stagnation: negligible reduction across all bursts
            const reduction = (first - final) / (first || 1);
            if (reduction < 0.1 && final > threshold) return true;
        }

        // Final error still high after all bursts
        if (final > threshold) return true;

        return false;
    }

    /** Human-readable constraint name for notifications */
    static _friendlyName(type) {
        const names = {
            [CONSTRAINT_TYPES.COINCIDENT]: 'Coincident',
            [CONSTRAINT_TYPES.HORIZONTAL]: 'Horizontal',
            [CONSTRAINT_TYPES.VERTICAL]: 'Vertical',
            [CONSTRAINT_TYPES.PARALLEL]: 'Parallel',
            [CONSTRAINT_TYPES.PERPENDICULAR]: 'Perpendicular',
            [CONSTRAINT_TYPES.COLLINEAR]: 'Collinear',
            [CONSTRAINT_TYPES.TANGENT]: 'Tangent',
            [CONSTRAINT_TYPES.POINT_ON_LINE]: 'Point on Line',
            [CONSTRAINT_TYPES.EQUAL]: 'Equal',
            [CONSTRAINT_TYPES.DISTANCE]: 'Distance',
            [CONSTRAINT_TYPES.ANGLE]: 'Angle',
            [CONSTRAINT_TYPES.MIDPOINT]: 'Midpoint',
        };
        return names[type] || type;
    }

    // ── Math Pre-Check ────────────────────────────────────────────────
    // Pure geometry checks that catch contradictions in microseconds.
    // Returns a reason string if conflict found, null if ok.

    /**
     * Index helpers: find existing constraints that share joints/shapes
     * with the candidate constraint.
     */
    static _getJointPairKey(j1, j2) {
        return j1 < j2 ? `${j1}|${j2}` : `${j2}|${j1}`;
    }

    static _getShapePairKey(s1, s2) {
        return s1 < s2 ? `${s1}|${s2}` : `${s2}|${s1}`;
    }

    /**
     * Math pre-check: test the new constraint against existing constraints
     * for common geometric contradictions.
     *
     * Returns a reason string (conflict found) or null (ok).
     */
    static _mathPreCheck(state, type, params) {
        const constraints = state.constraints;
        const joints = state.joints;
        const shapes = state.shapes;

        // Helper: get all existing constraints on a joint pair
        const onJointPair = (j1, j2) => {
            const key = this._getJointPairKey(j1, j2);
            return constraints.filter(c => {
                if (!c.joints || c.joints.length < 2) return false;
                return this._getJointPairKey(c.joints[0], c.joints[1]) === key;
            });
        };

        // Helper: get all existing constraints on a shape pair
        const onShapePair = (s1, s2) => {
            const key = this._getShapePairKey(s1, s2);
            return constraints.filter(c => {
                if (!c.shapes || c.shapes.length < 2) return false;
                return this._getShapePairKey(c.shapes[0], c.shapes[1]) === key;
            });
        };

        // Helper: check if a joint is fully fixed (DOF 0)
        const isFixed = (jid) => {
            const j = joints.get(jid);
            return j && (j.fixed || jid === 'j_origin');
        };

        // Helper: check if a joint is fixed by coincident chain to a fixed joint
        const isEffectivelyFixed = (jid) => {
            if (isFixed(jid)) return true;
            // Walk full coincident chain (BFS for multi-hop)
            const visited = new Set([jid]);
            const queue = [jid];
            while (queue.length > 0) {
                const current = queue.shift();
                for (const c of constraints) {
                    if (c.type !== CONSTRAINT_TYPES.COINCIDENT || !c.joints) continue;
                    if (!c.joints.includes(current)) continue;
                    for (const other of c.joints) {
                        if (other === current || visited.has(other)) continue;
                        if (isFixed(other)) return true;
                        visited.add(other);
                        queue.push(other);
                    }
                }
            }
            return false;
        };

        // Helper: get the effective position of a joint (resolving coincident to fixed)
        const getPos = (jid) => {
            const j = joints.get(jid);
            if (!j) return null;
            return { x: j.x, y: j.y };
        };

        switch (type) {

            // ── HORIZONTAL / VERTICAL ─────────────────────────────────────
            case CONSTRAINT_TYPES.HORIZONTAL:
            case CONSTRAINT_TYPES.VERTICAL: {
                if (!params.joints || params.joints.length < 2) return null;
                const [j1, j2] = params.joints;
                const existing = onJointPair(j1, j2);

                for (const c of existing) {
                    // H + V on same pair → impossible
                    if (c.type === CONSTRAINT_TYPES.HORIZONTAL && type === CONSTRAINT_TYPES.VERTICAL) return 'conflicts with Horizontal';
                    if (c.type === CONSTRAINT_TYPES.VERTICAL && type === CONSTRAINT_TYPES.HORIZONTAL) return 'conflicts with Vertical';

                    // H/V + angle on same pair
                    if (c.type === CONSTRAINT_TYPES.DISTANCE && c.dimMode) {
                        // Adding H when there's already a vertical dim, or vice versa — that's fine
                        // But adding H when there's already a horizontal dim AND both joints fixed → over-determined
                    }
                }

                // Check if both joints are fixed — adding H/V would require moving them
                if (isEffectivelyFixed(j1) && isEffectivelyFixed(j2)) {
                    const p1 = getPos(j1), p2 = getPos(j2);
                    if (p1 && p2) {
                        if (type === CONSTRAINT_TYPES.HORIZONTAL && Math.abs(p1.y - p2.y) > (SolverConfig.GEOMETRY_TOLERANCE || 0.05)) {
                            return 'joints are fixed and not horizontal';
                        }
                        if (type === CONSTRAINT_TYPES.VERTICAL && Math.abs(p1.x - p2.x) > (SolverConfig.GEOMETRY_TOLERANCE || 0.05)) {
                            return 'joints are fixed and not vertical';
                        }
                    }
                }

                // H/V on a line that has parallel to another line that is V/H
                if (params.joints) {
                    // Find the shape this joint pair belongs to
                    const shape = shapes.find(s => s.joints && s.joints.length >= 2 &&
                        this._getJointPairKey(s.joints[0], s.joints[1]) === this._getJointPairKey(j1, j2));
                    if (shape) {
                        for (const c of constraints) {
                            if (c.type !== CONSTRAINT_TYPES.PARALLEL || !c.shapes) continue;
                            if (!c.shapes.includes(shape.id)) continue;
                            const otherId = c.shapes.find(s => s !== shape.id);
                            const otherShape = shapes.find(s => s.id === otherId);
                            if (!otherShape || !otherShape.joints || otherShape.joints.length < 2) continue;
                            // Check if other shape has opposite H/V constraint
                            const otherExisting = onJointPair(otherShape.joints[0], otherShape.joints[1]);
                            for (const oc of otherExisting) {
                                if (oc.type === CONSTRAINT_TYPES.HORIZONTAL && type === CONSTRAINT_TYPES.VERTICAL) return 'parallel line is Horizontal';
                                if (oc.type === CONSTRAINT_TYPES.VERTICAL && type === CONSTRAINT_TYPES.HORIZONTAL) return 'parallel line is Vertical';
                            }
                        }
                    }
                }
                return null;
            }

            // ── PARALLEL / PERPENDICULAR ──────────────────────────────────
            case CONSTRAINT_TYPES.PARALLEL:
            case CONSTRAINT_TYPES.PERPENDICULAR: {
                if (!params.shapes || params.shapes.length < 2) return null;
                const [s1, s2] = params.shapes;
                const existing = onShapePair(s1, s2);

                for (const c of existing) {
                    // Parallel + Perpendicular on same pair → impossible
                    if (c.type === CONSTRAINT_TYPES.PARALLEL && type === CONSTRAINT_TYPES.PERPENDICULAR) return 'conflicts with Parallel';
                    if (c.type === CONSTRAINT_TYPES.PERPENDICULAR && type === CONSTRAINT_TYPES.PARALLEL) return 'conflicts with Perpendicular';
                }

                // Check H/V cross-conflicts: parallel to a horizontal line + vertical constraint
                const shape1 = shapes.find(s => s.id === s1);
                const shape2 = shapes.find(s => s.id === s2);
                if (shape1 && shape2 && shape1.joints && shape2.joints) {
                    const h1 = this._hasConstraintType(constraints, shape1, CONSTRAINT_TYPES.HORIZONTAL);
                    const v1 = this._hasConstraintType(constraints, shape1, CONSTRAINT_TYPES.VERTICAL);
                    const h2 = this._hasConstraintType(constraints, shape2, CONSTRAINT_TYPES.HORIZONTAL);
                    const v2 = this._hasConstraintType(constraints, shape2, CONSTRAINT_TYPES.VERTICAL);

                    if (type === CONSTRAINT_TYPES.PARALLEL) {
                        if ((h1 && v2) || (v1 && h2)) return 'one line is Horizontal, other is Vertical';
                    }
                    if (type === CONSTRAINT_TYPES.PERPENDICULAR) {
                        if ((h1 && h2) || (v1 && v2)) return 'both lines have same orientation';
                    }
                }
                return null;
            }

            // ── COINCIDENT ────────────────────────────────────────────────
            case CONSTRAINT_TYPES.COINCIDENT: {
                if (!params.joints || params.joints.length < 2) return null;
                const [j1, j2] = params.joints;

                // Both fixed at different positions → impossible
                if (isEffectivelyFixed(j1) && isEffectivelyFixed(j2)) {
                    const p1 = getPos(j1), p2 = getPos(j2);
                    if (p1 && p2) {
                        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                        if (d > (SolverConfig.GEOMETRY_TOLERANCE || 0.05)) return 'both joints are fixed at different positions';
                    }
                }
                return null;
            }

            // ── DISTANCE ──────────────────────────────────────────────────
            case CONSTRAINT_TYPES.DISTANCE: {
                if (params.isDriven || params.driven) return null; // Already driven, no conflict possible

                // Fixed endpoints with mismatched length → force drive/demote
                // Only treat as immovable when BOTH are explicitly fixed (or origin), not just constrained by chain.
                if (params.joints && params.joints.length >= 2 && typeof params.value === 'number') {
                    const [j1, j2] = params.joints;
                    if (isFixed(j1) && isFixed(j2)) {
                        const p1 = getPos(j1);
                        const p2 = getPos(j2);
                        if (p1 && p2) {
                            const actual = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                            const tol = SolverConfig.DIMENSION_MATCH_TOL || 0.01;
                            if (Math.abs(actual - params.value) > tol) {
                                return `joints are fixed at distance ${actual.toFixed(2)}`;
                            }
                        }
                    }
                }

                // Radius: check for duplicate radius constraint on same shape
                if (params.isRadius && params.shape) {
                    for (const c of constraints) {
                        if (c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius && c.shape === params.shape) {
                            if (!c.isDriven && !c.driven) return 'shape already has a driving radius';
                        }
                    }
                    return null;
                }

                // Joint-pair distance: check for conflicting distance on same pair
                if (params.joints && params.joints.length >= 2) {
                    const [j1, j2] = params.joints;
                    const dimMode = params.dimMode || 'aligned';
                    const existing = onJointPair(j1, j2);

                    for (const c of existing) {
                        if (c.type !== CONSTRAINT_TYPES.DISTANCE) continue;
                        if (c.isDriven || c.driven) continue;
                        const cMode = c.dimMode || 'aligned';

                        // Same dimension mode on same pair with different value
                        if (cMode === dimMode && typeof c.value === 'number' && typeof params.value === 'number') {
                            if (Math.abs(c.value - params.value) > (SolverConfig.DIMENSION_MATCH_TOL || 0.01)) {
                                return `conflicts with existing ${cMode} dimension (${c.value.toFixed(1)})`;
                            }
                        }
                    }

                    // Triangle inequality: if both joints connect to a common third fixed joint
                    // with known distances, check if the triangle is possible
                    if (typeof params.value === 'number') {
                        const triConflict = this._triangleCheck(state, j1, j2, params.value, dimMode);
                        if (triConflict) return triConflict;
                    }
                }
                return null;
            }

            // ── ANGLE ─────────────────────────────────────────────────────
            case CONSTRAINT_TYPES.ANGLE: {
                if (!params.shapes || params.shapes.length < 2) return null;
                const [s1, s2] = params.shapes;

                // Check if angle conflicts with parallel/perpendicular
                const existing = onShapePair(s1, s2);
                for (const c of existing) {
                    if (c.type === CONSTRAINT_TYPES.PARALLEL) {
                        // Parallel means angle is 0 or 180
                        if (typeof params.value === 'number' && Math.abs(params.value % 180) > 0.5) {
                            return 'conflicts with Parallel (angle must be 0° or 180°)';
                        }
                    }
                    if (c.type === CONSTRAINT_TYPES.PERPENDICULAR) {
                        // Perpendicular means angle is 90
                        if (typeof params.value === 'number' && Math.abs((params.value % 180) - 90) > 0.5) {
                            return 'conflicts with Perpendicular (angle must be 90°)';
                        }
                    }
                }

                // H/V cross-check
                const shape1 = shapes.find(s => s.id === s1);
                const shape2 = shapes.find(s => s.id === s2);
                if (shape1 && shape2) {
                    const h1 = this._hasConstraintType(constraints, shape1, CONSTRAINT_TYPES.HORIZONTAL);
                    const v1 = this._hasConstraintType(constraints, shape1, CONSTRAINT_TYPES.VERTICAL);
                    const h2 = this._hasConstraintType(constraints, shape2, CONSTRAINT_TYPES.HORIZONTAL);
                    const v2 = this._hasConstraintType(constraints, shape2, CONSTRAINT_TYPES.VERTICAL);
                    if (typeof params.value === 'number') {
                        // Both horizontal → angle must be 0/180
                        if (h1 && h2 && Math.abs(params.value % 180) > 0.5) return 'both lines are Horizontal';
                        // Both vertical → angle must be 0/180
                        if (v1 && v2 && Math.abs(params.value % 180) > 0.5) return 'both lines are Vertical';
                        // One H one V → angle must be 90
                        if ((h1 && v2) || (v1 && h2)) {
                            if (Math.abs((params.value % 180) - 90) > 0.5) return 'lines are H and V (angle is 90°)';
                        }
                    }
                }
                return null;
            }

            // ── EQUAL ─────────────────────────────────────────────────────
            case CONSTRAINT_TYPES.EQUAL: {
                if (!params.shapes || params.shapes.length < 2) return null;
                const [s1, s2] = params.shapes;
                // If both shapes have driving dimensions, check they match
                const getDriving = (sid) => {
                    for (const c of constraints) {
                        if (c.type !== CONSTRAINT_TYPES.DISTANCE) continue;
                        if (c.isDriven || c.driven) continue;
                        if (c.isRadius && c.shape === sid && typeof c.value === 'number') return c.value;
                        if (c.joints && c.joints.length === 2 && (!c.dimMode || c.dimMode === 'aligned')) {
                            const s = shapes.find(sh => sh.id === sid);
                            if (s && s.joints && s.joints.length >= 2) {
                                const key = this._getJointPairKey(s.joints[0], s.joints[1]);
                                const cKey = this._getJointPairKey(c.joints[0], c.joints[1]);
                                if (key === cKey && typeof c.value === 'number') return c.value;
                            }
                        }
                    }
                    return null;
                };
                const d1 = getDriving(s1);
                const d2 = getDriving(s2);
                if (d1 !== null && d2 !== null && Math.abs(d1 - d2) > (SolverConfig.DIMENSION_MATCH_TOL || 0.01)) {
                    return `shapes have conflicting fixed dimensions (${d1.toFixed(1)} vs ${d2.toFixed(1)})`;
                }
                return null;
            }

            // ── MIDPOINT ──────────────────────────────────────────────────
            case CONSTRAINT_TYPES.MIDPOINT: {
                if (!params.joints || params.joints.length !== 3) return null;
                const [ep1, ep2, mid] = params.joints;
                if (isEffectivelyFixed(ep1) && isEffectivelyFixed(ep2) && isEffectivelyFixed(mid)) {
                    const p1 = getPos(ep1), p2 = getPos(ep2), pm = getPos(mid);
                    if (p1 && p2 && pm) {
                        const mx = (p1.x + p2.x) / 2;
                        const my = (p1.y + p2.y) / 2;
                        if (Math.hypot(pm.x - mx, pm.y - my) > (SolverConfig.GEOMETRY_TOLERANCE || 0.05)) {
                            return 'all joints are fixed and midpoint does not lie at center';
                        }
                    }
                }
                return null;
            }

            default:
                return null;
        }
    }

    /** Check if a shape has an H or V constraint on its joints */
    static _hasConstraintType(constraints, shape, type) {
        if (!shape.joints || shape.joints.length < 2) return false;
        const key = this._getJointPairKey(shape.joints[0], shape.joints[1]);
        return constraints.some(c =>
            c.type === type && c.joints && c.joints.length >= 2 &&
            this._getJointPairKey(c.joints[0], c.joints[1]) === key
        );
    }

    /**
     * Triangle inequality check for distance constraints.
     * If joints j1 and j2 each have distance constraints to a shared third joint,
     * verify the triangle inequality holds.
     */
    static _triangleCheck(state, j1, j2, newDist, dimMode) {
        if (dimMode !== 'aligned') return null; // Only applies to euclidean distances

        // Find all distance constraints involving j1 or j2
        const distTo = (jid) => {
            const result = [];
            for (const c of state.constraints) {
                if (c.type !== CONSTRAINT_TYPES.DISTANCE) continue;
                if (c.isDriven || c.driven) continue;
                if (c.dimMode && c.dimMode !== 'aligned') continue;
                if (!c.joints || c.joints.length < 2) continue;
                if (c.joints[0] === jid) result.push({ other: c.joints[1], dist: c.value });
                else if (c.joints[1] === jid) result.push({ other: c.joints[0], dist: c.value });
            }
            return result;
        };

        const d1 = distTo(j1); // distances from j1 to other joints
        const d2 = distTo(j2); // distances from j2 to other joints

        // Find common third joints
        for (const a of d1) {
            for (const b of d2) {
                if (a.other === b.other && typeof a.dist === 'number' && typeof b.dist === 'number') {
                    // Triangle: j1 -- a.dist -- third -- b.dist -- j2, with newDist between j1-j2
                    const sides = [a.dist, b.dist, newDist].sort((x, y) => x - y);
                    if (sides[2] > sides[0] + sides[1] + (SolverConfig.TRIANGLE_INEQ_TOL || 0.01)) {
                        return `triangle inequality violated (${a.dist.toFixed(1)} + ${b.dist.toFixed(1)} < ${newDist.toFixed(1)})`;
                    }
                }
            }
        }
        return null;
    }

    static addHorizontal(state, joints, options = {}) {
        return this.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints }, { source: 'helper', ...options });
    }

    static addVertical(state, joints, options = {}) {
        return this.createConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints }, { source: 'helper', ...options });
    }

    static addPerpendicular(state, shape1, shape2, options = {}) {
        return this.createConstraint(state, CONSTRAINT_TYPES.PERPENDICULAR, { shapes: [shape1, shape2] }, { source: 'helper', ...options });
    }

    static addHorizontalOrVertical(state, joints, options = {}) {
        const [j1Id, j2Id] = joints;
        const j1 = state.joints.get(j1Id);
        const j2 = state.joints.get(j2Id);
        if (!j1 || !j2) {
            dbg.warn('constraints', '[ConstraintManager] Invalid joints for H/V constraint');
            return null;
        }
        const dx = Math.abs(j2.x - j1.x);
        const dy = Math.abs(j2.y - j1.y);
        const type = dx > dy ? CONSTRAINT_TYPES.HORIZONTAL : CONSTRAINT_TYPES.VERTICAL;
        return this.createConstraint(state, type, { joints }, { source: 'auto-detect', ...options });
    }

    static validateParams(type, params) {
        switch (type) {
            case CONSTRAINT_TYPES.HORIZONTAL:
            case CONSTRAINT_TYPES.VERTICAL:
            case CONSTRAINT_TYPES.COINCIDENT:
                return params.joints && Array.isArray(params.joints) && params.joints.length >= 2;
            case CONSTRAINT_TYPES.PARALLEL:
            case CONSTRAINT_TYPES.PERPENDICULAR:
                return params.shapes && Array.isArray(params.shapes) && params.shapes.length === 2;
            case CONSTRAINT_TYPES.POINT_ON_LINE:
                return !!(params.joint && params.shape);
            case CONSTRAINT_TYPES.DISTANCE:
                // Joint-pair, radius, OR line-line (shapes) distance
                return (params.joints && params.joints.length === 2)
                    || (params.isRadius && params.shape)
                    || (params.shapes && Array.isArray(params.shapes) && params.shapes.length === 2);
            case CONSTRAINT_TYPES.COLLINEAR:
                // Shape-pair (2 lines) or joint-based (3+ joints)
                return (params.shapes && Array.isArray(params.shapes) && params.shapes.length >= 2)
                    || (params.joints && params.joints.length >= 3);
            case CONSTRAINT_TYPES.TANGENT:
                // Line+circle OR shapes pair (circle+circle, line+circle)
                return !!(params.line && params.circle)
                    || (params.shapes && Array.isArray(params.shapes) && params.shapes.length === 2);
            case CONSTRAINT_TYPES.EQUAL:
                return params.shapes && Array.isArray(params.shapes) && params.shapes.length === 2;
            case CONSTRAINT_TYPES.MIDPOINT:
                return params.joints && Array.isArray(params.joints) && params.joints.length === 3;
            case CONSTRAINT_TYPES.ANGLE:
                return params.shapes && Array.isArray(params.shapes) && params.shapes.length === 2 && typeof params.value === 'number';
            default:
                return false;
        }
    }

    // Auto-detect and store the handedness sign for perpendicular constraints.
    // Branch is +1 if line2 is rotated CCW from line1 (cross > 0), -1 otherwise.
    // Skipped when lines are nearly parallel: branch is undefined there.
    static lockPerpendicularBranch(state, normalized) {
        try {
            const s1 = state.shapes.find(s => s.id === normalized.shapes[0]);
            const s2 = state.shapes.find(s => s.id === normalized.shapes[1]);
            if (!s1 || !s2 || s1.type !== 'line' || s2.type !== 'line') return;
            if (!s1.joints || s1.joints.length < 2 || !s2.joints || s2.joints.length < 2) return;
            const a = state.joints.get(s1.joints[0]);
            const b = state.joints.get(s1.joints[1]);
            const c = state.joints.get(s2.joints[0]);
            const d = state.joints.get(s2.joints[1]);
            if (!a || !b || !c || !d) return;
            const ux = b.x - a.x, uy = b.y - a.y;
            const vx = d.x - c.x, vy = d.y - c.y;
            const lenU = Math.hypot(ux, uy), lenV = Math.hypot(vx, vy);
            if (lenU < 1e-9 || lenV < 1e-9) return;
            const cross = ux * vy - uy * vx;
            // Skip near-parallel: |sin θ| < ~0.1 means the branch is ambiguous.
            if (Math.abs(cross) < 0.1 * lenU * lenV) return;
            normalized.branch = cross >= 0 ? 1 : -1;
            dbg.log('constraints', '[ConstraintManager] perpendicular branch locked:', normalized.branch);
        } catch (e) {
            dbg.warn('constraints', '[ConstraintManager] lockPerpendicularBranch error:', e);
        }
    }

    // Auto-detect external vs internal tangent for circle-circle from current geometry.
    //
    // Branch-lock only fires when the sketch is ALREADY near a tangent
    // configuration — i.e. the user has positioned the circles to be roughly
    // tangent and is adding the constraint to formalize what's there. We then
    // pin the branch they're already on so a later drag can't flip it.
    //
    // If the geometry is far from any tangent configuration (residual >
    // ~25% of the larger radius for both targets), we DON'T lock. The solver
    // picks the closer target naturally on the first solve. Forcing a branch
    // in that case can drive the geometry into a configuration the user never
    // wanted, which feels like the constraint is "locking everything."
    static lockTangentBranch(state, normalized) {
        try {
            const s1 = state.shapes.find(s => s.id === normalized.shapes[0]);
            const s2 = state.shapes.find(s => s.id === normalized.shapes[1]);
            if (!s1 || !s2) return;
            const isCircular = (s) => s.type === 'circle' || s.type === 'arc';
            if (!isCircular(s1) || !isCircular(s2)) return; // only circle-circle has the internal/external choice
            const radiusOf = (s) => {
                if (typeof s.radius === 'number') return s.radius;
                if (s.joints && s.joints.length >= 2) {
                    const c = state.joints.get(s.joints[0]);
                    const r = state.joints.get(s.joints[1]);
                    if (c && r) return Math.hypot(r.x - c.x, r.y - c.y);
                }
                return 0;
            };
            const c1 = state.joints.get(s1.joints && s1.joints[0]);
            const c2 = state.joints.get(s2.joints && s2.joints[0]);
            if (!c1 || !c2) return;
            const r1 = radiusOf(s1), r2 = radiusOf(s2);
            if (r1 < 1e-9 || r2 < 1e-9) return;
            const dist = Math.hypot(c2.x - c1.x, c2.y - c1.y);
            const tExt = r1 + r2;
            const tInt = Math.abs(r1 - r2);
            const resExt = Math.abs(dist - tExt);
            const resInt = Math.abs(dist - tInt);
            const chosenRes = Math.min(resExt, resInt);
            // Only lock when the chosen branch's residual is small relative to
            // the radius scale — i.e. the user's circles are already roughly
            // tangent. Otherwise leave the field unset so the solver picks
            // freely on its first run.
            const proximityThreshold = 0.25 * Math.max(r1, r2);
            if (chosenRes > proximityThreshold) return;
            // Equal radii → tInt = 0 (concentric); always pick external.
            if (tInt < 1e-9) { normalized.branch = 'external'; return; }
            normalized.branch = resInt < resExt ? 'internal' : 'external';
            dbg.log('constraints', '[ConstraintManager] tangent branch locked:', normalized.branch);
        } catch (e) {
            dbg.warn('constraints', '[ConstraintManager] lockTangentBranch error:', e);
        }
    }

    static alignParallelOrientation(state, shapeIds) {
        try {
            const s1 = state.shapes.find(s => s.id === shapeIds[0]);
            const s2 = state.shapes.find(s => s.id === shapeIds[1]);
            if (!s1 || !s2 || s1.type !== 'line' || s2.type !== 'line') return;

            const j1a = state.joints.get(s1.joints[0]);
            const j1b = state.joints.get(s1.joints[1]);
            const j2a = state.joints.get(s2.joints[0]);
            const j2b = state.joints.get(s2.joints[1]);

            if (!j1a || !j1b || !j2a || !j2b) return;

            const dx1 = j1b.x - j1a.x;
            const dy1 = j1b.y - j1a.y;
            const dx2 = j2b.x - j2a.x;
            const dy2 = j2b.y - j2a.y;

            // Dot product < 0 means vectors are roughly opposing (anti-parallel)
            if (dx1 * dx2 + dy1 * dy2 < 0) {
                dbg.log('constraints', '[ConstraintManager] Auto-aligning anti-parallel lines to prevent flip');
                const temp = s2.joints[0];
                s2.joints[0] = s2.joints[1];
                s2.joints[1] = temp;
            }
        } catch (e) {
            dbg.warn('constraints', '[ConstraintManager] Error aligning parallel lines:', e);
        }
    }

    static normalizeParams(type, params) {
        const normalized = { ...params };
        try{
            if (normalized.joints && Array.isArray(normalized.joints)) {
                normalized.joints = normalized.joints.map(j => (typeof j === 'object' && j.id) ? j.id : j);
            }
            if (normalized.shapes && Array.isArray(normalized.shapes)) {
                normalized.shapes = normalized.shapes.map(s => (typeof s === 'object' && s.id) ? s.id : s);
            }
        }catch(_){ }
        return normalized;
    }
}
