﻿// ═══════════════════════════════════════════════════════════════════════════════
// INPUT MANAGER - Central coordinator
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES, SNAP, INFERENCE_TYPES, CONSTRAINT_TYPES, DRAG_TYPES } from '#core/constants.js';
import { hitConstraintAtScreen, findSnap } from '../snap-detection.js';
import { deleteSelection } from '#core/delete-manager.js';
import { deactivateLineTool } from './input-handlers/line-tool.js';
import { findInference } from '#core/inference-engine.js';
import { screenToWorld, worldToScreen } from '#app/coords.js';
import { getDist } from '#core/geometry.js';

import { setupSelectionTools, handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp, resetSelectionState } from './input-handlers/selection-tools.js';
import { updateHover } from './hover-manager.js';
import { setupDrawingTools, handleDrawingPointerDown, handleDrawingPointerMove, handleDrawingPointerUp, resetDrawingState } from './input-handlers/drawing-tools.js';
import { setupConstraintTools, handleConstraintPointerDown, handleConstraintPointerMove, handleConstraintPointerUp, resetConstraintState } from './input-handlers/constraint-tools.js';
import { setupPanZoom, handlePanZoomPointerDown, handlePanZoomPointerMove, handlePanZoomPointerUp, resetPanZoomState } from './input-handlers/pan-zoom.js';
import { setupDimensionTool, handleDimensionPointerDown, handleDimensionPointerMove, handleDimensionPointerUp, startDimensionFromSelection } from './input-handlers/dimension-tool.js';
import { setupNumericInput, showEditInput } from './numeric-input-manager.js';
import { setupNotifications, showNotification } from './notification-manager.js';
import { updatePreview, clearPreview, getPreviewData } from './preview-manager.js';
import { handleLineKeyDown } from './input-handlers/line-tool.js';
import { handleRectKeyDown } from './input-handlers/rect-tool.js';
import { handleCircleKeyDown } from './input-handlers/circle-tool.js';
import { handleArcKeyDown } from './input-handlers/arc-tool.js';
import { initCursors } from './cursor-manager.js';
import { setupLiveDimensionInput, handleLiveRectKeyDown, updateLiveRectPreview, applyLiveRectConstraints, hideLiveInputs, getLiveLockedPoint } from './input-handlers/live-dimension-input.js';
import { SolverConfig } from '#core/solver-config.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import SettingsManager from '#core/settings-manager.js';
import { getMagnetThreshold, isWithinMagnet } from './snap-magnet.js';
import { ConstraintManager } from '#core/constraint-manager.js';

// Apply some visual settings to CSS variables at startup and when changed
function applyVisualSettings(settings) {
    try {
        const root = document.documentElement.style;
        if (settings.LINE_STROKE !== undefined) root.setProperty('--line-stroke', settings.LINE_STROKE + 'px');
        if (settings.JOINT_RADIUS !== undefined) root.setProperty('--joint-radius', settings.JOINT_RADIUS + 'px');
        if (settings.LABEL_FONT_SIZE !== undefined) root.setProperty('--label-font-size', settings.LABEL_FONT_SIZE + 'px');
        if (typeof settings.GLYPH_SYMBOL_SIZE_PX === 'number') {
            root.setProperty('--glyph-icon-size', settings.GLYPH_SYMBOL_SIZE_PX + 'px');
            const bg = Math.round(settings.GLYPH_SYMBOL_SIZE_PX * 1.6);
            root.setProperty('--glyph-bg-diameter', bg + 'px');
        }
        if (settings.BACKGROUND) document.body.setAttribute('data-bg', settings.BACKGROUND);
    } catch(_) {}
}
applyVisualSettings(SettingsManager.getAll());
SettingsManager.subscribe((k, v, all) => applyVisualSettings(all));

// Pixels to shift interaction above the finger to avoid occlusion
// Set to 0 - magnifier removes the need for global negative offset
const TOUCH_OFFSET_Y = 0; // global touch offset used for snap/drag/draw

// Global flag for magnifier toggle
let magEnabled = false;

// Helper to sync magnifier portal: shows 1:1 view of the area under the finger,
// offset above the pointer so touch users can see the snap area.
// Activates whenever magEnabled AND a snap target is active (any tool mode).
// Called from updateSnapTarget so it always has fresh snap state.
function updateMagnifier(svg, state) {
    const mag = document.getElementById('magnifier');
    const magContent = document.getElementById('mag-content');
    const worldGroup = document.getElementById('world-group');
    if (!mag || !magContent || !worldGroup) return;

    // Show when: toggle ON + there is an active snap target with a point
    const snap = state && state.activeSnap;
    const hasSnap = snap && snap.pt && typeof snap.pt.x === 'number';

    if (!magEnabled || !hasSnap) {
        mag.style.display = 'none';
        // Clear any children only if populated (avoid unnecessary DOM write)
        if (magContent.firstChild) magContent.innerHTML = '';
        return;
    }

    const focusX = snap.pt.x;
    const focusY = snap.pt.y;
    dbg.log('magnifier', 'focus', focusX, focusY, snap.type, snap.targetId);

    // Viewbox-units-per-pixel for zoom-independent sizing
    const vb = svg.viewBox.baseVal;
    const bRect = svg.getBoundingClientRect();
    const pxScale = vb.width / bRect.width;

    // Lens size: always ~50 screen pixels regardless of zoom
    const lensR = 50 * pxScale;
    const clipR = lensR - 2 * pxScale;
    const strokeW = 2 * pxScale;
    const c1 = mag.querySelector(':scope > circle');
    const c2 = mag.querySelector('clipPath circle');
    if (c1) { c1.setAttribute('r', lensR); c1.setAttribute('stroke-width', strokeW); }
    if (c2) { c2.setAttribute('r', clipR); }

    // Position the lens above the snap point (80 screen pixels up)
    const offY = 80 * pxScale;
    mag.setAttribute('transform', 'translate(' + focusX + ',' + (focusY - offY) + ')');
    mag.style.display = 'block';

    // PERFORMANCE FIX: Use SVG <use> to reference the live world-group content
    // instead of cloning innerHTML every frame. The <use> element creates a
    // shadow copy that stays in sync with the original without any DOM copying.
    // We wrap it in a translated <g> so the snap point sits at lens center.
    const useEl = magContent.querySelector('use');
    if (!useEl) {
        // First time: create the <use> element
        magContent.innerHTML = `<g id="mag-translate"><use href="#world-group"/></g>`;
    }
    // Update translation to center on the snap point
    const translateG = magContent.querySelector('#mag-translate');
    if (translateG) {
        translateG.setAttribute('transform', 'translate(' + (-focusX) + ',' + (-focusY) + ')');
    }
}

// Setup a footer button that toggles the magnifier on/off
function setupMagToggle(svg, state) {
    const btn = document.getElementById('btn-mag-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
        magEnabled = !magEnabled;
        btn.innerText = `MAG LENS: ${magEnabled ? 'ON' : 'OFF'}`;
        btn.classList.toggle('bg-blue-500', magEnabled);
        btn.classList.toggle('text-white', magEnabled);
        btn.setAttribute('aria-pressed', magEnabled);
        // Immediately sync magnifier visibility with current snap state
        try { updateMagnifier(svg, state); } catch(_) { }
    });
}

// Edge Panning State
let edgePanFrame = null;
let edgePanStartTime = 0;
let edgePanDirection = { x: 0, y: 0 };
const EDGE_MARGIN_PCT = 0.05;
const EDGE_DELAY_MS = 200;

function stopEdgePan() {
    if (edgePanFrame) {
        cancelAnimationFrame(edgePanFrame);
        edgePanFrame = null;
    }
    edgePanStartTime = 0;
    edgePanDirection = { x: 0, y: 0 };
}

