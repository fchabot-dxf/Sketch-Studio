// TASK 525 -- the WHO-MOVES table is DATA fitted to the recorded Fusion cells: packages/core/creation-placement-table.js must equal what
// scripts/fusion-oracle/fit-placement-table.mjs derives from tests/fixtures/fusion-oracle/which-moves-graded.json + which-moves.json today
// (no drift, no hand edit). Re-run the script after re-recording Fusion or changing the classifier.
import { WHO_MOVES } from '#core/creation-placement-table.js';
import { firstGivesWay } from '#core/creation-placement.js';
import { fitTable, gradedObservations, scenarioObservations, agrees } from '../scripts/fusion-oracle/fit-placement-table.mjs';

const failures = [];
const fail = (m) => failures.push(m);
const obs = [...gradedObservations(), ...scenarioObservations()];
const fitted = fitTable(obs);
if (JSON.stringify(fitted) !== JSON.stringify(WHO_MOVES)) {
  for (const k of new Set([...Object.keys(fitted), ...Object.keys(WHO_MOVES)])) if (JSON.stringify(fitted[k]) !== JSON.stringify(WHO_MOVES[k])) fail(`table key ${k} differs from the fit: re-run node scripts/fusion-oracle/fit-placement-table.mjs`);
}
// the app reads the table the way the fit scored it: for every observation, firstGivesWay agrees with the fit's own prediction
let n = 0;
for (const o of obs) {
  const e = WHO_MOVES[o.key];
  if (!e) continue;
  n++;
  if ((firstGivesWay(o.key, o.f, o.s) === (o.m === 'first')) !== agrees(e, o)) fail(`${o.id}: the app's reading of the table differs from the fit's`);
}
if (failures.length) { console.error('creation-placement-table FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`creation-placement-table: ${Object.keys(WHO_MOVES).length} keys equal the fit of ${obs.length} recorded Fusion cells; ${n} cells read the same by the app`);
