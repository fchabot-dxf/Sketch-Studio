import SettingsManager from '../core/settings-manager.js';
import { dbg } from '../core/debug.js';
import { normalizeExistingPanel } from './wizard-base.js';

export function setupSettingsPanel(svg, state) {
    // Element refs
    const btnToggle = document.getElementById('btn-settings-toggle');
    const panel = document.getElementById('settings-panel');
    const btnClose = document.getElementById('btn-settings-close');
    const btnClose2 = document.getElementById('s-close');
    const btnSaveProject = document.getElementById('s-save-project');
    const btnReset = document.getElementById('s-reset');
    // Accessibility: describe helper text and clarify behavior on hover
    if (btnSaveProject) {
        btnSaveProject.title = 'Save project config. In standalone builds it will attempt to overwrite the original file (if supported) or download an updated HTML file.';
        btnSaveProject.setAttribute('aria-describedby', 's-save-help');
    }

    if (!panel || !btnToggle) return;

    const inputs = {
        showGrid: document.getElementById('s-show-grid'),
        snapMag: document.getElementById('s-snap-mag'),
        gridMag: document.getElementById('s-grid-mag'),
        gridSize: document.getElementById('s-grid-size'),
        gridMajor: document.getElementById('s-grid-major'),
        lineStroke: document.getElementById('s-line-stroke'),
        jointRadius: document.getElementById('s-joint-radius'),
        jointStrokeMult: document.getElementById('s-joint-stroke-mult'),
        selectionMult: document.getElementById('s-selection-mult'),
        hoverMult: document.getElementById('s-hover-mult'),
        glyphIcon: document.getElementById('s-glyph-icon'),
        glyphInfer: document.getElementById('s-glyph-infer'),
        glyphOffset: document.getElementById('s-glyph-offset'),
        glowWidth: document.getElementById('s-glow-width'),
        dashLength: document.getElementById('s-dash-length'),
        dashGap: document.getElementById('s-dash-gap')
    };

    // Normalize the settings panel to match the solver tuning wizard layout
    try {
        const settingsPanelEl = document.getElementById('settings-panel');
        if (settingsPanelEl) normalizeExistingPanel('settings-panel', { width: 320, padding: 14, center: true });
    } catch(_) {}

    // Also normalize the export panel so all wizards share the same layout
    try {
        const exportPanelEl = document.getElementById('export-panel');
        if (exportPanelEl) normalizeExistingPanel('export-panel', { width: 320, padding: 14, center: true });
    } catch(_) {}

    // Add range sliders next to numeric inputs for quicker adjustment (keeps inputs in sync)
    const sliderSpecs = {
        snapMag: { min: 2, max: 40, step: 1 },
        gridMag: { min: 2, max: 40, step: 1 },
        gridSize: { min: 0.5, max: 20, step: 0.5 },
        gridMajor: { min: 1, max: 50, step: 1 },
        lineStroke: { min: 0.1, max: 5, step: 0.1 },
        jointRadius: { min: 0.1, max: 12, step: 0.1 },
        jointStrokeMult: { min: 0.1, max: 5, step: 0.1 },
        selectionMult: { min: 0.1, max: 6, step: 0.1 },
        hoverMult: { min: 0.1, max: 6, step: 0.1 },
        glyphIcon: { min: 8, max: 48, step: 1 },
        glyphInfer: { min: 8, max: 64, step: 1 },
        glyphOffset: { min: 0, max: 200, step: 1 },
        glowWidth: { min: 0, max: 80, step: 1 },
        dashLength: { min: 1, max: 40, step: 1 },
        dashGap: { min: 1, max: 40, step: 1 }
    };

    Object.keys(sliderSpecs).forEach(key => {
        const inputEl = inputs[key];
        if (!inputEl || inputEl.tagName !== 'INPUT' || inputEl.type === 'checkbox') return;

        // Respect any explicit min/max/step set in the DOM; fall back to sensible defaults
        const spec = sliderSpecs[key];
        const min = inputEl.getAttribute && inputEl.getAttribute('min') ? parseFloat(inputEl.getAttribute('min')) : spec.min;
        const max = inputEl.getAttribute && inputEl.getAttribute('max') ? parseFloat(inputEl.getAttribute('max')) : spec.max;
        const step = inputEl.getAttribute && inputEl.getAttribute('step') ? parseFloat(inputEl.getAttribute('step')) : spec.step;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = inputEl.value || String(min);
        slider.style.cssText = 'width:100%; margin-top:6px; accent-color:#3b82f6; cursor:pointer;';

        // Place slider below the existing label row (stack vertically)
        const label = inputEl.parentNode || (inputEl.closest ? inputEl.closest('label') : null);
        if (label) {
            // ensure vertical stacking in the label
            try { 
                label.style = label.style || {}; 
                label.style.flexDirection = 'column'; 
                label.style.alignItems = 'stretch'; // Fixes centering issue
            } catch (_) {}
            if (typeof label.appendChild === 'function') label.appendChild(slider);
        } else {
            // fallback: append after the input element
            if (inputEl.parentNode && typeof inputEl.parentNode.appendChild === 'function') inputEl.parentNode.appendChild(slider);
        }

        // Keep input and slider synchronized
        slider.addEventListener('input', () => {
            inputEl.value = slider.value;
            try { applyLocal(); } catch (_) {}
        });
        inputEl.addEventListener('input', () => { slider.value = inputEl.value; });
    }); 

    function populate() {
        const s = SettingsManager.getAll();
        try {
            inputs.showGrid.checked = !!s.SHOW_GRID;
            inputs.snapMag.value = s.SNAP_MAGNETISM;
            inputs.gridMag.value = s.GRID_MAGNETISM;
            inputs.gridSize.value = s.GRID_SIZE;
            inputs.gridMajor.value = s.GRID_MAJOR_STEP;
            inputs.lineStroke.value = s.LINE_STROKE;
            inputs.jointRadius.value = s.JOINT_RADIUS;
            inputs.jointStrokeMult.value = s.JOINT_STROKE_MULT;
            inputs.selectionMult.value = s.SELECTION_FEEDBACK_MULT;
            inputs.hoverMult.value = s.HOVER_FEEDBACK_MULT;

            inputs.glyphIcon.value = s.GLYPH_SYMBOL_SIZE_PX;
            inputs.glyphInfer.value = s.GLYPH_INFERENCE_SIZE_PX;
            inputs.glyphOffset.value = s.GLYPH_OFFSET_PX;
            inputs.glowWidth.value = s.GLOW_WIDTH_PX;
            inputs.dashLength.value = s.DASH_LENGTH_PX;
            inputs.dashGap.value = s.DASH_GAP_PX;
        } catch (e) { console.error('populate settings failed', e); }
    }

    function applyLocal() {
        try {
            SettingsManager.set('SHOW_GRID', !!inputs.showGrid.checked, { persist: 'local' });
            SettingsManager.set('SNAP_MAGNETISM', Number(inputs.snapMag.value || 0), { persist: 'local' });
            SettingsManager.set('GRID_MAGNETISM', Number(inputs.gridMag.value || 0), { persist: 'local' });
            SettingsManager.set('GRID_SIZE', Number(inputs.gridSize.value || 2), { persist: 'local' });
            SettingsManager.set('GRID_MAJOR_STEP', Number(inputs.gridMajor.value || 10), { persist: 'local' });
            SettingsManager.set('LINE_STROKE', Number(inputs.lineStroke.value || 1.0), { persist: 'local' });
            SettingsManager.set('JOINT_RADIUS', Number(inputs.jointRadius.value || 4), { persist: 'local' });
            SettingsManager.set('JOINT_STROKE_MULT', Number(inputs.jointStrokeMult.value || 1.0), { persist: 'local' });
            SettingsManager.set('SELECTION_FEEDBACK_MULT', Number(inputs.selectionMult.value || 2), { persist: 'local' });
            SettingsManager.set('HOVER_FEEDBACK_MULT', Number(inputs.hoverMult.value || 3), { persist: 'local' });

            SettingsManager.set('GLYPH_SYMBOL_SIZE_PX', Number(inputs.glyphIcon.value || 20), { persist: 'local' });
            SettingsManager.set('GLYPH_INFERENCE_SIZE_PX', Number(inputs.glyphInfer.value || 24), { persist: 'local' });
            SettingsManager.set('GLYPH_OFFSET_PX', Number(inputs.glyphOffset.value || 40), { persist: 'local' });
            SettingsManager.set('GLOW_WIDTH_PX', Number(inputs.glowWidth.value || 20), { persist: 'local' });
            SettingsManager.set('DASH_LENGTH_PX', Number(inputs.dashLength.value || 8), { persist: 'local' });
            SettingsManager.set('DASH_GAP_PX', Number(inputs.dashGap.value || 8), { persist: 'local' });
        } catch (e) { console.error('applyLocal error', e); }
    }

    // Wire input events -> applyLocal (listen to both input and change so steppers update immediately)
    Object.values(inputs).forEach(el => {
        if (!el) return;
        // 'input' fires on every value change (including stepper clicks); 'change' handles commit/blur
        el.addEventListener('input', () => { try { applyLocal(); } catch(_){} });
        el.addEventListener('change', () => { try { applyLocal(); } catch(_){} });
    });

    btnToggle.addEventListener('click', () => {
        const wasHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        panel.setAttribute('aria-hidden', panel.classList.contains('hidden'));
        if (!panel.classList.contains('hidden')) {
            // Ensure export panel isn't open
            const ep = document.getElementById('export-panel'); if (ep) ep.classList.add('hidden');
            populate();
            // Attach outside-click and Esc handlers to close the panel
            const outsideHandler = (e) => {
                if (!panel.contains(e.target) && e.target !== btnToggle && !btnToggle.contains(e.target)) {
                    closePanel();
                    document.removeEventListener('click', outsideHandler);
                    document.removeEventListener('keydown', escHandler);
                }
            };
            const escHandler = (e) => { if (e.key === 'Escape') { closePanel(); document.removeEventListener('click', outsideHandler); document.removeEventListener('keydown', escHandler); } };
            panel._outsideHandler = outsideHandler;
            panel._escHandler = escHandler;
            setTimeout(()=> document.addEventListener('click', outsideHandler), 0);
            document.addEventListener('keydown', escHandler);
        } else {
            if (panel._outsideHandler) { document.removeEventListener('click', panel._outsideHandler); panel._outsideHandler = null; }
            if (panel._escHandler) { document.removeEventListener('keydown', panel._escHandler); panel._escHandler = null; }
        }
    });

    const closePanel = () => { panel.classList.add('hidden'); panel.setAttribute('aria-hidden', 'true'); if (panel._outsideHandler) { document.removeEventListener('click', panel._outsideHandler); panel._outsideHandler = null; } if (panel._escHandler) { document.removeEventListener('keydown', panel._escHandler); panel._escHandler = null; } };
    if (btnClose) btnClose.addEventListener('click', closePanel);
    if (btnClose2) btnClose2.addEventListener('click', closePanel);

    btnSaveProject.addEventListener('click', async () => {
        // Save current panel values to project file
        try {
            const cur = SettingsManager.getAll();
            const obj = { ...cur };
            // apply input values first
            applyLocal();
            const newObj = SettingsManager.getAll();
            const ok = await SettingsManager.saveProjectFile(newObj);
            closePanel();
            showTransient(ok ? 'Saved to project config.' : 'Save failed (see console)');
        } catch (e) { console.error('save project failed', e); showTransient('Save failed'); }
    });

    btnReset.addEventListener('click', () => {
        try {
            // Reset to factory defaults (clears local overrides, ignores project config)
            SettingsManager.resetToDefaults();
            // repopulate UI
            populate();
            showTransient('Reset to factory defaults.');
        } catch (e) { console.error('reset failed', e); }
    });

    // Subscribe to live changes so the UI stays in sync
    SettingsManager.subscribe((k, v, all) => {
        try { populate(); } catch (e) {}
    });

    function showTransient(msg) {
        const el = document.createElement('div');
        el.innerText = msg;
        el.className = 'fixed right-6 bottom-6 bg-black text-white px-3 py-1 rounded opacity-90';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }
}

// Auto-setup when module is imported in a browser context
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        try { setupSettingsPanel(document.querySelector('svg'), window.__appState || null); } catch(_){}
    });
}

export default setupSettingsPanel;