function edgePanLoop(svg, state) {
    if (!edgePanDirection.x && !edgePanDirection.y) {
        stopEdgePan();
        return;
    }

    // Check delay
    if (Date.now() - edgePanStartTime < EDGE_DELAY_MS) {
        edgePanFrame = requestAnimationFrame(() => edgePanLoop(svg, state));
        return;
    }

    // Perform Pan
    const rect = svg.getBoundingClientRect();
    const pxScale = state.view.w / rect.width;
    const speedPx = 5; 
    const speedWorld = speedPx * pxScale;

    state.view.x += edgePanDirection.x * speedWorld;
    state.view.y += edgePanDirection.y * speedWorld;

    // Update SVG ViewBox
    updateViewBox(svg, state.view);

    // Trigger viewport update event so tools update their previews
    if (state.lastMouse) {
        document.dispatchEvent(new CustomEvent('panzoom:viewportChanged', { 
            detail: { screenX: state.lastMouse.x, screenY: state.lastMouse.y } 
        }));
    }

    edgePanFrame = requestAnimationFrame(() => edgePanLoop(svg, state));
}

export function setupInput(svg, state) {
    setupSelectionTools(svg, state);
    setupDrawingTools(svg, state);
    setupConstraintTools(svg, state);
    setupPanZoom(svg, state);
    setupDimensionTool(svg, state);
    setupNumericInput(svg, state);
    setupNotifications();
    try { setupMagToggle(svg, state); } catch(_) { }
    // Dynamic import using Promise.then instead of top-level await to keep compatibility
    try {
        import('./settings-panel.js').then(m => {
            try { if (m && typeof m.default === 'function') m.default(svg, state); } catch(_){}
        }).catch(_=>{});
    } catch(_) { }
    try { initCursors(); } catch(e) { console.error('Failed to init cursors:', e); }
    // Ensure settings panel initializes in single-file bundles (require path uses module id)
    try {
        const __m = require('./ui/settings-panel.js');
        const sp = (__m && __m.default) || __m;
        if (sp && typeof sp === 'function') try { sp(svg, state); } catch(_) { }
    } catch(_) { }
    try { setupLiveDimensionInput(); } catch(e) { console.error('Failed to init live dim:', e); }
    
    // Apply initial zoom: 50 pixels per unit
    // Only apply if view is at default large scale (e.g. > 400) to avoid compounding on reloads
    if (state.view && state.view.w > 400) {
        try { 
            const r = svg.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                state.view.w = r.width / 50; // 50px per unit
                updateViewBox(svg, state.view);
            }
        } catch(_) {}
    }

    setupEventListeners(svg, state);
    setupKeyboardShortcuts(state);

    // Dev helper: concise snap logger similar to 'ug log' for quick debugging
    try {
        if (typeof window !== 'undefined') {
            window.ug = window.ug || {};
            window.ug.snap = {
                log: function() {
                    // Build a safe summary and return it so the console call shows a value
                    const s = {
                        activeSnap: (state && state.activeSnap) ? { type: state.activeSnap.type, targetId: state.activeSnap.targetId, isLocked: state.activeSnap.isLocked, pt: state.activeSnap.pt ? { x: state.activeSnap.pt.x, y: state.activeSnap.pt.y } : null } : null,
                        snapTarget: (state && state.snapTarget) ? { type: state.snapTarget.type, targetId: state.snapTarget.targetId, isLocked: state.snapTarget.isLocked } : null,
                        mouse: (state && state.lastMouse) ? { x: state.lastMouse.x, y: state.lastMouse.y } : null
                    };
                    // Use console.log directly (no swallowing) so errors surface in DevTools
                    dbg.log('snap','[ug.snap]', s);
                    return s;
                },
                start: function(ms = 1000) { if (this._id) return; this._id = setInterval(() => { try { this.log(); } catch (err) { console.error('[ug.snap] interval error', err); } }, ms); },
                stop: function() { if (this._id) { clearInterval(this._id); this._id = null; } }
            };

            window.ug.debug = window.ug.debug || {};
            window.ug.debug.fixed = {
                logSelection: function() {
                    const selJ = state.selectedJoints ? Array.from(state.selectedJoints) : [];
                    const selS = state.selectedShapes ? Array.from(state.selectedShapes) : [];
                    const joints = selJ.map(id => {
                        const j = state.joints.get(id);
                        return { id, fixed: !!(j && j.fixed), x: j ? j.x : null, y: j ? j.y : null };
                    });
                    const shapes = selS.map(id => {
                        const s = state.shapes.find(x => x.id === id);
                        if (!s || !s.joints) return { id, fixed: false, joints: [] };
                        const fixed = s.joints.every(jid => {
                            const j = state.joints.get(jid);
                            return !!(j && j.fixed);
                        });
                        return { id, type: s.type, fixed, joints: s.joints.slice() };
                    });
                    const out = { joints, shapes };
                    dbg.log('debug', '[ug.debug.fixed] selection', out);
                    return out;
                },
                logAll: function() {
                    const all = [];
                    for (const [id, j] of state.joints) {
                        all.push({ id, fixed: !!j.fixed, x: j.x, y: j.y });
                    }
                    dbg.log('debug', '[ug.debug.fixed] all joints', all);
                    return all;
                }
            };

            window.ug.debug.dof = {
                logAll: function() {
                    const activeConstraints = (state.constraints || []).filter(c => !c.isDriven && !c.driven);
                    const res = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes, constraints: activeConstraints });
                    const out = [];
                    for (const [id, j] of state.joints) {
                        const dof = res.jointDOFs && res.jointDOFs.has(id) ? res.jointDOFs.get(id) : 2;
                        out.push({ id, dof, fixed: !!j.fixed, x: j.x, y: j.y });
                    }
                    dbg.log('debug', '[ug.debug.dof] all joints', out);
                    return out;
                },
                logSelection: function() {
                    const activeConstraints = (state.constraints || []).filter(c => !c.isDriven && !c.driven);
                    const res = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes, constraints: activeConstraints });
                    const sel = state.selectedJoints ? Array.from(state.selectedJoints) : [];
                    const out = sel.map(id => {
                        const j = state.joints.get(id);
                        const dof = res.jointDOFs && res.jointDOFs.has(id) ? res.jointDOFs.get(id) : 2;
                        return { id, dof, fixed: !!(j && j.fixed), x: j ? j.x : null, y: j ? j.y : null };
                    });
                    dbg.log('debug', '[ug.debug.dof] selection', out);
                    return out;
                }
            };
        }
    } catch (err) { console.error('[ug.snap] attach error', err); }
}

