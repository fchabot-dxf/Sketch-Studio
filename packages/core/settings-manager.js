// SETTINGS MANAGER
// Single source for UI-configurable settings with project/local persistence

import { SolverConfig } from './solver-config.js';
import { format as formatUnit, formatFraction, basePer } from './units.js';

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
    SNAP_MAGNETISM: SolverConfig.SNAP_MAGNETISM,
    GRID_MAGNETISM: SolverConfig.GRID_MAGNETISM || 10,
    // Task 537: a point drawn / dragged near the X axis (y = 0) or the Y axis (x = 0) snaps onto it and gets the horizontal /
    // vertical constraint with the origin joint. true = on (default); false = no axis snap.
    AXIS_SNAP: true,
    // Task 549: how a CHAIN of lines (click-click-click) is undone. 'per-segment' (default) = each committed segment is its own undo step
    // (undo removes the last segment and its new end point; the shared start point stays, the previous segment owns it).
    // 'per-tool-session' = the whole chain, from the first click to Esc / Enter / another tool, is ONE undo step.
    // Every other tool draws one element per step whatever this says. The ONE switch lives here; read only by line-tool.js.
    LINE_CHAIN_UNDO: 'per-segment',
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
    LINE_STROKE: 0.25,
    JOINT_RADIUS: 1.0,
    JOINT_STROKE_MULT: 0.67,
    SELECTION_FEEDBACK_MULT: 2.33,
    HOVER_FEEDBACK_MULT: 2,
    LINE_CAP: 'round',
    LINE_JOIN: 'round',
    BACKGROUND: 'light',
    LABEL_FONT_SIZE: 12,
    GLYPH_SYMBOL_SIZE_PX: 25,
    GLYPH_INFERENCE_SIZE_PX: 16,
    GLYPH_OFFSET_PX: 22,
    DASH_LENGTH_PX: 7,
    DASH_GAP_PX: 4,
    // Look knobs a style template owns (#ui/style-templates.js). Defaults = the Fusion look (task 630); the Fusion colours are the --sk-* stylesheet defaults.
    GLYPH_OUTLINE_PX: 0.5,          // constraint glyph outline width (screen px, 0.2-4)
    DIM_LABEL_BOX: false,           // dimension value drawn on a filled label box; false = plain text on the dimension line
    LABEL_FONT_FAMILY: 'Segoe UI, Arial, Helvetica, sans-serif', // font-family of dimension values/labels: '' = inherit from the host page | a CSS font stack
    PROFILE_FILL: 'on',             // 'on' = every closed loop gets a translucent tint behind the geometry (--sk-profile-tint)
    INACTIVE_SKETCH_OPACITY: 33,    // task 661: percent (0-100); every sketch but the active one draws at this opacity (svg-renderer.js writes the token --sk-inactive-sketch-opacity). Not a template key: a saved style preset need not carry it
    LOCKED_LINE_COLOR: '#8DB84A',   // colour of fully LOCKED lines/joints (all joints fixed:true); '' = same as any fully constrained one

    // Task 586: the floating Design BROWSER (SKETCHES tree, #ui/design-browser.js) is shrunk to its header bar. A per-user display preference
    // (local), shared by all four apps, never saved in a document.
    BROWSER_COLLAPSED: false,
    // Task 647: the user's tool-ribbon layout per app and section (which tools are in the bar, their order); null = the declared defaults.
    // The shape and the merge rules are #ui/ribbon-layout.js. A per-user display preference (local), never saved in a document.
    RIBBON_LAYOUT: null,
    // Task 692: favourite template ids in the order they were starred ({ v: 1, ids: [id...] }); local-only, shared across all four apps.
    TEMPLATE_FAVOURITES: { v: 1, ids: [] },
    // Task 747: the user's own keyboard shortcuts ({ v: 1, keys: { <shortcut id>: [combo...] } }), ONLY the ids the user changed ([] = no key).
    // Read and written only by #ui/shortcuts.js (it validates the shape on read); local, shared by all four apps, never in a document.
    SHORTCUT_KEYS: { v: 1, keys: {} },

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

    // The Style panel's chosen template id (#ui/style-templates.js); replaces the never-read PRESET: 'CAD'.
    STYLE_TEMPLATE: 'default',
    // The user's own named style presets (#ui/style-templates.js): { v: 1, presets: [{ id, name, settings, tokens? }] }. Per user, local
    // (never in a drawing document, never on Drive). The shape is validated on read there; an entry that fails is dropped with a warning.
    STYLE_PRESETS: { v: 1, presets: [] },

    // Document unit (U1, INERT): the display/input unit for dimension + cut-param fields. Base = 1 world unit = 1 mm
    // (see #core/units.js); switching RE-LABELS (no resize). Default 'mm' = the base, so a bare number is unchanged.
    // Nothing reads it yet (the toggle UI is U3) → additive, both apps byte-identical.
    DOC_UNIT: 'mm',

    // Task 724 / 770: DISPLAY precision (decimals shown), ONE rule across every view of all four apps (Auto removed):
    // LENGTH_PRECISION 0-6 (default 3 -> 0.000), ANGLE_PRECISION 0-4 (default 1 -> 0.0°), trailing zeros dropped unless TRAILING_ZEROS is on.
    // Display only: stored values, expressions, exported files and the solver never read these. Local, shared by all four apps.
    LENGTH_PRECISION: 3,
    ANGLE_PRECISION: 1,
    TRAILING_ZEROS: false,
    // Task 728: how an INCH document shows its lengths: 'decimal' (1.5 in, the precision above) | 'fractional' (1 1/2", the nearest LENGTH_FRACTION-th
    // of an inch, like a tape measure). Read only while DOC_UNIT is 'in' (mm / cm documents are always decimal). Display only, local, shared by all four apps.
    INCH_DISPLAY: 'decimal',
    LENGTH_FRACTION: 16
};

