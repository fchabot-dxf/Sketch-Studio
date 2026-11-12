// packages/ui/numeric-input-manager.js — shared UI. Relocated VERBATIM from apps/sketchstudio/ui in slice S4b.
// TODO(shaper): parameterize the DOM reaches (document.getElementById('dimInput')/createElement/document.body)
// before Shaper adopts this — it currently builds its inputs straight into the SketchStudio document.
import { worldToScreen } from '#ui/coords.js';
import { showNotification } from '#ui/notification-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { commitDimensionEdit, dimensionEditLabel, isDimensionDetermined } from '#ui/dimension-seams.js';
import SettingsManager from '#core/settings-manager.js';
import { parse as parseUnit, format as formatUnit } from '#core/units.js';

// U2: the active document unit for LENGTH dimension display/parse. Defaults to 'mm' = the world base (1 unit = 1 mm),
// so a bare number round-trips byte-identically to the old parseFloat/toFixed(1) until the U3 toggle changes it.
const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';

export const NUMERIC_INPUT_STYLE_ID = 'sk-numeric-input-styles';

const NUMERIC_INPUT_CSS = `
.dim-input {
    position: absolute;
    box-sizing: border-box;
    background: white;
    color: #000000;
    border: 2px solid var(--fusion-orange, #EA580C);
    border-radius: 4px;
    padding: 2px 4px;
    font-weight: bold;
    font-size: 11px;
    outline: none;
    text-align: center;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
@media (max-width: 640px) {
    .dim-input {
        padding: 4px 6px;
        font-size: 14px;
        min-width: 70px;
        min-height: 36px;
        -webkit-appearance: none;
        appearance: none;
    }
    .dim-input::-webkit-outer-spin-button,
    .dim-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }
    .dim-input[type=number] {
        -moz-appearance: textfield;
        appearance: textfield;
    }
}
.dim-input.hidden { display: none; }
.sk-dual-input {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    background: white;
    color: #000000;
    border: 2px solid #3B82F6;
    border-radius: 6px;
    padding: 6px;
    gap: 6px;
    align-items: center;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.sk-dual-input.hidden { display: none; }
.sk-dual-input input {
    width: 60px;
    box-sizing: border-box;
    background: white;
    color: #000000;
    text-align: center;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 4px;
    font-size: 12px;
}
.sk-dual-input-sep {
    color: #888;
    font-weight: bold;
}
`;

export function ensureNumericInputStyles() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    if (!document.head || typeof document.head.appendChild !== 'function') return;
    if (typeof document.getElementById === 'function' && document.getElementById(NUMERIC_INPUT_STYLE_ID)) return;
    if (typeof document.head.querySelector === 'function' && document.head.querySelector(`#${NUMERIC_INPUT_STYLE_ID}`)) return;
    const s = document.createElement('style');
    s.id = NUMERIC_INPUT_STYLE_ID;
    s.textContent = NUMERIC_INPUT_CSS;
    document.head.appendChild(s);
}

export function hideNumericInputEl(el) {
    if (!el) return;
    el.classList.add('hidden');
}

export function showNumericInputEl(el) {
    if (!el) return;
    el.classList.remove('hidden');
}

