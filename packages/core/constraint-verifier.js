import { getDist, projectPointOnLine, perpendicularDistance, resolveJoints, isPointLineDistance } from './geometry.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { constraintReferencesAxis, sceneJoints, sceneShapes } from './reference-lines.js';

export function measureResidual(c, joints, shapes) {
    if (!c) return 0;
    // a constraint that names an axis resolves it in the scene (task 539); every other constraint reads the containers as given
    if (constraintReferencesAxis(c)) { joints = sceneJoints(joints); shapes = sceneShapes(shapes); }

    switch (c.type) {
        case CONSTRAINT_TYPES.COINCIDENT: {
            const pts = resolveJoints(joints, c.joints);
            if (!pts || pts.length < 2) return 0;
            return getDist(pts[0], pts[1]);
        }

        case CONSTRAINT_TYPES.DISTANCE: {
            let currentDist = 0;
            if (c.isRadius && c.shape) {
                const s = shapes.find(sh => sh.id === c.shape);
                if (s) {
                    if (typeof s.radius === 'number') currentDist = s.radius;
                    else if (s.joints && s.joints.length >= 2) {
                        const center = joints.get(s.joints[0]);
                        const rim = joints.get(s.joints[1]);
                        if (center && rim) currentDist = getDist(center, rim);
                    }
                }
            } else if (isPointLineDistance(c)) {
                // Point-to-line: the same convention as the solver row (distance.__lineLine) -- |perpendicular distance| from P to line AB.
                const pt = joints.get(c.joints[0]), a = joints.get(c.joints[1]), b = joints.get(c.joints[2]);
                if (pt && a && b) currentDist = Math.abs(perpendicularDistance(pt, a, b));
            } else if (c.shapes && c.shapes.length === 2 && !(c.joints && c.joints.length >= 2)) {
                // Line-to-line distance: SAME convention as the solver row (solver/engine.js line-line synthesis,
                // definitions.js distance.__lineLine) -- perpendicular distance from line 2's FIRST endpoint to the
                // infinite line 1 -- so verifier and solver can never disagree. (Was unmeasured -> currentDist 0 ->
                // residual == value -> converged=false and the dimension demoted to reference.)
                const s1 = shapes.find(sh => sh.id === c.shapes[0]);
                const s2 = shapes.find(sh => sh.id === c.shapes[1]);
                if (s1 && s2 && s1.joints && s1.joints.length >= 2 && s2.joints && s2.joints.length >= 1) {
                    const a = joints.get(s1.joints[0]), b = joints.get(s1.joints[1]), pt = joints.get(s2.joints[0]);
                    if (a && b && pt) currentDist = Math.abs(perpendicularDistance(pt, a, b));
                }
            } else if (c.joints && c.joints.length >= 2) {
                const j1 = joints.get(c.joints[0]);
                const j2 = joints.get(c.joints[1]);
                if (j1 && j2) {
                    if (c.dimMode === 'horizontal') currentDist = Math.abs(j2.x - j1.x);
                    else if (c.dimMode === 'vertical') currentDist = Math.abs(j2.y - j1.y);
                    else currentDist = getDist(j1, j2);
                }
            }
            return Math.abs(currentDist - (c.value || 0));
        }

        case CONSTRAINT_TYPES.HORIZONTAL: {
            const pts = resolveJoints(joints, c.joints);
            if (!pts || pts.length < 2) return 0;
            return Math.abs(pts[0].y - pts[1].y);
        }

        case CONSTRAINT_TYPES.VERTICAL: {
            const pts = resolveJoints(joints, c.joints);
            if (!pts || pts.length < 2) return 0;
            return Math.abs(pts[0].x - pts[1].x);
        }

        case CONSTRAINT_TYPES.POINT_ON_LINE: {
            const pt = joints.get(c.joint);
            const shape = shapes.find(s => s.id === c.shape);
            if (pt && shape) {
                if (shape.type === 'line' && shape.joints.length >= 2) {
                    const p1 = joints.get(shape.joints[0]);
                    const p2 = joints.get(shape.joints[1]);
                    // perpendicularDistance is SIGNED -- point-on-line is satisfied at distance 0
                    // regardless of which side, so a negative signed value must be abs'd or a point
                    // sitting well off the line on one particular side reads as "satisfied".
                    if (p1 && p2) return Math.abs(perpendicularDistance(pt, p1, p2));
                } else if (shape.type === 'circle' || shape.type === 'arc') {
                    const center = joints.get(shape.joints[0]);
                    let radius = shape.radius;
                    if (typeof radius !== 'number' && shape.joints.length > 1) {
                        const rim = joints.get(shape.joints[1]);
                        if (center && rim) radius = getDist(center, rim);
                    }
                    if (center && typeof radius === 'number') {
                        const dist = getDist(pt, center);
                        return Math.abs(dist - radius);
                    }
                }
            }
            return 0;
        }

        case CONSTRAINT_TYPES.COLLINEAR: {
            if (c.shapes && c.shapes.length === 2) {
                const s1 = shapes.find(s => s.id === c.shapes[0]);
                const s2 = shapes.find(s => s.id === c.shapes[1]);
                if (s1 && s2 && s1.type === 'line' && s2.type === 'line') {
                    const j1 = joints.get(s1.joints[0]);
                    const j2 = joints.get(s1.joints[1]);
                    const j3 = joints.get(s2.joints[0]);
                    const j4 = joints.get(s2.joints[1]);
                    if (j1 && j2 && j3 && j4) {
                        const p3 = projectPointOnLine(j3, j1, j2);
                        const p4 = projectPointOnLine(j4, j1, j2);
                        return Math.max(getDist(j3, p3), getDist(j4, p4));
                    }
                }
            } else if (c.joints && c.joints.length >= 3) {
                const pts = resolveJoints(joints, c.joints);
                if (!pts || pts.length < 3) return 0;
                const p1 = pts[0];
                const p2 = pts[1];
                let maxErr = 0;
                for (let i = 2; i < pts.length; i++) {
                    // Same sign fix: a point off the line on the negative-normal side must not
                    // silently lose to maxErr's 0 starting value.
                    const err = Math.abs(perpendicularDistance(pts[i], p1, p2));
                    if (err > maxErr) maxErr = err;
                }
                return maxErr;
            }
            return 0;
        }

        case CONSTRAINT_TYPES.PARALLEL: {
            if (c.shapes && c.shapes.length === 2) {
                const s1 = shapes.find(s => s.id === c.shapes[0]);
                const s2 = shapes.find(s => s.id === c.shapes[1]);
                if (s1 && s2 && s1.type === 'line' && s2.type === 'line') {
                    const j1 = joints.get(s1.joints[0]);
                    const j2 = joints.get(s1.joints[1]);
                    const j3 = joints.get(s2.joints[0]);
                    const j4 = joints.get(s2.joints[1]);
                    if (j1 && j2 && j3 && j4) {
                        // Solver residual is cross(u,v) = |u||v| sin(theta): exactly 0 when either line is zero-length (angle undefined),
                        // so the verifier must not invent an atan2(0,0) angle there. Otherwise the same angular distance mod 180 deg.
                        if (Math.hypot(j2.x - j1.x, j2.y - j1.y) < 1e-12 || Math.hypot(j4.x - j3.x, j4.y - j3.y) < 1e-12) return 0;
                        const a1 = Math.atan2(j2.y - j1.y, j2.x - j1.x);
                        const a2 = Math.atan2(j4.y - j3.y, j4.x - j3.x);
                        let diff = Math.abs(a1 - a2);
                        while (diff > Math.PI / 2) diff = Math.abs(diff - Math.PI);
                        return diff;
                    }
                }
            }
            return 0;
        }

        case CONSTRAINT_TYPES.PERPENDICULAR: {
            if (c.shapes && c.shapes.length === 2) {
                const s1 = shapes.find(s => s.id === c.shapes[0]);
                const s2 = shapes.find(s => s.id === c.shapes[1]);
                if (s1 && s2 && s1.type === 'line' && s2.type === 'line') {
                    const j1 = joints.get(s1.joints[0]);
                    const j2 = joints.get(s1.joints[1]);
                    const j3 = joints.get(s2.joints[0]);
                    const j4 = joints.get(s2.joints[1]);
                    if (j1 && j2 && j3 && j4) {
                        // Mirrors the solver residual (definitions.js perpendicular): no branch -> u.v (zero at +90 OR -90);
                        // branch +-1 -> u x v - branch|u||v| (zero ONLY at theta == branch*90 deg, the locked handedness).
                        // theta = signed angle u -> v; reported as an angular error in radians so VERIFIER_TOLERANCE keeps its meaning.
                        const ux = j2.x - j1.x, uy = j2.y - j1.y, vx = j4.x - j3.x, vy = j4.y - j3.y;
                        if (Math.hypot(ux, uy) < 1e-12 || Math.hypot(vx, vy) < 1e-12) return 0; // degenerate line: angle undefined
                        const theta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
                        if (c.branch === 1 || c.branch === -1) {
                            let d = theta - c.branch * Math.PI / 2;
                            while (d <= -Math.PI) d += 2 * Math.PI;
                            while (d > Math.PI) d -= 2 * Math.PI;
                            return Math.abs(d);
                        }
                        return Math.abs(Math.PI / 2 - Math.abs(theta));
                    }
                }
            }
            return 0;
        }

        case CONSTRAINT_TYPES.TANGENT: {
            const isCircle = s => s && (s.type === 'circle' || s.type === 'arc');
            const isLine = s => s && s.type === 'line';
            const getR = (s, center) => {
                if (typeof s.radius === 'number') return s.radius;
                if (s.joints && s.joints.length > 1) {
                    const rim = joints.get(s.joints[1]);
                    if (rim) return getDist(center, rim);
                }
                return 0;
            };

            // Line + Circle form (c.line / c.circle)
            if (c.line && c.circle) {
                const lineShape = shapes.find(s => s.id === c.line);
                const circleShape = shapes.find(s => s.id === c.circle);
                if (lineShape && circleShape && lineShape.joints && circleShape.joints) {
                    const a = joints.get(lineShape.joints[0]);
                    const b = joints.get(lineShape.joints[1]);
                    const center = joints.get(circleShape.joints[0]);
                    if (a && b && center) {
                        const r = getR(circleShape, center);
                        // perpendicularDistance is SIGNED (which side of the line the center is on);
                        // tangency means |signed dist| == r, so abs the DISTANCE first, then compare --
                        // `signed - r` (no inner abs) reads as satisfied/violated by the wrong amount
                        // whenever the center is on the negative-normal side (confirmed live: a genuinely
                        // near-tangent circle on that side measured ~2r off instead of ~0).
                        return Math.abs(Math.abs(perpendicularDistance(center, a, b)) - r);
                    }
                }
            }
            // Shapes form (c.shapes)
            if (c.shapes && c.shapes.length === 2) {
                const s1 = shapes.find(s => s.id === c.shapes[0]);
                const s2 = shapes.find(s => s.id === c.shapes[1]);
                if (!s1 || !s2) return 0;
                if ((isLine(s1) && isCircle(s2)) || (isLine(s2) && isCircle(s1))) {
                    const lineS = isLine(s1) ? s1 : s2;
                    const circS = isCircle(s1) ? s1 : s2;
                    const a = joints.get(lineS.joints[0]), b = joints.get(lineS.joints[1]);
                    const center = joints.get(circS.joints[0]);
                    if (a && b && center) {
                        const r = getR(circS, center);
                        // Same sign fix as the c.line/c.circle branch above.
                        return Math.abs(Math.abs(perpendicularDistance(center, a, b)) - r);
                    }
                }
                if (isCircle(s1) && isCircle(s2)) {
                    const c1 = joints.get(s1.joints[0]), c2 = joints.get(s2.joints[0]);
                    if (c1 && c2) {
                        const r1 = getR(s1, c1), r2 = getR(s2, c2);
                        const dist = getDist(c1, c2);
                        return Math.min(Math.abs(dist - (r1 + r2)), Math.abs(dist - Math.abs(r1 - r2)));
                    }
                }
            }
            return 0;
        }

        case CONSTRAINT_TYPES.EQUAL: {
            // Joint form [a,b,c,d]: | |ab| - |cd| | -- exactly the solver row (definitions.js equal). makeArc and every
            // fillet emit this form for the arc's centre-to-rim equality; it used to fall through to 0 (never verified).
            if (c.joints && c.joints.length >= 4) {
                const a = joints.get(c.joints[0]), b = joints.get(c.joints[1]);
                const p = joints.get(c.joints[2]), q = joints.get(c.joints[3]);
                if (!a || !b || !p || !q) return 0;
                return Math.abs(getDist(a, b) - getDist(p, q));
            }
            if (!c.shapes || c.shapes.length < 2) return 0;
            const s1 = shapes.find(s => s.id === c.shapes[0]);
            const s2 = shapes.find(s => s.id === c.shapes[1]);
            if (!s1 || !s2) return 0;
            const getLen = (s) => {
                if (s.type === 'line' && s.joints && s.joints.length >= 2) {
                    const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]);
                    if (a && b) return getDist(a, b);
                }
                if ((s.type === 'circle' || s.type === 'arc') && s.joints) {
                    if (typeof s.radius === 'number') return s.radius;
                    const center = joints.get(s.joints[0]);
                    if (s.joints.length >= 2) {
                        const rim = joints.get(s.joints[1]);
                        if (center && rim) return getDist(center, rim);
                    }
                }
                return 0;
            };
            return Math.abs(getLen(s1) - getLen(s2));
        }

        case CONSTRAINT_TYPES.ANGLE: {
            // EXACTLY the solver's residual (definitions.js angle): r = cross(u,v)*cos(t) - dot(u,v)*sin(t) = |u||v| sin(theta - t),
            // theta = signed angle from u to v. It is zero iff theta == t (mod 180 deg) -- the solver accepts the line-direction
            // ambiguity (t + 180) but NOT -t, which the old verifier also accepted. Reported as an angular error in radians
            // (min(|d|, pi - |d|) with d = theta - t wrapped to (-pi, pi]) so VERIFIER_TOLERANCE keeps meaning "radians".
            let a, b, p, q;
            if (c.joints && c.joints.length >= 4) {
                a = joints.get(c.joints[0]); b = joints.get(c.joints[1]); p = joints.get(c.joints[2]); q = joints.get(c.joints[3]);
            } else {
                if (!c.shapes || c.shapes.length < 2) return 0;
                const s1 = shapes.find(s => s.id === c.shapes[0]);
                const s2 = shapes.find(s => s.id === c.shapes[1]);
                if (!s1 || !s2 || s1.type !== 'line' || s2.type !== 'line') return 0;
                a = joints.get(s1.joints[0]); b = joints.get(s1.joints[1]);
                p = joints.get(s2.joints[0]); q = joints.get(s2.joints[1]);
            }
            if (!a || !b || !p || !q) return 0;
            const ux = b.x - a.x, uy = b.y - a.y, vx = q.x - p.x, vy = q.y - p.y;
            // A zero-length line has NO angle: the solver row (|u||v| sin(theta - t)) is 0 there, so a solve may collapse a line and look
            // satisfied. That is not an angle at all: report the largest angular error so such a solve never counts as converged.
            if (Math.hypot(ux, uy) < 1e-12 || Math.hypot(vx, vy) < 1e-12) return Math.PI / 2;
            const theta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
            // TASK 543: a supplementary-sector dimension (c.supplement) is the same row with sin(t) negated: zero iff theta == -t (mod 180)
            let d = theta - (c.supplement === true ? -1 : 1) * (Number(c.value) || 0) * Math.PI / 180;
            while (d <= -Math.PI) d += 2 * Math.PI;
            while (d > Math.PI) d -= 2 * Math.PI;
            return Math.min(Math.abs(d), Math.PI - Math.abs(d));
        }

        case CONSTRAINT_TYPES.MIDPOINT: {
            if (!c.joints || c.joints.length !== 3) return 0;
            const p1 = joints.get(c.joints[0]), p2 = joints.get(c.joints[1]), mid = joints.get(c.joints[2]);
            if (!p1 || !p2 || !mid) return 0;
            return Math.hypot(mid.x - (p1.x + p2.x) / 2, mid.y - (p1.y + p2.y) / 2);
        }

        default:
            return 0;
    }
}

