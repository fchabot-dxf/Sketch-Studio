// SETTINGS MANAGER
// Single source for UI-configurable settings with project/local persistence

import { SolverConfig } from './solver-config.js';

let fs = null;
let path = null;
let canWriteProject = false;
try {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        fs = require('fs');
        path = require('path');
        canWriteProject = true;
    }
} catch (e) {
    // Browser environment - no fs
}

const PROJECT_FILE = 'sketch-studio.config.json';

const DEFAULT_SETTINGS = {
    // Mirror important solver defaults for UI
    SNAP_RADIUS: SolverConfig.SNAP_RADIUS || 30,
    SNAP_MAGNETISM: SolverConfig.SNAP_MAGNETISM || 10,
    GRID_MAGNETISM: SolverConfig.GRID_MAGNETISM || 10,
    GRID_DENSITY: 2,
    GRID_SIZE: 2,
    GRID_MAJOR_STEP: 10,
    SHOW_GRID: true,

    // Visual defaults
    LINE_STROKE: 1.0,
    JOINT_RADIUS: 4,
    JOINT_STROKE_MULT: 1.0,
    SELECTION_FEEDBACK_MULT: 2,
    HOVER_FEEDBACK_MULT: 3,
    LINE_CAP: 'round',
    LINE_JOIN: 'round',
    BACKGROUND: 'light',
    LABEL_FONT_SIZE: 12,
    GLYPH_SYMBOL_SIZE_PX: 20,
    GLYPH_INFERENCE_SIZE_PX: 24,
    GLYPH_OFFSET_PX: 40,
    GLOW_WIDTH_PX: 20,
    DASH_LENGTH_PX: 8,
    DASH_GAP_PX: 8,

    // Debug
    SHOW_DEBUG_OVERLAY: false,
    DEBUG_OFFSET_X: 23,             // Right-side gutter for debug labels (screen px) — reduced to 0.5×
    DEBUG_FOCUS_OPACITY: 1.0,       // Opaque background when a cluster is focused
    DEBUG_SPRING_W: 18,             // Critically-damped spring angular frequency (higher = stiffer)
    DEBUG_LABEL_LINE_SPACING: 1.1,  // Multiplier between stacked debug label lines (1.0 = compact)
    DEBUG_LABEL_INTRA_LINE_SPACING: 0.90, // Spacing multiplier *within* a multi-line label (tightened for density)
    DEBUG_LABEL_PER_SRC_GAP: 1.00,  // Multiplier applied to additional `src:` lines inside a label (1.0 = default)
    DEBUG_LABEL_FONT_SIZE: 9,        // Debug overlay label font size in screen px (separate from LABEL_FONT_SIZE)
    SHOW_TENSION: false,
    SHOW_FREEDOM: false,
    SHOW_HEALTH: false,

    // Whisker debug visuals (stroke in SCREEN px)
    DEBUG_WHISKER_STROKE_PX: 0.03,
    // AI Vision: high-density debug/AI diagnostics mode (false by default)
    AI_VISION: false,

    // Preset name
    PRESET: 'CAD',

    // Document unit (U1, INERT): the display/input unit for dimension + cut-param fields. Base = 1 world unit = 1 mm
    // (see #core/units.js); switching RE-LABELS (no resize). Default 'mm' = the base, so a bare number is unchanged.
    // Nothing reads it yet (the toggle UI is U3) → additive, both apps byte-identical.
    DOC_UNIT: 'mm'
};

class SettingsManager {
    constructor() {
        this._settings = { ...DEFAULT_SETTINGS };
        this._subscribers = new Set();
        this._project = {};
        this._local = {};
        this.load();
    }

