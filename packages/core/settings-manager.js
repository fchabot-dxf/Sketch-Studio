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
    // The mm grid's DEFAULTS (task 532, owner: every 100 mm heavy, 10 per heavy). ONE place: the renderer, the snap and the
    // panel all read these through SettingsManager (a stored value or a template wins; a mm file with 2 / 10 stored is the old grid).
    GRID_SIZE: 10,
    GRID_MAJOR_STEP: 100,
    SHOW_GRID: true,
    // Grid style drawn by the shared canvas grid (#ui/canvas-grid.js): 'lines' | 'off' | 'points'. Default 'lines' = the
    // grid SketchStudio always drew. A genuine display preference → persisted locally like the other display settings.
    GRID_MODE: 'lines',
    // Minor squares per inch in an INCH file (#ui/canvas-grid.js GRID_INCH_DIVISIONS: 10 | 2 | 4 | 8 | 16; the major stays 1 in).
    // Default 10 = decimal tenths. Read only when DOC_UNIT is 'in'; a mm file never reads it.
    INCH_GRID_DIVISIONS: 10,
    // Major (heavy) line spacing in an INCH file, in inches (any positive number; default 1). minor = this / INCH_GRID_DIVISIONS.
    INCH_GRID_MAJOR: 1,

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
    // Look knobs a style template owns (#ui/style-templates.js). Defaults = today's look.
    GLYPH_STYLE: 'badge',           // constraint glyphs: 'badge' (coloured disc + white icon) | 'fusion' (the owner's glyph sheet, white fill + outline)
  GLYPH_OUTLINE_PX: 1,            // 'fusion' glyph outline width (screen px, 0.2-4)
    DIM_LABEL_BOX: true,            // dimension value drawn on a filled label box; false = plain text on the dimension line
    HOVER_COLOR: '#1e40af',         // stroke of a hovered line/joint ('#1e40af' routes through --sk-selection; any other value is literal)
    FIXED_JOINT_FILL: 'white',      // fill of fixed / fully constrained joints: 'white' (hollow ring) | a colour (solid dot)
    LABEL_FONT_FAMILY: '',          // font-family of dimension values/labels: '' = inherit from the host page (today's look) | a CSS font stack
    PROFILE_FILL: 'off',            // 'on' = every closed loop gets a translucent tint behind the geometry (--sk-profile-tint)
    LOCKED_LINE_COLOR: '',          // colour of fully LOCKED lines/joints (all joints fixed:true); '' = same as any fully constrained one

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

    // Save to Google Drive by default (TASK 506): while signed in, NEW projects / designs are created on Drive and their autosave goes there.
    // Only has an effect while signed in. A sidebar account-area toggle, not a Style panel row.
    DRIVE_DEFAULT: true,

    // The Style panel's chosen template id (#ui/style-templates.js); replaces the never-read PRESET: 'CAD'.
    STYLE_TEMPLATE: 'default',

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
}

const mgr = new SettingsManager();
export default mgr;