// tests/shaper-stage-open-705-node.test.js — TASK 705: Shaper's mode router rule (apps/shaper/src/modes.js): Explore is a separate SVG file viewer and
// cannot show a design, so a design the user OPENS (a new one, blank or a template; Open; Open from file) or a drawing the user IMPORTS while Explore shows
// is shown in Design. Every other stage keeps showing it where the user is; a tab switch, the page's own restore and a Drive conflict reload keep the stage;
// Fusion mode (no Design stage) never goes there.
import assert from 'node:assert';
import { SHAPER_STAGES, shaperStagesFor, createModeRouter, OPENING_REASONS } from '../apps/shaper/src/modes.js';

let checks = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); checks++; };
const makeRouter = (stages = SHAPER_STAGES) => {
  const makeView = () => ({ hidden: false, style: {} });
  const views = { explore: makeView(), design: makeView(), vcarve: makeView(), prepare: makeView(), review: makeView() };
  const controller = { start() {}, stop() {} };
  const router = createModeRouter({ views, stages, getController: () => controller, ensureSketch: () => {} });
  return { router, views };
};

eq([...OPENING_REASONS].sort().join(','), 'file,new,open', 'the opening reasons: a new design, Open, Open from file');

for (const reason of ['new', 'open', 'file']) {
  const { router, views } = makeRouter();
  router.showMode('explore');
  router.documentOpened(reason);
  eq(router.current(), 'design', `"${reason}" from Explore shows Design`);
  eq(views.design.hidden, false, `"${reason}": the Design view is shown`);
  eq(views.explore.style.display, 'none', `"${reason}": Explore is hidden`);
}
for (const reason of ['switch', 'restore', 'conflict']) {
  const { router } = makeRouter();
  router.showMode('explore');
  router.documentOpened(reason);
  eq(router.current(), 'explore', `"${reason}" keeps Explore`);
}
for (const stage of ['vcarve', 'prepare', 'review', 'design']) {
  const { router } = makeRouter();
  router.showMode(stage);
  router.documentOpened('new');
  eq(router.current(), stage, `a design opened in ${stage} stays in ${stage}`);
  router.showDocument();
  eq(router.current(), stage, `an import in ${stage} stays in ${stage}`);
}
{
  const { router } = makeRouter();
  router.showMode('explore');
  router.showDocument();
  eq(router.current(), 'design', 'an import from Explore shows Design');
}
{
  const { router } = makeRouter(shaperStagesFor({ fusion: true }));
  router.showMode('prepare');
  router.documentOpened('open');
  router.showDocument();
  eq(router.current(), 'prepare', 'Fusion mode (no Design stage) stays in Prepare');
}
console.log(`shaper-stage-open-705-node: ${checks} checks pass`);
