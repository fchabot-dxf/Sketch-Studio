﻿// 
// SHAPES - Shape creation functions
// 

import { CONSTRAINT_TYPES } from './constants.js';
import { getDist, angleBetween } from './geometry.js';

/**
 * Create rectangle from two opposite corners (2-point mode)
 * Reuses input joints j1Id and j3Id as the "A" (horizontal) joints for their respective corners.
 */
export function makeRectFromTwoJoints(joints, j1Id, j3Id, genJ, isConstruction=false) {
    const j1 = joints.get(j1Id);
    const j3 = joints.get(j3Id);

    if (!j1 || !j3) return { shapes: [], constraints: [] };

    const c1 = { x: j1.x, y: j1.y };
    const c2 = { x: j3.x, y: j1.y };
    const c3 = { x: j3.x, y: j3.y };
    const c4 = { x: j1.x, y: j3.y };

    const j1A = j1Id;
    const j1B = genJ();
    joints.set(j1B, { x: c1.x, y: c1.y, fixed: false });

    const j2A = genJ(), j2B = genJ();
    joints.set(j2A, { x: c2.x, y: c2.y, fixed: false });
    joints.set(j2B, { x: c2.x, y: c2.y, fixed: false });

    const j3A = j3Id;
    const j3B = genJ();
    joints.set(j3B, { x: c3.x, y: c3.y, fixed: false });

    const j4A = genJ(), j4B = genJ();
    joints.set(j4A, { x: c4.x, y: c4.y, fixed: false });
    joints.set(j4B, { x: c4.x, y: c4.y, fixed: false });

    const groupId = 'rect_' + Date.now();
    const base = Date.now();

    const shapes = [
        { id: 's' + base + '_1', type: 'line', joints: [j1A, j2A], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_2', type: 'line', joints: [j2B, j3B], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_3', type: 'line', joints: [j4A, j3A], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_4', type: 'line', joints: [j1B, j4B], groupId, isConstruction: !!isConstruction }
    ];
    const constraints = [
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [j1A, j2A] },
        { type: CONSTRAINT_TYPES.VERTICAL, joints: [j2B, j3B] },
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [j4A, j3A] },
        { type: CONSTRAINT_TYPES.VERTICAL, joints: [j1B, j4B] },

        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j1A, j1B] },
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j2A, j2B] },
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j3A, j3B] },
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j4A, j4B] }
    ];

    return { shapes, constraints };
}

/**
 * Create rectangle from center point and corner (center mode)
 * Reuses cornerId as j3A.
 */