// Helper: Centralized snap update logic
function updateSnapTarget(e, svg, state) {
    const isTouch = e.isTouch || e.pointerType === 'touch';
    const snapBoost = isTouch ? 2.0 : 1.0;
    const constraintTol = isTouch ? 40 : 20;

    // Determine if we need snap (active operation) or just hover (idle)
    const isDrawingTool = [TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.ARC, TOOL_MODES.POLYGON, TOOL_MODES.DIMENSION].includes(state.currentTool);
    const needsSnap = !!(state.drag || state.active || state.placingConstraint || isDrawingTool);
    
    if (needsSnap) {
        // ACTIVE OPERATION: Compute snap targets for magnetic attraction
        const excludeIds = (state.drag && state.drag.jointIds) ? state.drag.jointIds : [];
        let snapResult = findSnap(state.joints, state.shapes, svg, {x: e.clientX, y: e.clientY}, excludeIds, false, false, snapBoost);
        
        // Explicitly check for origin snap if findSnap didn't return a joint.
        // This ensures the origin is always snappable even if findSnap logic skips it.
        if ((!snapResult || snapResult.type !== 'joint') && state.joints.has('j_origin')) {
            const origin = state.joints.get('j_origin');
            const sOrigin = worldToScreen(svg, origin);
            const dOrigin = Math.hypot(e.clientX - sOrigin.x, e.clientY - sOrigin.y);
            if (dOrigin <= getMagnetThreshold('snap')) {
                snapResult = { type: 'joint', targetId: 'j_origin', pt: origin };
            }
        }
        
        // Check for constraints only when not dragging
        let hitConstraint = null;
        if (!state.drag) {
            hitConstraint = hitConstraintAtScreen(state.constraints, svg, e.clientX, e.clientY, constraintTol);
        }

        const isDrawing = isDrawingTool;
        const isDimensioning = state.currentTool === TOOL_MODES.DIMENSION;

        let target = null;
        if (isDrawing || isDimensioning) {
            // Drawing/Dimension tools: prioritize geometry over constraints
            if (snapResult) target = snapResult;
            else if (hitConstraint) target = { type: 'constraint', constraint: hitConstraint, pt: Array.isArray(hitConstraint.glyphPos) ? hitConstraint.glyphPos[0] : hitConstraint.glyphPos };
        } else {
            // Select mode: prefer constraints, then geometry
            if (hitConstraint) target = { type: 'constraint', constraint: hitConstraint, pt: Array.isArray(hitConstraint.glyphPos) ? hitConstraint.glyphPos[0] : hitConstraint.glyphPos };
            else if (snapResult) target = snapResult;
        }

        // GRID SNAP FALLBACK: If no geometry/constraint snap, check for grid intersection
        if (!target) {
            const w = screenToWorld(svg, e.clientX, e.clientY);
            const GRID_SIZE = Number(SettingsManager.get('GRID_SIZE') || 2);
            const gx = Math.round(w.x / GRID_SIZE) * GRID_SIZE;
            const gy = Math.round(w.y / GRID_SIZE) * GRID_SIZE;
            
            const screenGrid = worldToScreen(svg, { x: gx, y: gy });
            const dist = Math.hypot(e.clientX - screenGrid.x, e.clientY - screenGrid.y);
            
            const gridThreshold = getMagnetThreshold('grid');
            if (dist <= gridThreshold) {
                target = { type: 'grid', pt: { x: gx, y: gy } };
            }
        }

        if (target) {
            const pt = target.pt ? target.pt : (target.x !== undefined && target.y !== undefined ? { x: target.x, y: target.y } : null);
            const screenSnap = pt ? worldToScreen(svg, pt) : null;
            const dist = screenSnap ? Math.hypot(e.clientX - screenSnap.x, e.clientY - screenSnap.y) : Infinity;
            
            // HYSTERESIS: If we are already snapped to this target, widen the threshold
            // to prevent flickering/loss on micro-movements (jitter).
            let useHysteresis = false;
            if (state.activeSnap && state.activeSnap.isLocked) {
                const prevId = state.activeSnap.targetId || state.activeSnap.id || (state.activeSnap.shape && state.activeSnap.shape.id);
                const currId = target.targetId || target.id || (target.shape && target.shape.id);
                if (prevId && currId && prevId === currId) useHysteresis = true;
            }

            const isLocked = isWithinMagnet(dist, 'snap', useHysteresis);
            if (isLocked) {
                const tId = target.targetId || target.id || (target.shape ? target.shape.id : null) || null;
                state.snapTarget = Object.assign({}, target, {
                    targetId: tId,
                    id: tId, // Ensure id is present for consumers expecting it (like applySnapConstraint)
                    pt: pt,
                    isLocked: true
                });
                // TRACK HISTORY: Save valid snap for recovery on jittery release
                state.lastLockedSnap = state.snapTarget;
                state.lastLockedTime = Date.now();
            } else {
                state.snapTarget = null;
            }
        } else {
            state.snapTarget = null;
        }

        // Link snap feedback into active preview when drawing/dimensioning
        // This makes the visual snap target the authoritative source for
        // applying constraints on finalize, avoiding mismatches between what
        // the user sees and what the code applies on pointer up.
        if ((isDrawing || isDimensioning) && state.active) {
            state.active.preview = state.active.preview || {};
            if (state.snapTarget) {
                state.active.preview.snapTarget = state.snapTarget;
            } else {
                // Clear any leftover preview snap if the snap is no longer valid
                if (state.active.preview && state.active.preview.snapTarget) delete state.active.preview.snapTarget;
            }
        }
        state.activeSnap = state.snapTarget;
    } else {
        // IDLE: No snap needed, just clear snap state
        state.snapTarget = null;
        state.activeSnap = null;
    }

    // Unified magnifier update — always runs after snap state is fresh
    try { updateMagnifier(svg, state); } catch(_) { }
}