/** The active document unit ('mm' | 'cm' | 'in'), defaulting to 'mm'. */
export const docUnit = () => mgr.get('DOC_UNIT') || 'mm';

// Task 724 / 770: THE one place that decides how many decimals a displayed number gets (no Auto override per view).
export const LENGTH_PRECISION_MAX = 6;
export const ANGLE_PRECISION_MAX = 4;
const validPrecision = (v, max, def) => (Number.isInteger(v) && v >= 0 && v <= max ? v : def);
const readSetting = (bag, key) => {
    if (key === 'LENGTH_PRECISION') return validPrecision(bag[key], LENGTH_PRECISION_MAX, DEFAULT_SETTINGS.LENGTH_PRECISION);
    if (key === 'ANGLE_PRECISION') return validPrecision(bag[key], ANGLE_PRECISION_MAX, DEFAULT_SETTINGS.ANGLE_PRECISION);
    if (key === 'TRAILING_ZEROS') return Boolean(bag[key]);
    return bag[key] !== undefined ? bag[key] : null;
};
/** Whether a changed setting key is a display-precision / length-format one (views that cache formatted text re-render on it). */
export const isPrecisionKey = (key) => key === 'LENGTH_PRECISION' || key === 'ANGLE_PRECISION' || key === 'TRAILING_ZEROS' || key === 'INCH_DISPLAY' || key === 'LENGTH_FRACTION';
/** Decimals for a displayed length (any unit): always the Length precision setting (default 3). */
export const lengthDecimals = () => mgr.get('LENGTH_PRECISION');
/** Decimals for a displayed angle (degrees): always the Angle precision setting (default 1). */
export const angleDecimals = () => mgr.get('ANGLE_PRECISION');

// Drop trailing zeros when TRAILING_ZEROS is off ("0.250" -> "0.25", "1.000" -> "1", "-0.000" -> "0"); keep fixed width when ON (avoiding "-0.000").
const trimDecimal = (str) => {
    if (mgr.get('TRAILING_ZEROS')) return Number(str) === 0 && str.startsWith('-') ? str.slice(1) : str;
    const trimmed = str.indexOf('.') >= 0 ? str.replace(/0+$/, '').replace(/\.$/, '') : str;
    return trimmed === '-0' ? '0' : trimmed;
};

