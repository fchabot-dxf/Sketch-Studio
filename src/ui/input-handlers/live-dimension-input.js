import { SolverConfig } from '../../core/solver-config.js';
// ═══════════════════════════════════════════════════════════════════════════════
// LIVE DIMENSION INPUT - Unified Numeric Input System
// ═══════════════════════════════════════════════════════════════════════════════

import { worldToScreen, getDist, projectPointOnLine, perpendicularDistance } from '../../core/geometry.js';
import { CONSTRAINT_TYPES } from '../../core/constants.js';
import { RECT_MODES } from '../../core/constants.js';
import { showNotification } from '../notification-manager.js';

let inputState = {
    active: false,
    mode: null, // 'live-single', 'live-dual', 'edit'
    target: null, // constraint object (for edit mode)
    inputs: {
        width: null,
        height: null,
        length: null,
        angle: null,
        single: null // Re-using single input for edit mode
    },
    locked: {
        width: null,
        height: null,
        length: null,
        angle: null
    },
    activeField: 'width', // 'width' or 'height'
    svg: null,
    state: null
};

export function setupLiveDimensionInput() {
    // Guard against headless document — we need at least createElement to do
    // anything useful. Treat missing getElementById as "no existing element"
    // (just create fresh) so test stubs that only provide createElement work.
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    const findById = typeof document.getElementById === 'function' ? (id) => document.getElementById(id) : () => null;

    // --- Current (refactored) inputs ---
    // Create input elements if they don't exist
    if (!findById('live-dim-width')) {
        const widthInput = document.createElement('input');
        widthInput.id = 'live-dim-width';
        widthInput.type = 'text';
        widthInput.className = 'dim-input hidden';
        widthInput.placeholder = 'W';
        widthInput.style.position = 'absolute';
        document.body.appendChild(widthInput);
        inputState.inputs.width = widthInput;

        const heightInput = document.createElement('input');
        heightInput.id = 'live-dim-height';
        heightInput.type = 'text';
        heightInput.className = 'dim-input hidden';
        heightInput.placeholder = 'H';
        heightInput.style.position = 'absolute';
        document.body.appendChild(heightInput);
        inputState.inputs.height = heightInput;

        const lengthInput = document.createElement('input');
        lengthInput.id = 'live-dim-length';
        lengthInput.type = 'text';
        lengthInput.className = 'dim-input hidden';
        lengthInput.placeholder = 'L';
        lengthInput.style.position = 'absolute';
        document.body.appendChild(lengthInput);
        inputState.inputs.length = lengthInput;

        const angleInput = document.createElement('input');
        angleInput.id = 'live-dim-angle';
        angleInput.type = 'text';
        angleInput.className = 'dim-input hidden';
        angleInput.placeholder = '°';
        angleInput.style.position = 'absolute';
        document.body.appendChild(angleInput);
        inputState.inputs.angle = angleInput;

        // Reuse or create single input for editing
        let singleInput = findById('dimInput');
        if (!singleInput) {
            singleInput = document.createElement('input');
            singleInput.id = 'dimInput';
            singleInput.className = 'dim-input hidden';
            document.body.appendChild(singleInput);
        }
        inputState.inputs.single = singleInput;

        // Attach events
        [widthInput, heightInput, lengthInput, angleInput, singleInput].forEach(input => {
            input.addEventListener('keydown', (e) => handleInputKey(e, input));
            input.addEventListener('input', (e) => handleInputInput(e, input));
            input.addEventListener('focus', (e) => {
                if (input.id === 'live-dim-width') inputState.activeField = 'width';
                else if (input.id === 'live-dim-height') inputState.activeField = 'height';
                else if (input.id === 'live-dim-length') inputState.activeField = 'length';
                else if (input.id === 'live-dim-angle') inputState.activeField = 'angle';
            });
        });
    } else {
        inputState.inputs.width = findById('live-dim-width');
        inputState.inputs.height = findById('live-dim-height');
        inputState.inputs.length = findById('live-dim-length');
        inputState.inputs.angle = findById('live-dim-angle');
        inputState.inputs.single = findById('dimInput');
    }

    // --- Legacy compatibility: create older single-input IDs and showSingleInput API ---
    // Some tests and legacy code expect `liveDimSingleInput` / `liveDimSingle` and
    // a `showSingleInput` helper exported from this module. Provide a lightweight
    // compatibility layer that mirrors the previous behavior and dispatches the
    // `liveDimensionApplied` event on commit (Enter or blur), while ensuring
    // Enter suppresses the subsequent blur-apply to avoid double dispatch.
    if (!findById('liveDimSingleInput')) {
        const legacyContainer = document.createElement('div');
        legacyContainer.id = 'liveDimSingleInput';
        legacyContainer.style.display = 'none';
        document.body.appendChild(legacyContainer);

        const legacyInput = document.createElement('input');
        legacyInput.id = 'liveDimSingle';
        legacyInput.type = 'text';
        legacyContainer.appendChild(legacyInput);

        // Legacy state to coordinate Enter vs blur
        let _entered = false;
        let _blurTimer = null;

        legacyInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                try { ev.preventDefault(); } catch(_) {}
                _entered = true;
                if (_blurTimer) { clearTimeout(_blurTimer); _blurTimer = null; }
                window.dispatchEvent(new CustomEvent('liveDimensionApplied', { detail: { mode: 'single', field: 'length', value: parseFloat(legacyInput.value), confirmedBy: 'enter' } }));
            }
        });

        legacyInput.addEventListener('blur', () => {
            if (_blurTimer) clearTimeout(_blurTimer);
            _blurTimer = setTimeout(() => {
                if (!_entered) {
                    window.dispatchEvent(new CustomEvent('liveDimensionApplied', { detail: { mode: 'single', field: 'length', value: parseFloat(legacyInput.value), confirmedBy: 'blur' } }));
                }
                _entered = false;
                _blurTimer = null;
            }, 100);
        });
    }
}

