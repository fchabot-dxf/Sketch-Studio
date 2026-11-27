// Circle tool: centre + diameter, described as data for the tool session (#ui/tool-session.js; task 1034, the input unification trial).
// It never sees a pointer or a key: the translators turn a click, a drag, a tap, Enter in the box into the session's steps, and the
// session runs THE one build below once per circle.
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { addConstraint, radialDimensionParams } from '#core/constraints.js';
import { applySnapConstraint, onShapeSnap, SNAP_JOIN } from '#core/snap-constraints.js';
import { applyLockedSnap, applyLiveAssign } from '#ui/input-handlers/base-tool.js';
import { newShapeId } from '#core/shape-id.js';
import { defineTool, PICK } from '#ui/tool-session.js';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
/** the point `r` from `c` toward `p` (toward +x when `p` is on `c`: a typed diameter needs no direction) */
const along = (c, p, r) => { const d = dist(c, p); return d > 0 ? { x: c.x + (p.x - c.x) * r / d, y: c.y + (p.y - c.y) * r / d } : { x: c.x + r, y: c.y }; };
// the radius the rim step holds: the typed diameter's half, else the distance to the pointer
const typedRadius = (v) => (v.diameter.typed ? v.diameter.value / 2 : null);

/**
 * THE build of a circle (the one commit for a click, a drag's release, a tap and Enter). The centre becomes a joint, with its kept snap
 * (applySnapConstraint). TASK 597 / 1008: a typed DIAMETER adds the circle's diameter dimension (radialDimensionParams: value = the typed
 * diameter), with its formula / name (task 876 / 1013) and its `param = expr` assignment. A rim kept on an existing POINT (a joint, a circle
 * centre, the origin) puts that point ON the new circle (applyLockedSnap with the point as the subject); a rim on a line, curve or axis only
 * sizes it (as in Fusion). The session drops the rim snap when a diameter is typed (a typed size is the user's own and takes none).
 */
function buildCircle(state, { centre, rim }) {
    const v = rim.values.diameter;
    const r = typedRadius(rim.values) ?? dist(centre.at, rim.at);   // a typed diameter's exact half (the rim point lies on it only to rounding)
    state.saveState();
    const centreId = state.genJ();
    state.joints.set(centreId, { x: centre.at.x, y: centre.at.y, fixed: false });
    const shapeId = newShapeId('s');
    state.shapes.push({ id: shapeId, type: 'circle', joints: [centreId], radius: r, isConstruction: !!state.isConstructionMode });
    if (v.typed) {
        if (v.assign) applyLiveAssign(state, v.assign);
        addConstraint(state, CONSTRAINT_TYPES.DISTANCE, { ...radialDimensionParams({ id: shapeId, type: 'circle' }, r), expression: v.expression, ...(v.name ? { name: v.name } : {}) });
    }
    if (centre.snap) applySnapConstraint(state, centreId, centre.snap, { join: SNAP_JOIN.DRAW });   // TASK 1045: a centre on a curve end point shares it
    const s = rim.snap;
    if (s && (s.type === 'joint' || s.type === 'point')) applyLockedSnap(state, s.id || s.targetId, onShapeSnap(shapeId, rim.at));
}

export const CIRCLE = defineTool({
    tool: TOOL_MODES.CIRCLE,
    variants: {
        centre: {
            steps: [
                { id: 'centre', pick: PICK.point, fires: 'press' },
                {
                    id: 'rim', pick: PICK.point, fires: 'release',
                    // TASK 596 / 597: the DIAMETER box, opened by the centre's click; it shows the live diameter until one is typed
                    boxes: [{ id: 'diameter', quantity: 'length', positions: true, live: ({ centre }, p) => 2 * dist(centre.at, p) }],
                    resolve: ({ centre }, p, v) => (v.diameter.typed ? along(centre.at, p, typedRadius(v)) : p),
                    tooSmall: ({ centre }, p) => [dist(centre.at, p)],   // TASK 782: a click on the centre places nothing (the tool keeps waiting)
                    preview: ({ centre }, p, v) => ({ type: 'circle', fixed: [centre.at], at: p, props: { radius: typedRadius(v) ?? dist(centre.at, p) } }),
                },
            ],
        },
    },
    build: buildCircle,
    after: 'stay',
});
