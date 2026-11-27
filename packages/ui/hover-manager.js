// ═══════════════════════════════════════════════════════════════════════════════
// HOVER MANAGER - Single source of truth for hover state
// ═══════════════════════════════════════════════════════════════════════════════
import { findSnap } from '#ui/snap-detection.js';
import { constraintToolPicks } from '#ui/input-handlers/constraint-tools.js'; // TASK 1020: the hover lights what the click takes
import { screenToWorld, getZoomFactor } from '#ui/coords.js';
import { glyphPickHit } from '#ui/fusion-glyphs.js';
import SettingsManager from '#core/settings-manager.js';
import { ACTIVE_SKETCH_HOVER_TOOLS, TOOL_MODES } from '#core/constants.js';
import { pickOwner, hoveredUnit } from '#core/group-model.js'; // TASK 756: the Select tool's hover lights the user group a click selects
import { pickableShapes } from '#core/reference-lines.js';
import { pickScene, pickableConstraints, activeSketchScene } from '#core/sketch-model.js'; // TASK 577: a locked / hidden sketch is not hovered; TASK 675: active-sketch tools hover only active sketch

// CRITICAL: This is the ONLY file that modifies hoveredJoint/hoveredShape/hoveredConstraint
// All other files must call functions from this module instead of touching state directly

// THE glyph pick (task 571b right click; task 588 left click and hover; task 603 the drawn icon): a constraint glyph is under the pointer only when
// the pointer is ON its drawn icon, or within a small margin of its outlines (fusion-glyphs glyphPickHit; a larger margin on touch). A pointer
// merely NEAR a glyph (on the line beside it) is on the line. Right click (input-manager pickContextTarget), left click, hover and the drawing /
// dimension tools' pre-pick (input-manager) all call glyphAt.
export function glyphAt(svg, state, screenX, screenY, touch = false) {
    const settings = SettingsManager.getAll();
    const symbolPx = Number(settings.GLYPH_SYMBOL_SIZE_PX || 20), outlinePx = Number(settings.GLYPH_OUTLINE_PX ?? 1);
    const mouseW = screenToWorld(svg, screenX, screenY);
    const zoomFactor = getZoomFactor(svg);
    for (const c of pickableConstraints(state) || []) {
        if (c.__visible === false || !c.glyphPos) continue;
        for (const pos of Array.isArray(c.glyphPos) ? c.glyphPos : [c.glyphPos]) {
            if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') continue;
            if (glyphPickHit(c.type, (mouseW.x - pos.x) / zoomFactor, (mouseW.y - pos.y) / zoomFactor, symbolPx, outlinePx, touch)) return c;
        }
    }
    return null;
}

// A dimension's canvas label (the `.dim-label` element svg-renderer draws, data-constraint-idx) is its own hit: the pointer inside the label's
// drawn box picks the dimension. Dimensions have no sheet glyph, so glyphAt never picks them (task 603 removed the 20 px glyphPos circle that
// used to catch a label by accident).
// Every label has at least this hit size (screen px, either way): a narrow value like "5" is 6 px wide and would otherwise be
// almost impossible to hit, most of all with a finger. The ONE minimum for every dimension label.
export const DIM_LABEL_MIN_HIT_PX = 24;
const spanAround = (lo, hi) => { const grow = Math.max(0, (DIM_LABEL_MIN_HIT_PX - (hi - lo)) / 2); return [lo - grow, hi + grow]; };

export function dimLabelAt(svg, state, screenX, screenY) {
    const labels = svg.querySelectorAll ? svg.querySelectorAll('.dim-label') : [];
    const pickable = pickableConstraints(state) || [];
    for (const el of labels) {
        const b = el.getBoundingClientRect();
        const [left, right] = spanAround(b.left, b.right), [top, bottom] = spanAround(b.top, b.bottom);
        if (screenX < left || screenX > right || screenY < top || screenY > bottom) continue;
        const c = state.constraints[parseInt(el.dataset.constraintIdx, 10)];
        if (c && pickable.includes(c)) return c;
    }
    return null;
}

// The constraint under the pointer: a glyph (glyphAt), else a dimension label (dimLabelAt).
export function constraintAt(svg, state, screenX, screenY, touch = false) {
    return glyphAt(svg, state, screenX, screenY, touch) || dimLabelAt(svg, state, screenX, screenY);
}