// Backwards-compatible showSingleInput for tests/legacy callers
export function showSingleInput(x, y, value, field, initialKey = null) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    setupLiveDimensionInput(); // ensure legacy DOM exists
    const el = document.getElementById('liveDimSingle');
    const container = document.getElementById('liveDimSingleInput');
    if (!el || !container) return;
    container.style.display = '';
    container.style.position = 'absolute';
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    el.value = (typeof initialKey === 'string') ? initialKey : (typeof value === 'number' ? value.toFixed(1) : '');
    try { el.focus && el.focus(); } catch(_) {}
}

/**
 * Unified logic to validate a dimension proposal using a Sandbox Solve.
 * Returns { success: boolean, isDriven: boolean }
 */
function validateWithSandbox(state, config) {
    if (!state || !state.engine) return { success: true, isDriven: false };

    // 1. Snapshot positions
    const savedPositions = new Map();
    for (const [id, j] of state.joints) savedPositions.set(id, { x: j.x, y: j.y });

    // 2. Setup Test Scenario
    // If Editing: modify the existing constraint temporarily
    // If Creating: add a temporary constraint
    let testConstraint = null;
    let originalValue = null;
    let originalDriven = null;

    if (config.mode === 'edit') {
        testConstraint = config.constraint;
        originalValue = testConstraint.value;
        originalDriven = testConstraint.isDriven;
        testConstraint.value = config.value;
        testConstraint.isDriven = false; // Force drive
    } else {
        // Creating (Line/Rect) - Check if we are snapped to valid geometry
        const snap = state.activeSnap || state.snapTarget;
        if (!snap || !snap.isLocked || snap.type !== 'joint') {
            return { success: true, isDriven: false }; // No constraints to conflict with
        }
        testConstraint = {
            type: CONSTRAINT_TYPES.DISTANCE,
            joints: [state.active.start, snap.targetId],
            value: config.value,
            __temp: true
        };
        state.constraints.push(testConstraint);
    }

    // 3. Run Solver
    state.engine.solve(SolverConfig.ITERATIONS || 500);

    // 4. Measure Error
    let error = 0;
    if (config.mode === 'edit') {
        // Evaluate error based on constraint type
        const c = testConstraint;
        const target = config.value;
        
        if (c.isRadius && c.shape) {
            // Radius check
            const s = state.shapes.find(sh => sh.id === c.shape);
            if (s && s.joints && s.joints.length > 0) {
                const center = state.joints.get(s.joints[0]);
                // If shape has a radius property (circle), check it. Or check distance to rim.
                if (typeof s.radius === 'number') {
                    error = Math.abs(s.radius - target);
                } else if (s.joints.length >= 2) {
                    const rim = state.joints.get(s.joints[1]);
                    if (center && rim) error = Math.abs(getDist(center, rim) - target);
                }
            }
        } else if (c.shapes && c.shapes.length === 2) {
            // Line-Line Distance
            const s1 = state.shapes.find(sh => sh.id === c.shapes[0]);
            const s2 = state.shapes.find(sh => sh.id === c.shapes[1]);
            if (s1 && s2 && s1.type === 'line' && s2.type === 'line') {
                const j1 = state.joints.get(s1.joints[0]);
                const j2 = state.joints.get(s1.joints[1]);
                const p1 = state.joints.get(s2.joints[0]);
                const p2 = state.joints.get(s2.joints[1]);
                if (j1 && j2 && p1 && p2) {
                    const d = perpendicularDistance(j1, p1, p2); // Approx check
                    error = Math.abs(Math.abs(d) - target);
                }
            }
        } else if (c.joints && c.joints.length === 2) {
            // Point-Point Distance
            const j1 = state.joints.get(c.joints[0]);
            const j2 = state.joints.get(c.joints[1]);
            if (j1 && j2) {
                let d = getDist(j1, j2);
                if (c.dimMode === 'horizontal') d = Math.abs(j2.x - j1.x);
                else if (c.dimMode === 'vertical') d = Math.abs(j2.y - j1.y);
                error = Math.abs(d - target);
            }
        }
        
        // Restore constraint props
        testConstraint.value = originalValue;
        testConstraint.isDriven = originalDriven;
    } else {
        // For new constraint (Line creation), simple distance check
        const startJ = state.joints.get(state.active.start);
        const endJ = state.joints.get(state.activeSnap.targetId || state.activeSnap.id);
        const dist = getDist(startJ, endJ);
        error = Math.abs(dist - config.value);
        state.constraints.pop();
    }

    // 5. Restore Geometry
    for (const [id, pos] of savedPositions) {
        const j = state.joints.get(id);
        if (j) { j.x = pos.x; j.y = pos.y; }
    }

    // 6. Verdict
    // Stricter threshold (0.1) to catch subtle distortions
    if (error > 0.1) {
        return { success: false, isDriven: true };
    }
    return { success: true, isDriven: false };
}

