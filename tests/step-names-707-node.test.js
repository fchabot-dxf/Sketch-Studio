// tests/step-names-707-node.test.js — TASK 707 ("Same names everywhere"): every app reads the same step words in the same order, from ONE declaration
// (packages/ui/stage-names.js): Design -> Prepare -> Export. App-specific steps (Shaper's Vcarve, Trace's Trace) are the app's own; a stored stage id
// (the app's own id: 'toolpath' / 'review' / 'edit') still opens the right stage.
import assert from 'node:assert';
import { COMMON_STEPS, COMMON_STEP_ORDER, commonStage } from '../packages/ui/stage-names.js';
import { SHAPER_STAGES, shaperStagesFor, resolveInitialMode } from '../apps/shaper/src/modes.js';
import { TRACE_STAGES } from '../apps/trace/src/stages.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// the shared declaration
eq(COMMON_STEP_ORDER.map((k) => COMMON_STEPS[k]), ['Design', 'Prepare', 'Export'], 'the three common words, in order');
eq(commonStage('prepare', 'toolpath', { blurb: 'x' }), { id: 'toolpath', label: 'Prepare', blurb: 'x' }, 'commonStage: the app keeps its id and extras, the label is shared');
assert.throws(() => commonStage('review'), /unknown common step/); checks++;

// the common words an app shows, in the order it shows them: must be a subsequence of the common order
const labels = (stages) => stages.map((s) => s.label);
const common = (stages) => labels(stages).filter((l) => Object.values(COMMON_STEPS).includes(l));

// Shaper: Design, Vcarve (its own, before Prepare), Prepare, Export (stage id 'review')
eq(labels(SHAPER_STAGES), ['Design', 'Vcarve', 'Prepare', 'Export'], 'Shaper: Design, Vcarve, Prepare, Export');
eq(SHAPER_STAGES.map((s) => s.id), ['design', 'vcarve', 'prepare', 'review'], 'Shaper: the stage ids are unchanged');
eq(common(SHAPER_STAGES), ['Design', 'Prepare', 'Export'], 'Shaper: the common words in the common order');
eq(labels(shaperStagesFor({ fusion: true })), ['Prepare', 'Export'], 'Shaper in Fusion mode: Prepare, Export');
for (const old of ['design', 'vcarve', 'prepare', 'review', 'simexport']) {
  eq(resolveInitialMode(old), old === 'simexport' ? 'review' : old, `Shaper: a stored "${old}" opens the same stage as before`);
}

// Trace: Trace, Design (stage id 'edit'), Export; no Prepare (Trace has no per-shape output settings)
eq(labels(TRACE_STAGES), ['Trace', 'Design', 'Export'], 'Trace: Trace, Design, Export');
eq(TRACE_STAGES.map((s) => s.id), ['trace', 'edit', 'export'], 'Trace: the stage ids are unchanged');
eq(common(TRACE_STAGES), ['Design', 'Export'], 'Trace: the common words in the common order');

// Pen Plotter (its real stage router): Design, Prepare (stage id 'toolpath'), Export; a stored 'toolpath' opens it
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'penplotter', 'Plot');
  const pp = await open({ host: 'penplotter', profile });
  try {
    const { STAGES } = await import('../apps/penplotter/src/stages.js');
    eq(labels(STAGES), ['Design', 'Prepare', 'Export'], 'Pen Plotter: Design, Prepare, Export');
    eq(STAGES.map((s) => s.id), ['design', 'toolpath', 'export'], 'Pen Plotter: the stage ids are unchanged');
    eq(common(STAGES), ['Design', 'Prepare', 'Export'], 'Pen Plotter: the common words in the common order');
    pp.router.showStage('toolpath');
    eq(pp.router.currentStageId(), 'toolpath', 'Pen Plotter: the stored id "toolpath" opens Prepare');
    const body = pp.document.getElementById('stage-toolpath');
    eq(body.hidden, false, 'Pen Plotter: its body shows');
  } finally { await pp.close(); }
}
console.log(`step-names-707-node: ${checks} checks pass`);
