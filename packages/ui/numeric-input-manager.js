// packages/ui/numeric-input-manager.js — shared UI. Relocated VERBATIM from apps/sketchstudio/ui in slice S4b.
// TODO(shaper): parameterize the DOM reaches (document.getElementById('dimInput')/createElement/document.body)
// before Shaper adopts this — it currently builds its inputs straight into the SketchStudio document.
import { worldToScreen } from '#ui/coords.js';
import { logDiagnostic } from '#core/debug.js';
import { showNotification } from '#ui/notification-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { applyParameterChange, dimensionInputLabel, isDimensionDetermined, sizeRefusal, SIZE_REFUSAL } from '#core/dimension-seams.js';
import SettingsManager, { docUnit, isPrecisionKey } from '#core/settings-manager.js';
import { basePer } from '#core/units.js';
import { previewDimensionInput, quantityText, isDimension, evaluateBoxText } from '#core/parameters.js';
import { createParameterCompletion } from '#ui/parameter-completion.js';
import { undoRedoKeyAction } from '#ui/history-control.js';
import { dimLabelAt } from '#ui/hover-manager.js';
import { findSnap } from '#ui/snap-detection.js';
import { measureDimension } from '#core/constraint-verifier.js';

export const NUMERIC_INPUT_STYLE_ID = 'sk-numeric-input-styles';

// TASK 769: THE text and THE reading of a value in an on-canvas value box (the drawing tools' live boxes, the dimension edit box). Each field holds a
// QUANTITY: 'length' (base mm; shown and typed in the DOCUMENT unit), 'angle' (degrees), 'count' (a plain number: a polygon's sides).
const QUANTITY_UNIT = { length: () => docUnit(), angle: () => 'deg', count: () => null };
/** The box text of a value: a length is exactly a dimension label's text (lengthText: the document unit, the Length precision, Fractional 1 1/2" with its
 *  inch mark; no unit otherwise), an angle in degrees at the Angle precision (no degree sign), a count as its number. */
export const boxValueText = (v, quantity = 'length') => quantityText(Number(v), QUANTITY_UNIT[quantity](), 'bare');
/** TASK 876: THE reading of a box's text, the dimension edit box's own (#core/parameters.js evaluateBoxText: the one expression parser, the sketch's names):
 *  { ok:true, v (base mm / degrees / a number), expression (the canonical text when the text reads a name, else null) } | { ok:false, message }.
 *  A length is read with the DOCUMENT unit as the default: a bare 2 in an inch document is 2 in (50.8 mm), "50mm", "1 1/2", 1 1/2" and "3/8 in" convert,
 *  "d1/2" is half of dimension d1. An angle or a count is read by the same parser (45, 45°, 0.5 rad). */
export function readBoxText(text, quantity = 'length', state = uiState.appState) {
    return evaluateBoxText(state, text, quantity, { unit: docUnit() });
}
/** The value a box's text means (see readBoxText), or NaN. */
export function parseBoxValue(text, quantity = 'length', state = uiState.appState) {
    const r = readBoxText(text, quantity, state);
    return r.ok ? r.v : NaN;
}
/** TASK 876: the keyboard a box asks for on a phone. A name or a formula (d1 / 2) needs letters, so it is the full text keyboard: the dimension edit box's rule,
 *  declared once for the edit box and the drawing tools' boxes (was the decimal keypad while drawing, O15). */