/**
 * Unified Commit Processor
 * Handles validation, driving logic, and application for both Edit and Create modes.
 */
function processCommit(detail) {
    const state = inputState.state;
    
    // 1. Prepare Validation Config
    let valConfig = { 
        mode: inputState.mode, 
        value: detail.value || detail.length // Primary dimension to check
    };
    if (inputState.mode === 'edit') {
        valConfig.constraint = inputState.target;
    }

    // 2. Validate
    const result = validateWithSandbox(state, valConfig);

    // 3. Handle Failure/Driven
    if (result.isDriven) {
        showNotification(
            "Sketch is over-constrained. Dimension added as Driven. [ERR-OVERCON-01] Reason: Over-constrained system.\nArgs: " +
            JSON.stringify({ result, valConfig }),
            "info"
        );
        detail.isDriven = true;
    }

    // 4. Apply Changes
    if (inputState.mode === 'edit' && inputState.target) {
        // --- EDIT MODE ---
        const val = parseFloat(detail.value);
        if (!isNaN(val)) {
            if (state.saveState) state.saveState();
            inputState.target.value = val;
            inputState.target.isDriven = !!detail.isDriven;
            inputState.target.__placing = false;
            
            // Clear placing flag if this was a new constraint
            if (state.placingConstraint === inputState.target) state.placingConstraint = null;
            
            // Solve immediately to update geometry
            if (state.engine) state.engine.solve(SolverConfig.ITERATIONS || 500);
        }
        inputState.target.__editing = false;
    } else {
        // --- CREATE MODE ---
        // Dispatch event with isDriven flag
        if (detail.width !== undefined || detail.height !== undefined) {
            window.dispatchEvent(new CustomEvent('live-rect-commit', { detail }));
        } else {
            window.dispatchEvent(new CustomEvent('live-line-commit', { detail }));
        }
    }

    // 5. Cleanup UI
    if (inputState.mode === 'edit') {
        hideLiveInputs();
    } else {
        dismissLiveInputUI();
    }
}