function handlePointerDown(e, svg, state) {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);

    // Apply touch offset to pointerdown so selection/snap/drag use same virtual coordinates
    let screenX = e.clientX, screenY = e.clientY;
    if (e.pointerType === 'touch') screenY += TOUCH_OFFSET_Y;
    const isTouch = e.pointerType === 'touch';
    state.lastMouse = { x: screenX, y: screenY };
    const w = screenToWorld(svg, screenX, screenY);

    // Two-finger touch gestures (pinch/pan) should take priority over tool actions
    if (isTouch) {
        try { if (handlePanZoomPointerDown(e, svg, state)) return true; } catch (_) { }
    }

    // Navigation Priority: Middle Mouse Button always pans, regardless of active tool
    if (e.button === 1) {
        if (handlePanZoomPointerDown(e, svg, state)) return true;
    }

    // Handle Dimension Driven/Driving Toggle Click — guard against synthetic
    // events from tests whose targets lack classList/closest.
    const _hasCls = e.target && e.target.classList && typeof e.target.classList.contains === 'function';
    const _hasClosest = e.target && typeof e.target.closest === 'function';
    if ((_hasCls && e.target.classList.contains('dim-driven-toggle')) || (_hasClosest && e.target.closest('.dim-driven-toggle'))) {
        const el = (_hasCls && e.target.classList.contains('dim-driven-toggle')) ? e.target : e.target.closest('.dim-driven-toggle');
        const cIdx = parseInt(el.getAttribute('data-c-idx'), 10);
        if (!isNaN(cIdx) && state.constraints && state.constraints[cIdx]) {
            const c = state.constraints[cIdx];
            
            // ONE driving dimension per edge: if this dim is a reference and ANOTHER dim on the same
            // edge/shapes already DRIVES, SWAP — demote that driver to a reference and let this one take
            // over (replaces the old ERR-DRIVE-01 refusal, so the user can always pick which dim drives).
            if (c.isDriven) {
                let others = [];
                if (c.type === CONSTRAINT_TYPES.DISTANCE) {
                    if (c.isRadius && c.shape) {
                        others = state.constraints.filter(oc =>
                            oc !== c && !oc.isDriven && !oc.driven &&
                            oc.type === CONSTRAINT_TYPES.DISTANCE && oc.isRadius && oc.shape === c.shape);
                    } else if (c.joints && c.joints.length >= 2) {
                        const [j1, j2] = c.joints;
                        // Any other driving distance on the same joint-pair (any dimMode) — one driver per edge.
                        others = state.constraints.filter(oc =>
                            oc !== c && !oc.isDriven && !oc.driven &&
                            oc.type === CONSTRAINT_TYPES.DISTANCE && oc.joints && oc.joints.length >= 2 &&
                            ((oc.joints[0] === j1 && oc.joints[1] === j2) || (oc.joints[0] === j2 && oc.joints[1] === j1)));
                    }
                } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
                    const [s1, s2] = c.shapes;
                    others = state.constraints.filter(oc =>
                        oc !== c && !oc.isDriven && !oc.driven &&
                        oc.type === CONSTRAINT_TYPES.ANGLE && oc.shapes && oc.shapes.length === 2 &&
                        ((oc.shapes[0] === s1 && oc.shapes[1] === s2) || (oc.shapes[0] === s2 && oc.shapes[1] === s1)));
                }
                if (others.length) {
                    for (const oc of others) { oc.isDriven = true; oc.driven = true; }
                    showNotification('Now driving this dimension — the previous one is now a reference.', 'info');
                }
            }

            c.isDriven = !c.isDriven;
            c.driven = c.isDriven; // keep the two driven flags in sync (solver checks isDriven || driven)
            
            // If switching to DRIVING mode, update the constraint value to match current geometry
            // to prevent the geometry from snapping to an old/stale value.
            if (!c.isDriven) {
                if (c.isRadius && c.shape) {
                    const s = state.shapes.find(x => x.id === c.shape);
                    if (s && typeof s.radius === 'number') c.value = s.radius;
                } else if (c.joints && c.joints.length >= 2) {
                    const j1 = state.joints.get(c.joints[0]);
                    const j2 = state.joints.get(c.joints[1]);
                    if (j1 && j2) {
                        c.value = getDist(j1, j2);
                    }
                } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
                    const s1 = state.shapes.find(s => s.id === c.shapes[0]);
                    const s2 = state.shapes.find(s => s.id === c.shapes[1]);
                    if (s1 && s2 && s1.joints && s2.joints) {
                        const j1a = state.joints.get(s1.joints[0]);
                        const j1b = state.joints.get(s1.joints[1]);
                        const j2a = state.joints.get(s2.joints[0]);
                        const j2b = state.joints.get(s2.joints[1]);
                        if (j1a && j1b && j2a && j2b) {
                            const a1 = Math.atan2(j1b.y - j1a.y, j1b.x - j1a.x);
                            const a2 = Math.atan2(j2b.y - j2a.y, j2b.x - j2a.x);
                            let val = Math.abs((a1 - a2) * 180 / Math.PI);
                            if (val > 180) val = 360 - val;
                            c.value = val;
                        }
                    }
                }
                if (state.engine) {
                    const result = state.engine.solve(SolverConfig.ITERATIONS || 500);
                    if (result && !result.converged) {
                        showNotification(
                            `Constraint conflict detected. [ERR-DRIVE-02] Reason: Solver did not converge after toggling driving.\nArgs: ` +
                            JSON.stringify({
                                constraint: c,
                                result
                            }),
                            "warning"
                        );
                    }
                }
            }
            // Return true to consume the event (prevent selection/drag)
            return true;
        }
    }

    // Update snap target using virtual pointer coords
    try { updateSnapTarget({ clientX: screenX, clientY: screenY, isTouch }, svg, state); } catch(_) { state.snapTarget = null; }

    // Debug: log full hit-detection and snap decision for pointerdown (safe fields only)
    try{
        const inputVerbose = (typeof window !== 'undefined' && window.ug && window.ug.debug && window.ug.debug.verboseInputLogs) ? true : false;
        if(inputVerbose){ dbg.log('joints', '[input-manager] hit detection', { snapTarget: state.snapTarget ? { type: state.snapTarget.type, targetId: state.snapTarget.targetId, isLocked: state.snapTarget.isLocked } : null, jointCount: state.joints ? state.joints.size : 0, shapeCount: state.shapes ? state.shapes.length : 0, constraintCount: state.constraints ? state.constraints.length : 0 }); }
    }catch(_){ }


    // Determine whether the current snap is within locking distance (visual lock)
    if (state.snapTarget && state.snapTarget.pt) {
        try {
            const screenPt = worldToScreen(svg, state.snapTarget.pt);
            const dist = Math.hypot(screenX - screenPt.x, screenY - screenPt.y);
            state.snapTarget.isLocked = isWithinMagnet(dist, 'snap');
        } catch (_) {
            state.snapTarget.isLocked = false;
        }
    } else if (state.snapTarget) {
        // If no explicit pt (e.g., some constraint glyphs), mark as not locked
        state.snapTarget.isLocked = false;
    }

    // activeSnap is now managed by updateSnapTarget based on active operations

    // Backward-compatible hit objects for existing handlers
    // NOTE: For pointerdown we must run hit-detection directly because updateSnapTarget
    // may clear snap state when idle. Use findSnap() like the hover manager so clicks
    // detect shapes even when not in active snap mode. Fall back to state.snapTarget
    // only if findSnap didn't return anything.
    let hitJoint = null;
    let hitShape = null;
    let clickSnap = null;
    try {
        // If the user already has a LOCKED snap from hovering (the magnetic
        // visual indicator that locks within SNAP_MAGNETISM px), honor it
        // over a fresh findSnap. Otherwise rapid hover-lock → click sequences
        // can lose the lock to a geometrically-closer entity at the exact
        // click pixel.
        if (state.snapTarget && state.snapTarget.isLocked) {
            clickSnap = state.snapTarget;
            if (state.snapTarget.type === 'joint') {
                const jid = state.snapTarget.targetId;
                hitJoint = { id: jid, j: state.joints.get(jid) };
            } else if (state.snapTarget.type === 'line' || state.snapTarget.type === 'shape' || state.snapTarget.type === 'midpoint') {
                hitShape = { shape: state.snapTarget.shape, pt: state.snapTarget.pt };
            }
        }
        if (!hitJoint && !hitShape) {
            const snapBoost = isTouch ? 2.0 : 1.0;
            clickSnap = findSnap(state.joints, state.shapes, svg, { x: screenX, y: screenY }, [], false, false, snapBoost);
            // DEBUG: Log what findSnap returns when clicking
            console.log('[DEBUG input-manager] pointerdown findSnap:', clickSnap, 'at screen:', screenX, screenY, 'joints count:', state.joints.size);
            if (clickSnap) {
                if (clickSnap.type === 'joint') {
                    const jid = clickSnap.targetId;
                    hitJoint = { id: jid, j: state.joints.get(jid) };
                } else if (clickSnap.type === 'line' || clickSnap.type === 'shape' || clickSnap.type === 'midpoint') {
                    hitShape = { shape: clickSnap.shape, pt: clickSnap.pt || { x: clickSnap.x, y: clickSnap.y } };
                }
            } else if (state.snapTarget) {
                clickSnap = state.snapTarget; // Unlocked-snapTarget fallback
                if (state.snapTarget.type === 'joint') {
                    const jid = state.snapTarget.targetId;
                    hitJoint = { id: jid, j: state.joints.get(jid) };
                } else if (state.snapTarget.type === 'line' || state.snapTarget.type === 'shape' || state.snapTarget.type === 'midpoint') {
                    hitShape = { shape: state.snapTarget.shape, pt: state.snapTarget.pt };
                }
            }
        }
    } catch (err) {
        console.error('[DEBUG input-manager] findSnap error:', err);
        // Fallback to existing snapTarget if findSnap fails for any reason
        if (state.snapTarget) {
            clickSnap = state.snapTarget;
            if (state.snapTarget.type === 'joint') {
                const jid = state.snapTarget.targetId;
                hitJoint = { id: jid, j: state.joints.get(jid) };
            } else if (state.snapTarget.type === 'line' || state.snapTarget.type === 'shape' || state.snapTarget.type === 'midpoint') {
                hitShape = { shape: state.snapTarget.shape, pt: state.snapTarget.pt };
            }
        }
    }

    // Use virtual coords for constraint hit-testing as well
    let hitConstraint = null;
    const constraintTol = isTouch ? 40 : 20;
    try { hitConstraint = hitConstraintAtScreen(state.constraints, svg, screenX, screenY, constraintTol); } catch(_) { hitConstraint = null; }

    // If clicking empty canvas while in SELECT or PAN, begin panning immediately
    if (!hitJoint && !hitShape && !hitConstraint && (state.currentTool === TOOL_MODES.SELECT || state.currentTool === TOOL_MODES.PAN)){
        const ph = handlePanZoomPointerDown(e, svg, state);
        if(ph) return true;
    }

    let handled = false;
    // Since TOUCH_OFFSET_Y is 0, pass the original PointerEvent `e` directly to preserve prototype properties like pointerId and shiftKey
    switch (state.currentTool) {
        case TOOL_MODES.SELECT:
            handled = handleSelectionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint);
            break;
        case TOOL_MODES.DIMENSION:
            handled = handleDimensionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint);
            break;
        case TOOL_MODES.LINE:
        case TOOL_MODES.RECT:
        case TOOL_MODES.CIRCLE:
        case TOOL_MODES.ARC:
        case TOOL_MODES.POLYGON:
            // Use fresh clickSnap (from findSnap) instead of possibly-stale state.snapTarget
            handled = handleDrawingPointerDown(e, svg, state, clickSnap || state.snapTarget, w);
            break;
        case TOOL_MODES.COINCIDENT:
        case TOOL_MODES.HORIZONTAL_VERTICAL:
        case TOOL_MODES.PARALLEL:
        case TOOL_MODES.PERPENDICULAR:
        case TOOL_MODES.COLLINEAR:
        case TOOL_MODES.TANGENT:
        case TOOL_MODES.EQUAL:
        case TOOL_MODES.MIDPOINT:
            handled = handleConstraintPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint);
            // EXIT ON INVALID CLICK: If the constraint tool didn't handle the click (empty space or invalid target),
            // switch back to Select tool immediately.
            if (!handled) {
                switchToTool(state, TOOL_MODES.SELECT);
                return true;
            }
            break;
    }

    if (!handled) handled = handlePanZoomPointerDown(e, svg, state);
    return handled; 
}

