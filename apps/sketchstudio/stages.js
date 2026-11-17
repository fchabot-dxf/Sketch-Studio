// apps/sketchstudio/stages.js — SketchStudio's step list, DECLARED in one importable place (TASK 725; the page script main.js and the tests read it).
// Design (the shared Design canvas: the common step name, #ui/stage-names.js) -> Drawing (SketchStudio's own step: the clean, read-only drawing of the
// design with only its geometry and dimensions, to review it and make it; ./drawing-view.js). Like Trace's Trace, Drawing is the
// app's own step, so its label is declared here, not in the shared COMMON_STEPS. The ☰ menu's "Export…" view is not a step.
import { commonStage } from '#ui/stage-names.js';

export const STUDIO_STAGES = [
  commonStage('design'),
  { id: 'drawing', label: 'Drawing' },
];

/** The step showing when the page was left, kept across reloads (Shaper's MODE_KEY, Pen Plotter's STAGE_KEY). */
export const STAGE_KEY = 'sketchstudio-stage';

/** The step a page opens on: the stored one when it is still a step, else the first (Design). TASK 746: the step was stored as 'build' before it was
 *  renamed Drawing; that stored value reads as 'drawing' here (the one place the stored step is read), and the next step change rewrites it. */
export function initialStage(stored) {
  if (stored === 'build') return 'drawing';
  return STUDIO_STAGES.some((s) => s.id === stored) ? stored : STUDIO_STAGES[0].id;
}

/** True for a step id (what is stored); false for a view that is not a step (the ☰ Export… view). */
export function isStage(id) {
  return STUDIO_STAGES.some((s) => s.id === id);
}
