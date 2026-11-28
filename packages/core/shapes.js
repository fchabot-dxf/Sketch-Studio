﻿// 
// SHAPES - Shape creation functions
// 

import { CONSTRAINT_TYPES, POLYGON_SIDES, ORIGIN_JOINT_ID } from './constants.js';
import { getDist, angleBetween } from './geometry.js';
import { newShapeId } from './shape-id.js';

// TASK 1045: a rectangle's corners are ONE SHARED joint each, used by the two sides that meet there (and, in the centre rectangle, by the
// construction diagonal that ends there): Fusion, MEASURED by the advisor 2026-11-27, "every DRAWING tool joins meeting ends with ONE shared
// point (rectangles: all 3)"; the recording has no point-to-point coincident (docs/RECIPE-PARITY-1037.md D-1). The structural constraints of
// each maker are Fusion's recorded recipe (TASK 1049: the centre and 3-point ones; the 2-point's H, V, H, V already were). A corner is split like any shared point
// (#core/shared-point.js detachFromSharedPoint: its glyph's Delete, Delete Coincident). Files saved before keep their two joints + coincident.
// The sides are [c1, c2], [c2, c3], [c4, c3], [c1, c4] (c1 = the first click, c3 its opposite), the order and direction they always had.
function rectSides(base, groupId, [c1, c2, c3, c4], isConstruction) {
    return [
        { id: 's' + base + '_1', type: 'line', joints: [c1, c2], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_2', type: 'line', joints: [c2, c3], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_3', type: 'line', joints: [c4, c3], groupId, isConstruction: !!isConstruction },
        { id: 's' + base + '_4', type: 'line', joints: [c1, c4], groupId, isConstruction: !!isConstruction }
    ];
}
// a new corner joint at p
function newCorner(joints, genJ, p) {
    const id = genJ();
    joints.set(id, { x: p.x, y: p.y, fixed: false });
    return id;
}

/**
 * Create rectangle from two opposite corners (2-point mode)
 * Reuses input joints j1Id and j3Id as the corners c1 and c3 (shared by their two sides); c2 and c4 are new.
 */
export function makeRectFromTwoJoints(joints, j1Id, j3Id, genJ, isConstruction=false) {
    const j1 = joints.get(j1Id);
    const j3 = joints.get(j3Id);

    if (!j1 || !j3) return { shapes: [], constraints: [] };

    const c2 = newCorner(joints, genJ, { x: j3.x, y: j1.y });
    const c4 = newCorner(joints, genJ, { x: j1.x, y: j3.y });

    const base = newShapeId('');   // THE shape-id generator: unique even for two rectangles in the same millisecond
    const groupId = 'rect_' + base;
    const shapes = rectSides(base, groupId, [j1Id, c2, j3Id, c4], isConstruction);
    const constraints = [
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [j1Id, c2] },
        { type: CONSTRAINT_TYPES.VERTICAL, joints: [c2, j3Id] },
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [c4, j3Id] },
        { type: CONSTRAINT_TYPES.VERTICAL, joints: [j1Id, c4] }
    ];

    return { shapes, constraints };
}

/**
 * Create rectangle from center point and corner (center mode)
 * Reuses cornerId as the corner c3; the construction diagonals c1 -> c3 and c2 -> c4 end on the shared corners, the centre lies on both.
 */
