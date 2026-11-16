// tests/shaper-stage-open-705-node.test.js — TASK 705, rewritten by TASK 706: Shaper's mode router rule (apps/shaper/src/modes.js showDesign). 705 showed
// Design only when Explore showed (Explore, a separate SVG viewer, could not show a design) and kept every other stage. TASK 706 removed Explore, and the
// owner's ruling "everything in Design" (turn 1886) made the rule one for all hosts: a design the user OPENS (new / Open / Open from file, a new tab: the
// document buffer's OPENING_REASONS) or a drawing the user IMPORTS is shown in Design FROM ANY STAGE (Vcarve, Prepare and Review too: 705's "stays in
// <stage>" checks became "shows Design"); a tab switch, the page's own restore and a Drive conflict reload keep the stage (the buffer does not call
// showDesign for them: tests/design-only-706-node.test.js B); Fusion mode (no Design stage) never goes there.
import assert from 'node:assert';
import { SHAPER_STAGES, shaperStagesFor, createModeRouter } from '../apps/shaper/src/modes.js';
import { OPENING_REASONS } from '../packages/ui/document-buffer.js';

let checks = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); checks++; };
const makeRouter = (stages = SHAPER_STAGES) => {
  const makeView = () => ({ hidden: false, style: {} });
  const views = { design: makeView(), vcarve: makeView(), prepare: makeView(), review: makeView() };
  const controller = { start() {}, stop() {} };
  const router = createModeRouter({ views, stages, getController: () => controller, ensureSketch: () => {} });
  return { router, views };
};

eq([...OPENING_REASONS].sort().join(','), 'file,new,open', 'the opening reasons (now declared in the shared document buffer): a new design, Open, Open from file');

for (const stage of ['vcarve', 'prepare', 'review', 'design']) {
  const { router, views } = makeRouter();
  router.showMode(stage);
  router.showDesign();
  eq(router.current(), 'design', `an opened design or an import started in ${stage} shows Design (705: stayed in ${stage} unless it was Explore)`);
  eq(views.design.hidden, false, `${stage}: the Design view is shown`);
  for (const other of ['vcarve', 'prepare', 'review']) eq(views[other].hidden, true, `${stage}: ${other} is hidden`);
}
{
  const { router } = makeRouter(shaperStagesFor({ fusion: true }));
  router.showMode('prepare');
  router.showDesign();
  eq(router.current(), 'prepare', 'Fusion mode (no Design stage) stays in Prepare');
  router.showMode('review');
  router.showDesign();
  eq(router.current(), 'review', 'and in Review');
}
console.log(`shaper-stage-open-705-node: ${checks} checks pass`);
