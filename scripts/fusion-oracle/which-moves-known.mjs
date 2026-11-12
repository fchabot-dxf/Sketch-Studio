// TASK 518 -- (re)writes tests/fixtures/fusion-oracle/which-moves-known.json: one entry per scenario where OUR answer differs from Fusion's, with the reason
// class of its group. Run it only when a difference is understood and accepted as KNOWN (the test fails when a KNOWN cell starts agreeing or an agreeing cell starts differing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarios, runOurs, cellOf } from '../../tests/harness/fusion-oracle/which-moves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves.json'), 'utf8'));
// reason class per group after task 525 (who moves at creation from the declared table). "Task 526" = Fusion refuses what ours accepts.
const REASON = {
  'horizontal-line': 'after task 525: a free line made H: Fusion turns it about its midpoint here, but moves only its second end in the graded cell horizontal-line|L|0 (ours: the second end)',
  'vertical-line': 'after task 525: a free line made V: Fusion turns it about its midpoint here, but moves only its second end in the graded cell vertical-line|L|0 (ours: the second end)',
  'equal-line-line': 'after task 525: Fusion moves both lines (shared joint, second line picked first): outside the one-mover table',
  'equal-arc-circle': "Fusion's API refuses equal(arc, circle); ours accepts it (task 526)",
  'tangent-arc-arc': 'after task 525: the centre-fixed arc should resize, but its least-change solve does not converge alone (the NEW-6 family), so ours moves the other arc',
  'dim-aligned': 'after task 525: the 315 and the graded fixture disagree on two free lines (here the first pick moves, in dim-aligned|LL|0,0 the second)',
  'dim-horizontal': 'after task 525: Fusion moves the picked point alone (the line stretches); ours translates the line (the graded cells translate it)',
  'dim-vertical': 'after task 525: Fusion moves the picked point alone (the line stretches); ours translates the line (the graded cells translate it)',
  'dim-length': 'Fusion refuses a dimension on a fully fixed line; ours adds it as a reference (task 526)',
  'dim-radius-arc': 'Fusion refuses a dimension on a fully fixed arc; ours adds it as a reference (task 526)',
};
const known = {};
for (const sc of buildScenarios()) {
  const f = fx.results[sc.id];
  const c = cellOf(f, runOurs(sc));
  if (!c.same) known[sc.id] = REASON[sc.group] || 'PLACEMENT: which geometry moves differs (see docs/FUSION-COMPARISON.md, Which geometry moves)';
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-known.json'), JSON.stringify(known, null, 1));
console.log(Object.keys(known).length + ' KNOWN of ' + fx.scenarios.length);