export function makeRectFromCenter(joints, centerId, cornerId, genJ, isConstruction=false) {
    const center = joints.get(centerId);
    const corner = joints.get(cornerId);

    if (!center || !corner) return { shapes: [], constraints: [] };

    const dx = corner.x - center.x;
    const dy = corner.y - center.y;

    const c1 = newCorner(joints, genJ, { x: center.x - dx, y: center.y - dy });
    const c2 = newCorner(joints, genJ, { x: center.x + dx, y: center.y - dy });
    const c3 = cornerId;
    const c4 = newCorner(joints, genJ, { x: center.x - dx, y: center.y + dy });

    const base = newShapeId('');   // THE shape-id generator: unique even for two rectangles in the same millisecond
    const groupId = 'rect_' + base;
    const shapes = rectSides(base, groupId, [c1, c2, c3, c4], isConstruction);

    // Add diagonals for center constraint (construction geometry)
    const diag1Id = 's' + base + '_d1';
    const diag2Id = 's' + base + '_d2';
    shapes.push({ id: diag1Id, type: 'line', joints: [c1, c3], groupId, isConstruction: true });
    shapes.push({ id: diag2Id, type: 'line', joints: [c2, c4], groupId, isConstruction: true });

    // Mark the center joint as orphanAllowed so it doesn't vanish if the user deletes the constraints
    if (joints.has(centerId)) {
        const c = joints.get(centerId);
        c.orphanAllowed = true;
    }

    // TASK 1049 (audit 1037 D-2): Fusion's recipe, as recorded: Horizontal(Line0) Perpendicular(Line1,Line0) Parallel(Line2,Line0) Parallel(Line3,Line1),
    // so deleting the one Horizontal lets the rectangle rotate and it stays a rectangle (H, V, H, V tilted one side: a trapezoid). Same DOF as built (4).
    const [s1, s2, s3, s4] = shapes.map((s) => s.id);
    const constraints = [
        { type: CONSTRAINT_TYPES.HORIZONTAL, joints: [c1, c2] },
        { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [s2, s1] },
        { type: CONSTRAINT_TYPES.PARALLEL, shapes: [s3, s1] },
        { type: CONSTRAINT_TYPES.PARALLEL, shapes: [s4, s2] },

        // Constrain center to intersection of diagonals
        { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: centerId, shape: diag1Id },
        { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: centerId, shape: diag2Id }
    ];

    return { shapes, constraints };
}

/**
 * Create rectangle from 3 points
 * Reuses j1Id, j2Id, and j3Id as the corners c1, c2 and c3 (j3Id is moved onto the corner: the third click only gives the height); c4 is new.
 * No H / V: it may be drawn at any angle (perpendicular + parallel keep it a rectangle).
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

    joints.set(j3Id, { x: j2.x + px * h, y: j2.y + py * h, fixed: false });
    const c4 = newCorner(joints, genJ, { x: j1.x + px * h, y: j1.y + py * h });

    const base = newShapeId('');   // THE shape-id generator: unique even for two rectangles in the same millisecond
    const groupId = 'rect_' + base;
    const shapes = rectSides(base, groupId, [j1Id, j2Id, j3Id, c4], isConstruction);

    // TASK 1049 (audit 1037 D-3): Fusion's recipe, as recorded: Perpendicular(Line1,Line0) Parallel(Line2,Line0) Parallel(Line3,Line1). Four perpendiculars
    // held one redundant row; deleting the one Perpendicular now leaves a parallelogram, as in Fusion. Same DOF (5).
    const [s1, s2, s3, s4] = shapes.map((s) => s.id);
    const constraints = [
        { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [s2, s1] },
        { type: CONSTRAINT_TYPES.PARALLEL, shapes: [s3, s1] },
        { type: CONSTRAINT_TYPES.PARALLEL, shapes: [s4, s2] }
    ];

    return { shapes, constraints };
}

/** N kept inside POLYGON_SIDES (3..64); anything non-numeric -> the declared default. */
export function clampPolygonSides(n) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return POLYGON_SIDES.default;
    return Math.min(POLYGON_SIDES.max, Math.max(POLYGON_SIDES.min, v));
}

/**
 * Create a REGULAR polygon from a centre joint and a first corner joint (TASK 483). Plain geometry, no parametric shape kind. TASK 1050: Fusion's
 * recipe, as recorded (docs/RECIPE-PARITY-1037.md D-5):
 *   - N `line` shapes between N corner joints that are SHARED by neighbouring sides (the first corner is `vertexId`);
 *   - the centre a LONE point (no construction radii);
 *   - ONE POLYGON constraint (#core/polygon.js): the corners lie on one circle about the centre and are evenly spaced. 2(N-1) independent rows
 *     over the centre (2) + N corners (2N): exactly 4 degrees of freedom are left, position (2), size (1) and rotation (1), Fusion's 4.
 * The corners go round in order of increasing world angle, side i from corner i to corner i+1 (the record's order). The centre is kept as a lone
 * point when the constraint goes (orphanAllowed, like the centre rectangle's and the slot's centre). The edge shapes carry a shared `groupId`
 * like a rect's (the renderer's closed-shape key). A file saved before task 1050 keeps its construction radii and its 2(N-1) EQUAL constraints.
 */
