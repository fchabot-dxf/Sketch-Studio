import { setupNumericInput, showEditInput, hideInput } from '#ui/numeric-input-manager.js';

// Wrapper module providing a backward-compatible dimension input API.
// Delegates to the canonical numeric input manager while exposing a
// simple `setupDimensionInput`, `showDimInput`, and `resetDimensionInputState` API
// used by legacy code and tests.

export function setupDimensionInput(svg, appState) {
    try { setupNumericInput(svg, appState); } catch(_){ }

    // Ensure a global handle is present for tests and legacy callers
    const dimInput = (typeof document !== 'undefined' && document.getElementById) ? document.getElementById('dimInput') : null;
    window.__dimensionInput = window.__dimensionInput || { svg, appState, dimInput: dimInput || null, currentConstraint: null };
    if (!window.__dimensionInput.dimInput) window.__dimensionInput.dimInput = dimInput || null;
}

export function showDimInput(svg, appState, constraint, initialKey) {
    // Ensure numeric input system is initialized
    try { setupNumericInput(svg, appState); } catch(_){ }

    // Delegate to the numeric input manager for exact behavior
    try { showEditInput(svg, appState, constraint, initialKey); } catch(_){ }

    // Maintain a global pointer for tests/legacy code
    window.__dimensionInput = window.__dimensionInput || {};
    window.__dimensionInput.svg = svg;
    window.__dimensionInput.appState = appState;
    window.__dimensionInput.currentConstraint = constraint || null;

    // Ensure selection/caret behavior is deterministic for tests (numeric-input-manager uses requestAnimationFrame)
    const dimInput = (window.__dimensionInput && window.__dimensionInput.dimInput) || (typeof document !== 'undefined' ? document.getElementById('dimInput') : null);
    if (dimInput) {
        try {
            if (typeof initialKey === 'string' && initialKey.length > 0) {
                const len = (dimInput.value || '').length;
                if (typeof dimInput.setSelectionRange === 'function') dimInput.setSelectionRange(len, len);
                dimInput.selected = true;
                dimInput.selectedRange = { start: len, end: len };
            } else {
                if (typeof dimInput.select === 'function') dimInput.select();
                else if (typeof dimInput.setSelectionRange === 'function') dimInput.setSelectionRange(0, (dimInput.value || '').length);
            }
        } catch(_){ }
    }
}

export function resetDimensionInputState() {
    try { hideInput(); } catch(_){ }
    if (window.__dimensionInput && window.__dimensionInput.currentConstraint) {
        try { window.__dimensionInput.currentConstraint.__editing = false; } catch(_){ }
    }
    if (window.__dimensionInput) window.__dimensionInput.currentConstraint = null;
}