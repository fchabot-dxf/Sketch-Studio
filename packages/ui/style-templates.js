// packages/ui/style-templates.js — the ONE declaration of the sketcher STYLE TEMPLATES.
// A template = { id, name, settings, tokens? }: values for the look knobs in SettingsManager (the shared Style-panel
// CONTROLS) plus an optional map of canvas colour tokens (--sk-*; the renderer already reads them through skv()). Applying
// a template writes EVERY key in STYLE_SETTING_KEYS (a key a template omits falls back to the
// factory default), so switching templates never leaves the previous template's values behind. The renderer knows
// nothing about templates: it just reads the settings and the CSS tokens. The chosen id lives in the STYLE_TEMPLATE setting.
//
// On-screen sizes (renderer): line = 6px * LINE_STROKE; joint radius = 4px * JOINT_RADIUS; joint ring =
// line * JOINT_STROKE_MULT; selected/hovered line = line * SELECTION/HOVER_FEEDBACK_MULT; glyph = the outlined icon,
// GLYPH_SYMBOL_SIZE_PX on its longer side.

import SettingsManager from '#core/settings-manager.js';
import { dbg } from '#core/debug.js';

// The look knobs a template owns. (Snap/grid behaviour and grid look are not touched.)
export const STYLE_SETTING_KEYS = [
  'LINE_STROKE', 'JOINT_RADIUS', 'JOINT_STROKE_MULT', 'SELECTION_FEEDBACK_MULT', 'HOVER_FEEDBACK_MULT',
  'GLYPH_SYMBOL_SIZE_PX', 'GLYPH_INFERENCE_SIZE_PX', 'GLYPH_OFFSET_PX', 'GLYPH_OUTLINE_PX', 'GLOW_WIDTH_PX',
  'DASH_LENGTH_PX', 'DASH_GAP_PX',
  'DIM_LABEL_BOX',   'HOVER_COLOR', 'FIXED_JOINT_FILL', 'LABEL_FONT_FAMILY', 'PROFILE_FILL', 'LOCKED_LINE_COLOR',
];

const FACTORY = SettingsManager.getDefaults();
const factory = (overrides = {}) => {
  const out = {};
  for (const k of STYLE_SETTING_KEYS) out[k] = k in overrides ? overrides[k] : FACTORY[k];
  return out;
};

// The canvas colours of the Fusion look (CSS --sk-* custom properties set on the canvas HOST element only). Declared once: the
// Fusion template and (task 614) the Default template both use them.
const FUSION_TOKENS = {
  '--sk-canvas-bg': '#FFFFFF', '--sk-canvas-bg-snapping': '#F3F8FB',
  '--sk-grid-minor': '#E2E6EA', '--sk-grid-major': '#C9CFD6',
  '--sk-constraint-fill': '#2B9BD6',   // free / under-constrained lines + joints
  '--sk-geo-fixed': '#000000',         // fully constrained (DOF 0) lines + joints; locked ones use LOCKED_LINE_COLOR (green)
  '--sk-construction': '#A9744F',
  '--sk-constraint-stroke': '#1F2937', // dimension lines + text
  '--sk-selection': '#3B7DD8',         // selected outline + selected glyph outline
  '--sk-profile-fill': '#5B9BF0',
  '--sk-profile-tint': '#3AA0DC',      // PROFILE_FILL: the closed-loop tint (drawn at 12% opacity)
  '--sk-joint-fill': '#FFFFFF',
};

export const STYLE_TEMPLATES = [
  // The factory look (task 614: the owner's current look) with the Fusion canvas colours.
  { id: 'default', name: 'Default', settings: factory(), tokens: FUSION_TOKENS },

  // Fusion 360 proportions: 1.5px lines, hover 3px (2x), selected 3.5px (2.33x), 3px-radius joints with a 1px ring,
  // 15px white glyph icons with a dark outline, thin dashed construction, plain dimension text, blue-violet
  // hover, solid dark dots for fixed joints. `tokens` = the canvas colours (CSS --sk-* custom properties set on the
  // canvas HOST element only): free lines sketch blue, fully constrained black, brown construction, pale blue plane.
  {
    id: 'fusion', name: 'Fusion',
    settings: factory({
      LINE_STROKE: 0.25, JOINT_RADIUS: 0.75, JOINT_STROKE_MULT: 0.67,
      SELECTION_FEEDBACK_MULT: 2.33, HOVER_FEEDBACK_MULT: 2, GLOW_WIDTH_PX: 10,
      GLYPH_SYMBOL_SIZE_PX: 15, GLYPH_INFERENCE_SIZE_PX: 16, GLYPH_OFFSET_PX: 22, GLYPH_OUTLINE_PX: 0.5,
      DASH_LENGTH_PX: 7, DASH_GAP_PX: 4,
      DIM_LABEL_BOX: false, HOVER_COLOR: '#5B6CF0', FIXED_JOINT_FILL: '#202020',
            LABEL_FONT_FAMILY: 'Segoe UI, Arial, Helvetica, sans-serif', PROFILE_FILL: 'on', LOCKED_LINE_COLOR: '#8DB84A',
          }),
    tokens: FUSION_TOKENS,
  },

  // Dense drawings: thin lines, small joints and glyphs, tight glow.
  {
    id: 'compact', name: 'Compact',
    settings: factory({
      LINE_STROKE: 0.3, JOINT_RADIUS: 1, JOINT_STROKE_MULT: 0.8,
      SELECTION_FEEDBACK_MULT: 2.5, GLOW_WIDTH_PX: 10,
      GLYPH_SYMBOL_SIZE_PX: 12, GLYPH_INFERENCE_SIZE_PX: 14, GLYPH_OFFSET_PX: 26,
      DASH_LENGTH_PX: 5, DASH_GAP_PX: 4,
    }),
  },

  // Screenshots / teaching: heavy lines, big joints and glyphs.
  {
    id: 'presentation', name: 'Presentation',
    settings: factory({
      LINE_STROKE: 1.5, JOINT_RADIUS: 5, JOINT_STROKE_MULT: 1,
      SELECTION_FEEDBACK_MULT: 1.5, HOVER_FEEDBACK_MULT: 2, GLOW_WIDTH_PX: 28,
      GLYPH_SYMBOL_SIZE_PX: 28, GLYPH_INFERENCE_SIZE_PX: 32, GLYPH_OFFSET_PX: 56,
      DASH_LENGTH_PX: 14, DASH_GAP_PX: 8,
    }),
  },
];