const BOX_INPUT_MODE = 'text';
/** TASK 1006 (DIV-03): the hint under a REFERENCE dimension's read-only box (showEditInput 'view'). */
const REFERENCE_BOX_HINT = 'Reference dimension: measured, not typed. To type a value, make it Driving (right-click it, or touch and hold).';

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
.dim-input[aria-invalid="true"] {
    border-color: var(--sk-error, #ef4444);
    outline: 1px solid var(--sk-error, #ef4444);
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
.sk-dual-input input[aria-invalid="true"] {
    border-color: var(--sk-error, #ef4444);
    outline: 1px solid var(--sk-error, #ef4444);
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
    quantities: ['length', 'length'], // TASK 769: what each field holds ('length' | 'angle' | 'count'): its text and its reading (boxValueText / parseBoxValue)
    values: [null, null], // TASK 769: the live value each field shows (base units), and `parsed` what each typed field reads as: a unit change shows them again
    parsed: [NaN, NaN],
    expressions: [null, null], // TASK 876: what each typed field READS when its text names a dimension / parameter (d1 / 2): the canonical formula the new dimension is driven by; null = a plain value
    refusalText: '', // TASK 782 / 876: why the refused field is refused (a size of 0 or less, or the edit box's own reason: an unknown name, a syntax error)
    openValues: [null, null], // TASK 769: the values the box opened with (its Ctrl+Z default text, shown again on a unit change)
    refusing: false, // TASK 782: a typed size is 0 or less: the box shows it as invalid, Enter and a click place nothing
    typed: [false, false], // TASK 596: which field the user has typed in (a field showing the live value is NOT typed; only a typed one locks a size)
    defaults: ['', ''], // TASK 675 C: opening default strings so Ctrl/Cmd+Z restores the default in one step
    undoneToDefault: false, // TASK 675 C: a second Ctrl/Cmd+Z right after reverting a typed creation box does nothing
    
    // State
    rafId: null,
    focusRafId: null,
    svg: null,
    appState: null,

    // TASK 535: the hint line and the autocomplete list under the dimension box (null where the host has no real DOM)
    hintEl: null,
    listEl: null,
    completion: null, // the shared parameter-name completion (#ui/parameter-completion.js) over listEl
    outsideListening: false, // TASK 723: the document's capture pointerdown listener is on while an edit box (TASK 876: or a drawing tool's value box) is open
    typingIndex: -1, // TASK 876: the creation-box field the user typed in last (its input event): the one a click on a dimension names into, while uiState.typed[it] holds
    swallowUp: false // TASK 876: a press on a dimension inserted its name into a live box: its pointerup must not place the drawing's next point either
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

/**
 * TASK 675 C: Ctrl/Cmd+Z inside a numeric tool or edit box restores the opening default value in ONE step
 * (never browser character-by-character undo and never undoing a document step while the box stays open).
 * Returns true when the key was handled as undo.
 */
export function handleBoxUndoKey(ev, el, defaultValue, onReset, opts = {}) {
    if (undoRedoKeyAction(ev) !== 'undo') return false;
    ev.preventDefault();
    ev.stopPropagation();
    const defStr = defaultValue == null ? '' : String(defaultValue);
    const dirty = typeof opts.dirty === 'function' ? opts.dirty() : (el.value !== defStr);
    if (dirty) {
        el.value = defStr;
        if (typeof el.select === 'function') el.select();
        if (typeof onReset === 'function') onReset();
        return true;
    }
    if (typeof opts.onAtDefault === 'function') opts.onAtDefault();
    return true;
}

function setupListeners() {
    // Single Input Handler
    uiState.singleInput.addEventListener('keydown', (e) => {
        // TASK 535 autocomplete: while the list is open Up / Down move, Enter / Tab insert, Esc closes the list (a second Esc is the box's own Esc)
        if (uiState.mode === 'edit' && uiState.completion && uiState.completion.handleKey(e)) {
            e.stopImmediatePropagation(); return;
        }
        if (handleBoxUndoKey(e, uiState.singleInput, uiState.defaults[0], () => {
            if (uiState.mode === 'edit') {
                uiState.typed[0] = false; // back at the prefill: not an edit (TASK 724)
                updateAssist({ complete: false });
            } else {
                uiState.typed[0] = false;
                uiState.undoneToDefault = true;
                handlePreview(0);
            }
        }, uiState.mode === 'edit' ? undefined : {
            dirty: () => !!uiState.typed[0],
            onAtDefault: (!uiState.typed[0] && !uiState.undoneToDefault) ? handleCancel : null
        })) return;
        if (e.key === 'Enter') handleCommit();
        if (e.key === 'Escape') handleCancel();
        e.stopPropagation(); // Prevent global shortcuts
    });
    
    uiState.singleInput.addEventListener('input', () => { uiState.undoneToDefault = false; uiState.typed[0] = true; uiState.typingIndex = 0; handlePreview(); updateAssist(); });

    // Dual Input Handlers
    const handleDualKey = (e, field) => {
        const idx = field === 'width' ? 0 : 1;
        const el = idx === 0 ? uiState.dualInputW : uiState.dualInputH;
        if (handleBoxUndoKey(e, el, uiState.defaults[idx], () => {
            uiState.typed[idx] = false;
            uiState.undoneToDefault = true;
            handlePreview(idx);
        }, {
            dirty: () => !!uiState.typed[idx],
            onAtDefault: (!uiState.typed[0] && !uiState.typed[1] && !uiState.undoneToDefault) ? handleCancel : null
        })) return;
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
    
    uiState.dualInputW.addEventListener('input', () => { uiState.undoneToDefault = false; uiState.typed[0] = true; uiState.typingIndex = 0; handlePreview(); });
    uiState.dualInputH.addEventListener('input', () => { uiState.undoneToDefault = false; uiState.typed[1] = true; uiState.typingIndex = 1; handlePreview(); });
}

// --- Public API ---

export function showSingleInput(x, y, value, field, initialKey = null, focus = true, quantity = 'length') {
    if (!uiState.singleInput) return;   // a host with no DOM (the headless node tests that drive a tool's handlers bare) has no boxes: the tool runs as it does with one
    resetState();
    uiState.active = true;
    uiState.mode = 'live-single';
    uiState.field = field; // 'length', 'radius'
    uiState.typed = [!!initialKey, false];
    uiState.typingIndex = initialKey ? 0 : -1;
    uiState.quantities = [quantity, 'length'];
    uiState.values = [typeof value === 'number' ? value : null, null];
    uiState.openValues = uiState.values.slice();

    // Position
    uiState.singleInput.style.transform = '';
    uiState.singleInput.classList.add('sk-live-box');
    showNumericInputEl(uiState.singleInput);
    placeLiveBox(uiState.singleInput, x, y);
    
    // Value. TASK 876: the box takes names and formulas too, so a phone shows the full text keyboard (BOX_INPUT_MODE)
    uiState.singleInput.inputMode = BOX_INPUT_MODE;
    const defaultValue = typeof value === 'number' ? boxValueText(value, quantity) : '';
    uiState.defaults = [defaultValue, ''];
    uiState.singleInput.value = initialKey || defaultValue;
    if (initialKey) uiState.parsed[0] = parseBoxValue(initialKey, quantity);
    listenOutside();   // TASK 876: a click on a dimension names it into the field once the user has typed in it
    if (focus) {   // TASK 597: a touch opens the box WITHOUT focus (no phone keyboard on every click); tapping the box focuses it
        uiState.singleInput.focus();
        if (!initialKey) uiState.singleInput.select();
    }
}

/**
 * The two-field on-canvas box. The rect tool opens it as W x H; TASK 596: the polygon tool as size x sides through `opts`
 * ({ kind, labels: [first, second], separator, quantities: [first, second] }), the same element, keys and events, so Tab, Enter, Esc are ONE code path.
 * TASK 769: `quantities` says what each field holds ('length' default, 'angle', 'count'): its text is boxValueText's, a typed one is read by parseBoxValue.
 */
export function showDualInput(x, y, w, h, opts = {}) {
    if (!uiState.dualContainer) return;   // no DOM, no boxes (see showSingleInput)
    resetState();
    uiState.active = true;
    uiState.mode = 'live-dual';
    uiState.dualKind = opts.kind || null;
    uiState.typed = [false, false];
    uiState.quantities = opts.quantities || ['length', 'length'];
    uiState.values = [w, h];
    uiState.openValues = [w, h];
    const labels = opts.labels || ['W', 'H'];
    uiState.dualInputW.placeholder = labels[0];
    uiState.dualInputH.placeholder = labels[1];
    uiState.dualInputW.inputMode = uiState.dualInputH.inputMode = BOX_INPUT_MODE;
    uiState.dualSep.innerText = opts.separator || '×';

    uiState.dualContainer.classList.add('sk-live-box');
    showNumericInputEl(uiState.dualContainer);
    placeLiveBox(uiState.dualContainer, x, y);
    listenOutside();   // TASK 876 (see showSingleInput)

    const defW = boxValueText(w, uiState.quantities[0]);
    const defH = boxValueText(h, uiState.quantities[1]);
    uiState.defaults = [defW, defH];
    uiState.dualInputW.value = defW;
    uiState.dualInputH.value = defH;
    
    if (opts.focus !== false) {
        uiState.dualInputW.focus();
        uiState.dualInputW.select();
    }
    if (opts.initialKey) {   // the digit that opened the box is the first character of the first field, never lost
        uiState.dualInputW.value = opts.initialKey;
        uiState.typed[0] = true;
        uiState.typingIndex = 0;
        handlePreview();
    }
}

/**
 * TASK 596: show the live value of field `index` (0 = first) in the open creation box (the size follows the cursor). A field the user has
 * typed in keeps its text; the one with focus stays selected so the next typed character replaces the live value.
 */
export function setLiveInputValue(index, value) {
    if (!uiState.active || (uiState.mode !== 'live-dual' && uiState.mode !== 'live-single') || uiState.typed[index]) return;
    const el = liveField(index);
    uiState.values[index] = value;
    el.value = boxValueText(value, uiState.quantities[index]);
    if (typeof document !== 'undefined' && document.activeElement === el) el.select();
}

// Replaces showDimInput
export function showEditInput(svg, state, constraint, initialKey) {
    if (!constraint) return;

    // TASK 1006 (DIV-03 / DD-3): a REFERENCE dimension opens its box READ-ONLY ('view'), showing what its label shows (the value it measures now,
    // #core/constraint-verifier.js measureDimension) and a hint saying how to type it. Enter, Esc or a press outside closes it; nothing changes.
    // (A just-placed reference never gets here: the Dimension tool drops it without opening the box.)
    const reference = !!(constraint.isDriven || constraint.driven);
    // A dimension PLACED on a quantity the sketch already determines is born DRIVEN (a measurement) and is never typed. TASK 1006 (UX-16): at its
    // birth only: an existing driving dimension opens its box like any other (a value the sketch cannot take is refused when it is typed).
    if (!reference && constraint.__newlyPlaced === true && isDimensionDetermined(state, constraint)) {
        constraint.isDriven = true;
        constraint.driven = true;
        logDiagnostic('constraints', 'ERR-DRIVEN-02', 'Already determined by existing constraints; dimension added as driven.', {
            constraintId: constraint.id,
            type: constraint.type
        });
        return;
    }

    resetState();
    uiState.active = true;
    uiState.mode = reference ? 'view' : 'edit';
    uiState.target = constraint;
    uiState.appState = state;
    uiState.svg = svg;

    // Mark constraint as editing to hide the SVG label
    constraint.__editing = true;

    uiState.singleInput.style.transform = 'translate(-50%, -50%)';
    showNumericInputEl(uiState.singleInput);
    placeEditBox(); // shown first: a hidden box has no size and no containing block to place it in

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
    if (reference) { const now = measureDimension(constraint, state.joints, state.shapes); if (now !== null) prefillValue = now; }
    // U2: LENGTH dims format through the document unit; ANGLE dims stay in degrees (raw toFixed). docUnit defaults
    // 'mm' (= the world base), so for a LENGTH dim formatUnit(v,'mm') === v.toFixed(1) — byte-identical to before.
    const isAngleDim = constraint.type === CONSTRAINT_TYPES.ANGLE;
    // TASK 535: a dimension driven by a formula opens with its FORMULA (the stored expression), otherwise with its value. O16: the box takes the full
    // text keyboard (names and "=" must be typable): no numeric inputmode.
    const hasFormula = typeof constraint.expression === 'string' && constraint.expression !== '';
    const defaultValue = hasFormula ? constraint.expression
        : (typeof prefillValue === 'number'
            ? boxValueText(prefillValue, isAngleDim ? 'angle' : 'length') // TASK 728 / 769: the label's text (decimals or 1 1/2"), the box's one text
            : '');
    uiState.defaults = [defaultValue, ''];
    // TASK 724: the prefill is DISPLAY text (rounded to the precision setting); `exactText` is the same number unrounded, what an untouched box commits
    uiState.typed = [typeof initialKey === 'string', false]; // a key that opened the box is an edit
    uiState.exactText = (!hasFormula && typeof prefillValue === 'number') ? String(isAngleDim ? prefillValue : prefillValue / basePer(docUnit())) : null;
    uiState.singleInput.inputMode = BOX_INPUT_MODE;
    uiState.singleInput.value = (typeof initialKey === 'string') ? initialKey : defaultValue;
    const len = uiState.singleInput.value.length;
    if (typeof initialKey === 'string') {
        uiState.singleInput.focus();
        uiState.singleInput.setSelectionRange(len, len);
    } else {
        uiState.singleInput.setSelectionRange(0, len);
    }
    uiState.singleInput.readOnly = reference;
    if (reference && uiState.hintEl) { uiState.hintEl.textContent = REFERENCE_BOX_HINT; uiState.hintEl.classList.remove('err'); showNumericInputEl(uiState.hintEl); }
    else updateAssist({ complete: typeof initialKey === 'string' });

    if (uiState.focusRafId) { cancelAnimationFrame(uiState.focusRafId); uiState.focusRafId = null; }
    uiState.focusRafId = requestAnimationFrame(() => {
        uiState.focusRafId = null;
        if (!uiState.active || (uiState.mode !== 'edit' && uiState.mode !== 'view')) return; // TASK 1006: a reference's read-only box (mode 'view') takes focus too, so Enter / Esc reach it
        uiState.singleInput.focus();
        if (typeof initialKey !== 'string') uiState.singleInput.select();
    });
    startTrackingLoop();
    // TASK 723: a press anywhere outside the box ends it (Fusion). Capture phase on the document: it runs BEFORE the canvas / ribbon / footer
    // handlers of that same press, which then do their own job on the settled document (one press, not two). Added while the opening press
    // is already past the document's capture phase, so that press never closes the box it opens. resetState removes it.
    listenOutside();
}

// TASK 723 / 876: the presses an open box listens for on the document (capture phase): handleOutsidePress, suppressDimFocusLoss, and the pointerup that ends
// a press the live box swallowed (swallowInsertedUp). ONE add here, ONE remove in resetState.
function listenOutside() {
    if (uiState.outsideListening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('pointerdown', handleOutsidePress, true);
    document.addEventListener('mousedown', suppressDimFocusLoss, true);
    document.addEventListener('pointerup', swallowInsertedUp, true);
    uiState.outsideListening = true;
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
    if (uiState.refusing) placeAssist();
}

/** TASK 602: where a creation box that TAKES the pointer goes: docked at the canvas's top centre, this far below the canvas's top edge (clear of the
 *  canvas's corner controls: the SKETCHES bar at 8 px, Construction / Recenter at 16 px, both 44 px tall under a finger). */
export const TOUCH_BOX_DOCK_TOP = 64;

/** TASK 597: a live box beside the cursor never sits outside the page (one sticking out past the right edge widened the page on a phone: the layout grew, the view shrank, taps missed).
 *  TASK 697: the bound is the CANVAS svg's rect (the same bounds placeAnchoredBox uses), not the window: a window-sized bound let a box near the bottom edge sit over the
 *  footer bar, near the top over the ribbon, near a side over the rail. A canvas smaller than the box pins the box to the canvas's left / top edge (it sticks out right / below).
 *  The box's left / top are written in ITS OWN containing block (a position:fixed box: the viewport; the shared single box lives in a positioned container: that container's padding box).
 *  TASK 602: ONE rule for where a box may sit: a box that lets the pointer through (a mouse: .sk-live-box is pointer-events none) follows the cursor; a box
 *  that takes the pointer (a finger: it is tapped to focus it) never sits beside the finger, where the NEXT tap of the drawing lands (the second point of a
 *  line tapped onto the box was swallowed): it docks at the canvas's top centre and stays there while the tool runs. */
function placeLiveBox(el, x, y) {
    const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
    const c = uiState.svg && typeof uiState.svg.getBoundingClientRect === 'function' ? uiState.svg.getBoundingClientRect() : null;
    const takesPointer = typeof getComputedStyle === 'function' && getComputedStyle(el).pointerEvents !== 'none';
    if (c && takesPointer) {
        x = c.left + (c.width - w) / 2;
        y = c.top + TOUCH_BOX_DOCK_TOP;
    }
    if (c) {
        x = Math.max(c.left, Math.min(x, c.right - w));
        y = Math.max(c.top, Math.min(y, c.bottom - h));
    }
    setViewportPosition(el, x, y);
}

/** TASK 697 / 723: write a VIEWPORT point (x, y) as the box's left / top in ITS OWN containing block (a position:fixed box: the viewport;
 *  the shared single box lives in a positioned container: that container's padding box). The ONE conversion for every on-canvas box. */
function setViewportPosition(el, x, y) {
    const op = el.offsetParent;
    const base = op && typeof op.getBoundingClientRect === 'function'
        ? { left: op.getBoundingClientRect().left + (op.clientLeft || 0) - (op.scrollLeft || 0), top: op.getBoundingClientRect().top + (op.clientTop || 0) - (op.scrollTop || 0) }
        : { left: 0, top: 0 };
    el.style.left = `${x - base.left}px`;
    el.style.top = `${y - base.top}px`;
}

/** TASK 723: the dimension EDIT box sits centred ON its label (the label's world point, glyphPos; the box is translate(-50%, -50%)), kept inside the
 *  canvas svg's rect (a label panned near or past an edge holds the box at that edge). Was: the viewport point written straight into left / top, so in
 *  a host whose box lives in a positioned container (SketchStudio) the box sat the container's offset away from its label (~180 px below it). */
function placeEditBox() {
    const el = uiState.singleInput, svg = uiState.svg, c = uiState.target;
    const r = svg.getBoundingClientRect();
    const gp = Array.isArray(c.glyphPos) ? c.glyphPos[0] : c.glyphPos;
    let { x, y } = gp ? worldToScreen(svg, gp) : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const hw = (el.offsetWidth || 0) / 2, hh = (el.offsetHeight || 0) / 2;
    x = Math.max(r.left + hw, Math.min(x, r.left + r.width - hw));
    y = Math.max(r.top + hh, Math.min(y, r.top + r.height - hh));
    setViewportPosition(el, x, y);
}

/**
 * TASK 653 / 688: place a floating tool value box beside its world anchor (`q = worldToScreen(svg, world)`),
 * trying 6 slots (below-right, below-left, above-right, above-left, and two higher slots) inside `svg`
 * and clear of `obstacles` (e.g. a drag-arrow handle). Clamps inside the canvas (clear of the footer),
 * except when `panAnchor` itself is panned off the canvas (keeps below-right so the box moves with it).
 */
export function placeAnchoredBox({ el, svg, world, panAnchor = world, obstacles = [] } = {}) {
    if (!el || !svg || !world) return;
    const q = worldToScreen(svg, world);
    const c = svg.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight, G = 14;
    const ref = panAnchor ? worldToScreen(svg, panAnchor) : q;
    if (ref.x < c.left || ref.x > c.right || ref.y < c.top || ref.y > c.bottom) {
        el.style.left = `${Math.round(q.x + G)}px`;
        el.style.top = `${Math.round(q.y + G)}px`;
        return;
    }
    const obs = (Array.isArray(obstacles) ? obstacles : [obstacles])
        .map((o) => (o && typeof o.getBoundingClientRect === 'function' ? o.getBoundingClientRect() : o))
        .filter((r) => r && r.width > 0 && r.height > 0);
    const inside = ([x, y]) => x >= c.left && y >= c.top && x + w <= c.right && y + h <= c.bottom;
    const clear = ([x, y]) => !obs.some((o) => x < o.right && x + w > o.left && y < o.bottom && y + h > o.top);
    const clamp = ([x, y]) => [Math.max(c.left, Math.min(x, c.right - w)), Math.max(c.top, Math.min(y, c.bottom - h))];
    const spots = [
        [q.x + G, q.y + G], [q.x - G - w, q.y + G],
        [q.x + G, q.y - G - h], [q.x - G - w, q.y - G - h],
        [q.x + G, q.y - G - 2 * h - 12], [q.x - G - w, q.y - G - 2 * h - 12],
    ];
    const clamped = spots.map(clamp);
    const [x, y] = spots.find((s) => inside(s) && clear(s))
        || spots.find(inside)
        || clamped.find(clear)
        || clamped[0];
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
}

// --- Internals ---

function handleCommit() {
    if (!uiState.active) return;
    if (uiState.mode === 'view') { hideInput(); return; } // TASK 1006 (DIV-03): a reference's read-only box changes nothing
    if (uiState.mode === 'edit' && uiState.target) {
        // TASK 535: the box text goes through the ONE expression parser (a number, a unit, a formula, a name, `name = value`): previewDimensionInput
        // plans it (pure), applyParameterChange commits THAT plan through the batch seam: one undo step, all-or-nothing, parameters included.
        // A text that is not valid keeps the box open: the hint under it says why (the old box closed silently and dropped what was typed).
        const target = uiState.target;
        const state = uiState.appState;
        // TASK 724: a box whose text is still exactly its (rounded) prefill is not an edit. A dimension that already drives keeps its exact value: close, no undo step.
        // A just-placed / restored / reference dimension still becomes driving, with the exact (unrounded) measured number, never the displayed one.
        const untouched = boxUntouched();
        const needsValue = target.__newlyPlaced === true || target.__restoredDimension === true || target.isDriven || target.driven;
        if (untouched && !needsValue) { target.__editing = false; hideInput(); return; }
        const pv = previewDimensionInput(state, target, untouched ? uiState.exactText : uiState.singleInput.value, { unit: docUnit() });
        if (!pv.ok && !pv.empty) { updateAssist({ complete: false }); return; }
        if (pv.ok) {
            const isFirstValue = target.__newlyPlaced === true || target.__restoredDimension === true;
            target.isDriven = false;
            target.driven = false;
            endPlacing(target, state);
            const label = dimensionInputLabel(target, pv);
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
        // TASK 782: a typed size of 0 or less is refused HERE, once for every tool: the box keeps it highlighted with the hint, nothing is drawn
        if (liveRefusal() !== -1) { showLiveRefusal(); return; }
        // Dispatch event for Tool to handle
        const detail = { mode: uiState.mode === 'live-dual' ? 'dual' : 'single', confirmedBy: 'enter' };
        detail.typed = uiState.typed.slice();   // which fields the user typed in: only those are the user's numbers, the rest shows the live preview
        if (uiState.mode === 'live-dual') detail.kind = uiState.dualKind;
        if (uiState.mode === 'live-dual') {
            detail.width = readLiveField(0);
            detail.height = readLiveField(1);
        } else {
            detail.field = uiState.field;
            detail.value = readLiveField(0);
        }
        detail.expressions = typedExpressions();
        window.dispatchEvent(new CustomEvent('liveDimensionApplied', { detail }));
        if (detail.keepOpen) return;   // a tool that cannot place anything yet (a zero size) keeps its box open
        hideInput();
    }
}

// TASK 724: the box still shows exactly its (rounded) prefill and nothing was typed (any input event since it opened counts): not an edit.
// TASK 723: the ONE rule for both ways a box ends: Enter (handleCommit) and a press outside it (handleOutsidePress).
function boxUntouched() {
    return !uiState.typed[0] && uiState.singleInput.value === uiState.defaults[0] && uiState.exactText != null;
}

// A just-placed (or 667-restored) dimension stops being "new": it keeps its value, its birth snapshot stays its ONE undo step.
function endPlacing(target, state) {
    target.__newlyPlaced = false;
    delete target.__restoredDimension;
    target.__placing = false;
    if (state && state.placingConstraint === target) state.placingConstraint = null;
}

// TASK 866: identify a dimension text label or leader/dimension line under a pointer event on uiState.svg.
// Text (.dim-label) always wins; a leader/dimension bar yields to real geometry underneath (e.g. a 0-offset dimension lying directly on a line).
// No existing hit-test covered the thin dimension / leader lines (dimLabelAt only tests label boxes), so leaderLineAt is the one helper for them.
function isOverGeometry(e, state, svg) {
    const realShapes = state.shapes.filter((s) => !s.reference);
    return !!findSnap(state.joints, realShapes, svg, { x: e.clientX, y: e.clientY }, [], false, false, 0.3);
}
function dimensionOfElement(el, state) {
    if (el.classList.contains('pattern-label')) return null;
    const c = state.constraints[parseInt(el.dataset.constraintIdx, 10)];
    return isDimension(c) ? c : null;
}
function leaderLineAt(svg, state, e) {
    const tol = e.pointerType === 'touch' ? 6 : 3;
    for (const ln of svg.querySelectorAll('line[data-constraint-idx]')) {
        const a = worldToScreen(svg, { x: +ln.getAttribute('x1'), y: +ln.getAttribute('y1') });
        const b = worldToScreen(svg, { x: +ln.getAttribute('x2'), y: +ln.getAttribute('y2') });
        const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((e.clientX - a.x) * vx + (e.clientY - a.y) * vy) / l2)) : 0;
        if (Math.hypot(e.clientX - (a.x + t * vx), e.clientY - (a.y + t * vy)) <= tol) {
            const c = dimensionOfElement(ln, state);
            if (c) return c;
        }
    }
    return null;
}
function clickedDimensionConstraint(e) {
    const state = uiState.appState, svg = uiState.svg;
    const labelEl = e.target.closest('.dim-label[data-constraint-idx]');
    if (labelEl && svg.contains(labelEl)) {
        const c = dimensionOfElement(labelEl, state);
        if (c) return c;
    }
    const hit = dimLabelAt(svg, state, e.clientX, e.clientY);
    if (isDimension(hit)) return hit;
    const dimEl = e.target.closest('[data-constraint-idx]');
    const onGeometry = e.target.classList.contains('shape-elem') || e.target.classList.contains('joint');
    const leader = (dimEl && svg.contains(dimEl) ? dimensionOfElement(dimEl, state) : null) || (onGeometry ? null : leaderLineAt(svg, state, e));
    return leader && !isOverGeometry(e, state, svg) ? leader : null;
}

// TASK 876: the field a click on a dimension inserts its name into, or null. The dimension edit box: its one field. A drawing tool's value box (live-single /
// live-dual): the field the user typed in last, and only while it is TYPED (uiState.typed[i], set by its input event): until then a click on the canvas is the
// drawing's click, as ever, even on a dimension.
function typingField() {
    if (uiState.mode === 'edit') return uiState.target ? { el: uiState.singleInput, index: 0 } : null;
    if (uiState.mode !== 'live-single' && uiState.mode !== 'live-dual') return null;
    const i = uiState.typingIndex;
    return i >= 0 && i < (uiState.mode === 'live-dual' ? 2 : 1) && uiState.typed[i] ? { el: liveField(i), index: i } : null;
}

// TASK 866 / 876: insert a referenced parameter name at the caret of the field being typed in (replacing any active selection), keeping the box open and focused.
// ONE insert for the edit box and the drawing tools' boxes.
function insertBoxText(name, field) {
    const el = field.el;
    const from = Math.min(el.selectionStart, el.selectionEnd), to = Math.max(el.selectionStart, el.selectionEnd);
    el.value = el.value.slice(0, from) + name + el.value.slice(to);
    el.setSelectionRange(from + name.length, from + name.length);
    el.focus();
    uiState.undoneToDefault = false;
    uiState.typed[field.index] = true;
    if (uiState.mode === 'edit') {
        if (uiState.completion) uiState.completion.close();
        updateAssist({ complete: false });
    } else {
        handlePreview();   // the drawing shows what the name means now (and a name that cannot be read is refused under the box)
    }
}

// TASK 866: touch taps emit a deferred compatibility mousedown after touchend; preventing default keeps #dimInput focused and mobile keypad open.
function suppressDimFocusLoss(e) {
    if (!uiState.active || !typingField() || insideBox(e)) return;
    if (clickedDimensionConstraint(e)) e.preventDefault();
}

// TASK 876: the press ended on a dimension whose name went into a live box: the drawing gets neither the press nor its release
function swallowInsertedUp(e) {
    if (!uiState.swallowUp) return;
    uiState.swallowUp = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

function insideBox(e) {
    const path = e.composedPath();
    return [uiState.singleInput, uiState.dualContainer, uiState.hintEl, uiState.listEl].some((el) => el && path.includes(el));
}

// TASK 723: a press outside the open dimension box (the canvas, a glyph, another label, the ribbon, the footer, the Parameters window, ...).
// TASK 866: a press on another dimension's text / leader inserts its parameter name at the caret and keeps the box open; pressing self does nothing.
// A VALID text that differs from what the box opened with is applied exactly as Enter applies it (handleCommit: one undo step, the same
// solve / fx / naming path). Anything else (unchanged, empty, refused) is dropped with no notice: the dimension keeps what it has, and a
// just-placed one stays placed with its measured value (as Enter on the unchanged text leaves it). The press is not stopped.
// TASK 876: the same press on a drawing tool's value box (live-single / live-dual) that the user has typed in inserts the dimension's name the same way; anything else
// is the drawing's own press, as ever (the box is neither closed nor committed by it).
function handleOutsidePress(e) {
    if (uiState.active && uiState.mode === 'view') { if (!insideBox(e)) hideInput(); return; } // TASK 1006 (DIV-03): closes, the press goes on
    const field = uiState.active ? typingField() : null;
    if (!field) return;
    if (e.button === 1) return; // the middle button pans the view (as the wheel zooms it): navigating is not working elsewhere, the box stays
    if (insideBox(e)) return;
    const dim = clickedDimensionConstraint(e);
    if (uiState.mode !== 'edit') {
        if (!dim) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        uiState.swallowUp = true;
        if (dim.name) insertBoxText(dim.name, field); else field.el.focus();
        return;
    }
    if (dim) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (dim !== uiState.target && dim.name) insertBoxText(dim.name, field);
        else uiState.singleInput.focus();
        return;
    }
    const text = uiState.singleInput.value;
    // an untouched box (724) or a text equal to the opening one is no edit: never commit its rounded display text (a just-placed dimension keeps its exact measured value)
    const changed = !boxUntouched() && text.trim() !== String(uiState.defaults[0]).trim();
    if (changed && previewDimensionInput(uiState.appState, uiState.target, text, { unit: docUnit() }).ok) { handleCommit(); return; }
    endPlacing(uiState.target, uiState.appState);
    hideInput();
}

function handlePreview(resetIdx = -1) {
    if (!uiState.active || uiState.mode === 'edit') return;
    showLiveRefusal();
    
    const detail = { mode: uiState.mode === 'live-dual' ? 'dual' : 'single' };
    if (uiState.mode === 'live-dual') {
        detail.kind = uiState.dualKind;
        detail.typed = uiState.typed.slice();
        if (resetIdx !== -1) detail.reset = [resetIdx === 0, resetIdx === 1];
        const w = readLiveField(0);
        const h = readLiveField(1);
        if (!isNaN(w)) detail.width = w;
        if (!isNaN(h)) detail.height = h;
        detail.expressions = typedExpressions();
    } else {
        const v = readLiveField(0);
        detail.typed = uiState.typed.slice();
        if (resetIdx !== -1) detail.reset = [resetIdx === 0];
        if (!isNaN(v)) {
            detail.field = uiState.field;
            detail.value = v;
        }
        detail.expressions = typedExpressions();
    }
    window.dispatchEvent(new CustomEvent('liveDimensionPreview', { detail }));
}

// TASK 769: field `index` of the open creation box (the single box is field 0), and the value its text means (THE one reading of a live box: parseBoxValue,
// in the field's quantity). A typed field keeps what it reads as, so a unit change shows the same length again.
function liveField(index) {
    return uiState.mode === 'live-single' ? uiState.singleInput : (index === 0 ? uiState.dualInputW : uiState.dualInputH);
}
/** TASK 876: rides on every live event as detail.expressions: per field, the canonical formula a TYPED field reads as ("d1 / 2"), null for an untyped one or a plain value.
 *  A tool that turns a typed value into a dimension keeps it (#ui/input-handlers/base-tool.js typedExpression), so the dimension follows the name it was typed from. */
function typedExpressions() {
    return uiState.expressions.map((x, i) => (uiState.typed[i] ? x : null));
}
function readLiveField(index) {
    const r = readBoxText(liveField(index).value, uiState.quantities[index]);
    const v = r.ok ? r.v : NaN;
    if (uiState.typed[index]) { uiState.parsed[index] = v; uiState.expressions[index] = r.ok ? r.expression : null; }
    return v;
}
// TASK 782: THE refusal of a typed size, one check for every drawing tool's box: a TYPED 'length' field (a rectangle's W / H, a line's L, a circle's
// diameter, a slot's span / width, an arc's radius, a polygon's R) that reads 0 or less is not a size. The refusal is the dimension edit box's own: the field
// is aria-invalid (red) and the hint line under the box says why; Enter and a click place nothing until the text is fixed or cleared (Ctrl+Z / Esc).
// An angle may be 0 or negative and a count is clamped by its tool, so only lengths are checked.
// (TASK 789: the rule and its message are #core/dimension-seams.js sizeRefusal, the one every dimension edit is refused by too.)
export const SIZE_REFUSAL_HINT = SIZE_REFUSAL[0].toUpperCase() + SIZE_REFUSAL.slice(1) + '.';
// TASK 876: a TYPED field whose text does not read (a name nothing defines, a syntax error: the edit box's own message) is refused the same way.
function liveRefusal() {
    uiState.refusalText = '';
    if (!uiState.active || (uiState.mode !== 'live-dual' && uiState.mode !== 'live-single')) return -1;
    const n = uiState.mode === 'live-dual' ? 2 : 1;
    for (let i = 0; i < n; i++) {
        if (!uiState.typed[i]) continue;
        const text = liveField(i).value;
        if (String(text).trim() === '') continue;
        const r = readBoxText(text, uiState.quantities[i]);
        if (!r.ok) { uiState.refusalText = r.message || 'not a valid value'; return i; }
        if (uiState.quantities[i] === 'length' && sizeRefusal(r.v)) { uiState.refusalText = SIZE_REFUSAL_HINT; return i; }
    }
    return -1;
}
/** The drawing tools' pointer-up gate: true while the open creation box holds a refused typed size, so the click places nothing. The click took the focus
 *  from the box (a press on the canvas focuses the canvas): it goes back to the refused field, selected, so the next keys fix it. */
export function refuseLiveInputClick() {
    if (!uiState.refusing) return false;
    const bad = liveRefusal();
    if (bad !== -1) { const el = liveField(bad); el.focus(); if (typeof el.select === 'function') el.select(); }
    return true;
}
function showLiveRefusal() {
    const bad = liveRefusal();
    uiState.refusing = bad !== -1;
    const n = uiState.mode === 'live-dual' ? 2 : 1;
    for (let i = 0; i < n; i++) liveField(i).setAttribute('aria-invalid', i === bad ? 'true' : 'false');
    if (!uiState.hintEl) return;
    if (bad === -1) { hideNumericInputEl(uiState.hintEl); return; }
    uiState.hintEl.textContent = uiState.refusalText;
    uiState.hintEl.classList.add('err');
    showNumericInputEl(uiState.hintEl);
    placeAssist();
}

// TASK 769: the document unit or a display setting (precision, Decimal / Fractional) changed while a creation box is open: every field is shown again
// through boxValueText (a typed one as the length it was typed as, the others as their live value). The canvas labels re-render on the next frame.
function showLiveBoxAgain() {
    if (!uiState.active || (uiState.mode !== 'live-dual' && uiState.mode !== 'live-single')) return;
    const n = uiState.mode === 'live-dual' ? 2 : 1;
    for (let i = 0; i < n; i++) {
        const q = uiState.quantities[i];
        if (Number.isFinite(uiState.openValues[i])) uiState.defaults[i] = boxValueText(uiState.openValues[i], q);
        const v = uiState.typed[i] ? uiState.parsed[i] : uiState.values[i];
        if (Number.isFinite(v)) liveField(i).value = boxValueText(v, q);
    }
}
SettingsManager.subscribe((name) => { if (name === 'DOC_UNIT' || isPrecisionKey(name)) showLiveBoxAgain(); });

function handleCancel() {
    if (uiState.mode === 'edit' && uiState.target && (uiState.target.__newlyPlaced || uiState.target.__restoredDimension)) {
        if ((uiState.target.__newlyPlaced === true || uiState.target.__restoredDimension === true) && typeof uiState.target.__birthHistoryLength === 'number' && uiState.appState && uiState.appState.discardSnapshotAt) {
            uiState.appState.discardSnapshotAt(uiState.target.__birthHistoryLength);
        }
        const state = uiState.appState;
        if (uiState.target.__restoredDimension) {
            uiState.target.dimensioned = false;
            delete uiState.target.name;
            delete uiState.target.__restoredDimension;
        } else if (state && Array.isArray(state.constraints)) {
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
            ? { state: uiState.appState, unit: docUnit(), exclude: uiState.target.name ? [uiState.target.name] : [] } : null),
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
    if (uiState.mode !== 'edit' || !uiState.target) { if (!uiState.refusing) hideAssist(); return; }   // TASK 782: a live box's refusal hint stays
    const input = uiState.singleInput;
    const state = uiState.appState;
    const unit = docUnit();
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
    const input = uiState.mode === 'live-dual' ? uiState.dualContainer : uiState.singleInput;   // TASK 782: the refusal hint sits under the live box it belongs to
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
    if (uiState.outsideListening) {
        document.removeEventListener('pointerdown', handleOutsidePress, true);
        document.removeEventListener('mousedown', suppressDimFocusLoss, true);
        document.removeEventListener('pointerup', swallowInsertedUp, true);
        uiState.outsideListening = false;
        uiState.swallowUp = false;
    }
    hideAssist();
    if (uiState.target) uiState.target.__editing = false;
    uiState.active = false;
    uiState.mode = null;
    uiState.target = null;
    uiState.field = null;
    if (uiState.refusing) {   // TASK 782: the refused-size marks go with the box
        uiState.refusing = false;
        for (const el of [uiState.singleInput, uiState.dualInputW, uiState.dualInputH]) if (el && el.setAttribute) el.setAttribute('aria-invalid', 'false');
    }
    uiState.defaults = ['', ''];
    uiState.exactText = null;
    uiState.undoneToDefault = false;
    uiState.quantities = ['length', 'length'];
    uiState.values = [null, null];
    uiState.parsed = [NaN, NaN];
    uiState.typingIndex = -1;
    uiState.expressions = [null, null];
    uiState.refusalText = '';
    uiState.openValues = [null, null];
    
    if (uiState.singleInput) {
        uiState.singleInput.classList.remove('sk-live-box');
        uiState.singleInput.readOnly = false; // TASK 1006 (DIV-03): a reference's box was read-only
        if (uiState.singleInput.style) uiState.singleInput.style.transform = '';
        hideNumericInputEl(uiState.singleInput);
    }
    if (uiState.dualContainer) { uiState.dualContainer.classList.remove('sk-live-box'); hideNumericInputEl(uiState.dualContainer); }
    if (uiState.rafId) { cancelAnimationFrame(uiState.rafId); uiState.rafId = null; }
    if (uiState.focusRafId) { cancelAnimationFrame(uiState.focusRafId); uiState.focusRafId = null; }
}

function startTrackingLoop() {
    if (uiState.rafId) cancelAnimationFrame(uiState.rafId);
    
    const loop = () => {
        if (uiState.active && (uiState.mode === 'edit' || uiState.mode === 'view') && uiState.target && uiState.svg) {
            // Update position based on constraint
            if (uiState.target.glyphPos) placeEditBox();
            placeAssist();
            uiState.rafId = requestAnimationFrame(loop);
        }
    };
    loop();
}

// Helpers for tool modules (backwards compat)
export function resetLockedDimensions() { }
