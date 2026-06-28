// apps/sketchstudio/ui/numeric-input-manager.js
import { worldToScreen } from '#ui/coords.js';
import { showNotification } from '#ui/notification-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

let uiState = {
    active: false,
    mode: null, // 'live-single', 'live-dual', 'edit'
    target: null, // constraint object (for edit mode)
    field: null, // 'length', 'radius', 'width', 'height' (for live mode)
    
    // DOM Elements
    container: null,
    singleInput: null,
    dualContainer: null,
    dualInputW: null,
    dualInputH: null,
    
    // State
    rafId: null,
    svg: null,
    appState: null
};

export function setupNumericInput(svg, state) {
    // Guard for non-browser environments (Node tests)
    if (typeof document === 'undefined') {
        uiState.svg = svg;
        uiState.appState = state;
        return;
    }

    if (uiState.container) return; // Already setup
    uiState.svg = svg;
    uiState.appState = state;

    // --- 1. Create Single/Edit Input (Reuses #dimInput if present, or creates one) ---
    let existingSingle = (typeof document.getElementById === 'function') ? document.getElementById('dimInput') : null;
    if (!existingSingle) {
        if (typeof document.createElement === 'function') {
            existingSingle = document.createElement('input');
            existingSingle.id = 'dimInput';
            existingSingle.className = 'dim-input hidden';
            document.body.appendChild(existingSingle);
        } else {
            // Fallback fake element for non-DOM test shims
            existingSingle = { id: 'dimInput', classList: { add: () => {}, remove: () => {}, contains: () => false }, style: {}, value: '', focus: () => {}, select: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
        }
    }
    uiState.singleInput = existingSingle;

    // --- 2. Create Dual Input (for Rectangles) ---
    let dualDiv, inputW, sep, inputH;
    if (typeof document.createElement === 'function') {
        dualDiv = document.createElement('div');
        dualDiv.id = 'dualInput';
        dualDiv.style.cssText = `
            position: absolute; display: none; background: white; 
            border: 2px solid #3B82F6; border-radius: 6px; padding: 6px; 
            gap: 6px; align-items: center; z-index: 10000; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        inputW = document.createElement('input');
        inputW.placeholder = 'W';
        inputW.style.cssText = 'width: 60px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px; font-size: 12px;';
        
        sep = document.createElement('span');
        sep.innerText = '×';
        sep.style.cssText = 'color: #888; font-weight: bold;';
        
        inputH = document.createElement('input');
        inputH.placeholder = 'H';
        inputH.style.cssText = 'width: 60px; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px; font-size: 12px;';

        dualDiv.appendChild(inputW);
        dualDiv.appendChild(sep);
        dualDiv.appendChild(inputH);
        document.body.appendChild(dualDiv);
    } else {
        // Fallback fake elements
        dualDiv = { id: 'dualInput', style: { display: 'none', left: 0, top: 0 }, appendChild: () => {} };
        inputW = { placeholder: 'W', value: '', style: {}, focus: () => {}, select: () => {}, addEventListener: () => {} };
        sep = { innerText: '×', style: {} };
        inputH = { placeholder: 'H', value: '', style: {}, focus: () => {}, select: () => {}, addEventListener: () => {} };
    }

    uiState.dualContainer = dualDiv;
    uiState.dualInputW = inputW;
    uiState.dualInputH = inputH;

    // --- Event Listeners ---
    setupListeners();
}

function setupListeners() {
    // Single Input Handler
    uiState.singleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleCommit();
        if (e.key === 'Escape') handleCancel();
        e.stopPropagation(); // Prevent global shortcuts
    });
    
    uiState.singleInput.addEventListener('input', () => handlePreview());

    // Dual Input Handlers
    const handleDualKey = (e, field) => {
        if (e.key === 'Enter') handleCommit();
        if (e.key === 'Escape') handleCancel();
        if (e.key === 'Tab') {
            e.preventDefault();
            const next = field === 'width' ? uiState.dualInputH : uiState.dualInputW;
            next.focus();
            next.select();
        }
        e.stopPropagation();
    };

    uiState.dualInputW.addEventListener('keydown', (e) => handleDualKey(e, 'width'));
    uiState.dualInputH.addEventListener('keydown', (e) => handleDualKey(e, 'height'));
    
    uiState.dualInputW.addEventListener('input', () => handlePreview());
    uiState.dualInputH.addEventListener('input', () => handlePreview());
}

// --- Public API ---

export function showSingleInput(x, y, value, field, initialKey = null) {
    resetState();
    uiState.active = true;
    uiState.mode = 'live-single';
    uiState.field = field; // 'length', 'radius'

    // Position
    uiState.singleInput.style.left = `${x}px`;
    uiState.singleInput.style.top = `${y}px`;
    uiState.singleInput.style.transform = '';
    uiState.singleInput.classList.remove('hidden');
    
    // Value
    uiState.singleInput.value = initialKey || (typeof value === 'number' ? value.toFixed(1) : '');
    uiState.singleInput.focus();
    if (!initialKey) uiState.singleInput.select();
}

export function showDualInput(x, y, w, h) {
    resetState();
    uiState.active = true;
    uiState.mode = 'live-dual';

    uiState.dualContainer.style.left = `${x}px`;
    uiState.dualContainer.style.top = `${y}px`;
    uiState.dualContainer.style.display = 'flex';

    uiState.dualInputW.value = w.toFixed(1);
    uiState.dualInputH.value = h.toFixed(1);
    
    uiState.dualInputW.focus();
    uiState.dualInputW.select();
}

// Replaces showDimInput
export function showEditInput(svg, state, constraint, initialKey) {
    if (!constraint) return;

    // If target is driven or fully fixed endpoints, skip opening the editor and force driven.
    if (constraint.isDriven || constraint.driven) return;
    try {
        if (constraint.type === CONSTRAINT_TYPES.DISTANCE && constraint.joints && constraint.joints.length === 2 && state) {
            // Exclude the target constraint from the status check so the 'edit' validation
            // doesn't treat the constraint itself as already applied (prevents self-inflicted driven decision).
            const constraintsForStatus = (state.constraints || []).filter(c => c !== constraint);
            const status = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes || [], constraints: constraintsForStatus });
            const [a, b] = constraint.joints;
            const dofA = status.jointDOFs?.get(a);
            const dofB = status.jointDOFs?.get(b);
            const rigidA = status.fixedJoints.has(a) || (typeof dofA === 'number' && dofA <= 0);
            const rigidB = status.fixedJoints.has(b) || (typeof dofB === 'number' && dofB <= 0);
            if (rigidA && rigidB) {
                constraint.isDriven = true;
                constraint.driven = true;
                // Add joint status details for debugging
                const jointStatus = {
                    a,
                    b,
                    fixedJoints: Array.from(status.fixedJoints),
                    constrainedJoints: Array.from(status.constrainedJoints),
                    jointDOFs: Object.fromEntries(status.jointDOFs)
                };
                showNotification(
                    'Dimension added as Driven (geometry is fixed). [ERR-DRIVEN-02] Reason: Geometry is fixed during numeric input/edit, cannot drive.\nArgs: ' +
                    JSON.stringify({ constraint, jointStatus }),
                    'info'
                );
                return;
            }
        }
    } catch(_) { /* fail open */ }

    resetState();
    uiState.active = true;
    uiState.mode = 'edit';
    uiState.target = constraint;
    uiState.appState = state;
    uiState.svg = svg;

    // Mark constraint as editing to hide the SVG label
    constraint.__editing = true;

    // Calculate screen position from world glyphPos
    let pos = { x: 0, y: 0 };
    if (constraint.glyphPos) {
        const gp = Array.isArray(constraint.glyphPos) ? constraint.glyphPos[0] : constraint.glyphPos;
        pos = worldToScreen(svg, gp);
    } else {
        const rect = svg.getBoundingClientRect();
        pos = { x: rect.width / 2, y: rect.height / 2 };
    }

    uiState.singleInput.style.left = `${pos.x}px`;
    uiState.singleInput.style.top = `${pos.y}px`;
    uiState.singleInput.style.transform = 'translate(-50%, -50%)';
    uiState.singleInput.classList.remove('hidden');

    let prefillValue = constraint.value;
    if (constraint.dimMode === 'horizontal' && constraint.joints && constraint.joints.length >= 2) {
        const ja = state.joints.get(constraint.joints[0]);
        const jb = state.joints.get(constraint.joints[1]);
        if (ja && jb) prefillValue = Math.abs(jb.x - ja.x);
    } else if (constraint.dimMode === 'vertical' && constraint.joints && constraint.joints.length >= 2) {
        const ja = state.joints.get(constraint.joints[0]);
        const jb = state.joints.get(constraint.joints[1]);
        if (ja && jb) prefillValue = Math.abs(jb.y - ja.y);
    }
    uiState.singleInput.value = (typeof initialKey === 'string') ? initialKey : (typeof prefillValue === 'number' ? prefillValue.toFixed(1) : '');

    requestAnimationFrame(() => {
        uiState.singleInput.focus();
        if (!initialKey) uiState.singleInput.select();
    });
    startTrackingLoop();
}

export function hideInput() {
    resetState();
}

export function isInputActive() {
    return uiState.active;
}

export function updateInputPosition(x, y) {
    if (!uiState.active) return;
    // Offset slightly so it doesn't cover the cursor
    const ox = x + 15;
    const oy = y + 15;

    if (uiState.mode === 'live-single') {
        uiState.singleInput.style.left = `${ox}px`;
        uiState.singleInput.style.top = `${oy}px`;
    } else if (uiState.mode === 'live-dual') {
        uiState.dualContainer.style.left = `${ox}px`;
        uiState.dualContainer.style.top = `${oy}px`;
    }
}

// --- Internals ---

function handleCommit() {
    if (!uiState.active) return;
    if (uiState.mode === 'edit' && uiState.target) {
        const val = parseFloat(uiState.singleInput.value);
        if (!isNaN(val)) {
            if (uiState.appState.saveState) uiState.appState.saveState();
            uiState.target.__placing = false;
            if (uiState.appState.placingConstraint === uiState.target) uiState.appState.placingConstraint = null;
            // Edit logic lives in the shared headless seam (so the harness drives the EXACT same code).
            // On a genuine over-constraint it refuses + reverts to the last valid shape; we just surface it.
            const { reverted, clash } = commitDimensionEdit(uiState.appState, uiState.target, val);
            if (reverted) {
                showNotification(
                    `Can't set to ${val}${clash ? ` — conflicts with ${clash}` : ''}. Reverted.`,
                    "warning"
                );
            }
        }
        uiState.target.__editing = false;
        hideInput();
    } else {
        // Dispatch event for Tool to handle
        const detail = { mode: uiState.mode === 'live-dual' ? 'dual' : 'single', confirmedBy: 'enter' };
        if (uiState.mode === 'live-dual') {
            detail.width = parseFloat(uiState.dualInputW.value);
            detail.height = parseFloat(uiState.dualInputH.value);
        } else {
            detail.field = uiState.field;
            detail.value = parseFloat(uiState.singleInput.value);
        }
        window.dispatchEvent(new CustomEvent('liveDimensionApplied', { detail }));
        hideInput();
    }
}