export function makeRectFromCenter(joints, centerId, cornerId, genJ, isConstruction=false) {
    const center = joints.get(centerId);
    const corner = joints.get(cornerId);

    if (!center || !corner) return { shapes: [], constraints: [] };

    const dx = corner.x - center.x;
    const dy = corner.y - center.y;

    const c1 = { x: center.x - dx, y: center.y - dy };
    const c2 = { x: center.x + dx, y: center.y - dy };
    const c3 = { x: center.x + dx, y: center.y + dy };
    const c4 = { x: center.x - dx, y: center.y + dy };

    const j1A = genJ(), j1B = genJ(), j1C = genJ();
    joints.set(j1A, { x: c1.x, y: c1.y, fixed: false });
    joints.set(j1B, { x: c1.x, y: c1.y, fixed: false });
    joints.set(j1C, { x: c1.x, y: c1.y, fixed: false });

    const j2A = genJ(), j2B = genJ(), j2C = genJ();
    joints.set(j2A, { x: c2.x, y: c2.y, fixed: false });
    joints.set(j2B, { x: c2.x, y: c2.y, fixed: false });
    joints.set(j2C, { x: c2.x, y: c2.y, fixed: false });

    const j3A = cornerId;
    const j3B = genJ(), j3C = genJ();
    joints.set(j3B, { x: c3.x, y: c3.y, fixed: false });
    joints.set(j3C, { x: c3.x, y: c3.y, fixed: false });

    const j4A = genJ(), j4B = genJ(), j4C = genJ();
    joints.set(j4A, { x: c4.x, y: c4.y, fixed: false });
    joints.set(j4B, { x: c4.x, y: c4.y, fixed: false });
    joints.set(j4C, { x: c4.x, y: c4.y, fixed: false });

    const groupId = 'rect_' + Date.now();
    const base = Date.now();

    const shapes = [
        { id: 's' + base + '_1', type: 'line', joints: [j1A, j2A], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_2', type: 'line', joints: [j2B, j3B], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_3', type: 'line', joints: [j4A, j3A], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_4', type: 'line', joints: [j1B, j4B], groupId, isConstruction: !!isConstruction }
    ];

    // Add diagonals for center constraint (construction geometry)
    const diag1Id = 's' + base + '_d1';
    const diag2Id = 's' + base + '_d2';
    shapes.push({ id: diag1Id, type: 'line', joints: [j1C, j3C], groupId, isConstruction: true });
    shapes.push({ id: diag2Id, type: 'line', joints: [j2C, j4C], groupId, isConstruction: true });

    // Mark the center joint as orphanAllowed so it doesn't vanish if the user deletes the constraints
    if (joints.has(centerId)) {
        const c = joints.get(centerId);
        c.orphanAllowed = true;
    }

    const constraints = [
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [j1A, j2A] },
        { type: CONSTRAINT_TYPES.VERTICAL, joints: [j2B, j3B] },
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [j4A, j3A] },
        { type: CONSTRAINT_TYPES.VERTICAL, joints: [j1B, j4B] },

        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j1A, j1B] }, // Top-Left Side-Side
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j1A, j1C] }, // Top-Left Side-Diag
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j2A, j2B] }, // Top-Right Side-Side
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j2A, j2C] }, // Top-Right Side-Diag
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j3A, j3B] }, // Bottom-Right Side-Side
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j3A, j3C] }, // Bottom-Right Side-Diag
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j4A, j4B] }, // Bottom-Left Side-Side
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j4A, j4C] }, // Bottom-Left Side-Diag

        // Constrain center to intersection of diagonals
        { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: centerId, shape: diag1Id },
        { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: centerId, shape: diag2Id }
    ];

    return { shapes, constraints };
}

/**
 * Create rectangle from 3 points
 * Reuses j1Id, j2Id, and j3Id as the "A" joints for their respective corners.
 * Uses perpendicular constraints to allow rotation.
 */
export function makeRectFrom3Points(joints, j1Id, j2Id, j3Id, genJ, isConstruction=false) {
    const j1 = joints.get(j1Id);
    const j2 = joints.get(j2Id);
    const j3 = joints.get(j3Id);

    if (!j1 || !j2 || !j3) return [];

    const dx = j2.x - j1.x;
    const dy = j2.y - j1.y;
    const len = Math.hypot(dx, dy);

    if (len < 0.001) return [];

    const px = -dy / len;
    const py = dx / len;

    const h = (j3.x - j1.x) * px + (j3.y - j1.y) * py;

    const c1 = { x: j1.x, y: j1.y };
    const c2 = { x: j2.x, y: j2.y };
    const c3 = { x: j2.x + px * h, y: j2.y + py * h };
    const c4 = { x: j1.x + px * h, y: j1.y + py * h };

    const j1A = j1Id;
    const j1B = genJ();
    joints.set(j1B, { x: c1.x, y: c1.y, fixed: false });

    const j2A = j2Id;
    const j2B = genJ();
    joints.set(j2B, { x: c2.x, y: c2.y, fixed: false });

    const j3A = j3Id;
    const j3B = genJ();
    joints.set(j3A, { x: c3.x, y: c3.y, fixed: false });
    joints.set(j3B, { x: c3.x, y: c3.y, fixed: false });

    const j4A = genJ(), j4B = genJ();
    joints.set(j4A, { x: c4.x, y: c4.y, fixed: false });
    joints.set(j4B, { x: c4.x, y: c4.y, fixed: false });

    const groupId = 'rect_' + Date.now();
    const base = Date.now();

    const shapes = [
        { id: 's' + base + '_1', type: 'line', joints: [j1A, j2A], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_2', type: 'line', joints: [j2B, j3B], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_3', type: 'line', joints: [j4A, j3A], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_4', type: 'line', joints: [j1B, j4B], groupId, isConstruction: !!isConstruction }
    ];

    const s1 = shapes[0].id, s2 = shapes[1].id, s3 = shapes[2].id, s4 = shapes[3].id;
    const constraints = [
        { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [s1, s2] },
        { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [s2, s3] },
        { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [s3, s4] },
        { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [s4, s1] },

        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j1A, j1B] },
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j2A, j2B] },
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j3A, j3B] },
        { type: CONSTRAINT_TYPES.COINCIDENT, joints: [j4A, j4B] }
    ];

    return { shapes, constraints };
}