// Task 728 / 770: THE one place that decides the TEXT of a displayed length (every view calls lengthText; none formats a length itself).
export const LENGTH_FRACTIONS = [8, 16, 32, 64];      // the Fractional precision choices: 1/8 .. 1/64 of an inch
/** The fraction denominator a length shown in `unit` gets: the LENGTH_FRACTION setting while an inch document shows fractions, else null (decimals). */
export const lengthFraction = (unit = docUnit()) => {
    if (unit !== 'in' || docUnit() !== 'in' || mgr.get('INCH_DISPLAY') !== 'fractional') return null;
    const d = mgr.get('LENGTH_FRACTION');
    return LENGTH_FRACTIONS.includes(d) ? d : DEFAULT_SETTINGS.LENGTH_FRACTION;
};
/**
 * A length (base mm) as display text in `unit` (default the document unit), at LENGTH_PRECISION (default 3) with trailing zeros dropped unless TRAILING_ZEROS is ON.
 *   fractions: false for a TOLERANCE finer than any fraction (always decimals).
 *   show: 'bare'    the number alone, as a dimension label / an edit box shows it: "1.5" | 1 1/2"   (a fraction always carries its inch mark)
 *         'unit'    with its unit, as a sentence shows it:                             "1.5 in" | 1 1/2"
 *         'field'   the number in a field whose unit is printed beside it:              "1.5" | "1 1/2"
 *         'compact' the number glued to its unit:                                       "1.5in" | 1 1/2"
 * In Fractional mode the value is shown as the NEAREST fraction (Fusion's way: no "≈" mark); values below half of 1/den (except 0) fall back to decimals.
 */
export function lengthText(mm, { unit = docUnit(), show = 'bare', fractions = true } = {}) {
    if (mm == null || !Number.isFinite(Number(mm))) return '';
    const den = fractions ? lengthFraction(unit) : null;
    let least = 0; // TASK 757: the fewest decimals a small length falling back from Fractional needs to show its first significant digit
    if (den) {
        const v = Number(mm) / basePer('in');
        if (Math.abs(v) < 0.5 * 10 ** -LENGTH_PRECISION_MAX || Math.round(Math.abs(v) * den) > 0) { const f = formatFraction(v, den); return show === 'field' ? f : `${f}"`; }
        least = Math.min(LENGTH_PRECISION_MAX, Math.ceil(-Math.log10(Math.abs(v))));
    }
    const decimals = Math.max(lengthDecimals(), least);
    const body = trimDecimal(formatUnit(mm, unit, { decimals }));
    if (show === 'compact') return `${body}${unit}`;
    return show === 'unit' ? `${body} ${unit}` : body;
}
/** An angle (degrees) as display text at ANGLE_PRECISION (default 1); trailing zeros dropped unless TRAILING_ZEROS is ON. show: 'bare' | 'deg' | 'unit'. */
export function angleText(deg, { show = 'bare' } = {}) {
    if (deg == null || !Number.isFinite(Number(deg))) return '';
    const body = trimDecimal(Number(Number(deg).toPrecision(12)).toFixed(angleDecimals()));
    return show === 'deg' ? `${body}°` : show === 'unit' ? `${body} deg` : body;
}
/** An area (base mm²) as "2.48 in²" text: decimals always (Length precision + trailing zeros rule), never a fraction. */
export const areaText = (mm2, { unit = docUnit() } = {}) => {
    const f = basePer(unit);
    return `${trimDecimal(Number((mm2 / (f * f)).toPrecision(12)).toFixed(lengthDecimals()))} ${unit}²`;
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
        if (!key) return this.getAll();
        return readSetting(this._settings, key);
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
        const snap = this.getAll(), normalized = key ? readSetting(this._settings, key) : value;
        for (const fn of this._subscribers) {
            try { fn(key, normalized, snap); } catch (e) { console.error('[SettingsManager] subscriber error', e); }
        }
    }

    // Convenience helpers
    getAll() {
        return {
            ...this._settings,
            LENGTH_PRECISION: readSetting(this._settings, 'LENGTH_PRECISION'),
            ANGLE_PRECISION: readSetting(this._settings, 'ANGLE_PRECISION'),
            TRAILING_ZEROS: readSetting(this._settings, 'TRAILING_ZEROS'),
        };
    }
    
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