    load() {
        // 1. Load project config (if available)
        this._project = {};
        if (canWriteProject) {
            try {
                const p = path.resolve(process.cwd(), PROJECT_FILE);
                if (fs.existsSync(p)) {
                    const raw = fs.readFileSync(p, 'utf8');
                    this._project = JSON.parse(raw || '{}');
                }
            } catch (e) {
                console.warn('[SettingsManager] failed to read project config:', e);
            }
        } else if (typeof document !== 'undefined') {
            // Browser standalone: look for embedded project config in a <script id="project-config"> tag
            try {
                const el = document.getElementById('project-config');
                if (el) {
                    const raw = el.textContent || el.innerText || '';
                    if (raw && raw.trim()) this._project = JSON.parse(raw);
                }
            } catch (e) {
                console.warn('[SettingsManager] failed to parse embedded project config:', e);
            }
        }

        // 2. Load local overrides from localStorage (browser)
        this._local = {};
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('sketch-studio-settings');
                if (raw) this._local = JSON.parse(raw || '{}');
            }
        } catch (e) {
            // Not a browser, or localStorage unavailable
        }

        // 3. Merge: defaults <- project <- local
        this._settings = { ...DEFAULT_SETTINGS, ...this._project, ...this._local };
        this._emitChange();
    }

    get(key) {
        if (!key) return { ...this._settings };
        return this._settings[key] !== undefined ? this._settings[key] : null;
    }

    set(key, value, opts = { persist: 'local' }) {
        const old = this._settings[key];
        if (old === value) return;
        this._settings[key] = value;

        // Persist
        if (opts.persist === 'local' || opts.persist === 'both') {
            try {
                this._local[key] = value;
                if (typeof localStorage !== 'undefined') localStorage.setItem('sketch-studio-settings', JSON.stringify(this._local));
            } catch (e) { console.warn('[SettingsManager] failed to save to localStorage', e); }
        }
        if ((opts.persist === 'project' || opts.persist === 'both') && canWriteProject) {
            try {
                this._project[key] = value;
                const p = path.resolve(process.cwd(), PROJECT_FILE);
                fs.writeFileSync(p, JSON.stringify(this._project, null, 2), 'utf8');
            } catch (e) { console.warn('[SettingsManager] failed to write project config', e); }
        }

        this._emitChange(key, value);
    }

    subscribe(fn) { this._subscribers.add(fn); return () => this._subscribers.delete(fn); }
    _emitChange(key = null, value = null) {
        for (const fn of this._subscribers) {
            try { fn(key, value, { ...this._settings }); } catch (e) { console.error('[SettingsManager] subscriber error', e); }
        }
    }

    // Convenience helpers
    // Return settings with derived properties (GLYPH_BG_DIAMETER_PX is derived from GLYPH_SYMBOL_SIZE_PX)
    getAll() { const base = { ...this._settings }; const symbol = Number(base.GLYPH_SYMBOL_SIZE_PX || 20); base.GLYPH_BG_DIAMETER_PX = Math.round(symbol * 1.6); return base; }
    
    // Reset to factory defaults (ignores project and local overrides)
    resetToDefaults() {
        // Clear local storage
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.removeItem('sketch-studio-settings');
            }
        } catch (e) { console.warn('[SettingsManager] failed to clear localStorage', e); }
        
        // Reset internal state to defaults only (ignore project config)
        this._local = {};
        this._settings = { ...DEFAULT_SETTINGS };
        this._emitChange();
        console.log('[SettingsManager] Reset to factory defaults');
    }
    
    // Get the factory default value for a key
    getDefault(key) {
        return DEFAULT_SETTINGS[key];
    }
    
    // Get all factory defaults
    getDefaults() {
        return { ...DEFAULT_SETTINGS };
    }
    
    async saveProjectFile(obj) {
        // Node filesystem case (project file in repo)
        if (canWriteProject) {
            try {
                const p = path.resolve(process.cwd(), PROJECT_FILE);
                fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
                this._project = obj;
                this._settings = { ...DEFAULT_SETTINGS, ...this._project, ...this._local };
                this._emitChange();
                return true;
            } catch (e) { console.warn('[SettingsManager] saveProjectFile error', e); return false; }
        }

        // Browser standalone: embed project config in HTML and attempt to write directly using
        // the File System Access API (showSaveFilePicker). If not available, fall back to download.
        if (typeof document !== 'undefined') {
            try {
                // Update or create a <script id="project-config" type="application/json"> tag
                let el = document.getElementById('project-config');
                if (!el) {
                    el = document.createElement('script');
                    el.id = 'project-config';
                    el.type = 'application/json';
                    // Place near head for readability
                    if (document.head) document.head.appendChild(el);
                    else document.body.appendChild(el);
                }
                el.textContent = JSON.stringify(obj, null, 2);

                // Serialize full HTML (include DOCTYPE)
                const doctype = new XMLSerializer().serializeToString(document.doctype || new DOMParser().parseFromString('<!doctype html>', 'text/html'));
                const html = doctype + "\n" + document.documentElement.outerHTML;

                // Prefer File System Access API if available (allows replacing the original file)
                if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
                    try {
                        const suggestedName = (window.location && window.location.pathname) ? window.location.pathname.split('/').pop() || 'sketch-studio-standalone.html' : 'sketch-studio-standalone.html';
                        const handle = await window.showSaveFilePicker({
                            suggestedName,
                            types: [{ description: 'HTML File', accept: { 'text/html': ['.html', '.htm'] } }]
                        });
                        const writable = await handle.createWritable();
                        await writable.write(html);
                        await writable.close();

                        // Keep runtime state consistent
                        this._project = obj;
                        this._settings = { ...DEFAULT_SETTINGS, ...this._project, ...this._local };
                        this._emitChange();
                        return true;
                    } catch (e) {
                        console.warn('[SettingsManager] saveProjectFile (FS Access) failed, falling back to download', e);
                        // If FS API fails, fall through to download fallback
                    }
                }

                // Fallback: trigger download of updated HTML
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const name = (window.location && window.location.pathname) ? window.location.pathname.split('/').pop() || 'sketch-studio-standalone.html' : 'sketch-studio-standalone.html';
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);

                // Keep runtime state consistent
                this._project = obj;
                this._settings = { ...DEFAULT_SETTINGS, ...this._project, ...this._local };
                this._emitChange();
                return true;
            } catch (e) { console.warn('[SettingsManager] saveProjectFile (standalone) error', e); return false; }
        }

        return false;
    }
}

const mgr = new SettingsManager();
export default mgr;