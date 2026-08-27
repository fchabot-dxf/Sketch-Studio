import { getDist, projectPointOnLine, perpendicularDistance, resolveJoints } from './geometry.js';
import { CONSTRAINT_TYPES } from './constants.js';

export function measureResidual(c, joints, shapes) {
    if (!c) return 0;

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
                        const a1 = Math.atan2(j2.y - j1.y, j2.x - j1.x);
                        const a2 = Math.atan2(j4.y - j3.y, j4.x - j3.x);
                        let diff = Math.abs(a1 - a2);
                        while (diff > Math.PI) diff -= Math.PI;
                        return Math.abs(diff - Math.PI / 2);
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
            if (!c.shapes || c.shapes.length < 2) return 0;
            const s1 = shapes.find(s => s.id === c.shapes[0]);
            const s2 = shapes.find(s => s.id === c.shapes[1]);
            if (!s1 || !s2 || s1.type !== 'line' || s2.type !== 'line') return 0;
            const a = joints.get(s1.joints[0]), b = joints.get(s1.joints[1]);
            const p = joints.get(s2.joints[0]), q = joints.get(s2.joints[1]);
            if (!a || !b || !p || !q) return 0;
            const ang1 = Math.atan2(b.y - a.y, b.x - a.x);
            const ang2 = Math.atan2(q.y - p.y, q.x - p.x);
            let diff = ang1 - ang2;
            while (diff <= -Math.PI) diff += 2 * Math.PI;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            const target = (c.value || 0) * Math.PI / 180;
            // Minimum over canonical equivalences (line direction ambiguity)
            let minErr = Infinity;
            for (const cand of [target, -target, target + Math.PI, -target + Math.PI, target - Math.PI, -target - Math.PI]) {
                minErr = Math.min(minErr, Math.abs(diff - cand));
            }
            return minErr;
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