// ---- Degenerate collapse (task 521): no constraint is satisfied by shrinking a shape to a point. ONE shared check, used by every
// "converged, accept" decision (createConstraint's sandbox + post-add solve, commitDimensionEdit). A solve result in which a line
// that had length (or an arc / circle that had a radius) now has under COLLAPSE_RATIO of it is not a solution for ANY constraint type.
export const COLLAPSE_RATIO = 0.01;
const MIN_TRACKED_SIZE = 1e-6;

// shape id -> its sizes now, for the shapes that have one: a line [length], a circle [radius], an arc [radius, chord, chord / radius]. The
// chord (the distance between the arc's two end joints, 2R sin(sweep / 2)) vanishes when the sweep goes to 0 or to a full 360: its two ends
// meet (task 550, EA-1: Fusion refuses the coincident of an arc's own ends, "failed to solve").
export function measureShapeSizes(state) {
    const sizes = new Map();
    for (const s of state.shapes || []) {
        if (s.type !== 'line' && s.type !== 'arc' && s.type !== 'circle') continue;
        const a = state.joints.get(s.joints && s.joints[0]);
        const b = state.joints.get(s.joints && s.joints[1]);
        const size = (s.type === 'circle' && typeof s.radius === 'number') ? s.radius : (a && b ? getDist(a, b) : null);
        if (size === null) continue;
        const e = s.type === 'arc' ? state.joints.get(s.joints[2]) : null;
        if (s.type === 'arc' && e) { const chord = getDist(b, e); sizes.set(s.id, [size, chord, size > 0 ? chord / size : 0]); }
        else sizes.set(s.id, [size]);
    }
    return sizes;
}