function handleInputKey(e, input) {
    if (e.key === 'Tab') {
        e.preventDefault();
        // Cycle focus logic
        let next;
        if (input.id === 'live-dim-width' || input.id === 'live-dim-height') {
            next = input.id === 'live-dim-width' ? inputState.inputs.height : inputState.inputs.width;
        } else {
            next = input.id === 'live-dim-length' ? inputState.inputs.angle : inputState.inputs.length;
        }
        next.classList.remove('hidden');
        next.focus();
        setTimeout(() => next.select(), 0);
        
    } else if (e.key === 'Enter') {
        e.preventDefault();
        
        // Gather data based on context
        let detail = {};
        
        if (inputState.mode === 'edit') {
            detail.value = parseFloat(input.value);
        } else {
            // Live Drawing: gather locked values
            if (inputState.locked.length !== null) detail.length = inputState.locked.length;
            if (inputState.locked.angle !== null) detail.angle = inputState.locked.angle;
            if (inputState.locked.width !== null) detail.width = inputState.locked.width;
            if (inputState.locked.height !== null) detail.height = inputState.locked.height;
        }

        // Delegate to unified processor
        processCommit(detail);

    } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        hideLiveInputs();
    }
    e.stopPropagation(); 
}

function handleInputInput(e, input) {
    if (inputState.mode === 'edit') return; // Don't track locked values for edit mode

    const val = parseFloat(input.value);
    let field;
    if (input.id === 'live-dim-width') field = 'width';
    else if (input.id === 'live-dim-height') field = 'height';
    else if (input.id === 'live-dim-length') field = 'length';
    else if (input.id === 'live-dim-angle') field = 'angle';

    if (!isNaN(val)) {
        inputState.locked[field] = val;
    } else {
        inputState.locked[field] = null;
    }
    if (inputState.svg && inputState.state) {
        if (field === 'width' || field === 'height') {
            updateLiveRectPreview(inputState.svg, inputState.state);
        } else {
            updateLiveLinePreview(inputState.svg, inputState.state);
        }
    }
}

// Re-export showEditInput to replace numeric-input-manager's version
export function showEditInput(svg, state, constraint, initialKey) {
    if (!constraint) return;
    inputState.active = true;
    inputState.mode = 'edit';
    inputState.target = constraint;
    inputState.state = state;
    inputState.svg = svg;

    constraint.__editing = true;

    // Position Input
    let pos = { x: 0, y: 0 };
    if (constraint.glyphPos) {
        const gp = Array.isArray(constraint.glyphPos) ? constraint.glyphPos[0] : constraint.glyphPos;
        pos = worldToScreen(svg, gp);
    } else {
        const rect = svg.getBoundingClientRect();
        pos = { x: rect.width / 2, y: rect.height / 2 };
    }

    const input = inputState.inputs.single;
    input.style.left = `${pos.x}px`;
    input.style.top = `${pos.y}px`;
    input.style.transform = 'translate(-50%, -50%)';
    input.classList.remove('hidden');

    let prefillValue = constraint.value;
    // Calculate current projected value for H/V dimensions
    if (constraint.dimMode === 'horizontal' && constraint.joints && constraint.joints.length >= 2) {
        const ja = state.joints.get(constraint.joints[0]);
        const jb = state.joints.get(constraint.joints[1]);
        if (ja && jb) prefillValue = Math.abs(jb.x - ja.x);
    } else if (constraint.dimMode === 'vertical' && constraint.joints && constraint.joints.length >= 2) {
        const ja = state.joints.get(constraint.joints[0]);
        const jb = state.joints.get(constraint.joints[1]);
        if (ja && jb) prefillValue = Math.abs(jb.y - ja.y);
    }
    
    input.value = (typeof initialKey === 'string') ? initialKey : (typeof prefillValue === 'number' ? prefillValue.toFixed(1) : '');

    requestAnimationFrame(() => {
        input.focus();
        if (!initialKey) input.select();
    });
}