function handlePointerMove(e, svg, state) {
        // If a pan is active, let pan-zoom handle movement regardless of tool
        try{
            if(handlePanZoomPointerMove(e, svg, state)) return true;
        }catch(_){ }
        e.preventDefault();
    // Apply unified touch offset: keep the preview above the finger
    let screenX = e.clientX, screenY = e.clientY;
    if (e.pointerType === 'touch') screenY += TOUCH_OFFSET_Y;
    const isTouch = e.pointerType === 'touch';
    state.lastMouse = { x: screenX, y: screenY };
    const w = screenToWorld(svg, screenX, screenY);

    // Keep the snap target updated consistently while moving (use shifted coords)
    try { updateSnapTarget({ clientX: screenX, clientY: screenY, isTouch }, svg, state); } catch(_) { state.snapTarget = state.snapTarget || null; }

    // Note: magnifier visibility is now owned by updateSnapTarget via updateMagnifier

    // Backward-compatible hit objects for handlers
    // When ACTIVE (snap mode): use snapTarget for hit detection
    // When IDLE (hover mode): compute separate hit detection
    let hitJoint = null;
    let hitShape = null;
    
    const needsSnap = !!(state.drag || state.active || state.placingConstraint);
    
    if (needsSnap && state.snapTarget) {
        // ACTIVE: Use snap target
        if (state.snapTarget.type === 'joint') {
            const jid = state.snapTarget.targetId; 
            hitJoint = { id: jid, j: state.joints.get(jid) };
        } else if (state.snapTarget.type === 'line' || state.snapTarget.type === 'shape') {
            hitShape = { shape: state.snapTarget.shape, pt: state.snapTarget.pt };
        }

        // Keep `state.activeSnap` in sync during pointer moves so render/logic read same source
        state.activeSnap = state.snapTarget || null;
    }

    // Only update hover when idle (no active snap/drag), otherwise active tools manage hover via snapTarget
    if (!needsSnap) {
        try { updateHover(svg, screenX, screenY, state); } catch(_) { }
    }

    // EDGE PANNING CHECK
    const isDragging = !!state.drag;
    const isDrawing = state.active && (state.currentTool === TOOL_MODES.LINE || state.currentTool === TOOL_MODES.RECT || state.currentTool === TOOL_MODES.CIRCLE || state.currentTool === TOOL_MODES.ARC || state.currentTool === TOOL_MODES.POLYGON || state.currentTool === TOOL_MODES.DIMENSION);
    
    if (isDragging || isDrawing) {
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const w = rect.width;
        const h = rect.height;
        
        let dx = 0;
        let dy = 0;
        const marginX = w * EDGE_MARGIN_PCT;
        const marginY = h * EDGE_MARGIN_PCT;
        
        if (x < marginX) dx = -1;
        else if (x > w - marginX) dx = 1;
        
        if (y < marginY) dy = -1;
        else if (y > h - marginY) dy = 1;
        
        if (dx !== 0 || dy !== 0) {
            if (edgePanDirection.x !== dx || edgePanDirection.y !== dy) {
                edgePanDirection = { x: dx, y: dy };
                if (!edgePanFrame) {
                    edgePanStartTime = Date.now();
                    edgePanFrame = requestAnimationFrame(() => edgePanLoop(svg, state));
                }
            }
        } else {
            stopEdgePan();
        }
    } else {
        stopEdgePan();
    }

    
    let handled = false;
    // Pass original PointerEvent to preserve prototype-backed properties
    switch (state.currentTool) {
        case TOOL_MODES.SELECT: handled = handleSelectionPointerMove(e, svg, state); break;
        case TOOL_MODES.DIMENSION: handled = handleDimensionPointerMove(e, svg, state, w); break;
        case TOOL_MODES.LINE:
        case TOOL_MODES.RECT:
        case TOOL_MODES.CIRCLE:
        case TOOL_MODES.ARC:
        case TOOL_MODES.POLYGON: 
            handled = handleDrawingPointerMove(e, svg, state, w); 
            if (state.currentTool === TOOL_MODES.RECT) {
                // Always update preview to respect locked dimensions (phantom rect) even if inputs are hidden
                updateLiveRectPreview(svg, state);
            }
            break;
        default: handled = handlePanZoomPointerMove(e, svg, state);
    }
    return handled; 
}

function handlePointerUp(e, svg, state) {
    e.preventDefault();
    stopEdgePan();
    const wasDragging = state.drag !== null;

    // Allow pinch/pan gestures to clean up before tool-specific pointer-up logic
    if (e.pointerType === 'touch') {
        try { if (handlePanZoomPointerUp(e, svg, state)) return true; } catch (_) { }
    }

    // Apply touch offset to pointerup coords so finalization uses virtual coords too
    let screenX = e.clientX, screenY = e.clientY;
    if (e.pointerType === 'touch') screenY += TOUCH_OFFSET_Y;
    const w = screenToWorld(svg, screenX, screenY);

    // RECOVERY: If snap was lost just now (e.g. < 200ms ago), recover it.
    // This handles "release jitter" where the mouse slips slightly while clicking.
    // We apply this globally so ALL tools (Line, Rect, Select) benefit from sticky snapping.
    if (!state.snapTarget && state.lastLockedSnap && (Date.now() - (state.lastLockedTime || 0) < 200)) {
        state.snapTarget = state.lastLockedSnap;
        state.activeSnap = state.snapTarget;
        try{ dbg.log('input', '[input-manager] recovered lost snap on pointerUp'); }catch(_){}
    }

    // FIX: Prioritize Pan/Zoom cleanup. 
    // If a pan operation is active (e.g. via MMB), we must catch the release event here 
    // before the active tool consumes it (and potentially ignores the button index).
    // EXCEPTION: If we are actively dragging geometry, we must allow the tool to handle the release
    // to ensure the drag is dropped (preventing sticky drag).
    const isGeometryDrag = state.drag && (
        state.drag.type === DRAG_TYPES.JOINT || 
        state.drag.type === DRAG_TYPES.CLUSTER || 
        state.drag.type === DRAG_TYPES.LINE || 
        state.drag.type === DRAG_TYPES.DIMENSION
    );

    if (!isGeometryDrag) {
        try {
            if (handlePanZoomPointerUp(e, svg, state)) return true;
        } catch (_) { }
    }

    // Note: updateMagnifier is driven from updateSnapTarget; force-hide on pointer-up below

    let handled = false;
    // Pass original PointerEvent so handlers receive pointerId and other prototype properties
    switch (state.currentTool) {
        case TOOL_MODES.SELECT: handled = handleSelectionPointerUp(e, svg, state); break;
        case TOOL_MODES.DIMENSION: handled = handleDimensionPointerUp(e, svg, state); break;
        case TOOL_MODES.LINE:
        case TOOL_MODES.RECT:
        case TOOL_MODES.CIRCLE:
        case TOOL_MODES.ARC:
        case TOOL_MODES.POLYGON:
            if (state.currentTool === TOOL_MODES.LINE) dbg.log('input', '[input-manager] Line Tool PointerUp', { snap: state.snapTarget, isLocked: state.snapTarget && state.snapTarget.isLocked });
            const prevShapeCount = state.shapes ? state.shapes.length : 0;
            
            // If live dimensions are active, override the mouse position with the locked preview point
            const lockedW = (state.currentTool === TOOL_MODES.RECT) ? getLiveLockedPoint(state) : null;
            const effectiveW = lockedW || w;

            handled = handleDrawingPointerUp(e, svg, state, state.snapTarget, effectiveW, wasDragging); 
            if (state.currentTool === TOOL_MODES.RECT && state.shapes && state.shapes.length > prevShapeCount) {
                applyLiveRectConstraints(state);
            }
            if (state.currentTool === TOOL_MODES.RECT && !state.active) hideLiveInputs();
            break;
    }
    if (!handled) handled = handlePanZoomPointerUp(e, svg, state);
    // Force-hide magnifier on pointer up to ensure it doesn't persist after drag ends
    try {
        const mag = document.getElementById('magnifier');
        if (mag) mag.style.display = 'none';
        const magContent = document.getElementById('mag-content');
        if (magContent) magContent.innerHTML = '';
    } catch(_) { }
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
    return handled;
}