// The first shape that collapsed since `before` (a measureShapeSizes result), or null. A shape collapses when its size (line length, circle /
// arc radius) falls below COLLAPSE_RATIO of what it was, or -- an arc -- when its two ends meet: its chord AND its chord / radius (the sweep
// as an angle) both fall below COLLAPSE_RATIO (a radius going to 0 shrinks the chord with the same sweep, and a radius growing a lot shrinks
// the angle with the ends apart: neither is the ends meeting). A size the user SET on purpose is exempt: a driving distance dimension on
// exactly the two joints that measure it (a line's ends, an arc's centre and start = its radius, an arc's start and end = its chord) or a
// driving radius dimension on the shape itself (the radius), is the user's own value (0 or tiny included), so it is never judged collapsed.
// `skip`: shape ids judged elsewhere (a fillet radius edit's own tangent legs, which legitimately get very short as R nears its singular
// value: dimension-seams.js judges them by fillet.js filletHasCollapsedLine, an absolute zero length).
export function findCollapsedShape(state, before, skip = null) {
    const after = measureShapeSizes(state);
    const driving = (state.constraints || []).filter(c => c.type === CONSTRAINT_TYPES.DISTANCE && !c.isDriven && !c.driven);
    const onPair = (c, p, q) => !c.isRadius && c.joints && c.joints.length === 2 && ((c.joints[0] === p && c.joints[1] === q) || (c.joints[0] === q && c.joints[1] === p));
    const fell = (was, now, k) => was[k] >= MIN_TRACKED_SIZE && now[k] < was[k] * COLLAPSE_RATIO;
    for (const s of state.shapes || []) {
        const was = before.get(s.id), now = after.get(s.id);
        if (was === undefined || now === undefined || (skip && skip.has(s.id))) continue;
        if (fell(was, now, 0) && !driving.some(c => (c.isRadius && c.shape === s.id) || (s.joints && s.joints.length >= 2 && onPair(c, s.joints[0], s.joints[1])))) return s;
        if (was.length === 3 && now.length === 3 && fell(was, now, 1) && fell(was, now, 2) && !driving.some(c => onPair(c, s.joints[1], s.joints[2]))) return s;
    }
    return null;
}