// Shared activation function
function activateLiveInput(key, state, primaryField, secondaryField, updateCallback) {
    if (inputState.active) return false;
    
    if (/^[0-9.]$/.test(key) && state.active && state.active.start) {
        inputState.active = true;
        inputState.activeField = primaryField;
        
        const primaryInput = inputState.inputs[primaryField];
        if (primaryInput) {
            primaryInput.classList.remove('hidden');
            primaryInput.focus();
            primaryInput.value = key;
            inputState.locked[primaryField] = parseFloat(key);
        }
        
        const secondaryInput = inputState.inputs[secondaryField];
        if (secondaryInput) {
            secondaryInput.classList.remove('hidden');
        }
        
        if (updateCallback) updateCallback();
        return true;
    }
    return false;
}

export function handleLiveRectKeyDown(e, svg, state) {
    const is3Point = state.rectMode === RECT_MODES.THREE_POINT;
    const isPhase2 = is3Point && state.active && state.active.secondPt;
    
    let primary = 'width';
    let secondary = 'height';
    
    if (isPhase2) {
        primary = 'height';
        secondary = null;
    } else if (is3Point && !isPhase2) {
        secondary = null;
    }
    
    const handled = activateLiveInput(e.key, state, primary, secondary, () => updateLiveRectPreview(svg, state));
    if (handled) { e.preventDefault(); return true; }
    return false;
}

export function handleLiveLineKeyDown(e, svg, state) {
    const handled = activateLiveInput(e.key, state, 'length', 'angle', () => updateLiveLinePreview(svg, state));
    if (handled) { e.preventDefault(); return true; }
    return false;
}

// ... (Rest of existing Preview Logic remains unchanged: updateLiveRectPreview, etc.) ...
// Note: To keep the file valid, I'm ensuring the preview functions are retained below.