function handlePreview() {
    if (!uiState.active || uiState.mode === 'edit') return;
    
    const detail = { mode: uiState.mode === 'live-dual' ? 'dual' : 'single' };
    if (uiState.mode === 'live-dual') {
        const w = parseFloat(uiState.dualInputW.value);
        const h = parseFloat(uiState.dualInputH.value);
        if (!isNaN(w)) detail.width = w;
        if (!isNaN(h)) detail.height = h;
    } else {
        const v = parseFloat(uiState.singleInput.value);
        if (!isNaN(v)) {
            detail.field = uiState.field;
            detail.value = v;
        }
    }
    window.dispatchEvent(new CustomEvent('liveDimensionPreview', { detail }));
}

function handleCancel() {
    window.dispatchEvent(new CustomEvent('liveDimensionCancelled'));
    hideInput();
}

function resetState() {
    if (uiState.target) uiState.target.__editing = false;
    uiState.active = false;
    uiState.mode = null;
    uiState.target = null;
    uiState.field = null;
    
    if (uiState.singleInput) uiState.singleInput.classList.add('hidden');
    if (uiState.dualContainer) uiState.dualContainer.style.display = 'none';
    if (uiState.rafId) { cancelAnimationFrame(uiState.rafId); uiState.rafId = null; }
}

function startTrackingLoop() {
    if (uiState.rafId) cancelAnimationFrame(uiState.rafId);
    
    const loop = () => {
        if (uiState.active && uiState.mode === 'edit' && uiState.target && uiState.svg) {
            // Update position based on constraint
            let gp = uiState.target.glyphPos;
            if (Array.isArray(gp)) gp = gp[0];
            if (gp) {
                const s = worldToScreen(uiState.svg, gp);
                uiState.singleInput.style.left = `${s.x}px`;
                uiState.singleInput.style.top = `${s.y}px`;
            }
            uiState.rafId = requestAnimationFrame(loop);
        }
    };
    loop();
}

// Helpers for tool modules (backwards compat)
export function resetLockedDimensions() { }