export const CUSTOM_TEMPLATE_ID = 'custom';

// ── USER PRESETS: named copies of the current look, kept per user in the STYLE_PRESETS setting ({ v: 1, presets: [...] }).
// A preset has the same { id, name, settings, tokens? } shape as a built-in, so it applies through the SAME applyStyleTemplate.
export const USER_PRESETS_KEY = 'STYLE_PRESETS';
export const USER_PRESETS_VERSION = 1;
export const PRESET_NAME_MAX = 40;
const ALL_TOKEN_NAMES = [...new Set(STYLE_TEMPLATES.flatMap((t) => Object.keys(t.tokens || {})))];

// Why a stored preset is not valid, or null. Every look knob must be present with the type of its factory value; tokens
// (optional) may only use the --sk-* names a built-in template declares.
function presetProblem(p) {
  if (!p || typeof p !== 'object') return 'not an object';
  if (typeof p.id !== 'string' || !p.id) return 'no id';
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > PRESET_NAME_MAX) return 'bad name';
  if (!p.settings || typeof p.settings !== 'object') return 'no settings';
  for (const k of STYLE_SETTING_KEYS) {
    const v = p.settings[k];
    if (typeof v !== typeof FACTORY[k] || (typeof v === 'number' && !Number.isFinite(v))) return 'bad value for ' + k;
  }
  if (p.tokens !== undefined) {
    if (!p.tokens || typeof p.tokens !== 'object') return 'bad tokens';
    for (const [n, v] of Object.entries(p.tokens)) if (!ALL_TOKEN_NAMES.includes(n) || typeof v !== 'string') return 'bad token ' + n;
  }
  return null;
}

// The valid user presets inside a raw STYLE_PRESETS value, in stored order. Each invalid entry is dropped with a dbg.warn naming
// it. Cached per raw object, so the warning is printed once per stored value, not on every read.
const validated = new WeakMap();
let warnedRaw;
export function userPresetsOf(raw) {
  if (!raw || typeof raw !== 'object') {
    if (raw != null && warnedRaw !== raw) { warnedRaw = raw; dbg.warn('style-presets', '[style-presets] STYLE_PRESETS is not an object; no user presets loaded', raw); }
    return [];
  }
  if (validated.has(raw)) return validated.get(raw);
  const out = [], seen = new Set();
  if (raw.v !== USER_PRESETS_VERSION || !Array.isArray(raw.presets)) {
    dbg.warn('style-presets', '[style-presets] STYLE_PRESETS has an unknown shape (v=' + raw.v + '); no user presets loaded');
  } else {
    for (const p of raw.presets) {
      const why = presetProblem(p) || (seen.has(p.id) ? 'duplicate id' : null);
      if (why) dbg.warn('style-presets', '[style-presets] dropping user preset ' + JSON.stringify(p && p.name !== undefined ? p.name : p) + ': ' + why);
      else { seen.add(p.id); out.push(p); }
    }
  }
  validated.set(raw, out);
  return out;
}
export const listUserPresets = (settings = SettingsManager) => userPresetsOf(settings.get(USER_PRESETS_KEY));
export const isUserPresetId = (id, settings = SettingsManager) => listUserPresets(settings).some((p) => p.id === id);

export function getStyleTemplate(id, settings = SettingsManager) {
  return STYLE_TEMPLATES.find((t) => t.id === id) || listUserPresets(settings).find((p) => p.id === id) || STYLE_TEMPLATES[0];
}

