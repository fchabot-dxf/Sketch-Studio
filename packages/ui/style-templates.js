// packages/ui/style-templates.js — the ONE declaration of the sketcher STYLE TEMPLATES.
// A template = { id, name, settings }: values for the look knobs in SettingsManager (the shared Style-panel
// CONTROLS). Applying a template writes EVERY key in STYLE_SETTING_KEYS (a key a template omits falls back to the
// factory default), so switching templates never leaves the previous template's values behind. The renderer knows
// nothing about templates: it just reads the settings. The chosen id lives in the STYLE_TEMPLATE setting.
//
// On-screen sizes (renderer): line = 6px * LINE_STROKE; joint radius = 4px * JOINT_RADIUS; joint ring =
// line * JOINT_STROKE_MULT; selected/hovered line = line * SELECTION/HOVER_FEEDBACK_MULT; glyph badge diameter =
// 1.6 * GLYPH_SYMBOL_SIZE_PX.

import SettingsManager from '#core/settings-manager.js';

// The look knobs a template owns. (Snap/grid behaviour and grid look are not touched.)
export const STYLE_SETTING_KEYS = [
  'LINE_STROKE', 'JOINT_RADIUS', 'JOINT_STROKE_MULT', 'SELECTION_FEEDBACK_MULT', 'HOVER_FEEDBACK_MULT',
  'GLYPH_SYMBOL_SIZE_PX', 'GLYPH_INFERENCE_SIZE_PX', 'GLYPH_OFFSET_PX', 'GLOW_WIDTH_PX',
  'DASH_LENGTH_PX', 'DASH_GAP_PX',
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
  // 13px glyph icons, thin dashed construction.
  {
    id: 'fusion', name: 'Fusion',
    settings: factory({
      LINE_STROKE: 0.25, JOINT_RADIUS: 0.75, JOINT_STROKE_MULT: 0.67,
      SELECTION_FEEDBACK_MULT: 2.33, HOVER_FEEDBACK_MULT: 2, GLOW_WIDTH_PX: 10,
      GLYPH_SYMBOL_SIZE_PX: 13, GLYPH_INFERENCE_SIZE_PX: 16, GLYPH_OFFSET_PX: 30,
      DASH_LENGTH_PX: 7, DASH_GAP_PX: 4,
    }),
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
