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

export const STYLE_TEMPLATES = [
  // Exactly today's look: the factory values.
  { id: 'default', name: 'Default', settings: factory() },

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
    tokens: {
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
    },
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

export function getStyleTemplate(id) {
  return STYLE_TEMPLATES.find((t) => t.id === id) || STYLE_TEMPLATES[0];
}

// The id the Style panel shows: the chosen template while every look knob still equals it, else 'custom'.
export function activeStyleTemplateId(all) {
  const t = getStyleTemplate(all.STYLE_TEMPLATE);
  return STYLE_SETTING_KEYS.every((k) => all[k] === t.settings[k]) ? t.id : CUSTOM_TEMPLATE_ID;
}

// Write a template's settings through the store (live: the renderer reads them on the next frame).
export function applyStyleTemplate(id, settings = SettingsManager) {
  const t = getStyleTemplate(id);
  settings.set('STYLE_TEMPLATE', t.id, { persist: 'local' });
  for (const k of STYLE_SETTING_KEYS) settings.set(k, t.settings[k], { persist: 'local' });
}

// Template colour tokens: --sk-* custom properties set on the canvas HOST element ONLY (never app chrome). Every token any
// template declares is cleared first, so Default (no tokens) leaves the host with its own CSS values.
const ALL_TOKEN_NAMES = [...new Set(STYLE_TEMPLATES.flatMap((t) => Object.keys(t.tokens || {})))];
export function applyTemplateTokens(host, id) {
  if (!host || !host.style) return;
  const tokens = getStyleTemplate(id).tokens || {};
  for (const name of ALL_TOKEN_NAMES) host.style.removeProperty(name);
  for (const [name, value] of Object.entries(tokens)) host.style.setProperty(name, value);
}

// Keep a host's tokens in step with the chosen template (now, and on every later template change or reset).
export function bindTemplateTokens(host, settings = SettingsManager) {
  applyTemplateTokens(host, settings.get('STYLE_TEMPLATE'));
  return settings.subscribe((key) => { if (key === null || key === 'STYLE_TEMPLATE') applyTemplateTokens(host, settings.get('STYLE_TEMPLATE')); });
}