function setupEventListeners(svg, state) {
    dbg.log('input', '[input-manager] Attaching pointer listeners to svg', !!svg);
    if(!svg) return;
        svg.addEventListener('pointerdown', (e) => {
            console.log('[DEBUG] SVG pointerdown fired', { x: e.clientX, y: e.clientY, tool: state.currentTool });
            dbg.log('input', '[input-manager] svg pointerdown', {x: e.clientX, y: e.clientY, target: e.target && e.target.nodeName});
            // debug: verify unified snap format on pointerdown
            try{ /* noop */ }catch(_){ }
            try{ handlePointerDown(e, svg, state); } catch(err){ 
                console.error('[input-manager] handlePointerDown error', err);
                showNotification("Input Error: " + err.message, "error");
            }
        });
        svg.addEventListener('pointermove', (e) => {
            try{ handlePointerMove(e, svg, state); } catch(err){ console.error('[input-manager] handlePointerMove error', err); }
        });
        svg.addEventListener('pointerup', (e) => {
            dbg.log('input', 'svg pointerup', {x: e.clientX, y: e.clientY});
            try{ handlePointerUp(e, svg, state); } catch(err){ console.error('[input-manager] handlePointerUp error', err); }
        });
svg.addEventListener('wheel', (e) => { console.debug && console.debug('[input-manager] svg wheel', {deltaY: e.deltaY, x: e.clientX, y: e.clientY, target: e.target && e.target.nodeName}); try { handleWheel(e, svg, state); } catch(err) { console.warn('[input-manager] handleWheel failed:', err); } }, { passive: false });

        // Track whether pointer is over the SVG so we can optionally delegate document wheel events
        svg.addEventListener('pointerenter', () => { try{ state._isPointerOverSvg = true; }catch(_){ } });
        svg.addEventListener('pointerleave', () => { try{ state._isPointerOverSvg = false; }catch(_){ } });

        // Document-level wheel fallback: if wheel events don't reach the svg (overlays/extensions),
        // delegate zoom when we know the cursor is over the SVG.
        const docWheelHandler = (e) => {
            try {
                if (state._isPointerOverSvg && e.target !== svg) {
                    console.debug && console.debug('[input-manager] document wheel delegated to svg', { deltaY: e.deltaY, x: e.clientX, y: e.clientY, target: e.target && e.target.nodeName });
                    handleWheel(e, svg, state);
                }
            } catch(_){}
        };
        document.addEventListener('wheel', docWheelHandler, { passive: false });

        // Cleanup: remove doc handler when svg removed from DOM (best-effort)
        try { const obs = new MutationObserver((mut) => { if (!document.body.contains(svg)) { document.removeEventListener('wheel', docWheelHandler); obs.disconnect(); } }); obs.observe(document.body, { childList: true, subtree: true }); } catch(_){ }

    // Prevent default context menu when drawing a line so right-click can finish a segment
    document.addEventListener('contextmenu', (e) => {
        try {
            if (state.currentTool === TOOL_MODES.LINE && state.active) e.preventDefault();
        } catch(_) {}
    });

    // Listen for viewport changes coming from pan-zoom so active tool previews update during navigation
    try {
        document.addEventListener('panzoom:viewportChanged', (ev) => {
            try {
                const sx = ev && ev.detail ? ev.detail.screenX : null;
                const sy = ev && ev.detail ? ev.detail.screenY : null;
                if (sx === null || sy === null) return;
                try { updateSnapTarget({ clientX: sx, clientY: sy }, svg, state); } catch(_) { state.snapTarget = null; }
                state.lastMouse = { x: sx, y: sy };
                const w = screenToWorld(svg, sx, sy);
                const drawingTools = [TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.POLYGON, TOOL_MODES.ARC];
                if (drawingTools.includes(state.currentTool)) {
                    try { handleDrawingPointerMove({ clientX: sx, clientY: sy, pointerType: 'mouse' }, svg, state, w); } catch(_) { }
                } else {
                    // Update hover using centralized hover manager
                    try { updateHover(svg, sx, sy, state); } catch(_) { }
                }

                // Update viewport size display
                const vpEl = document.getElementById('viewport-size');
                if(vpEl && state.view) {
                     const r = svg.getBoundingClientRect();
                     vpEl.innerText = `VIEW: ${Math.round(state.view.w)} x ${Math.round(state.view.h)} / ${Math.round(r.width)}px x ${Math.round(r.height)}px`;
                }
            } catch(_) { }
        });
    } catch(_) { }

    // Listen for Live Dimension Commit (Enter key from input boxes)
    window.addEventListener('live-rect-commit', (e) => {
        dbg.log('input', '[DEBUG INPUT] live-rect-commit', e.detail);
        if (state.currentTool === TOOL_MODES.RECT && state.active) {
            // Simulate a pointer up event at the locked position
            const lockedPt = getLiveLockedPoint(state);
            dbg.log('input', '[DEBUG INPUT] Locked Point for commit:', lockedPt);
            if (lockedPt) {
                handlePointerUp({ clientX: 0, clientY: 0, pointerId: -1, preventDefault: ()=>{} }, svg, state);
            }
        }
    });

    // Also attach keyboard shortcuts at document-level (already handled) - ensure focus doesn't steal keys
        document.addEventListener('pointerdown',(e)=>{ 
            // Don't steal focus if user is clicking an input
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
            try{ svg.focus(); }catch(_){ } 
        });

}

function handleWheel(e, svg, state) {
    e.preventDefault();

    // Zoom towards cursor: Calculate world point under cursor
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const wx = state.view.x + (rx - 0.5) * state.view.w;
    const wy = state.view.y + (ry - 0.5) * state.view.h;

    // Use an exponential scale so larger deltaY produces proportional zoom.
    // Positive deltaY (wheel down) should zoom out; negative zooms in.
    const zoomFactorPerDelta = 1.0015; // tuned for smooth feel
    const factor = Math.pow(zoomFactorPerDelta, e.deltaY);

    // Clamp resulting width to avoid runaway zoom
    const MIN_W = 1e-3;
    const MAX_W = 1e6;
    let newW = state.view.w * factor;
    newW = Math.max(MIN_W, Math.min(MAX_W, newW));
    const newH = newW * (state.view.h / state.view.w);

    state.view.w = newW;
    state.view.h = newH;

    // Adjust view center so the world point remains under the cursor
    state.view.x = wx - (rx - 0.5) * state.view.w;
    state.view.y = wy - (ry - 0.5) * state.view.h;

    // Apply to SVG immediately and notify listeners
    try {
        updateViewBox(svg, state.view);
        state.lastMouse = { x: e.clientX, y: e.clientY };
        const ev = new CustomEvent('panzoom:viewportChanged', { detail: { screenX: e.clientX, screenY: e.clientY } });
        document.dispatchEvent(ev);
    } catch (_) { }

    // After zooming, refresh snap/preview at last mouse position so active tools update live
    try {
        if (state.lastMouse) {
            const sx = state.lastMouse.x, sy = state.lastMouse.y;
            try { updateSnapTarget({ clientX: sx, clientY: sy }, svg, state); } catch(_) { state.snapTarget = null; }
            const w = screenToWorld(svg, sx, sy);
            const drawingTools = [TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.POLYGON, TOOL_MODES.ARC];
            if (drawingTools.includes(state.currentTool)) {
                try { handleDrawingPointerMove({ clientX: sx, clientY: sy, pointerType: 'mouse' }, svg, state, w); } catch(_) { }
            } else {
                // Update hover using centralized hover manager
                try { updateHover(svg, sx, sy, state); } catch(_) { }
            }
        }
    } catch (_) { }
}