// Inject shared numeric input styles immediately in browser environments so static/created .dim-input.hidden
// elements are hidden by #ui itself on first paint without relying on host CSS.
ensureNumericInputStyles();

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
    ensureNumericInputStyles();
    uiState.svg = svg;
    uiState.appState = state;

    // --- 1. Create Single/Edit Input (Reuses #dimInput if present, or creates one) ---
    let existingSingle = (typeof document.getElementById === 'function') ? document.getElementById('dimInput') : null;
    if (!existingSingle) {
        if (typeof document.createElement === 'function') {
            existingSingle = document.createElement('input');
            existingSingle.id = 'dimInput';
            existingSingle.className = 'dim-input hidden';
            hideNumericInputEl(existingSingle);
            document.body.appendChild(existingSingle);
        } else {
            // Fallback fake element for non-DOM test shims
            existingSingle = { id: 'dimInput', classList: { add: () => {}, remove: () => {}, contains: () => false }, style: { display: 'none' }, value: '', focus: () => {}, select: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
        }
    } else {
        hideNumericInputEl(existingSingle);
    }
    uiState.singleInput = existingSingle;

    // --- 2. Create Dual Input (for Rectangles) ---
    let dualDiv, inputW, sep, inputH;
    if (typeof document.createElement === 'function') {
        dualDiv = document.createElement('div');
        dualDiv.id = 'dualInput';
        dualDiv.className = 'sk-dual-input hidden';
        hideNumericInputEl(dualDiv);
        
        inputW = document.createElement('input');
        inputW.placeholder = 'W';
        
        sep = document.createElement('span');
        sep.innerText = '×';
        sep.className = 'sk-dual-input-sep';
        
        inputH = document.createElement('input');
        inputH.placeholder = 'H';

        dualDiv.appendChild(inputW);
        dualDiv.appendChild(sep);
        dualDiv.appendChild(inputH);
        document.body.appendChild(dualDiv);
    } else {
        // Fallback fake elements
        dualDiv = { id: 'dualInput', classList: { add: () => {}, remove: () => {}, contains: () => false }, style: { display: 'none', left: 0, top: 0 }, appendChild: () => {} };
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
    showNumericInputEl(uiState.singleInput);
    
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
    showNumericInputEl(uiState.dualContainer);

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
    // A dimension on a quantity the sketch already determines is placed DRIVEN (a measurement) and is never typed.
    if (isDimensionDetermined(state, constraint)) {
        constraint.isDriven = true;
        constraint.driven = true;
        showNotification(
            'Dimension added as Driven (already determined by existing constraints). [ERR-DRIVEN-02]',
            'info'
        );
        return;
    }

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
    showNumericInputEl(uiState.singleInput);

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
    // U2: LENGTH dims format through the document unit; ANGLE dims stay in degrees (raw toFixed). docUnit defaults
    // 'mm' (= the world base), so for a LENGTH dim formatUnit(v,'mm') === v.toFixed(1) — byte-identical to before.
    const isAngleDim = constraint.type === CONSTRAINT_TYPES.ANGLE;
    uiState.singleInput.value = (typeof initialKey === 'string') ? initialKey
        : (typeof prefillValue === 'number'
            ? (isAngleDim ? prefillValue.toFixed(1) : formatUnit(prefillValue, getDocUnit()))
            : '');

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
        // U2: LENGTH dims parse through the document unit (a suffix like '0.25in' overrides; a bare number = docUnit,
        // default 'mm' = the world base); ANGLE dims parse raw degrees. parseUnit returns null on invalid → the
        // (val != null && !isNaN) guard rejects it exactly as NaN did, and stays byte-identical for the angle path.
        const isAngleDim = uiState.target.type === CONSTRAINT_TYPES.ANGLE;
        const val = isAngleDim ? parseFloat(uiState.singleInput.value) : parseUnit(uiState.singleInput.value, getDocUnit());
        if (val != null && !isNaN(val)) {
            const isFirstValue = uiState.target.__newlyPlaced === true;
            uiState.target.isDriven = false;
            uiState.target.driven = false;
            uiState.target.__newlyPlaced = false;
            if (!isFirstValue && uiState.appState.saveState) uiState.appState.saveState(dimensionEditLabel(uiState.target, val));
            uiState.target.__placing = false;
            if (uiState.appState.placingConstraint === uiState.target) uiState.appState.placingConstraint = null;
            // Edit logic lives in the shared headless seam (so the harness drives the EXACT same code).
            // On a genuine over-constraint it refuses + reverts to the last valid shape; we just surface it.
            const { reverted, clash, reason } = commitDimensionEdit(uiState.appState, uiState.target, val);
            if (reverted) {
                showNotification(
                    `Can't set to ${val}${reason ? ` — ${reason}` : clash ? ` — conflicts with ${clash}` : ''}. Reverted.`,
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
    if (uiState.mode === 'edit' && uiState.target && uiState.target.__newlyPlaced) {
        if (uiState.target.__newlyPlaced === true && typeof uiState.target.__birthHistoryLength === 'number' && uiState.appState && uiState.appState.discardSnapshotAt) {
            uiState.appState.discardSnapshotAt(uiState.target.__birthHistoryLength);
        }
        const state = uiState.appState;
        if (state && Array.isArray(state.constraints)) {
            const idx = state.constraints.indexOf(uiState.target);
            if (idx !== -1) state.constraints.splice(idx, 1);
        }
        uiState.target.__placing = false;
        if (state && state.placingConstraint === uiState.target) state.placingConstraint = null;
    }
    window.dispatchEvent(new CustomEvent('liveDimensionCancelled'));
    hideInput();
}

function resetState() {
    if (uiState.target) uiState.target.__editing = false;
    uiState.active = false;
    uiState.mode = null;
    uiState.target = null;
    uiState.field = null;
    
    if (uiState.singleInput) {
        if (uiState.singleInput.style) uiState.singleInput.style.transform = '';
        hideNumericInputEl(uiState.singleInput);
    }
    if (uiState.dualContainer) hideNumericInputEl(uiState.dualContainer);
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
