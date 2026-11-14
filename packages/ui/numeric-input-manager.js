// packages/ui/numeric-input-manager.js — shared UI. Relocated VERBATIM from apps/sketchstudio/ui in slice S4b.
// TODO(shaper): parameterize the DOM reaches (document.getElementById('dimInput')/createElement/document.body)
// before Shaper adopts this — it currently builds its inputs straight into the SketchStudio document.
import { worldToScreen } from '#ui/coords.js';
import { showNotification } from '#ui/notification-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { applyParameterChange, dimensionEditLabel, isDimensionDetermined } from '#ui/dimension-seams.js';
import SettingsManager from '#core/settings-manager.js';
import { format as formatUnit } from '#core/units.js';
import { previewDimensionInput } from '#core/parameters.js';
import { createParameterCompletion } from '#ui/parameter-completion.js';

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
/* TASK 535: the live hint under the dimension box and the autocomplete list (both are children of the box's own parent, placed by JS) */
.dim-hint {
    position: absolute;
    box-sizing: border-box;
    z-index: 101;
    max-width: min(360px, calc(100vw - 16px));
    padding: 3px 8px;
    border-radius: 4px;
    font: 11px/1.35 system-ui, sans-serif;
    background: #1f2937;
    color: #f9fafb;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    pointer-events: none;
    overflow-wrap: anywhere;
}
.dim-hint.err { background: #7f1d1d; color: #fee2e2; }
.dim-complete {
    position: absolute;
    box-sizing: border-box;
    z-index: 102;
    min-width: 150px;
    max-width: min(320px, calc(100vw - 16px));
    margin: 0;
    padding: 2px 0;
    list-style: none;
    background: white;
    color: #000000;
    border: 1px solid var(--fusion-orange, #EA580C);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    font: 12px system-ui, sans-serif;
    overflow: hidden;
}
.dim-complete li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.dim-complete li[aria-selected="true"] { background: var(--fusion-orange, #EA580C); color: #ffffff; }
.dim-complete .dc-name { font-weight: 700; }
.dim-complete .dc-val { opacity: 0.8; font-variant-numeric: tabular-nums; }
.dim-hint.hidden, .dim-complete.hidden { display: none; }
@media (max-width: 640px) {
    .dim-hint { font-size: 12px; }
    .dim-complete li { min-height: 34px; align-items: center; font-size: 14px; }
}
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
/* TASK 597: a creation box beside the mouse cursor lets the pointer through (it sits 15 px from the cursor, and a quick move toward it landed ON the box, so the click never reached the canvas); typing goes to the focused field, Tab switches. A finger taps the box to focus it. */
@media (pointer: fine) {
    .sk-live-box { pointer-events: none; }
}
/* TASK 596: a finger. The two-field box (rect W x H, polygon size x sides) has fields >= 44 px tall and a 16 px font (no iOS zoom). A mouse keeps today's look. */
@media (pointer: coarse) {
    .sk-dual-input input { width: 72px; min-height: 44px; font-size: 16px; }
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
    singleInput: null,
    dualContainer: null,
    dualInputW: null,
    dualInputH: null,
    dualSep: null,
    dualKind: null, // TASK 596: who opened the box ('polygon': size x sides); null = the rect tool's W x H. Rides on every live event as detail.kind
    dualDigits: [1, 1], // decimals each field shows when the box opens
    typed: [false, false], // TASK 596: which field the user has typed in (a field showing the live value is NOT typed; only a typed one locks a size)
    
    // State
    rafId: null,
    svg: null,
    appState: null,

    // TASK 535: the hint line and the autocomplete list under the dimension box (null where the host has no real DOM)
    hintEl: null,
    listEl: null,
    completion: null // the shared parameter-name completion (#ui/parameter-completion.js) over listEl
};

export function setupNumericInput(svg, state) {
    // Guard for non-browser environments (Node tests)
    if (typeof document === 'undefined') {
        uiState.svg = svg;
        uiState.appState = state;
        return;
    }

    uiState.svg = svg;
    uiState.appState = state;   // always the latest page / state; the elements and their listeners are made ONCE per document
    if (uiState.dualContainer && uiState.dualContainer.isConnected) return; // TASK 596: already set up in THIS document (the old `uiState.container` guard was never assigned, so every tool's setup built another hidden #dualInput)
    ensureNumericInputStyles();

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
    createAssistElements(existingSingle);

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
    uiState.dualSep = sep;

    // --- Event Listeners ---
    setupListeners();
}

function setupListeners() {
    // Single Input Handler
    uiState.singleInput.addEventListener('keydown', (e) => {
        // TASK 535 autocomplete: while the list is open Up / Down move, Enter / Tab insert, Esc closes the list (a second Esc is the box's own Esc)
        if (uiState.mode === 'edit' && uiState.completion && uiState.completion.handleKey(e)) {
            e.stopImmediatePropagation(); return;
        }
        if (e.key === 'Enter') handleCommit();
        if (e.key === 'Escape' || drawUndoKey(e)) handleCancel();
        e.stopPropagation(); // Prevent global shortcuts
    });
    
    uiState.singleInput.addEventListener('input', () => { uiState.typed[0] = true; handlePreview(); updateAssist(); });

    // Dual Input Handlers
    const handleDualKey = (e, field) => {
        if (e.key === 'Enter') handleCommit();
        if (e.key === 'Escape' || drawUndoKey(e)) handleCancel();
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
    
    uiState.dualInputW.addEventListener('input', () => { uiState.typed[0] = true; handlePreview(); });
    uiState.dualInputH.addEventListener('input', () => { uiState.typed[1] = true; handlePreview(); });
}

/** TASK 597: Ctrl/Cmd+Z in a box of a drawing tool (not the dimension edit box) is the canvas's own Ctrl+Z mid-draw: it ends the draw like Esc (task 549). */
function drawUndoKey(e) {
    return (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && uiState.mode !== 'edit';
}

// --- Public API ---

export function showSingleInput(x, y, value, field, initialKey = null, focus = true) {
    if (!uiState.singleInput) return;   // a host with no DOM (the headless node tests that drive a tool's handlers bare) has no boxes: the tool runs as it does with one
    resetState();
    uiState.active = true;
    uiState.mode = 'live-single';
    uiState.field = field; // 'length', 'radius'
    uiState.typed = [!!initialKey, false];

    // Position
    uiState.singleInput.style.transform = '';
    uiState.singleInput.classList.add('sk-live-box');
    showNumericInputEl(uiState.singleInput);
    placeLiveBox(uiState.singleInput, x, y);
    
    // Value. O15: a number being typed WHILE DRAWING stays a plain number, so a phone shows the decimal keypad here (the dimension EDIT box below is text)
    uiState.singleInput.inputMode = 'decimal';
    uiState.singleInput.value = initialKey || (typeof value === 'number' ? value.toFixed(1) : '');
    if (focus) {   // TASK 597: a touch opens the box WITHOUT focus (no phone keyboard on every click); tapping the box focuses it
        uiState.singleInput.focus();
        if (!initialKey) uiState.singleInput.select();
    }
}

/**
 * The two-field on-canvas box. The rect tool opens it as W x H; TASK 596: the polygon tool as size x sides through `opts`
 * ({ kind, labels: [first, second], separator, digits: [first, second] }), the same element, keys and events, so Tab, Enter, Esc are ONE code path.
 */
export function showDualInput(x, y, w, h, opts = {}) {
    if (!uiState.dualContainer) return;   // no DOM, no boxes (see showSingleInput)
    resetState();
    uiState.active = true;
    uiState.mode = 'live-dual';
    uiState.dualKind = opts.kind || null;
    uiState.typed = [false, false];
    uiState.dualDigits = opts.digits || [1, 1];
    const labels = opts.labels || ['W', 'H'];
    uiState.dualInputW.placeholder = labels[0];
    uiState.dualInputH.placeholder = labels[1];
    uiState.dualSep.innerText = opts.separator || '×';

    uiState.dualContainer.classList.add('sk-live-box');
    showNumericInputEl(uiState.dualContainer);
    placeLiveBox(uiState.dualContainer, x, y);

    uiState.dualInputW.value = w.toFixed(uiState.dualDigits[0]);
    uiState.dualInputH.value = h.toFixed(uiState.dualDigits[1]);
    
    if (opts.focus !== false) {
        uiState.dualInputW.focus();
        uiState.dualInputW.select();
    }
    if (opts.initialKey) {   // the digit that opened the box is the first character of the first field, never lost
        uiState.dualInputW.value = opts.initialKey;
        uiState.typed[0] = true;
        handlePreview();
    }
}

/**
 * TASK 596: show the live value of field `index` (0 = first) in the open creation box (the size follows the cursor). A field the user has
 * typed in keeps its text; the one with focus stays selected so the next typed character replaces the live value.
 */
export function setLiveInputValue(index, value) {
    if (!uiState.active || (uiState.mode !== 'live-dual' && uiState.mode !== 'live-single') || uiState.typed[index]) return;
    const el = uiState.mode === 'live-single' ? uiState.singleInput : (index === 0 ? uiState.dualInputW : uiState.dualInputH);
    el.value = value.toFixed(uiState.mode === 'live-single' ? 1 : uiState.dualDigits[index]);
    if (typeof document !== 'undefined' && document.activeElement === el) el.select();
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
    // TASK 535: a dimension driven by a formula opens with its FORMULA (the stored expression), otherwise with its value. O16: the box takes the full
    // text keyboard (names and "=" must be typable): no numeric inputmode.
    const hasFormula = typeof constraint.expression === 'string' && constraint.expression !== '';
    uiState.singleInput.inputMode = 'text';
    uiState.singleInput.value = (typeof initialKey === 'string') ? initialKey
        : hasFormula ? constraint.expression
        : (typeof prefillValue === 'number'
            ? (isAngleDim ? prefillValue.toFixed(1) : formatUnit(prefillValue, getDocUnit()))
            : '');
    updateAssist({ complete: typeof initialKey === 'string' });

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

    if (uiState.mode === 'live-single') placeLiveBox(uiState.singleInput, ox, oy);
    else if (uiState.mode === 'live-dual') placeLiveBox(uiState.dualContainer, ox, oy);
}

/** TASK 602: where a creation box that TAKES the pointer goes: docked at the canvas's top centre, this far below the canvas's top edge (clear of the
 *  canvas's corner controls: the SKETCHES bar at 8 px, Construction / Recenter at 16 px, both 44 px tall under a finger). */
export const TOUCH_BOX_DOCK_TOP = 64;

/** TASK 597: a live box beside the cursor stays INSIDE the window: one sticking out past the right edge widened the page on a phone (the layout grew, the view shrank, taps missed).
 *  TASK 602: ONE rule for where a box may sit: a box that lets the pointer through (a mouse: .sk-live-box is pointer-events none) follows the cursor; a box
 *  that takes the pointer (a finger: it is tapped to focus it) never sits beside the finger, where the NEXT tap of the drawing lands (the second point of a
 *  line tapped onto the box was swallowed): it docks at the canvas's top centre and stays there while the tool runs. */
function placeLiveBox(el, x, y) {
    const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    const vw = (typeof window !== 'undefined' && window.innerWidth) || Infinity, vh = (typeof window !== 'undefined' && window.innerHeight) || Infinity;
    const takesPointer = typeof getComputedStyle === 'function' && getComputedStyle(el).pointerEvents !== 'none';
    if (takesPointer && uiState.svg && typeof uiState.svg.getBoundingClientRect === 'function') {
        const r = uiState.svg.getBoundingClientRect();
        x = r.left + (r.width - w) / 2;
        y = r.top + TOUCH_BOX_DOCK_TOP;
    }
    el.style.left = `${Math.max(0, Math.min(x, vw - w - 8))}px`;
    el.style.top = `${Math.max(0, Math.min(y, vh - h - 8))}px`;
}

// --- Internals ---

function handleCommit() {
    if (!uiState.active) return;
    if (uiState.mode === 'edit' && uiState.target) {
        // TASK 535: the box text goes through the ONE expression parser (a number, a unit, a formula, a name, `name = value`): previewDimensionInput
        // plans it (pure), applyParameterChange commits THAT plan through the batch seam: one undo step, all-or-nothing, parameters included.
        // A text that is not valid keeps the box open: the hint under it says why (the old box closed silently and dropped what was typed).
        const target = uiState.target;
        const state = uiState.appState;
        const pv = previewDimensionInput(state, target, uiState.singleInput.value, { unit: getDocUnit() });
        if (!pv.ok && !pv.empty) { updateAssist({ complete: false }); return; }
        if (pv.ok) {
            const isFirstValue = target.__newlyPlaced === true;
            target.isDriven = false;
            target.driven = false;
            target.__newlyPlaced = false;
            target.__placing = false;
            if (state.placingConstraint === target) state.placingConstraint = null;
            const label = pv.kind === 'create' ? `create parameter ${pv.name}` : pv.kind === 'set' ? `change parameter ${pv.name}` : dimensionEditLabel(target, pv.value);
            // the FIRST value of a just-placed dimension rides the snapshot taken at its birth (no second undo step)
            const res = applyParameterChange(state, pv.plan, label, { snapshot: !isFirstValue });
            if (res.reverted) {
                const why = res.reason || (res.clash ? `conflicts with ${res.clash}` : '');
                const who = res.culprit && res.culprit.name && res.culprit.name !== target.name ? `${res.culprit.name}: ` : '';
                showNotification(`Can't set to ${pv.kind === 'value' ? pv.value : uiState.singleInput.value.trim()}${why ? ` — ${who}${why}` : ''}. Reverted.`, "warning");
            }
        }
        target.__editing = false;
        hideInput();
    } else {
        // Dispatch event for Tool to handle
        const detail = { mode: uiState.mode === 'live-dual' ? 'dual' : 'single', confirmedBy: 'enter' };
        detail.typed = uiState.typed.slice();   // which fields the user typed in: only those are the user's numbers, the rest shows the live preview
        if (uiState.mode === 'live-dual') detail.kind = uiState.dualKind;
        if (uiState.mode === 'live-dual') {
            detail.width = parseFloat(uiState.dualInputW.value);
            detail.height = parseFloat(uiState.dualInputH.value);
        } else {
            detail.field = uiState.field;
            detail.value = parseFloat(uiState.singleInput.value);
        }
        window.dispatchEvent(new CustomEvent('liveDimensionApplied', { detail }));
        if (detail.keepOpen) return;   // a tool that cannot place anything yet (a zero size) keeps its box open
        hideInput();
    }
}

function handlePreview() {
    if (!uiState.active || uiState.mode === 'edit') return;
    
    const detail = { mode: uiState.mode === 'live-dual' ? 'dual' : 'single' };
    if (uiState.mode === 'live-dual') {
        detail.kind = uiState.dualKind;
        detail.typed = uiState.typed.slice();
        const w = parseFloat(uiState.dualInputW.value);
        const h = parseFloat(uiState.dualInputH.value);
        if (!isNaN(w)) detail.width = w;
        if (!isNaN(h)) detail.height = h;
    } else {
        const v = parseFloat(uiState.singleInput.value);
        detail.typed = uiState.typed.slice();
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

// ── TASK 535: the live hint and the autocomplete list under the dimension box (the views; the content comes from #core/parameters.js) ──
function createAssistElements(single) {
    if (typeof document.createElement !== 'function' || !single || !single.parentNode || typeof single.parentNode.appendChild !== 'function') return;
    // setupNumericInput runs again for every tool that calls it: reuse the elements a first call made (one hint line and one list per page)
    const made = typeof document.getElementById === 'function' ? [document.getElementById('dimHint'), document.getElementById('dimComplete')] : [null, null];
    if (made[0] && made[1]) { uiState.hintEl = made[0]; uiState.listEl = made[1]; attachCompletion(single); return; }
    const hint = document.createElement('div');
    hint.id = 'dimHint';
    hint.className = 'dim-hint hidden';
    hint.setAttribute('role', 'status');
    const list = document.createElement('ul');
    list.id = 'dimComplete';
    list.className = 'dim-complete hidden';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Parameter names');
    single.parentNode.appendChild(list);
    single.parentNode.appendChild(hint);
    single.setAttribute('aria-describedby', 'dimHint');
    single.setAttribute('aria-controls', 'dimComplete');
    single.setAttribute('aria-autocomplete', 'list');
    single.setAttribute('autocomplete', 'off');
    single.setAttribute('autocapitalize', 'off');
    single.setAttribute('spellcheck', 'false');
    uiState.hintEl = hint;
    uiState.listEl = list;
    attachCompletion(single);
}

// the list's behaviour is the shared one (the same function a Parameters-window expression field calls)
function attachCompletion(single) {
    uiState.completion = createParameterCompletion({
        input: single,
        list: uiState.listEl,
        context: () => (uiState.mode === 'edit' && uiState.target
            ? { state: uiState.appState, unit: getDocUnit(), exclude: uiState.target.name ? [uiState.target.name] : [] } : null),
        onInsert: () => { updateAssist({ complete: false }); placeAssist(); },
        onChange: placeAssist,
    });
}

function hideAssist() {
    if (uiState.completion) uiState.completion.close();
    if (uiState.hintEl) hideNumericInputEl(uiState.hintEl);
}

// hint = what Enter will do (value preview, the O4 change list) or why it will not; list = names under the caret
function updateAssist({ complete = true } = {}) {
    if (!uiState.hintEl) return;
    if (uiState.mode !== 'edit' || !uiState.target) { hideAssist(); return; }
    const input = uiState.singleInput;
    const state = uiState.appState;
    const unit = getDocUnit();
    const pv = previewDimensionInput(state, uiState.target, input.value, { unit });
    if (pv.empty) hideNumericInputEl(uiState.hintEl);
    else {
        uiState.hintEl.textContent = pv.hint;
        uiState.hintEl.classList.toggle('err', !pv.ok);
        showNumericInputEl(uiState.hintEl);
    }
    input.setAttribute('aria-invalid', !pv.ok && !pv.empty ? 'true' : 'false');
    if (complete) {
        if (uiState.completion) uiState.completion.update(); // places the assist itself
    }
    placeAssist();
}

// the list sits right under the box, the hint under the list; when the bottom of the screen is too near both go above the box. Kept inside the viewport.
function placeAssist() {
    const input = uiState.singleInput;
    if (!uiState.hintEl || !input || typeof input.getBoundingClientRect !== 'function') return;
    const els = [uiState.listEl, uiState.hintEl].filter((el) => el && !el.classList.contains('hidden'));
    if (!els.length) return;
    const r = input.getBoundingClientRect();
    // the room they may use: the screen, and the box's own container (the canvas area clips what sticks out of it)
    const host = els[0].offsetParent ? els[0].offsetParent.getBoundingClientRect() : null;
    const vw = Math.min(document.documentElement.clientWidth || window.innerWidth, host ? host.right : Infinity);
    const vh = Math.min(document.documentElement.clientHeight || window.innerHeight, host ? host.bottom : Infinity);
    const total = els.reduce((s, el) => s + el.offsetHeight + 2, 0);
    const below = r.bottom + 2 + total <= vh - 4 || r.top - 2 - total < 0;
    let y = below ? r.bottom + 2 : r.top - 2 - total;
    for (const el of below ? els : els.slice().reverse()) {
        const op = el.offsetParent;
        const base = op ? op.getBoundingClientRect() : { left: -window.scrollX, top: -window.scrollY };
        const left = Math.max(8, Math.min(r.left, vw - el.offsetWidth - 8));
        el.style.left = `${left - base.left}px`;
        el.style.top = `${y - base.top}px`;
        y += el.offsetHeight + 2;
    }
}

function resetState() {
    hideAssist();
    if (uiState.target) uiState.target.__editing = false;
    uiState.active = false;
    uiState.mode = null;
    uiState.target = null;
    uiState.field = null;
    
    if (uiState.singleInput) {
        uiState.singleInput.classList.remove('sk-live-box');
        if (uiState.singleInput.style) uiState.singleInput.style.transform = '';
        hideNumericInputEl(uiState.singleInput);
    }
    if (uiState.dualContainer) { uiState.dualContainer.classList.remove('sk-live-box'); hideNumericInputEl(uiState.dualContainer); }
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
            placeAssist();
            uiState.rafId = requestAnimationFrame(loop);
        }
    };
    loop();
}

// Helpers for tool modules (backwards compat)
export function resetLockedDimensions() { }