export function makePolygon(joints, centerId, vertexId, numSides, genJ, isConstruction = false) {
    const center = joints.get(centerId);
    const vertex = joints.get(vertexId);
    if (!center || !vertex) return { shapes: [], constraints: [] };

    const n = clampPolygonSides(numSides);
    const radius = getDist(center, vertex);
    const startAngle = angleBetween(center, vertex);
    const seq = newShapeId('');   // THE shape-id generator: unique even for two polygons in the same millisecond
    const groupId = 'poly_' + seq;

    const corners = [vertexId];
    for (let i = 1; i < n; i++) {
        const angle = startAngle + (i * 2 * Math.PI / n);
        const id = genJ();
        joints.set(id, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle), fixed: false });
        corners.push(id);
    }
    if (!center.orphanAllowed && centerId !== ORIGIN_JOINT_ID) center.orphanAllowed = true;

    const shapes = [];
    for (let i = 0; i < n; i++) {
        shapes.push({ id: `s_poly_${seq}_${i}`, type: 'line', joints: [corners[i], corners[(i + 1) % n]], groupId, isConstruction: !!isConstruction });
    }
    const constraints = [{ type: CONSTRAINT_TYPES.POLYGON, joints: [centerId, ...corners], shapes: shapes.map((sh) => sh.id) }];
    return { shapes, constraints };
}

/**
 * Arcs store 3 joints but interpret them based on subType.
 */
export function makeArc(joints, p1, p2, p3, subType='CENTER', isConstruction=false) {
    const seq = newShapeId('');   // THE shape-id generator: unique even for two arcs in the same millisecond
    const groupId = `arc_${seq}`;
    const shape = {
        id: `s_arc_${seq}`,
        type: 'arc',
        subType,
        joints: [p1, p2, p3],
        groupId
    };
    if (isConstruction) shape.isConstruction = true;
    return { shapes: [shape], constraints: arcStructuralConstraints(shape) };
}

/**
 * THE structural constraints of an arc (joints [centre, start, end]), whatever made it: the Arc tool and every other maker through makeArc, an
 * imported arc (DXF / SVG, Shaper's Fusion / STL) through the import's landing (landImportedGeometry below, TASK 789 / 1036). Keeps the two rim points (start, end) equidistant
 * from the centre ALWAYS -- not just at creation. Without this, dragging the end alone (or editing a radius dimension, which only wires in the
 * start, engine.js _radiusOperand) silently stops the arc being circular. Reuses the EXISTING `equal` definition (len(a,b) == len(c,d)) via its
 * joints-based input mode -- no new solver math, mirrors how makeRectFromTwoJoints already bakes in H/V so a rectangle stays a rectangle.
 */
export function arcStructuralConstraints(arc) {
    const [c, s, e] = arc.joints;
    return [{ type: 'equal', joints: [c, s, c, e] }];
}

/**
 * TASK 1036 (BUG-373): THE landing of an import's parsed geometry in the active sketch, for every importer (the shared SVG / DXF import,
 * #ui/sketch-import.js; Shaper's Fusion / STL import, apps/shaper/src/fusion-import.js): the joints ({ id, x, y }) and the shapes are added (the
 * state's joints.set / shapes.push stamp the active sketch), and each arc gets arcStructuralConstraints (TASK 789 / BUG-046), so it keeps its two
 * ends on one circle like a drawn one (a radius edit after an ungroup moves both).
 */
export function landImportedGeometry(st, joints, shapes) {
    for (const j of joints) st.joints.set(j.id, { x: j.x, y: j.y });
    for (const s of shapes) st.shapes.push(s);
    for (const s of shapes) if (s.type === 'arc') st.constraints.push(...arcStructuralConstraints(s));
}

/**
 * UNIFY-3: a CUBIC BEZIER shape. Endpoints are JOINTS (p0, p3 — solver-participating, so a bezier connects to other
 * geometry and can be constrained later); the 2 control points are shape DATA (c1, c2 as [x,y]), NOT solver entities
 * yet (MVP). No constraints created. Matches #core conventions (cf. makeArc: joints + extra data on the shape).
 * MVP LIMITATION (flag): control points are ABSOLUTE data — they do NOT follow if the endpoint joints move (fine for
 * the non-constrainable freehand beziers this enables; revisit when control-point constraints land).
 */
export function makeBezier(joints, p0, p3, c1, c2, isConstruction=false) {
    const seq = newShapeId('');   // THE shape-id generator
    const shape = {
        id: `s_bezier_${seq}`,
        type: 'bezier',
        joints: [p0, p3],
        c1: [c1[0], c1[1]],
        c2: [c2[0], c2[1]],
        groupId: `bezier_${seq}`
    };
    if (isConstruction) shape.isConstruction = true;
    return { shapes: [shape], constraints: [] };
}