// The id the Style panel shows: the chosen template while every look knob still equals it, else 'custom'.
export function activeStyleTemplateId(all) {
  const t = STYLE_TEMPLATES.find((x) => x.id === all.STYLE_TEMPLATE) || userPresetsOf(all[USER_PRESETS_KEY]).find((p) => p.id === all.STYLE_TEMPLATE) || STYLE_TEMPLATES[0];
  return STYLE_SETTING_KEYS.every((k) => all[k] === t.settings[k]) ? t.id : CUSTOM_TEMPLATE_ID;
}

// Write a template's (built-in or user preset) settings through the store (live: the renderer reads them on the next frame).
export function applyStyleTemplate(id, settings = SettingsManager) {
  const t = getStyleTemplate(id, settings);
  settings.set('STYLE_TEMPLATE', t.id, { persist: 'local' });
  for (const k of STYLE_SETTING_KEYS) settings.set(k, t.settings[k], { persist: 'local' });
}

// Why `name` can not be a user preset's name, or null. A built-in's name is taken; an existing user preset's name is taken
// unless `allowExisting` (a save may overwrite it); `exceptId` = the preset being renamed.
export function presetNameProblem(name, settings = SettingsManager, { exceptId = null, allowExisting = false } = {}) {
  const n = String(name).trim();
  if (!n) return 'Enter a name.';
  if (n.length > PRESET_NAME_MAX) return 'Use at most ' + PRESET_NAME_MAX + ' characters.';
  const same = (a) => a.name.trim().toLowerCase() === n.toLowerCase();
  if (STYLE_TEMPLATES.some(same)) return '"' + n + '" is a built-in style; pick another name.';
  if (!allowExisting && listUserPresets(settings).some((p) => p.id !== exceptId && same(p))) return 'A preset named "' + n + '" already exists.';
  return null;
}
export const findUserPresetByName = (name, settings = SettingsManager) => listUserPresets(settings).find((p) => p.name.trim().toLowerCase() === String(name).trim().toLowerCase()) || null;

const writeUserPresets = (settings, presets) => settings.set(USER_PRESETS_KEY, { v: USER_PRESETS_VERSION, presets }, { persist: 'local' });

// Save the CURRENT values of every look knob (plus the colour tokens of the active template, if it has any) as a user preset
// named `name`, then make it the chosen template. A preset with that name (any case) is overwritten in place (same id, same name). Returns the preset.
export function saveUserPreset(name, settings = SettingsManager) {
  const problem = presetNameProblem(name, settings, { allowExisting: true });
  if (problem) throw new Error(problem);
  const all = settings.getAll();
  const snapshot = {};
  for (const k of STYLE_SETTING_KEYS) snapshot[k] = all[k];
  const tokens = getStyleTemplate(all.STYLE_TEMPLATE, settings).tokens;
  const existing = findUserPresetByName(name, settings);
  const preset = { id: existing ? existing.id : 'user-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), name: existing ? existing.name : String(name).trim(), settings: snapshot };
  if (tokens) preset.tokens = { ...tokens };
  const rest = listUserPresets(settings);
  writeUserPresets(settings, existing ? rest.map((p) => (p.id === preset.id ? preset : p)) : [...rest, preset]);
  settings.set('STYLE_TEMPLATE', preset.id, { persist: 'local' });
  return preset;
}

export function renameUserPreset(id, name, settings = SettingsManager) {
  const problem = presetNameProblem(name, settings, { exceptId: id });
  if (problem) throw new Error(problem);
  if (!isUserPresetId(id, settings)) throw new Error('No user preset ' + id);
  writeUserPresets(settings, listUserPresets(settings).map((p) => (p.id === id ? { ...p, name: String(name).trim() } : p)));
}

// Delete a user preset. The look stays as it is (the panel then shows Custom or the matching built-in).
export function deleteUserPreset(id, settings = SettingsManager) {
  if (!isUserPresetId(id, settings)) throw new Error('No user preset ' + id);
  writeUserPresets(settings, listUserPresets(settings).filter((p) => p.id !== id));
}

// Template colour tokens: --sk-* custom properties set on the canvas HOST element ONLY (never app chrome). Every token any
// template declares is cleared first, so Default (no tokens) leaves the host with its own CSS values.
export function applyTemplateTokens(host, id, settings = SettingsManager) {
  if (!host || !host.style) return;
  const tokens = getStyleTemplate(id, settings).tokens || {};
  for (const name of ALL_TOKEN_NAMES) host.style.removeProperty(name);
  for (const [name, value] of Object.entries(tokens)) host.style.setProperty(name, value);
}

// Keep a host's tokens in step with the chosen template (now, and on every later template change or reset).
export function bindTemplateTokens(host, settings = SettingsManager) {
  applyTemplateTokens(host, settings.get('STYLE_TEMPLATE'), settings);
  return settings.subscribe((key) => { if (key === null || key === 'STYLE_TEMPLATE' || key === USER_PRESETS_KEY) applyTemplateTokens(host, settings.get('STYLE_TEMPLATE'), settings); });
}