// Export core input handlers to allow programmatic tests and external wiring
export { handlePointerDown, handlePointerMove, handlePointerUp, setupEventListeners, handleWheel };

function updateViewBox(svg, view) {
    const rect = svg.getBoundingClientRect();
    view.h = view.w / (rect.width / rect.height);
    svg.setAttribute('viewBox', `${view.x - view.w/2} ${view.y - view.h/2} ${view.w} ${view.h}`);

    const vpEl = document.getElementById('viewport-size');
    if(vpEl) {
        vpEl.innerText = `VIEW: ${Math.round(view.w)} x ${Math.round(view.h)} / ${Math.round(rect.width)}px x ${Math.round(rect.height)}px`;
    }
}

function setupKeyboardShortcuts(state) {
    document.addEventListener('keydown', (e) => {
        // CRITICAL: If the target is an INPUT, the dimension input, or a TEXTAREA, do not process global shortcuts
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.id === 'dimInput')) return;
        // Route to focused tool handlers first
        // Support quick numeric input while placing a dimension: press a number, decimal, or minus to open input immediately
        if (state.currentTool === TOOL_MODES.DIMENSION && state.placingConstraint) {
            if (state.placingConstraint.isDriven || state.placingConstraint.driven) return;
            if (/^[0-9.\-]$/.test(e.key)) {
                try {
                    // Stop placement mode and open input so numeric entry starts immediately
                    try { const pending = state.placingConstraint; if (pending) { try { pending.__placing = false; } catch(_){} try { if (state && state.placingConstraint && state.placingConstraint === pending) state.placingConstraint = null; } catch(_){} } } catch(_){}
                    // Open input and pass the initial key so it can decide caret vs select behavior
                    showEditInput(document.querySelector('svg'), state, pending, e.key);

                } catch(_){ }
                e.preventDefault();
                return;
            }
        }

        if (state.currentTool === TOOL_MODES.LINE) {
            try{ if (handleLineKeyDown(e, document.querySelector('svg'), state)) { e.preventDefault(); return; } }catch(_){ }
        }
        if (state.currentTool === TOOL_MODES.RECT) {
            // Use new live dimension handler instead of the old one
            dbg.log('input', '[DEBUG INPUT] Calling handleLiveRectKeyDown', e.key);
            if (handleLiveRectKeyDown(e, document.querySelector('svg'), state)) { e.preventDefault(); return; }
        }
        if (state.currentTool === TOOL_MODES.CIRCLE) {
            try{ if (handleCircleKeyDown(e, document.querySelector('svg'), state)) { e.preventDefault(); return; } }catch(_){ }
        }
        if (state.currentTool === TOOL_MODES.ARC) {
            try{ if (handleArcKeyDown(e, document.querySelector('svg'), state)) { e.preventDefault(); return; } }catch(_){ }
        }
        if (e.key === 'Delete' || e.key === 'Backspace') { handleDelete(state); e.preventDefault(); }
        if (e.key === 'Escape') { handleEscape(state); e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { state.undo(); e.preventDefault(); }

        // Toggle fixed on selection
        if (e.key.toLowerCase() === 'f') {
            if (toggleFixedSelection(state)) {
                e.preventDefault();
                return;
            }
        }

        // Tool switching shortcuts (case insensitive)
        const key = e.key.toLowerCase();
        
        // Drawing tools
        if (key === 'l') { switchToTool(state, 'line'); e.preventDefault(); }
        if (key === 'r') { switchToTool(state, 'rect'); e.preventDefault(); }
        if (key === 'c') { switchToTool(state, 'circle'); e.preventDefault(); }
        if (key === 'a') { switchToTool(state, 'arc'); e.preventDefault(); }
        
        // Selection and navigation
        if (key === 's') { switchToTool(state, 'select'); e.preventDefault(); }
        if (key === 'v') { switchToTool(state, 'pan'); e.preventDefault(); } // V for View/Navigate
        
        // Constraint tools
        if (key === 'x') { switchToTool(state, TOOL_MODES.COINCIDENT); e.preventDefault(); } // X for eXact position
        if (key === 't') { switchToTool(state, TOOL_MODES.PERPENDICULAR); e.preventDefault(); } // T for perpendicuTar (right angle)
        if (key === 'o') { switchToTool(state, TOOL_MODES.TANGENT); e.preventDefault(); } // O for tangent (touching circles)
        if (key === 'i') { switchToTool(state, TOOL_MODES.COLLINEAR); e.preventDefault(); } // I for In-line
        // H: If a single line is preselected, apply H/V immediately. Otherwise switch to tool and wait for selection.
        if (key === 'h') {
            const selShapes = state.selectedShapes ? Array.from(state.selectedShapes) : [];
            if (selShapes.length === 1) {
                const s = state.shapes.find(x => x.id === selShapes[0]);
                if (s && s.type === 'line') {
                    ConstraintManager.addHorizontalOrVertical(state, s.joints);
                    e.preventDefault();
                    return;
                }
            }
            switchToTool(state, TOOL_MODES.HORIZONTAL_VERTICAL);
            e.preventDefault();
        }
        if (key === 'q') { switchToTool(state, TOOL_MODES.PARALLEL); e.preventDefault(); } // Q for parallel (like ||)
        // E: If two shapes are pre-selected and valid for EQUAL, apply immediately. Otherwise enter pending mode.
        if (key === 'e') {
            const selShapes = state.selectedShapes ? Array.from(state.selectedShapes) : [];
            if (selShapes.length === 2) {
                const s1 = state.shapes.find(x => x.id === selShapes[0]);
                const s2 = state.shapes.find(x => x.id === selShapes[1]);
                const isCircleLike = (s) => s && (s.type === 'circle' || s.type === 'arc');
                if ((s1 && s2 && s1.type === 'line' && s2.type === 'line') || (isCircleLike(s1) && isCircleLike(s2))) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.EQUAL, { shapes: [s1.id, s2.id] }, { source: 'toolbar' });
                    // Keep selections and the tool active — do not reset or switch away; user will exit manually.
                    try { showNotification('Equal constraint applied', 'success'); } catch(_) {}
                    e.preventDefault();
                    return;
                } else {
                    showNotification(
                        'Equal constraint requires two lines or two circles/arcs [ERR-EQUAL-01] Reason: Invalid selection for equal constraint.\nArgs: ' +
                        JSON.stringify({ selectedShapes: [s1 && s1.type, s2 && s2.type] }),
                        'warning'
                    );
                    e.preventDefault();
                    return;
                }
            }
            // Otherwise, just switch to the Equal tool and let clicking apply (preselection will be respected by switchToTool)
            switchToTool(state, TOOL_MODES.EQUAL);
            e.preventDefault();
        } // E for Equal
        
        // Dimension tool
        if (key === 'd') {
            switchToTool(state, 'dim');
            // Do not auto-create; arm the tool and let the first click create/place the dimension
            e.preventDefault();
        }
    });
}