export function updateLiveRectPreview(svg, state) {
    inputState.svg = svg;
    inputState.state = state;
    if (!state.active || !state.active.start) {
        if (inputState.active || inputState.locked.width !== null) hideLiveInputs();
        return;
    }
    let c1 = state.active.startPt;
    if (!c1 && state.active.start) {
        c1 = (typeof state.active.start === 'string') ? state.joints.get(state.active.start) : state.active.start;
    }
    if (!c1) return;
    let mousePt = state.snapTarget ? state.snapTarget.pt : state.tempMousePos;
    if (!mousePt && state.lastMouse) {
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const px = state.lastMouse.x - rect.left;
        const py = state.lastMouse.y - rect.top;
        mousePt = {
            x: vb.x + (px / rect.width) * vb.width,
            y: vb.y + (py / rect.height) * vb.height
        };
    }
    if (!mousePt) mousePt = { x: c1.x + 10, y: c1.y + 10 };
    let dx = mousePt.x - c1.x;
    let dy = mousePt.y - c1.y;
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    if (state.rectMode === RECT_MODES.THREE_POINT) {
        update3PointPreview(svg, state, c1, mousePt);
        return;
    }
    const isCenter = state.rectMode === RECT_MODES.CENTER;
    let w = isCenter ? Math.abs(dx) * 2 : Math.abs(dx);
    let h = isCenter ? Math.abs(dy) * 2 : Math.abs(dy);
    if (inputState.locked.width !== null) w = inputState.locked.width;
    if (inputState.locked.height !== null) h = inputState.locked.height;
    const offsetX = isCenter ? w / 2 : w;
    const offsetY = isCenter ? h / 2 : h;
    const c2 = {
        x: c1.x + offsetX * signX,
        y: c1.y + offsetY * signY
    };
    state.active.preview = { type: isCenter ? 'rect-center' : 'rect', pt: c2 };
    state.tempMousePos = c2;
    if (inputState.active && inputState.inputs.width && inputState.inputs.height) {
        const p1 = isCenter ? { x: c1.x - offsetX * signX, y: c1.y - offsetY * signY } : c1;
        const p2 = c2;
        const minX = Math.min(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const wWorld = Math.abs(p2.x - p1.x);
        const worldPosW = { x: minX + wWorld / 2, y: minY };
        const scrW = worldToScreen(svg, worldPosW);
        const worldPosH = { x: minX, y: minY + Math.abs(p2.y - p1.y) / 2 };
        const scrH = worldToScreen(svg, worldPosH);
        const widthEl = inputState.inputs.width;
        widthEl.style.left = `${scrW.x - widthEl.offsetWidth / 2}px`;
        widthEl.style.top = `${scrW.y - widthEl.offsetHeight - 15}px`;
        const heightEl = inputState.inputs.height;
        heightEl.style.left = `${scrH.x - heightEl.offsetWidth - 15}px`;
        heightEl.style.top = `${scrH.y - heightEl.offsetHeight / 2}px`;
        if (document.activeElement !== widthEl && inputState.locked.width === null) {
            widthEl.value = w.toFixed(1);
        }
        if (document.activeElement !== heightEl && inputState.locked.height === null) {
            heightEl.value = h.toFixed(1);
        }
    }
}

function update3PointPreview(svg, state, c1, mousePt) {
    const hasSecondPt = !!state.active.secondPt;
    if (!hasSecondPt) {
        let dx = mousePt.x - c1.x;
        let dy = mousePt.y - c1.y;
        let len = Math.hypot(dx, dy);
        if (inputState.locked.width !== null) len = inputState.locked.width;
        const angle = Math.atan2(dy, dx);
        const c2 = {
            x: c1.x + Math.cos(angle) * len,
            y: c1.y + Math.sin(angle) * len
        };
        state.active.preview = { type: 'line', pt: c2 };
        state.tempMousePos = c2;
        if (inputState.active && inputState.inputs.width) {
            const mid = { x: (c1.x + c2.x)/2, y: (c1.y + c2.y)/2 };
            const scr = worldToScreen(svg, mid);
            const el = inputState.inputs.width;
            el.style.left = `${scr.x - el.offsetWidth/2}px`;
            el.style.top = `${scr.y - el.offsetHeight - 15}px`;
            if (document.activeElement !== el && inputState.locked.width === null) {
                el.value = len.toFixed(1);
            }
            if (inputState.inputs.height) inputState.inputs.height.classList.add('hidden');
        }
    } else {
        const c2 = state.joints.get(state.active.secondPt);
        if (!c2) return;
        const bdx = c2.x - c1.x;
        const bdy = c2.y - c1.y;
        const blen = Math.hypot(bdx, bdy);
        const nx = -bdy / blen;
        const ny = bdx / blen;
        const mdx = mousePt.x - c2.x;
        const mdy = mousePt.y - c2.y;
        let h = mdx * nx + mdy * ny;
        if (inputState.locked.height !== null) {
            const sign = h >= 0 ? 1 : -1;
            h = inputState.locked.height * sign;
        }
        const c3 = { x: c2.x + nx * h, y: c2.y + ny * h };
        state.active.preview = { type: 'rect-3pt', pt: c3 };
        state.tempMousePos = c3;
        if (inputState.active && inputState.inputs.height) {
            const mid = { x: (c2.x + c3.x)/2, y: (c2.y + c3.y)/2 };
            const scr = worldToScreen(svg, mid);
            const el = inputState.inputs.height;
            el.style.left = `${scr.x - el.offsetWidth/2}px`;
            el.style.top = `${scr.y - el.offsetHeight/2}px`;
            if (document.activeElement !== el && inputState.locked.height === null) {
                el.value = Math.abs(h).toFixed(1);
            }
            if (inputState.inputs.width) inputState.inputs.width.classList.add('hidden');
        }
    }
}

export function updateLiveLinePreview(svg, state) {
    inputState.svg = svg;
    inputState.state = state;
    if (!state.active || !state.active.start) {
        if (inputState.active) hideLiveInputs();
        return;
    }
    const startPt = state.active.startPt || state.joints.get(state.active.start);
    if (!startPt) return;
    let mousePt = state.snapTarget ? state.snapTarget.pt : state.tempMousePos;
    if (!mousePt && state.lastMouse) {
        mousePt = screenToWorld(svg, state.lastMouse.x, state.lastMouse.y);
    }
    if (!mousePt) mousePt = { x: startPt.x + 10, y: startPt.y };
    let dx = mousePt.x - startPt.x;
    let dy = mousePt.y - startPt.y;
    let len = Math.hypot(dx, dy);
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (inputState.locked.length !== null) len = inputState.locked.length;
    if (inputState.locked.angle !== null) angle = inputState.locked.angle;
    const rad = angle * Math.PI / 180;
    const endPt = {
        x: startPt.x + Math.cos(rad) * len,
        y: startPt.y + Math.sin(rad) * len
    };
    state.active.preview = { type: 'line', pt: endPt };
    state.tempMousePos = endPt;
    if (inputState.active && inputState.inputs.length && inputState.inputs.angle) {
        const mid = { x: (startPt.x + endPt.x) / 2, y: (startPt.y + endPt.y) / 2 };
        const scr = worldToScreen(svg, mid);
        const lEl = inputState.inputs.length;
        lEl.style.left = `${scr.x - lEl.offsetWidth / 2}px`;
        lEl.style.top = `${scr.y - lEl.offsetHeight - 20}px`;
        const aEl = inputState.inputs.angle;
        aEl.style.left = `${scr.x + 20}px`; 
        aEl.style.top = `${scr.y - aEl.offsetHeight / 2}px`;
        if (document.activeElement !== lEl && inputState.locked.length === null) {
            lEl.value = len.toFixed(1);
        }
        if (document.activeElement !== aEl && inputState.locked.angle === null) {
            aEl.value = angle.toFixed(1);
        }
    }
}

export function getLiveLockedPoint(state) {
    if (!state.active || !state.active.preview || !state.active.preview.pt) return null;
    if (inputState.locked.width !== null || inputState.locked.height !== null || inputState.locked.length !== null || inputState.locked.angle !== null) {
        return state.active.preview.pt;
    }
    return null;
}

function dismissLiveInputUI() {
    inputState.active = false;
    if (inputState.inputs.width) inputState.inputs.width.classList.add('hidden');
    if (inputState.inputs.height) inputState.inputs.height.classList.add('hidden');
    if (inputState.inputs.length) inputState.inputs.length.classList.add('hidden');
    if (inputState.inputs.angle) inputState.inputs.angle.classList.add('hidden');
    const svg = document.querySelector('svg');
    if (svg) svg.focus();
}

export function hideLiveInputs() {
    inputState.active = false;
    inputState.mode = null; // Clear mode
    inputState.locked.width = null;
    inputState.locked.height = null;
    inputState.locked.length = null;
    inputState.locked.angle = null;
    if (inputState.inputs.width) inputState.inputs.width.classList.add('hidden');
    if (inputState.inputs.height) inputState.inputs.height.classList.add('hidden');
    if (inputState.inputs.length) inputState.inputs.length.classList.add('hidden');
    if (inputState.inputs.angle) inputState.inputs.angle.classList.add('hidden');
    if (inputState.inputs.single) inputState.inputs.single.classList.add('hidden');
    const svg = document.querySelector('svg');
    if (svg) svg.focus();
}

export function applyLiveRectConstraints(state) {
    if (!inputState.locked.width && !inputState.locked.height) return;
    hideLiveInputs();
}