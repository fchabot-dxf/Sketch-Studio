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
    // Task 842: Shaper's TOOL TABLE, the user's bit library ({ v: 1, bits: [...] }); null = the table's first-use bits. Read and written only by
    // apps/shaper/src/tool-table.js (it validates every bit on read); per user, for all his designs (a design keeps a copy of each bit it uses), never in a document.
    SHAPER_TOOL_TABLE: null,

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

// TASK 773: the settings that FOLLOW THE USER to his other devices (#ui/cloud/settings-sync.js keeps them in "Sketch Studio/Settings/settings.json" on his
// Google Drive while he is signed in). The ONE declaration of which keys leave this device; every other key stays device-only (a debug knob, the file
// dialog's last tab and the browser's collapsed state are device or screen state; see WORK-LOG ## TURN 773 for the table).
// Only a value the user CHOSE travels (a set() persisted on this device, or a reset): a host's in-memory default (persist: false) never does.
export const SYNCED_SETTING_KEYS = Object.freeze([
    // Units
    'DOC_UNIT', 'INCH_DISPLAY', 'LENGTH_PRECISION', 'LENGTH_FRACTION', 'ANGLE_PRECISION', 'TRAILING_ZEROS',
    // Grid & snap
    'SHOW_GRID', 'GRID_MODE', 'SNAP_MAGNETISM', 'AXIS_SNAP', 'GRID_MAGNETISM', 'GRID_MAJOR_STEP', 'GRID_SIZE', 'INCH_GRID_MAJOR', 'INCH_GRID_DIVISIONS',
    // The look (the style template's keys, #ui/style-templates.js STYLE_SETTING_KEYS) + the inactive sketches' opacity
    'LINE_STROKE', 'JOINT_RADIUS', 'JOINT_STROKE_MULT', 'SELECTION_FEEDBACK_MULT', 'HOVER_FEEDBACK_MULT',
    'GLYPH_SYMBOL_SIZE_PX', 'GLYPH_INFERENCE_SIZE_PX', 'GLYPH_OFFSET_PX', 'GLYPH_OUTLINE_PX', 'DASH_LENGTH_PX', 'DASH_GAP_PX',
    'DIM_LABEL_BOX', 'LABEL_FONT_FAMILY', 'PROFILE_FILL', 'LOCKED_LINE_COLOR', 'INACTIVE_SKETCH_OPACITY',
    // The user's own data kept as settings: the chosen template, his presets, his keyboard shortcuts, his favourite templates
    'STYLE_TEMPLATE', 'STYLE_PRESETS', 'SHORTCUT_KEYS', 'TEMPLATE_FAVOURITES',
    // Task 842: Shaper's tool table (his bits follow him like his shortcuts do)
    'SHAPER_TOOL_TABLE',
    // TASK 773b (owner turn 2364: "per account"): the tool-ribbon layout, synced PER APP (SYNCED_BY_PART below)
    'RIBBON_LAYOUT',
]);
const SYNCED = new Set(SYNCED_SETTING_KEYS);
/** Whether a setting key follows the user to his other devices (TASK 773). */
export const isSyncedSetting = (key) => SYNCED.has(key);
// TASK 773b: a synced key whose value holds INDEPENDENT parts is synced and merged PART BY PART, each part with its own time, so a change to one part never
// overwrites another part changed elsewhere. { KEY: { field, empty } }: the parts are value[field][<part id>]; `empty` is the value a device with no stored
// copy starts from. RIBBON_LAYOUT is { v: 1, apps: { <appId>: { <section>: { order, off } } } } (#ui/ribbon-layout.js, RIBBON_LAYOUT_VERSION 1): one part
// per APP, so a Shaper layout changed on one device and a SketchStudio layout changed on another both survive. Its entries are 'RIBBON_LAYOUT:<appId>'.
export const SYNCED_BY_PART = Object.freeze({ RIBBON_LAYOUT: Object.freeze({ field: 'apps', empty: Object.freeze({ v: 1, apps: Object.freeze({}) }) }) });
const PART_SEP = ':';
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const partKey = (key, id) => key + PART_SEP + id;
const splitPartKey = (k) => { const i = String(k).indexOf(PART_SEP); return i > 0 && i < String(k).length - 1 ? { key: k.slice(0, i), id: k.slice(i + 1) } : null; };
const partsOf = (key, value) => {
    const f = value && typeof value === 'object' ? value[SYNCED_BY_PART[key].field] : null;
    return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
};
/** Whether a settings-file ENTRY key is one this version syncs: a synced key, or 'KEY:<part>' of a key synced by part (TASK 773b). */
export function isSyncedEntryKey(k) {
    if (SYNCED.has(k)) return !SYNCED_BY_PART[k];
    const s = splitPartKey(k);
    return !!(s && SYNCED.has(s.key) && SYNCED_BY_PART[s.key]);
}
const LOCAL_KEY = 'sketch-studio-settings';
// TASK 773: when each locally persisted key was last changed, and on which device ({ KEY: { at: ms, by?: device id } }; no `by` = this device). A key
// changed before TASK 773 has no stamp: it counts as changed at time 0 (older than any stamped change).
const STAMPS_KEY = 'sketch-studio-settings-stamps';
const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

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
    // storage: the Web Storage the local overrides live in (default: the page's localStorage, looked up at each use as before); now(): the clock of the
    // TASK 773 change stamps. Both injectable so a node test can run two "devices" side by side with the same code.
    constructor({ storage, now = () => Date.now() } = {}) {
        this._settings = { ...DEFAULT_SETTINGS };
        this._subscribers = new Set();
        this._project = {};
        this._local = {};
        this._stamps = {};
        this._storage = storage;
        this._now = now;
        this.load();
    }

    _store() {
        if (this._storage !== undefined) return this._storage;
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }
    _saveLocal() {
        const st = this._store();
        if (!st) return;
        st.setItem(LOCAL_KEY, JSON.stringify(this._local));
        st.setItem(STAMPS_KEY, JSON.stringify(this._stamps));
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
        this._stamps = {};
        try {
            const st = this._store();
            if (st) {
                const raw = st.getItem(LOCAL_KEY);
                if (raw) this._local = JSON.parse(raw || '{}');
                const stamps = st.getItem(STAMPS_KEY);
                if (stamps) this._stamps = JSON.parse(stamps) || {};
            }
        } catch (e) {
            // Not a browser, or localStorage unavailable
        }

        // 3. Merge: defaults <- project <- local
        this._settings = { ...DEFAULT_SETTINGS, ...this._project, ...this._local };
        this._emitChange(null, null, { source: 'load' });
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
                const at = this._now();
                this._stamps[key] = { at }; // TASK 773: changed now, on this device
                if (SYNCED_BY_PART[key]) { // TASK 773b: each part that changed is stamped on its own
                    const a = partsOf(key, old), b = partsOf(key, value);
                    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (!sameValue(a[id], b[id])) this._stamps[partKey(key, id)] = { at };
                }
                this._saveLocal();
            } catch (e) { console.warn('[SettingsManager] failed to save to localStorage', e); }
        }
        if ((opts.persist === 'project' || opts.persist === 'both') && canWriteProject) {
            try {
                this._project[key] = value;
                const p = path.resolve(process.cwd(), PROJECT_FILE);
                fs.writeFileSync(p, JSON.stringify(this._project, null, 2), 'utf8');
            } catch (e) { console.warn('[SettingsManager] failed to write project config', e); }
        }

        this._emitChange(key, value, { source: 'local' });
    }

    // fn(key, value, all, { source }): key null = every setting may have changed (a load or a reset). TASK 773: source says where the change came from:
    // 'local' (a set() on this page), 'sync' (another device's change arriving from Google Drive), 'load', 'reset'. Every subscriber reacts the same way
    // to each; only the settings sync reads it (it never sends a change back that it just received).
    subscribe(fn) { this._subscribers.add(fn); return () => this._subscribers.delete(fn); }
    _emitChange(key = null, value = null, meta = { source: 'local' }) {
        const snap = this.getAll(), normalized = key ? readSetting(this._settings, key) : value;
        for (const fn of this._subscribers) {
            try { fn(key, normalized, snap, meta); } catch (e) { console.error('[SettingsManager] subscriber error', e); }
        }
    }

    /** TASK 773: this device's SYNCED settings as per-key entries { KEY: { value, at, by } | { reset: true, at, by } }: every synced key the user set
     *  (or reset) here or received from another device. `by` null = changed on this device. A key never touched has no entry. */
    syncEntries() {
        const out = {};
        const entry = (stamp, body) => ({ ...body, at: stamp && Number.isFinite(stamp.at) ? stamp.at : 0, by: (stamp && stamp.by) || null });
        for (const key of SYNCED_SETTING_KEYS) {
            if (SYNCED_BY_PART[key]) { // TASK 773b: one entry per part ('KEY:<part>'); a part removed here (back to its defaults) is a reset of that part
                const parts = hasOwn(this._local, key) ? partsOf(key, this._local[key]) : {};
                const stamped = Object.keys(this._stamps).map(splitPartKey).filter((x) => x && x.key === key).map((x) => x.id);
                for (const id of new Set([...Object.keys(parts), ...stamped])) {
                    const k = partKey(key, id);
                    out[k] = entry(this._stamps[k], hasOwn(parts, id) ? { value: parts[id] } : { reset: true });
                }
                continue;
            }
            const has = Object.prototype.hasOwnProperty.call(this._local, key), stamp = this._stamps[key];
            if (!has && !stamp) continue;
            const at = stamp && Number.isFinite(stamp.at) ? stamp.at : 0, by = (stamp && stamp.by) || null;
            out[key] = has ? { value: this._local[key], at, by } : { reset: true, at, by };
        }
        return out;
    }

    /** TASK 773: apply other devices' newer changes ({ KEY: entry } as syncEntries gives them; keys that are not synced are ignored). Each is kept on this
     *  device with ITS stamp (so it is not sent back as a change of this device); subscribers hear every key whose value changed, with source 'sync'.
     *  Returns the keys whose value changed. */
    applySynced(entries) {
        const changed = [];
        const byPart = {}; // TASK 773b: base key -> its parts after the arrived part entries
        for (const [key, e] of Object.entries(entries || {})) {
            if (!isSyncedEntryKey(key) || !e) continue;
            const part = SYNCED.has(key) ? null : splitPartKey(key);
            if (part) {
                const parts = byPart[part.key] || (byPart[part.key] = { ...partsOf(part.key, this._settings[part.key]) });
                if (e.reset) delete parts[part.id]; else parts[part.id] = e.value;
                this._stamps[key] = e.by ? { at: e.at, by: e.by } : { at: e.at };
                continue;
            }
            const before = this._settings[key];
            if (e.reset) {
                delete this._local[key];
                this._settings[key] = Object.prototype.hasOwnProperty.call(this._project, key) ? this._project[key] : DEFAULT_SETTINGS[key];
            } else {
                this._local[key] = e.value;
                this._settings[key] = e.value;
            }
            this._stamps[key] = e.by ? { at: e.at, by: e.by } : { at: e.at };
            if (!sameValue(before, this._settings[key])) changed.push(key);
        }
        for (const [key, parts] of Object.entries(byPart)) { // the other fields of the stored value (RIBBON_LAYOUT's v) are kept
            const before = this._settings[key], spec = SYNCED_BY_PART[key];
            const shell = before && typeof before === 'object' && !Array.isArray(before) ? before : spec.empty;
            const next = { ...shell, [spec.field]: parts };
            this._local[key] = next; this._settings[key] = next;
            if (!sameValue(before, next)) changed.push(key);
        }
        try { this._saveLocal(); } catch (e) { console.warn('[SettingsManager] failed to save to localStorage', e); }
        for (const key of changed) this._emitChange(key, this._settings[key], { source: 'sync' });
        return changed;
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
        // TASK 773: every key is stamped "reset now, on this device", so the reset follows the user to his other devices (a synced key) like a change does
        const at = this._now();
        const stamps = {};
        const parts = Object.keys(SYNCED_BY_PART).flatMap((key) => Object.keys(partsOf(key, this._local[key])).map((id) => partKey(key, id))); // TASK 773b
        for (const key of new Set([...Object.keys(DEFAULT_SETTINGS), ...Object.keys(this._local), ...Object.keys(this._stamps), ...parts])) stamps[key] = { at };
        // Clear local storage
        try {
            const st = this._store();
            if (st) {
                st.removeItem(LOCAL_KEY);
                st.setItem(STAMPS_KEY, JSON.stringify(stamps));
            }
        } catch (e) { console.warn('[SettingsManager] failed to clear localStorage', e); }

        // Reset internal state to defaults only (ignore project config)
        this._local = {};
        this._stamps = stamps;
        this._settings = { ...DEFAULT_SETTINGS };
        this._emitChange(null, null, { source: 'reset' });
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

/** A separate settings store (TASK 773: a node test's second "device"); the app uses the one default instance below. */
export const createSettingsManager = (opts) => new SettingsManager(opts);

const mgr = new SettingsManager();
export default mgr;