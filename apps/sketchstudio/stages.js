// apps/sketchstudio/stages.js — SketchStudio's step list, DECLARED in one importable place (TASK 725; the page script main.js and the tests read it).
// Design (the shared Design canvas: the common step name, #ui/stage-names.js) -> Build (SketchStudio's own step: the clean, read-only drawing of the
// design with only its geometry and dimensions, to review it and build it; ./build-view.js). Like Shaper's Vcarve and Trace's Trace, Build is the
// app's own step, so its label is declared here, not in the shared COMMON_STEPS. The ☰ menu's "Export…" view is not a step.
import { commonStage } from '#ui/stage-names.js';

export const STUDIO_STAGES = [
  commonStage('design'),
  { id: 'build', label: 'Build' },
];

/** The step showing when the page was left, kept across reloads (Shaper's MODE_KEY, Pen Plotter's STAGE_KEY). */
export const STAGE_KEY = 'sketchstudio-stage';

/** The step a page opens on: the stored one when it is still a step, else the first (Design). */
export function initialStage(stored) {
  return STUDIO_STAGES.some((s) => s.id === stored) ? stored : STUDIO_STAGES[0].id;
}

/** True for a step id (what is stored); false for a view that is not a step (the ☰ Export… view). */
export function isStage(id) {
  return STUDIO_STAGES.some((s) => s.id === id);
}