// THE select tool's pick (task 588: HOVER = CLICK, so what lights up on hover is exactly what a click selects): a joint in snap reach
// (hitJoint), else a glyph the pointer is ON (glyphAt), else a shape (hitShape). Returns { joint } | { constraint } | { shape } | null.
// selection-tools handleSelectionPointerDown (the click) and applyHoverPriority (the hover) both call it.
export function selectPick(svg, state, hitJoint, hitShape, screenX, screenY, touch = false) {
    if (hitJoint) return { joint: hitJoint };
    const constraint = constraintAt(svg, state, screenX, screenY, touch);
    if (constraint) return { constraint };
    if (hitShape) return { shape: hitShape };
    return null;
}

/**
 * Set state.hovered* from the select tool's pick (selectPick: hover = click).
 * TASK 756: with the Select tool, a pick on a member of a user group (a curve, or one of its points) is a pick on the group a click there
 * selects (#core/group-model.js pickOwner + selectUnit, the click's rule: the whole group when it is not entered, that level's group inside an entered
 * one): state.hoverOwner names the shape the pointer is on and the renderer lights all of hoveredUnit(state) (the unit is read when drawn,
 * so entering / leaving a group re-aims it at once); the point itself is not lit (the click does not select it). Other tools pick single
 * curves and points: no hoverOwner.
 */
export function applyHoverPriority(state, svg, hitJoint, hitShape, px, py) {
    const pick = selectPick(svg, state, hitJoint, hitShape, px, py);
    state.hoveredJoint = pick && pick.joint ? pick.joint.id : null;
    state.hoveredConstraint = pick && pick.constraint ? pick.constraint : null;
    state.hoveredShape = pick && pick.shape ? pick.shape.shape.id : null;
    state.hoverOwner = (state.currentTool === TOOL_MODES.SELECT && pick && (pick.joint || pick.shape))
        ? pickOwner(state, state.hoveredShape, state.hoveredJoint) : null;
    if (hoveredUnit(state)) state.hoveredJoint = null;
}

export function setHoverFromSnap(state) {
    state.hoverOwner = null; // TASK 756: a snap is a single target (the drawing tools)
    if (!state.snapTarget) {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
        return;
    }
    
    if (state.snapTarget.type === 'joint') {
        state.hoveredJoint = state.snapTarget.targetId;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    } else if (state.snapTarget.type === 'line' || state.snapTarget.type === 'shape') {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = state.snapTarget.shape?.id || null;
    } else {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    }
}

export function updateHover(svg, screenX, screenY, state) {
    // Find potential targets via snap system (task 675: active-sketch tools narrow to activeSketchScene so non-active curves neither highlight nor shadow)
    const picked = pickScene(state, pickableShapes(state));
    const scene = ACTIVE_SKETCH_HOVER_TOOLS.includes(state.currentTool) ? activeSketchScene(state, picked) : picked;
    const hoverSnapResult = findSnap(scene.joints, scene.shapes, svg, {x: screenX, y: screenY}, [], false, false, 1.0, constraintToolPicks(state));
    
    // Extract hits
    let hitJoint = null;
    let hitShape = null;
    
    if (hoverSnapResult) {
        if (hoverSnapResult.type === 'joint') {
            const jid = hoverSnapResult.targetId;
            hitJoint = { id: jid, j: state.joints.get(jid) };
        } else if ((hoverSnapResult.type === 'line' || hoverSnapResult.type === 'shape' || hoverSnapResult.type === 'midpoint') && hoverSnapResult.shape) { // as the click (input-manager handlePointerDown)
            hitShape = { shape: hoverSnapResult.shape, pt: hoverSnapResult.pt || { x: hoverSnapResult.x, y: hoverSnapResult.y } };
        }
    }
    
    applyHoverPriority(state, svg, hitJoint, hitShape, screenX, screenY);
}

/**
 * Clear all hover state
 * Called by tools that take exclusive control (like drawing tools)
 */
export function clearHover(state) {
    state.hoverOwner = null; // TASK 756
    state.hoveredJoint = null;
    state.hoveredConstraint = null;
    state.hoveredShape = null;
}