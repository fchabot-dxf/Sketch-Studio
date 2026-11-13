// ═══════════════════════════════════════════════════════════════════════════════
// HOVER MANAGER - Single source of truth for hover state
// ═══════════════════════════════════════════════════════════════════════════════
import { findSnap, hitConstraintAtScreen } from '#ui/snap-detection.js';
import SettingsManager from '#core/settings-manager.js';
import { pickableShapes } from '#core/reference-lines.js';
import { pickScene, pickableConstraints } from '#core/sketch-model.js'; // TASK 577: a locked / hidden sketch is not hovered

// CRITICAL: This is the ONLY file that modifies hoveredJoint/hoveredShape/hoveredConstraint
// All other files must call functions from this module instead of touching state directly

// THE glyph pick (task 571b right click; task 588 left click and hover): a constraint glyph is under the pointer only when the pointer is ON
// the glyph AS DRAWN (glyphDrawnRadiusPx, the same on touch: the glyph is not bigger there) plus GLYPH_PICK_MARGIN_PX. A pointer merely NEAR a
// glyph (on the line beside it) is on the line. Right click (input-manager pickContextTarget), left click and hover all call glyphAt.
export const GLYPH_PICK_MARGIN_PX = 3;
// The screen radius of a glyph as drawn (svg-renderer drawUnifiedGlyph): the 'badge' style draws a disc of GLYPH_BG_DIAMETER_PX; the 'fusion'
// style draws no disc, only the icon, GLYPH_SYMBOL_SIZE_PX on its longer side (fusion-glyphs.js fusionGlyphMarkup).
export function glyphDrawnRadiusPx(settings = SettingsManager.getAll()) {
    return settings.GLYPH_STYLE === 'fusion' ? Number(settings.GLYPH_SYMBOL_SIZE_PX || 20) / 2 : settings.GLYPH_BG_DIAMETER_PX / 2;
}
export function glyphAt(svg, state, screenX, screenY) {
    return hitConstraintAtScreen(pickableConstraints(state) || [], svg, screenX, screenY, glyphDrawnRadiusPx() + GLYPH_PICK_MARGIN_PX);
}

// THE select tool's pick (task 588: HOVER = CLICK, so what lights up on hover is exactly what a click selects): a joint in snap reach
// (hitJoint), else a glyph the pointer is ON (glyphAt), else a shape (hitShape). Returns { joint } | { constraint } | { shape } | null.
// selection-tools handleSelectionPointerDown (the click) and applyHoverPriority (the hover) both call it.
export function selectPick(svg, state, hitJoint, hitShape, screenX, screenY) {
    if (hitJoint) return { joint: hitJoint };
    const constraint = glyphAt(svg, state, screenX, screenY);
    if (constraint) return { constraint };
    if (hitShape) return { shape: hitShape };
    return null;
}

/**
 * Set state.hovered* from the select tool's pick (selectPick: hover = click).
 */
export function applyHoverPriority(state, svg, hitJoint, hitShape, px, py) {
    const pick = selectPick(svg, state, hitJoint, hitShape, px, py);
    state.hoveredJoint = pick && pick.joint ? pick.joint.id : null;
    state.hoveredConstraint = pick && pick.constraint ? pick.constraint : null;
    state.hoveredShape = pick && pick.shape ? pick.shape.shape.id : null;
}

export function setHoverFromSnap(state) {
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
    // Find potential targets via snap system
    const scene = pickScene(state, pickableShapes(state));
    const hoverSnapResult = findSnap(scene.joints, scene.shapes, svg, {x: screenX, y: screenY}, [], false, false, 1.0);
    
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
    state.hoveredJoint = null;
    state.hoveredConstraint = null;
    state.hoveredShape = null;
}