function toggleFixedSelection(state) {
    const targets = new Set();

    if (state.selectedJoints && state.selectedJoints.size) {
        for (const jid of state.selectedJoints) targets.add(jid);
    }

    if (state.selectedShapes && state.selectedShapes.size) {
        for (const sid of state.selectedShapes) {
            const s = state.shapes.find(x => x.id === sid);
            if (s && s.joints) s.joints.forEach(jid => targets.add(jid));
        }
    }

    // Fallback: hovered shape
    if (targets.size === 0 && state.hoveredShape) {
        const s = state.shapes.find(x => x.id === state.hoveredShape);
        if (s && s.joints) s.joints.forEach(jid => targets.add(jid));
    }

    if (targets.size === 0) return false;

    const ids = Array.from(targets);
    const allFixed = ids.every(id => {
        if (id === 'j_origin') return true;
        const j = state.joints.get(id);
        return !!(j && j.fixed);
    });

    const nextFixed = !allFixed;
    for (const id of ids) {
        if (id === 'j_origin') continue;
        const j = state.joints.get(id);
        if (j) j.fixed = nextFixed;
    }

    try { dbg.log('debug', '[fixed] toggle', { ids, fixed: nextFixed }); } catch(_) {}
    try { if (state.engine) state.engine.solve(SolverConfig.ITERATIONS || 500); } catch(_) {}

    return true;
}

// Re-export showDimInput so higher-level modules (e.g. main.js) can open the dim editor
export const showDimInput = showEditInput;

// Helper: Switch the active tool programmatically with UI update fallback
function switchToTool(state, toolName) {
    // Import setTool from ui-manager if not available
    try {
        // First try to find the tool button and click it (this ensures proper UI update)
        const toolButton = document.getElementById('tool-' + toolName);
        if (toolButton) {
            // Blur any currently focused tool button (prevents lingering focus outlines)
            try {
                const activeEl = document.activeElement;
                if (activeEl && activeEl !== toolButton && activeEl.classList && activeEl.classList.contains('tool-btn')) {
                    try { activeEl.blur(); } catch(_) {}
                }
            } catch(_) {}

            // Clear other active states and set this button active so UI updates consistently
            try { document.querySelectorAll('.tool-btn, .tool-button, [class*="tool"]').forEach(b => b.classList.remove('active','selected','bg-blue-500','text-white')); } catch(_) {}
            try { toolButton.click(); } catch(_) {}
            try { /* Ensure no tool retains keyboard focus (prevents persistent focus ring) */ document.querySelectorAll('.tool-btn').forEach(b => { try{ b.blur(); }catch(_){ } }); } catch(_) {}
            try { toolButton.classList.add('active'); /* briefly focus then blur to ensure focus ring doesn't remain */ toolButton.focus(); setTimeout(()=>{ try{ toolButton.blur(); }catch(_){ } }, 0); } catch(_) {}
            return;
        }
    } catch(_) {}
    
    // Fallback: set tool directly
    try {
        state.currentTool = toolName;
        // Clear any preview state when switching tools
        try { clearPreview(state); } catch(_) {}
        // Update UI manually
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const toolEl = document.getElementById('tool-' + toolName);
        if (toolEl) {
            toolEl.classList.add('active');
        }
        
        // Update mode text
        const modeText = document.getElementById('modeText');
        if (modeText) {
            modeText.innerText = 'MODE: ' + toolName.toUpperCase();
        }

        // Fallback preselection for constraint tools (matches toolbar behavior)
        const constraintTools = [
            TOOL_MODES.COINCIDENT,
            TOOL_MODES.MIDPOINT,
            TOOL_MODES.HORIZONTAL_VERTICAL,
            TOOL_MODES.PARALLEL,
            TOOL_MODES.PERPENDICULAR,
            TOOL_MODES.COLLINEAR,
            TOOL_MODES.TANGENT,
            TOOL_MODES.EQUAL
        ];
        if (constraintTools.includes(toolName)) {
            let firstEl = null;
            if (state.selectedJoints && state.selectedJoints.size === 1 && (!state.selectedShapes || state.selectedShapes.size === 0)) {
                firstEl = { type: 'joint', id: [...state.selectedJoints][0] };
            } else if (state.selectedShapes && state.selectedShapes.size === 1 && (!state.selectedJoints || state.selectedJoints.size === 0)) {
                firstEl = { type: 'shape', id: [...state.selectedShapes][0] };
            }

            if (toolName === TOOL_MODES.HORIZONTAL_VERTICAL && firstEl && firstEl.type === 'shape') {
                const s = state.shapes.find(x => x.id === firstEl.id);
                if (s && s.type === 'line') {
                    ConstraintManager.addHorizontalOrVertical(state, s.joints);
                    // Keep the current tool active (do not switch to Select). User will exit the tool manually.
                    try { showNotification('Horizontal/Vertical constraint applied', 'success'); } catch(_) {}
                    return;
                }
            }

            const effectiveType = (toolName === TOOL_MODES.HORIZONTAL_VERTICAL) ? CONSTRAINT_TYPES.HORIZONTAL : toolName;
            state.pendingConstraint = { type: effectiveType, firstElement: firstEl };

            const mt = document.getElementById('modeText');
            if (mt) {
                let modeText = toolName.toUpperCase();
                if (toolName === TOOL_MODES.COLLINEAR) modeText += ' - 1/3 Points';
                else if (firstEl) modeText += ' - Select 2nd Element';
                else modeText += ' - Select 1st Element';
                mt.innerText = 'MODE: ' + modeText;
            }
        }
    } catch(_) {}
}

function handleDelete(state) {
    try {
        // Prefer centralized delete helpers which handle cascade cleanup and undo grouping
        deleteSelection(state);
    } catch (err) {
        console.error('[handleDelete] delete helpers failed', err);
    }
}

function handleEscape(state) {
    // If a dimension placement is in progress, cancel it and remove the temporary constraint
    try {
        if (state.placingConstraint) {
            try { const idx = state.constraints.indexOf(state.placingConstraint); if (idx !== -1) state.constraints.splice(idx, 1); } catch(_){}
            try { state.placingConstraint.__placing = false; } catch(_){}
            state.placingConstraint = null;
            try { resetDimensionState(state); } catch(_){ try{ import('./input-handlers/dimension-tool.js').then(m => m.resetDimensionState(state)); }catch(_){ } }
        }
    } catch(_) {}

    // 1. Clear selection sets
    if (state.selectedJoints) state.selectedJoints.clear();
    if (state.selectedConstraints) state.selectedConstraints.clear();
    if (state.selectedShapes) state.selectedShapes.clear();

    // 2. Ensure tool-specific cleanup runs (line tool and drawing state)
    try{ if(state.currentTool === TOOL_MODES.LINE) deactivateLineTool(state); }catch(_){ }
    try{ resetDrawingState(state); }catch(_){ }
    try{ resetSelectionState(); }catch(_){ }

    // 3. Clear transient interaction data
    try{ state.tempMousePos = null; }catch(_){ }
    try{ clearPreview(state); }catch(_){ }
    state.active = null; state.drag = null;

    // 4. RESET CONSTRAINT BUFFERS (Crucial for multi-click tools)
    try{ resetConstraintState(); }catch(_){ try{ import('./input-handlers/constraint-tools.js').then(m => m.resetConstraintState()); }catch(_){ state.selectionBuffer = []; } }

    // 5. Force UI to Select Mode
    try{ state.currentTool = TOOL_MODES.SELECT; }catch(_){ }

    // 6. Unified UI Update: Ensure all toolbar buttons are properly reset
    try {
        // Clear ALL possible active classes from ALL buttons
        document.querySelectorAll('.tool-btn, .tool-button, [class*="tool"]').forEach(btn => {
            btn.classList.remove('active', 'selected', 'bg-blue-500', 'text-white');
        });
        
        // Find and activate the select button
        const selectBtn = document.getElementById('tool-select') || 
                          document.querySelector('[data-tool="select"]') ||
                          document.querySelector('.tool-btn[data-tool="select"]');
        
        if (selectBtn) {
            // Click to trigger proper state management
            selectBtn.click();
            try { document.querySelectorAll('.tool-btn').forEach(b => { try{ b.blur(); }catch(_){ } }); } catch(_) {}
        } else {
            // Fallback if select button not found
            switchToTool(state, 'select');
        }
    } catch(err) {
        console.warn('ESC toolbar reset failed:', err);
        // Last resort: just set tool state
        try { state.currentTool = 'select'; } catch(_) {}
    }
}