/**
 * Create a regular polygon from center to vertex.
 */
export function makePolygon(joints, centerId, vertexId, numSides, genJ, isConstruction=false) {
    const center = joints.get(centerId);
    const vertex = joints.get(vertexId);
    if (!center || !vertex) return { shapes: [], constraints: [] };

    const radius = getDist(center, vertex);
    const startAngle = angleBetween(center, vertex);
    const groupId = `poly_${Date.now()}`;
    const base = Date.now();

    const corners = [];
    for (let i = 0; i < numSides; i++) {
        const angle = startAngle + (i * 2 * Math.PI / numSides);
        const x = center.x + radius * Math.cos(angle);
        const y = center.y + radius * Math.sin(angle);

        const jA = (i === 0) ? vertexId : genJ();
        const jB = genJ();

        if (i !== 0) joints.set(jA, { x, y, fixed: false });
        joints.set(jB, { x, y, fixed: false });
        corners.push({ a: jA, b: jB });
    }

    const shapes = [];
    const constraints = [];

    for (let i = 0; i < numSides; i++) {
        const next = (i + 1) % numSides;
        const edge = { id: `s_poly_${base}_${i}`, type: 'line', joints: [corners[i].a, corners[next].a], groupId };
        if (isConstruction) edge.isConstruction = true;
        shapes.push(edge);
        constraints.push({ type: CONSTRAINT_TYPES.COINCIDENT, joints: [corners[i].a, corners[i].b] });
        shapes.push({ id: `s_poly_radial_${base}_${i}`, type: 'line', joints: [centerId, corners[i].a], groupId, isConstruction: true });
    }

    return { shapes, constraints };
}

/**
 * Arcs store 3 joints but interpret them based on subType.
 */
export function makeArc(joints, p1, p2, p3, subType='CENTER', isConstruction=false) {
    const groupId = `arc_${Date.now()}`;
    const shape = {
        id: `s_arc_${Date.now()}`,
        type: 'arc',
        subType,
        joints: [p1, p2, p3],
        groupId
    };
    if (isConstruction) shape.isConstruction = true;
    return { shapes: [shape], constraints: [] };
}

/**
 * UNIFY-3: a CUBIC BEZIER shape. Endpoints are JOINTS (p0, p3 — solver-participating, so a bezier connects to other
 * geometry and can be constrained later); the 2 control points are shape DATA (c1, c2 as [x,y]), NOT solver entities
 * yet (MVP). No constraints created. Matches #core conventions (cf. makeArc: joints + extra data on the shape).
 * MVP LIMITATION (flag): control points are ABSOLUTE data — they do NOT follow if the endpoint joints move (fine for
 * the non-constrainable freehand beziers this enables; revisit when control-point constraints land).
 */
export function makeBezier(joints, p0, p3, c1, c2, isConstruction=false) {
    const shape = {
        id: `s_bezier_${Date.now()}`,
        type: 'bezier',
        joints: [p0, p3],
        c1: [c1[0], c1[1]],
        c2: [c2[0], c2[1]],
        groupId: `bezier_${Date.now()}`
    };
    if (isConstruction) shape.isConstruction = true;
    return { shapes: [shape], constraints: [] };
}
