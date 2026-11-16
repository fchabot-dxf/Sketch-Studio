// packages/ui/stage-names.js — TASK 707: the COMMON STEP NAMES, declared once. Every app reads the same words in the same order:
//   Design (draw / import / edit geometry) -> Prepare (that app's per-shape output settings) -> Export (the output and its download).
// An app builds its stage list with commonStage(); it keeps its own app-specific steps (Shaper's Vcarve, Trace's Trace) and its own stage ids (a stored id such
// as 'toolpath' / 'review' / 'edit' stays valid: the id is the app's, only the WORDS are shared). A label typed twice in two apps is the drift this file prevents.
export const COMMON_STEPS = Object.freeze({
  design:  'Design',
  prepare: 'Prepare',
  export:  'Export',
});

/** The order the common steps come in, in every app that has them. */
export const COMMON_STEP_ORDER = Object.freeze(['design', 'prepare', 'export']);

/** commonStage('prepare', 'toolpath', { blurb }) -> { id: 'toolpath', label: 'Prepare', ...extra }: `key` picks the shared label, `id` (default: the key) is the app's own stage id. */
export function commonStage(key, id = key, extra = {}) {
  if (!Object.hasOwn(COMMON_STEPS, key)) throw new Error('commonStage: unknown common step "' + key + '"');
  return { id, label: COMMON_STEPS[key], ...extra };
}
